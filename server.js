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
  app.delete('/api/progress', (_req, res) => { progress.clear(); res.json({ ok: true }) })
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
  console.log(`  Neste PC:  ${scheme}://localhost:${PORT}`)
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  Na rede:   ${scheme}://${a.address}:${PORT}   <- celular, TV Box, projetor`)
      }
    }
  }
  console.log('')
  console.log(`  ffmpeg: ${ff ? 'ok (' + ffmpegInfo().source + ')' : 'NAO ENCONTRADO'}`)
  console.log('  dica: para instalar como app no celular, use npm run https')
  console.log('')
  console.log('  Ctrl+C para parar.')
  console.log('')
})

process.on('SIGINT', () => { destroyClient(); process.exit(0) })
