'use strict';

/**
 * CineP2P 3.0 - API desacoplada (pronta para Capacitor/Cordova).
 */

require('dotenv').config();

if (typeof fetch !== 'function') {
  console.error('Node.js 18+ necessario (fetch nativo).');
  process.exit(1);
}

const path = require('path');
const express = require('express');

const tmdb = require('./src/tmdb');
const magnets = require('./src/magnets');
const streamer = require('./src/streamer');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const VERSAO = '3.0.0';

const app = express();
app.disable('x-powered-by');
app.use(express.json());

/* ------------------------------ CORS ------------------------------- */
app.use(function (req, res, next) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type,range,accept');
  res.setHeader('access-control-expose-headers', 'content-range,content-length,accept-ranges');
  res.setHeader('access-control-allow-methods', 'GET,HEAD,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  next();
});

function fail(res, err, status) {
  const code = (err && err.code === 'TMDB_NOT_CONFIGURED') ? 503 : (status || 500);
  console.error('[api] ' + (err && err.message));
  res.status(code).json({ error: (err && err.message) ? err.message : 'Erro interno.' });
}

/* ------------------------------ config ----------------------------- */

app.get('/api/health', function (req, res) {
  res.json({ ok: true, versao: VERSAO, tmdb: tmdb.isConfigured(), uptime: Math.round(process.uptime()) });
});

app.get('/api/config', function (req, res) {
  res.json({
    versao: VERSAO,
    tmdbConfigurado: tmdb.isConfigured(),
    idioma: tmdb.cfg().language,
    cache: streamer.CACHE_ROOT,
    minBuffer: Number(process.env.MIN_BUFFER_PERCENT || 4)
  });
});

app.get('/api/generos', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json({ generos: await tmdb.generos(tipo) }); }
  catch (err) { fail(res, err); }
});

/* ------------------------------- home ------------------------------ */

app.get('/api/home', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try {
    const base = tipo === 'tv'
      ? [tmdb.list('/tv/popular', null, 'tv'), tmdb.list('/tv/top_rated', null, 'tv'), tmdb.list('/trending/tv/week', null, 'tv')]
      : [tmdb.list('/movie/popular', null, 'movie'), tmdb.list('/movie/top_rated', null, 'movie'), tmdb.list('/trending/movie/week', null, 'movie')];

    const resultados = await Promise.all(base.concat([
      tmdb.lancamentos(tipo),
      tmdb.porGenero(tipo, tipo === 'tv' ? 10759 : 28),
      tmdb.porGenero(tipo, 35),
      tmdb.porGenero(tipo, 16),
      tmdb.porGenero(tipo, tipo === 'tv' ? 9648 : 53),
      tmdb.porGenero(tipo, 27)
    ]));

    const populares = resultados[0] || [];
    const top = resultados[1] || [];
    const emAlta = resultados[2] || [];
    const lancamentos = resultados[3] || [];

    const hero = emAlta[0] || populares[0] || null;

    const rows = [
      { titulo: 'Lancamentos (Ultimo Ano)', itens: lancamentos.slice(0, 20) },
      { titulo: 'Populares', itens: populares.slice(0, 20) },
      { titulo: 'Em Alta Agora', itens: emAlta.slice(0, 20) },
      { titulo: 'Mais Bem Avaliados', itens: top.slice(0, 20) },
      { titulo: 'Acao', itens: (resultados[4] || []).slice(0, 20) },
      { titulo: 'Comedia', itens: (resultados[5] || []).slice(0, 20) },
      { titulo: 'Animacao', itens: (resultados[6] || []).slice(0, 20) },
      { titulo: 'Suspense', itens: (resultados[7] || []).slice(0, 20) },
      { titulo: 'Terror', itens: (resultados[8] || []).slice(0, 20) }
    ].filter(function (r) { return r.itens.length; });

    res.json({ tipo: tipo, hero: hero, rows: rows, atualizado: Date.now() });
  } catch (err) { fail(res, err); }
});

/* --------------------------- catalogo ------------------------------ */

app.get('/api/filmes/populares', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json({ itens: await tmdb.list(tipo === 'tv' ? '/tv/popular' : '/movie/popular', { page: req.query.pagina || 1 }, tipo) }); }
  catch (err) { fail(res, err); }
});

app.get('/api/filmes/lancamentos', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json({ itens: await tmdb.lancamentos(tipo) }); }
  catch (err) { fail(res, err); }
});

app.get('/api/filmes/top', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json({ itens: await tmdb.list(tipo === 'tv' ? '/tv/top_rated' : '/movie/top_rated', { page: req.query.pagina || 1 }, tipo) }); }
  catch (err) { fail(res, err); }
});

app.get('/api/filmes/genero/:id', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json({ itens: await tmdb.porGenero(tipo, req.params.id, req.query.pagina) }); }
  catch (err) { fail(res, err); }
});

app.get('/api/media/:tipo/:id', async function (req, res) {
  const tipo = req.params.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json(await tmdb.detalhes(tipo, req.params.id)); }
  catch (err) { fail(res, err); }
});

app.get('/api/buscar', async function (req, res) {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ itens: [] });
  try { res.json({ itens: await tmdb.buscar(q, req.query.tipo || null) }); }
  catch (err) { fail(res, err); }
});

/* ---------------------------- torrents ----------------------------- */

app.get('/api/torrent', async function (req, res) {
  const q = req.query;
  const ctx = {
    titulo: q.titulo || q.query || '',
    tituloOriginal: q.tituloOriginal || '',
    ano: q.ano || '',
    imdbId: q.imdbId || null,
    tipo: q.tipo === 'tv' ? 'tv' : 'movie',
    temporada: Number(q.temporada) || 1,
    episodio: Number(q.episodio) || 1
  };
  if (!ctx.titulo && !ctx.imdbId) return res.status(400).json({ error: 'Informe titulo ou imdbId.' });
  try {
    const r = await magnets.buscar(ctx);
    res.json({
      recomendado: r.recomendado,
      fontes: r.fontes,
      total: r.total,
      dublados: r.dublados,
      ms: r.ms,
      scrapers: r.scrapers
    });
  } catch (err) { fail(res, err); }
});

/* ------------------------------ player ----------------------------- */

app.get('/api/play', function (req, res) {
  if (!req.query.magnet) return res.status(400).json({ error: 'Parametro magnet obrigatorio.' });
  try {
    const job = streamer.start({
      magnet: String(req.query.magnet),
      fileIdx: req.query.fileIdx,
      titulo: req.query.titulo,
      qualidade: req.query.qualidade
    });
    res.json({ jobId: job.id, statusUrl: '/api/play/status?jobId=' + job.id, streamUrl: '/api/play/stream?jobId=' + job.id });
  } catch (err) { fail(res, err); }
});

app.get('/api/play/status', function (req, res) {
  const s = streamer.status(String(req.query.jobId || ''));
  if (!s) return res.status(404).json({ error: 'Job nao encontrado (expirado).' });
  res.json(s);
});

app.get('/api/play/stream', function (req, res) { streamer.handle(String(req.query.jobId || ''), req, res); });

app.all('/api/play/stop', function (req, res) {
  const id = String((req.query && req.query.jobId) || '');
  res.json({ parado: id ? streamer.stop(id) : (streamer.stopTudo(), true) });
});

app.use('/api', function (req, res) {
  res.status(404).json({ error: 'Rota nao encontrada: ' + req.originalUrl });
});

/* ---------------------------- estaticos ---------------------------- */

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('*', function (req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

/* ------------------------------- start ----------------------------- */

app.listen(PORT, HOST, function () {
  console.log('');
  console.log('  CineP2P ' + VERSAO + ' -> http://localhost:' + PORT);
  console.log('  Cache (limpo ao fechar o player): ' + streamer.CACHE_ROOT);
  if (!tmdb.isConfigured()) console.log('  ATENCAO: TMDB_API_KEY ausente no .env');
  console.log('');
});