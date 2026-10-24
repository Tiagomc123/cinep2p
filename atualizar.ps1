<#
    TMC 15.0 - atualizar.ps1
    Corrige o player que ficava preso em "Preparando video...".
    1) Playlist EVENT enquanto o ffmpeg escreve; VOD + ENDLIST quando termina.
    2) Playlist vazia nao leva mais ENDLIST (hls.js volta a recarregar).
    3) URL interna do ffmpeg forca &modo=direto (fim do ffmpeg dentro de ffmpeg).
    4) ffmpeg do HLS pre-iniciado no canPlay (primeiro segmento pronto antes da intro).
    5) hls.js sem aceleracao de live + watchdog de travamento + fallback automatico.
    Arquivos: src/streamer.js, public/app.js
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Raiz = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location $Raiz

function Salvar {
    param([string]$Caminho, [string]$Conteudo)
    $alvo = Join-Path $Raiz $Caminho
    $pasta = Split-Path -Parent $alvo
    if ($pasta -and -not (Test-Path $pasta)) { New-Item -ItemType Directory -Force -Path $pasta | Out-Null }
    Set-Content -LiteralPath $alvo -Value $Conteudo -Encoding UTF8
    Write-Host ("  [ok] " + $Caminho) -ForegroundColor Green
}
function Etapa { param([string]$t) Write-Host ""; Write-Host ("=== " + $t) -ForegroundColor Cyan }

Write-Host ""
Write-Host "TMC 15.0 - correcao do player HLS (stuck em Preparando video)" -ForegroundColor Yellow

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($f in @('src\streamer.js','public\app.js')) {
    $p = Join-Path $Raiz $f
    if (Test-Path $p) { Copy-Item $p ($p + '.bak-' + $stamp) -Force }
}
Write-Host ("Backups .bak-" + $stamp + " criados.") -ForegroundColor DarkGray

# ---------------------------------------------------------------- 1. streamer.js
Etapa '1/2  src/streamer.js (playlist viva -> VOD, modo=direto, pre-start)'
Salvar 'src/streamer.js' @'
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
'@

# ---------------------------------------------------------------- 2. app.js
Etapa '2/2  public/app.js (hls sem aceleracao + watchdog + fallback)'
Salvar 'public/app.js' @'
'use strict';

/* =====================================================================
   TMC 15.0 - player HLS

   Video : HLS do backend (-c:v copy). Enquanto o ffmpeg escreve a playlist
           e viva (recarrega sozinha); ao terminar vira VOD com ENDLIST.
   Anti-travamento: sem aceleracao de live + watchdog + fallback automatico
           para o modo mp4 caso o HLS nao entregue imagem.
   Audio : AAC estereo no servidor + seletor de faixa.
   Intro : 3s com animacao + tudum. CC: legendas do torrent e embutidas.
   ===================================================================== */

const API_BASE = String(window.CINEP2P_API_BASE || '').replace(/\/+$/, '');
const PLACEHOLDER = '/placeholder.svg';
const NIVEIS_BONS = ['duals51', 'confirmado', 'provavel'];
const INTRO_MS = 3000;

const $ = function (s, r) { return (r || document).querySelector(s); };
const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

const LS = {
  get: function (k, d) { try { const v = window.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set: function (k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
  del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { } }
};

const K = { lista: 'cinep2p:lista', historico: 'cinep2p:historico', continuar: 'cinep2p:continuar', tipo: 'cinep2p:tipo' };

const GENEROS_FILTRO = [
  { id: 28, nome: 'Ação' },
  { id: 35, nome: 'Comédia' },
  { id: 27, nome: 'Terror' },
  { id: 53, nome: 'Suspense' },
  { id: 10749, nome: 'Romance' },
  { id: 16, nome: 'Animação' }
];

let hls = null;

const state = {
  view: 'inicio',
  tipo: LS.get(K.tipo, 'movie'),
  generos: [],
  media: null,
  temporada: 1,
  episodio: 1,
  job: null,
  poll: null,
  podeTocar: false,
  streamUrl: null,
  buscaTimer: null,
  ultimoSalvar: 0,
  fontes: [],
  melhor: null,
  tentativa: 0,
  subs: [],
  legendaAtiva: null,
  faixas: [],
  audio: null,
  total: 0,
  duracao: 0,
  ss: 0,
  sess: null,
  modoHls: false,
  mudo: false,
  volume: 1,
  esconderTimer: null,
  introTimer: null,
  introFim: 0,
  arrastandoSeek: false,
  recarregando: false,
  ultimoRecarregar: 0,
  ultimoProgresso: 0,
  guardTimer: null,
  slideTimer: null,
  slides: [],
  slideIdx: 0,
  catalogo: [],
  generoFiltro: null,
  ordemNota: false,
  vigiaTimer: null
};

const els = {
  hero: $('#hero'), rows: $('#rows'),
  filtros: $('#filtros'), filtrosGrid: $('#filtrosGrid'), filtrosTitulo: $('#filtrosTitulo'),
  searchInput: $('#searchInput'), searchResults: $('#searchResults'),
  listaGrid: $('#listaGrid'), historicoGrid: $('#historicoGrid'),
  categoriasChips: $('#categoriasChips'), categoriasGrid: $('#categoriasGrid'),
  modal: $('#modal'), modalBody: $('#modalBody'),
  toast: $('#toast'), drawer: $('#drawer'), drawerBackdrop: $('#drawerBackdrop'),
  player: $('#player'), video: $('#video'),
  pvCenter: $('#pvCenter'), pvTitle: $('#pvTitle'),
  pvMsg: $('#pvMsg'), pvStats: $('#pvStats'), pvFill: $('#pvFill'), pvFonte: $('#pvFonte'),
  pvTime: $('#pvTime'), pvProgress: $('#pvProgress'), pvKnob: $('#pvKnob'), pvSeek: $('#pvSeek'),
  pvSheet: $('#pvSheet'), pvSheetBody: $('#pvSheetBody'), pvSheetTitle: $('#pvSheetTitle'),
  pvIntro: $('#pvIntro'), selAudio: $('#sel-audio'),
  icoPlay: $('#icoPlay'), icoPause: $('#icoPause'), icoVol: $('#icoVol'), icoMudo: $('#icoMudo')
};

/* ------------------------------ utils ------------------------------ */

function pad(n) { return String(n || 1).padStart(2, '0'); }

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function fmtSize(b) {
  const n = Number(b);
  if (!n || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v = v / 1024; i++; }
  return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}
function fmtSpeed(b) { const n = Number(b); return n > 0 ? fmtSize(n) + '/s' : '0 B/s'; }
function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
}

let toastTimer = null;
function toast(msg, tipo) {
  els.toast.textContent = msg;
  els.toast.className = 'toast' + (tipo === 'error' ? ' error' : '');
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { els.toast.classList.add('hidden'); }, 4000);
}

function url(path, params) {
  const u = new URL(API_BASE + path, API_BASE ? API_BASE + '/' : window.location.origin);
  if (params) Object.keys(params).forEach(function (k) {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  });
  return u.toString();
}

async function api(path, params) {
  const res = await fetch(url(path, params));
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) throw new Error(data.error || ('Erro HTTP ' + res.status));
  return data;
}

/* ------------------------------ cards ------------------------------ */

function cardHtml(item, opts) {
  const o = opts || {};
  const prog = (o.progresso && item.progresso)
    ? '<div class="card-progress"><i style="width:' + Math.min(100, item.progresso) + '%"></i></div>' : '';
  const img = '<img loading="lazy" src="' + esc(item.poster || item.backdrop || PLACEHOLDER) +
    '" alt="' + esc(item.titulo || '') + '" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'">';
  return '<button class="card" data-card data-id="' + esc(item.id) + '" data-tipo="' + esc(item.tipo || 'movie') + '">' +
      '<div class="card-img">' + img + prog + '</div>' +
      '<div class="card-meta"><span>' + esc(item.ano || '') + '</span>' +
      (item.nota ? '<span>&#9733; ' + item.nota.toFixed(1) + '</span>' : '') + '</div>' +
      '<div class="card-title">' + esc(item.titulo || '') + '</div>' +
    '</button>';
}

function gridHtml(itens, opts) {
  if (!itens || !itens.length) return '<p class="vazio">Nada por aqui ainda.</p>';
  return itens.map(function (i) { return cardHtml(i, opts); }).join('');
}

/* ------------------------------ views ------------------------------ */

function setView(nome) {
  state.view = nome;
  ['inicio', 'buscar', 'lista', 'historico', 'categorias'].forEach(function (v) {
    const el = $('#view-' + v);
    if (el) el.classList.toggle('hidden', v !== nome);
  });
  $$('.nav-link').forEach(function (b) { b.classList.toggle('active', b.dataset.view === nome); });
  window.scrollTo({ top: 0 });
  if (nome === 'lista') renderLista();
  if (nome === 'historico') renderHistorico();
  if (nome === 'categorias') renderCategorias();
  if (nome === 'buscar') setTimeout(function () { els.searchInput.focus(); }, 120);
}

function setTipo(tipo) {
  state.tipo = tipo === 'tv' ? 'tv' : 'movie';
  LS.set(K.tipo, state.tipo);
  $$('.tipo-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tipo === state.tipo); });
  $$('.bn-item[data-aba]').forEach(function (b) { b.classList.toggle('active', b.dataset.tipo === state.tipo); });
  els.searchInput.placeholder = state.tipo === 'tv' ? 'Buscar series...' : 'Buscar filmes...';
  state.generoFiltro = null;
  state.ordemNota = false;
  state.catalogo = [];
  api('/api/generos', { tipo: state.tipo }).then(function (g) { state.generos = g.generos || []; }).catch(function () { });
  carregarInicio();
}

function abrirDrawer() { els.drawer.classList.remove('hidden'); els.drawerBackdrop.classList.remove('hidden'); }
function fecharDrawer() { els.drawer.classList.add('hidden'); els.drawerBackdrop.classList.add('hidden'); }

/* --------------------------- hero slideshow ------------------------ */

function renderSlides(itens) {
  const alvo = els.hero;
  if (!alvo) return;
  clearInterval(state.slideTimer);
  const lista = (itens || []).filter(function (i) { return i && (i.backdrop || i.poster); }).slice(0, 6);
  state.slides = lista;
  state.slideIdx = 0;

  if (!lista.length) { alvo.innerHTML = ''; return; }

  alvo.classList.add('slides');
  alvo.innerHTML = lista.map(function (item, i) {
    return '<div class="slide' + (i === 0 ? ' on' : '') + '" style="background-image:url(\'' + esc(item.backdrop || item.poster) + '\')">' +
        '<div class="hero-inner">' +
          '<p class="hero-kicker">' + (item.tipo === 'tv' ? 'Serie em destaque' : 'Lancamento') + '</p>' +
          '<h1 class="hero-title">' + esc(item.titulo) + '</h1>' +
          '<p class="hero-meta">' + esc(item.ano || '') + (item.nota ? ' &middot; &#9733; ' + item.nota.toFixed(1) : '') + '</p>' +
          '<p class="hero-sinopse">' + esc(item.sinopse || '') + '</p>' +
          '<div class="hero-actions">' +
            '<button class="btn primary" data-slide="' + i + '">' + (item.tipo === 'tv' ? 'Ver episodios' : 'Assistir agora') + '</button>' +
            '<button class="btn ghost" data-slide-info="' + i + '">Detalhes</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }).join('') + '<div class="slide-dots">' +
    lista.map(function (x, i) { return '<i class="' + (i === 0 ? 'on' : '') + '"></i>'; }).join('') + '</div>';

  $$('.slide .btn[data-slide]').forEach(function (b) {
    b.addEventListener('click', function () {
      const item = state.slides[Number(b.dataset.slide)];
      if (!item) return;
      if (item.tipo === 'tv') abrirDetalhes('tv', item.id, false);
      else assistir(item);
    });
  });
  $$('.slide .btn[data-slide-info]').forEach(function (b) {
    b.addEventListener('click', function () {
      const item = state.slides[Number(b.dataset.slideInfo)];
      if (item) abrirDetalhes(item.tipo || 'movie', item.id, false);
    });
  });

  if (lista.length > 1) state.slideTimer = setInterval(function () { proximoSlide(1); }, 7000);
}

function proximoSlide(passo) {
  const total = state.slides.length;
  if (total < 2) return;
  state.slideIdx = (state.slideIdx + passo + total) % total;
  $$('.slide').forEach(function (s, i) { s.classList.toggle('on', i === state.slideIdx); });
  $$('.slide-dots i').forEach(function (d, i) { d.classList.toggle('on', i === state.slideIdx); });
}

/* ------------------------------ home ------------------------------- */

function skeleton() {
  let html = '';
  for (let i = 0; i < 3; i++) {
    html += '<div class="row"><div class="sk sk-title"></div><div class="scroller">';
    for (let j = 0; j < 6; j++) html += '<div class="sk sk-card"></div>';
    html += '</div></div>';
  }
  return html;
}

function rowHtml(titulo, itens, opts) {
  return '<section class="row"><h2>' + esc(titulo) + '</h2><div class="scroller">' +
    itens.map(function (i) { return cardHtml(i, opts); }).join('') + '</div></section>';
}

function renderFiltros() {
  const box = els.filtros;
  if (!box) return;
  box.classList.toggle('hidden', state.tipo !== 'movie');
  if (state.tipo !== 'movie') return;

  let html = '<button class="chip' + (!state.generoFiltro ? ' ativo' : '') + '" data-genero-f="">Todos</button>';
  GENEROS_FILTRO.forEach(function (g) {
    html += '<button class="chip' + (state.generoFiltro === g.id ? ' ativo' : '') + '" data-genero-f="' + g.id + '">' + esc(g.nome) + '</button>';
  });
  html += '<button class="chip ordem' + (state.ordemNota ? ' ativo' : '') + '" id="btnOrdemNota">&#9733; Mais bem avaliados</button>';
  box.innerHTML = html;

  $$('#filtros [data-genero-f]').forEach(function (b) {
    b.addEventListener('click', function () {
      const v = b.dataset.generoF;
      state.generoFiltro = v === '' ? null : Number(v);
      renderFiltros();
      aplicarFiltro();
    });
  });
  const btn = $('#btnOrdemNota');
  if (btn) btn.addEventListener('click', function () {
    state.ordemNota = !state.ordemNota;
    renderFiltros();
    if (state.catalogo.length && state.generoFiltro) { ordenarERender(); return; }
    aplicarFiltro();
  });
}

function nomeGenero(id) {
  const g = GENEROS_FILTRO.filter(function (x) { return x.id === Number(id); })[0];
  return g ? g.nome : 'Genero';
}

async function aplicarFiltro() {
  const grid = els.filtrosGrid, tit = els.filtrosTitulo, rows = els.rows;
  if (!grid) return;

  if (!state.generoFiltro && !state.ordemNota) {
    grid.classList.add('hidden');
    tit.classList.add('hidden');
    rows.classList.remove('hidden');
    return;
  }

  grid.classList.remove('hidden');
  tit.classList.remove('hidden');
  rows.classList.add('hidden');
  tit.textContent = state.generoFiltro ? ('Genero: ' + nomeGenero(state.generoFiltro)) : 'Mais bem avaliados';
  grid.innerHTML = '<p class="vazio">Carregando...</p>';

  try {
    const d = state.generoFiltro
      ? await api('/api/filmes/genero/' + state.generoFiltro, { tipo: state.tipo })
      : await api('/api/filmes/top', { tipo: state.tipo });
    state.catalogo = d.itens || [];
    ordenarERender();
  } catch (e) { grid.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>'; }
}

function ordenarERender() {
  if (!els.filtrosGrid) return;
  const lista = (state.catalogo || []).slice();
  if (state.ordemNota) lista.sort(function (a, b) { return (b.nota || 0) - (a.nota || 0); });
  els.filtrosGrid.innerHTML = gridHtml(lista, {});
}

async function carregarInicio() {
  els.rows.innerHTML = skeleton();
  renderFiltros();
  try {
    const home = await api('/api/home', { tipo: state.tipo });
    let lanc = { itens: [] };
    try { lanc = await api('/api/filmes/lancamentos', { tipo: state.tipo }); } catch (e) { }

    renderSlides((lanc.itens && lanc.itens.length) ? lanc.itens : (home.hero ? [home.hero] : []));

    let html = '';
    if (state.tipo === 'movie') {
      const continuar = LS.get(K.continuar, []);
      if (continuar.length) html += rowHtml('Continue Assistindo', continuar, { progresso: true });
    }
    home.rows.forEach(function (r) { html += rowHtml(r.titulo, r.itens, {}); });
    els.rows.innerHTML = html || '<p class="vazio">Sem resultados.</p>';

    if (state.generoFiltro || state.ordemNota) aplicarFiltro();
  } catch (e) {
    els.rows.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>';
    if (/TMDB_API_KEY/.test(e.message)) mostrarAviso();
    toast(e.message, 'error');
  }
}

function mostrarAviso() {
  if ($('#aviso')) return;
  const div = document.createElement('div');
  div.id = 'aviso';
  div.className = 'aviso';
  div.innerHTML = 'Configure a chave do TMDb no <code>.env</code>: <code>TMDB_API_KEY=sua_chave</code>.';
  els.rows.parentNode.insertBefore(div, els.rows);
}

/* ------------------------------ buscar ----------------------------- */

async function buscar(termo) {
  const q = String(termo || '').trim();
  if (q.length < 2) { els.searchResults.innerHTML = ''; return; }
  els.searchResults.innerHTML = '<p class="vazio">Buscando...</p>';
  try {
    const data = await api('/api/buscar', { q: q, tipo: state.tipo });
    els.searchResults.innerHTML = gridHtml(data.itens, {});
  } catch (e) { els.searchResults.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>'; }
}

/* --------------------- lista / historico / categorias -------------- */

function renderLista() { els.listaGrid.innerHTML = gridHtml(LS.get(K.lista, []), {}); }
function renderHistorico() { els.historicoGrid.innerHTML = gridHtml(LS.get(K.historico, []), { progresso: true }); }

function renderCategorias() {
  els.categoriasChips.innerHTML = state.generos.map(function (g) {
    return '<button class="chip" data-genero="' + g.id + '">' + esc(g.nome) + '</button>';
  }).join('') || '<p class="vazio">Carregando...</p>';
  $$('#categoriasChips .chip').forEach(function (b) {
    b.addEventListener('click', function () { abrirGenero(b.dataset.genero, b.textContent); });
  });
}

async function abrirGenero(id, nome) {
  els.categoriasGrid.innerHTML = '<p class="vazio">Carregando ' + esc(nome) + '...</p>';
  try {
    const data = await api('/api/filmes/genero/' + id, { tipo: state.tipo });
    els.categoriasGrid.innerHTML = gridHtml(data.itens, {});
  } catch (e) { els.categoriasGrid.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>'; }
}

function chaveItem(i) { return (i.tipo || 'movie') + ':' + i.id; }
function resumo(i) {
  return { id: i.id, tipo: i.tipo || 'movie', titulo: i.titulo, poster: i.poster, backdrop: i.backdrop, ano: i.ano, nota: i.nota };
}

function alternarFavorito(item) {
  const lista = LS.get(K.lista, []);
  const chave = chaveItem(item);
  if (lista.some(function (i) { return chaveItem(i) === chave; })) {
    LS.set(K.lista, lista.filter(function (i) { return chaveItem(i) !== chave; }));
    toast('Removido da Minha Lista');
  } else {
    lista.unshift(resumo(item));
    LS.set(K.lista, lista.slice(0, 120));
    toast('Adicionado a Minha Lista');
  }
  if (state.view === 'lista') renderLista();
}

function marcarHistorico(item, rotulo) {
  const alvo = Object.assign(resumo(item), { rotulo: rotulo || item.titulo, atualizado: Date.now() });
  const h = LS.get(K.historico, []).filter(function (i) { return chaveItem(i) !== chaveItem(item); });
  h.unshift(alvo);
  LS.set(K.historico, h.slice(0, 80));
}

function posicaoAbsoluta() {
  return state.ss + (els.video.currentTime || 0);
}

function salvarProgresso() {
  if (!state.media || state.media.tipo === 'tv') return;
  const dur = state.duracao || (isFinite(els.video.duration) ? els.video.duration : 0);
  if (!dur) return;
  const pct = Math.min(100, (posicaoAbsoluta() / dur) * 100);
  if (pct < 1 || pct > 98) return;
  const chave = chaveItem(state.media);
  const lista = LS.get(K.continuar, []).filter(function (i) { return chaveItem(i) !== chave; });
  lista.unshift(Object.assign(resumo(state.media), { progresso: pct, atualizado: Date.now() }));
  LS.set(K.continuar, lista.slice(0, 15));
}

/* ------------------------------ detalhes --------------------------- */

function abrirModal(html) {
  els.modalBody.innerHTML = html;
  els.modal.classList.remove('hidden');
  document.body.classList.add('no-scroll');
}
function fecharModal() {
  els.modal.classList.add('hidden');
  els.modalBody.innerHTML = '';
  if (els.player.classList.contains('hidden')) document.body.classList.remove('no-scroll');
}

async function abrirDetalhes(tipo, id, abrirTrailer) {
  abrirModal('<p class="vazio">Carregando...</p>');
  try {
    const m = await api('/api/media/' + tipo + '/' + id);
    state.media = m;
    renderDetalhes(m, abrirTrailer);
  } catch (e) { abrirModal('<p class="vazio">' + esc(e.message) + '</p>'); }
}

function renderDetalhes(m, abrirTrailer) {
  const generos = (m.generos || []).map(function (g) { return g.nome; }).join(' &middot; ');
  const elenco = (m.elenco || []).map(function (c) {
    return '<div class="elenco-item"><div class="elenco-foto">' +
      (c.foto ? '<img loading="lazy" src="' + esc(c.foto) + '" alt="' + esc(c.nome) + '" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'">' : '') +
      '</div><span>' + esc(c.nome) + '</span></div>';
  }).join('');

  const temporadas = (m.temporadas && m.temporadas.length) ? m.temporadas : [{ numero: 1, nome: 'Temporada 1' }];
  const blocoSeries = m.tipo === 'tv'
    ? '<div class="temporadas">' +
        '<label>Temporada<select id="selTemporada">' +
          temporadas.map(function (t) {
            return '<option value="' + t.numero + '">' + esc(t.nome || ('Temporada ' + t.numero)) + '</option>';
          }).join('') +
        '</select></label>' +
      '</div>' +
      '<div id="episodiosBox" class="episodios"><p class="vazio">Carregando episodios...</p></div>'
    : '';

  els.modalBody.innerHTML =
    '<div class="details" style="--bd:url(\'' + (m.backdrop || m.poster || PLACEHOLDER) + '\')">' +
      '<div class="details-top">' +
        '<div class="details-poster"><img src="' + esc(m.poster || PLACEHOLDER) + '" alt="' + esc(m.titulo) + '" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'"></div>' +
        '<div class="details-head">' +
          '<h2>' + esc(m.titulo) + '</h2>' +
          '<p class="details-meta">' + esc(m.ano || '') +
            (m.nota ? ' &middot; &#9733; ' + m.nota.toFixed(1) : '') +
            (m.duracao ? ' &middot; ' + m.duracao + ' min' : '') +
            (m.tipo === 'tv' ? ' &middot; ' + temporadas.length + ' temporada(s)' : '') + '</p>' +
          (generos ? '<p class="details-gen">' + generos + '</p>' : '') +
        '</div>' +
      '</div>' +
      '<div class="details-body">' +
        '<p class="details-sinopse">' + esc(m.sinopse || 'Sinopse nao disponivel.') + '</p>' +
        '<div class="details-actions">' +
          (m.tipo === 'tv' ? '' : '<button class="btn primary big" id="btnAssistir">Assistir agora</button>') +
          '<div class="linha">' +
            (m.trailer ? '<button class="btn ghost" id="btnTrailer">Trailer</button>' : '') +
            '<button class="btn ghost" id="btnFavoritar">Favoritar</button>' +
            (m.imdbId ? '<a class="btn ghost" target="_blank" rel="noreferrer" href="https://www.imdb.com/title/' + esc(m.imdbId) + '/">IMDb</a>' : '') +
          '</div>' +
        '</div>' +
        blocoSeries +
        (elenco ? '<div class="elenco"><h3>Elenco</h3><div class="elenco-list">' + elenco + '</div></div>' : '') +
      '</div>' +
    '</div>';

  if ($('#btnAssistir')) $('#btnAssistir').addEventListener('click', function () { fecharModal(); assistir(m); });
  if ($('#btnTrailer')) $('#btnTrailer').addEventListener('click', function () { mostrarTrailer(m.trailer); });
  $('#btnFavoritar').addEventListener('click', function () { alternarFavorito(m); });
  if (abrirTrailer && m.trailer) mostrarTrailer(m.trailer);

  if (m.tipo === 'tv') {
    $('#selTemporada').addEventListener('change', function () { carregarTemporada(m, Number(this.value)); });
    carregarTemporada(m, temporadas[0].numero);
  }
}

async function carregarTemporada(m, numero) {
  const box = $('#episodiosBox');
  if (!box) return;
  box.innerHTML = '<p class="vazio">Carregando episodios...</p>';
  try {
    const d = await api('/api/serie/' + m.id + '/temporada/' + numero);
    if (!d.episodios.length) { box.innerHTML = '<p class="vazio">Temporada sem episodios cadastrados.</p>'; return; }
    box.innerHTML = d.episodios.map(function (ep) {
      return '<button class="episodio" data-ep="' + ep.numero + '">' +
          '<div class="ep-thumb">' +
            (ep.imagem ? '<img loading="lazy" src="' + esc(ep.imagem) + '" alt="" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'">' : '') +
            '<span class="ep-play">&#9654;</span>' +
          '</div>' +
          '<div class="ep-info">' +
            '<strong><span class="ep-num">E' + pad(ep.numero) + '</span>' + esc(ep.titulo) + '</strong>' +
            '<span class="ep-meta">' + (ep.duracao ? ep.duracao + ' min' : '') + (ep.data ? ' &middot; ' + esc(ep.data) : '') + '</span>' +
            '<p>' + esc(ep.sinopse || 'Sinopse nao disponivel.') + '</p>' +
          '</div>' +
        '</button>';
    }).join('');

    $$('#episodiosBox .episodio').forEach(function (b) {
      b.addEventListener('click', function () {
        const ep = Number(b.dataset.ep);
        const rotulo = m.titulo + ' S' + pad(numero) + 'E' + pad(ep);
        fecharModal();
        assistir(m, { temporada: numero, episodio: ep, rotulo: rotulo });
      });
    });
  } catch (e) { box.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>'; }
}

function mostrarTrailer(trailer) {
  if (!trailer) return;
  const box = document.createElement('div');
  box.className = 'trailer';
  box.innerHTML = '<iframe src="https://www.youtube.com/embed/' + esc(trailer.key) +
    '?autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
  els.modalBody.appendChild(box);
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* =============================== PLAYER ============================ */

function abrirPlayer(titulo) {
  state.podeTocar = false;
  state.streamUrl = null;
  state.subs = [];
  state.legendaAtiva = null;
  state.tentativa = 0;
  state.ss = 0;
  state.duracao = 0;
  state.sess = null;
  state.modoHls = false;
  state.audio = null;
  state.faixas = [];
  state.recarregando = false;
  state.ultimoRecarregar = 0;
  state.ultimoProgresso = Date.now();
  clearTimeout(state.introTimer);
  clearTimeout(state.guardTimer);
  if (hls) { try { hls.destroy(); } catch (e) { } hls = null; }
  if (els.pvIntro) els.pvIntro.classList.remove('on', 'saindo');
  if (els.selAudio) { els.selAudio.innerHTML = ''; els.selAudio.classList.add('hidden'); }
  els.video.muted = false;
  els.video.removeAttribute('src');
  $$('#video track').forEach(function (t) { t.remove(); });
  els.video.load();
  atualizarBotaoCC();
  els.pvTitle.textContent = titulo || 'Reproduzindo';
  els.pvCenter.classList.remove('oculto');
  els.pvMsg.textContent = 'Buscando fontes DUAL 5.1 PT-BR...';
  els.pvStats.textContent = '';
  els.pvFonte.textContent = '';
  els.pvFill.style.width = '0%';
  els.pvProgress.style.width = '0%';
  els.pvKnob.style.left = '0%';
  els.pvTime.textContent = '0:00 / 0:00';
  els.pvSheet.classList.add('hidden');
  els.player.classList.remove('hidden', 'controles-ocultos');
  document.body.classList.add('no-scroll');
  mostrarControles();
}

function fecharPlayer() {
  if (state.job) {
    const jobId = state.job;
    state.job = null;
    fetch(url('/api/play/stop', { jobId: jobId }), { keepalive: true }).catch(function () { });
  }
  clearTimeout(state.poll);
  clearTimeout(state.esconderTimer);
  clearTimeout(state.introTimer);
  clearTimeout(state.guardTimer);
  if (hls) { try { hls.destroy(); } catch (e) { } hls = null; }
  if (els.pvIntro) els.pvIntro.classList.remove('on', 'saindo');
  try { els.video.pause(); } catch (e) { }
  els.video.removeAttribute('src');
  els.video.load();
  els.player.classList.add('hidden');
  els.player.classList.remove('controles-ocultos');
  document.body.classList.remove('no-scroll');
  if (state.view === 'inicio') carregarInicio();
}

async function assistir(media, extra) {
  const ex = extra || {};
  state.media = media;
  state.temporada = ex.temporada || 1;
  state.episodio = ex.episodio || 1;
  marcarHistorico(media, ex.rotulo);
  abrirPlayer(ex.rotulo || media.titulo);

  const params = {
    titulo: media.titulo,
    tituloOriginal: media.tituloOriginal,
    ano: media.ano,
    imdbId: media.imdbId,
    tmdbId: media.id,
    tipo: media.tipo,
    temporada: state.temporada,
    episodio: state.episodio
  };

  try {
    const data = await api('/api/torrent', params);
    state.fontes = data.fontes || [];
    state.melhor = data.melhor;
    if (!state.melhor) { erroPlayer('Nenhum torrent encontrado para este titulo.'); return; }
    els.pvFonte.textContent = state.melhor.source + ' - ' +
      (state.melhor.ptbr ? state.melhor.ptbr.audio : '') + ' - ' + state.melhor.seeders + ' seeds';
    iniciarJob(state.melhor);
  } catch (e) { erroPlayer(e.message); }
}

async function iniciarJob(fonte) {
  if (!fonte) return;
  if (state.job) {
    const antigo = state.job;
    state.job = null;
    fetch(url('/api/play/stop', { jobId: antigo }), { keepalive: true }).catch(function () { });
  }
  clearTimeout(state.poll);
  state.podeTocar = false;
  state.legendaAtiva = null;
  state.subs = [];
  state.faixas = [];
  state.audio = null;
  if (hls) { try { hls.destroy(); } catch (e) { } hls = null; }
  els.video.removeAttribute('src');
  $$('#video track').forEach(function (t) { t.remove(); });
  els.video.load();
  els.pvCenter.classList.remove('oculto');
  els.pvMsg.textContent = 'Conectando aos peers...';
  els.pvFill.style.width = '0%';
  if (els.selAudio) { els.selAudio.innerHTML = ''; els.selAudio.classList.add('hidden'); }

  try {
    const data = await api('/api/play', {
      magnet: fonte.magnet, fileIdx: fonte.fileIdx, titulo: fonte.title, qualidade: fonte.quality
    });
    state.job = data.jobId;
    poll();
  } catch (e) { erroPlayer(e.message); }
}

function proximaFonte() {
  const atual = state.melhor;
  const idx = state.fontes.findIndex(function (f) { return atual && f.hash === atual.hash; });
  return state.fontes[idx + 1] || null;
}

function erroPlayer(msg, permitirTroca) {
  clearTimeout(state.poll);

  if (permitirTroca !== false && state.tentativa < 3) {
    const proxima = proximaFonte();
    if (proxima) {
      state.tentativa += 1;
      state.melhor = proxima;
      els.pvCenter.classList.remove('oculto');
      els.pvMsg.textContent = 'Fonte sem peer. Tentando outra (' + state.tentativa + '/3)...';
      els.pvStats.textContent = proxima.title;
      els.pvFonte.textContent = proxima.source + ' - ' + proxima.seeders + ' seeds';
      iniciarJob(proxima);
      return;
    }
  }

  els.pvCenter.classList.remove('oculto');
  els.pvCenter.innerHTML =
    '<p class="pv-erro">' + esc(msg) + '</p>' +
    '<button class="btn small" id="pvOutraFonte">Escolher outra fonte</button>' +
    '<button class="btn small ghost" id="pvSair">Sair</button>';
  $('#pvOutraFonte').addEventListener('click', abrirSheetFontes);
  $('#pvSair').addEventListener('click', fecharPlayer);
}

/* --------------------- sessao HLS / seek livre --------------------- */

function urlHls(ss) {
  const p = {
    jobId: state.job,
    hls: 1,
    ss: Math.max(0, Math.floor(ss || 0)),
    sess: state.sess
  };
  if (state.audio !== null && state.audio !== undefined) p.audio = state.audio;
  return url('/api/play/stream', p);
}

function urlDireto(pos) {
  const p = { jobId: state.job, modo: 'transcode', t: Math.max(0, Math.floor(pos || 0)) };
  if (state.audio !== null && state.audio !== undefined) p.audio = state.audio;
  return url('/api/play/stream', p);
}

function usarModoDireto(pos) {
  state.modoHls = false;
  if (hls) { try { hls.destroy(); } catch (e) { } hls = null; }
  els.video.src = urlDireto(pos);
  tentarPlay();
}

function iniciarHls(ss) {
  if (!state.job) return;
  state.sess = String(Date.now());
  state.ultimoRecarregar = Date.now();
  state.ultimoProgresso = Date.now();

  if (hls) { try { hls.destroy(); } catch (e) { } hls = null; }

  if (!window.Hls || !window.Hls.isSupported()) { usarModoDireto(ss); return; }

  const destino = urlHls(ss);
  hls = new window.Hls({
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 60,
    maxBufferLength: 60,
    maxMaxBufferLength: 180,
    startPosition: -1,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: Infinity,
    maxLiveSyncPlaybackRate: 1,
    manifestLoadingMaxRetry: 60,
    manifestLoadingRetryDelay: 400,
    manifestLoadingTimeOut: 20000,
    fragLoadingMaxRetry: 60,
    levelLoadingMaxRetry: 60
  });
  hls.attachMedia(els.video);
  hls.on(window.Hls.Events.MEDIA_ATTACHED, function () { hls.loadSource(destino); });
  hls.on(window.Hls.Events.ERROR, function (ev, d) {
    if (!d || !d.fatal) return;
    if (d.type === window.Hls.ErrorTypes.NETWORK_ERROR) { try { hls.startLoad(); } catch (e) { } }
    else if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR) { try { hls.recoverMediaError(); } catch (e) { } }
    else if (state.duracao) seekParaSegundos(state.ss);
  });
}

function recarregarPlaylist() {
  if (!hls || !state.podeTocar || state.recarregando || !state.modoHls) return;
  state.recarregando = true;
  state.ultimoRecarregar = Date.now();
  const pos = els.video.currentTime || 0;
  try {
    hls.config.startPosition = pos;
    hls.loadSource(urlHls(state.ss));
  } catch (e) { }
  setTimeout(function () { state.recarregando = false; }, 2000);
}

function vigiarPlayer() {
  if (!state.podeTocar || !state.modoHls || state.recarregando) return;
  if (els.video.paused || els.video.ended) { state.ultimoProgresso = Date.now(); return; }
  if (Date.now() - state.ultimoProgresso < 12000) return;
  recarregarPlaylist();
  setTimeout(tentarPlay, 700);
}

function armarGuarda() {
  clearTimeout(state.guardTimer);
  state.guardTimer = setTimeout(function () {
    if (!state.podeTocar || !state.modoHls) return;
    if (els.video.readyState >= 2 && !els.video.paused) return;
    toast('Alternando motor de video...');
    usarModoDireto(state.ss);
  }, 16000);
}

function seekParaSegundos(seg) {
  if (!state.job) return;
  const alvo = Math.max(0, Math.min((state.duracao || 0) - 1, Math.floor(seg)));

  if (!state.modoHls) {
    state.ss = 0;
    els.video.src = urlDireto(alvo);
    atualizarTempo();
    tentarPlay();
    return;
  }

  state.ss = alvo;
  els.pvCenter.classList.remove('oculto');
  els.pvMsg.textContent = 'Carregando ' + fmtTime(alvo) + '...';
  els.pvStats.textContent = '';
  atualizarTempo();
  iniciarHls(alvo);
}

function pular(segundos) {
  if (!state.podeTocar) return;
  const base = state.modoHls ? posicaoAbsoluta() : (els.video.currentTime || 0);
  const alvo = base + segundos;
  if (state.modoHls) seekParaSegundos(alvo);
  else if (isFinite(els.video.duration)) els.video.currentTime = Math.max(0, Math.min(els.video.duration - 1, alvo));
  mostrarControles();
}

function reiniciar() {
  if (!state.podeTocar) return;
  state.ss = 0;
  els.pvCenter.classList.add('oculto');
  els.pvProgress.style.width = '0%';
  els.pvKnob.style.left = '0%';
  els.pvTime.textContent = '0:00 / ' + fmtTime(state.duracao);
  if (state.modoHls) iniciarHls(0);
  else { try { els.video.currentTime = 0; } catch (e) { } }
  tentarPlay();
  mostrarControles();
}

/* --------------------------- intro + tudum ------------------------- */

function tocarTudum() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t = ctx.currentTime;

    const grave = ctx.createOscillator();
    grave.type = 'sine';
    grave.frequency.setValueAtTime(170, t);
    grave.frequency.exponentialRampToValueAtTime(40, t + 1.3);
    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.0001, t);
    g1.gain.exponentialRampToValueAtTime(0.85, t + 0.06);
    g1.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    grave.connect(g1).connect(ctx.destination);
    grave.start(t); grave.stop(t + 1.8);

    const brilho = ctx.createOscillator();
    brilho.type = 'triangle';
    brilho.frequency.setValueAtTime(920, t + 0.02);
    brilho.frequency.exponentialRampToValueAtTime(210, t + 1.0);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.22, t + 0.07);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    brilho.connect(g2).connect(ctx.destination);
    brilho.start(t + 0.02); brilho.stop(t + 1.3);

    setTimeout(function () { try { ctx.close(); } catch (e) { } }, 2600);
  } catch (e) { }
}

function tentarPlay() {
  const p = els.video.play();
  if (p && p.catch) p.catch(function () { });
}

function mostrarIntro() {
  if (!els.pvIntro) { tentarPlay(); return; }
  clearTimeout(state.introTimer);
  els.pvIntro.classList.remove('saindo');
  els.pvIntro.classList.add('on');
  els.video.muted = true;
  state.introFim = Date.now() + INTRO_MS;
  tocarTudum();
  state.introTimer = setTimeout(function () { finalizarIntro(); }, INTRO_MS);
}

function finalizarIntro() {
  clearTimeout(state.introTimer);
  esconderIntro();
  els.video.muted = state.mudo;
  tentarPlay();
}

function esconderIntro() {
  if (!els.pvIntro || !els.pvIntro.classList.contains('on')) return;
  els.pvIntro.classList.add('saindo');
  setTimeout(function () { els.pvIntro.classList.remove('on', 'saindo'); }, 520);
}

/* ----------------------------- overlay ----------------------------- */

function atualizarOverlay(s) {
  if (s.total) state.total = s.total;
  if (s.duracao) state.duracao = s.duracao;

  if (s.canPlay && !state.podeTocar) {
    state.podeTocar = true;
    state.streamUrl = s.streamUrl;
    state.modoHls = !!s.hls;
    state.ultimoProgresso = Date.now();
    mostrarIntro();
    iniciarHls(0);
    carregarLegendas();
    carregarFaixas();
    armarGuarda();
  }

  if (s.hlsErro && state.modoHls && els.video.readyState < 2) {
    state.modoHls = false;
    usarModoDireto(state.ss);
  }

  els.pvFill.style.width = Math.max(2, Math.min(100, s.buffer || 0)).toFixed(0) + '%';

  if (!state.podeTocar) {
    els.pvMsg.textContent = s.message || 'Conectando aos peers...';
    els.pvStats.textContent = (s.buffer || 0).toFixed(1) + '% | ' + s.peers + ' peers | ' +
      fmtSpeed(s.speed) + ' | ' + fmtSize(s.downloaded) + ' de ' + fmtSize(s.total);
  } else if (!els.pvCenter.classList.contains('oculto')) {
    els.pvMsg.textContent = 'Preparando video...';
    els.pvStats.textContent = s.peers + ' peers | ' + fmtSpeed(s.speed);
  }
}

async function poll() {
  if (!state.job) return;
  try {
    const s = await api('/api/play/status', { jobId: state.job });
    atualizarOverlay(s);
    if (s.state === 'erro') { erroPlayer(s.message); return; }
  } catch (e) { erroPlayer(e.message); return; }
  state.poll = setTimeout(poll, state.podeTocar ? 2000 : 700);
}

/* --------------------------- faixas de audio ----------------------- */

async function carregarFaixas() {
  if (!state.job) return;
  let faixas = [];
  let atual = null;
  try {
    const d = await api('/api/play/faixas', { jobId: state.job });
    faixas = d.faixas || [];
    atual = d.audio;
  } catch (e) {
    try {
      const s = await api('/api/play/status', { jobId: state.job });
      faixas = s.audioFaixas || [];
      atual = s.audioIdx;
    } catch (er) { }
  }
  preencherFaixas(faixas, atual);
}

function preencherFaixas(faixas, atual) {
  const sel = els.selAudio;
  if (!sel) return;
  state.faixas = faixas || [];
  if (state.faixas.length < 2) { sel.classList.add('hidden'); return; }

  sel.innerHTML = state.faixas.map(function (f, i) {
    const lang = String(f.lang || 'und').toUpperCase();
    const pt = f.ptbr ? ' &#9733;' : '';
    return '<option value="' + i + '">' + lang + pt + ' · ' + esc(f.titulo || f.codec || '') + '</option>';
  }).join('');
  sel.classList.remove('hidden');

  if (atual !== null && atual !== undefined && state.faixas[atual]) sel.value = String(atual);
  else {
    const pt = state.faixas.findIndex(function (f) { return f.ptbr; });
    sel.value = String(pt >= 0 ? pt : 0);
  }

  sel.onchange = function () {
    const idx = Number(sel.value);
    const pos = state.modoHls ? posicaoAbsoluta() : (els.video.currentTime || 0);
    state.audio = idx;
    toast('Trocando faixa de audio...');
    if (state.modoHls) seekParaSegundos(pos);
    else els.video.src = urlDireto(pos);
  };
}

/* ----------------------------- legendas ---------------------------- */

async function carregarLegendas() {
  if (!state.job) return;
  try {
    const data = await api('/api/play/subs', { jobId: state.job });
    state.subs = data.subs || [];
    if (state.subs.length) {
      const pt = state.subs.filter(function (s) { return s.code === 'pt-BR'; })[0];
      aplicarLegenda(pt ? pt.idx : null);
    }
  } catch (e) { }
}

function atualizarBotaoCC() {
  const b = $('#pvCC');
  if (b) b.classList.toggle('ativo', state.legendaAtiva !== null && state.legendaAtiva !== undefined);
}

function aplicarLegenda(idx) {
  $$('#video track').forEach(function (t) { t.remove(); });
  state.legendaAtiva = idx;
  atualizarBotaoCC();
  if (idx === null || idx === undefined) return;
  const s = state.subs.filter(function (x) { return x.idx === idx; })[0];
  if (!s) return;
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = s.label;
  track.srclang = s.code;
  track.src = API_BASE + '/api/play/subtitle?jobId=' + state.job + '&idx=' + s.idx;
  track.default = true;
  els.video.appendChild(track);
  setTimeout(function () { try { if (track.track) track.track.mode = 'showing'; } catch (e) { } }, 120);
}

/* ------------------------------ sheets ----------------------------- */

function abrirSheet(titulo, html) {
  els.pvSheetTitle.textContent = titulo;
  els.pvSheetBody.innerHTML = html;
  els.pvSheet.classList.remove('hidden');
  mostrarControles();
}

function abrirSheetFontes() {
  if (!state.fontes.length) { abrirSheet('Fontes', '<p class="pv-vazio">Nenhuma fonte carregada.</p>'); return; }
  const html = state.fontes.map(function (f, i) {
    const atual = state.melhor && f.hash === state.melhor.hash ? ' atual' : '';
    const nivel = f.ptbr ? f.ptbr.nivel : 'desconhecido';
    const cls = NIVEIS_BONS.indexOf(nivel) !== -1 ? 'br' : (nivel === 'estrangeiro' ? 'ruim' : '');
    return '<div class="pv-fonte-item' + atual + '" data-fonte-idx="' + i + '">' +
        '<div><div class="pv-fonte-nome">' + esc(f.title) + '</div>' +
          '<div class="pv-fonte-tags">' +
            '<span class="pv-badge">' + esc(f.quality || 'SD') + '</span>' +
            '<span class="pv-badge ' + cls + '">' + esc(f.ptbr ? f.ptbr.audio : '') + '</span>' +
            (f.size ? '<span>' + esc(f.size) + '</span>' : '') +
            '<span>' + f.seeders + ' seeds</span><span>' + esc(f.source) + '</span>' +
          '</div>' +
        '</div>' +
        '<button class="btn small' + (atual ? ' primary' : '') + '">' + (atual ? 'Atual' : 'Usar') + '</button>' +
      '</div>';
  }).join('');
  abrirSheet('Fontes (' + state.fontes.length + ')', html);
  $$('#pvSheetBody [data-fonte-idx]').forEach(function (n) {
    n.addEventListener('click', function () {
      const f = state.fontes[Number(n.dataset.fonteIdx)];
      state.melhor = f;
      state.tentativa = 0;
      els.pvSheet.classList.add('hidden');
      els.pvFonte.textContent = f.source + ' - ' + (f.ptbr ? f.ptbr.audio : '') + ' - ' + f.seeders + ' seeds';
      iniciarJob(f);
    });
  });
}

function abrirSheetLegendas() {
  if (!state.subs.length) { abrirSheet('Legendas', '<p class="pv-vazio">Nenhuma legenda dentro do torrent.</p>'); return; }
  const itens = [{ idx: null, label: 'Desativado', code: '' }].concat(state.subs);
  const html = itens.map(function (s) {
    const atual = (state.legendaAtiva === s.idx) ? ' atual' : '';
    return '<div class="pv-legenda-item' + atual + '" data-legenda="' + (s.idx === null ? '' : s.idx) + '">' +
      '<span>' + esc(s.label) + '</span><span>' + esc(s.code) + '</span></div>';
  }).join('');
  abrirSheet('Legendas', html);
  $$('#pvSheetBody [data-legenda]').forEach(function (n) {
    n.addEventListener('click', function () {
      const v = n.dataset.legenda;
      aplicarLegenda(v === '' ? null : Number(v));
      els.pvSheet.classList.add('hidden');
      toast(v === '' ? 'Legenda desativada' : 'Legenda ativada');
    });
  });
}

/* ----------------------------- controles --------------------------- */

function mostrarControles() {
  els.player.classList.remove('controles-ocultos');
  clearTimeout(state.esconderTimer);
  state.esconderTimer = setTimeout(function () {
    if (!els.video.paused && els.pvSheet.classList.contains('hidden')) els.player.classList.add('controles-ocultos');
  }, 3400);
}

function alternarPlay() {
  if (els.video.paused) { const p = els.video.play(); if (p && p.catch) p.catch(function () { }); }
  else els.video.pause();
}

function atualizarTempo() {
  const dur = state.duracao || (isFinite(els.video.duration) ? els.video.duration : 0);
  const atual = state.modoHls ? posicaoAbsoluta() : (els.video.currentTime || 0);
  const pct = dur ? Math.min(100, (atual / dur) * 100) : 0;
  els.pvProgress.style.width = pct + '%';
  els.pvKnob.style.left = pct + '%';
  els.pvTime.textContent = fmtTime(atual) + ' / ' + fmtTime(dur);
}

function pctSeek(clientX) {
  const r = els.pvSeek.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
}

function previaSeek(clientX) {
  const pct = pctSeek(clientX);
  els.pvProgress.style.width = (pct * 100) + '%';
  els.pvKnob.style.left = (pct * 100) + '%';
  const dur = state.duracao || (isFinite(els.video.duration) ? els.video.duration : 0);
  if (dur) els.pvTime.textContent = fmtTime(pct * dur) + ' / ' + fmtTime(dur);
}

/* ------------------------------ wiring ----------------------------- */

function wire() {
  $('#menuBtn').addEventListener('click', abrirDrawer);
  $('#drawerClose').addEventListener('click', fecharDrawer);
  els.drawerBackdrop.addEventListener('click', fecharDrawer);

  $$('.nav-link').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.dataset.view); fecharDrawer(); });
  });

  $$('.tipo-tab').forEach(function (b) {
    b.addEventListener('click', function () { setTipo(b.dataset.tipo); setView('inicio'); fecharDrawer(); });
  });

  $$('.bn-item').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.aba) setTipo(b.dataset.tipo);
      setView(b.dataset.view);
      $$('.bn-item').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      fecharDrawer();
    });
  });

  $('#brand').addEventListener('click', function (e) { e.preventDefault(); setView('inicio'); });
  $('#searchBtn').addEventListener('click', function () { setView('buscar'); });

  $('#searchGo').addEventListener('click', function () { buscar(els.searchInput.value); });
  els.searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') buscar(els.searchInput.value); });
  els.searchInput.addEventListener('input', function () {
    clearTimeout(state.buscaTimer);
    state.buscaTimer = setTimeout(function () { buscar(els.searchInput.value); }, 420);
  });

  $('#limparHistorico').addEventListener('click', function () {
    LS.del(K.historico); LS.del(K.continuar); renderHistorico(); toast('Historico limpo');
  });

  document.addEventListener('click', function (e) {
    const card = e.target.closest('[data-card]');
    if (card) { abrirDetalhes(card.dataset.tipo, card.dataset.id, false); return; }
    const gen = e.target.closest('[data-genero]');
    if (gen) { abrirGenero(gen.dataset.genero, gen.textContent); return; }
    if (e.target.closest('[data-close]')) fecharModal();
  });

  $('#pvClose').addEventListener('click', fecharPlayer);
  $('#pvFontes').addEventListener('click', abrirSheetFontes);
  $('#pvSheetClose').addEventListener('click', function () { els.pvSheet.classList.add('hidden'); });
  $('#pvPlay').addEventListener('click', alternarPlay);
  $('#pvBack30').addEventListener('click', function () { pular(-30); });
  $('#pvFwd30').addEventListener('click', function () { pular(30); });
  if ($('#pvReiniciar')) $('#pvReiniciar').addEventListener('click', reiniciar);
  $('#pvCC').addEventListener('click', abrirSheetLegendas);

  if (els.pvIntro) els.pvIntro.addEventListener('click', finalizarIntro);

  $('#pvMute').addEventListener('click', function () {
    state.mudo = !state.mudo;
    els.icoVol.classList.toggle('hidden', state.mudo);
    els.icoMudo.classList.toggle('hidden', !state.mudo);
    els.video.muted = state.mudo;
  });

  $('#pvFull').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (els.player.requestFullscreen) els.player.requestFullscreen();
    else if (els.video.webkitEnterFullscreen) els.video.webkitEnterFullscreen();
  });

  els.pvSeek.addEventListener('pointerdown', function (e) {
    state.arrastandoSeek = true;
    try { els.pvSeek.setPointerCapture(e.pointerId); } catch (err) { }
    previaSeek(e.clientX);
    mostrarControles();
  });
  els.pvSeek.addEventListener('pointermove', function (e) { if (state.arrastandoSeek) previaSeek(e.clientX); });
  els.pvSeek.addEventListener('pointerup', function (e) {
    if (!state.arrastandoSeek) return;
    state.arrastandoSeek = false;
    const dur = state.duracao || (isFinite(els.video.duration) ? els.video.duration : 0);
    if (dur) seekParaSegundos(pctSeek(e.clientX) * dur);
  });
  els.pvSeek.addEventListener('pointercancel', function () { state.arrastandoSeek = false; });

  els.player.addEventListener('pointermove', mostrarControles);
  els.player.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.pv-bottom') || e.target.closest('.pv-top') || e.target.closest('.pv-sheet') || e.target.closest('.pv-intro')) { mostrarControles(); return; }
    if (!els.player.classList.contains('controles-ocultos')) els.player.classList.add('controles-ocultos');
    else mostrarControles();
  });

  els.video.addEventListener('loadedmetadata', atualizarTempo);
  els.video.addEventListener('play', function () {
    els.icoPlay.classList.add('hidden'); els.icoPause.classList.remove('hidden'); mostrarControles();
  });
  els.video.addEventListener('pause', function () {
    els.icoPlay.classList.remove('hidden'); els.icoPause.classList.add('hidden'); mostrarControles();
  });
  els.video.addEventListener('playing', function () {
    els.pvCenter.classList.add('oculto');
    state.ultimoProgresso = Date.now();
    clearTimeout(state.guardTimer);
    mostrarControles();
  });
  els.video.addEventListener('waiting', function () {
    if (state.podeTocar && els.video.currentTime > 0 && !state.recarregando) {
      els.pvCenter.classList.remove('oculto');
      els.pvMsg.textContent = 'Carregando mais dados...';
      els.pvStats.textContent = '';
    }
  });
  els.video.addEventListener('timeupdate', function () {
    atualizarTempo();
    state.ultimoProgresso = Date.now();
    const agora = Date.now();
    if (agora - state.ultimoSalvar < 5000) return;
    state.ultimoSalvar = agora;
    salvarProgresso();
  });
  els.video.addEventListener('ended', function () {
    if (!state.modoHls || !state.podeTocar) return;
    if (posicaoAbsoluta() < state.duracao - 8) {
      recarregarPlaylist();
      setTimeout(tentarPlay, 900);
    }
  });
  els.video.addEventListener('error', function () {
    if (state.podeTocar && !state.recarregando) toast('Falha na reproducao. Use Fontes para trocar.', 'error');
  });

  document.addEventListener('keydown', function (e) {
    if (!els.player.classList.contains('hidden')) {
      if (e.key === 'Escape') fecharPlayer();
      if (e.key === ' ') { e.preventDefault(); alternarPlay(); }
      if (e.key === 'ArrowLeft') pular(-30);
      if (e.key === 'ArrowRight') pular(30);
      if (e.key === 'Home') reiniciar();
      if (e.key === 'f' || e.key === 'F') $('#pvFull').click();
      return;
    }
    if (e.key === 'Escape') { if (!els.modal.classList.contains('hidden')) fecharModal(); else fecharDrawer(); }
  });

  window.addEventListener('pagehide', function () {
    if (state.job) {
      const u = url('/api/play/stop', { jobId: state.job });
      if (navigator.sendBeacon) navigator.sendBeacon(u); else fetch(u, { keepalive: true }).catch(function () { });
    }
  });

  if (state.vigiaTimer) clearInterval(state.vigiaTimer);
  state.vigiaTimer = setInterval(vigiarPlayer, 2000);
}

/* -------------------------------- init ----------------------------- */

async function init() {
  wire();
  setTipo(state.tipo);
  try {
    const cfg = await api('/api/config');
    if (!cfg.tmdbConfigurado) mostrarAviso();
    const g = await api('/api/generos', { tipo: state.tipo });
    state.generos = g.generos || [];
  } catch (e) { if (/TMDB_API_KEY/.test(e.message)) mostrarAviso(); }
  renderLista();
  renderHistorico();
}

init();
'@

Write-Host ""
Write-Host "Verificando sintaxe..." -ForegroundColor Cyan
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    foreach ($f in @('src\streamer.js', 'public\app.js')) {
        $r = & node --check (Join-Path $Raiz $f) 2>&1
        if ($LASTEXITCODE -eq 0) { Write-Host ("  [ok] " + $f) -ForegroundColor Green }
        else { Write-Host ("  [ERRO] " + $f + " -> " + $r) -ForegroundColor Red }
    }
} else {
    Write-Host '  node nao encontrado no PATH.' -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Reinicie o servidor (Ctrl+C e npm start) e teste o mesmo filme." -ForegroundColor Green
Write-Host "Se ainda travar, o console do servidor mostra as linhas [hls] com o motivo exato." -ForegroundColor DarkGray
Write-Host ""