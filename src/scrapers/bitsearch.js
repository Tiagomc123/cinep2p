'use strict';

const http = require('./_http');
const trackers = require('../trackers');

module.exports = {
  name: 'bitsearch',
  label: 'BitSearch',
  nacional: false,
  supports: function () { return true; },
  search: async function (ctx) {
    const termo = [ctx.tituloOriginal || ctx.titulo, ctx.ano].filter(Boolean).join(' ');
    if (!termo) return [];
    const data = await http.fetchJSON('https://bitsearch.to/api/search?q=' + encodeURIComponent(termo) + '&sort=seeders');
    const itens = (data && (data.results || data.torrents)) || [];
    return itens.map(function (t) {
      const nome = t.name || t.title || '';
      const hash = t.infohash || t.infoHash || null;
      return {
        title: nome,
        magnet: t.magnet || (hash ? trackers.magnetFromHash(hash, nome, []) : null),
        hash: hash,
        quality: http.detectQuality(nome),
        size: t.size ? http.humanSize(t.size) : '',
        sizeBytes: Number(t.size || 0),
        seeders: Number(t.seeders || 0),
        fileIdx: null,
        source: 'BitSearch'
      };
    }).filter(function (t) { return !!t.magnet; }).slice(0, 20);
  }
};