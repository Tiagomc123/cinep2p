'use strict';

/**
 * Esteira concorrente - somente fontes resilientes (APIs e RSS).
 * Unico HTML mantido: TorrentGalaxy (por pedido explicito).
 */

const TODOS = [
  require('./torrentio'),
  require('./knaben'),
  require('./bitsearch'),
  require('./torrentscsv'),
  require('./solidtorrents'),
  require('./piratebay'),
  require('./bt4g'),
  require('./nyaa'),
  require('./yts'),
  require('./eztv'),
  require('./torrentgalaxy')
];

function ativos() {
  const env = String(process.env.SCRAPERS_ENABLED || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!env.length) return TODOS;
  return TODOS.filter(function (s) { return env.indexOf(s.name) !== -1; });
}

async function executar(ctx) {
  const lista = ativos();
  const tarefas = lista.map(async function (s) {
    const t0 = Date.now();
    if (s.supports && !s.supports(ctx)) {
      return { nome: s.name, label: s.label, nacional: !!s.nacional, itens: [], ms: 0, erro: null };
    }
    try {
      const itens = await s.search(ctx);
      return { nome: s.name, label: s.label, nacional: !!s.nacional, itens: Array.isArray(itens) ? itens : [], ms: Date.now() - t0, erro: null };
    } catch (e) {
      return { nome: s.name, label: s.label, nacional: !!s.nacional, itens: [], ms: Date.now() - t0, erro: e.message };
    }
  });
  return Promise.all(tarefas);
}

module.exports = { executar: executar, todos: TODOS, ativos: ativos };