'use strict';

/**
 * Registry de scrapers. Todos rodam EM PARALELO.
 * Use SCRAPERS_ENABLED=torrentio,yts,... no .env para restringir.
 */

const TODOS = [
  require('./torrentio'),
  require('./yts'),
  require('./piratebay'),
  require('./eztv'),
  require('./solidtorrents'),
  require('./torrentgalaxy'),
  require('./torrent9'),
  require('./commandotorrents'),
  require('./lapumia'),
  require('./x1337')
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
      return { nome: s.name, label: s.label, itens: [], ms: 0, erro: null, ignorado: true };
    }
    try {
      const itens = await s.search(ctx);
      return { nome: s.name, label: s.label, itens: Array.isArray(itens) ? itens : [], ms: Date.now() - t0, erro: null };
    } catch (e) {
      return { nome: s.name, label: s.label, itens: [], ms: Date.now() - t0, erro: e.message };
    }
  });
  return Promise.all(tarefas);
}

module.exports = { executar: executar, todos: TODOS, ativos: ativos };