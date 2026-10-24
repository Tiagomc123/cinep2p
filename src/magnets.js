'use strict';

/**
 * Esteira concorrente + filtro de identidade por IMDb ID.
 *
 * Fontes que respondem por ID (Torrentio, EZTV, YTS com match exato) sao
 * marcadas como imdbConfirmado e passam direto. Todo o resto e validado
 * por titulo + ano contra o IMDb/TMDb antes de entrar na lista.
 */

const scrapers = require('./scrapers');
const ranking = require('./ranking');

const NIVEIS_ELEGIVEIS = ['duals51', 'confirmado', 'provavel'];

function pad(n) { return String(n || 1).padStart(2, '0'); }

async function buscar(input) {
  const t0 = Date.now();
  const ctx = Object.assign({ aliases: [] }, input);

  if (ctx.tipo === 'tv') {
    const base = ctx.tituloOriginal || ctx.titulo || '';
    ctx.query = (base + ' S' + pad(ctx.temporada) + 'E' + pad(ctx.episodio)).trim();
    ctx.tituloOriginal = ctx.query;
    ctx.titulo = base;
    ctx.ano = ctx.anoAnoOriginal || ctx.ano;
  } else {
    ctx.query = [ctx.tituloOriginal || ctx.titulo, ctx.ano].filter(Boolean).join(' ');
  }

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

  const preparado = ranking.preparar(brutos, ctx);
  const ranqueados = preparado.validos;
  const elegiveis = ranqueados.filter(function (f) {
    return NIVEIS_ELEGIVEIS.indexOf(f.ptbr.nivel) !== -1;
  });

  const porSeed = function (a, b) { return (b.seeders - a.seeders) || (b.score - a.score); };

  let melhor = null;
  if (elegiveis.length) melhor = elegiveis.slice().sort(porSeed)[0];
  else if (ranqueados.length) melhor = ranqueados.slice().sort(porSeed)[0];

  return {
    melhor: melhor,
    fontes: ranqueados.slice(0, 40),
    ptbr: elegiveis.slice(0, 20),
    total: ranqueados.length,
    descartados: preparado.descartados.length,
    exemplosDescartados: preparado.descartados.slice(0, 6).map(function (d) {
      return { title: d.title, motivo: d.motivoInvalido, source: d.source };
    }),
    ptbrTotal: elegiveis.length,
    confirmados: ranqueados.filter(function (f) { return f.ptbr.nivel === 'duals51' || f.ptbr.nivel === 'confirmado'; }).length,
    query: ctx.query,
    ms: Date.now() - t0,
    scrapers: stats
  };
}

module.exports = { buscar: buscar };