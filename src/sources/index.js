'use strict';

const { FONTES } = require('./sites');
const config = require('../config');
const { mapLimit, comPrazo } = require('../util/pool');
const { criar } = require('../util/logger');
const http = require('../util/http');
const {
    detectarIdioma,
    detectarQualidade,
    detectarCategoria,
    chaveDedupe,
    limparTitulo
} = require('../util/text');
const { infoHashDe, montarMagnet, validarInfoHash } = require('../util/magnet');

const log = criar('fontes');

const cacheBuscas = new Map();
const cacheStatus = { em: 0, dados: null };

function fontesAtivas() {
    return FONTES.filter((f) => !config.FONTES_OFF.includes(f.id));
}

function fontePorId(id) {
    return FONTES.find((f) => f.id === id) || null;
}

function pontuar(item) {
    const texto = [item.titulo, item.tituloBruto, item.sinopse].filter(Boolean).join(' ');
    const idioma = detectarIdioma(texto);
    const qualidade = detectarQualidade(texto);

    let pontos = 0;
    pontos += Math.min(Number(item.seeds) || 0, 600) * 0.35;
    pontos += idioma.pontos;
    pontos += qualidade.peso;
    pontos += (Number(item.confiabilidade) || 0) * 0.3;

    if (!item.infoHash && !item.magnet) pontos -= 12;
    if (item.magnet && !item.infoHash) pontos -= 4;

    const gb = (Number(item.tamanhoBytes) || 0) / (1024 ** 3);
    if (gb > 0 && gb < 0.15) pontos -= 7;
    if (gb > 70) pontos -= 5;
    if (gb >= 0.7 && gb <= 25) pontos += 5;

    return { pontos: Math.round(pontos * 100) / 100, idioma, qualidade };
}

function normalizarItem(item, fonte, categoriaPedida) {
    const titulo = limparTitulo(item.titulo || item.tituloBruto || '');
    if (!titulo) return null;

    const hash = item.infoHash
        ? String(item.infoHash).toLowerCase()
        : infoHashDe(item.magnet || '');

    const magnet = item.magnet
        ? item.magnet
        : hash
            ? montarMagnet(hash, titulo)
            : null;

    const base = {
        titulo,
        tituloBruto: item.tituloBruto || item.titulo || titulo,
        infoHash: validarInfoHash(hash) ? hash : null,
        magnet,
        seeds: Number(item.seeds) || 0,
        leechers: Number(item.leechers) || 0,
        tamanhoBytes: Number(item.tamanhoBytes) || 0,
        poster: item.poster || null,
        sinopse: item.sinopse || '',
        ano: item.ano || null,
        detalheUrl: item.detalheUrl || null,
        torrentUrl: item.torrentUrl || null,
        base: item.base || null,
        fonte: fonte.id,
        fonteNome: fonte.nome,
        confiabilidade: fonte.confiabilidade,
        categoria: detectarCategoria([titulo, item.sinopse].join(' '), fonte.categoriaPadrao || categoriaPedida)
    };

    const score = pontuar(base);
    base.idioma = score.idioma;
    base.qualidade = score.qualidade.rotulo;
    base.pontuacao = score.pontos;
    base.chave = chaveDedupe(titulo);

    return base;
}

function mesclar(a, b) {
    const melhor = a.pontuacao >= b.pontuacao ? a : b;
    const outro = melhor === a ? b : a;

    melhor.seeds = Math.max(a.seeds, b.seeds);
    melhor.leechers = Math.max(a.leechers, b.leechers);
    melhor.poster = melhor.poster || outro.poster;
    melhor.sinopse = melhor.sinopse || outro.sinopse;
    melhor.ano = melhor.ano || outro.ano;
    melhor.magnet = melhor.magnet || outro.magnet;
    melhor.infoHash = melhor.infoHash || outro.infoHash;
    melhor.torrentUrl = melhor.torrentUrl || outro.torrentUrl;
    melhor.detalheUrl = melhor.detalheUrl || outro.detalheUrl;
    melhor.fontesExtras = [...new Set([...(melhor.fontesExtras || []), outro.fonte])];

    return melhor;
}

function deduplicar(itens) {
    const porHash = new Map();
    const semHash = new Map();

    for (const item of itens) {
        if (item.infoHash) {
            const atual = porHash.get(item.infoHash);
            porHash.set(item.infoHash, atual ? mesclar(atual, item) : item);
        } else {
            const atual = semHash.get(item.chave);
            semHash.set(item.chave, atual ? mesclar(atual, item) : item);
        }
    }

    const hashados = [...porHash.values()];
    const chavesComHash = new Set(
        hashados.flatMap((i) => [i.chave, chaveDedupe(i.titulo)])
    );

    const restantes = [...semHash.values()].filter(
        (i) => !chavesComHash.has(i.chave) || (i.magnet && !i.infoHash)
    );

    return hashados.concat(restantes);
}

async function buscarEmFonte(fonte, termo, opcoes) {
    const inicio = Date.now();
    const limite = (opcoes && opcoes.limitePorFonte) || 18;

    try {
        const resposta = await comPrazo(
            fonte.buscar(termo, { limite }),
            (opcoes && opcoes.timeoutFonte) || 22000,
            'busca ' + fonte.id
        );

        let itens = (resposta.itens || [])
            .map((i) => normalizarItem(Object.assign({}, i, { urlFonte: resposta.url }), fonte, opcoes.categoria))
            .filter(Boolean);

        // Resolve magnet nos detalhes das melhores entradas sem hash direto.
        if (opcoes.resolverMagnet !== false) {
            const pendentes = itens.filter((i) => !i.magnet && i.detalheUrl).slice(0, 8);
            await mapLimit(pendentes, 3, async (item) => {
                try {
                    const detalhe = await comPrazo(
                        fonte.resolver(item),
                        18000,
                        'detalhe ' + fonte.id
                    );
                    const magnet = (detalhe.magnets || [])[0];
                    if (magnet) {
                        item.magnet = magnet;
                        item.infoHash = infoHashDe(magnet);
                    }
                    if (!item.torrentUrl && detalhe.torrents && detalhe.torrents.length) {
                        item.torrentUrl = detalhe.torrents[0];
                    }
                    const rescore = pontuar(item);
                    item.pontuacao = rescore.pontos;
                    item.idioma = rescore.idioma;
                } catch (_) { /* detalhe opcional */ }
            });
            itens = itens.filter((i) => i.magnet || i.detalheUrl);
        }

        return {
            fonte: fonte.id,
            nome: fonte.nome,
            ok: true,
            ms: Date.now() - inicio,
            total: itens.length,
            itens
        };
    } catch (erro) {
        log.aviso('fonte falhou', fonte.id, '-', erro.message);
        return { fonte: fonte.id, nome: fonte.nome, ok: false, ms: Date.now() - inicio, erro: erro.message, total: 0, itens: [] };
    }
}

async function buscar(termo, opcoes) {
    const opt = Object.assign(
        {
            categoria: 'todos',
            limitePorFonte: 18,
            resolverMagnet: true,
            apenasPtBr: config.APENAS_PTBR,
            pagina: 1,
            porPagina: 60
        },
        opcoes || {}
    );

    const consulta = String(termo || '').trim();
    if (!consulta) return { termo: consulta, total: 0, itens: [], fontes: [], categorias: {} };

    const chaveCache = [consulta.toLowerCase(), opt.categoria, opt.apenasPtBr, opt.limitePorFonte].join('|');
    const emCache = cacheBuscas.get(chaveCache);
    if (emCache && Date.now() - emCache.em < config.TTL_BUSCA_MS) {
        return Object.assign({}, emCache.dados, { cache: true });
    }

    const ativas = fontesAtivas();
    const resultados = await mapLimit(ativas, config.FONTES_CONCORRENCIA, (fonte) =>
        buscarEmFonte(fonte, consulta, opt)
    );

    let itens = resultados.flatMap((r) => r.itens || []);
    itens = deduplicar(itens);

    if (opt.categoria && opt.categoria !== 'todos') {
        itens = itens.filter((i) => i.categoria === opt.categoria);
    }

    if (opt.apenasPtBr) {
        const comPtBr = itens.filter((i) => i.idioma && i.idioma.ptbr);
        if (comPtBr.length >= 3) itens = comPtBr;
    }

    itens.sort((a, b) => b.pontuacao - a.pontuacao);

    const porCategoria = {};
    for (const item of itens) {
        porCategoria[item.categoria] = (porCategoria[item.categoria] || 0) + 1;
    }

    const pagina = Math.max(1, Number(opt.pagina) || 1);
    const porPagina = Math.max(1, Number(opt.porPagina) || 60);
    const fatiado = itens.slice((pagina - 1) * porPagina, pagina * porPagina);

    const dados = {
        termo: consulta,
        total: itens.length,
        pagina,
        porPagina,
        totalPaginas: Math.max(1, Math.ceil(itens.length / porPagina)),
        categorias: porCategoria,
        itens: fatiado,
        fontes: resultados.map((r) => ({
            fonte: r.fonte,
            nome: r.nome,
            ok: r.ok,
            ms: r.ms,
            total: r.total,
            erro: r.erro || null
        }))
    };

    cacheBuscas.set(chaveCache, { em: Date.now(), dados });
    if (cacheBuscas.size > 120) {
        const maisAntiga = [...cacheBuscas.entries()].sort((a, b) => a[1].em - b[1].em)[0];
        if (maisAntiga) cacheBuscas.delete(maisAntiga[0]);
    }

    return dados;
}

async function statusFontes(forcar) {
    if (!forcar && cacheStatus.dados && Date.now() - cacheStatus.em < config.TTL_STATUS_MS) {
        return cacheStatus.dados;
    }

    const relatorio = await mapLimit(fontesAtivas(), 6, async (fonte) => {
        const base = fonte.bases[0];
        const teste = await http.ping(base, { tentativas: 0, timeout: 9000 });
        let buscaTeste = null;
        if (true) {
            try {
                const r = await comPrazo(fonte.buscar('dublado', { limite: 3 }), 16000, 'teste');
                buscaTeste = { ok: true, total: (r.itens || []).length };
            } catch (erro) {
                buscaTeste = { ok: false, erro: erro.message };
            }
        }
        return {
            id: fonte.id,
            nome: fonte.nome,
            categoriaPadrao: fonte.categoriaPadrao,
            confiabilidade: fonte.confiabilidade,
            bases: fonte.bases,
            baseTestada: base,
            online: teste.ok || !!(buscaTeste && buscaTeste.ok),
            status: teste.status || null,
            ms: teste.ms,
            erro: teste.erro || null,
            buscaTeste
        };
    });

    const dados = {
        em: new Date().toISOString(),
        total: relatorio.length,
        online: relatorio.filter((r) => r.online).length,
        fontes: relatorio
    };

    cacheStatus.em = Date.now();
    cacheStatus.dados = dados;
    return dados;
}

function limparCache() {
    cacheBuscas.clear();
    cacheStatus.em = 0;
    cacheStatus.dados = null;
}

module.exports = { buscar, statusFontes, fontesAtivas, fontePorId, limparCache, pontuar };