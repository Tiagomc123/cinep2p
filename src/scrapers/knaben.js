'use strict';

/**
 * Knaben - meta-indexador (API POST publica). Agrega dezenas de trackers
 * incluindo grupos que publicam DUAL 5.1 com faixa PT-BR.
 */

const http = require('./_http');

module.exports = {
  name: 'knaben',
  label: 'Knaben',
  nacional: false,
  supports: function () { return true; },
  search: async function (ctx) {
    const termo = [ctx.tituloOriginal || ctx.titulo, ctx.ano].filter(Boolean).join(' ');
    if (!termo) return [];
    const data = await http.fetchJSONPost('https://api.knaben.org/v1', {
      search: { query: termo, order_by: 'seeders', order_direction: 'desc' },
      size: 50
    });
    const hits = (data && data.hits) || [];
    return hits.map(function (h) {
      const nome = h.title || '';
      const magnet = h.magnetUrl || h.magnet || null;
      const hash = magnet ? (/btih:([a-zA-Z0-9]{32,40})/i.exec(magnet) || [])[1] : null;
      return {
        title: nome,
        magnet: magnet,
        hash: hash ? hash.toLowerCase() : null,
        quality: http.detectQuality(nome),
        size: h.size ? http.humanSize(h.size) : '',
        sizeBytes: Number(h.size || 0),
        seeders: Number(h.seeders || 0),
        fileIdx: null,
        source: 'Knaben'
      };
    }).filter(function (h) { return !!h.magnet; });
  }
};