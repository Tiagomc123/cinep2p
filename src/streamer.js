'use strict';

/**
 * Player P2P blindado.
 *
 *  - announce list massiva no magnet + no add() + re-anuncio a cada 6s
 *  - timeout de metadados com retentativas automaticas
 *  - overlay de buffer com porcentagem (file.progress)
 *  - LIMPEZA ABSOLUTA: cada job tem sua propria pasta em cache/ e ela e
 *    apagada (destroyStore + rm recursivo com retry no Windows) ao fechar
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebTorrent = require('webtorrent');
const trackers = require('./trackers');

const TRACKERS = trackers.TRACKERS;
const appendTrackers = trackers.appendTrackers;

const cacheSetting = process.env.TORRENT_CACHE_DIR || 'cache';
const CACHE_ROOT = path.isAbsolute(cacheSetting) ? cacheSetting : path.join(__dirname, '..', cacheSetting);

const CACHE_MODE = (process.env.CACHE_MODE || 'session').toLowerCase();
const METADATA_TIMEOUT = Number(process.env.METADATA_TIMEOUT || 40) * 1000;
const IDLE_TIMEOUT = Number(process.env.IDLE_TIMEOUT || 12 * 60 * 1000);
const MAX_JOBS = Number(process.env.MAX_JOBS || 3);
const MAX_CONNS = Number(process.env.MAX_CONNS || 200);
const MIN_BUFFER_PERCENT = Number(process.env.MIN_BUFFER_PERCENT || 4);
const MIN_BUFFER_MB = Number(process.env.MIN_BUFFER_MB || 12);

fs.mkdirSync(CACHE_ROOT, { recursive: true });

const client = new WebTorrent({
  maxConns: MAX_CONNS,
  dht: true,
  tracker: true,
  lsd: true,
  utp: true,
  webSeeds: true
});

client.on('error', function (e) { console.error('[webtorrent] ' + e.message); });
client.on('warning', function (e) { console.warn('[webtorrent] ' + e.message); });

const jobs = new Map();

const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|avi|mov|ogv|ogg|ts|mpg|mpeg|flv)$/i;
const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', mov: 'video/quicktime', ogv: 'video/ogg', ts: 'video/mp2t'
};

function mimeFor(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function agora() { return Date.now(); }

/* ----------------------------- limpeza ----------------------------- */

function apagarPasta(dir, tentativa) {
  const n = tentativa || 0;
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    if (!fs.existsSync(dir)) return;
  } catch (e) { }
  if (n < 6) setTimeout(function () { apagarPasta(dir, n + 1); }, 300 * (n + 1));
}

function limparOrfaos() {
  if (CACHE_MODE === 'keep') return;
  try {
    fs.readdirSync(CACHE_ROOT).forEach(function (nome) {
      const p = path.join(CACHE_ROOT, nome);
      try { if (fs.statSync(p).isDirectory()) apagarPasta(p); } catch (e) { }
    });
  } catch (e) { }
}
limparOrfaos();

/* ------------------------------- job ------------------------------- */

function start(params) {
  const magnet = appendTrackers(params.magnet);
  if (!magnet) throw new Error('Magnet link invalido.');

  if (jobs.size >= MAX_JOBS) destruirMaisAntigo();

  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(CACHE_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });

  const job = {
    id: id,
    dir: dir,
    createdAt: agora(),
    lastAccess: agora(),
    state: 'conectando',
    message: 'Conectando aos peers...',
    magnet: magnet,
    titulo: params.titulo || '',
    qualidade: params.qualidade || '',
    fileIdx: (params.fileIdx === undefined || params.fileIdx === null || params.fileIdx === '')
      ? null : Number(params.fileIdx),
    peers: 0, progress: 0, buffer: 0, speed: 0, downloaded: 0, total: 0,
    fileName: '', streamUrl: null, canPlay: false,
    tentativas: 0, torrent: null, file: null, nudge: null, timers: []
  };

  jobs.set(id, job);
  attach(job);
  return job;
}

function limparTimers(job) {
  if (job.nudge) { clearInterval(job.nudge); job.nudge = null; }
  (job.timers || []).forEach(function (t) { clearTimeout(t); });
  job.timers = [];
}

function attach(job) {
  let torrent;
  try {
    torrent = client.add(job.magnet, { path: job.dir, announce: TRACKERS });
  } catch (err) {
    job.state = 'erro';
    job.message = 'Nao foi possivel abrir o magnet: ' + err.message;
    return;
  }

  job.torrent = torrent;
  job.state = 'conectando';
  job.message = 'Procurando peers em ' + TRACKERS.length + ' trackers...';

  try { torrent.strategy = 'sequential'; } catch (e) { }

  job.nudge = setInterval(function () {
    if (job.state === 'pronto') return;
    job.peers = torrent.numPeers || 0;
    if (job.peers === 0) {
      TRACKERS.forEach(function (t) { try { torrent.addTracker(t); } catch (e) { } });
      job.message = 'Reforcando announce list (' + TRACKERS.length + ' trackers)...';
    }
  }, 6000);

  job.timers.push(setTimeout(function () {
    if (job.state === 'pronto') return;
    job.message = 'Metadados demorando. Tentando trackers alternativos...';
  }, 14000));

  job.timers.push(setTimeout(function () {
    if (job.state === 'pronto') return;
    if (job.tentativas < 2) {
      job.tentativas += 1;
      job.message = 'Tentativa ' + job.tentativas + ' expirada. Reiniciando...';
      restart(job);
    } else {
      job.state = 'erro';
      job.message = 'Tempo esgotado: nenhum peer respondeu. Tente outra fonte.';
      limparTimers(job);
    }
  }, METADATA_TIMEOUT));

  torrent.on('metadata', function () {
    job.state = 'metadados';
    job.message = 'Metadados recebidos. Selecionando video...';
    setTimeout(function () { onReady(job); }, 400);
  });

  torrent.on('ready', function () { onReady(job); });
  torrent.on('noPeers', function () { job.message = 'Sem peers no momento, reforcando trackers...'; });
  torrent.on('wire', function () { job.peers = torrent.numPeers || 0; });

  torrent.on('download', function () {
    job.progress = torrent.progress || 0;
    job.speed = torrent.downloadSpeed || 0;
    job.downloaded = torrent.downloaded || 0;
    job.peers = torrent.numPeers || 0;
    if (job.file) {
      job.buffer = (job.file.progress || 0) * 100;
      if (!job.canPlay) {
        const baixado = job.file.downloaded || 0;
        if (job.buffer >= MIN_BUFFER_PERCENT || baixado >= MIN_BUFFER_MB * 1024 * 1024) {
          job.canPlay = true;
          job.state = 'pronto';
          job.message = 'Buffer pronto. Iniciando reproducao...';
        }
      }
    }
  });

  torrent.on('error', function (err) {
    job.state = 'erro';
    job.message = 'Erro no torrent: ' + err.message;
    limparTimers(job);
  });

  torrent.on('warning', function (e) { console.warn('[torrent] ' + e.message); });
}

function restart(job) {
  limparTimers(job);
  try { if (job.torrent) job.torrent.destroy({ destroyStore: false }); } catch (e) { }
  job.torrent = null;
  job.state = 'conectando';
  job.peers = 0;
  setTimeout(function () { if (job.state !== 'pronto' && !job.torrent) attach(job); }, 500);
}

function pickFile(torrent, fileIdx) {
  const files = torrent.files || [];
  if (!files.length) return null;
  if (fileIdx !== null && fileIdx >= 0 && files[fileIdx]) {
    const candidato = files[fileIdx];
    if (VIDEO_EXT.test(candidato.name)) return candidato;
    const vids = files.filter(function (f) { return VIDEO_EXT.test(f.name); });
    if (vids.length <= 1) return candidato;
  }
  const vids = files.filter(function (f) { return VIDEO_EXT.test(f.name); });
  const pool = vids.length ? vids : files;
  return pool.slice().sort(function (a, b) { return b.length - a.length; })[0] || null;
}

function onReady(job) {
  if (job.file) return;
  const torrent = job.torrent;
  if (!torrent) return;

  const file = pickFile(torrent, job.fileIdx);
  if (!file) {
    job.state = 'erro';
    job.message = 'Nenhum arquivo de video neste torrent.';
    limparTimers(job);
    return;
  }

  job.file = file;
  job.fileName = file.name;
  job.total = file.length;
  job.streamUrl = '/api/play/stream?jobId=' + job.id;
  job.state = 'bufferizando';
  job.message = 'Conectando aos peers (buffer)...';

  try { file.select(); } catch (e) { }
  (torrent.files || []).forEach(function (f) {
    if (f !== file) { try { f.deselect(); } catch (e) { } }
  });
}

/* ------------------------------- HTTP ------------------------------ */

function handle(jobId, req, res) {
  const job = jobs.get(jobId);
  if (!job) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Job nao encontrado.'); return; }
  job.lastAccess = agora();

  if (job.state === 'erro') { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); res.end(job.message); return; }

  const file = job.file;
  if (!file) { res.writeHead(202, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Aguardando metadados...'); return; }

  const total = file.length;
  const base = {
    'content-type': mimeFor(file.name),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'content-range,content-length,accept-ranges'
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, Object.assign({ 'content-length': total }, base));
    res.end();
    return;
  }

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    if (start > end) { res.writeHead(416, Object.assign({ 'content-range': 'bytes */' + total }, base)); res.end(); return; }
    res.writeHead(206, Object.assign({
      'content-range': 'bytes ' + start + '-' + end + '/' + total,
      'content-length': end - start + 1
    }, base));
    const stream = file.createReadStream({ start: start, end: end });
    stream.on('error', function () { try { res.end(); } catch (e) { } });
    res.on('close', function () { try { stream.destroy(); } catch (e) { } });
    stream.pipe(res);
    return;
  }

  res.writeHead(200, Object.assign({ 'content-length': total }, base));
  const stream = file.createReadStream();
  stream.on('error', function () { try { res.end(); } catch (e) { } });
  res.on('close', function () { try { stream.destroy(); } catch (e) { } });
  stream.pipe(res);
}

/* ------------------------------ status ----------------------------- */

function status(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  job.lastAccess = agora();
  const t = job.torrent;
  return {
    id: job.id,
    state: job.state,
    message: job.message,
    titulo: job.titulo,
    qualidade: job.qualidade,
    fileName: job.fileName,
    peers: t ? (t.numPeers || 0) : job.peers,
    progress: t ? (t.progress || 0) : 0,
    buffer: job.buffer || 0,
    speed: t ? (t.downloadSpeed || 0) : 0,
    downloaded: t ? (t.downloaded || 0) : 0,
    total: job.total || 0,
    canPlay: !!job.canPlay,
    minBuffer: MIN_BUFFER_PERCENT,
    elapsed: Math.round((agora() - job.createdAt) / 1000),
    streamUrl: job.streamUrl
  };
}

function stop(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  limparTimers(job);
  jobs.delete(jobId);

  const dir = job.dir;
  const finalizar = function () {
    if (CACHE_MODE === 'keep') return;
    apagarPasta(dir);
  };

  try {
    if (job.torrent) job.torrent.destroy({ destroyStore: true }, function () { finalizar(); });
    else finalizar();
  } catch (e) { finalizar(); }
  return true;
}

function destruirMaisAntigo() {
  let alvo = null;
  jobs.forEach(function (j) { if (!alvo || j.lastAccess < alvo.lastAccess) alvo = j; });
  if (alvo) stop(alvo.id);
}

function stopTudo() {
  Array.from(jobs.keys()).forEach(function (id) { stop(id); });
}

setInterval(function () {
  const t = agora();
  jobs.forEach(function (j) { if (t - j.lastAccess > IDLE_TIMEOUT) { console.log('[streamer] job ocioso encerrado ' + j.id); stop(j.id); } });
}, 45000);

process.on('SIGINT', function () { try { client.destroy(); } catch (e) { } stopTudo(); process.exit(0); });
process.on('SIGTERM', function () { try { client.destroy(); } catch (e) { } stopTudo(); process.exit(0); });

module.exports = { start: start, status: status, stop: stop, stopTudo: stopTudo, handle: handle, jobs: jobs, CACHE_ROOT: CACHE_ROOT };