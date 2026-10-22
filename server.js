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
const posterCache = new Map()
const posterPending = new Map()

app.use(express.static(path.join(__dirname, 'public')))

// Busca um cartaz YTS para resultados de fontes que nao fornecem imagem.
// Cacheia tambem resultados vazios para evitar consultas repetidas.
app.get('/api/poster', async (req, res) => {
  const title = String(req.query.title || '').trim().slice(0, 180)
  if (!title) return res.json({ poster: '' })

  const key = title.toLocaleLowerCase('pt-BR')
  if (posterCache.has(key)) return res.json({ poster: posterCache.get(key) })

  try {
    if (!posterPending.has(key)) {
      posterPending.set(key, searchMovies(title)
        .then(movies => {
          const wanted = title.toLocaleLowerCase('pt-BR')
          const ranked = [...movies].sort((a, b) => {
            const score = m => {
              const candidate = String(m.title || '').toLocaleLowerCase('pt-BR')
              if (candidate === wanted) return 3
              if (candidate.startsWith(wanted) || wanted.startsWith(candidate)) return 2
              return 1
            }
            return score(b) - score(a)
          })
          return ranked.find(m => m.poster)?.poster || ''
        })
        .catch(() => '')
        .then(poster => {
          posterCache.set(key, poster)
          posterPending.delete(key)
          return poster
        }))
    }
    res.json({ poster: await posterPending.get(key) })
  } catch {
    res.json({ poster: '' })
  }
})

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
