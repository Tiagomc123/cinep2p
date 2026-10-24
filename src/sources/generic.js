'use strict';

const cheerio = require('cheerio');
const http = require('../util/http');
const { absolutizar, decodificarEntidades, limparTitulo, parseBytes, truncar } = require('../util/text');
const { infoHashDe, montarMagnet, TRACKERS_PADRAO } = require('../util/magnet');

const RE_MAGNET = /magnet:\?xt=urn:btih:[0-9a-zA-Z]{32,40}[^"'\s<>\\]*/g;

const SELETOR_CARDS = 'article, .post, .item, .card, .resultado, .result, li.post, .box, .entry, .torrent, tr.torrent_row';

const SELETOR_LINK = [
    'h1 a', 'h2 a', 'h3 a', 'h4 a',
    '.entry-title a', '.titulo a', '.title a', '.nome a',
    'a[rel="bookmark"]', 'a.torrent-name', 'a.lnk', 'a[href*="torrents.php?id="]'
].join(', ');

const SELETOR_POSTER = 'img';

function carregar(htmlTexto) {
    return cheerio.load(String(htmlTexto || ''), { decodeEntities: true });
}

function extrairMagnets(htmlTexto, base) {
    const achados = new Map();
    const texto = String(htmlTexto || '');
    let m;
    RE_MAGNET.lastIndex = 0;
    while ((m = RE_MAGNET.exec(texto)) !== null) {
        const bruto = decodificarEntidades(m[0]).replace(/['"]+$/, '');
        const hash = infoHashDe(bruto);
        if (!hash) continue;
        if (!achados.has(hash)) {
            achados.set(hash, montarMagnet(hash, null) || bruto);
        }
    }
    return [...achados.values()];
}

function extrairArquivosTorrent(htmlTexto, base) {
    const $ = carregar(htmlTexto);
    const achados = new Set();
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        if (!/\.torrent(\?|$)/i.test(href)) return;
        const url = absolutizar(href, base);
        if (url) achados.add(url);
    });
    return [...achados];
}

function metaOg($, base, propriedade) {
    const valor =
        $(`meta[property="${propriedade}"]`).attr('content') ||
        $(`meta[name="${propriedade}"]`).attr('content') ||
        $(`meta[name="twitter:image"]`).attr('content');
    return valor ? absolutizar(valor, base) : null;
}

function lerCardsPadrao($, ctx, opcoes) {
    const opt = opcoes || {};
    const seletorItem = opt.item || SELETOR_CARDS;
    const seletorLink = opt.link || SELETOR_LINK;
    const itens = [];

    $(seletorItem).each((_, el) => {
        const $el = $(el);
        const $a = $el.find(seletorLink).first().length ? $el.find(seletorLink).first() : $el.find('a[href]').first();
        const href = $a.attr('href');
        if (!href || /^(#|javascript:)/i.test(href)) return;

        let titulo = ($a.attr('title') || $a.text() || '').replace(/\s+/g, ' ').trim();
        if (!titulo || titulo.length < 3) {
            titulo = ($el.find('.entry-title, .titulo, .title, h2, h3').first().text() || '').replace(/\s+/g, ' ').trim();
        }
        if (!titulo || titulo.length < 3) return;

        const $img = $el.find(opt.img || SELETOR_POSTER).first();
        const posterBruto =
            $img.attr('src') ||
            $img.attr('data-src') ||
            $img.attr('data-lazy-src') ||
            $img.attr('data-original') ||
            $el.find('img').first().attr('src');

        const $magnet = $el.find('a[href^="magnet:"]').first();

        itens.push({
            titulo: limparTitulo(titulo),
            tituloBruto: titulo,
            detalheUrl: absolutizar(href, ctx.base),
            poster: posterBruto ? absolutizar(posterBruto, ctx.base) : null,
            sinopse: truncar($el.find('p').first().text(), 400),
            tamanhoBytes: parseBytes($el.text()),
            seeds: parseInt((/(\d+)\s*(?:seed|seeds|sementes|s\b)/i.exec($el.text()) || [])[1], 10) || 0,
            magnet: $magnet.length ? decodificarEntidades($magnet.attr('href')) : null,
            base: ctx.base,
            urlFonte: ctx.url
        });
    });

    return itens;
}

function construirFonteHtml(cfg) {
    return {
        id: cfg.id,
        nome: cfg.nome,
        tipo: 'html',
        categoriaPadrao: cfg.categoriaPadrao || 'filmes',
        confiabilidade: cfg.confiabilidade == null ? 50 : cfg.confiabilidade,
        bases: cfg.bases.slice(),
        timeout: cfg.timeout || 15000,

        async buscar(termo, opcoes) {
            const opt = opcoes || {};
            const limite = opt.limite || 20;
            const falhas = [];

            for (const base of this.bases) {
                try {
                    const url = cfg.montarBusca(base, termo);
                    const htmlTexto = await http.html(url, {
                        referer: base,
                        timeout: cfg.timeout,
                        tentativas: 1
                    });
                    const $ = carregar(htmlTexto);
                    const itens = (cfg.lerLista($, { base, url, termo }) || [])
                        .filter((i) => i && i.titulo)
                        .slice(0, limite);

                    if (!itens.length) {
                        falhas.push(base + ': 0 resultados');
                        continue;
                    }
                    return { base, url, itens };
                } catch (erro) {
                    falhas.push(base + ': ' + erro.message);
                }
            }

            throw new Error('bases indisponiveis -> ' + falhas.join(' | '));
        },

        async resolver(item) {
            if (!item) return { magnets: [], torrents: [] };
            if (item.magnet && !item.detalheUrl) {
                return { magnets: [item.magnet], torrents: [] };
            }

            const alvo = item.detalheUrl || item.magnet;
            const htmlTexto = await http.html(alvo, { referer: item.base, timeout: cfg.timeout, tentativas: 1 });

            let magnets = extrairMagnets(htmlTexto, alvo);
            let torrents = extrairArquivosTorrent(htmlTexto, alvo);

            const $ = carregar(htmlTexto);

            if (cfg.lerDetalhe) {
                const extra = cfg.lerDetalhe($, { base: item.base, url: alvo }) || {};
                if (Array.isArray(extra.magnets)) magnets = magnets.concat(extra.magnets);
                if (Array.isArray(extra.torrents)) torrents = torrents.concat(extra.torrents);
                if (extra.poster && !item.poster) item.poster = extra.poster;
                if (extra.sinopse && !item.sinopse) item.sinopse = extra.sinopse;
                if (extra.ano && !item.ano) item.ano = extra.ano;
            }

            if (!item.poster) item.poster = metaOg($, item.base, 'og:image');
            if (!item.sinopse) item.sinopse = truncar(metaOg($, item.base, 'og:description') || $('meta[name="description"]').attr('content'), 400);
            if (!item.ano) item.ano = (/(19|20)\d{2}/.exec($('title').text() || '') || [null])[0];

            const unicos = new Map();
            for (const m of magnets) {
                const hash = infoHashDe(m);
                if (hash && !unicos.has(hash)) unicos.set(hash, montarMagnet(hash, item.tituloBruto || item.titulo) || m);
            }

            return { magnets: [...unicos.values()], torrents: [...new Set(torrents)] };
        }
    };
}

function construirFonteJson(cfg) {
    return {
        id: cfg.id,
        nome: cfg.nome,
        tipo: 'json',
        categoriaPadrao: cfg.categoriaPadrao || 'filmes',
        confiabilidade: cfg.confiabilidade == null ? 50 : cfg.confiabilidade,
        bases: cfg.bases.slice(),

        async buscar(termo, opcoes) {
            const limite = (opcoes && opcoes.limite) || 20;
            const falhas = [];

            for (const base of this.bases) {
                try {
                    const url = cfg.montarBusca(base, termo);
                    const dados = await http.json(url, Object.assign({ referer: base, tentativas: 1 }, cfg.cabecalhos ? { headers: cfg.cabecalhos } : {}));
                    const itens = (cfg.lerLista(dados, { base, url, termo }) || []).slice(0, limite);
                    if (!itens.length) {
                        falhas.push(base + ': 0 resultados');
                        continue;
                    }
                    return { base, url, itens };
                } catch (erro) {
                    falhas.push(base + ': ' + erro.message);
                }
            }
            throw new Error('bases indisponiveis -> ' + falhas.join(' | '));
        },

        async resolver(item) {
            if (item && item.magnet) return { magnets: [item.magnet], torrents: [] };
            return { magnets: [], torrents: [] };
        }
    };
}

module.exports = {
    construirFonteHtml,
    construirFonteJson,
    lerCardsPadrao,
    extrairMagnets,
    extrairArquivosTorrent,
    metaOg,
    carregar,
    TRACKERS_PADRAO
};