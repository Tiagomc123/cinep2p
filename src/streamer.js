import fs from 'node:fs'
import path from 'node:path'
import WebTorrent from 'webtorrent'
import { buildMagnet, TRACKERS } from './yts.js'

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(process.cwd(), 'downloads')
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })

const client = new WebTorrent({ maxConns: 60 })
const registry = new Map()

client.on('error', e => console.error('[webtorrent]', e.message || e))

const VIDEO_RE = /\.(mp4|m4v|mkv|webm|avi|mov|ts)$/i
const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mov: 'video/quicktime', ts: 'video/mp2t'
}

export function ensureTorrent(hash, name = '') {
  const key = String(hash).toLowerCase()
  if (registry.has(key)) return registry.get(key).promise

  const promise = new Promise((resolve, reject) => {
    let done = false
    let torrent
    try {
      torrent = client.add(buildMagnet(key, name), {
        path: DOWNLOAD_DIR,
        announce: TRACKERS
      })
    } catch (e) {
      return reject(e)
    }

    const timer = setTimeout(() => {
      if (done) return
      done = true
      reject(new Error('Nenhum peer encontrado em 60s. Tente outra qualidade ou fonte.'))
    }, 60000)

    const finish = () => {
      if (done) return
      if (!torrent.files || torrent.files.length === 0) return
      done = true
      clearTimeout(timer)
      console.log(`[torrent] pronto: ${torrent.name} (${torrent.files.length} arquivo(s))`)
      resolve(torrent)
    }

    torrent.on('ready', finish)
    torrent.on('metadata', finish)
    torrent.on('error', err => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(err)
    })
  })

  registry.set(key, { promise, torrent: null })
  promise.then(t => { registry.get(key).torrent = t })
  promise.catch(() => registry.delete(key))
  return promise
}

function pickFile(torrent, index) {
  const files = torrent.files.filter(f => VIDEO_RE.test(f.name))
  if (!files.length) return null
  files.sort((a, b) => b.length - a.length)
  return files[Math.min(Number(index) || 0, files.length - 1)]
}

export function serveFile(torrent, req, res) {
  const file = pickFile(torrent, req.query.file)
  if (!file) return res.status(404).json({ error: 'Nenhum arquivo de video neste torrent.' })

  const total = file.length
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  }

  const range = req.headers.range
  let start = 0
  let end = total - 1

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    if (m) {
      if (m[1]) start = parseInt(m[1], 10)
      if (m[2]) end = parseInt(m[2], 10)
    }
    if (Number.isNaN(start) || start < 0) start = 0
    if (Number.isNaN(end) || end >= total) end = total - 1
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` })
      return res.end()
    }
  }

  const partial = Boolean(range)
  res.writeHead(partial ? 206 : 200, {
    ...headers,
    ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}),
    'Content-Length': end - start + 1
  })

  const stream = file.createReadStream({ start, end })
  stream.on('error', () => res.end())
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

export function status(hash) {
  const entry = registry.get(String(hash).toLowerCase())
  const t = entry && entry.torrent
  if (!t) return { ready: false }
  return {
    ready: true,
    name: t.name,
    progress: t.progress,
    downloaded: t.downloaded,
    length: t.length,
    downloadSpeed: t.downloadSpeed,
    uploadSpeed: t.uploadSpeed,
    peers: t.numPeers,
    timeRemaining: t.timeRemaining
  }
}

export function stop(hash) {
  const key = String(hash).toLowerCase()
  try { client.remove(key, { destroyStore: false }) } catch {}
  registry.delete(key)
}

export function active() {
  return [...registry.keys()]
}