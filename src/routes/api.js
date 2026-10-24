'use strict';

const express = require('express');
const path = require('path');
const config = require('../config');
const fontes = require('../sources');
const motor = require('../torrent/engine');
const catalogo = require('../catalogo');
const ff = require('../util/ffmpeg');
const { criar } = require('../util/logger');
const { infoHashDe } = require('../util/magnet');
const { parseByteRange } = require('../util/byte-range');
const { criarPosterResolver } = require('../posters');
const { posterUrlPermitida } = require('../util/poster-url');

const log = criar('api');
const rotas = express.Router();
const resolverPoster = criarPosterResolver({ apiKey: config.TMDB_API_KEY });

function ah(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const MIMES = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.ts': 'video/mp2t',
    '.flv': 'video/x-flv',
    '.ogv': 'video/ogg'
};
const MAX_POSTER_BYTES = 8 * 1024 * 1024;

async function lerImagemLimitada(resposta) {
    if (!resposta.body || typeof resposta.body.getReader !== 'function') {
        const erro = new Error('resposta de imagem vazia');
        erro.statusCode = 502;
        throw erro;
    }
    const leitor = resposta.body.getReader();
    const partes = [];
    let total = 0;
    while (true) {
        const parte = await leitor.read();
        if (parte.done) break;
        total += parte.value.byteLength;
        if (total > MAX_POSTER_BYTES) {
            await leitor.cancel();
            const erro = new Error('imagem excede o limite permitido');
            erro.statusCode = 413;
            throw erro;
        }
        partes.push(Buffer.from(parte.value));
    }
    return Buffer.concat(partes, total);
}

function mimeDe(nome) {
    return MIMES[path.extname(String(nome || '')).toLowerCase()] || 'application/octet-stream';
}

/* --------------------------------------------------------------------------
   Saude / fontes
-------------------------------------------------------------------------- */

rotas.get('/api/saude', (req, res) => {
    res.json({
        ok: true,
        versao: 3,
        uptimeSeg: Math.round(process.uptime()),
        torrentsAtivos: motor.listarAtivos().length,
        catalogo: catalogo.resumo(),
        metadados: { tmdbConfigurado: Boolean(config.TMDB_API_KEY), fallback: 'Wikimedia Commons (licenças reutilizáveis)' },
        ffmpeg: ff.caminhoDoBinario()
    });
});

rotas.get('/api/fontes', ah(async (req, res) => {
    const relatorio = await fontes.statusFontes(req.query.forcar === '1');
    res.json(relatorio);
}));

rotas.get('/api/categorias', (req, res) => {
    res.json({
        categorias: [
            { id: 'inicio', rotulo: 'Início' },
            { id: 'filmes', rotulo: 'Filmes' },
            { id: 'series', rotulo: 'Séries' },
            { id: 'animes', rotulo: 'Animes' },
            { id: 'doramas', rotulo: 'Doramas' },
            { id: 'novelas', rotulo: 'Novelas' },
            { id: 'curtas', rotulo: 'Curtas' },
            { id: 'documentarios', rotulo: 'Documentários' }
        ]
    });
});

/* --------------------------------------------------------------------------
   Busca
-------------------------------------------------------------------------- */

rotas.get('/api/buscar', ah(async (req, res) => {
    const termo = String(req.query.q || '').trim();
    if (!termo) return res.json({ termo: '', total: 0, itens: [], fontes: [] });

    const dados = await fontes.buscar(termo, {
        categoria: req.query.categoria || 'todos',
        pagina: Number(req.query.pagina) || 1,
        porPagina: Math.min(120, Number(req.query.porPagina) || 60),
        apenasPtBr: req.query.ptbr === undefined ? config.APENAS_PTBR : req.query.ptbr !== '0',
        resolverMagnet: req.query.magnet !== '0'
    });

    res.json(dados);
}));

rotas.get('/api/catalogo', (req, res) => {
    res.json(catalogo.listar(req.query.categoria || 'inicio', {
        pagina: Number(req.query.pagina) || 1,
        porPagina: Math.min(120, Number(req.query.porPagina) || 60),
        termo: req.query.termo || ''
    }));
});

rotas.get('/api/poster', ah(async (req, res) => {
    const titulo = String(req.query.title || '').trim().slice(0, 180);
    const ano = String(req.query.year || '').match(/(?:^|[^0-9])((?:19|20)\d{2})(?=$|[^0-9])/)?.[1] || '';
    if (!titulo) return res.json({ poster: '', provider: null, attribution: null });
    const resultado = await resolverPoster.resolve(titulo, ano);
    res.setHeader('Cache-Control', resultado.poster ? 'private, max-age=3600' : 'private, max-age=300');
    res.json(resultado);
}));

/* --------------------------------------------------------------------------
   Proxy de imagens (evita bloqueio de hotlink dos sites BR)
-------------------------------------------------------------------------- */

rotas.get('/api/img', ah(async (req, res) => {
    const alvo = String(req.query.u || '');
    if (!posterUrlPermitida(alvo)) return res.status(400).end();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const resposta = await fetch(alvo, {
            method: 'GET',
            redirect: 'error',
            signal: controller.signal,
            headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' }
        });
        if (!resposta.ok) return res.status(502).end();
        const contentType = resposta.headers.get('content-type') || '';
        if (!/^image\/(?:jpeg|png|webp|avif|gif)(?:\s*;|$)/i.test(contentType)) return res.status(415).end();
        const tamanho = Number(resposta.headers.get('content-length'));
        if (Number.isFinite(tamanho) && tamanho > MAX_POSTER_BYTES) return res.status(413).end();

        const buffer = await lerImagemLimitada(resposta);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buffer);
    } catch (erro) {
        log.debug('falha no proxy de poster:', erro.message);
        if (!res.headersSent) res.status(erro.statusCode || 502).end();
    } finally {
        clearTimeout(timeout);
    }
}));

/* --------------------------------------------------------------------------
   Metadados do torrent
-------------------------------------------------------------------------- */

rotas.get('/api/torrent/:infoHash', ah(async (req, res) => {
    const registro = await motor.abrir(req.params.infoHash);
    const caminho = motor.caminhoArquivo(registro);
    const info = await ff.probe(caminho, { timeoutMs: 25000 });
    const plano = ff.planejar(info);

    res.json({
        infoHash: registro.infoHash,
        nome: registro.torrent.name,
        tamanho: registro.torrent.length,
        indice: registro.indiceArquivo,
        arquivo: registro.arquivo.name,
        arquivoTamanho: registro.arquivo.length,
        modo: plano.modo,
        motivo: plano.motivo,
        tecnico: info,
        arquivos: registro.torrent.files.map((f, i) => ({
            indice: i,
            nome: f.name,
            tamanho: f.length,
            video: motor.EXTENSOES_VIDEO.includes(path.extname(f.name).toLowerCase())
        })),
        estatisticas: motor.estatisticas(registro.infoHash)
    });
}));

rotas.get('/api/status/:infoHash', ah(async (req, res) => {
    const stats = motor.estatisticas(req.params.infoHash);
    if (!stats) return res.status(404).json({ ativo: false });
    res.json(stats);
}));

/* --------------------------------------------------------------------------
   Streaming direto (Range / 206)
-------------------------------------------------------------------------- */

rotas.get('/stream/:infoHash/:indice?', ah(async (req, res) => {
    const registro = await motor.abrir(req.params.infoHash);
    const indice = req.params.indice == null ? registro.indiceArquivo : Number(req.params.indice);
    const arquivo = registro.torrent.files[indice];
    if (!arquivo) return res.status(404).end();

    await motor.aguardarMinimo(registro, 2 * 1024 * 1024, 30000);
    registro.ultimoAcesso = Date.now();

    const total = arquivo.length;
    const cabecalho = req.headers.range;
    let inicio = 0;
    let fim = total - 1;

    if (cabecalho) {
        const intervalo = parseByteRange(cabecalho, total);
        if (!intervalo) {
            res.setHeader('Content-Range', 'bytes */' + total);
            return res.status(416).end();
        }
        inicio = intervalo.start;
        fim = intervalo.end;
    }

    res.status(cabecalho ? 206 : 200);
    res.setHeader('Content-Type', mimeDe(arquivo.name));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', fim - inicio + 1);
    res.setHeader('Cache-Control', 'no-store');
    if (cabecalho) res.setHeader('Content-Range', 'bytes ' + inicio + '-' + fim + '/' + total);

    if (total === 0) return res.end();

    const stream = arquivo.createReadStream({ start: inicio, end: fim });
    stream.on('error', (erro) => {
        log.debug('stream encerrado:', erro.message);
        try { res.end(); } catch (_) { /* noop */ }
    });
    res.on('close', () => { try { stream.destroy(); } catch (_) { /* noop */ } });
    stream.pipe(res);
}));

/* --------------------------------------------------------------------------
   Transcode / remux on-the-fly (fMP4)
-------------------------------------------------------------------------- */

rotas.get('/transcode/:infoHash/:indice?', ah(async (req, res) => {
    const registro = await motor.abrir(req.params.infoHash);
    const indice = req.params.indice == null ? registro.indiceArquivo : Number(req.params.indice);
    const arquivo = registro.torrent.files[indice];
    if (!arquivo) return res.status(404).end();

    await motor.aguardarMinimo(registro, 4 * 1024 * 1024, 40000);
    registro.ultimoAcesso = Date.now();

    const caminho = motor.caminhoArquivo(registro, indice);
    const info = await ff.probe(caminho, { timeoutMs: 25000 });
    const plano = ff.planejar(info);

    const seek = Number(req.query.t) || 0;

    res.status(200);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'none');

    const processo = ff.converter(caminho, { seek, plano });

    let erroFfmpeg = '';
    processo.stderr.on('data', (d) => { erroFfmpeg += d.toString(); });
    processo.on('error', (erro) => {
        log.erro('ffmpeg falhou:', erro.message);
        try { res.end(); } catch (_) { /* noop */ }
    });
    processo.on('close', (codigo) => {
        if (codigo !== 0 && erroFfmpeg) log.debug('ffmpeg saiu com', codigo, erroFfmpeg.slice(-400));
        try { res.end(); } catch (_) { /* noop */ }
    });

    processo.stdout.pipe(res);

    res.on('close', () => {
        try { processo.kill('SIGKILL'); } catch (_) { /* noop */ }
    });
}));

/* --------------------------------------------------------------------------
   Cache
-------------------------------------------------------------------------- */

rotas.get('/api/cache', (req, res) => {
    res.json({ ativos: motor.listarAtivos() });
});

rotas.delete('/api/cache', ah(async (req, res) => {
    const alvo = req.query.infoHash;
    if (alvo) {
        const ok = await motor.destruir(alvo);
        return res.json({ ok, removido: alvo });
    }
    await motor.limparTudo();
    fontes.limparCache();
    res.json({ ok: true });
}));

rotas.post('/api/cache/limpar', ah(async (req, res) => {
    await motor.limparTudo();
    fontes.limparCache();
    res.json({ ok: true });
}));

/* --------------------------------------------------------------------------
   Erros
-------------------------------------------------------------------------- */

rotas.use((erro, req, res, next) => {
    log.aviso(req.method, req.originalUrl, '->', erro.message);
    if (res.headersSent) return next(erro);
    res.status(500).json({
        erro: erro.message,
        dica: /tempo esgotado/i.test(erro.message)
            ? 'Poucos seeds no magnet. Tente outra fonte/qualidade.'
            : undefined
    });
});

module.exports = rotas;
