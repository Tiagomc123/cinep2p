'use strict';

const http = require('./_http');

const HOSTS = [
  'https://www.torrent9.to',
  'https://www.torrent9.ac',
  'https://www.torrent9.red',
  'https://www.torrent9.bz',
  'https://www.torrent9.tv'
];

module.exports = {
  name: 'torrent9',
  label: 'Torrent9',
  supports: function () { return true; },
  search: async function (ctx) {
    const term = encodeURIComponent(ctx.tituloOriginal || ctx.titulo || '');
    if (!term) return [];
    const pages = await Promise.all(HOSTS.map(function (h) {
      return http.fetchText(h + '/search?q=' + term).catch(function () { return ''; });
    }));
    const out = [];
    pages.forEach(function (html) {
      if (!html) return;
      http.rowsFromHtml(html, { source: 'Torrent9' }).forEach(function (r) { out.push(r); });
    });
    return out.slice(0, 20);
  }
};