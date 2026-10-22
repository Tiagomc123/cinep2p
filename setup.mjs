#!/usr/bin/env node
// Gera o projeto cinep2p completo + cinep2p.zip
// Uso: node setup.mjs   (rode na raiz do repositorio)
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = process.cwd()
const files = {}

const fix = s => s.replace(/^\n/, '').replace(/\\\$\{/g, '${').replace(/\\`/g, '`')
const add = (p, s) => { files[p] = fix(s) }

/* ============================ package.json ============================ */
add('package.json', String.raw`
{
  "name": "cinep2p",
  "version": "0.3.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "https": "node server.js --https"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "express": "^4.19.2",
    "ffmpeg-static": "^5.2.0",
    "ffprobe-static": "^3.1.0",
    "selfsigned": "^2.4.1",
    "webtorrent": "^2.6.8"
  }
}
`)

/* ============================= .gitignore ============================= */
add('.gitignore', String.raw`
node_modules/
downloads/
data/
certs/
.env
cinep2p.zip
`)

/* ============================== README.md ============================= */
add('README.md', String.raw`
# cinep2p

Catalogo de filmes/series + busca de magnet + streaming de torrent no navegador.
Funciona no PC, no celular Android, na TV Box e no projetor.

## Requisitos

- Node.js 20 ou superior
- ffmpeg: ja vem junto (pacotes ffmpeg-static/ffprobe-static). Se quiser usar
  o do sistema, defina FFMPEG_PATH.

## Rodar

    npm install
    npm run https      # https://SEU-IP:3000  <- use este para instalar como app
    npm start          # http://localhost:3000

Abra o endereco de rede mostrado no terminal.

## Instalar como aplicativo (Android / TV Box / projetor)

1. Rode: npm run https
2. No aparelho, abra https://IP-DO-PC:3000 e aceite o aviso do certificado.
3. Toque no botao "Instalar app" (ou menu do navegador -> Instalar aplicativo).
4. Fica com icone proprio, tela cheia e sem barra do navegador.

Se quiser um .apk de verdade: publique a mesma URL no pwabuilder.com
(ou use o Chrome -> "Instalar aplicativo"). O .apk continua precisando do
servidor ligado no PC, que e ele que baixa o torrent.

Controle remoto: setas navegam, OK seleciona, Voltar fecha o player,
Enter no video abre os botoes. O botao "TV" aumenta a interface.

## Recursos

- Catalogo e capas: API publica do YTS (com espelhos de reserva)
- Fontes extra: apibay (The Pirate Bay), com filtro "Dublado"
- Troca de idioma do audio pelas faixas reais do arquivo (remux)
- Legendas externas e embutidas no mkv, com ligar/desligar
- Continuar de onde parou (sincronizado entre os aparelhos)
- Modos: Direto -> Compativel (remux) -> Leve (transcode 720p/480p), com
  fallback automatico quando o navegador recusa o formato
- Botao Diagnostico: mostra peers, arquivo, codec, leitura e decisao

## Cache e limpeza

- Torrents em ./downloads/<hash> (pode apagar quando quiser).
- Progresso em ./data/progress.json.
- Torrents ociosos sao liberados sozinhos apos IDLE_MINUTES (padrao 40 min).

## Variaveis

PORT, DOWNLOAD_DIR, DATA_DIR, METADATA_TIMEOUT (120), IDLE_MINUTES (40),
TRANSCODE_PRESET (ultrafast em PC fraco), TRANSCODE_CRF, MAX_CONNS,
PROBE_BYTES, FFMPEG_PATH, FFPROBE_PATH, FFMPEG_DISABLE=1, QUIET=1, HTTPS=1.
`)

/* ============================= src/lang.js ============================ */
add('src/lang.js', String.raw`
// Deteccao de idioma em nomes de release + nomes de codigos ISO.

const NAMES = {
  por: 'Portugues', pob: 'Portugues (BR)', pt: 'Portugues', ptbr: 'Portugues (BR)',
  eng: 'Ingles', en: 'Ingles', spa: 'Espanhol', es: 'Espanhol', lat: 'Latino',
  ita: 'Italiano', it: 'Italiano', fra: 'Frances', fre: 'Frances', fr: 'Frances',
  deu: 'Alemao', ger: 'Alemao', de: 'Alemao', jpn: 'Japones', jp: 'Japones',
  kor: 'Coreano', rus: 'Russo', zho: 'Chines', chi: 'Chines', zh: 'Chines',
  ara: 'Arabe', hin: 'Hindi', nld: 'Holandes', dut: 'Holandes', nl: 'Holandes',
  pol: 'Polones', tur: 'Turco', swe: 'Sueco', ces: 'Tcheco', cze: 'Tcheco',
  hun: 'Hungaro', heb: 'Hebraico', ell: 'Grego', gre: 'Grego', dan: 'Dinamarques',
  nor: 'Noruegues', fin: 'Finlandes', ukr: 'Ucraniano', ron: 'Romeno', rum: 'Romeno',
  ind: 'Indonesio', tha: 'Tailandes', vie: 'Vietnamita', cat: 'Catalao', fas: 'Persa',
  mul: 'Multi-idioma', und: 'Original'
}
export const langName = c => NAMES[String(c || '').toLowerCase()] || String(c || '').toUpperCase() || 'Desconhecido'

const PT = /(dublado|dublada|pt[-_ .]?br|ptbr|portugu[eê]s|portugues|nacional|brazilian|br[-_ ]?dub)/i
const DUAL = /(dual[ ._-]?[aá]udio|dual|multi[ ._-]?[aá]udio|multi)/i
const LEG = /(legendado|legendad[ao]|subbed)/i

const LANGS = [
  [/\b(ita|italian)\b/i, 'ita'], [/\b(spa|espa[ñn]ol|castellano|latino|spanish)\b/i, 'spa'],
  [/\b(fra|french|truefrench|vff|vfq)\b/i, 'fra'], [/\b(german|deutsch|ger)\b/i, 'deu'],
  [/\b(japanese|jap|jpn)\b/i, 'jpn'], [/\b(korean|kor)\b/i, 'kor'], [/\b(russian|rus)\b/i, 'rus'],
  [/\b(hindi|hin)\b/i, 'hin'], [/\b(chinese|mandarin|cantonese|chi|zho)\b/i, 'zho'],
  [/\b(english|eng)\b/i, 'eng'], [/\b(pt[-_ .]?br|portugu[eê]s|portugues|dublado)\b/i, 'ptbr']
]

export function detectAudio(name) {
  const s = String(name || '')
  const langs = []
  const dub = PT.test(s)
  const dual = DUAL.test(s)
  if (dub) langs.push('ptbr')
  if (dual) langs.push('ptbr', 'eng')
  for (const [re, code] of LANGS) if (re.test(s)) langs.push(code)
  return { dub, dual, subs: LEG.test(s), langs: [...new Set(langs)] }
}
`)

/* ============================= src/yts.js ============================= */
add('src/yts.js', String.raw`
// Catalogo e capas: API publica do YTS.
// A API troca de dominio direto (yts.mx saiu do ar em out/2026), entao
// tentamos varios espelhos em ordem ate um responder.

const BASES = [
  'https://movies-api.accel.li/api/v2',
  'https://yts.lt/api/v2',
  'https://yts.gg/api/v2',
  'https://yts.bz/api/v2',
  'https://yts.rs/api/v2'
]

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

export const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz'
]

export function buildMagnet(hash, name = '') {
  const parts = [['xt', \`urn:btih:\${hash}\`]]
  if (name) parts.push(['dn', name])
  for (const t of TRACKERS) parts.push(['tr', t])
  return 'magnet:?' + parts.map(([k, v]) => \`\${k}=\${encodeURIComponent(v)}\`).join('&')
}

let baseIndex = 0

async function getJSON(url, ms = 12000) {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'application/json' } })
    if (!r.ok) throw new Error(\`HTTP \${r.status}\`)
    return await r.json()
  } finally { clearTimeout(to) }
}

async function api(pathname) {
  let lastErr
  for (let i = 0; i < BASES.length; i++) {
    const idx = (baseIndex + i) % BASES.length
    try {
      const j = await getJSON(BASES[idx] + pathname)
      const d = j && j.data
      if (d && (Array.isArray(d.movies) || d.movie_count !== undefined)) { baseIndex = idx; return d }
      lastErr = new Error('resposta inesperada da API do YTS')
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('API do YTS indisponivel')
}

function normalize(m) {
  const title = m.title_english || m.title || ''
  return {
    id: \`yts-\${m.id || m._id || m.imdb_code || title}\`,
    imdb: m.imdb_code || '',
    title,
    year: m.year || '',
    rating: m.rating || 0,
    runtime: m.runtime || 0,
    genres: m.genres || [],
    language: m.language || '',
    summary: m.summary || m.description_full || m.synopsis || '',
    poster: m.large_cover_image || m.medium_cover_image || m.small_cover_image || '',
    background: m.background_image_original || m.background_image || '',
    torrents: (m.torrents || []).map(t => ({
      hash: String(t.hash || '').toLowerCase(),
      quality: t.quality || 'SD',
      codec: t.video_codec || '',
      type: t.type || '',
      seeds: Number(t.seeds) || 0,
      peers: Number(t.peers) || 0,
      size: t.size || '',
      sizeBytes: Number(t.size_bytes) || 0,
      audioChannels: t.audio_channels || '',
      source: 'YTS'
    })).filter(t => /^[0-9a-f]{40}$/.test(t.hash)).sort((a, b) => b.seeds - a.seeds)
  }
}

export async function listMovies({ genre = '', sort = 'year', order = 'desc', page = 1 }) {
  const p = new URLSearchParams({ limit: '24', page: String(page), sort_by: sort, order_by: order })
  if (genre) p.set('genre', genre)
  const d = await api(\`/list_movies.json?\${p}\`)
  return { page, movies: (d.movies || []).map(normalize) }
}

export async function searchMovies(q) {
  const p = new URLSearchParams({ query_term: q, limit: '20' })
  const d = await api(\`/list_movies.json?\${p}\`)
  return (d.movies || []).map(normalize)
}
`)

/* =========================== src/apibay.js ============================ */
add('src/apibay.js', String.raw`
import { detectAudio } from './lang.js'

const MIRRORS = ['https://apibay.org', 'https://apibay.qicp.vip']
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

const VIDEO_CATS = new Set([201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 505])
const CAT = { 201: 'DVD', 207: 'HD', 208: 'Serie', 209: '3D', 211: '4K', 505: 'Adulto', 601: 'Livro', 602: 'HQ', 104: 'FLAC', 102: 'Audio livro' }

function human(bytes) {
  if (!bytes) return '?'
  const gb = bytes / 1e9
  return gb >= 1 ? \`\${gb.toFixed(2)} GB\` : \`\${(bytes / 1e6).toFixed(0)} MB\`
}
function qualityOf(name) {
  if (/2160p|4k/i.test(name)) return '2160p'
  if (/1080p/i.test(name)) return '1080p'
  if (/720p/i.test(name)) return '720p'
  if (/480p/i.test(name)) return '480p'
  return 'SD'
}
function codecOf(name) {
  if (/x265|h\.?265|hevc/i.test(name)) return 'x265'
  if (/x264|h\.?264|avc/i.test(name)) return 'x264'
  if (/\bav1\b/i.test(name)) return 'AV1'
  if (/xvid|divx/i.test(name)) return 'XviD'
  return ''
}

async function fetchMirror(q) {
  let lastErr
  for (const base of MIRRORS) {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 12000)
    try {
      const r = await fetch(\`\${base}/q.php?q=\${encodeURIComponent(q)}\`, {
        signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'application/json' }
      })
      if (!r.ok) throw new Error(\`HTTP \${r.status}\`)
      const j = await r.json()
      if (Array.isArray(j)) return j
      lastErr = new Error('resposta inesperada do apibay')
    } catch (e) { lastErr = e } finally { clearTimeout(to) }
  }
  throw lastErr || new Error('apibay indisponivel')
}

export async function searchApibay(q) {
  const j = await fetchMirror(q)
  if (!j.length || j[0].name === 'No results returned') return []
  return j.map(x => {
    const name = String(x.name || '')
    const size = Number(x.size) || 0
    const cat = Number(x.category) || 0
    const lang = detectAudio(name)
    return {
      hash: String(x.info_hash || '').toLowerCase(),
      title: name,
      seeds: Number(x.seeders) || 0,
      peers: Number(x.leechers) || 0,
      sizeBytes: size,
      size: human(size),
      quality: qualityOf(name),
      codec: codecOf(name),
      category: cat,
      kind: CAT[cat] || '',
      video: VIDEO_CATS.has(cat),
      imdb: x.imdb || '',
      files: Number(x.num_files) || 0,
      dub: lang.dub,
      dual: lang.dual,
      subs: lang.subs,
      langs: lang.langs,
      source: 'TPB'
    }
  }).filter(x => x.seeds > 0 && /^[0-9a-f]{40}$/.test(x.hash))
}

function score(t) {
  let s = Math.min(t.seeds, 250)
  if (t.quality === '1080p') s += 60
  else if (t.quality === '720p') s += 35
  else if (t.quality === '2160p') s += 12
  if (t.codec === 'x264') s += 14
  if (t.codec === 'x265') s += 6
  if (t.dub) s += 35
  if (t.dual) s += 10
  if (/\b(cam|hdcam|ts)\b/i.test(t.title)) s -= 45
  if (/\b3d\b/i.test(t.title)) s -= 12
  if (!t.video) s -= 90
  if (t.files === 0) s -= 25
  const gb = t.sizeBytes / 1e9
  if (gb > 4) s -= (gb - 4) * 4
  if (gb < 0.2) s -= 15
  return s
}

export function rank(list, { onlyDub = false } = {}) {
  const out = onlyDub ? list.filter(t => t.dub || t.dual) : [...list]
  return out.sort((a, b) => score(b) - score(a))
}
`)

/* =========================== src/ffmpeg.js ============================ */
add('src/ffmpeg.js', String.raw`
// ffmpeg/ffprobe: usa o binario que vem junto (ffmpeg-static / ffprobe-static)
// e, se nao existir, tenta o do sistema. Sem isso, mkv/x265/audio AC3 nao tocam.

import fs from 'node:fs'
import { spawn } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

const staticFfmpeg = typeof ffmpegStatic === 'string' ? ffmpegStatic : (ffmpegStatic?.default || null)
const staticFfprobe = typeof ffprobeStatic === 'string' ? ffprobeStatic : (ffprobeStatic?.path || ffprobeStatic?.default?.path || null)

let ffmpegPath = null
let ffprobePath = null
let ffmpegSource = null
let checked = false

function fileOk(p) {
  if (!p) return false
  if (!p.includes('/') && !p.includes('\\')) return true
  try { return fs.existsSync(p) } catch { return false }
}

function works(cmd, args) {
  return new Promise(resolve => {
    if (!cmd) return resolve(false)
    let done = false
    let p
    try { p = spawn(cmd, args, { stdio: 'ignore' }) } catch { return resolve(false) }
    p.on('error', () => { if (!done) { done = true; resolve(false) } })
    p.on('close', code => { if (!done) { done = true; resolve(code === 0) } })
  })
}

async function pick(list, args) {
  for (const [cmd, source] of list) {
    if (!fileOk(cmd)) continue
    if (await works(cmd, args)) return { cmd, source }
  }
  return { cmd: null, source: null }
}

export async function ensureFfmpeg() {
  if (checked) return Boolean(ffmpegPath)
  checked = true
  if (process.env.FFMPEG_DISABLE === '1') return false
  const ff = await pick([
    [process.env.FFMPEG_PATH, 'env'],
    [staticFfmpeg, 'ffmpeg-static'],
    ['ffmpeg', 'PATH']
  ], ['-version'])
  const fp = await pick([
    [process.env.FFPROBE_PATH, 'env'],
    [staticFfprobe, 'ffprobe-static'],
    ['ffprobe', 'PATH']
  ], ['-version'])
  ffmpegPath = ff.cmd
  ffmpegSource = ff.source
  ffprobePath = fp.cmd
  return Boolean(ffmpegPath)
}

export const ffmpegCmd = () => ffmpegPath
export const ffprobeCmd = () => ffprobePath
export const ffmpegInfo = () => ({ ok: Boolean(ffmpegPath), source: ffmpegSource, path: ffmpegPath })

// Le alguns MB do stream e devolve faixas (video/audio/legenda) + duracao.
export function probe(makeStream, timeout = 25000) {
  return new Promise(resolve => {
    if (!ffprobePath) return resolve(null)
    const args = [
      '-hide_banner', '-v', 'error', '-probesize', '4M', '-analyzeduration', '4M', '-i', 'pipe:0',
      '-show_entries', 'stream=index,codec_type,codec_name,channels,width,height:stream_tags=language,title:format=duration,format_name',
      '-of', 'json'
    ]
    const p = spawn(ffprobePath, args, { stdio: ['pipe', 'pipe', 'ignore'] })
    const stream = makeStream()
    let out = ''
    let done = false
    const finish = val => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { stream.destroy() } catch {}
      try { p.kill('SIGKILL') } catch {}
      resolve(val)
    }
    const timer = setTimeout(() => finish(null), timeout)
    p.stdin.on('error', () => {})
    p.stdout.on('data', d => { out += d })
    p.on('error', () => finish(null))
    p.on('close', () => {
      try { finish(parse(JSON.parse(out))) } catch { finish(null) }
    })
    stream.on('error', () => finish(null))
    stream.pipe(p.stdin)
  })
}

function parse(j) {
  const st = j.streams || []
  const v = st.find(s => s.codec_type === 'video' && s.width)
  return {
    duration: Number(j.format?.duration) || 0,
    format: j.format?.format_name || '',
    video: v ? { codec: v.codec_name, width: v.width, height: v.height } : null,
    audios: st.filter(s => s.codec_type === 'audio').map((s, i) => ({
      i, codec: s.codec_name || '', channels: s.channels || 0,
      lang: String(s.tags?.language || '').toLowerCase(), title: s.tags?.title || ''
    })),
    subs: st.filter(s => s.codec_type === 'subtitle').map((s, i) => ({
      i, codec: s.codec_name || '',
      lang: String(s.tags?.language || '').toLowerCase(), title: s.tags?.title || ''
    }))
  }
}
`)

/* ========================== src/progress.js =========================== */
add('src/progress.js', String.raw`
import fs from 'node:fs'
import path from 'node:path'

const DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const FILE = path.join(DIR, 'progress.json')
fs.mkdirSync(DIR, { recursive: true })

let data = {}
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {} } catch {}
let dirty = false

function save() {
  if (!dirty) return
  dirty = false
  try {
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(data))
    fs.renameSync(FILE + '.tmp', FILE)
  } catch {}
}
setInterval(save, 5000).unref()

export const get = key => data[key] || null
export const set = (key, val) => { data[key] = { ...val, ts: Date.now() }; dirty = true }
export const del = key => { delete data[key]; dirty = true }
export const recent = (limit = 24) =>
  Object.entries(data).map(([key, v]) => ({ key, ...v }))
    .filter(v => v.t > 15)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)

function prune() {
  const cut = Date.now() - 180 * 864e5
  for (const [k, v] of Object.entries(data)) if (v.ts < cut) { delete data[k]; dirty = true }
}
prune()
setInterval(prune, 3600e3).unref()
`)

/* ============================= src/tls.js ============================= */
add('src/tls.js', String.raw`
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import selfsigned from 'selfsigned'

export function ensureCerts(dir) {
  const keyPath = path.join(dir, 'key.pem')
  const certPath = path.join(dir, 'cert.pem')
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
  }
  const ips = ['127.0.0.1']
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address)
  }
  const altNames = [{ type: 2, value: 'localhost' }, ...ips.map(ip => ({ type: 7, ip }))]
  const pems = selfsigned.generate([{ name: 'commonName', value: 'cinep2p' }], {
    days: 3650, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }, { name: 'basicConstraints', cA: true }]
  })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(keyPath, pems.private)
  fs.writeFileSync(certPath, pems.cert)
  return { key: pems.private, cert: pems.cert }
}
`)

/* =========================== src/streamer.js ========================== */
add('src/streamer.js', String.raw`
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import WebTorrent from 'webtorrent'
import { buildMagnet, TRACKERS } from './yts.js'
import { ensureFfmpeg, ffmpegCmd, ffmpegInfo, probe } from './ffmpeg.js'
import { langName } from './lang.js'

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(process.cwd(), 'downloads')
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const SUBS_DIR = path.join(DATA_DIR, 'subs')
const METADATA_TIMEOUT = Math.max(20, Number(process.env.METADATA_TIMEOUT || 120)) * 1000
const IDLE_MINUTES = Math.max(5, Number(process.env.IDLE_MINUTES || 40))
const PRESET = process.env.TRANSCODE_PRESET || 'veryfast'
const CRF = process.env.TRANSCODE_CRF || '23'
const PROBE_BYTES = Number(process.env.PROBE_BYTES || 8 * 1024 * 1024)

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
fs.mkdirSync(SUBS_DIR, { recursive: true })

const VIDEO_RE = /\.(mp4|m4v|mkv|webm|avi|mov|mpg|mpeg|m2ts|ts|flv|wmv|ogv|divx)$/i
const SUB_RE = /\.(srt|vtt|ass|ssa)$/i
const DIRECT_RE = /\.(mp4|m4v|webm|ogv)$/i
const SAFE_V = ['h264', 'vp8', 'vp9', 'av1']
const SAFE_A = ['aac', 'mp3', 'opus', 'vorbis']
const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime', ts: 'video/mp2t', ogv: 'video/ogg' }

const log = (...a) => { if (process.env.QUIET !== '1') console.log('[cinep2p]', ...a) }

const client = new WebTorrent({ maxConns: Number(process.env.MAX_CONNS || 80) })
const registry = new Map()
const probeCache = new Map()
const subJobs = new Map()

client.on('error', e => log('erro do cliente:', e?.message || e))
client.on('warning', e => log('aviso:', e?.message || e))

/* ---------- torrents ---------- */

export function ensureTorrent(hash, name = '') {
  const key = String(hash || '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(key)) return Promise.reject(new Error('hash invalido'))

  const hit = registry.get(key)
  if (hit) { hit.lastUsed = Date.now(); return hit.ready }

  const entry = { key, name, torrent: null, timer: null, lastUsed: Date.now() }
  entry.ready = new Promise((resolve, reject) => {
    let settled = false
    const fail = err => {
      if (settled) return
      settled = true
      clearTimeout(entry.timer)
      registry.delete(key)
      client.remove(key).catch(() => {})
      log('falha no torrent', key.slice(0, 8), '-', err.message)
      reject(err)
    }
    try {
      entry.torrent = client.add(buildMagnet(key, name), { path: path.join(DOWNLOAD_DIR, key), announce: TRACKERS })
    } catch (e) { return fail(e) }

    log('adicionado', key.slice(0, 8), name || '')

    entry.timer = setTimeout(() => {
      const peers = entry.torrent ? entry.torrent.numPeers : 0
      fail(new Error(peers
        ? \`Os \${peers} peers conectados nao enviaram os metadados em \${METADATA_TIMEOUT / 1000}s. Tente outra fonte.\`
        : \`Nenhum peer encontrado em \${METADATA_TIMEOUT / 1000}s. Tente outra qualidade ou fonte.\`))
    }, METADATA_TIMEOUT)

    entry.torrent.once('metadata', () => log('metadados ok', key.slice(0, 8)))
    entry.torrent.once('ready', () => {
      if (settled) return
      settled = true
      clearTimeout(entry.timer)
      log('pronto', key.slice(0, 8), entry.torrent.files.length, 'arquivo(s)')
      resolve(entry.torrent)
    })
    entry.torrent.on('error', err => fail(err))
  })

  registry.set(key, entry)
  entry.ready.catch(() => {})
  return entry.ready
}

export async function stop(hash) {
  const key = String(hash || '').toLowerCase()
  const entry = registry.get(key)
  registry.delete(key)
  if (entry) clearTimeout(entry.timer)
  try { await client.remove(key) } catch {}
}

export const active = () => registry.size

export function status(hash) {
  const entry = registry.get(String(hash || '').toLowerCase())
  if (!entry) return { state: 'idle', ready: false }
  entry.lastUsed = Date.now()
  const t = entry.torrent
  if (!t || !t.ready) {
    return { state: 'metadata', ready: false, peers: t ? t.numPeers : 0, progress: 0, name: entry.name }
  }
  return {
    state: 'ready', ready: true, name: t.name,
    progress: t.progress, downloaded: t.downloaded, length: t.length,
    downloadSpeed: t.downloadSpeed, uploadSpeed: t.uploadSpeed,
    peers: t.numPeers, timeRemaining: t.timeRemaining
  }
}

/* ---------- arquivos ---------- */

export function listFiles(torrent) {
  const files = torrent.files || []
  const vids = files.map((f, i) => ({ f, i })).filter(({ f }) => VIDEO_RE.test(f.name) && f.length > 0)
  const big = vids.filter(({ f }) => f.length > 30e6)
  const pool = big.length ? big : vids
  let main = null
  for (const v of pool) if (!main || v.f.length > main.f.length) main = v
  return {
    name: torrent.name,
    main: main ? main.i : null,
    files: files.map((f, i) => ({
      i, name: f.name, length: f.length,
      kind: VIDEO_RE.test(f.name) ? 'video' : SUB_RE.test(f.name) ? 'sub' : 'other'
    }))
  }
}

export function pickVideo(torrent, index) {
  const { main } = listFiles(torrent)
  if (index !== undefined && index !== null && index !== '') {
    const i = Number(index)
    const f = torrent.files[i]
    if (f && VIDEO_RE.test(f.name)) return { file: f, index: i }
  }
  if (main === null) return null
  return { file: torrent.files[main], index: main }
}

function subLangGuess(name) {
  const s = String(name).toLowerCase()
  if (/pt[-_ .]?br|ptbr|portugu[eê]s[-_ ]?br|brazil|pob/.test(s)) return 'pt-BR'
  if (/portugu|portugues|\bpt\b|\bpor\b/.test(s)) return 'pt'
  if (/english|\beng\b|\ben\b/.test(s)) return 'en'
  if (/spanish|espa|\bes\b|\bspa\b/.test(s)) return 'es'
  if (/italian|\bita\b/.test(s)) return 'it'
  if (/french|\bfra\b|\bfre\b/.test(s)) return 'fr'
  if (/german|deutsch|\bger\b|\bdeu\b/.test(s)) return 'de'
  return ''
}

export function externalSubs(torrent) {
  return (torrent.files || []).map((f, i) => ({ f, i }))
    .filter(({ f }) => SUB_RE.test(f.name) && f.length < 5e6)
    .map(({ f, i }) => {
      const lang = subLangGuess(f.name)
      return { kind: 'file', i, name: f.name, lang, label: langName(lang) || f.name.split('/').pop() }
    })
}

export function mediaInfo(p) {
  if (!p) return null
  return {
    duration: p.duration,
    format: p.format,
    video: p.video,
    audios: p.audios.map(a => ({
      i: a.i, codec: a.codec, channels: a.channels, lang: a.lang,
      label: [a.title, langName(a.lang)].filter(Boolean).join(' / ') || \`Faixa \${a.i + 1}\`
    })),
    subs: p.subs.map(s => ({
      i: s.i, codec: s.codec, lang: s.lang,
      label: [s.title, langName(s.lang)].filter(Boolean).join(' / ') || \`Legenda \${s.i + 1}\`,
      text: ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'].includes(String(s.codec).toLowerCase())
    }))
  }
}

export function getProbe(torrent, file) {
  const key = \`\${torrent.infoHash}:\${file.name}\`
  const hit = probeCache.get(key)
  if (hit && Date.now() - hit.at < 20 * 60e3) return hit.promise
  const promise = (async () => {
    if (!(await ensureFfmpeg())) return null
    const cap = Math.max(512 * 1024, Math.min(file.length, PROBE_BYTES))
    return probe(() => file.createReadStream({ start: 0, end: cap - 1 }))
  })()
  probeCache.set(key, { promise, at: Date.now() })
  return promise
}

// Decide como entregar o arquivo. NUNCA assume "direto" so pela extensao.
export async function decideMode(torrent, file, { wantAudio = false, hint = '' } = {}) {
  const p = await getProbe(torrent, file)
  const vc = String(p?.video?.codec || hint || '').toLowerCase()
  const audios = p?.audios || []
  const audioOk = audios.length === 0 || audios.every(a => SAFE_A.includes(String(a.codec).toLowerCase()))
  const singleAudio = audios.length <= 1
  const containerOk = DIRECT_RE.test(file.name)
  if (containerOk && SAFE_V.includes(vc) && audioOk && singleAudio && !wantAudio) return 'direct'
  if (vc === 'h264' || vc === 'vp9' || vc === 'av1') return 'remux'
  if (!vc) return 'remux'
  return 'transcode'
}

/* ---------- entrega: direto (range) ---------- */

function serveDirect(file, req, res) {
  const total = file.length
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  const base = {
    'Accept-Ranges': 'bytes',
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  }
  let start = 0, end = total - 1, partial = false
  const range = req.headers.range
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim())
    if (m && (m[1] || m[2])) {
      if (!m[1]) { const n = Number(m[2]); start = Math.max(0, total - n) }
      else {
        start = Number(m[1])
        if (m[2]) end = Math.min(Number(m[2]), total - 1)
      }
      if (!Number.isFinite(start) || start < 0) start = 0
      if (!Number.isFinite(end) || end >= total) end = total - 1
      if (start > end) { res.writeHead(416, { 'Content-Range': \`bytes */\${total}\` }); return res.end() }
      partial = true
    }
  }
  res.writeHead(partial ? 206 : 200, {
    ...base,
    ...(partial ? { 'Content-Range': \`bytes \${start}-\${end}/\${total}\` } : {}),
    'Content-Length': end - start + 1,
    'X-Mode': 'direct'
  })
  if (req.method === 'HEAD') return res.end()
  const stream = file.createReadStream({ start, end })
  stream.on('error', e => { log('erro no stream direto:', e.message); try { res.end() } catch {} })
  res.on('close', () => { try { stream.destroy() } catch {} })
  stream.pipe(res)
}

/* ---------- entrega: remux / transcode ---------- */

async function serveFfmpeg({ torrent, file, mode, audioTrack, pos, q, req, res }) {
  const ff = ffmpegCmd()
  const info = await getProbe(torrent, file)
  const frac = Math.min(0.995, Math.max(0, Number(pos) || 0))
  const isMp4 = /mp4|mov|m4a|3gp|isom/.test(String(info?.format || '').toLowerCase())
  const duration = info?.duration || 0

  let start = 0
  if (!isMp4 && frac > 0.002) {
    const piece = torrent.pieceLength || 1
    start = Math.floor((file.length * frac) / piece) * piece
    if (start >= file.length) start = Math.max(0, file.length - piece)
  }

  const args = ['-hide_banner', '-loglevel', 'error', '-probesize', '4M', '-analyzeduration', '4M', '-fflags', '+genpts']
  if (frac > 0.002 && duration) args.push('-ss', (frac * duration).toFixed(3))
  args.push('-i', 'pipe:0', '-map', '0:v:0')

  const audios = info?.audios || []
  const aIdx = Math.min(Math.max(0, Number(audioTrack) || 0), Math.max(0, audios.length - 1))
  args.push('-map', audios.length ? \`0:a:\${aIdx}\` : '0:a:0?')

  if (mode === 'transcode') {
    if (q === '720' || q === '480') args.push('-vf', \`scale=-2:\${q}\`)
    args.push('-c:v', 'libx264', '-preset', PRESET, '-crf', CRF,
      '-pix_fmt', 'yuv420p', '-g', '48', '-keyint_min', '48', '-sc_threshold', '0')
  } else {
    args.push('-c:v', 'copy')
    if (info?.video?.codec === 'hevc') args.push('-tag:v', 'hvc1')
  }
  args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-sn',
    '-max_muxing_queue_size', '4096', '-avoid_negative_ts', 'make_zero',
    '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1')

  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'none',
    'X-Mode': mode
  })

  const proc = spawn(ff, args, { stdio: ['pipe', 'pipe', 'pipe'] })
  const input = file.createReadStream({ start, end: file.length - 1 })
  input.on('error', () => {})
  proc.stdin.on('error', () => {})
  proc.stdout.on('error', () => {})
  input.pipe(proc.stdin)
  proc.stdout.pipe(res)

  let err = ''
  proc.stderr.on('data', d => { err += d; if (err.length > 4000) err = err.slice(-4000) })

  const kill = () => { try { proc.kill('SIGKILL') } catch {}; try { input.destroy() } catch {} }
  res.on('close', kill)
  proc.on('close', code => {
    if (code && code !== 0) log(\`ffmpeg/\${mode} saida \${code}: \${err.trim().split('\n').pop() || ''}\`)
    if (!res.writableEnded) res.end()
  })
}

export async function serveMedia({ torrent, fileIndex, mode = 'auto', audioTrack = 0, pos = 0, q = '', hint = '', req, res }) {
  const picked = pickVideo(torrent, fileIndex)
  if (!picked) { res.status(404).json({ error: 'Nenhum arquivo de video neste torrent.' }); return }
  const { file } = picked
  const wantAudio = Number(audioTrack) > 0

  let m = mode
  if (m === 'auto') m = await decideMode(torrent, file, { wantAudio, hint })
  if (m === 'direct' && wantAudio) m = 'remux'
  if (m !== 'direct' && !(await ensureFfmpeg())) {
    log('ffmpeg indisponivel, caindo para direto')
    m = 'direct'
  }
  log('stream', file.name.slice(0, 40), 'modo=' + m, 'audio=' + audioTrack, 'pos=' + pos)
  if (m === 'direct') return serveDirect(file, req, res)
  return serveFfmpeg({ torrent, file, mode: m, audioTrack, pos, q, req, res })
}

/* ---------- diagnostico ---------- */

function readBytes(file, n, ms) {
  return new Promise((resolve, reject) => {
    const end = Math.min(n, file.length) - 1
    const stream = file.createReadStream({ start: 0, end })
    let got = 0
    let done = false
    const finish = err => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { stream.destroy() } catch {}
      err ? reject(err) : resolve(got)
    }
    const timer = setTimeout(() => finish(), ms)
    stream.on('data', c => {
      got += c.length
      if (got >= n) finish()
    })
    stream.on('error', e => finish(e))
    stream.on('end', () => finish())
  })
}

export async function diagnose(hash, name = '') {
  const out = { hash, name, steps: [], errors: [] }
  const step = (label, ok, extra = {}) => out.steps.push({ label, ok, ...extra })
  const t0 = Date.now()
  let torrent
  try {
    torrent = await ensureTorrent(hash, name)
    step('metadados do torrent', true, { ms: Date.now() - t0 })
  } catch (e) {
    step('metadados do torrent', false, { ms: Date.now() - t0, error: e.message })
    out.errors.push(e.message)
    out.ffmpeg = ffmpegInfo()
    return out
  }
  const st = status(hash)
  out.peers = st.peers
  out.progress = st.progress
  step('peers conectados', st.peers > 0, { peers: st.peers })
  const list = listFiles(torrent)
  step('arquivos de video', list.main !== null, { total: list.files.length, escolhido: list.main })
  const picked = pickVideo(torrent, list.main)
  if (!picked) {
    out.errors.push('nenhum arquivo de video')
    out.ffmpeg = ffmpegInfo()
    return out
  }
  out.file = { nome: picked.file.name, bytes: picked.file.length }
  const ff = await ensureFfmpeg()
  out.ffmpeg = ffmpegInfo()
  step('ffmpeg', ff, { fonte: ffmpegInfo().source })
  const t1 = Date.now()
  try {
    const got = await readBytes(picked.file, 128 * 1024, 30000)
    step('leitura dos primeiros bytes', got > 0, { bytes: got, ms: Date.now() - t1 })
  } catch (e) {
    step('leitura dos primeiros bytes', false, { ms: Date.now() - t1, error: e.message })
    out.errors.push('leitura: ' + e.message)
  }
  const p = await getProbe(torrent, picked.file)
  step('ffprobe', Boolean(p), p ? { duracao: p.duration, video: p.video?.codec || null, audios: p.audios.length, legendas: p.subs.length } : {})
  out.media = mediaInfo(p)
  out.modoSugerido = await decideMode(torrent, picked.file)
  return out
}

/* ---------- legendas ---------- */

function decodeText(buf) {
  let t = buf.toString('utf8')
  if (t.includes('\uFFFD')) { try { t = new TextDecoder('windows-1252').decode(buf) } catch {} }
  return t.replace(/^\uFEFF/, '')
}

function srtToVtt(text) {
  const body = text.replace(/\r+/g, '')
    .replace(/^(\d+)[ \t]*$/gm, '')
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return 'WEBVTT\n\n' + body.trim() + '\n'
}

function assTime(t) {
  const m = /(\d+):(\d{2}):(\d{2})[.:](\d+)/.exec(t || '')
  if (!m) return '00:00:00.000'
  return \`\${m[1].padStart(2, '0')}:\${m[2]}:\${m[3]}.\${m[4].padEnd(3, '0').slice(0, 3)}\`
}

function assToVtt(text) {
  const cues = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^Dialogue:\s*([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),(.*)$/.exec(line)
    if (!m) continue
    const txt = m[10].replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\n/gi, '\n')
    cues.push(\`\${assTime(m[2])} --> \${assTime(m[3])}\n\${txt}\`)
  }
  return 'WEBVTT\n\n' + cues.join('\n\n') + '\n'
}

export async function externalSubVtt(torrent, fileIndex) {
  const f = torrent.files[Number(fileIndex)]
  if (!f || !SUB_RE.test(f.name)) throw new Error('legenda nao encontrada')
  const text = decodeText(Buffer.from(await f.arrayBuffer()))
  return /\.(ass|ssa)$/i.test(f.name) ? assToVtt(text) : srtToVtt(text)
}

export async function embeddedSubVtt(torrent, file, track) {
  if (!(await ensureFfmpeg())) throw new Error('ffmpeg nao encontrado')
  const safe = file.name.replace(/[^\w.-]/g, '_')
  const out = path.join(SUBS_DIR, \`\${torrent.infoHash}-\${safe}-s\${track}.vtt\`)
  if (fs.existsSync(out)) return fs.readFileSync(out, 'utf8')
  if (subJobs.has(out)) return subJobs.get(out)

  const job = new Promise((resolve, reject) => {
    const tmp = out + '.tmp'
    const args = ['-hide_banner', '-loglevel', 'error', '-probesize', '4M', '-analyzeduration', '4M',
      '-i', 'pipe:0', '-map', \`0:s:\${Number(track)}\`, '-f', 'webvtt', tmp]
    const proc = spawn(ffmpegCmd(), args, { stdio: ['pipe', 'ignore', 'pipe'] })
    const input = file.createReadStream({ start: 0, end: file.length - 1 })
    let err = ''
    input.on('error', () => {})
    proc.stdin.on('error', () => {})
    input.pipe(proc.stdin)
    proc.stderr.on('data', d => { err += d })
    proc.on('error', reject)
    proc.on('close', code => {
      try { input.destroy() } catch {}
      if (code !== 0) return reject(new Error('falha ao extrair legenda: ' + err.trim().split('\n').pop()))
      try { fs.renameSync(tmp, out); resolve(fs.readFileSync(out, 'utf8')) } catch (e) { reject(e) }
    })
  }).finally(() => subJobs.delete(out))

  subJobs.set(out, job)
  return job
}

/* ---------- limpeza por ociosidade ---------- */

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of registry) {
    if (now - entry.lastUsed > IDLE_MINUTES * 60e3) {
      registry.delete(key)
      clearTimeout(entry.timer)
      client.remove(key).catch(() => {})
    }
  }
}, 60e3).unref()

export function destroyClient() { try { client.destroy() } catch {} }
`)

/* ============================== server.js ============================= */
add('server.js', String.raw`
import express from 'express'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import { listMovies, searchMovies } from './src/yts.js'
import { searchApibay, rank } from './src/apibay.js'
import {
  ensureTorrent, serveMedia, status, stop, active, listFiles, pickVideo,
  externalSubs, getProbe, mediaInfo, decideMode, diagnose,
  externalSubVtt, embeddedSubVtt, destroyClient
} from './src/streamer.js'
import { ensureFfmpeg, ffmpegInfo } from './src/ffmpeg.js'
import { ensureCerts } from './src/tls.js'
import * as progress from './src/progress.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.PORT || 3000)
const USE_HTTPS = process.argv.includes('--https') || ['1', 'true'].includes(String(process.env.HTTPS))

app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true }))

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  console.error('[cinep2p] erro na rota', req.path, '-', e.message)
  if (!res.headersSent) res.status(500).json({ error: e.message })
})
const hash40 = v => /^[0-9a-f]{40}$/.test(String(v || '').toLowerCase())

function cleanTitle(s) {
  return String(s || '')
    .replace(/\.(mp4|mkv|avi|mov|webm|m4v|ts)$/i, '')
    .replace(/[._]/g, ' ')
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|bluray|blu-?ray|web-?dl|webrip|hdrip|brrip|dvdrip|remux|hdr|dv|x264|x265|h\.?264|h\.?265|hevc|av1|aac|ac3|ddp?5[ .]?1|dts(-hd)?|truehd|atmos|yify|galaxyrg|yts|dublado|dual|multi|legendado|repackage?d?|proper|extended|imax|10bit|8bit|hq|bone|psa|oft|turg|rarbg)\b/gi, ' ')
    .replace(/\s*-\s*[a-z0-9]+$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ---------- catalogo / busca ---------- */

const posterCache = new Map()

app.get('/api/health', wrap(async (_req, res) => {
  const ff = await ensureFfmpeg()
  res.json({ ok: true, ffmpeg: ff, ffmpegInfo: ffmpegInfo(), https: USE_HTTPS, version: '0.3.0' })
}))

app.get('/api/active', (_req, res) => res.json({ active: active() }))

app.get('/api/catalog', wrap(async (req, res) => {
  const { genre = '', sort = 'year', order = 'desc', page = '1' } = req.query
  res.json(await listMovies({ genre, sort, order, page: Number(page) }))
}))

app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (!q) return res.json({ results: [], extra: [] })
  const onlyDub = req.query.dub === '1'
  const [yts, bay] = await Promise.all([
    searchMovies(q).catch(() => []),
    searchApibay(onlyDub ? q + ' dublado' : q).catch(() => [])
  ])
  res.json({ results: yts, extra: rank(bay, { onlyDub }).slice(0, 20) })
}))

app.get('/api/extra', wrap(async (req, res) => {
  const title = String(req.query.title || '').trim()
  if (!title) return res.json({ results: [] })
  const q = (title + ' ' + (req.query.year || '') + ' ' + (req.query.dub === '1' ? 'dublado' : '')).trim()
  const list = await searchApibay(q)
  res.json({ results: rank(list, { onlyDub: req.query.dub === '1' }).slice(0, 25) })
}))

app.get('/api/poster', wrap(async (req, res) => {
  const imdb = String(req.query.imdb || '').trim()
  const raw = String(req.query.title || '').trim().slice(0, 180)
  const term = imdb || cleanTitle(raw)
  if (!term) return res.json({ poster: '' })
  const key = term.toLowerCase()
  if (posterCache.has(key)) return res.json(posterCache.get(key))
  let out = { poster: '', title: '', year: '', summary: '', rating: 0, genres: [] }
  try {
    const movies = await searchMovies(term)
    const wanted = term.toLowerCase()
    const score = m => {
      const c = String(m.title || '').toLowerCase()
      return (c === wanted ? 4 : 0) + (c.startsWith(wanted) || wanted.startsWith(c) ? 2 : 0) + (m.poster ? 1 : 0)
    }
    const best = [...movies].sort((a, b) => score(b) - score(a))[0]
    if (best) out = {
      poster: best.poster, title: best.title, year: best.year,
      summary: best.summary, rating: best.rating, genres: best.genres, imdb: best.imdb
    }
  } catch {}
  posterCache.set(key, out)
  if (posterCache.size > 800) posterCache.clear()
  res.json(out)
}))

/* ---------- torrents ---------- */

app.get('/api/status/:hash', (req, res) => {
  if (!hash40(req.params.hash)) return res.status(400).json({ error: 'hash invalido' })
  res.json(status(req.params.hash))
})

app.post('/api/stop/:hash', wrap(async (req, res) => {
  await stop(req.params.hash)
  res.json({ ok: true })
}))

app.get('/api/diag/:hash', wrap(async (req, res) => {
  if (!hash40(req.params.hash)) return res.status(400).json({ error: 'hash invalido' })
  res.json(await diagnose(String(req.params.hash).toLowerCase(), String(req.query.name || '')))
}))

app.get('/api/prepare/:hash', wrap(async (req, res) => {
  const hash = String(req.params.hash).toLowerCase()
  let torrent
  try {
    torrent = await ensureTorrent(hash, String(req.query.name || ''))
  } catch (e) {
    return res.status(504).json({ error: e.message })
  }
  const list = listFiles(torrent)
  const picked = pickVideo(torrent, req.query.file)
  const out = { hash, name: torrent.name, main: list.main, files: list.files, externalSubs: externalSubs(torrent), ffmpeg: await ensureFfmpeg() }
  if (picked) {
    out.file = picked.index
    out.playable = /\.(mp4|m4v|webm|ogv)$/i.test(picked.file.name)
    out.media = mediaInfo(await getProbe(torrent, picked.file))
    out.mode = out.ffmpeg ? await decideMode(torrent, picked.file) : 'direct'
  } else {
    out.mode = 'direct'
  }
  res.json(out)
}))

app.get('/api/stream/:hash', wrap(async (req, res) => {
  const torrent = await ensureTorrent(String(req.params.hash).toLowerCase(), String(req.query.name || ''))
  await serveMedia({
    torrent,
    fileIndex: req.query.file,
    mode: String(req.query.mode || 'auto'),
    audioTrack: Number(req.query.audio || 0),
    pos: Number(req.query.pos || 0),
    q: String(req.query.q || ''),
    hint: String(req.query.hint || ''),
    req, res
  })
}))

app.get('/api/subs/:hash', wrap(async (req, res) => {
  const torrent = await ensureTorrent(String(req.params.hash).toLowerCase(), String(req.query.name || ''))
  let vtt
  if (req.query.track !== undefined) {
    const picked = pickVideo(torrent, req.query.file)
    if (!picked) return res.status(404).json({ error: 'arquivo nao encontrado' })
    vtt = await embeddedSubVtt(torrent, picked.file, req.query.track)
  } else {
    vtt = await externalSubVtt(torrent, req.query.ext)
  }
  res.set('Content-Type', 'text/vtt; charset=utf-8').set('Cache-Control', 'no-store').send(vtt)
}))

/* ---------- progresso ---------- */

app.get('/api/progress', (_req, res) => res.json({ items: progress.recent(24) }))
app.get('/api/progress/:key', (req, res) => res.json(progress.get(req.params.key) || {}))
app.post('/api/progress', (req, res) => {
  const b = req.body || {}
  if (!b.key) return res.status(400).json({ error: 'key obrigatoria' })
  progress.set(String(b.key), {
    t: Number(b.t) || 0, d: Number(b.d) || 0,
    title: b.title || '', poster: b.poster || '', year: b.year || '',
    hash: b.hash || '', file: b.file ?? null, name: b.name || ''
  })
  res.json({ ok: true })
})
app.delete('/api/progress/:key', (req, res) => { progress.del(req.params.key); res.json({ ok: true }) })

app.use('/api', (_req, res) => res.status(404).json({ error: 'rota nao encontrada' }))

/* ---------- servidor ---------- */

const server = USE_HTTPS
  ? https.createServer(ensureCerts(path.join(__dirname, 'certs')), app)
  : http.createServer(app)

const scheme = USE_HTTPS ? 'https' : 'http'

server.listen(PORT, '0.0.0.0', async () => {
  const ff = await ensureFfmpeg()
  console.log('')
  console.log('  cinep2p no ar' + (USE_HTTPS ? ' (HTTPS)' : ''))
  console.log('')
  console.log(\`  Neste PC:  \${scheme}://localhost:\${PORT}\`)
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(\`  Na rede:   \${scheme}://\${a.address}:\${PORT}   <- celular, TV Box, projetor\`)
      }
    }
  }
  console.log('')
  console.log(\`  ffmpeg: \${ff ? 'ok (' + ffmpegInfo().source + ')' : 'NAO ENCONTRADO'}\`)
  console.log('  dica: para instalar como app no celular, use npm run https')
  console.log('')
  console.log('  Ctrl+C para parar.')
  console.log('')
})

process.on('SIGINT', () => { destroyClient(); process.exit(0) })
`)

/* =========================== public/index.html ======================== */
add('public/index.html', String.raw`
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>cinep2p</title>
<meta name="theme-color" content="#0b0b11">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg">
<link rel="apple-touch-icon" href="/icon.svg">
<link rel="stylesheet" href="/style.css">
</head>
<body>

<header>
  <div class="logo">cine<span>p2p</span></div>
  <input id="q" type="search" placeholder="Buscar filme ou serie..." enterkeyhint="search">
  <div class="hbtns">
    <button class="chip" id="dubChip" title="So resultados dublados">Dublado</button>
    <button class="chip" id="tvBtn" title="Aumentar interface">TV</button>
    <button class="chip" id="installBtn" title="Instalar como aplicativo">Instalar app</button>
    <span class="badge" id="badge">0 ativos</span>
  </div>
</header>

<nav id="genres"></nav>

<main>
  <div id="contRow"></div>
  <div id="rows"><div class="loading">Carregando catalogo...</div></div>
</main>

<div id="modal" class="hidden">
  <div class="sheet">
    <button class="close" id="closeModal">x</button>
    <div id="detail"></div>
  </div>
</div>

<div id="diagModal" class="hidden">
  <div class="sheet">
    <button class="close" id="closeDiag">x</button>
    <div class="dbody">
      <h1>Diagnostico</h1>
      <div class="dsum" id="diagText">Rodando...</div>
      <button class="alt focusable" id="diagCopy">Copiar</button>
    </div>
  </div>
</div>

<div id="player" class="hidden">
  <video id="video" tabindex="0" playsinline preload="auto"></video>

  <div class="ptop hidden" id="ptop">
    <div class="ptitle" id="ptitle"></div>
    <div class="pacts">
      <button id="pAudio">Audio</button>
      <button id="pSubs">Legenda</button>
      <button id="pMode">Modo</button>
      <button id="pDiag">Diagnostico</button>
      <button id="pLink">Copiar link</button>
      <button id="pFs">Tela cheia</button>
      <button id="pClose">Fechar</button>
    </div>
  </div>

  <div class="pctl hidden" id="pctl">
    <button id="pplay">Pausar</button>
    <span id="ptime">0:00</span>
    <input type="range" id="pseek" min="0" max="1000" step="1" value="0">
    <span id="pdur">0:00</span>
    <button id="pvolD">Vol -</button>
    <button id="pvolU">Vol +</button>
  </div>

  <div class="pmsg" id="pmsg"></div>
  <div class="pspin" id="pspin"><div class="spin"></div></div>
  <div class="pmenu hidden" id="pmenu"></div>
</div>

<div id="toast" class="hidden"></div>

<script src="/app.js"></script>
</body>
</html>
`)

/* =========================== public/style.css ========================= */
add('public/style.css', String.raw`
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
:root {
  --bg:#0b0b11; --card:#16161f; --line:#2a2a35; --fg:#eaeaf2; --mut:#8d8da0; --acc:#7c3aed;
  --pad: clamp(14px, 2.2vw, 30px);
}
html { font-size: 16px; }
html.tv { font-size: 21px; }
body {
  background: var(--bg); color: var(--fg); padding-bottom: 60px;
  font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  overscroll-behavior: none;
  padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right);
}
button { font: inherit; color: inherit; }
:focus { outline: none; }
:focus-visible, .focusable:focus { outline: 3px solid var(--acc); outline-offset: 3px; border-radius: 10px; }

header {
  display: flex; align-items: center; gap: 12px; padding: 14px var(--pad);
  border-bottom: 1px solid var(--line); position: sticky; top: 0;
  background: rgba(11,11,17,.94); backdrop-filter: blur(8px); z-index: 20; flex-wrap: wrap;
}
.logo { font-weight: 800; font-size: 1.2rem; letter-spacing: -.02em; }
.logo span { color: var(--acc); }
#q { flex: 1; min-width: 160px; background: var(--card); border: 1px solid var(--line); color: var(--fg); padding: 10px 16px; border-radius: 999px; outline: none; font-size: .95rem; }
#q:focus { border-color: var(--acc); }
.hbtns { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; }
.badge { font-size: .7rem; color: var(--mut); border: 1px solid var(--line); padding: 5px 11px; border-radius: 999px; white-space: nowrap; }

#genres { display: flex; gap: 8px; padding: 14px var(--pad) 4px; overflow-x: auto; scrollbar-width: none; }
#genres::-webkit-scrollbar { display: none; }
.chip { white-space: nowrap; font-size: .85rem; padding: 9px 16px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--mut); cursor: pointer; }
.chip.on { background: var(--acc); border-color: var(--acc); color: #fff; font-weight: 600; }

main { padding: 8px 0 24px; }
.row { margin-top: 24px; }
.row h2 { font-size: 1rem; padding: 0 var(--pad) 10px; font-weight: 700; }
.strip { display: flex; gap: 12px; overflow-x: auto; padding: 0 var(--pad) 8px; scrollbar-width: none; }
.strip::-webkit-scrollbar { display: none; }

.card { flex: 0 0 clamp(130px, 16vw, 180px); cursor: pointer; transition: transform .15s; position: relative; }
.card:hover { transform: translateY(-4px); }
.card img { width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: 10px; background: var(--card); display: block; }
.card .t { font-size: .8rem; margin-top: 7px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card .m { font-size: .72rem; color: var(--mut); }
.card .bar { position: absolute; left: 6px; right: 6px; bottom: 30%; height: 4px; background: rgba(255,255,255,.25); border-radius: 3px; overflow: hidden; }
.card .bar i { display: block; height: 100%; background: var(--acc); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; padding: 8px var(--pad); }
.grid .card { flex: none; }
.loading { padding: 40px var(--pad); color: var(--mut); }

#modal, #diagModal { position: fixed; inset: 0; background: rgba(0,0,0,.75); z-index: 40; display: flex; align-items: center; justify-content: center; padding: 16px; }
#diagModal { z-index: 70; }
.hidden { display: none !important; }
.sheet { background: #12121a; border: 1px solid var(--line); border-radius: 16px; max-width: 820px; width: 100%; max-height: 92vh; overflow-y: auto; position: relative; }
.close { position: absolute; top: 12px; right: 12px; background: rgba(0,0,0,.6); border: 1px solid var(--line); color: #fff; width: 38px; height: 38px; border-radius: 50%; cursor: pointer; z-index: 2; }
.hero { height: clamp(140px, 26vh, 240px); background-size: cover; background-position: center; border-radius: 16px 16px 0 0; background-color: #1b1b26; }
.dbody { padding: 18px var(--pad) 26px; }
.dbody h1 { font-size: 1.4rem; }
.dmeta { color: var(--mut); font-size: .85rem; margin: 6px 0 12px; }
.dsum { font-size: .88rem; color: #c6c6d4; margin-bottom: 18px; }
pre.dsum { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, Consolas, monospace; font-size: .78rem; }
.sec { font-size: .74rem; text-transform: uppercase; letter-spacing: .1em; color: var(--mut); margin: 20px 0 10px; font-weight: 700; }
.src { display: flex; align-items: center; gap: 10px; padding: 11px 13px; border: 1px solid var(--line); border-radius: 10px; margin-bottom: 8px; font-size: .85rem; flex-wrap: wrap; }
.src .q { font-weight: 700; min-width: 58px; }
.src .s { color: var(--mut); flex: 1; min-width: 120px; }
.play { background: var(--acc); border: 0; color: #fff; font-weight: 700; padding: 10px 20px; border-radius: 8px; cursor: pointer; }
.tag { font-size: .68rem; border: 1px solid var(--line); color: var(--mut); padding: 3px 8px; border-radius: 5px; }
.tag.dub { border-color: #16a34a; color: #4ade80; }
.tag.pt { border-color: #0891b2; color: #67e8f9; }
.tag.warn { border-color: #b45309; color: #fbbf24; }
.alt { background: transparent; border: 1px solid var(--acc); color: #a78bfa; padding: 9px 15px; border-radius: 8px; cursor: pointer; font-size: .85rem; margin-right: 8px; margin-bottom: 8px; }
.alt.on { background: var(--acc); color: #fff; }

#player { position: fixed; inset: 0; background: #000; z-index: 60; display: flex; flex-direction: column; }
#video { flex: 1; width: 100%; min-height: 0; background: #000; }
video::cue { background: rgba(0,0,0,.65); font-size: 1.15em; }
.ptop { display: flex; align-items: center; gap: 10px; padding: 10px var(--pad); background: linear-gradient(180deg, rgba(0,0,0,.85), transparent); position: absolute; top: 0; left: 0; right: 0; z-index: 3; flex-wrap: wrap; }
.ptitle { font-weight: 700; flex: 1; min-width: 120px; }
.pacts { display: flex; gap: 8px; flex-wrap: wrap; }
.pacts button, .pctl button { background: rgba(20,20,28,.9); border: 1px solid var(--line); padding: 9px 14px; border-radius: 8px; cursor: pointer; font-size: .85rem; }
.pctl { display: flex; align-items: center; gap: 10px; padding: 8px var(--pad); background: #0b0b11; border-top: 1px solid var(--line); }
.pctl input[type=range] { flex: 1; min-width: 80px; accent-color: var(--acc); height: 26px; }
.pmsg { position: absolute; bottom: 68px; left: var(--pad); right: var(--pad); font-size: .85rem; color: #cfcfe0; z-index: 3; pointer-events: none; text-shadow: 0 1px 3px #000; }
.pmsg.err { color: #fca5a5; }
.pspin { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 4; background: rgba(0,0,0,.5); }
.spin { width: 46px; height: 46px; border: 4px solid rgba(255,255,255,.25); border-top-color: var(--acc); border-radius: 50%; animation: sp 1s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
.pmenu { position: absolute; right: var(--pad); top: 62px; background: #12121a; border: 1px solid var(--line); border-radius: 12px; padding: 10px; z-index: 5; min-width: 230px; max-height: 70vh; overflow-y: auto; }
.pmenu h3 { font-size: .72rem; text-transform: uppercase; color: var(--mut); letter-spacing: .1em; margin: 8px 4px 4px; }
.pmenu button { display: block; width: 100%; text-align: left; background: transparent; border: 0; padding: 10px 12px; border-radius: 8px; cursor: pointer; font-size: .88rem; }
.pmenu button:hover, .pmenu button.on { background: #1d1d29; }
.pmenu button.on::after { content: ' *'; color: var(--acc); font-weight: 700; }

#toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 26px; background: #17171f; border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; z-index: 90; display: flex; gap: 10px; align-items: center; max-width: 92vw; flex-wrap: wrap; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
#toast button { background: var(--acc); border: 0; color: #fff; padding: 8px 14px; border-radius: 8px; cursor: pointer; }

@media (min-width: 1100px) { html { font-size: 17px; } }
`)

/* ============================ public/app.js =========================== */
add('public/app.js', String.raw`
const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]

const GENRES = [
  ['', 'Tudo'], ['action', 'Acao'], ['comedy', 'Comedia'], ['horror', 'Terror'],
  ['sci-fi', 'Ficcao'], ['animation', 'Animacao'], ['thriller', 'Suspense'],
  ['crime', 'Crime'], ['romance', 'Romance'], ['adventure', 'Aventura'], ['family', 'Familia']
]
const ROWS = [
  { t: 'Em Alta', p: { sort: 'download_count', order: 'desc' } },
  { t: 'Lancamentos', p: { sort: 'year', order: 'desc' } },
  { t: 'Melhores Notas', p: { sort: 'rating', order: 'desc' } },
  { t: 'Acao', p: { genre: 'action', sort: 'download_count', order: 'desc' } },
  { t: 'Terror', p: { genre: 'horror', sort: 'download_count', order: 'desc' } },
  { t: 'Comedia', p: { genre: 'comedy', sort: 'download_count', order: 'desc' } }
]
const MODE_LABEL = { direct: 'Direto', remux: 'Compativel', transcode: 'Leve' }
const CHAIN = ['direct', 'remux', 'transcode']

const video = $('#video')
const rowsEl = $('#rows')
let activeGenre = ''
let onlyDub = localStorage.getItem('cinep2p.dub') === '1'
let health = { ffmpeg: false }
const state = { progressByHash: {} }

const fmtTime = s => {
  s = Math.max(0, Math.floor(s || 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return (h ? \`\${h}:\${String(m).padStart(2, '0')}\` : \`\${m}\`) + ':' + String(x).padStart(2, '0')
}
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

async function api(url, opts) {
  const r = await fetch(url, opts)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || \`HTTP \${r.status}\`)
  return j
}

/* ---------- camadas / botao voltar ---------- */
const layers = []
history.replaceState({ layer: false }, '')
function pushLayer(close) { layers.push(close); history.pushState({ layer: true }, '') }
function closeTop() { if (layers.length) history.back() }
window.addEventListener('popstate', () => { const fn = layers.pop(); if (fn) fn() })

/* ---------- foco (controle remoto) ---------- */
function focusables() {
  return $$('button, input, [tabindex="0"]').filter(el => el.offsetParent !== null && !el.disabled)
}
function moveFocus(dir) {
  const items = focusables()
  if (!items.length) return
  const cur = document.activeElement
  if (!cur || !items.includes(cur)) return items[0].focus()
  const r = cur.getBoundingClientRect()
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  let best = null, bestScore = Infinity
  for (const el of items) {
    if (el === cur) continue
    const b = el.getBoundingClientRect()
    const dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy
    const ok = dir === 'left' ? dx < -6 : dir === 'right' ? dx > 6 : dir === 'up' ? dy < -6 : dy > 6
    if (!ok) continue
    const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy)
    const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    const sc = primary + secondary * 2
    if (sc < bestScore) { bestScore = sc; best = el }
  }
  if (best) best.focus()
}

document.addEventListener('keydown', e => {
  const k = e.key
  const a = document.activeElement
  const tag = a?.tagName || ''
  const typing = tag === 'INPUT' && a.type !== 'range'

  if (k === 'Escape') {
    e.preventDefault()
    if (!$('#pmenu').classList.contains('hidden')) return $('#pmenu').classList.add('hidden')
    closeTop()
    return
  }
  if (k === 'Backspace' && !typing) { e.preventDefault(); closeTop(); return }

  if (!typing && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) {
    if (a === video) return
    if (a && a.type === 'range' && (k === 'ArrowLeft' || k === 'ArrowRight')) return
    e.preventDefault()
    moveFocus(k.replace('Arrow', '').toLowerCase())
    return
  }

  if (!typing && (k === 'Enter' || k === ' ' || k === 'MediaPlayPause') && a === video) {
    e.preventDefault()
    if (k === ' ') return video.paused ? video.play() : video.pause()
    showTop(true); (focusables()[0] || video).focus()
  }
  if (!typing && (k === 'm' || k === 'M' || k === 'ContextMenu') && state.open) { e.preventDefault(); openMenu('audio') }
})

/* ---------- toast ---------- */
let toastTimer
function toast(msg, actions = [], ms = 6000) {
  const el = $('#toast')
  el.innerHTML = ''
  const span = document.createElement('span')
  span.textContent = msg
  el.appendChild(span)
  for (const [label, fn] of actions) {
    const b = document.createElement('button')
    b.textContent = label
    b.onclick = () => { hide(); fn() }
    el.appendChild(b)
  }
  el.classList.remove('hidden')
  clearTimeout(toastTimer)
  if (ms) toastTimer = setTimeout(hide, ms)
  function hide() { el.classList.add('hidden') }
}

/* ---------- capas ---------- */
const posterCache = new Map()
function placeholder(title) {
  const t = esc(String(title || 'Filme').slice(0, 32))
  const svg = \`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#30204f"/><stop offset="1" stop-color="#101018"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/><circle cx="150" cy="150" r="52" fill="none" stroke="#8b5cf6" stroke-width="3"/><path d="M135 119 L180 150 L135 181 Z" fill="#c4b5fd"/><text x="150" y="270" fill="#fff" font-family="Arial" font-size="17" font-weight="700" text-anchor="middle">\${t}</text></svg>\`
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
}
function lookupPoster(title, imdb) {
  const key = (imdb || title || '').toLowerCase()
  if (!key) return Promise.resolve(null)
  if (!posterCache.has(key)) {
    posterCache.set(key, api(\`/api/poster?title=\${encodeURIComponent(title || '')}&imdb=\${encodeURIComponent(imdb || '')}\`).catch(() => null))
  }
  return posterCache.get(key)
}

/* ---------- cartoes ---------- */
function progressFor(movie) {
  if (movie.progressKey) return state.progressByHash[movie.hash]
  const hashes = [...(movie.torrents || []).map(t => t.hash), movie.hash].filter(Boolean)
  for (const h of hashes) if (state.progressByHash[h]) return state.progressByHash[h]
  return null
}

function card(movie, opts = {}) {
  const d = document.createElement('div')
  d.className = 'card focusable'
  d.tabIndex = 0
  const img = document.createElement('img')
  img.loading = 'lazy'
  img.alt = movie.title || 'filme'
  const fallback = placeholder(movie.title)
  img.src = movie.poster || fallback
  img.onerror = async () => {
    img.onerror = null
    const j = await lookupPoster(movie.title, movie.imdb)
    img.src = j?.poster || fallback
  }
  const t = document.createElement('div'); t.className = 't'; t.textContent = movie.title || 'Sem titulo'
  const m = document.createElement('div'); m.className = 'm'
  m.textContent = [movie.year || '', movie.rating ? 'Nota ' + movie.rating : '', movie.dub ? 'Dublado' : ''].filter(Boolean).join(' | ')
  d.append(img, t, m)
  const p = progressFor(movie)
  if (p && p.d) {
    const bar = document.createElement('div'); bar.className = 'bar'
    const i = document.createElement('i'); i.style.width = Math.min(100, (p.t / p.d) * 100) + '%'
    bar.appendChild(i); d.appendChild(bar)
  }
  d.onclick = () => opts.direct ? openPlayer(movie.source, movie, movie.file) : openDetail(movie)
  d.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); d.click() } }
  return d
}

function strip(title, movies) {
  const row = document.createElement('div')
  row.className = 'row'
  const h = document.createElement('h2'); h.textContent = title
  const s = document.createElement('div'); s.className = 'strip'
  movies.forEach(m => s.appendChild(card(m)))
  row.append(h, s)
  return row
}

/* ---------- catalogo ---------- */
async function loadCatalog() {
  rowsEl.innerHTML = '<div class="loading">Carregando catalogo...</div>'
  const frag = document.createDocumentFragment()
  for (const r of ROWS) {
    try {
      const p = { ...r.p, ...(activeGenre ? { genre: activeGenre } : {}) }
      const j = await api('/api/catalog?' + new URLSearchParams(p))
      if (j.movies?.length) frag.appendChild(strip(r.t, j.movies))
    } catch {}
  }
  rowsEl.innerHTML = ''
  rowsEl.appendChild(frag)
  if (!rowsEl.children.length) rowsEl.innerHTML = '<div class="loading">Nao foi possivel carregar o catalogo.</div>'
}

async function refreshContinue() {
  let items = []
  try { items = (await api('/api/progress')).items || [] } catch {}
  items = items.filter(i => i.d && i.t > 30)
  state.progressByHash = Object.fromEntries(items.map(i => [i.hash, i]))
  const cont = $('#contRow')
  cont.innerHTML = ''
  if (!items.length) return
  const row = document.createElement('div'); row.className = 'row'
  const h = document.createElement('h2'); h.textContent = 'Continuar assistindo'
  const s = document.createElement('div'); s.className = 'strip'
  for (const i of items) {
    s.appendChild(card({
      title: i.title || i.name, year: i.year, poster: i.poster,
      hash: i.hash, progressKey: i.key,
      source: { hash: i.hash, title: i.title, source: 'retomar', quality: '' },
      file: i.file
    }, { direct: true }))
  }
  row.append(h, s); cont.appendChild(row)
}

function renderGenres() {
  const nav = $('#genres')
  nav.innerHTML = ''
  GENRES.forEach(([id, label]) => {
    const b = document.createElement('button')
    b.className = 'chip focusable' + (id === activeGenre ? ' on' : '')
    b.textContent = label
    b.onclick = () => { activeGenre = id; renderGenres(); loadCatalog() }
    nav.appendChild(b)
  })
}

/* ---------- busca ---------- */
let debounce
$('#q').oninput = e => {
  clearTimeout(debounce)
  const q = e.target.value.trim()
  debounce = setTimeout(() => { if (!q) loadCatalog(); else runSearch(q) }, 500)
}
$('#q').onkeydown = e => {
  if (e.key === 'Enter') {
    e.preventDefault(); e.target.blur()
    if (e.target.value.trim()) runSearch(e.target.value.trim())
  }
}

$('#dubChip').classList.toggle('on', onlyDub)
$('#dubChip').onclick = () => {
  onlyDub = !onlyDub
  localStorage.setItem('cinep2p.dub', onlyDub ? '1' : '0')
  $('#dubChip').classList.toggle('on', onlyDub)
  const q = $('#q').value.trim()
  if (q) runSearch(q); else loadCatalog()
}

async function runSearch(q) {
  rowsEl.innerHTML = '<div class="loading">Buscando...</div>'
  try {
    const j = await api(\`/api/search?q=\${encodeURIComponent(q)}\${onlyDub ? '&dub=1' : ''}\`)
    rowsEl.innerHTML = ''
    const g = document.createElement('div'); g.className = 'grid'
    ;(j.results || []).forEach(m => g.appendChild(card(m)))
    ;(j.extra || []).forEach(x => g.appendChild(card({
      title: x.title.slice(0, 70), year: '', dub: x.dub, imdb: x.imdb,
      torrents: [x], genres: [], summary: \`Fonte extra | \${x.seeds} seeds | \${x.size}\`
    })))
    rowsEl.appendChild(g)
    if (!g.children.length) rowsEl.innerHTML = '<div class="loading">Nada encontrado.</div>'
  } catch (e) {
    rowsEl.innerHTML = \`<div class="loading">Erro: \${esc(e.message)}</div>\`
  }
}

/* ---------- detalhe ---------- */
function langTags(x) {
  const tags = []
  if (x.dub) tags.push('<span class="tag dub">Dublado</span>')
  else if (x.dual) tags.push('<span class="tag dub">Dual audio</span>')
  if (x.subs) tags.push('<span class="tag">Legendado</span>')
  if ((x.langs || []).includes('ptbr')) tags.push('<span class="tag pt">PT-BR</span>')
  if (x.codec === 'x265') tags.push('<span class="tag warn">x265</span>')
  if (x.codec === 'XviD') tags.push('<span class="tag warn">XviD</span>')
  return tags.join('')
}

function srcRow(x, movie) {
  const d = document.createElement('div')
  d.className = 'src'
  d.innerHTML = \`<span class="q">\${esc(x.quality || 'SD')}</span>
    <span class="tag">\${esc(x.codec || 'n/d')}</span>
    <span class="tag">\${esc(x.source || 'Fonte')}</span>
    \${langTags(x)}
    <span class="s">\${x.seeds || 0} seeds | \${esc(x.size || '?')}</span>\`
  const b = document.createElement('button')
  b.className = 'play focusable'
  b.textContent = 'Assistir'
  b.onclick = () => openPlayer(x, movie)
  d.appendChild(b)
  return d
}

async function openDetail(movie) {
  const t = (movie.torrents || []).filter(x => x.seeds > 0)
  $('#detail').innerHTML = \`
    <div class="hero" style="background-image:url('\${esc(movie.background || movie.poster || '')}')"></div>
    <div class="dbody">
      <h1></h1><div class="dmeta"></div><div class="dsum"></div>
      <div class="sec">Fontes (\${t.length})</div><div id="srcList"></div>
      <div class="sec">Outras fontes (indice extra)</div>
      <button class="alt focusable" id="dubBtn">So dublado</button>
      <button class="alt focusable" id="more">Buscar no indice extra</button>
      <div id="extraList"></div>
    </div>\`
  $('#detail h1').textContent = \`\${movie.title || ''} \${movie.year ? '(' + movie.year + ')' : ''}\`
  $('#detail .dmeta').textContent = [(movie.genres || []).join(' | '), movie.rating ? 'Nota ' + movie.rating : '', movie.runtime ? movie.runtime + ' min' : ''].filter(Boolean).join(' | ')
  $('#detail .dsum').textContent = movie.summary || ''

  const list = $('#srcList')
  if (!t.length) list.innerHTML = '<div class="dsum">Nenhuma fonte com seed agora.</div>'
  t.forEach(x => list.appendChild(srcRow(x, movie)))

  let extraDub = onlyDub
  const dubBtn = $('#dubBtn')
  dubBtn.classList.toggle('on', extraDub)
  dubBtn.onclick = () => { extraDub = !extraDub; dubBtn.classList.toggle('on', extraDub); $('#more').click() }

  $('#more').onclick = async e => {
    e.target.disabled = true
    e.target.textContent = 'Buscando...'
    try {
      const j = await api(\`/api/extra?title=\${encodeURIComponent(movie.title)}&year=\${movie.year || ''}\${extraDub ? '&dub=1' : ''}\`)
      const ex = $('#extraList'); ex.innerHTML = ''
      if (!j.results?.length) ex.innerHTML = '<div class="dsum">Nada encontrado.</div>'
      ;(j.results || []).forEach(x => ex.appendChild(srcRow(x, movie)))
      e.target.textContent = 'Atualizar indice extra'
      e.target.disabled = false
    } catch {
      e.target.textContent = 'Tentar novamente'
      e.target.disabled = false
    }
  }

  $('#modal').classList.remove('hidden')
  pushLayer(() => $('#modal').classList.add('hidden'))
}

$('#closeModal').onclick = () => closeTop()
$('#closeDiag').onclick = () => closeTop()

/* ---------- player ---------- */
let poll = null
let saveTimer = null
let wakeLock = null
let hideTopTimer = null
let watchdog = null

function setSrc(posFrac) {
  const p = new URLSearchParams({ name: state.label })
  if (state.fileIndex != null) p.set('file', state.fileIndex)
  p.set('mode', state.mode)
  if (state.hint) p.set('hint', state.hint)
  if (state.mode !== 'direct') {
    p.set('audio', state.audio || 0)
    if (state.q) p.set('q', state.q)
    if (posFrac) p.set('pos', posFrac.toFixed(5))
    state.base = (posFrac || 0) * (state.duration || 0)
  } else {
    state.base = 0
  }
  clearTimeout(watchdog)
  watchdog = setTimeout(() => {
    if (video.readyState < 2) showError('Ainda conectando aos peers / preparando. Se demorar, tente outra fonte.', true)
  }, 60000)
  video.src = \`/api/stream/\${state.hash}?\${p}\`
  video.play().catch(() => {})
}

function syncControls() {
  const ffm = state.mode !== 'direct'
  $('#pctl').classList.toggle('hidden', !ffm)
  video.controls = !ffm
  $('#pAudio').disabled = !(state.media?.audios?.length > 1)
  if (ffm) { showTop(true); setTimeout(() => { try { $('#pseek').focus() } catch {} }, 60) }
  else { $('#ptop').classList.add('hidden'); setTimeout(() => { try { video.focus() } catch {} }, 60) }
}

async function openPlayer(source, movie, fileIndex) {
  Object.assign(state, {
    open: true, movie, source, hash: source.hash, fileIndex: fileIndex ?? null,
    label: \`\${movie.title || source.title || ''} \${movie.year || ''}\`.trim(),
    hint: source.codec || '',
    audio: 0, q: '', mode: 'auto', media: null, files: [], externalSubs: [],
    duration: 0, base: 0, sub: -1, tried: 0, forceCompat: false, key: null
  })
  $('#ptitle').textContent = state.label
  $('#player').classList.remove('hidden')
  $('#pmsg').textContent = ''
  $('#pmsg').classList.remove('err')
  video.removeAttribute('src')
  $$('track').forEach(t => t.remove())
  $('#pspin').classList.remove('hidden')
  $('#ptop').classList.add('hidden')
  $('#pctl').classList.add('hidden')
  $('#pmenu').classList.add('hidden')
  pushLayer(closePlayer)
  requestWakeLock()
  try { $('#player').requestFullscreen?.().catch(() => {}) } catch {}

  clearInterval(poll)
  poll = setInterval(async () => {
    try {
      const s = await api('/api/status/' + state.hash)
      if (s.state === 'metadata') $('#pmsg').textContent = \`Procurando peers... \${s.peers || 0} conectados\`
      else if (s.state === 'ready' && !$('#pmsg').classList.contains('err')) {
        $('#pmsg').textContent = \`\${s.peers} peers | \${(s.downloadSpeed / 1e6).toFixed(1)} MB/s | \${(s.progress * 100).toFixed(1)}% em cache\`
        $('#badge').textContent = s.peers + ' ativos'
      }
    } catch {}
  }, 1000)

  try {
    const j = await api(\`/api/prepare/\${state.hash}?name=\${encodeURIComponent(state.label)}\${state.fileIndex != null ? '&file=' + state.fileIndex : ''}\`)
    applyPrepared(j)
  } catch (e) {
    $('#pspin').classList.add('hidden')
    clearInterval(poll)
    showError(e.message, true)
  }
}

function applyPrepared(j) {
  state.files = j.files || []
  state.externalSubs = j.externalSubs || []
  state.media = j.media || null
  state.duration = state.media?.duration || 0
  if (j.file != null) state.fileIndex = j.file

  const audios = state.media?.audios || []
  if (audios.length > 1) {
    const pt = audios.findIndex(a => ['pt', 'pt-br', 'por', 'pob'].includes(String(a.lang).toLowerCase()))
    if (pt > 0) state.audio = pt
  }
  state.mode = state.forceCompat ? state.mode : (j.mode || 'auto')
  if (state.mode === 'direct' && state.audio) state.mode = 'remux'
  syncControls()
  buildSubs()
  setSrc(0)
  $('#pspin').classList.add('hidden')
  if (!j.ffmpeg) toast('ffmpeg nao encontrado: so mp4/h264 vai tocar.', [], 8000)
  resumeOrStart()
}

function buildSubs() {
  $$('track').forEach(t => t.remove())
  const list = [
    ...state.externalSubs.map(s => ({ ...s, url: \`/api/subs/\${state.hash}?file=\${state.fileIndex}&ext=\${s.i}\` })),
    ...(state.media?.subs || []).filter(s => s.text).map(s => ({ ...s, kind: 'embedded', url: \`/api/subs/\${state.hash}?file=\${state.fileIndex}&track=\${s.i}\` }))
  ]
  state.subList = list
  for (const s of list) {
    const tr = document.createElement('track')
    tr.kind = 'subtitles'
    tr.label = s.label || 'Legenda'
    tr.srclang = s.lang || 'und'
    tr.src = s.url
    video.appendChild(tr)
  }
  const idx = list.findIndex(s => ['pt-br', 'pt', 'pob'].includes(String(s.lang).toLowerCase()))
  setSub(idx >= 0 ? idx : -1)
}

function setSub(idx) {
  const tracks = $$('#video track')
  tracks.forEach((t, i) => { try { t.track.mode = i === idx ? 'showing' : 'disabled' } catch {} })
  state.sub = idx
  if (idx >= 0 && state.subList?.[idx]?.kind === 'embedded') toast('Preparando legenda do arquivo... pode demorar na primeira vez.')
}

async function resumeOrStart() {
  const key = \`\${state.hash}:\${state.fileIndex ?? 'main'}\`
  state.key = key
  let p = null
  try { p = await api('/api/progress/' + encodeURIComponent(key)) } catch {}
  const t = Number(p?.t || 0)
  const d = Number(p?.d || state.duration || 0)
  const resume = (t > 30 && d && t < d - 60) ? t : 0
  if (resume) {
    toast(\`Retomando de \${fmtTime(resume)}\`, [
      ['Comecar do inicio', () => { setSrc(0); video.play().catch(() => {}) }]
    ], 9000)
    state.pendingSeek = resume
    seekTo(resume)
  }
  clearInterval(saveTimer)
  saveTimer = setInterval(() => saveProgress(), 5000)
}

function position() { return (state.base || 0) + (video.currentTime || 0) }
function total() { return state.duration || video.duration || 0 }

function seekTo(seconds) {
  const d = total()
  if (!d) return
  if (state.mode === 'direct') {
    if (video.readyState >= 1) video.currentTime = seconds
    else state.pendingSeek = seconds
    return
  }
  const frac = Math.min(0.995, Math.max(0, seconds / d))
  setSrc(frac)
  video.play().catch(() => {})
}

function saveProgress(force) {
  if (!state.hash || !state.key) return
  const t = position(), d = total()
  if (!d || t < 3) return
  const body = {
    key: state.key, t, d, hash: state.hash, file: state.fileIndex,
    title: state.movie?.title || state.label, year: state.movie?.year || '',
    poster: state.movie?.poster || '', name: state.label
  }
  const blob = new Blob([JSON.stringify(body)], { type: 'application/json' })
  if (force && navigator.sendBeacon && navigator.sendBeacon('/api/progress', blob)) return
  fetch('/api/progress', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), keepalive: !!force
  }).catch(() => {})
}

function closePlayer() {
  saveProgress(true)
  clearInterval(poll); clearInterval(saveTimer); clearTimeout(watchdog)
  releaseWakeLock()
  try { video.pause() } catch {}
  video.removeAttribute('src'); video.load()
  $('#player').classList.add('hidden')
  $('#pmenu').classList.add('hidden')
  state.open = false
  try { document.exitFullscreen?.() } catch {}
  refreshContinue()
}

function showError(msg, sticky) {
  $('#pmsg').textContent = msg
  $('#pmsg').classList.add('err')
  if (!sticky) setTimeout(() => $('#pmsg').classList.remove('err'), 5000)
}

function showTop(v) {
  $('#ptop').classList.toggle('hidden', !v)
  if (v) {
    clearTimeout(hideTopTimer)
    hideTopTimer = setTimeout(() => { if (state.mode === 'direct') $('#ptop').classList.add('hidden') }, 7000)
  }
}

video.onerror = () => {
  if (!state.open || !video.getAttribute('src')) return
  const i = CHAIN.indexOf(state.mode)
  if (health.ffmpeg && i >= 0 && i < CHAIN.length - 1) {
    state.mode = CHAIN[i + 1]
    state.forceCompat = true
    syncControls()
    showError(\`O navegador recusou o formato. Tentando modo \${MODE_LABEL[state.mode]}...\`)
    setSrc(total() ? position() / total() : 0)
    return
  }
  showError('Nao foi possivel reproduzir. Abra o Diagnostico e me mande o resultado.', true)
}
video.onloadedmetadata = () => {
  clearTimeout(watchdog)
  if (!state.duration && isFinite(video.duration)) state.duration = video.duration
  if (state.pendingSeek && state.mode === 'direct') { video.currentTime = state.pendingSeek; state.pendingSeek = null }
}
video.oncanplay = () => { clearTimeout(watchdog); $('#pmsg').classList.remove('err') }
video.onplay = () => { $('#pplay').textContent = 'Pausar'; requestWakeLock() }
video.onpause = () => { $('#pplay').textContent = 'Tocar'; saveProgress() }
video.ontimeupdate = () => {
  const d = total()
  $('#ptime').textContent = fmtTime(position())
  $('#pdur').textContent = d ? fmtTime(d) : '--:--'
  if (d && document.activeElement !== $('#pseek')) $('#pseek').value = Math.round((position() / d) * 1000)
}
video.onclick = () => { if (state.mode === 'direct') showTop($('#ptop').classList.contains('hidden')) }

$('#pseek').onchange = e => seekTo((Number(e.target.value) / 1000) * total())
$('#pplay').onclick = () => video.paused ? video.play() : video.pause()
$('#pvolD').onclick = () => { video.volume = Math.max(0, video.volume - 0.1) }
$('#pvolU').onclick = () => { video.volume = Math.min(1, video.volume + 0.1) }
$('#pClose').onclick = () => closeTop()
$('#pFs').onclick = () => { document.fullscreenElement ? document.exitFullscreen() : $('#player').requestFullscreen?.() }
$('#pAudio').onclick = () => openMenu('audio')
$('#pSubs').onclick = () => openMenu('subs')
$('#pMode').onclick = () => openMenu('mode')
$('#pDiag').onclick = () => runDiag()
$('#pLink').onclick = () => {
  const url = new URL(video.getAttribute('src') || '', location.origin).href
  navigator.clipboard?.writeText(url).then(
    () => toast('Link copiado. Cole no VLC para testar.'),
    () => toast(url, [], 12000)
  )
}

async function runDiag() {
  $('#diagText').textContent = 'Rodando...'
  $('#diagModal').classList.remove('hidden')
  pushLayer(() => $('#diagModal').classList.add('hidden'))
  try {
    const j = await api(\`/api/diag/\${state.hash}?name=\${encodeURIComponent(state.label)}\`)
    const linhas = []
    linhas.push('torrent: ' + state.label)
    linhas.push('peers: ' + (j.peers ?? '-') + '   progresso: ' + ((j.progress || 0) * 100).toFixed(1) + '%')
    linhas.push('ffmpeg: ' + (j.ffmpeg?.ok ? 'ok (' + j.ffmpeg.source + ')' : 'NAO ENCONTRADO'))
    linhas.push('modo sugerido: ' + (j.modoSugerido || '-'))
    if (j.file) linhas.push('arquivo: ' + j.file.nome + ' (' + Math.round(j.file.bytes / 1e6) + ' MB)')
    if (j.media) linhas.push('codec: ' + (j.media.video?.codec || '?') + '  audios: ' + j.media.audios.length + '  legendas: ' + j.media.subs.length)
    linhas.push('')
    linhas.push('passos:')
    for (const s of j.steps) linhas.push('  [' + (s.ok ? 'ok' : 'FALHOU') + '] ' + s.label + ' ' + JSON.stringify({ ...s, label: undefined, ok: undefined }))
    if (j.errors?.length) { linhas.push(''); linhas.push('erros: ' + j.errors.join(' | ')) }
    const txt = linhas.join('\n')
    $('#diagText').textContent = txt
    $('#diagCopy').onclick = () => navigator.clipboard?.writeText(txt)
  } catch (e) {
    $('#diagText').textContent = 'Falhou: ' + e.message
  }
}

function openMenu(kind) {
  const m = $('#pmenu')
  m.innerHTML = ''
  m.classList.remove('hidden')
  const h = txt => { const e = document.createElement('h3'); e.textContent = txt; m.appendChild(e) }
  const add = (label, on, fn) => {
    const b = document.createElement('button')
    b.className = 'focusable' + (on ? ' on' : '')
    b.textContent = label
    b.onclick = () => { m.classList.add('hidden'); fn() }
    m.appendChild(b)
  }
  const reSeek = () => setSrc(total() ? position() / total() : 0)

  if (kind === 'audio') {
    h('Idioma do audio')
    const list = state.media?.audios || []
    if (list.length < 2) add('So uma faixa neste arquivo', true, () => {})
    list.forEach(a => add(a.label || \`Faixa \${a.i + 1}\`, state.audio === a.i, () => {
      if (!health.ffmpeg) return toast('ffmpeg nao encontrado.')
      state.audio = a.i
      state.forceCompat = true
      if (state.mode === 'direct') state.mode = 'remux'
      syncControls(); reSeek()
    }))
  }

  if (kind === 'subs') {
    h('Legenda')
    add('Desligada', state.sub === -1, () => setSub(-1))
    ;(state.subList || []).forEach((s, i) => add((s.label || \`Legenda \${i + 1}\`) + (s.kind === 'embedded' ? ' (no arquivo)' : ''), state.sub === i, () => setSub(i)))
  }

  if (kind === 'mode') {
    h('Modo de reproducao')
    CHAIN.forEach(md => add(MODE_LABEL[md] + (md === 'direct' ? ' (menos CPU)' : md === 'transcode' ? ' (converter)' : ''), state.mode === md, () => {
      state.mode = md
      state.forceCompat = true
      syncControls()
      md === 'direct' ? setSrc(0) : reSeek()
    }))
    h('Qualidade (modo leve)')
    ;[['', 'Original'], ['720', '720p'], ['480', '480p']].forEach(([v, l]) =>
      add(l, state.q === v, () => {
        state.q = v
        if (state.mode !== 'transcode') { state.mode = 'transcode'; state.forceCompat = true }
        syncControls(); reSeek()
      }))
  }

  const first = m.querySelector('button')
  if (first) first.focus()
}
$('#pmenu').onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); $('#pmenu').classList.add('hidden') } }

/* ---------- tela sempre ligada ---------- */
async function requestWakeLock() {
  try { if (!wakeLock && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen') } catch {}
}
function releaseWakeLock() { try { wakeLock?.release(); wakeLock = null } catch {} }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.open) requestWakeLock()
  if (document.visibilityState === 'hidden') saveProgress(true)
})
window.addEventListener('pagehide', () => saveProgress(true))

/* ---------- modo TV ---------- */
if (localStorage.getItem('cinep2p.tv') === '1') document.documentElement.classList.add('tv')
$('#tvBtn').onclick = () => {
  const on = document.documentElement.classList.toggle('tv')
  localStorage.setItem('cinep2p.tv', on ? '1' : '0')
}

/* ---------- instalar como app ---------- */
let installEvt = null
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone
if (standalone) $('#installBtn').classList.add('hidden')
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault()
  installEvt = e
})
$('#installBtn').onclick = async () => {
  if (installEvt) { installEvt.prompt(); installEvt = null; return }
  const https = location.protocol === 'https:'
  toast(https
    ? 'Menu do navegador -> "Instalar aplicativo" ou "Adicionar a tela inicial".'
    : 'Para instalar como app rode "npm run https" e abra pelo https.', [], 12000)
}

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

/* ---------- boot ---------- */
renderGenres()
api('/api/health').then(h => {
  health = h
  if (!h.ffmpeg) toast('ffmpeg nao encontrado: mkv/x265 pode nao tocar.', [], 9000)
}).catch(() => {})
refreshContinue().then(loadCatalog)
setInterval(async () => {
  try { const j = await api('/api/active'); $('#badge').textContent = j.active + ' ativos' } catch {}
}, 5000)
`)

/* ======================= public/manifest.webmanifest ================== */
add('public/manifest.webmanifest', String.raw`
{
  "id": "cinep2p",
  "name": "cinep2p",
  "short_name": "cinep2p",
  "description": "Catalogo e streaming P2P",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "display_override": ["fullscreen", "standalone", "minimal-ui"],
  "orientation": "any",
  "background_color": "#0b0b11",
  "theme_color": "#0b0b11",
  "categories": ["video", "entertainment"],
  "icons": [
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "maskable" }
  ]
}
`)

/* ============================= public/sw.js =========================== */
add('public/sw.js', String.raw`
const CACHE = 'cinep2p-v2'
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/icon.svg', '/manifest.webmanifest']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (url.pathname.startsWith('/api/')) return
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone()
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {})
      return r
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  )
})
`)

/* ============================ public/icon.svg ========================= */
add('public/icon.svg', String.raw`
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#3b1d7a"/><stop offset="1" stop-color="#0b0b11"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="110" fill="url(#g)"/>
  <circle cx="256" cy="222" r="96" fill="none" stroke="#a78bfa" stroke-width="10"/>
  <path d="M228 172 L318 222 L228 272 Z" fill="#e9e2ff"/>
  <text x="256" y="400" fill="#c4b5fd" font-family="Arial, sans-serif" font-size="66" font-weight="800" text-anchor="middle" letter-spacing="6">CINEP2P</text>
</svg>
`)

/* ========================== gravar + zipar ============================ */
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function makeZip(entries) {
  const local = []
  const central = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8')
    const crc = crc32(raw)
    const deflated = zlib.deflateRawSync(raw)
    const useDeflate = deflated.length < raw.length
    const data = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0

    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0x0800, 6)
    lh.writeUInt16LE(method, 8)
    lh.writeUInt16LE(0, 10)
    lh.writeUInt16LE(0x21, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(data.length, 18)
    lh.writeUInt32LE(raw.length, 22)
    lh.writeUInt16LE(name.length, 26)
    lh.writeUInt16LE(0, 28)
    local.push(lh, name, data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0x21, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(raw.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, name)

    offset += lh.length + name.length + data.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...local, cdBuf, eocd])
}

for (const [rel, data] of Object.entries(files)) {
  const full = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, data)
  console.log('  ok  ' + rel)
}

try { files['setup.mjs'] = fs.readFileSync(new URL(import.meta.url), 'utf8') } catch {}

const zipEntries = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, data]) => ({ name: 'cinep2p/' + name, data }))

const zipPath = path.join(ROOT, 'cinep2p.zip')
fs.writeFileSync(zipPath, makeZip(zipEntries))

console.log('')
console.log('  ' + Object.keys(files).length + ' arquivos gravados em ' + ROOT)
console.log('  zip criado: ' + zipPath)
console.log('')
console.log('  Agora rode:  npm install  &&  npm run https')
console.log('')