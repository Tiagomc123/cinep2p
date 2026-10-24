'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { criar } = require('./../util/logger');
const { TRACKERS_PADRAO, infoHashDe, montarMagnet } = require('../util/magnet');
const ff = require('../util/ffmpeg');

const log = criar('webtorrent');

const EXTENSOES_VIDEO = ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.mpg', '.mpeg', '.ts', '.flv', '.ogv'];

let ModuloWebTorrent = null;
let cliente = null;
let temporizador = null;
let encerrando = false;

const ativos = new Map();

async function carregarWebTorrent() {
    if (ModuloWebTorrent) return ModuloWebTorrent;
    const mod = await import('webtorrent');
    ModuloWebTorrent = mod && mod.default ? mod.default : mod && mod.WebTorrent ? mod.WebTorrent : mod;
    return ModuloWebTorrent;
}

async function obterCliente() {
    if (cliente) return cliente;
    const WebTorrent = await carregarWebTorrent();

    fs.mkdirSync(config.TORRENT_DIR, { recursive: true });

    cliente = new WebTorrent({
        maxConns: 90,
        dht: true,
        tracker: true,
        lsd: true,
        utp: true
    });

    cliente.on('error', (erro) => log.aviso('erro no cliente:', erro.message));

    temporizador = setInterval(() => {
        varrer().catch((e) => log.debug('varredura:', e.message));
    }, 15000);

    log.info('cliente WebTorrent iniciado (max ativos = ' + config.MAX_TORRENTS_ATIVOS + ')');
    return cliente;
}

function montarMagnetSeguro(entrada) {
    const hash = infoHashDe(entrada);
    if (!hash) return null;
    if (String(entrada).startsWith('magnet:')) {
        return /tr=/.test(entrada) ? entrada : montarMagnet(hash);
    }
    return montarMagnet(hash);
}

function escolherArquivo(torrent) {
    const arquivos = torrent.files || [];
    if (!arquivos.length) return null;

    const videos = arquivos.filter((f) => EXTENSOES_VIDEO.includes(path.extname(f.name).toLowerCase()));
    const lista = videos.length ? videos : arquivos;

    const pontuar = (arquivo) => {
        let peso = arquivo.length;
        const nome = arquivo.name.toLowerCase();
        if (/1080p/.test(nome)) peso *= 1.7;
        else if (/720p/.test(nome)) peso *= 1.45;
        if (/(sample|trailer|extra|featurette)/.test(nome)) peso *= 0.3;
        if (/(\bs\d{1,2}e\d{1,2}\b)/.test(nome) && lista.length > 4) peso *= 0.85;
        return peso;
    };

    return lista.slice().sort((a, b) => pontuar(b) - pontuar(a))[0];
}

function removerPasta(caminho) {
    return new Promise((resolver) => {
        const tentar = (n) => {
            try {
                fs.rmSync(caminho, { recursive: true, force: true });
                resolver(true);
            } catch (_) {
                if (n <= 0) return resolver(false);
                setTimeout(() => tentar(n - 1), 350);
            }
        };
        tentar(5);
    });
}

function tamanhoPasta(caminho, profundidade) {
    const nivel = profundidade == null ? 0 : profundidade;
    if (nivel > 6) return 0;
    let total = 0;
    let entradas = [];
    try {
        entradas = fs.readdirSync(caminho, { withFileTypes: true });
    } catch (_) {
        return 0;
    }
    for (const entrada of entradas) {
        const completo = path.join(caminho, entrada.name);
        try {
            if (entrada.isDirectory()) total += tamanhoPasta(completo, nivel + 1);
            else total += fs.statSync(completo).size;
        } catch (_) { /* ignorado */ }
    }
    return total;
}

async function destruir(infoHash) {
    const registro = ativos.get(infoHash);
    if (!registro) return false;
    ativos.delete(infoHash);

    await new Promise((resolver) => {
        let pronto = false;
        const finalizar = () => {
            if (pronto) return;
            pronto = true;
            resolver();
        };
        try {
            registro.torrent.destroy({ destroyStore: true }, finalizar);
        } catch (_) {
            finalizar();
        }
        setTimeout(finalizar, 5000);
    });

    await removerPasta(path.join(config.TORRENT_DIR, infoHash));
    log.info('despejado do cache:', infoHash.slice(0, 12));
    return true;
}

async function liberarEspaco() {
    while (ativos.size >= config.MAX_TORRENTS_ATIVOS) {
        const ordenados = [...ativos.values()].sort((a, b) => a.ultimoAcesso - b.ultimoAcesso);
        const alvo = ordenados[0];
        if (!alvo) break;
        await destruir(alvo.infoHash);
    }

    const limiteBytes = config.MAX_CACHE_GB * (1024 ** 3);
    if (limiteBytes > 0 && tamanhoPasta(config.TORRENT_DIR) > limiteBytes) {
        const ordenados = [...ativos.values()].sort((a, b) => a.ultimoAcesso - b.ultimoAcesso);
        for (const alvo of ordenados) {
            await destruir(alvo.infoHash);
            if (tamanhoPasta(config.TORRENT_DIR) <= limiteBytes) break;
        }
    }
}

async function varrer() {
    if (encerrando) return;
    const agora = Date.now();
    const limiteOciosidade = config.TORRENT_IDLE_MIN * 60 * 1000;

    for (const registro of [...ativos.values()]) {
        const ocioso = agora - registro.ultimoAcesso;
        const concluido = registro.torrent.progress >= 0.999;
        if (ocioso > limiteOciosidade && (concluido || ocioso > limiteOciosidade * 2)) {
            await destruir(registro.infoHash);
        }
    }

    if (ativos.size === 0) {
        await liberarEspaco();
    }
}

async function abrir(entrada, opcoes) {
    const opt = opcoes || {};
    const infoHash = infoHashDe(entrada);
    if (!infoHash) throw new Error('magnet ou infohash invalido');

    const existente = ativos.get(infoHash);
    if (existente) {
        existente.ultimoAcesso = Date.now();
        return existente;
    }

    await liberarEspaco();

    const cli = await obterCliente();
    const magnet = montarMagnetSeguro(entrada);
    const pasta = path.join(config.TORRENT_DIR, infoHash);
    const prazo = opt.timeoutMs || 75000;

    const torrent = await new Promise((resolver, rejeitar) => {
        let finalizado = false;

        const finalizar = (fn, valor) => {
            if (finalizado) return;
            finalizado = true;
            clearTimeout(timer);
            fn(valor);
        };

        const instancia = cli.add(
            magnet,
            {
                path: pasta,
                announce: TRACKERS_PADRAO,
                destroyStoreOnDestroy: true
            },
            (t) => finalizar(resolver, t || instancia)
        );

        const timer = setTimeout(() => {
            if (finalizado) return;
            try { instancia.destroy({ destroyStore: true }); } catch (_) { /* noop */ }
            finalizar(rejeitar, new Error('tempo esgotado buscando peers/metadados (' + Math.round(prazo / 1000) + 's)'));
        }, prazo);

        instancia.on('error', (erro) => finalizar(rejeitar, erro));
        instancia.on('warning', (aviso) => log.debug('aviso torrent:', aviso && aviso.message));
    });

    const arquivo = escolherArquivo(torrent);
    if (!arquivo) {
        try { torrent.destroy({ destroyStore: true }); } catch (_) { /* noop */ }
        throw new Error('nenhum arquivo reproduzivel encontrado no torrent');
    }

    const registro = {
        infoHash,
        torrent,
        arquivo,
        indiceArquivo: torrent.files.indexOf(arquivo),
        criadoEm: Date.now(),
        ultimoAcesso: Date.now(),
        nome: torrent.name
    };

    ativos.set(infoHash, registro);

    try {
        torrent.files.forEach((f) => { if (f !== arquivo) f.deselect(); });
        arquivo.select();
    } catch (_) { /* noop */ }

    log.info('torrent ativo:', infoHash.slice(0, 12), '-', torrent.name, '(' + torrent.files.length + ' arquivos)');
    return registro;
}

async function aguardarMinimo(registro, bytesMinimos, prazoMs) {
    const alvo = Math.min(bytesMinimos, registro.arquivo.length);
    const limite = Date.now() + (prazoMs || 45000);

    while (Date.now() < limite) {
        if (registro.torrent.downloaded >= alvo || registro.torrent.progress >= 0.02) return true;
        if (registro.torrent.numPeers === 0 && Date.now() > limite - 20000) return false;
        await new Promise((r) => setTimeout(r, 400));
    }
    return registro.torrent.downloaded > 0;
}

function estatisticas(infoHash) {
    const registro = ativos.get(infoHash);
    if (!registro) return null;
    const t = registro.torrent;
    return {
        infoHash,
        nome: t.name,
        peers: t.numPeers,
        progresso: Math.round((t.progress || 0) * 10000) / 100,
        baixado: t.downloaded,
        tamanho: t.length,
        velocidadeDown: t.downloadSpeed,
        velocidadeUp: t.uploadSpeed,
        restanteSeg: t.timeRemaining,
        ativo: true
    };
}

function listarAtivos() {
    return [...ativos.values()].map((r) => ({
        infoHash: r.infoHash,
        nome: r.nome,
        arquivo: r.arquivo.name,
        ociosoSeg: Math.round((Date.now() - r.ultimoAcesso) / 1000),
        progresso: Math.round((r.torrent.progress || 0) * 10000) / 100,
        peers: r.torrent.numPeers
    }));
}

async function limparTudo() {
    for (const hash of [...ativos.keys()]) {
        await destruir(hash);
    }
    await removerPasta(config.TORRENT_DIR);
    fs.mkdirSync(config.TORRENT_DIR, { recursive: true });
    return true;
}

function caminhoArquivo(registro, indice) {
    const arquivo = indice == null ? registro.arquivo : registro.torrent.files[indice];
    if (!arquivo) return null;
    return path.join(registro.torrent.path || path.join(config.TORRENT_DIR, registro.infoHash), arquivo.path);
}

function encerrar() {
    encerrando = true;
    if (temporizador) clearInterval(temporizador);
    if (cliente) {
        try { cliente.destroy(); } catch (_) { /* noop */ }
    }
    cliente = null;
    ativos.clear();
}

module.exports = {
    EXTENSOES_VIDEO,
    abrir,
    destruir,
    varrer,
    aguardarMinimo,
    estatisticas,
    listarAtivos,
    limparTudo,
    caminhoArquivo,
    encerrar,
    ff
};