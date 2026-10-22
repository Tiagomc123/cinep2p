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
  const dn = String(name || '').replace(/[^\w .-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)
  const parts = ['xt=urn:btih:' + hash]
  if (dn) parts.push('dn=' + dn.replace(/ /g, '+'))
  for (const t of TRACKERS) parts.push('tr=' + t)
  return 'magnet:?' + parts.join('&')
}

let baseIndex = 0

async function getJSON(url, ms = 12000) {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'application/json' } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
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
    id: `yts-${m.id || m._id || m.imdb_code || title}`,
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
  const d = await api(`/list_movies.json?${p}`)
  return { page, movies: (d.movies || []).map(normalize) }
}

export async function searchMovies(q) {
  const p = new URLSearchParams({ query_term: q, limit: '20' })
  const d = await api(`/list_movies.json?${p}`)
  return (d.movies || []).map(normalize)
}
