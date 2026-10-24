'use strict';

const http = require('./_http');
const trackers = require('../trackers');

module.exports = {
  name: 'eztv',
  label: 'EZTV',
  nacional: false,
  supports: function (ctx) { return ctx.tipo === 'tv'; },
  search: async function (ctx) {
    if (!ctx.imdbId) return [];
    const data = await http.fetchJSON('https://eztvx.to/api/get-torrents?imdb_id=' + encodeURIComponent(ctx.imdbId) + '&limit=80');
    const list = (data && data.torrents) || [];
    return list
      .filter(function (t) { return !!t.magnet; })
      .filter(function (t) {
        if (Number(t.season) !== Number(ctx.temporada || 1)) return false;
        if (!t.episode) return true;
        return Number(t.episode) === Number(ctx.episodio || 1);
      })
      .map(function (t) {
        const nome = t.title || t.filename || 'Episodio';
        const hash = /([0-9a-f]{40})/i.exec(t.magnet || '');
        return {
          title: nome,
          magnet: trackers.appendTrackers(t.magnet),
          hash: hash ? hash[1] : null,
          quality: http.detectQuality(nome),
          size: http.humanSize(t.size_bytes),
          sizeBytes: Number(t.size_bytes || 0),
          seeders: Number(t.seeds || 0),
          fileIdx: null,
          imdbConfirmado: true,
          source: 'EZTV'
        };
      });
  }
};