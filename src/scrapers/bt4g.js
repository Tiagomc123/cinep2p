'use strict';

/**
 * BT4G - indice publico da rede DHT, com espelhos.
 * Fallback amplo quando as APIs principais nao acham o episodio.
 */

const http = require('./_http');

const HOSTS = ['https://bt4gprx.com', 'https://bt4g.org', 'https://www.bt4g.com'];

module.exports = {
  name: 'bt4g',
  label: 'BT4G',
  nacional: false,
  supports: function () { return true; },
  search: async function (ctx) {
    const termo = ctx.query || ctx.tituloOriginal || ctx.titulo;
    if (!termo) return [];
    for (const host of HOSTS) {
      try {
        const html = await http.fetchText(host + '/search?q=' + encodeURIComponent(termo) + '&orderby=seeders&p=1');
        const linhas = http.rowsFromHtml(html, { source: 'BT4G' });
        if (linhas.length) return linhas.slice(0, 25);
      } catch (e) { }
    }
    return [];
  }
};