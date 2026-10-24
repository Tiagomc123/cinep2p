'use strict';

const {
    construirFonteHtml,
    construirFonteJson,
    lerCardsPadrao
} = require('./generic');
const { montarMagnet, infoHashDe } = require('../util/magnet');
const { limparTitulo, parseBytes } = require('../util/text');

/* ---------------------------------------------------------------------------
   Fontes HTML PT-BR
   Cada fonte declara uma lista de bases (TLDs mudam com frequencia) e o motor
   tenta em cascata ate obter uma resposta com resultados.
--------------------------------------------------------------------------- */

const comandotorrents = construirFonteHtml({
    id: 'comandotorrents',
    nome: 'Comando Torrents',
    bases: [
        'https://comandotorrents.com',
        'https://comandotorrents.tv',
        'https://comandotorrents.com.br'
    ],
    categoriaPadrao: 'filmes',
    confiabilidade: 88,
    montarBusca: (base, termo) => base + '/?s=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'article, .item, .post, .resultado',
        link: 'h2 a, h3 a, .entry-title a, a[rel="bookmark"], .titulo a'
    }),
    lerDetalhe: ($, ctx) => ({
        poster: ($('meta[property="og:image"]').attr('content') || $('.poster img, .capa img, .thumb img').first().attr('src')) || null,
        sinopse: ($('meta[property="og:description"]').attr('content') || $('.sinopse, .resumo, .entry-content p').first().text() || '').trim()
    })
});

const torrentdosfilmes = construirFonteHtml({
    id: 'torrentdosfilmes',
    nome: 'Torrent dos Filmes',
    bases: [
        'https://torrentdosfilmes.tv',
        'https://torrentdosfilmes.com.br',
        'https://torrentdosfilmes.com'
    ],
    categoriaPadrao: 'filmes',
    confiabilidade: 84,
    montarBusca: (base, termo) => base + '/?s=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'article, .item, .post, .box-filme, .resultado',
        link: 'h2 a, h3 a, .entry-title a, .titulo a'
    }),
    lerDetalhe: ($, ctx) => ({
        poster: ($('meta[property="og:image"]').attr('content') || $('.poster img, .capa img').first().attr('src')) || null,
        sinopse: ($('meta[property="og:description"]').attr('content') || '').trim()
    })
});

const bludv = construirFonteHtml({
    id: 'bludv',
    nome: 'BluDV',
    bases: ['https://bludv.tv', 'https://bludv.xyz', 'https://www.bludv.tv'],
    categoriaPadrao: 'filmes',
    confiabilidade: 82,
    montarBusca: (base, termo) => base + '/?s=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'article, .item, .post, .movie, .resultado',
        link: 'h2 a, h3 a, .entry-title a, .title a'
    }),
    lerDetalhe: ($, ctx) => ({
        poster: ($('meta[property="og:image"]').attr('content') || $('.poster img').first().attr('src')) || null,
        sinopse: ($('meta[property="og:description"]').attr('content') || '').trim()
    })
});

const redetorrent = construirFonteHtml({
    id: 'redetorrent',
    nome: 'Rede Torrent',
    bases: ['https://redetorrent.com', 'https://www.redetorrent.com'],
    categoriaPadrao: 'filmes',
    confiabilidade: 74,
    montarBusca: (base, termo) => base + '/?s=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'article, .item, .post, .resultado',
        link: 'h2 a, h3 a, .entry-title a'
    })
});

const bjshare = construirFonteHtml({
    id: 'bjshare',
    nome: 'BJ-Share',
    bases: ['https://bj-share.info', 'https://bj-share.com'],
    categoriaPadrao: 'filmes',
    confiabilidade: 92,
    timeout: 18000,
    montarBusca: (base, termo) =>
        base + '/torrents.php?searchstr=' + encodeURIComponent(termo) + '&order_by=seeders&order_way=desc&filter=all',
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'table.torrent_table tr, tr.torrent_row, .torrent_row, .torrent, table#torrent_table tr',
        link: 'a[href*="torrents.php?id="], a.torrent-name, h3 a'
    }),
    lerDetalhe: ($, ctx) => ({
        poster: ($('#poster img, .poster img').first().attr('src') || null)
    })
});

/* ---------------------------------------------------------------------------
   Fontes especializadas por nicho
--------------------------------------------------------------------------- */

const animestorrent = construirFonteHtml({
    id: 'animestorrent',
    nome: 'AnimesTorrent',
    bases: ['https://animestorrent.com', 'https://www.animestorrent.com', 'https://animestorrent.tv'],
    categoriaPadrao: 'animes',
    confiabilidade: 80,
    montarBusca: (base, termo) => base + '/?s=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'article, .item, .post, .anime, .resultado',
        link: 'h2 a, h3 a, .entry-title a, .titulo a'
    })
});

const animetorrents = construirFonteHtml({
    id: 'animetorrents',
    nome: 'Anime Torrents',
    bases: ['https://animetorrents.me', 'https://www.animetorrents.me'],
    categoriaPadrao: 'animes',
    confiabilidade: 68,
    montarBusca: (base, termo) => base + '/torrents-search.php?search=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'table tr, .item, .resultado',
        link: 'a[href*="details.php?id="], a[href*="torrent"]'
    })
});

const doramastorrent = construirFonteHtml({
    id: 'doramastorrent',
    nome: 'Doramas Torrent',
    bases: [
        'https://doramastorrent.com',
        'https://www.doramastorrent.com',
        'https://doramasytorrents.com'
    ],
    categoriaPadrao: 'doramas',
    confiabilidade: 70,
    montarBusca: (base, termo) => base + '/?s=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'article, .item, .post, .resultado',
        link: 'h2 a, h3 a, .entry-title a'
    })
});

const novelastorrent = construirFonteHtml({
    id: 'novelastorrent',
    nome: 'Novelas Torrent',
    bases: [
        'https://novelastorrent.com',
        'https://www.novelastorrent.com',
        'https://novelasbr.net'
    ],
    categoriaPadrao: 'novelas',
    confiabilidade: 66,
    montarBusca: (base, termo) => base + '/?s=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'article, .item, .post, .resultado',
        link: 'h2 a, h3 a, .entry-title a'
    })
});

/* ---------------------------------------------------------------------------
   Fontes internacionais com bom indice de releases DUPLO AUDIO / PT-BR
--------------------------------------------------------------------------- */

const apibay = construirFonteJson({
    id: 'apibay',
    nome: 'The Pirate Bay (API)',
    bases: ['https://apibay.org'],
    cabecalhos: { Accept: 'application/json', Referer: 'https://thepiratebay.org/' },
    categoriaPadrao: 'filmes',
    confiabilidade: 72,
    montarBusca: (base, termo) => base + '/q.php?q=' + encodeURIComponent(termo) + '&cat=0',
    lerLista: (dados, ctx) => {
        if (!Array.isArray(dados)) return [];
        return dados
            .filter((x) => x && x.info_hash && x.info_hash !== '0000000000000000000000000000000000000000')
            .map((x) => ({
                titulo: limparTitulo(x.name),
                tituloBruto: x.name,
                infoHash: String(x.info_hash).toLowerCase(),
                seeds: parseInt(x.seeders, 10) || 0,
                leechers: parseInt(x.leechers, 10) || 0,
                tamanhoBytes: parseInt(x.size, 10) || 0,
                magnet: montarMagnet(x.info_hash, x.name),
                base: ctx.base,
                urlFonte: ctx.url
            }));
    }
});

const yts = construirFonteJson({
    id: 'yts',
    nome: 'YTS',
    bases: ['https://yts.lt', 'https://yts.rs', 'https://yts.mx'],
    categoriaPadrao: 'filmes',
    confiabilidade: 76,
    montarBusca: (base, termo) =>
        base + '/api/v2/list_movies.json?limit=20&query_term=' + encodeURIComponent(termo),
    lerLista: (dados, ctx) => {
        const filmes = dados && dados.data && Array.isArray(dados.data.movies) ? dados.data.movies : [];
        const itens = [];
        for (const filme of filmes) {
            for (const t of filme.torrents || []) {
                itens.push({
                    titulo: limparTitulo(filme.title_long || filme.title) + ' ' + (t.quality || '') + ' ' + (t.type || ''),
                    tituloBruto: filme.title_long || filme.title,
                    infoHash: String(t.hash || '').toLowerCase(),
                    seeds: parseInt(t.seeds, 10) || 0,
                    leechers: parseInt(t.peers, 10) || 0,
                    tamanhoBytes: parseBytes(t.size),
                    poster: filme.medium_cover_image || filme.large_cover_image || null,
                    sinopse: filme.summary || '',
                    ano: filme.year ? String(filme.year) : null,
                    magnet: montarMagnet(t.hash, filme.title_long || filme.title),
                    base: ctx.base,
                    urlFonte: ctx.url
                });
            }
        }
        return itens;
    }
});

const FONTES = [
    comandotorrents,
    torrentdosfilmes,
    bludv,
    bjshare,
    redetorrent,
    animestorrent,
    animetorrents,
    doramastorrent,
    novelastorrent,
    apibay,
    yts
];

module.exports = { FONTES };