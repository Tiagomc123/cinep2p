'use strict';

const http = require('./_http');
const trackers = require('../trackers');

const HOSTS = ['https://torrents-csv.ml', 'https://torrents-csv.com'];

module.exports = {
  name: 'torrentscsv',
  label: 'TorrentsCSV',
  nacional: false,
  supports: function () { return true; },
  search: async function (ctx) {
    const termo = [ctx.tituloOriginal || ctx.titulo, ctx.ano].filter(Boolean).join(' ');
    if (!termo) return [];
    let data = null;
    for (const h of HOSTS) {
      try {
        const r = await http.fetchJSON(h + '/service/search?q=' + encodeURIComponent(termo) + '&size=30');
        if (r && r.torrents && r.torrents.length) { data = r; break; }
      } catch (e) { }
    }
    if (!data) return [];
    return data.torrents.map(function (t) {
      const nome = t.name || '';
      const hash = t.infohash || t.info_hash || null;
      return {
        title: nome,
        magnet: hash ? trackers.magnetFromHash(hash, nome, []) : null,
        hash: hash,
        quality: http.detectQuality(nome),
        size: t.size ? http.humanSize(t.size) : '',
        sizeBytes: Number(t.size || 0),
        seeders: Number(t.seeders || 0),
        fileIdx: null,
        source: 'TorrentsCSV'
      };
    }).filter(function (t) { return !!t.magnet; }).slice(0, 20);
  }
};