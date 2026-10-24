'use strict';

const http = require('./_http');

const HOST = 'https://lapumia.com';

module.exports = {
  name: 'lapumia',
  label: 'Lapumia',
  supports: function () { return true; },
  search: async function (ctx) {
    const term = encodeURIComponent(ctx.tituloOriginal || ctx.titulo || '');
    if (!term) return [];
    const urls = [
      HOST + '/buscar?q=' + term,
      HOST + '/?s=' + term,
      HOST + '/search?q=' + term
    ];
    const pages = await Promise.all(urls.map(function (u) {
      return http.fetchText(u).catch(function () { return ''; });
    }));
    const out = [];
    pages.forEach(function (html) {
      if (!html) return;
      http.rowsFromHtml(html, { source: 'Lapumia' }).forEach(function (r) { out.push(r); });
    });
    return out.slice(0, 20);
  }
};