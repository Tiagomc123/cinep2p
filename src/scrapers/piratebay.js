'use strict';

const http = require('./_http');
const trackers = require('../trackers');

module.exports = {
  name: 'piratebay',
  label: 'ThePirateBay',
  supports: function () { return true; },
  search: async function (ctx) {
    const term = [ctx.tituloOriginal || ctx.titulo, ctx.ano].filter(Boolean).join(' ');
    if (!term) return [];
    const urls = [
      'https://apibay.org/q.php?q=' + encodeURIComponent(term) + '&cat=200',
      'https://apibay.org/q.php?q=' + encodeURIComponent(term) + '&cat=0'
    ];
    let data = null;
    for (const u of urls) {
      try {
        const parsed = await http.fetchJSON(u);
        if (Array.isArray(parsed) && parsed.length && parsed[0].name !== 'No results returned') { data = parsed; break; }
      } catch (e) { }
    }
    if (!data) return [];
    return data
      .filter(function (x) {
        return x && x.info_hash &&
          x.info_hash !== '0000000000000000000000000000000000000000' &&
          x.name && x.name !== 'No results returned';
      })
      .map(function (x) {
        return {
          title: x.name,
          magnet: trackers.magnetFromHash(x.info_hash, x.name, []),
          hash: x.info_hash,
          quality: http.detectQuality(x.name),
          size: http.humanSize(x.size),
          sizeBytes: Number(x.size || 0),
          seeders: Number(x.seeders || 0),
          fileIdx: null,
          source: 'ThePirateBay'
        };
      })
      .filter(function (x) { return x.seeders > 0; })
      .sort(function (a, b) { return b.seeders - a.seeders; })
      .slice(0, 15);
  }
};