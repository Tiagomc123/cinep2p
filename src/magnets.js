'use strict';

/**
 * Orquestrador: dispara todos os scrapers em paralelo, unifica, deduplica
 * e devolve a lista ranqueada + o link recomendado.
 */

const scrapers = require('./scrapers');
const ranking = require('./ranking');

async function buscar(ctx) {
  const t0 = Date.now();
  const resultados = await scrapers.executar(ctx);

  const stats = resultados.map(function (r) {
    return { fonte: r.label, itens: r.itens.length, ms: r.ms, erro: r.erro };
  }).sort(function (a, b) { return b.itens - a.itens; });

  let brutos = [];
  resultados.forEach(function (r) {
    r.itens.forEach(function (item) {
      item.source = item.source || r.label;
      brutos.push(item);
    });
  });

  const ranqueados = ranking.preparar(brutos, ctx);
  const fontes = ranqueados.slice(0, 40);

  return {
    recomendado: fontes[0] || null,
    fontes: fontes,
    total: ranqueados.length,
    dublados: ranqueados.filter(function (f) { return f._info && f._info.br; }).length,
    ms: Date.now() - t0,
    scrapers: stats
  };
}

module.exports = { buscar: buscar };