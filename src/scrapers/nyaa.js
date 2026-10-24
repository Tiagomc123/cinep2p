'use strict';

/**
 * Nyaa - feed RSS publico. Extremamente estavel e otimo para SERIES
 * (muitos grupos publicam episodio isolado com DUAL/MULTI).
 */

const http = require('./_http');

const HOSTS = ['https://nyaa.si', 'https://nyaa.iss.ink'];

function campo(bloco, tag) {
  const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'i').exec(bloco);
  if (!m) return '';
  return http.decodeEntities(String(m[1]).replace(/<!\[CDATA\[|\]\]>/g, ''));
}

module.exports = {
  name: 'nyaa',
  label: 'Nyaa',
  nacional: false,
  supports: function () { return true; },
  search: async function (ctx) {
    const termo = ctx.query || ctx.tituloOriginal || ctx.titulo;
    if (!termo) return [];
    for (const host of HOSTS) {
      try {
        const xml = await http.fetchText(host + '/?page=rss&c=0_0&f=0&q=' + encodeURIComponent(termo));
        const blocos = String(xml).split('<item>').slice(1);
        const saida = [];
        blocos.forEach(function (b) {
          const titulo = campo(b, 'title').trim();
          const magnet = (/magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,40}[^"'\s<]*/i.exec(b) || [])[0];
          if (!titulo || !magnet) return;
          const hash = (/btih:([a-zA-Z0-9]{32,40})/i.exec(magnet) || [])[1] || null;
          saida.push({
            title: titulo,
            magnet: http.decodeEntities(magnet),
            hash: hash ? hash.toLowerCase() : null,
            quality: http.detectQuality(titulo),
            size: campo(b, 'nyaa:size'),
            sizeBytes: http.parseSize(campo(b, 'nyaa:size')).bytes,
            seeders: Number(campo(b, 'nyaa:seeders') || 0),
            fileIdx: null,
            source: 'Nyaa'
          });
        });
        if (saida.length) return saida.slice(0, 25);
      } catch (e) { }
    }
    return [];
  }
};