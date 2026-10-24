'use strict';

/**
 * Torrentio - API publica. Quando busca por IMDb ID, o resultado E do filme
 * exato, entao marca imdbConfirmado (pula o filtro de titulo).
 * O fallback por string NAO marca, pois pode trazer homonimos.
 */

const http = require('./_http');
const trackers = require('../trackers');

const BASE = 'https://torrentio.strem.fun';

function trackersDe(sources) {
  const saida = [];
  (sources || []).forEach(function (s) {
    const str = String(s);
    if (str.indexOf('tracker:') === 0) saida.push(str.slice('tracker:'.length));
  });
  return saida;
}

function mapearStreams(streams, confirmado) {
  return (streams || []).map(function (s) {
    const titulo = s.title || '';
    const seedMatch = /👤\s*(\d+)/.exec(titulo);
    const sizeMatch = /💾\s*([\d.,]+\s*[KMGT]i?B)/i.exec(titulo);
    const provider = String(s.name || '').split('\n').pop().trim();
    const label = titulo.split('\n')[0].trim() || provider;
    const hash = s.infoHash || null;
    return {
      title: label,
      magnet: hash ? trackers.magnetFromHash(hash, label, trackersDe(s.sources)) : null,
      hash: hash,
      quality: http.detectQuality(label) || http.detectQuality(titulo),
      size: sizeMatch ? sizeMatch[1].replace(/\s+/g, ' ') : '',
      sizeBytes: 0,
      seeders: seedMatch ? Number(seedMatch[1]) : 0,
      fileIdx: typeof s.fileIdx === 'number' ? s.fileIdx : null,
      imdbConfirmado: !!confirmado,
      source: 'Torrentio'
    };
  }).filter(function (s) { return !!s.magnet; });
}

async function porImdb(ctx) {
  if (!ctx.imdbId) return [];
  const caminho = ctx.tipo === 'tv'
    ? 'series/' + ctx.imdbId + ':' + (ctx.temporada || 1) + ':' + (ctx.episodio || 1)
    : 'movie/' + ctx.imdbId;
  const data = await http.fetchJSON(BASE + '/stream/' + caminho + '.json');
  return mapearStreams(data && data.streams, true);
}

async function porString(ctx) {
  const termo = ctx.query || [ctx.tituloOriginal || ctx.titulo, ctx.ano].filter(Boolean).join(' ');
  if (!termo) return [];
  const tipo = ctx.tipo === 'tv' ? 'series' : 'movie';
  const urls = [
    BASE + '/catalog/' + tipo + '/torrentio-search=' + encodeURIComponent(termo) + '.json',
    BASE + '/catalog/' + tipo + '/torrentio-search%3D' + encodeURIComponent(termo) + '.json'
  ];
  let metas = null;
  for (const u of urls) {
    try {
      const data = await http.fetchJSON(u);
      if (data && data.metas && data.metas.length) { metas = data.metas; break; }
    } catch (e) { }
  }
  if (!metas) return [];

  const alvo = metas.slice(0, 3).map(function (m) { return m.id; }).filter(Boolean);
  const listas = await Promise.all(alvo.map(function (id) {
    const caminho = ctx.tipo === 'tv'
      ? 'series/' + id + ':' + (ctx.temporada || 1) + ':' + (ctx.episodio || 1)
      : 'movie/' + id;
    return http.fetchJSON(BASE + '/stream/' + caminho + '.json')
      .then(function (d) { return mapearStreams(d && d.streams, false); })
      .catch(function () { return []; });
  }));

  const saida = [];
  listas.forEach(function (l) { l.forEach(function (i) { saida.push(i); }); });
  return saida;
}

module.exports = {
  name: 'torrentio',
  label: 'Torrentio',
  nacional: false,
  supports: function () { return true; },
  search: async function (ctx) {
    const porId = await porImdb(ctx).catch(function () { return []; });
    if (porId.length) return porId.slice(0, 40);
    return (await porString(ctx)).slice(0, 40);
  }
};