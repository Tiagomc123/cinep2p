'use strict';

const http = require('./_http');

const BASE = 'https://commandotorrents.net';

module.exports = {
  name: 'commandotorrents',
  label: 'Commandotorrents',
  supports: function () { return true; },
  search: async function (ctx) {
    const term = encodeURIComponent(ctx.tituloOriginal || ctx.titulo || '');
    if (!term) return [];
    const candidatos = [
      BASE + '/?s=' + term,
      BASE + '/torrents/search/?search=' + term
    ];
    let rows = [];
    for (const url of candidatos) {
      try {
        rows = await http.deepSearch(url, 'href="(' + BASE.replace(/\./g, '\\.') + '/[^"?#]+)"', 4, 'Commandotorrents');
        if (rows.length) break;
      } catch (e) { }
    }
    return rows.slice(0, 20);
  }
};