'use strict';

const http = require('./_http');
const trackers = require('../trackers');

const HOSTS = [
  'https://solidtorrents.to',
  'https://solidtorrents.net',
  'https://solidtorrents.eu'
];

module.exports = {
  name: 'solidtorrents',
  label: 'SolidTorrents',
  supports: function () { return true; },
  search: async function (ctx) {
    const term = encodeURIComponent(ctx.tituloOriginal || ctx.titulo || '');
    if (!term) return [];
    const urls = HOSTS.map(function (h) {
      return h + '/api/v1/search?q=' + term + '&category=video&sort=seeders';
    });
    let data = null;
    for (const u of urls) {
      try {
        const parsed = await http.fetchJSON(u);
        if (parsed && Array.isArray(parsed.results) && parsed.results.length) { data = parsed; break; }
      } catch (e) { }
    }
    if (!data) return [];
    return data.results.map(function (r) {
      const hash = r.infohash || r.infoHash || r.hash || '';
      const nome = r.title || r.name || '';
      return {
        title: nome,
        magnet: r.magnet || (hash ? trackers.magnetFromHash(hash, nome, []) : null),
        hash: hash || null,
        quality: http.detectQuality(nome),
        size: r.size ? http.humanSize(r.size) : '',
        sizeBytes: Number(r.size || 0),
        seeders: Number(r.seeders || r.seed || 0),
        fileIdx: null,
        source: 'SolidTorrents'
      };
    }).filter(function (r) { return !!r.magnet; }).slice(0, 15);
  }
};