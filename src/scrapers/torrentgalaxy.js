'use strict';

const http = require('./_http');

const HOSTS = [
  'https://torrentgalaxy.to',
  'https://torrentgalaxy.mx',
  'https://tgx.rs',
  'https://torrentgalaxy.pm'
];

module.exports = {
  name: 'torrentgalaxy',
  label: 'TorrentGalaxy',
  supports: function () { return true; },
  search: async function (ctx) {
    const term = encodeURIComponent(ctx.tituloOriginal || ctx.titulo || '');
    if (!term) return [];
    const pages = await Promise.all(HOSTS.map(function (h) {
      return http.fetchText(h + '/torrents.php?search=' + term + '&sort=seeders&order=desc')
        .catch(function () { return ''; });
    }));
    const out = [];
    pages.forEach(function (html) {
      if (!html) return;
      http.rowsFromHtml(html, { source: 'TorrentGalaxy' }).forEach(function (r) { out.push(r); });
    });
    return out.slice(0, 20);
  }
};