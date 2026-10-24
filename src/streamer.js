'use strict';

/**
 * TMC 15.0 - Streamer HLS.
 *
 *  - Enquanto o ffmpeg escreve, a playlist e servida como EVENT (o player
 *    recarrega sozinho). Quando o ffmpeg termina, vira VOD com ENDLIST:
 *    duracao real, seek livre e zero logica de live.
 *  - Playlist vazia nunca leva ENDLIST (era o motivo do "Preparando video...").
 *  - O ffmpeg le o torrent bruto por &modo=direto (Range real, sem ffmpeg aninhado).
 *  - -c:v copy (CPU zero) + -c:a aac -ac 2 (AC3/DTS/5.1 -> estereo nativo).
 *  - Mapeamento dinamico de audio: PT-BR por padrao, troca manual por indice.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WebTorrent = require('webtorrent');

const trackers = require('./trackers');
const subtitulos = require('./subtitulos');

const TRACKERS = trackers.TRACKERS;
const appendTrackers = trackers.appendTrackers;

const MODO_TRANSCODE = String(process.env.TRANSCODE || 'nunca').toLowerCase();
const HLS_ATIVO = String(process.env.HLS || '1') !== '0';
const HLS_SEG = Math.max(2, Number(process.env.HLS_SEGMENT_SECONDS || 4));
const PORTA = Number(process.env.PORT || 3000);

/* ------------------- ffmpeg (so carrega se precisar) ---------------- */

let ffmpegLib = null;
let FFMPEG_PATH = '';
let FFPROBE_PATH = '';
let HLS_OK = false;

function carregarFfmpeg() {
  if (ffmpegLib) return;
  try { ffmpegLib = require('fluent-ffmpeg'); } catch (e) { ffmpegLib = null; }
  FFMPEG_PATH = process.env.FFMPEG_PATH || '';
  FFPROBE_PATH = process.env.FFPROBE_PATH || '';
  if (!FFMPEG_PATH) { try { FFMPEG_PATH = require('@ffmpeg-installer/ffmpeg').path; } catch (e) { } }
  if (!FFPROBE_PATH) { try { FFPROBE_PATH = require('@ffprobe-installer/ffprobe').path; } catch (e) { } }
  if (ffmpegLib && FFMPEG_PATH) ffmpegLib.setFfmpegPath(FFMPEG_PATH);
  if (ffmpegLib && FFPROBE_PATH) ffmpegLib.setFfprobePath(FFPROBE_PATH);
}

if (MODO_TRANSCODE !== 'nunca' || HLS_ATIVO) carregarFfmpeg();
HLS_OK = HLS_ATIVO && !!(ffmpegLib && FFMPEG_PATH && FFPROBE_PATH);

const VIDEO_OK_MP4 = /^(h264|hevc|vp9|av1|vp8)$/i;
const AUDIO_OK_NAV = /^(aac|mp3|opus|vorbis|flac)$/i;

/* ----------------------------- constantes -------------------------- */

const cacheSetting = process.env.TORRENT_CACHE_DIR || 'cache';
const CACHE_ROOT = path.isAbsolute(cacheSetting) ? cacheSetting : path.join(__dirname, '..', cacheSetting);

const CACHE_MODE = (process.env.CACHE_MODE || 'session').toLowerCase();
const METADATA_TIMEOUT = Number(process.env.METADATA_TIMEOUT || 60) * 1000;
const BUFFER_TIMEOUT = Number(process.env.BUFFER_TIMEOUT || 150) * 1000;
const IDLE_TIMEOUT = Number(process.env.IDLE_TIMEOUT || 15 * 60 * 1000);
const MAX_JOBS = Number(process.env.MAX_JOBS || 3);
const MAX_CONNS = Number(process.env.MAX_CONNS || 500);
const MIN_BUFFER_PERCENT = Number(process.env.MIN_BUFFER_PERCENT || 0.5);
const MIN_BUFFER_MB = Number(process.env.MIN_BUFFER_MB || 2);
const MAX_SUBS = Number(process.env.MAX_SUBS || 8);
const USAR_UTP = process.env.ENABLE_UTP === '1';

fs.mkdirSync(CACHE_ROOT, { recursive: true });

const client = new WebTorrent({
  maxConns: MAX_CONNS, dht: true, tracker: true, lsd: true, utp: USAR_UTP, webSeeds: true
});

client.on('error', function (e) { console.error('[webtorrent] ' + e.message); });
client.on('warning', function (e) { console.warn('[webtorrent] ' + e.message); });

const jobs = new Map();

const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|avi|mov|ogv|ogg|ts|mpg|mpeg|flv)$/i;
const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', mov: 'video/quicktime', ogv: 'video/ogg', ts: 'video/mp2t'
};

function mimeFor(nome) {
  const ext = String(nome).split('.').pop().toLowerCase();
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
    id: id, dir: dir,
    createdAt: agora(), lastAccess: agora(),
    state: 'conectando',
    message: 'Conectando aos peers...',
    magnet: magnet,
    titulo: params.titulo || '',
    qualidade: params.qualidade || '',
    fileIdx: (params.fileIdx === undefined || params.fileIdx === null || params.fileIdx === '') ? null : Number(params.fileIdx),
    peers: 0, progress: 0, buffer: 0, speed: 0, downloaded: 0, total: 0,
    fileName: '', streamUrl: null, canPlay: false,
    subs: [], subsInternas: [], audios: [], tentativas: 0,
    transcode: MODO_TRANSCODE !== 'nunca',
    analisado: MODO_TRANSCODE === 'nunca' && !HLS_ATIVO,
    duracao: 0, videoCodec: '', audioCodec: '', audioIdx: 0, audioPt: -1, audioPtLang: '', motivoTranscode: '',
    torrent: null, file: null, nudge: null, vigia: null, timers: [], hls: null
  };

  jobs.set(id, job);
  attach(job);
  return job;
}

function limparTimers(job) {
  if (job.nudge) { clearInterval(job.nudge); job.nudge = null; }
  if (job.vigia) { clearInterval(job.vigia); job.vigia = null; }
  (job.timers || []).forEach(function (t) { clearTimeout(t); });
  job.timers = [];
}

function fecharHls(job) {
  if (!job || !job.hls) return;
  try { if (job.hls.cmd) job.hls.cmd.kill('SIGKILL'); } catch (e) { }
  job.hls = null;
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
    if (job.canPlay) return;
    job.peers = torrent.numPeers || 0;
    if (job.peers === 0) {
      TRACKERS.forEach(function (t) { try { torrent.addTracker(t); } catch (e) { } });
      job.message = 'Reanunciando em ' + TRACKERS.length + ' trackers...';
    } else {
      job.message = 'Conectado a ' + job.peers + ' peers. Buscando metadados...';
    }
  }, 5000);

  job.vigia = setInterval(function () {
    if (job.canPlay) return;
    const idade = agora() - job.createdAt;
    if (!job.file) {
      if (idade > METADATA_TIMEOUT) tentarDeNovo(job, 'metadados');
      return;
    }
    if (job.downloaded === 0 && (torrent.numPeers || 0) === 0 && idade > METADATA_TIMEOUT + BUFFER_TIMEOUT) {
      tentarDeNovo(job, 'buffer');
    }
  }, 5000);

  torrent.on('metadata', function () {
    job.state = 'metadados';
    job.message = 'Metadados recebidos. Selecionando video...';
    setTimeout(function () { onReady(job); }, 200);
  });

  torrent.on('ready', function () { onReady(job); });
  torrent.on('noPeers', function () { job.message = 'Sem peers, reanunciando...'; });
  torrent.on('wire', function () {
    job.peers = torrent.numPeers || 0;
    if (!job.canPlay) job.message = 'Conectado a ' + job.peers + ' peers.';
  });

  torrent.on('download', function () {
    job.progress = torrent.progress || 0;
    job.speed = torrent.downloadSpeed || 0;
    job.downloaded = torrent.downloaded || 0;
    job.peers = torrent.numPeers || 0;
    if (job.file) {
      job.buffer = (job.file.progress || 0) * 100;
      if (!job.canPlay && job.analisado) {
        const baixado = job.file.downloaded || 0;
        if (job.buffer >= MIN_BUFFER_PERCENT || baixado >= MIN_BUFFER_MB * 1024 * 1024) {
          job.canPlay = true;
          job.state = 'pronto';
          job.message = 'Pronto.';
          iniciarHlsServidor(job);
        } else {
          job.state = 'bufferizando';
          job.message = 'Preparando stream... ' + job.buffer.toFixed(1) + '%';
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

function tentarDeNovo(job, motivo) {
  if (job.tentativas >= 3) {
    job.state = 'erro';
    job.message = 'Tempo esgotado (' + motivo + '): nenhum peer respondeu apos 4 tentativas.';
    limparTimers(job);
    return;
  }
  job.tentativas += 1;
  job.message = 'Tentativa ' + job.tentativas + '/3 (' + motivo + '). Reiniciando...';
  reiniciar(job);
}

function reiniciar(job) {
  fecharHls(job);
  try { if (job.torrent) job.torrent.destroy({ destroyStore: false }); } catch (e) { }
  limparTimers(job);
  job.torrent = null;
  job.file = null;
  job.canPlay = false;
  job.downloaded = 0;
  job.peers = 0;
  job.state = 'conectando';
  job.createdAt = agora();
  setTimeout(function () { if (!job.torrent) attach(job); }, 500);
}

function pickFile(torrent, fileIdx) {
  const files = torrent.files || [];
  if (!files.length) return null;
  if (fileIdx !== null && fileIdx >= 0 && files[fileIdx]) {
    const cand = files[fileIdx];
    if (VIDEO_EXT.test(cand.name)) return cand;
    const vids = files.filter(function (f) { return VIDEO_EXT.test(f.name); });
    if (vids.length <= 1) return cand;
  }
  const vids = files.filter(function (f) { return VIDEO_EXT.test(f.name); });
  const pool = vids.length ? vids : files;
  return pool.slice().sort(function (a, b) { return b.length - a.length; })[0] || null;
}

function coletarSubs(torrent, video) {
  const base = String(video.name).replace(/\.[^.]+$/, '').toLowerCase();
  return (torrent.files || [])
    .map(function (f, i) { return { f: f, i: i }; })
    .filter(function (x) { return subtitulos.ehLegenda(x.f.name); })
    .sort(function (a, b) {
      const ca = String(a.f.name).toLowerCase().indexOf(base) === 0 ? 0 : 1;
      const cb = String(b.f.name).toLowerCase().indexOf(base) === 0 ? 0 : 1;
      return ca - cb || a.f.length - b.f.length;
    })
    .slice(0, MAX_SUBS)
    .map(function (x, idx) {
      const lang = subtitulos.idiomaDe(x.f.name);
      return { idx: idx, fileIndex: x.i, nome: String(x.f.name).split('/').pop(), code: lang.code, label: lang.label, interna: false };
    });
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
  job.message = 'Preparando stream...';

  job.subs = coletarSubs(torrent, file);
  const manter = [file].concat(job.subs.map(function (s) { return torrent.files[s.fileIndex]; }));
  manter.forEach(function (f) { try { f.select(); } catch (e) { } });
  (torrent.files || []).forEach(function (f) {
    if (manter.indexOf(f) === -1) { try { f.deselect(); } catch (e) { } }
  });

  if (!HLS_OK && MODO_TRANSCODE === 'nunca') {
    job.analisado = true;
    job.transcode = false;
    job.motivoTranscode = 'bruto';
    return;
  }

  job.message = 'Analisando codecs...';
  analisar(job).catch(function () { }).then(function () {
    job.analisado = true;
    job.message = HLS_OK ? 'Pronto para HLS.' : (job.transcode ? 'Convertendo audio...' : 'Stream direto.');
    if (job.canPlay) iniciarHlsServidor(job);
  });
}

/* ------------------- ffprobe (HLS e transcode) --------------------- */

function ffprobeStream(file) {
  return new Promise(function (resolve) {
    if (!FFPROBE_PATH) { resolve(null); return; }
    let saida = '';
    let stream = null, proc = null;
    const fim = function (valor) {
      try { if (stream) stream.destroy(); } catch (e) { }
      try { if (proc && !proc.killed) proc.kill('SIGKILL'); } catch (e) { }
      resolve(valor);
    };
    try {
      proc = spawn(FFPROBE_PATH, [
        '-hide_banner', '-loglevel', 'error',
        '-probesize', '5000000', '-analyzeduration', '5000000',
        '-print_format', 'json', '-show_streams', '-show_format', 'pipe:0'
      ], { windowsHide: true });
    } catch (e) { resolve(null); return; }

    const timer = setTimeout(function () { fim(null); }, 25000);
    proc.stdout.on('data', function (c) { saida += c.toString(); });
    proc.on('close', function () {
      clearTimeout(timer);
      let json = null;
      try { json = JSON.parse(saida); } catch (e) { json = null; }
      fim(json);
    });
    proc.on('error', function () { clearTimeout(timer); fim(null); });

    try {
      stream = file.createReadStream({ start: 0, end: Math.min(file.length - 1, 8 * 1024 * 1024) });
      stream.on('error', function () { });
      stream.pipe(proc.stdin);
      proc.stdin.on('error', function () { });
    } catch (e) { }
  });
}

async function analisar(job) {
  const info = await ffprobeStream(job.file);
  if (!info || !info.streams) { job.transcode = MODO_TRANSCODE === 'sempre'; return; }

  const videos = info.streams.filter(function (s) { return s.codec_type === 'video'; });
  const audios = info.streams.filter(function (s) { return s.codec_type === 'audio'; });

  job.videoCodec = videos[0] ? String(videos[0].codec_name || '') : '';
  job.duracao = (info.format && Number(info.format.duration)) || 0;

  job.audios = audios.map(function (a, i) {
    const tags = a.tags || {};
    const lang = String(tags.language || tags.LANGUAGE || '').toLowerCase();
    return {
      indice: i,
      codec: String(a.codec_name || ''),
      canais: a.channels || 2,
      lang: lang || 'und',
      titulo: tags.title || '',
      ptbr: /por|pt|bra/.test(lang),
      padrao: !!(a.disposition && a.disposition.default)
    };
  });

  let idxPt = -1;
  job.audios.forEach(function (a, i) {
    if (idxPt === -1 && a.ptbr) { idxPt = i; job.audioPtLang = a.lang; }
  });
  job.audioPt = idxPt;
  job.audioIdx = idxPt >= 0 ? idxPt : 0;
  job.audioCodec = job.audios[job.audioIdx] ? job.audios[job.audioIdx].codec : '';

  job.subsInternas = info.streams
    .filter(function (s) { return s.codec_type === 'subtitle'; })
    .map(function (s, i) {
      const tags = s.tags || {};
      const lang = String(tags.language || '').toLowerCase();
      return { i: i, codec: s.codec_name || '', lang: lang, label: tags.title || '' };
    });

  const audioRuim = job.audioCodec && !AUDIO_OK_NAV.test(job.audioCodec);
  const videoRuim = job.videoCodec && !VIDEO_OK_MP4.test(job.videoCodec);

  if (MODO_TRANSCODE === 'sempre') job.transcode = true;
  else job.transcode = !!(audioRuim || videoRuim);
}

/* ------------------------------- HLS ------------------------------- */

/* modo=direto: o ffmpeg do HLS le o arquivo BRUTO do torrent com Range,
   sem cair no servirTranscode (evita ffmpeg dentro de ffmpeg). */
function urlInterna(job) {
  return 'http://127.0.0.1:' + PORTA + '/api/play/stream?jobId=' + job.id + '&modo=direto';
}

function indiceAudio(job, pedido) {
  if (pedido === null || pedido === undefined || pedido === '') return job.audioIdx;
  if (!/^\d+$/.test(String(pedido))) return job.audioIdx;
  const n = Number(pedido);
  if (!job.audios || !job.audios[n]) return job.audioIdx;
  return n;
}

function contarSegmentos(hls) {
  if (!hls) return 0;
  try {
    return fs.readdirSync(hls.dir).filter(function (f) { return /\.(ts|m4s|mp4)$/.test(f); }).length;
  } catch (e) { return 0; }
}

function abrirHls(job, ss, sess, pedido) {
  if (!HLS_OK || !job.file) return null;
  fecharHls(job);

  const base = path.join(job.dir, 'hls');
  const dir = path.join(base, String(sess));
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { }

  const audio = indiceAudio(job, pedido);
  const fmp4 = /hevc|hvc1|av1/i.test(job.videoCodec);
  const ext = fmp4 ? 'm4s' : 'ts';

  const cmd = ffmpegLib(urlInterna(job));

  const optsIn = ['-probesize', '5000000', '-analyzeduration', '5000000',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'];
  if (ss > 0) optsIn.unshift('-ss', String(ss));
  cmd.inputOptions(optsIn);

  const opts = ['-map', '0:v:0'];
  if (audio === job.audioPt && /^por/.test(job.audioPtLang)) opts.push('-map', '0:a:m:language:por?');
  else opts.push('-map', '0:a:' + audio + '?');
  opts.push('-sn', '-dn', '-max_muxing_queue_size', '4096');

  if (VIDEO_OK_MP4.test(job.videoCodec)) {
    opts.push('-c:v', 'copy');
  } else {
    opts.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p');
    opts.push('-force_key_frames', 'expr:gte(t,n_forced*' + HLS_SEG + ')');
  }

  opts.push('-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k');
  opts.push('-af', 'aresample=async=1:first_pts=0');
  opts.push('-f', 'hls');
  opts.push('-hls_time', String(HLS_SEG));
  opts.push('-hls_list_size', '0');
  opts.push('-hls_playlist_type', 'vod');
  opts.push('-hls_flags', 'independent_segments');
  if (fmp4) opts.push('-hls_segment_type', 'fmp4');
  opts.push('-hls_segment_filename', path.join(dir, 'seg%05d.' + ext));
  cmd.outputOptions(opts);
  cmd.output(path.join(dir, 'index.m3u8'));

  const registro = { sess: String(sess), ss: ss, audio: audio, dir: dir, cmd: cmd, criado: agora(), erro: null };
  job.hls = registro;

  cmd.on('error', function (e) {
    registro.erro = e.message;
    console.error('[hls] ' + e.message);
  });
  cmd.on('stderr', function (l) {
    if (/error|invalid|unable|too many/i.test(l)) console.error('[hls] ' + String(l).trim());
  });
  cmd.run();

  try {
    fs.readdirSync(base).forEach(function (n) {
      if (n !== String(sess)) apagarPasta(path.join(base, n));
    });
  } catch (e) { }

  return registro;
}

function iniciarHlsServidor(job) {
  if (!HLS_OK || !job.file || job.hls) return;
  try { abrirHls(job, 0, 'inicial', null); } catch (e) { console.error('[hls] ' + e.message); }
}

function playlistHls(job, req, res) {
  const ss = Math.max(0, Number(req.query.ss) || 0);
  const sess = String(req.query.sess || '1');
  const pedido = req.query.audio;
  const audio = indiceAudio(job, pedido);

  // Reaproveita a sessao ja iniciada (mesmo ponto e mesma faixa) em vez de
  // reiniciar o ffmpeg a cada recarga da playlist.
  if (job.hls && !job.hls.erro && job.hls.ss === ss && job.hls.audio === audio) {
    job.hls.sess = sess;
  } else {
    abrirHls(job, ss, sess, pedido);
  }

  const cabecalho = {
    'content-type': 'application/vnd.apple.mpegurl',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  };

  if (!job.hls) { res.writeHead(200, cabecalho); res.end(vazio()); return; }

  const arq = path.join(job.hls.dir, 'index.m3u8');
  let txt = '';
  try { if (fs.existsSync(arq)) txt = fs.readFileSync(arq, 'utf8'); } catch (e) { txt = ''; }
  if (!/^#EXTM3U/.test(txt)) { res.writeHead(200, cabecalho); res.end(vazio()); return; }

  // Sem ENDLIST => playlist viva (EVENT): o player recarrega e ve os novos
  // segmentos. Com ENDLIST => VOD: duracao real e seek livre.
  const temEndlist = /#EXT-X-ENDLIST/.test(txt);
  const tipo = temEndlist ? 'VOD' : 'EVENT';
  if (/^#EXT-X-PLAYLIST-TYPE:/m.test(txt)) txt = txt.replace(/^#EXT-X-PLAYLIST-TYPE:.*$/m, '#EXT-X-PLAYLIST-TYPE:' + tipo);
  else txt = txt.replace('#EXTM3U', '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:' + tipo);

  const pref = 'stream?jobId=' + job.id + '&sess=' + sess + '&ss=' + ss + '&audio=' + audio + '&seg=';
  txt = txt.replace(/^(seg\d+\.(?:ts|m4s|mp4))\s*$/gm, pref + '$1');

  res.writeHead(200, cabecalho);
  res.end(txt);
}

function vazio() {
  // NUNCA com ENDLIST: senao o player trata como VOD completo e nao recarrega.
  return '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:' + HLS_SEG +
    '\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:EVENT\n';
}

function servirSegmento(job, req, res) {
  const nome = String(req.query.seg || '');
  if (!/^seg\d+\.(ts|m4s|mp4)$/.test(nome)) {
    res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end(); return;
  }

  let alvo = job.hls ? path.join(job.hls.dir, nome) : '';
  if (!alvo || !fs.existsSync(alvo)) {
    alvo = path.join(job.dir, 'hls', String(req.query.sess || ''), nome);
  }
  if (!fs.existsSync(alvo)) {
    res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end(); return;
  }

  let tamanho = 0;
  try { tamanho = fs.statSync(alvo).size; } catch (e) { }

  res.writeHead(200, {
    'content-type': /\.ts$/.test(nome) ? 'video/mp2t' : 'video/mp4',
    'content-length': tamanho,
    'cache-control': 'public, max-age=3600',
    'access-control-allow-origin': '*'
  });
  fs.createReadStream(alvo).pipe(res);
}

/* ------------------------------- HTTP ------------------------------ */

function handle(jobId, req, res) {
  const job = jobs.get(jobId);
  if (!job) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Job nao encontrado.'); return; }
  job.lastAccess = agora();

  if (job.state === 'erro') { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); res.end(job.message); return; }

  if (req.query.seg) { servirSegmento(job, req, res); return; }

  const file = job.file;
  if (!file) { res.writeHead(202, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Aguardando metadados...'); return; }

  const modoPedido = String(req.query.modo || '').toLowerCase();

  if (req.query.hls === '1' || modoPedido === 'hls') {
    if (!HLS_OK) { servirDireto(job, req, res); return; }
    playlistHls(job, req, res);
    return;
  }

  if (modoPedido === 'direto') { servirDireto(job, req, res); return; }

  const modo = modoPedido || (job.transcode ? 'transcode' : 'direto');

  if (modo === 'transcode') servirTranscode(job, req, res);
  else servirDireto(job, req, res);
}

function servirDireto(job, req, res) {
  const file = job.file;
  const total = file.length;
  const base = {
    'content-type': mimeFor(file.name),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'content-range,content-length,accept-ranges'
  };

  if (req.method === 'HEAD') { res.writeHead(200, Object.assign({ 'content-length': total }, base)); res.end(); return; }

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

function servirTranscode(job, req, res) {
  if (!ffmpegLib) carregarFfmpeg();
  if (!ffmpegLib || !FFMPEG_PATH) { servirDireto(job, req, res); return; }

  const t = Math.max(0, Number(req.query.t) || 0);
  const audio = indiceAudio(job, req.query.audio);
  const file = job.file;
  const bytesPorSeg = job.duracao > 0 ? (file.length / job.duracao) : 0;
  const inicio = (t > 0 && bytesPorSeg > 0) ? Math.min(file.length - 1, Math.floor(bytesPorSeg * t)) : 0;

  res.writeHead(200, {
    'content-type': 'video/mp4',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'transfer-encoding': 'chunked'
  });

  let entrada;
  try { entrada = file.createReadStream({ start: inicio }); }
  catch (e) { res.end(); return; }

  const cmd = ffmpegLib(entrada);
  cmd.inputOptions(['-probesize', '5000000', '-analyzeduration', '5000000']);
  if (t > 0) cmd.inputOptions(['-itsoffset', String(-t)]);

  const opts = [
    '-map 0:v:0',
    '-map 0:a:' + audio,
    '-max_muxing_queue_size 2048',
    '-movflags frag_keyframe+empty_moov+default_base_moof',
    '-avoid_negative_ts make_zero'
  ];

  if (VIDEO_OK_MP4.test(job.videoCodec)) cmd.videoCodec('copy');
  else { cmd.videoCodec('libx264'); opts.push('-preset ultrafast', '-crf 23', '-pix_fmt yuv420p', '-threads 0'); }

  opts.push('-c:a aac', '-ac 2', '-b:a 192k', '-ar 48000');
  cmd.outputOptions(opts);
  cmd.format('mp4');

  cmd.on('error', function () { try { res.end(); } catch (e) { } });

  let encerrado = false;
  const limpar = function () {
    if (encerrado) return;
    encerrado = true;
    try { entrada.destroy(); } catch (e) { }
    try { cmd.kill('SIGKILL'); } catch (e) { }
  };
  req.on('close', limpar);
  res.on('close', limpar);

  try { cmd.pipe(res, { end: true }); } catch (e) { try { res.end(); } catch (er) { } }
}

/* ---------------------------- legendas ----------------------------- */

function lerArquivo(file, limite) {
  return new Promise(function (resolve, reject) {
    const pedacos = [];
    let total = 0, resolvido = false;
    const stream = file.createReadStream();
    const fim = function (erro) {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(timer);
      if (erro) reject(erro); else resolve(subtitulos.decodificar(Buffer.concat(pedacos)));
    };
    const timer = setTimeout(function () { try { stream.destroy(); } catch (e) { } fim(); }, 25000);
    stream.on('data', function (c) {
      pedacos.push(c); total += c.length;
      if (total > (limite || 4 * 1024 * 1024)) { try { stream.destroy(); } catch (e) { } fim(); }
    });
    stream.on('end', function () { fim(); });
    stream.on('close', function () { fim(); });
    stream.on('error', function (e) { fim(e); });
  });
}

function extrairLegendaInterna(job, ref) {
  return new Promise(function (resolve) {
    if (!ffmpegLib || !FFMPEG_PATH) { resolve(null); return; }
    let saida = '';
    let proc = null;
    let pronto = false;
    const fim = function () {
      if (pronto) return;
      pronto = true;
      try { if (proc && !proc.killed) proc.kill('SIGKILL'); } catch (e) { }
      const txt = String(saida).replace(/\r/g, '');
      if (!txt.trim()) { resolve(null); return; }
      resolve(/^WEBVTT/i.test(txt) ? txt : 'WEBVTT\n\n' + txt);
    };
    try {
      proc = spawn(FFMPEG_PATH, [
        '-hide_banner', '-loglevel', 'error',
        '-i', urlInterna(job),
        '-map', '0:s:' + ref.i,
        '-f', 'webvtt', '-'
      ], { windowsHide: true });
    } catch (e) { resolve(null); return; }

    const timer = setTimeout(fim, 60000);
    proc.stdout.on('data', function (c) { saida += c.toString(); });
    proc.on('close', function () { clearTimeout(timer); fim(); });
    proc.on('error', function () { clearTimeout(timer); fim(); });
  });
}

async function legenda(jobId, idx) {
  const job = jobs.get(jobId);
  if (!job) return null;
  job.lastAccess = agora();

  const arquivos = job.subs || [];
  if (idx < arquivos.length) {
    const sub = arquivos[idx];
    const file = job.torrent && job.torrent.files[sub.fileIndex];
    if (!file) return null;
    const texto = await lerArquivo(file);
    return { nome: sub.nome, code: sub.code, label: sub.label, vtt: subtitulos.converter(texto, subtitulos.extensao(file.name)) };
  }

  const i = idx - arquivos.length;
  const ref = (job.subsInternas || [])[i];
  if (!ref) return null;
  const vtt = await extrairLegendaInterna(job, ref);
  if (!vtt) return null;
  return { nome: 'Embutida ' + (ref.label || ref.lang || ref.i), code: ref.lang || 'pt-BR', label: ref.label || 'Legenda embutida', vtt: vtt };
}

/* ------------------------------ status ----------------------------- */

function status(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  job.lastAccess = agora();
  const t = job.torrent;

  const subs = (job.subs || []).map(function (s) {
    return { idx: s.idx, nome: s.nome, code: s.code, label: s.label, interna: false };
  }).concat((job.subsInternas || []).map(function (s, i) {
    return {
      idx: (job.subs || []).length + i,
      nome: 'Embutida ' + (s.label || s.lang || ('#' + s.i)),
      code: s.lang || 'pt-BR',
      label: s.label || ('Legenda embutida ' + (s.lang || s.i)),
      interna: true
    };
  }));

  return {
    id: job.id,
    state: job.state,
    message: job.message,
    titulo: job.titulo,
    fileName: job.fileName,
    peers: t ? (t.numPeers || 0) : job.peers,
    progress: t ? (t.progress || 0) : 0,
    buffer: job.buffer || 0,
    speed: t ? (t.downloadSpeed || 0) : 0,
    downloaded: t ? (t.downloaded || 0) : 0,
    total: job.total || 0,
    canPlay: !!job.canPlay,
    tentativa: job.tentativas,
    transcode: !!job.transcode,
    hls: !!HLS_OK,
    hlsPronto: job.hls ? (contarSegmentos(job.hls) > 0) : false,
    hlsErro: job.hls ? (job.hls.erro || null) : null,
    duracao: job.duracao || 0,
    audioIdx: job.audioIdx,
    audioPt: job.audioPt,
    audioFaixas: (job.audios || []).map(function (a) {
      return { indice: a.indice, codec: a.codec, canais: a.canais, lang: a.lang, titulo: a.titulo, ptbr: a.ptbr };
    }),
    subs: subs,
    elapsed: Math.round((agora() - job.createdAt) / 1000),
    streamUrl: job.streamUrl
  };
}

function stop(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  limparTimers(job);
  fecharHls(job);
  jobs.delete(jobId);
  const dir = job.dir;
  const finalizar = function () { if (CACHE_MODE !== 'keep') apagarPasta(dir); };
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

function stopTudo() { Array.from(jobs.keys()).forEach(function (id) { stop(id); }); }

setInterval(function () {
  const t = agora();
  jobs.forEach(function (j) { if (t - j.lastAccess > IDLE_TIMEOUT) stop(j.id); });
}, 45000);

process.on('SIGINT', function () { try { client.destroy(); } catch (e) { } stopTudo(); process.exit(0); });
process.on('SIGTERM', function () { try { client.destroy(); } catch (e) { } stopTudo(); process.exit(0); });

module.exports = {
  start: start, status: status, stop: stop, stopTudo: stopTudo,
  handle: handle, legenda: legenda, jobs: jobs, CACHE_ROOT: CACHE_ROOT,
  FFMPEG_OK: !!FFMPEG_PATH, FFPROBE_OK: !!FFPROBE_PATH, HLS_OK: HLS_OK, MODO_TRANSCODE: MODO_TRANSCODE
};
