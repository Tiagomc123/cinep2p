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
const IDLE_MINUTES = Math.max(1, Number(process.env.IDLE_MINUTES || 1))
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
      client.remove(key, { destroyStore: true }).catch(() => {})
      log('falha no torrent', key.slice(0, 8), '-', err.message)
      reject(err)
    }
    try {
      entry.torrent = client.add({ infoHash: key, name: String(name || '').slice(0, 120) }, { path: path.join(DOWNLOAD_DIR, key), announce: TRACKERS, destroyStoreOnDestroy: true })
    } catch (e) { return fail(e) }

    log('adicionado', key.slice(0, 8), name || '')

    entry.timer = setTimeout(() => {
      const peers = entry.torrent ? entry.torrent.numPeers : 0
      fail(new Error(peers
        ? `Os ${peers} peers conectados nao enviaram os metadados em ${METADATA_TIMEOUT / 1000}s. Tente outra fonte.`
        : `Nenhum peer encontrado em ${METADATA_TIMEOUT / 1000}s. Tente outra qualidade ou fonte.`))
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
  try { await client.remove(key, { destroyStore: true }) } catch {}
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
      label: [a.title, langName(a.lang)].filter(Boolean).join(' / ') || `Faixa ${a.i + 1}`
    })),
    subs: p.subs.map(s => ({
      i: s.i, codec: s.codec, lang: s.lang,
      label: [s.title, langName(s.lang)].filter(Boolean).join(' / ') || `Legenda ${s.i + 1}`,
      text: ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'].includes(String(s.codec).toLowerCase())
    }))
  }
}

export function getProbe(torrent, file) {
  const key = `${torrent.infoHash}:${file.name}`
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
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end() }
      partial = true
    }
  }
  res.writeHead(partial ? 206 : 200, {
    ...base,
    ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}),
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
  args.push('-map', audios.length ? `0:a:${aIdx}` : '0:a:0?')

  if (mode === 'transcode') {
    if (q === '720' || q === '480') args.push('-vf', `scale=-2:${q}`)
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
    if (code && code !== 0) log(`ffmpeg/${mode} saida ${code}: ${err.trim().split('\n').pop() || ''}`)
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
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}.${m[4].padEnd(3, '0').slice(0, 3)}`
}

function assToVtt(text) {
  const cues = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^Dialogue:\s*([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),(.*)$/.exec(line)
    if (!m) continue
    const txt = m[10].replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\n/gi, '\n')
    cues.push(`${assTime(m[2])} --> ${assTime(m[3])}\n${txt}`)
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
  const out = path.join(SUBS_DIR, `${torrent.infoHash}-${safe}-s${track}.vtt`)
  if (fs.existsSync(out)) return fs.readFileSync(out, 'utf8')
  if (subJobs.has(out)) return subJobs.get(out)

  const job = new Promise((resolve, reject) => {
    const tmp = out + '.tmp'
    const args = ['-hide_banner', '-loglevel', 'error', '-probesize', '4M', '-analyzeduration', '4M',
      '-i', 'pipe:0', '-map', `0:s:${Number(track)}`, '-f', 'webvtt', tmp]
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
      client.remove(key, { destroyStore: true }).catch(() => {})
    }
  }
}, 15e3).unref()

export function destroyClient() { try { client.destroy() } catch {} }
