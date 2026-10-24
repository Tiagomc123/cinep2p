'use strict';

const http = require('./_http');

const HOSTS = ['https://1337x.to', 'https://1337x.st', 'https://x1337x.ws', 'https://1337x.gd'];

module.exports = {
  name: 'x1337',
  label: '1337x',
  supports: function () { return true; },
  search: async function (ctx) {
    const term = encodeURIComponent(ctx.tituloOriginal || ctx.titulo || '');
    if (!term) return [];
    const results = await Promise.all(HOSTS.map(function (h) {
      const pattern = 'href="(' + h.replace(/\./g, '\\.') + '/torrent/[^"]+)"';
      return http.deepSearch(h + '/search/' + term + '/1/', pattern, 3, '1337x')
        .catch(function () { return []; });
    }));
    const out = [];
    results.forEach(function (rows) { rows.forEach(function (r) { out.push(r); }); });
    return out.slice(0, 20);
  }
};