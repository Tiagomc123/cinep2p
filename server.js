'use strict';

/**
 * TMC 14.0 - API.
 * /api/torrent resolve o IMDb ID no servidor e passa os titulos alternativos
 * (aliases BR/PT) para o filtro de identidade. /api/play/faixas expoe as
 * trilhas de audio encontradas pelo ffprobe para o seletor do player.
 */

require('dotenv').config();

if (typeof fetch !== 'function') { console.error('Node.js 18+ necessario.'); process.exit(1); }

const path = require('path');
const express = require('express');

const tmdb = require('./src/tmdb');
const magnets = require('./src/magnets');
const streamer = require('./src/streamer');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const VERSAO = '14.0.0';

const app = express();
app.disable('x-powered-by');
app.use(express.json());

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

app.get('/api/health', function (req, res) {
  res.json({
    ok: true, versao: VERSAO, tmdb: tmdb.isConfigured(),
    ffmpeg: streamer.FFMPEG_OK, ffprobe: streamer.FFPROBE_OK, hls: streamer.HLS_OK,
    uptime: Math.round(process.uptime())
  });
});

app.get('/api/config', function (req, res) {
  res.json({
    versao: VERSAO,
    tmdbConfigurado: tmdb.isConfigured(),
    idioma: tmdb.cfg().language,
    cache: streamer.CACHE_ROOT,
    ffmpeg: streamer.FFMPEG_OK,
    hls: streamer.HLS_OK,
    minBuffer: Number(process.env.MIN_BUFFER_PERCENT || 0.5)
  });
});

app.get('/api/generos', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json({ generos: await tmdb.generos(tipo) }); } catch (err) { fail(res, err); }
});

app.get('/api/home', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try {
    const base = tipo === 'tv'
      ? [tmdb.list('/tv/popular', null, 'tv'), tmdb.list('/tv/top_rated', null, 'tv'), tmdb.list('/trending/tv/week', null, 'tv')]
      : [tmdb.list('/movie/popular', null, 'movie'), tmdb.list('/movie/top_rated', null, 'movie'), tmdb.list('/trending/movie/week', null, 'movie')];
    const r = await Promise.all(base.concat([
      tmdb.lancamentos(tipo),
      tmdb.porGenero(tipo, tipo === 'tv' ? 10759 : 28),
      tmdb.porGenero(tipo, 35),
      tmdb.porGenero(tipo, 16),
      tmdb.porGenero(tipo, tipo === 'tv' ? 9648 : 53),
      tmdb.porGenero(tipo, 27)
    ]));
    const hero = (r[2] && r[2][0]) || (r[0] && r[0][0]) || null;
    const rows = [
      { titulo: tipo === 'tv' ? 'Series em alta' : 'Lancamentos (Ultimo Ano)', itens: (r[3] || []).slice(0, 20) },
      { titulo: 'Populares', itens: (r[0] || []).slice(0, 20) },
      { titulo: 'Em Alta Agora', itens: (r[2] || []).slice(0, 20) },
      { titulo: 'Mais Bem Avaliados', itens: (r[1] || []).slice(0, 20) },
      { titulo: 'Acao', itens: (r[4] || []).slice(0, 20) },
      { titulo: 'Comedia', itens: (r[5] || []).slice(0, 20) },
      { titulo: 'Animacao', itens: (r[6] || []).slice(0, 20) },
      { titulo: 'Suspense', itens: (r[7] || []).slice(0, 20) },
      { titulo: 'Terror', itens: (r[8] || []).slice(0, 20) }
    ].filter(function (x) { return x.itens.length; });
    res.json({ tipo: tipo, hero: hero, rows: rows, atualizado: Date.now() });
  } catch (err) { fail(res, err); }
});

app.get('/api/filmes/populares', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json({ itens: await tmdb.list(tipo === 'tv' ? '/tv/popular' : '/movie/popular', { page: req.query.pagina || 1 }, tipo) }); }
  catch (err) { fail(res, err); }
});

app.get('/api/filmes/lancamentos', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json({ itens: await tmdb.lancamentos(tipo) }); } catch (err) { fail(res, err); }
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
  try { res.json(await tmdb.detalhes(tipo, req.params.id)); } catch (err) { fail(res, err); }
});

app.get('/api/serie/:id/temporada/:n', async function (req, res) {
  const numero = Number(req.params.n) || 1;
  try {
    const data = await tmdb.request('/tv/' + req.params.id + '/season/' + numero);
    const episodios = (data.episodes || []).map(function (e) {
      return {
        numero: e.episode_number,
        titulo: e.name || ('Episodio ' + e.episode_number),
        sinopse: e.overview || '',
        duracao: e.runtime || null,
        nota: e.vote_average || 0,
        imagem: tmdb.img(e.still_path, 'w300'),
        data: e.air_date || ''
      };
    });
    res.json({
      numero: numero,
      nome: data.name || ('Temporada ' + numero),
      sinopse: data.overview || '',
      poster: tmdb.img(data.poster_path, 'w300'),
      episodios: episodios
    });
  } catch (err) { fail(res, err); }
});

app.get('/api/buscar', async function (req, res) {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ itens: [] });
  try { res.json({ itens: await tmdb.buscar(q, req.query.tipo || null) }); } catch (err) { fail(res, err); }
});

/* ---------------------------- torrents ----------------------------- */

app.get('/api/torrent', async function (req, res) {
  const q = req.query;
  const tipo = q.tipo === 'tv' ? 'tv' : 'movie';
  const ctx = {
    titulo: q.titulo || q.query || '',
    tituloOriginal: q.tituloOriginal || '',
    ano: q.ano || '',
    imdbId: q.imdbId || null,
    tipo: tipo,
    temporada: Number(q.temporada) || 1,
    episodio: Number(q.episodio) || 1,
    aliases: []
  };

  if (!ctx.titulo && !ctx.imdbId && !q.tmdbId) return res.status(400).json({ error: 'Informe titulo, tmdbId ou imdbId.' });

  if (q.tmdbId) {
    if (!ctx.imdbId) {
      try { ctx.imdbId = await tmdb.imdbId(tipo, q.tmdbId); } catch (e) { }
    }
    try {
      const alt = await tmdb.request('/' + tipo + '/' + q.tmdbId + '/alternative_titles');
      const lista = (alt && (alt.titles || alt.results)) || [];
      ctx.aliases = lista
        .filter(function (t) { return t && t.title; })
        .sort(function (a, b) {
          const peso = function (x) { return x.iso_3166_1 === 'BR' ? 0 : (x.iso_3166_1 === 'PT' ? 1 : 2); };
          return peso(a) - peso(b);
        })
        .map(function (t) { return t.title; })
        .slice(0, 12);
    } catch (e) { }
  }

  try {
    const r = await magnets.buscar(ctx);
    res.json({
      melhor: r.melhor,
      fontes: r.fontes,
      ptbr: r.ptbr,
      total: r.total,
      descartados: r.descartados,
      exemplosDescartados: r.exemplosDescartados,
      ptbrTotal: r.ptbrTotal,
      confirmados: r.confirmados,
      query: r.query,
      imdbId: ctx.imdbId,
      aliases: ctx.aliases.length,
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
  if (!s) return res.status(404).json({ error: 'Job nao encontrado.' });
  res.json(s);
});

app.get('/api/play/faixas', function (req, res) {
  const s = streamer.status(String(req.query.jobId || ''));
  if (!s) return res.status(404).json({ error: 'Job nao encontrado.' });
  res.json({ faixas: s.audioFaixas || [], audio: s.audioIdx });
});

app.get('/api/play/stream', function (req, res) { streamer.handle(String(req.query.jobId || ''), req, res); });

app.get('/api/play/subs', function (req, res) {
  const s = streamer.status(String(req.query.jobId || ''));
  if (!s) return res.status(404).json({ error: 'Job nao encontrado.' });
  res.json({ subs: s.subs || [] });
});

app.get('/api/play/subtitle', async function (req, res) {
  try {
    const r = await streamer.legenda(String(req.query.jobId || ''), Number(req.query.idx) || 0);
    if (!r) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Legenda indisponivel.'); return; }
    res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(r.vtt);
  } catch (err) { fail(res, err); }
});

app.all('/api/play/stop', function (req, res) {
  const id = String((req.query && req.query.jobId) || '');
  res.json({ parado: id ? streamer.stop(id) : (streamer.stopTudo(), true) });
});

app.use('/api', function (req, res) { res.status(404).json({ error: 'Rota nao encontrada: ' + req.originalUrl }); });

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('*', function (req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, HOST, function () {
  console.log('');
  console.log('  TMC ' + VERSAO + ' -> http://localhost:' + PORT);
  console.log('  Cache (apagado ao fechar o player): ' + streamer.CACHE_ROOT);
  console.log('  FFmpeg: ' + (streamer.FFMPEG_OK ? 'ok' : 'AUSENTE') + ' | ffprobe: ' + (streamer.FFPROBE_OK ? 'ok' : 'AUSENTE') + ' | HLS VOD: ' + (streamer.HLS_OK ? 'ok' : 'desligado'));
  if (!tmdb.isConfigured()) console.log('  ATENCAO: TMDB_API_KEY ausente no .env');
  console.log('');
});
