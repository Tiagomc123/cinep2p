'use strict';

const http = require('./_http');
const trackers = require('../trackers');

module.exports = {
  name: 'yts',
  label: 'YTS',
  supports: function (ctx) { return ctx.tipo === 'movie'; },
  search: async function (ctx) {
    const term = ctx.imdbId || [ctx.tituloOriginal || ctx.titulo, ctx.ano].filter(Boolean).join(' ');
    if (!term) return [];
    const data = await http.fetchJSON('https://yts.mx/api/v2/list_movies.json?limit=6&query_term=' + encodeURIComponent(term));
    const movies = (data && data.data && data.data.movies) || [];
    const match = movies.filter(function (m) { return ctx.imdbId && m.imdb_code === ctx.imdbId; })[0] || movies[0];
    if (!match) return [];
    return (match.torrents || []).map(function (t) {
      const nome = match.title + ' ' + match.year + ' ' + t.quality;
      return {
        title: match.title + ' (' + match.year + ') ' + t.quality + ' ' + (t.type || ''),
        magnet: trackers.magnetFromHash(t.hash, nome, []),
        hash: t.hash,
        quality: http.detectQuality(t.quality) || t.quality || '',
        size: t.size || '',
        sizeBytes: http.parseSize(t.size).bytes,
        seeders: Number(t.seeds || 0),
        fileIdx: null,
        source: 'YTS'
      };
    });
  }
};