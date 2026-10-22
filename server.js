import express from 'express'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { listMovies, searchMovies } from './src/yts.js'
import { searchApibay, rank } from './src/apibay.js'
import { ensureTorrent, serveFile, status, stop } from './src/streamer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.PORT || 3000)

app.use(express.static(path.join(__dirname, 'public')))

app.get('/api/catalog', async (req, res) => {
  try {
    const { genre = '', sort = 'year', order = 'desc', page = '1' } = req.query
    res.json(await listMovies({ genre, sort, order, page: Number(page) }))
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (!q) return res.json({ results: [], extra: [] })
  const [yts, bay] = await Promise.all([
    searchMovies(q).catch(() => []),
    searchApibay(q).catch(() => [])
  ])
  res.json({ results: yts, extra: rank(bay).slice(0, 15) })
})

app.get('/api/extra', async (req, res) => {
  const q = `${req.query.title || ''} ${req.query.year || ''}`.trim()
  if (!q) return res.json({ results: [] })
  try {
    res.json({ results: rank(await searchApibay(q)).slice(0, 15) })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.get('/api/stream/:hash', async (req, res) => {
  try {
    const torrent = await ensureTorrent(req.params.hash, String(req.query.name || ''))
    serveFile(torrent, req, res)
  } catch (e) {
    if (!res.headersSent) res.status(504).json({ error: e.message })
  }
})

app.get('/api/status/:hash', (req, res) => res.json(status(req.params.hash)))

app.post('/api/stop/:hash', (req, res) => {
  stop(req.params.hash)
  res.json({ ok: true })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log('')
  console.log('  cinep2p no ar')
  console.log('')
  console.log(`  Neste PC:  http://localhost:${PORT}`)
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  Na rede:   http://${a.address}:${PORT}   <- abra no celular e na TV Box`)
      }
    }
  }
  console.log('')
  console.log('  Ctrl+C para parar.')
  console.log('')
})