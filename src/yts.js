const BASE = 'https://yts.mx/api/v2'

export const TRACKERS = [
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:80/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce'
]

export function buildMagnet(hash, name = '') {
  const parts = [
    ['xt', `urn:btih:${hash}`],
    ['dn', name],
    ...TRACKERS.map(t => ['tr', t])
  ]
  return 'magnet:?' + parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
}

async function getJSON(url, ms = 12000) {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'cinep2p/0.1' } })
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`)
    return await r.json()
  } finally {
    clearTimeout(to)
  }
}

function normalize(m) {
  const title = m.title_english || m.title
  return {
    id: `yts-${m.id}`,
    imdb: m.imdb_code,
    title,
    year: m.year,
    rating: m.rating,
    runtime: m.runtime,
    genres: m.genres || [],
    summary: m.summary || '',
    poster: m.large_cover_image || m.medium_cover_image,
    background: m.background_image_original || m.background_image || '',
    torrents: (m.torrents || []).map(t => ({
      hash: t.hash,
      quality: t.quality,
      codec: t.video_codec,
      type: t.type,
      seeds: t.seeds,
      peers: t.peers,
      size: t.size,
      sizeBytes: t.size_bytes,
      magnet: buildMagnet(t.hash, `${title} ${m.year} ${t.quality}`),
      source: 'YTS'
    })).sort((a, b) => b.seeds - a.seeds)
  }
}

export async function listMovies({ genre = '', sort = 'year', order = 'desc', page = 1 }) {
  const p = new URLSearchParams({
    limit: '24',
    page: String(page),
    sort_by: sort,
    order_by: order
  })
  if (genre) p.set('genre', genre)
  const j = await getJSON(`${BASE}/list_movies.json?${p}`)
  return { page, movies: (j?.data?.movies || []).map(normalize) }
}

export async function searchMovies(q) {
  const p = new URLSearchParams({ query_term: q, limit: '20' })
  const j = await getJSON(`${BASE}/list_movies.json?${p}`)
  return (j?.data?.movies || []).map(normalize)
}