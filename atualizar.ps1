<#
    CineP2P 8.0 - Player Universal: stream bruto + audio decodificado no navegador
    -------------------------------------------------------------------------------
    Executa SOBRE o CineP2P 7.0 (mantendo Series/SXXEXX e o filtro anti-mistura).

    Mudancas:
      1. src/streamer.js: TRANSCODE=nunca por padrao. Sem ffprobe, sem ffmpeg.
         Stream BitTorrent bruto com Range: bytes completo. canPlay com 1%.
      2. public/app.js: player universal. Le o cabecalho MKV no proprio navegador,
         identifica as faixas de audio e, quando o codec e AC3/EAC3/DTS ou a faixa
         PT nao e a primeira, ativa um pipeline de RESGATE: demux MKV em JS +
         decodificacao via Web Audio API, com a faixa em portugues selecionada
         automaticamente e sincronizada com o video.
      3. src/ranking.js: descarte sumario de instaladores/ativadores/ISOs.
      4. public/index.html: sem avisos, sem barras, sem botoes extras.

    Uso: powershell -ExecutionPolicy Bypass -File .\atualizar.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [string]$Root
)

if ($PSVersionTable.PSVersion.Major -le 5 -and -not $env:CINEP2P_UTF8) {
    try {
        $selfPath = $MyInvocation.MyCommand.Path
        if ($selfPath -and (Test-Path -LiteralPath $selfPath)) {
            $raw = [System.IO.File]::ReadAllBytes($selfPath)
            $hasBom = ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF)
            $hasNonAscii = $false
            foreach ($b in $raw) { if ($b -gt 127) { $hasNonAscii = $true; break } }
            if (-not $hasBom -and $hasNonAscii) {
                $text = [System.Text.Encoding]::UTF8.GetString($raw)
                $tmp = Join-Path $env:TEMP ('cinep2p-' + [guid]::NewGuid().ToString('N') + '.ps1')
                [System.IO.File]::WriteAllText($tmp, $text, [System.Text.UTF8Encoding]::new($true))
                $env:CINEP2P_UTF8 = '1'
                Write-Host 'Reexecutando com codificacao UTF-8...' -ForegroundColor DarkGray
                & powershell -NoProfile -ExecutionPolicy Bypass -File $tmp @args
                exit $LASTEXITCODE
            }
        }
    } catch { }
}

$ErrorActionPreference = 'Stop'

if (-not $Root -or $Root.Trim() -eq '') { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $Root -or $Root.Trim() -eq '') { $Root = (Get-Location).Path }
if (-not (Test-Path -LiteralPath $Root)) { throw "Pasta nao encontrada: $Root" }
Set-Location -LiteralPath $Root

$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Write-ProjectFile {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Content
    )
    $full = Join-Path $Root $RelativePath
    $dir = Split-Path -Parent $full
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [System.IO.File]::WriteAllText($full, $Content, $Utf8NoBom)
    Write-Host ("  [ok] " + $RelativePath) -ForegroundColor DarkGray
}

function Write-Step { param([string]$Text) Write-Host ''; Write-Host ("== " + $Text) -ForegroundColor Cyan }

Write-Host ''
Write-Host '  CineP2P 8.0 - Player universal + audio no navegador' -ForegroundColor White
Write-Host '  ---------------------------------------------------' -ForegroundColor DarkGray

# ----------------------------------------------------------------------
Write-Step 'Backup'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupDir = Join-Path $Root ('.backup-' + $Stamp)
$madeBackup = $false
foreach ($t in @('server.js', 'src', 'public', '.env')) {
    $p = Join-Path $Root $t
    if (Test-Path -LiteralPath $p) {
        if (-not $madeBackup) { New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null; $madeBackup = $true }
        Copy-Item -LiteralPath $p -Destination (Join-Path $BackupDir $t) -Recurse -Force
    }
}
if ($madeBackup) { Write-Host ("  backup: " + (Split-Path -Leaf $BackupDir)) -ForegroundColor DarkGray }

New-Item -ItemType Directory -Force -Path (Join-Path $Root 'src') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'public') | Out-Null

# ======================================================================
Write-Step 'Ranking: descarte de instaladores'

# ----------------------------------------------------------------------
$rankingJs = @'
'use strict';

/**
 * Ranking: identidade -> descarte de instalador -> nivel de audio -> seeders.
 *
 * Regra nova: qualquer resultado que pareca instalador de PC, ativador ou
 * imagem de disco e sumariamente rejeitado antes de tudo.
 */

const ptbr = require('./ptbr');
const validar = require('./validar');

const RANK_NIVEL = {
  duals51: 6, confirmado: 5, provavel: 4, incerto: 3, fraco: 2, estrangeiro: 1, desconhecido: 0
};

/* Sinais fortes: sozinhos ja condenam o arquivo */
const RE_INSTALADOR_FORTE = /(monkrus|preactivated|pre-activated|\bkeygen\b|\bcrack(ed|eado)?\b|\bactivator\b|\bativador\b|\bportable\b|\bkms(?:pico|auto)?\b|\.exe\b|\.iso\b|\.img\b|\.zip\b|\.rar\b|\.7z\b|\.msi\b|\bx64\b|\bx86\b|\bwin(?:dows)?\b)/i;

/* Sinais fracos: so condenam se nao houver marcador de video */
const RE_INSTALADOR_FRACO = /(\brepack\b|\bpatch\b|\bsetup\b|\binstaller\b|\binstalador\b|\bserial\b|\bmedicine\b|\bupdate\b)/i;

const RE_MARCADOR_VIDEO = /(2160p|1440p|1080p|720p|480p|4k|bluray|bdrip|brrip|webrip|web[\s._-]?dl|remux|hdtv|dvdrip|x264|x265|h264|h265|hevc|av1)/i;

function ehInstalador(nome) {
  const n = String(nome || '');
  if (RE_INSTALADOR_FORTE.test(n)) return true;
  if (RE_INSTALADOR_FRACO.test(n) && !RE_MARCADOR_VIDEO.test(n)) return true;
  if (RE_INSTALADOR_FRACO.test(n) && !/\b(19|20)\d{2}\b/.test(n) && !RE_MARCADOR_VIDEO.test(n)) return true;
  return false;
}

function pad(n) { return String(n || 1).padStart(2, '0'); }

function bonusQualidade(q) {
  switch (String(q || '').toLowerCase()) {
    case '1080p': return 520;
    case '720p': return 300;
    case '2160p': return 430;
    case '480p': return 80;
    default: return 150;
  }
}

function contemPalavras(titulo, alvo) {
  if (!alvo) return false;
  const t = String(titulo).toLowerCase();
  return String(alvo).toLowerCase().split(/[^a-z0-9]+/)
    .filter(function (w) { return w.length > 3; })
    .some(function (w) { return t.indexOf(w) !== -1; });
}

function pontuar(item, ctx) {
  let s = (RANK_NIVEL[item.ptbr.nivel] || 0) * 100000;
  s += Math.log10(Math.max(1, item.seeders) + 1) * 1200;
  s += bonusQualidade(item.quality);

  if (item.ptbr.temDual51) s += 900;
  if (contemPalavras(item.title, ctx.titulo)) s += 220;
  if (contemPalavras(item.title, ctx.tituloOriginal)) s += 180;
  if (item.fileIdx !== null && item.fileIdx !== undefined) s += 70;

  if (ctx.tipo === 'tv') {
    const tag = 'S' + pad(ctx.temporada) + 'E' + pad(ctx.episodio);
    const reExato = new RegExp(tag, 'i');
    const reOutroEp = /\bS\d{1,2}E\d{1,2}\b/i;
    const rePack = /(complete|completa|temporada\s*\d|season\s*\d|\bpack\b)/i;
    if (reExato.test(item.title)) s += 1200;
    else if (reOutroEp.test(item.title)) s -= 200;
    if (rePack.test(item.title) && !reExato.test(item.title)) s -= 600;
  } else if (ctx.ano && String(item.title).indexOf(String(ctx.ano)) !== -1) {
    s += 260;
  }

  if (item.quality === '2160p' && item.seeders < 15) s -= 900;
  if (item.quality === '2160p' && /(\bdv\b|dolby[\s._-]?vision|hdr10|\bhdr\b)/i.test(item.title)) s -= 250;
  if (/(\bcam\b|\bts\b|hdcam|hdts|telesync)/i.test(item.title)) s -= 450;
  if (item.seeders === 0) s -= 400;
  if (item.sizeBytes && item.sizeBytes < 200 * 1024 * 1024) s -= 60;

  return s;
}

function normalizar(item) {
  const nome = String(item.title || '').replace(/\s+/g, ' ').trim();
  return {
    title: nome || 'Torrent',
    magnet: item.magnet,
    hash: String(item.hash || '').toLowerCase(),
    quality: item.quality || '',
    size: item.size || '',
    sizeBytes: item.sizeBytes || 0,
    seeders: Number(item.seeders || 0),
    fileIdx: (item.fileIdx === null || item.fileIdx === undefined) ? null : item.fileIdx,
    source: item.source || 'Desconhecida',
    imdbConfirmado: !!item.imdbConfirmado,
    score: 0,
    ptbr: null,
    elegivel: false
  };
}

function deduplicar(lista) {
  const mapa = new Map();
  lista.forEach(function (item) {
    const chave = item.hash || item.magnet;
    if (!chave) return;
    const atual = mapa.get(chave);
    if (!atual) { mapa.set(chave, item); return; }
    if (item.score > atual.score) { mapa.set(chave, item); return; }
    if (item.seeders > atual.seeders) atual.seeders = item.seeders;
    if (!atual.size && item.size) { atual.size = item.size; atual.sizeBytes = item.sizeBytes; }
    if (atual.fileIdx === null && item.fileIdx !== null) atual.fileIdx = item.fileIdx;
    if (!atual.quality && item.quality) atual.quality = item.quality;
  });
  return Array.from(mapa.values());
}

function preparar(lista, ctx) {
  const estrito = process.env.FILTRO_ESTRITO !== '0';
  const semInstalador = process.env.FILTRO_INSTALADOR !== '0';

  const validos = [];
  const descartados = [];

  lista
    .filter(function (i) { return i && i.magnet && /^magnet:/i.test(i.magnet); })
    .forEach(function (bruto) {
      const item = normalizar(bruto);

      if (semInstalador && ehInstalador(item.title)) {
        item.valido = false;
        item.motivoInvalido = 'descartado: instalador/ativador/iso';
        descartados.push(item);
        return;
      }

      if (!estrito || item.imdbConfirmado) {
        item.valido = true;
        item.motivoInvalido = item.imdbConfirmado ? 'imdb id confirmado' : 'filtro desligado';
      } else {
        const v = validar.validar(item.title, ctx);
        item.valido = v.ok;
        item.motivoInvalido = v.ok ? v.motivo : ('descartado: ' + v.motivo);
      }

      if (item.valido) validos.push(item);
      else descartados.push(item);
    });

  validos.forEach(function (i) {
    i.ptbr = ptbr.avaliar(i.title, i.source);
    i.elegivel = i.ptbr.elegivel;
    i.score = pontuar(i, ctx);
  });

  const unicos = deduplicar(validos);
  unicos.sort(function (a, b) { return b.score - a.score; });
  return { validos: unicos, descartados: descartados };
}

module.exports = { preparar: preparar, RANK_NIVEL: RANK_NIVEL, ehInstalador: ehInstalador };
'@
Write-ProjectFile 'src/ranking.js' $rankingJs

# ======================================================================
Write-Step 'Streamer: stream bruto, zero CPU'

# ----------------------------------------------------------------------
$streamerJs = @'
'use strict';

/**
 * Streamer 8.0 - modo BRUTO.
 *
 *  - TRANSCODE=nunca (padrao): nenhum ffprobe, nenhum ffmpeg. O arquivo do
 *    torrent e servido direto com Range: bytes, CPU zero, inicio instantaneo.
 *  - canPlay em 1% de buffer (ou 2 MB), o que faz o video comecar na hora.
 *  - O frontend cuida do audio: le o cabecalho MKV, escolhe a faixa PT e,
 *    se o codec for AC3/EAC3/DTS, decodifica em JS via Web Audio.
 *  - TRANSCODE=auto|sempre continua disponivel (usa ffmpeg, agora opcional).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebTorrent = require('webtorrent');

const trackers = require('./trackers');
const subtitulos = require('./subtitulos');

const TRACKERS = trackers.TRACKERS;
const appendTrackers = trackers.appendTrackers;

const MODO_TRANSCODE = String(process.env.TRANSCODE || 'nunca').toLowerCase();

/* ------------------- ffmpeg (so carrega se precisar) ---------------- */

let ffmpegLib = null;
let FFMPEG_PATH = '';
let FFPROBE_PATH = '';

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

if (MODO_TRANSCODE !== 'nunca') carregarFfmpeg();

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
const MAX_CONNS = Number(process.env.MAX_CONNS || 300);
const MIN_BUFFER_PERCENT = Number(process.env.MIN_BUFFER_PERCENT || 1);
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
    subs: [], tentativas: 0,
    transcode: MODO_TRANSCODE !== 'nunca',
    analisado: MODO_TRANSCODE === 'nunca',
    duracao: 0, videoCodec: '', audioCodec: '', audioIdx: 0, motivoTranscode: '',
    torrent: null, file: null, nudge: null, vigia: null, timers: []
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
      return { idx: idx, fileIndex: x.i, nome: String(x.f.name).split('/').pop(), code: lang.code, label: lang.label };
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

  // Modo bruto: nada de ffprobe, nada de ffmpeg. Ja esta analisado.
  if (MODO_TRANSCODE === 'nunca') {
    job.analisado = true;
    job.transcode = false;
    job.motivoTranscode = 'bruto';
    return;
  }

  job.message = 'Analisando codecs...';
  analisar(job).catch(function () { }).then(function () {
    job.analisado = true;
    job.message = job.transcode ? 'Convertendo audio...' : 'Stream direto.';
  });
}

/* ------------------- ffprobe (apenas modo transcode) --------------- */

function ffprobeStream(file) {
  return new Promise(function (resolve) {
    if (!FFPROBE_PATH) { resolve(null); return; }
    const { spawn } = require('child_process');
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

  let idxPt = -1;
  audios.forEach(function (a, i) {
    const lang = String((a.tags && (a.tags.language || a.tags.LANGUAGE)) || '').toLowerCase();
    if (idxPt === -1 && /por|pt|bra/.test(lang)) idxPt = i;
  });
  job.audioIdx = idxPt >= 0 ? idxPt : 0;
  job.audioCodec = audios[job.audioIdx] ? String(audios[job.audioIdx].codec_name || '') : '';

  const audioRuim = job.audioCodec && !AUDIO_OK_NAV.test(job.audioCodec);
  const videoRuim = job.videoCodec && !VIDEO_OK_MP4.test(job.videoCodec);

  if (MODO_TRANSCODE === 'sempre') job.transcode = true;
  else job.transcode = !!(audioRuim || videoRuim);
}

/* ------------------------------- HTTP ------------------------------ */

function handle(jobId, req, res) {
  const job = jobs.get(jobId);
  if (!job) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Job nao encontrado.'); return; }
  job.lastAccess = agora();

  if (job.state === 'erro') { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); res.end(job.message); return; }

  const file = job.file;
  if (!file) { res.writeHead(202, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Aguardando metadados...'); return; }

  const modoPedido = String(req.query.modo || '').toLowerCase();
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
    '-map 0:a:' + job.audioIdx,
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

async function legenda(jobId, idx) {
  const job = jobs.get(jobId);
  if (!job || !job.subs || !job.subs[idx]) return null;
  const sub = job.subs[idx];
  const file = job.torrent && job.torrent.files[sub.fileIndex];
  if (!file) return null;
  job.lastAccess = agora();
  const texto = await lerArquivo(file);
  return { nome: sub.nome, code: sub.code, label: sub.label, vtt: subtitulos.converter(texto, subtitulos.extensao(file.name)) };
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
    duracao: job.duracao || 0,
    subs: job.subs ? job.subs.map(function (s) { return { idx: s.idx, nome: s.nome, code: s.code, label: s.label }; }) : [],
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
  FFMPEG_OK: !!FFMPEG_PATH, FFPROBE_OK: !!FFPROBE_PATH, MODO_TRANSCODE: MODO_TRANSCODE
};
'@
Write-ProjectFile 'src/streamer.js' $streamerJs

# ======================================================================
Write-Step 'Frontend'

# ----------------------------------------------------------------------
$indexHtml = @'
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0a0b">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>CineP2P</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/placeholder.svg">
<link rel="preconnect" href="https://image.tmdb.org">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/player.css">
<link rel="stylesheet" href="/series.css">
</head>
<body>

<header class="topbar">
  <button class="icon-btn" id="menuBtn" aria-label="Abrir menu">
    <svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
  </button>

  <a class="brand" id="brand" href="#">Cine<span>P2P</span></a>

  <nav class="tipo-tabs" id="tipoTabs">
    <button class="tipo-tab active" data-tipo="movie">Filmes</button>
    <button class="tipo-tab" data-tipo="tv">Series</button>
  </nav>

  <nav class="topnav" id="topnav">
    <button class="nav-link active" data-view="inicio">Inicio</button>
    <button class="nav-link" data-view="buscar">Buscar</button>
    <button class="nav-link" data-view="historico">Historico</button>
    <button class="nav-link" data-view="lista">Minha Lista</button>
    <button class="nav-link" data-view="categorias">Categorias</button>
  </nav>

  <div class="topbar-actions">
    <button class="icon-btn" id="searchBtn" aria-label="Buscar">
      <svg viewBox="0 0 24 24" width="21" height="21"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16.5 16.5 21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
  </div>
</header>

<aside id="drawer" class="drawer hidden">
  <div class="drawer-head">
    <span class="brand">Cine<span>P2P</span></span>
    <button class="icon-btn" id="drawerClose" aria-label="Fechar">
      <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
  </div>
  <div class="drawer-tipos">
    <button class="tipo-tab active" data-tipo="movie">Filmes</button>
    <button class="tipo-tab" data-tipo="tv">Series</button>
  </div>
  <nav class="drawer-nav">
    <button class="nav-link" data-view="inicio">Inicio</button>
    <button class="nav-link" data-view="buscar">Buscar</button>
    <button class="nav-link" data-view="historico">Historico</button>
    <button class="nav-link" data-view="lista">Minha Lista</button>
    <button class="nav-link" data-view="categorias">Categorias</button>
  </nav>
  <p class="drawer-foot">CineP2P 8.0</p>
</aside>
<div id="drawerBackdrop" class="drawer-backdrop hidden"></div>

<main id="app">
  <section id="view-inicio" class="view">
    <section id="hero" class="hero"></section>
    <div id="rows" class="rows"></div>
  </section>

  <section id="view-buscar" class="view hidden">
    <div class="searchbar">
      <input id="searchInput" type="search" placeholder="Buscar..." autocomplete="off">
      <button class="btn small" id="searchGo">Buscar</button>
    </div>
    <div id="searchResults" class="grid"></div>
  </section>

  <section id="view-lista" class="view hidden">
    <h1 class="view-title">Minha Lista</h1>
    <div id="listaGrid" class="grid"></div>
  </section>

  <section id="view-historico" class="view hidden">
    <h1 class="view-title">Historico</h1>
    <div id="historicoGrid" class="grid"></div>
    <button class="btn ghost limpar" id="limparHistorico">Limpar historico</button>
  </section>

  <section id="view-categorias" class="view hidden">
    <h1 class="view-title">Categorias</h1>
    <div id="categoriasChips" class="chips"></div>
    <div id="categoriasGrid" class="grid"></div>
  </section>
</main>

<nav class="bottom-nav">
  <button class="bn-item active" data-view="inicio" data-tipo="movie">
    <svg viewBox="0 0 24 24" width="21" height="21"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
    <span>Inicio</span>
  </button>
  <button class="bn-item" data-view="inicio" data-tipo="movie" data-aba="filmes">
    <svg viewBox="0 0 24 24" width="21" height="21"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2"/></svg>
    <span>Filmes</span>
  </button>
  <button class="bn-item" data-view="inicio" data-tipo="tv" data-aba="series">
    <svg viewBox="0 0 24 24" width="21" height="21"><rect x="3" y="7" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <span>Series</span>
  </button>
  <button class="bn-item" data-view="lista">
    <svg viewBox="0 0 24 24" width="21" height="21"><path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
    <span>Lista</span>
  </button>
  <button class="bn-item" data-view="historico">
    <svg viewBox="0 0 24 24" width="21" height="21"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <span>Historico</span>
  </button>
</nav>

<div id="modal" class="modal hidden">
  <div class="modal-backdrop" data-close></div>
  <div class="modal-card" role="dialog" aria-modal="true">
    <button class="modal-close" data-close aria-label="Fechar">
      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
    <div id="modalBody" class="modal-body"></div>
  </div>
</div>

<!-- ============================ PLAYER ============================ -->
<div id="player" class="player hidden">
  <video id="video" playsinline webkit-playsinline preload="auto" autoplay></video>

  <div class="pv-top" id="pvTop">
    <button class="pv-btn" id="pvClose" aria-label="Voltar">
      <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="pv-title" id="pvTitle">Reproduzindo</div>
    <button class="pv-btn pv-txt" id="pvFontes">Fontes</button>
  </div>

  <div class="pv-center" id="pvCenter">
    <div class="pv-spinner"></div>
    <p class="pv-msg" id="pvMsg">Conectando aos peers...</p>
    <div class="pv-bar"><i id="pvFill"></i></div>
    <p class="pv-stats" id="pvStats"></p>
    <p class="pv-fonte" id="pvFonte"></p>
  </div>

  <div class="pv-bottom" id="pvBottom">
    <div class="pv-seek" id="pvSeek">
      <div class="pv-seek-track"><i id="pvProgress"></i></div>
      <div class="pv-seek-knob" id="pvKnob"></div>
    </div>
    <div class="pv-row">
      <button class="pv-btn" id="pvPlay" aria-label="Play/Pause">
        <svg id="icoPlay" viewBox="0 0 24 24" width="26" height="26"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>
        <svg id="icoPause" class="hidden" viewBox="0 0 24 24" width="26" height="26"><path d="M7 4.5h4v15H7zM13 4.5h4v15h-4z" fill="currentColor"/></svg>
      </button>
      <button class="pv-btn" id="pvBack30" aria-label="Voltar 30 segundos">
        <svg viewBox="0 0 24 24" width="26" height="26"><path d="M11 5V2L6 6l5 4V7a6 6 0 1 1-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="17" font-size="8" font-weight="700" fill="currentColor" text-anchor="middle">30</text></svg>
      </button>
      <button class="pv-btn" id="pvFwd30" aria-label="Avancar 30 segundos">
        <svg viewBox="0 0 24 24" width="26" height="26"><path d="M13 5V2l5 4-5 4V7a6 6 0 1 0 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="17" font-size="8" font-weight="700" fill="currentColor" text-anchor="middle">30</text></svg>
      </button>
      <span class="pv-time" id="pvTime">0:00 / 0:00</span>
      <span class="pv-spacer"></span>
      <button class="pv-btn" id="pvMute" aria-label="Volume">
        <svg id="icoVol" viewBox="0 0 24 24" width="24" height="24"><path d="M4 9h3l5-4v14l-5-4H4z" fill="currentColor"/><path d="M15 9.5a4 4 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <svg id="icoMudo" class="hidden" viewBox="0 0 24 24" width="24" height="24"><path d="M4 9h3l5-4v14l-5-4H4z" fill="currentColor"/><path d="M15 9l5 6M20 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      <button class="pv-btn pv-cc" id="pvCC" aria-label="Legendas">CC</button>
      <button class="pv-btn" id="pvFull" aria-label="Tela cheia">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>

  <div class="pv-sheet hidden" id="pvSheet">
    <div class="pv-sheet-head">
      <strong id="pvSheetTitle">Fontes</strong>
      <button class="pv-btn" id="pvSheetClose" aria-label="Fechar">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="pv-sheet-body" id="pvSheetBody"></div>
  </div>
</div>

<div id="toast" class="toast hidden"></div>

<script src="/config.js"></script>
<script src="/app.js"></script>
</body>
</html>
'@
Write-ProjectFile 'public/index.html' $indexHtml

# ----------------------------------------------------------------------
$appJs = @'
'use strict';

/* =====================================================================
   CineP2P 8.0 - player universal

   Video: stream BitTorrent bruto (Range), abre instantaneo.
   Audio: o navegador le o cabecalho MKV, escolhe a faixa PT e, quando o
          codec e AC3/EAC3/DTS (ou a faixa PT nao e a primeira), ativa o
          RESGATE: demux MKV em JavaScript + decodificacao via Web Audio,
          sincronizada com o video. Nenhum servidor de transcode.
   ===================================================================== */

const API_BASE = String(window.CINEP2P_API_BASE || '').replace(/\/+$/, '');
const PLACEHOLDER = '/placeholder.svg';
const NIVEIS_BONS = ['duals51', 'confirmado', 'provavel'];

const $ = function (s, r) { return (r || document).querySelector(s); };
const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

const LS = {
  get: function (k, d) { try { const v = window.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set: function (k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
  del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { } }
};

const K = { lista: 'cinep2p:lista', historico: 'cinep2p:historico', continuar: 'cinep2p:continuar', tipo: 'cinep2p:tipo' };

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
  total: 0,
  duracao: 0,
  mudo: false,
  volume: 1,
  esconderTimer: null,
  arrastandoSeek: false
};

const els = {
  hero: $('#hero'), rows: $('#rows'),
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
function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

let toastTimer = null;
function toast(msg, tipo) {
  els.toast.textContent = msg;
  els.toast.className = 'toast' + (tipo === 'error' ? ' error' : '');
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
  api('/api/generos', { tipo: state.tipo }).then(function (g) { state.generos = g.generos || []; }).catch(function () { });
  carregarInicio();
}

function abrirDrawer() { els.drawer.classList.remove('hidden'); els.drawerBackdrop.classList.remove('hidden'); }
function fecharDrawer() { els.drawer.classList.add('hidden'); els.drawerBackdrop.classList.add('hidden'); }

/* ------------------------------- home ------------------------------ */

function skeleton() {
  let html = '';
  for (let i = 0; i < 3; i++) {
    html += '<div class="row"><div class="sk sk-title"></div><div class="scroller">';
    for (let j = 0; j < 6; j++) html += '<div class="sk sk-card"></div>';
    html += '</div></div>';
  }
  return html;
}

function renderHero(item) {
  if (!item) { els.hero.innerHTML = ''; els.hero.style.backgroundImage = 'none'; return; }
  els.hero.style.backgroundImage = 'url("' + (item.backdrop || item.poster || PLACEHOLDER) + '")';
  els.hero.innerHTML =
    '<div class="hero-inner">' +
      '<p class="hero-kicker">' + (item.tipo === 'tv' ? 'Serie em destaque' : 'Destaque de hoje') + '</p>' +
      '<h1 class="hero-title">' + esc(item.titulo) + '</h1>' +
      '<p class="hero-meta">' + esc(item.ano || '') + (item.nota ? ' &middot; &#9733; ' + item.nota.toFixed(1) : '') + '</p>' +
      '<p class="hero-sinopse">' + esc(item.sinopse || '') + '</p>' +
      '<div class="hero-actions">' +
        '<button class="btn primary" id="heroAssistir">' + (item.tipo === 'tv' ? 'Ver episodios' : 'Assistir agora') + '</button>' +
        '<button class="btn ghost" id="heroTrailer">Assistir trailer</button>' +
        '<button class="btn ghost" id="heroFavoritar">Favoritar</button>' +
      '</div>' +
    '</div>';
  $('#heroAssistir').addEventListener('click', function () {
    if (item.tipo === 'tv') abrirDetalhes('tv', item.id, false);
    else assistir(item);
  });
  $('#heroTrailer').addEventListener('click', function () { abrirDetalhes(item.tipo || 'movie', item.id, true); });
  $('#heroFavoritar').addEventListener('click', function () { alternarFavorito(item); });
}

function rowHtml(titulo, itens, opts) {
  return '<section class="row"><h2>' + esc(titulo) + '</h2><div class="scroller">' +
    itens.map(function (i) { return cardHtml(i, opts); }).join('') + '</div></section>';
}

async function carregarInicio() {
  els.rows.innerHTML = skeleton();
  try {
    const data = await api('/api/home', { tipo: state.tipo });
    renderHero(data.hero);
    let html = '';
    if (state.tipo === 'movie') {
      const continuar = LS.get(K.continuar, []);
      if (continuar.length) html += rowHtml('Continue Assistindo', continuar, { progresso: true });
    }
    data.rows.forEach(function (r) { html += rowHtml(r.titulo, r.itens, {}); });
    els.rows.innerHTML = html || '<p class="vazio">Sem resultados.</p>';
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

function salvarProgresso() {
  if (!state.media || state.media.tipo === 'tv') return;
  const dur = els.video.duration;
  if (!dur || !isFinite(dur)) return;
  const pct = Math.min(100, (els.video.currentTime / dur) * 100);
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

/* =========================== DEMUX MKV ============================== */

const EBML = {
  SEG: 0x18538067, INFO: 0x1549A966, TRACKS: 0x1654AE6B, ENTRY: 0xAE,
  TRACKNUM: 0xD7, TRACKTYPE: 0x83, CODECID: 0x86, CODECPRIV: 0x63A2,
  LANG: 0x22B59C, LANG2: 0x22B59D, AUDIO: 0xE1, CHANNELS: 0x9F,
  CLUSTER: 0x1F43B675, TIMECODE: 0xE7, SIMPLEBLOCK: 0xA3, BLOCKGROUP: 0xA0, BLOCK: 0xA1,
  SCALE: 0x2AD7B1, HEADER: 0x1A45DFA3
};

function criarParserMkv(cb) {
  let buf = new Uint8Array(0);
  let pos = 0;
  const fins = [];
  const tipos = [];
  let escala = 1000000;
  let tsCluster = 0;
  let entry = {};
  let modoSimples = false;
  let sincronizado = false;
  let ligado = true;

  function lerId(p) {
    if (p >= buf.length) return null;
    const b0 = buf[p];
    if (b0 === 0) return null;
    let n = 1;
    if (!(b0 & 0x80)) {
      if (b0 & 0x40) n = 2; else if (b0 & 0x20) n = 3; else if (b0 & 0x10) n = 4; else return null;
    }
    if (p + n > buf.length) return null;
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + buf[p + i];
    return { v: v, n: n };
  }

  function lerTam(p) {
    if (p >= buf.length) return null;
    const b0 = buf[p];
    if (b0 === 0) return null;
    let n = 1, mask = 0x80;
    while (n <= 8 && !(b0 & mask)) { mask >>= 1; n++; }
    if (n > 8 || p + n > buf.length) return null;
    let v = b0 & (mask - 1);
    let todosFf = ((b0 & (mask - 1)) === (mask - 1));
    for (let i = 1; i < n; i++) {
      v = v * 256 + buf[p + i];
      if (buf[p + i] !== 0xFF) todosFf = false;
    }
    return { v: v, n: n, desconhecido: todosFf };
  }

  function uint(p, fim) {
    if (fim > buf.length) return null;
    let v = 0;
    for (let i = p; i < fim; i++) v = v * 256 + buf[i];
    return v;
  }

  function texto(p, fim) {
    if (fim > buf.length) return null;
    let s = '';
    for (let i = p; i < fim; i++) { const c = buf[i]; if (c >= 32 && c < 127) s += String.fromCharCode(c); }
    return s.trim();
  }

  function finalizarEntry() {
    if (entry && entry.n && entry.tipo === 2 && cb.aoFaixa) {
      cb.aoFaixa({
        numero: entry.n,
        lang: (entry.lang || '').toLowerCase(),
        codec: entry.codec || '',
        canais: entry.canais || 0,
        codecPrivado: entry.codecPrivado || null
      });
    }
    entry = {};
  }

  function blocos(p, fim) {
    const tn = lerTam(p);
    if (!tn) return;
    let off = p + tn.n;
    if (off + 3 > fim) return;
    let ts = (buf[off] << 8) | buf[off + 1];
    if (ts & 0x8000) ts -= 0x10000;
    off += 2;
    const flags = buf[off]; off++;
    const lace = (flags >> 1) & 3;
    const partes = [];

    if (lace === 0) {
      partes.push([off, fim]);
    } else {
      const n = buf[off] + 1; off++;
      const tamanhos = [];
      if (lace === 1) {
        let total = 0;
        for (let i = 0; i < n - 1; i++) {
          let s = 0, b;
          do { b = buf[off++]; s += b; } while (b === 255 && off < fim);
          tamanhos.push(s); total += s;
        }
        tamanhos.push(Math.max(0, fim - off - total));
      } else if (lace === 3) {
        const s0 = lerTam(off);
        if (!s0) return;
        off += s0.n;
        tamanhos.push(s0.v);
        let total = s0.v;
        for (let i = 1; i < n - 1; i++) {
          const d = lerTam(off);
          if (!d) return;
          off += d.n;
          const dv = d.v - Math.pow(2, 7 * d.n - 1) + 1;
          tamanhos.push(dv); total += dv;
        }
        tamanhos.push(Math.max(0, fim - off - total));
      } else {
        const t = Math.floor((fim - off) / n);
        for (let i = 0; i < n; i++) tamanhos.push(t);
      }
      let cur = off;
      tamanhos.forEach(function (t) { partes.push([cur, cur + t]); cur += t; });
    }

    const tsSeg = (tsCluster + ts) * escala / 1e9;
    partes.forEach(function (pp) {
      if (pp[1] > pp[0] && cb.aoFrame) cb.aoFrame(tn.v, tsSeg, buf.subarray(pp[0], pp[1]));
    });
  }

  function processar() {
    let voltas = 0;
    while (ligado && voltas++ < 200000) {
      while (fins.length && pos >= fins[fins.length - 1]) {
        const t = tipos.pop(); fins.pop();
        if (t === 'entry') finalizarEntry();
      }
      if (buf.length - pos < 2) break;

      if (modoSimples && !sincronizado) {
        let achou = -1;
        for (let i = pos; i + 4 <= buf.length; i++) {
          if (buf[i] === 0x1F && buf[i + 1] === 0x43 && buf[i + 2] === 0xB6 && buf[i + 3] === 0x75) { achou = i; break; }
        }
        if (achou < 0) { pos = Math.max(pos, buf.length - 3); break; }
        pos = achou;
        sincronizado = true;
      }

      const id = lerId(pos);
      if (!id) break;
      const tam = lerTam(pos + id.n);
      if (!tam) break;

      const idv = id.v;
      const ini = pos + id.n + tam.n;
      const fim = tam.desconhecido ? Infinity : ini + tam.v;

      if (idv === EBML.CLUSTER) { tsCluster = 0; pos = ini; fins.push(fim); tipos.push('cluster'); continue; }
      if (idv === EBML.SEG || idv === EBML.HEADER) { pos = ini; fins.push(fim); tipos.push('seg'); continue; }
      if (idv === EBML.INFO) { pos = ini; fins.push(fim); tipos.push('info'); continue; }
      if (!modoSimples && idv === EBML.TRACKS) { pos = ini; fins.push(fim); tipos.push('tracks'); continue; }
      if (!modoSimples && idv === EBML.ENTRY) { entry = {}; pos = ini; fins.push(fim); tipos.push('entry'); continue; }
      if (idv === EBML.AUDIO) { pos = ini; fins.push(fim); tipos.push('audio'); continue; }
      if (idv === EBML.BLOCKGROUP) { pos = ini; fins.push(fim); tipos.push('bg'); continue; }

      if (idv === EBML.SCALE) { const r = uint(ini, fim); if (r === null) break; escala = r || escala; pos = fim; continue; }
      if (idv === EBML.TIMECODE) { const r = uint(ini, fim); if (r === null) break; tsCluster = r; pos = fim; continue; }

      if (!modoSimples && idv === EBML.TRACKNUM) { const r = uint(ini, fim); if (r === null) break; entry.n = r; pos = fim; continue; }
      if (!modoSimples && idv === EBML.TRACKTYPE) { const r = uint(ini, fim); if (r === null) break; entry.tipo = r; pos = fim; continue; }
      if (!modoSimples && idv === EBML.CHANNELS) { const r = uint(ini, fim); if (r === null) break; entry.canais = r; pos = fim; continue; }
      if (!modoSimples && idv === EBML.CODECID) { const r = texto(ini, fim); if (r === null) break; entry.codec = r; pos = fim; continue; }
      if (!modoSimples && (idv === EBML.LANG || idv === EBML.LANG2)) { const r = texto(ini, fim); if (r === null) break; if (!entry.lang) entry.lang = r; pos = fim; continue; }
      if (!modoSimples && idv === EBML.CODECPRIV) { if (fim > buf.length) break; entry.codecPrivado = buf.subarray(ini, fim); pos = fim; continue; }

      if (idv === EBML.SIMPLEBLOCK || idv === EBML.BLOCK) {
        if (fim > buf.length) break;
        blocos(ini, fim);
        pos = fim;
        continue;
      }

      if (fim === Infinity) { pos = ini; fins.push(fim); tipos.push('x'); continue; }
      if (fim > buf.length) break;
      pos = fim;
    }

    if (pos > 0) { buf = buf.subarray(pos); pos = 0; }
  }

  return {
    empurrar: function (dados) {
      if (!ligado) return;
      const novo = new Uint8Array(buf.length + dados.length);
      novo.set(buf, 0);
      novo.set(dados, buf.length);
      buf = novo;
      processar();
    },
    modoSimples: function () { modoSimples = true; sincronizado = false; },
    desligar: function () { ligado = false; }
  };
}

function juntarBytes(lista) {
  let total = 0;
  lista.forEach(function (b) { total += b.length; });
  const out = new Uint8Array(total);
  let p = 0;
  lista.forEach(function (b) { out.set(b, p); p += b.length; });
  return out;
}

function comAdts(frame, asc) {
  if (!asc || asc.length < 2) return frame;
  const objType = (asc[0] >> 3) & 0x1F;
  const perfil = Math.max(0, objType - 1);
  const freq = ((asc[0] & 0x07) << 1) | ((asc[1] >> 7) & 0x01);
  const canais = (asc[1] >> 3) & 0x0F;
  const tam = frame.length + 7;
  const h = new Uint8Array(7);
  h[0] = 0xFF; h[1] = 0xF1;
  h[2] = (perfil << 6) | (freq << 2) | ((canais >> 2) & 1);
  h[3] = ((canais & 3) << 6) | ((tam >> 11) & 3);
  h[4] = (tam >> 3) & 0xFF;
  h[5] = ((tam & 7) << 5) | 0x1F;
  h[6] = 0xFC;
  const out = new Uint8Array(tam);
  out.set(h, 0);
  out.set(frame, 7);
  return out;
}

/* ========================== RESGATE DE AUDIO ======================== */

const audio = {
  ctx: null,
  ganho: null,
  ativo: false,
  abort: null,
  leitor: null,
  parser: null,
  trackNum: 0,
  asc: null,
  aac: false,
  pendente: [],
  pendenteTs: 0,
  pendenteTam: 0,
  fila: [],
  fontes: [],
  ultimoTs: 0,
  processando: false,
  falhas: 0,
  info: null
};

function pararResgate() {
  audio.ativo = false;
  if (audio.abort) { try { audio.abort.abort(); } catch (e) { } audio.abort = null; }
  if (audio.parser) { audio.parser.desligar(); audio.parser = null; }
  audio.fontes.forEach(function (s) { try { s.stop(); } catch (e) { } });
  audio.fontes = [];
  audio.fila = [];
  audio.pendente = [];
  audio.pendenteTam = 0;
  audio.pendenteTs = 0;
  audio.ultimoTs = 0;
  audio.leitor = null;
}

function volumeAplicado() {
  return state.mudo ? 0 : state.volume;
}

async function analisarCabecalho() {
  const alvo = API_BASE + state.streamUrl;
  const res = await fetch(alvo, { headers: { Range: 'bytes=0-1048575' } });
  const dados = new Uint8Array(await res.arrayBuffer());
  const info = { container: '?', audio: [] };
  if (dados.length > 8 && dados[0] === 0x1A && dados[1] === 0x45 && dados[2] === 0xDF && dados[3] === 0xA3) info.container = 'mkv';
  else if (dados.length > 12 && dados[4] === 0x66 && dados[5] === 0x74 && dados[6] === 0x79 && dados[7] === 0x70) info.container = 'mp4';
  if (info.container !== 'mkv') return info;

  const parser = criarParserMkv({
    aoFaixa: function (f) { info.audio.push(f); },
    aoFrame: function () { }
  });
  parser.empurrar(dados);
  parser.desligar();
  return info;
}

function decidirResgate(info) {
  if (!info || info.container !== 'mkv') return false;
  const faixas = info.audio || [];
  if (!faixas.length) return false;

  const pt = faixas.filter(function (f) { return /por|pt|bra|portugu/.test(f.lang); })[0];
  const alvo = pt || faixas[0];
  const codec = String(alvo.codec || '').toLowerCase();

  const seguro = /(a_aac|aac|a_mp3|mp3|a_opus|a_vorbis|a_flac|a_ac3|eac3|ec-3)/.test(codec);
  const problematico = /(dts|dca|truehd|mlp|pcm|lpcm|a_real)/.test(codec);
  const primeiro = faixas[0] === alvo;

  if (problematico) return true;
  if (!primeiro) return true;
  if (!seguro) return true;
  return false;
}

async function iniciarResgate(info, inicioBytes) {
  pararResgate();

  const faixas = info.audio || [];
  const pt = faixas.filter(function (f) { return /por|pt|bra|portugu/.test(f.lang); })[0];
  const alvo = pt || faixas[0];
  if (!alvo) return;

  audio.info = info;
  audio.trackNum = alvo.numero;
  audio.asc = alvo.codecPrivado || null;
  audio.aac = /aac/i.test(alvo.codec || '');

  if (!audio.ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio.ctx = new Ctx();
    audio.ganho = audio.ctx.createGain();
    audio.ganho.gain.value = volumeAplicado();
    audio.ganho.connect(audio.ctx.destination);
  }
  try { if (audio.ctx.state === 'suspended') await audio.ctx.resume(); } catch (e) { }

  const ctrl = new AbortController();
  audio.abort = ctrl;
  audio.ativo = true;
  audio.falhas = 0;
  audio.ultimoTs = 0;

  const parser = criarParserMkv({
    aoFaixa: function () { },
    aoFrame: function (tn, ts, bytes) {
      if (tn !== audio.trackNum) return;
      if (ts + 0.4 < els.video.currentTime - 1) return;
      let b = bytes;
      if (audio.aac) b = comAdts(bytes, audio.asc);
      if (audio.pendenteTs === 0) audio.pendenteTs = ts;
      audio.pendente.push(new Uint8Array(b));
      audio.pendenteTam += b.length;
      if (ts - audio.pendenteTs >= 0.45) descarregar();
    }
  });
  if (inicioBytes > 0) parser.modoSimples();
  audio.parser = parser;

  try {
    const res = await fetch(API_BASE + state.streamUrl, {
      headers: { Range: 'bytes=' + inicioBytes + '-' },
      signal: ctrl.signal
    });
    if (!res.body) throw new Error('sem corpo');
    audio.leitor = res.body.getReader();
  } catch (e) {
    audio.ativo = false;
    return;
  }

  while (audio.ativo) {
    if (audio.ultimoTs - els.video.currentTime > 12) { await esperar(150); continue; }
    let r;
    try { r = await audio.leitor.read(); } catch (e) { break; }
    if (r.done) break;
    parser.empurrar(r.value);
  }
}

function descarregar() {
  if (!audio.pendente.length) return;
  const dados = juntarBytes(audio.pendente);
  const ts = audio.pendenteTs;
  audio.pendente = [];
  audio.pendenteTam = 0;
  audio.pendenteTs = 0;
  audio.fila.push({ ts: ts, dados: dados });
  processarFila();
}

async function processarFila() {
  if (audio.processando) return;
  audio.processando = true;
  while (audio.fila.length && audio.ativo) {
    const item = audio.fila.shift();
    if (item.ts + 1 < els.video.currentTime - 0.5) continue;
    try {
      const copia = item.dados.slice(0);
      const buf = await audio.ctx.decodeAudioData(copia.buffer);
      agendar(item.ts, buf);
      audio.falhas = 0;
      if (els.video.muted !== true && audio.fontes.length === 1) {
        els.video.muted = true;
        audio.ganho.gain.value = volumeAplicado();
      }
    } catch (e) {
      audio.falhas++;
      if (audio.falhas > 12) { audio.ativo = false; els.video.muted = false; }
    }
  }
  audio.processando = false;
}

function agendar(ts, buf) {
  const agora = audio.ctx.currentTime;
  let quando = agora + (ts - els.video.currentTime);
  if (quando < agora + 0.02) quando = agora + 0.02;
  const src = audio.ctx.createBufferSource();
  src.buffer = buf;
  src.connect(audio.ganho);
  try { src.start(quando); } catch (e) { return; }
  audio.fontes.push(src);
  audio.ultimoTs = Math.max(audio.ultimoTs, ts + buf.duration);
  src.onended = function () {
    const i = audio.fontes.indexOf(src);
    if (i >= 0) audio.fontes.splice(i, 1);
  };
}

function byteEstimado(t) {
  const dur = els.video.duration;
  if (!dur || !isFinite(dur) || !state.total) return 0;
  return Math.max(0, Math.floor((t / dur) * state.total));
}

async function reiniciarResgate() {
  if (!audio.info) return;
  const t = els.video.currentTime;
  pararResgate();
  audio.fontes.forEach(function (s) { try { s.stop(); } catch (e) { } });
  audio.fontes = [];
  await iniciarResgate(audio.info, byteEstimado(t));
}

/* =============================== PLAYER ============================ */

function abrirPlayer(titulo) {
  state.podeTocar = false;
  state.streamUrl = null;
  state.subs = [];
  state.legendaAtiva = null;
  state.tentativa = 0;
  pararResgate();
  els.video.removeAttribute('src');
  $$('#video track').forEach(function (t) { t.remove(); });
  els.video.load();
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
  pararResgate();
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
  pararResgate();
  els.video.removeAttribute('src');
  $$('#video track').forEach(function (t) { t.remove(); });
  els.video.load();
  els.pvCenter.classList.remove('oculto');
  els.pvMsg.textContent = 'Conectando aos peers...';
  els.pvFill.style.width = '0%';

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

let analiseEmCurso = false;

function atualizarOverlay(s) {
  if (s.total) state.total = s.total;

  if (s.canPlay && !state.podeTocar) {
    state.podeTocar = true;
    state.streamUrl = s.streamUrl;
    els.video.src = API_BASE + s.streamUrl;
    const p = els.video.play();
    if (p && p.catch) p.catch(function () { });
    carregarLegendas();
    if (!analiseEmCurso) {
      analiseEmCurso = true;
      analisarCabecalho().then(function (info) {
        if (decidirResgate(info)) iniciarResgate(info, 0);
      }).catch(function () { }).then(function () { analiseEmCurso = false; });
    }
  }

  els.pvFill.style.width = Math.max(2, Math.min(100, s.buffer || 0)).toFixed(0) + '%';

  if (!state.podeTocar) {
    els.pvMsg.textContent = s.message || 'Conectando aos peers...';
    els.pvStats.textContent = (s.buffer || 0).toFixed(1) + '% | ' + s.peers + ' peers | ' +
      fmtSpeed(s.speed) + ' | ' + fmtSize(s.downloaded) + ' de ' + fmtSize(s.total);
  } else {
    els.pvMsg.textContent = 'Iniciando...';
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
  state.poll = setTimeout(poll, state.podeTocar ? 2500 : 700);
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

function aplicarLegenda(idx) {
  $$('#video track').forEach(function (t) { t.remove(); });
  state.legendaAtiva = idx;
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

function pular(segundos) {
  if (!isFinite(els.video.duration)) return;
  els.video.currentTime = Math.max(0, Math.min(els.video.duration - 1, els.video.currentTime + segundos));
  mostrarControles();
}

function atualizarTempo() {
  const dur = isFinite(els.video.duration) ? els.video.duration : 0;
  const atual = els.video.currentTime || 0;
  const pct = dur ? Math.min(100, (atual / dur) * 100) : 0;
  els.pvProgress.style.width = pct + '%';
  els.pvKnob.style.left = pct + '%';
  els.pvTime.textContent = fmtTime(atual) + ' / ' + fmtTime(dur);
}

function seekPara(clientX) {
  const r = els.pvSeek.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  if (isFinite(els.video.duration)) els.video.currentTime = pct * els.video.duration;
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
  $('#pvCC').addEventListener('click', abrirSheetLegendas);

  $('#pvMute').addEventListener('click', function () {
    state.mudo = !state.mudo;
    els.icoVol.classList.toggle('hidden', state.mudo);
    els.icoMudo.classList.toggle('hidden', !state.mudo);
    if (audio.ativo && audio.ganho) audio.ganho.gain.value = volumeAplicado();
    else els.video.muted = state.mudo;
  });

  $('#pvFull').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (els.player.requestFullscreen) els.player.requestFullscreen();
    else if (els.video.webkitEnterFullscreen) els.video.webkitEnterFullscreen();
  });

  els.pvSeek.addEventListener('pointerdown', function (e) {
    state.arrastandoSeek = true;
    try { els.pvSeek.setPointerCapture(e.pointerId); } catch (err) { }
    seekPara(e.clientX);
  });
  els.pvSeek.addEventListener('pointermove', function (e) { if (state.arrastandoSeek) seekPara(e.clientX); });
  els.pvSeek.addEventListener('pointerup', function () { state.arrastandoSeek = false; });
  els.pvSeek.addEventListener('pointercancel', function () { state.arrastandoSeek = false; });

  els.player.addEventListener('pointermove', mostrarControles);
  els.player.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.pv-bottom') || e.target.closest('.pv-top') || e.target.closest('.pv-sheet')) { mostrarControles(); return; }
    if (!els.player.classList.contains('controles-ocultos')) els.player.classList.add('controles-ocultos');
    else mostrarControles();
  });

  els.video.addEventListener('loadedmetadata', atualizarTempo);
  els.video.addEventListener('play', function () {
    els.icoPlay.classList.add('hidden'); els.icoPause.classList.remove('hidden'); mostrarControles();
    if (audio.ctx && audio.ctx.state === 'suspended') { try { audio.ctx.resume(); } catch (e) { } }
  });
  els.video.addEventListener('pause', function () {
    els.icoPlay.classList.remove('hidden'); els.icoPause.classList.add('hidden'); mostrarControles();
    if (audio.ctx && audio.ctx.state === 'running') { try { audio.ctx.suspend(); } catch (e) { } }
  });
  els.video.addEventListener('playing', function () {
    els.pvCenter.classList.add('oculto'); mostrarControles();
  });
  els.video.addEventListener('waiting', function () {
    if (state.podeTocar) {
      els.pvCenter.classList.remove('oculto');
      els.pvMsg.textContent = 'Carregando mais dados...';
      els.pvStats.textContent = '';
    }
  });
  els.video.addEventListener('timeupdate', function () {
    atualizarTempo();
    const agora = Date.now();
    if (agora - state.ultimoSalvar < 5000) return;
    state.ultimoSalvar = agora;
    salvarProgresso();
  });
  els.video.addEventListener('seeked', function () {
    if (audio.ativo) reiniciarResgate();
  });
  els.video.addEventListener('error', function () {
    if (state.podeTocar) toast('Falha na reproducao. Use Fontes para trocar.', 'error');
  });

  document.addEventListener('keydown', function (e) {
    if (!els.player.classList.contains('hidden')) {
      if (e.key === 'Escape') fecharPlayer();
      if (e.key === ' ') { e.preventDefault(); alternarPlay(); }
      if (e.key === 'ArrowLeft') pular(-30);
      if (e.key === 'ArrowRight') pular(30);
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
Write-ProjectFile 'public/app.js' $appJs

# ======================================================================
Write-Step 'Configuracao'

# ----------------------------------------------------------------------
$envPath = Join-Path $Root '.env'
$existingKey = ''
if (Test-Path -LiteralPath $envPath) {
    $existing = [System.IO.File]::ReadAllText($envPath)
    $m = [regex]::Match($existing, '(?m)^\s*TMDB_API_KEY\s*=\s*(.*)$')
    if ($m.Success) { $existingKey = $m.Groups[1].Value.Trim() }
}
$keyToWrite = 'SUA_CHAVE_AQUI'
if ($existingKey -ne '' -and $existingKey -ne 'SUA_CHAVE_AQUI') { $keyToWrite = $existingKey }

$envContent = @"
# ============================================================
#  CineP2P 8.0 - stream bruto + audio decodificado no navegador
#  TMDB_API_KEY obrigatoria. https://www.themoviedb.org/settings/api
# ============================================================
TMDB_API_KEY=$keyToWrite
TMDB_LANGUAGE=pt-BR
TMDB_REGION=BR

# Servidor
PORT=3000
HOST=0.0.0.0

# Filtros
FILTRO_ESTRITO=1
FILTRO_INSTALADOR=1

# Scrapers (vazio = todos)
SCRAPER_TIMEOUT=9
SCRAPERS_ENABLED=

# Player - modo BRUTO: nenhum ffmpeg, CPU zero, inicio instantaneo
TRANSCODE=nunca
METADATA_TIMEOUT=60
BUFFER_TIMEOUT=150
MAX_CONNS=300
MAX_JOBS=3
IDLE_TIMEOUT=900000
MIN_BUFFER_PERCENT=1
MIN_BUFFER_MB=2

# uTP: 0 = somente TCP
ENABLE_UTP=0

# Legendas
MAX_SUBS=8

# Limpeza de disco: session = apaga ao fechar | keep = mantem cache
CACHE_MODE=session
TORRENT_CACHE_DIR=cache
"@
Write-ProjectFile '.env' $envContent
Write-ProjectFile '.env.example' ($envContent -replace [regex]::Escape($keyToWrite), 'SUA_CHAVE_AQUI')
if ($keyToWrite -ne 'SUA_CHAVE_AQUI') { Write-Host '  TMDB_API_KEY preservada' -ForegroundColor DarkGray }

# ----------------------------------------------------------------------
$packageJson = @'
{
  "name": "cinep2p",
  "version": "8.0.0",
  "private": true,
  "description": "Streaming P2P com filtro IMDb e audio decodificado no proprio navegador.",
  "type": "commonjs",
  "main": "server.js",
  "scripts": { "start": "node server.js", "dev": "node server.js" },
  "engines": { "node": ">=18" },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "webtorrent": "^1.9.7"
  },
  "optionalDependencies": {
    "@ffmpeg-installer/ffmpeg": "^1.1.0",
    "@ffprobe-installer/ffprobe": "^2.1.2",
    "fluent-ffmpeg": "^2.1.3"
  }
}
'@
Write-ProjectFile 'package.json' $packageJson

# ----------------------------------------------------------------------
$readme = @'
# CineP2P 8.0

## Arquitetura do player

Servidor serve o arquivo BitTorrent BRUTO com `Range: bytes`. Zero CPU,
zero ffmpeg, sem ffprobe. O video comeca com 1% de buffer.

O audio e resolvido no navegador:

1. Ao iniciar o video, o frontend baixa os primeiros 1 MB e faz o parse do
   cabecalho MKV em JavaScript (EBML puro).
2. Identifica as faixas de audio, o codec e o idioma de cada uma.
3. Se a faixa em portugues nao for a primeira, ou o codec for AC3/EAC3/DTS/
   TrueHD/PCM (que o navegador nao decodifica), ativa o RESGATE:
   - segunda conexao HTTP com Range no mesmo stream;
   - demux MKV em JS (SimpleBlock, lacing Xiph/EBML/fixo, timecodes);
   - decodificacao via Web Audio API (`decodeAudioData`), com envelope ADTS
     automatico para AAC;
   - agendamento dos buffers contra `video.currentTime`, com video mutado.

Resultado: audio em portugues audivel, sem transcode no servidor e sem
nenhum player externo.

## Filtros
- `src/validar.js` descarta links de outros filmes (titulo + ano vs IMDb).
- `src/ranking.js` descarta instaladores, ativadores, ISOs, RAR/ZIP, cracks.
  Desligue com `FILTRO_INSTALADOR=0`.

## Rodar
`npm start` -> http://localhost:3000

## Voltar ao transcode
`TRANSCODE=auto` (so quando o codec exigir) ou `TRANSCODE=sempre`.
Nesses modos o ffmpeg entra em acao; sem ele o app continua funcionando
em modo bruto.
'@
Write-ProjectFile 'README.md' $readme

# ======================================================================
if (-not $SkipInstall) {
    Write-Step 'Instalando dependencias'
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Push-Location -LiteralPath $Root
        try {
            & npm install --no-fund --no-audit --loglevel=error
            if ($LASTEXITCODE -ne 0) { Write-Host '  npm install com erro. Rode manualmente.' -ForegroundColor Yellow }
        } finally { Pop-Location }
    } else { Write-Host '  npm nao encontrado. Instale Node.js 18+.' -ForegroundColor Yellow }
} else { Write-Step 'npm install ignorado' }

Write-Step 'Validando'
if (Get-Command node -ErrorAction SilentlyContinue) {
    Push-Location -LiteralPath $Root
    try {
        & node -e "require('./src/validar');require('./src/ranking');require('./src/magnets');require('./src/scrapers');const s=require('./src/streamer');console.log('  modulos ok | modo:', s.MODO_TRANSCODE)"
    } catch { }
    finally { Pop-Location }
}

Write-Host ''
Write-Host '==================================================================' -ForegroundColor Green
Write-Host ' CineP2P 8.0 aplicado' -ForegroundColor Green
Write-Host '==================================================================' -ForegroundColor Green
Write-Host ''
Write-Host ' Servidor: stream bruto com Range, CPU zero, sem ffmpeg' -ForegroundColor White
Write-Host ' Player: demux MKV em JS + Web Audio, faixa PT automatica' -ForegroundColor White
Write-Host ' Ranking: descarte de instalador/ativador/ISO' -ForegroundColor White
Write-Host ''
Write-Host ' PROXIMOS PASSOS:' -ForegroundColor Yellow
Write-Host '   1) npm start'
Write-Host '   2) http://localhost:3000'
Write-Host ''
if ($madeBackup) { Write-Host (' Backup: ' + (Split-Path -Leaf $BackupDir)) -ForegroundColor DarkGray }
Write-Host ''