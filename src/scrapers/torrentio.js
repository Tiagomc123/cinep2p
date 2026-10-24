'use strict';

const http = require('./_http');
const trackers = require('../trackers');

function trackerListFromSources(sources) {
  const out = [];
  (sources || []).forEach(function (s) {
    const str = String(s);
    if (str.indexOf('tracker:') === 0) out.push(str.slice('tracker:'.length));
  });
  return out;
}

module.exports = {
  name: 'torrentio',
  label: 'Torrentio',
  supports: function () { return true; },
  search: async function (ctx) {
    if (!ctx.imdbId) return [];
    const path = ctx.tipo === 'tv'
      ? 'series/' + ctx.imdbId + ':' + (ctx.temporada || 1) + ':' + (ctx.episodio || 1)
      : 'movie/' + ctx.imdbId;
    const data = await http.fetchJSON('https://torrentio.strem.fun/stream/' + path + '.json');
    const streams = (data && data.streams) || [];
    return streams.map(function (s) {
      const title = s.title || '';
      const seedMatch = /👤\s*(\d+)/.exec(title);
      const sizeMatch = /💾\s*([\d.,]+\s*[KMGT]i?B)/i.exec(title);
      const provider = String(s.name || '').split('\n').pop().trim();
      const label = title.split('\n')[0].trim();
      return {
        title: label || provider,
        magnet: s.infoHash ? trackers.magnetFromHash(s.infoHash, label || provider, trackerListFromSources(s.sources)) : null,
        hash: s.infoHash || null,
        quality: http.detectQuality(title) || http.detectQuality(provider),
        size: sizeMatch ? sizeMatch[1].replace(/\s+/g, ' ') : '',
        sizeBytes: 0,
        seeders: seedMatch ? Number(seedMatch[1]) : 0,
        fileIdx: typeof s.fileIdx === 'number' ? s.fileIdx : null,
        source: 'Torrentio'
      };
    }).filter(function (s) { return !!s.magnet; });
  }
};