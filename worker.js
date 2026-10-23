const BASES = [
  'https://movies-api.accel.li/api/v2',
  'https://yts.lt/api/v2',
  'https://yts.gg/api/v2',
  'https://yts.bz/api/v2',
  'https://yts.rs/api/v2'
]
const APIS = ['https://apibay.org', 'https://apibay.qicp.vip']
const VIDEO_CATS = new Set([201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213])

const PT = /(dublado|dublada|dublagem|nacional|brasileir[oa]|brazilian|\bptbr\b|\bpt[-_. ]?br\b|\bpob\b|\bbrdub\b|\bbr[-_. ]?dub\b|portugu[eê]s|\bpor\b)/i
const DUAL = /(dual[ ._-]?[aá]udio|dual[ ._-]?audio|\bdual\b)/i
const LEG = /(legendado|legendad[ao]|legendas?|subbed|subtitled)/i

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*'
    }
  })
}

async function yts(path) {
  let lastError = 'Catalogo temporariamente indisponivel'
  for (const base of BASES) {
    try {
      const response = await fetch(base + path, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      })
      if (!response.ok) { lastError = 'Fonte respondeu HTTP ' + response.status; continue }
      const body = await response.json()
      if (body?.status === 'ok' && body?.data) return body.data
      lastError = 'Resposta inesperada da fonte'
    } catch (error) {
      lastError = String(error?.message || error)
    }
  }
  throw new Error(lastError)
}

async function apibay(path) {
  let lastError = 'Indice PT-BR indisponivel'
  for (const base of APIS) {
    try {
      const r = await fetch(base + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
      if (!r.ok) { lastError = 'Fonte respondeu HTTP ' + r.status; continue }
      const j = await r.json()
      if (Array.isArray(j)) return j
      lastError = 'Resposta inesperada'
    } catch (e) { lastError = String(e?.message || e) }
  }
  throw new Error(lastError)
}

function normalize(movie) {
  return {
    id: 'yts-' + (movie.id || movie.imdb_code || movie.title),
    imdb: movie.imdb_code || '',
    title: movie.title_english || movie.title || '',
    year: movie.year || '',
    rating: movie.rating || 0,
    runtime: movie.runtime || 0,
    genres: movie.genres || [],
    language: movie.language || '',
    summary: movie.summary || movie.description_full || movie.synopsis || '',
    poster: movie.large_cover_image || movie.medium_cover_image || movie.small_cover_image || '',
    background: movie.background_image_original || movie.background_image || '',
    torrents: (movie.torrents || []).map(t => ({
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

function qualityOf(n) {
  if (/2160p|4k/i.test(n)) return '2160p'
  if (/1080p/i.test(n)) return '1080p'
  if (/720p/i.test(n)) return '720p'
  if (/480p/i.test(n)) return '480p'
  return 'SD'
}
function codecOf(n) {
  if (/x265|h\.?265|hevc/i.test(n)) return 'x265'
  if (/x264|h\.?264|avc/i.test(n)) return 'x264'
  if (/\bav1\b/i.test(n)) return 'AV1'
  return ''
}
function human(bytes) {
  if (!bytes) return '?'
  const gb = bytes / 1e9
  return gb >= 1 ? gb.toFixed(2) + ' GB' : (bytes / 1e6).toFixed(0) + ' MB'
}
const yearOf = s => (/\b(19\d{2}|20\d{2})\b/.exec(String(s || '')) || [])[1] || ''

function normalizeBay(x) {
  const name = String(x.name || '')
  if (!name || name === 'No results returned') return null
  const size = Number(x.size) || 0
  const cat = Number(x.category) || 0
  const dub = PT.test(name)
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
    video: VIDEO_CATS.has(cat),
    imdb: x.imdb || '',
    year: yearOf(name),
    dub,
    dual: DUAL.test(name),
    subs: LEG.test(name),
    langs: dub ? ['ptbr'] : [],
    source: 'TPB'
  }
}
const cleanBay = list => list.map(normalizeBay).filter(t => t && t.seeds > 0 && /^[0-9a-f]{40}$/.test(t.hash))

function matchesLang(item, lang) {
  const s = String(lang || '').trim().toLowerCase()
  if (!s || s === 'all' || s === 'world') return true
  const t = String(item?.title || item || '')
  const dub = Boolean(item?.dub) || PT.test(t)
  const dual = Boolean(item?.dual) || DUAL.test(t)
  const subs = Boolean(item?.subs) || LEG.test(t)
  if (['dub', 'dublado', 'dublada'].includes(s)) return dub
  if (['dual', 'dual-audio', 'dualaudio'].includes(s)) return dual
  if (['subs', 'sub', 'legendado'].includes(s)) return subs
  if (['ptbr', 'pt-br', 'pt', 'por', 'pob', 'portuguese', 'portugues'].includes(s)) return dub || dual || subs
  return true
}

function bayScore(t) {
  let s = Math.min(t.seeds, 250)
  if (t.quality === '1080p') s += 60
  else if (t.quality === '720p') s += 35
  else if (t.quality === '2160p') s += 12
  if (t.codec === 'x264') s += 14
  if (t.codec === 'x265') s += 6
  if (t.dub || (t.langs || []).includes('ptbr')) s += 1500
  else if (t.dual) s += 350
  else if (t.subs) s += 100
  if (/\b(cam|hdcam|ts)\b/i.test(t.title)) s -= 45
  if (!t.video) s -= 90
  return s
}
const bayRank = list => [...list].sort((a, b) => bayScore(b) - bayScore(a))

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return json({ ok: true, platform: 'cloudflare-workers', catalog: true, brCatalog: true, torrentStreaming: false })
    }

    if (url.pathname === '/api/catalog') {
      try {
        const page = Math.max(1, Math.min(100, Number(url.searchParams.get('page') || 1)))
        const sort = url.searchParams.get('sort') || 'year'
        const order = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc'
        const genre = (url.searchParams.get('genre') || '').slice(0, 40)
        const params = new URLSearchParams({ limit: '24', page: String(page), sort_by: sort, order_by: order })
        if (genre) params.set('genre', genre)
        const data = await yts('/list_movies.json?' + params.toString())
        return json({ page, movies: (data.movies || []).map(normalize), demo: false })
      } catch (error) {
        return json({ error: 'Nao foi possivel carregar o catalogo agora.', detail: String(error?.message || error), movies: [] }, 502)
      }
    }

    // Catalogo PT-BR (mesma semantica do server.js).
    if (url.pathname === '/api/br') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 180)
      const catRaw = (url.searchParams.get('cat') || '').trim()
      const cats = catRaw ? catRaw.split(',').map(Number).filter(Number.isFinite) : [201, 207]
      const lang = (url.searchParams.get('lang') || '').trim().toLowerCase()
      const limit = Math.max(1, Math.min(60, Number(url.searchParams.get('limit') || 24)))
      try {
        let list = []
        if (q) {
          list = cleanBay(await apibay('/q.php?q=' + encodeURIComponent(q)))
        } else {
          const parts = await Promise.all(cats.map(c => apibay('/top.php?cat=' + c).catch(() => [])))
          const seen = new Set()
          for (const arr of parts) for (const t of cleanBay(arr)) { if (!seen.has(t.hash)) { seen.add(t.hash); list.push(t) } }
        }
        let filtered = lang ? list.filter(x => matchesLang(x, lang)) : list
        if (filtered.length < 3) filtered = list
        return json({ results: bayRank(filtered).slice(0, limit), source: 'TPB', lang: lang || 'all', count: filtered.length })
      } catch (error) {
        return json({ results: [], error: String(error?.message || error) }, 502)
      }
    }

    if (url.pathname === '/api/search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 120)
      if (!q) return json({ results: [], extra: [] })
      const onlyDub = url.searchParams.get('dub') === '1'
      const [ytsRes, bayRes] = await Promise.all([
        yts('/list_movies.json?' + new URLSearchParams({ query_term: q, limit: '20' }).toString())
          .then(d => (d.movies || []).map(normalize)).catch(() => []),
        apibay('/q.php?q=' + encodeURIComponent(onlyDub ? q + ' dublado' : q)).then(cleanBay).catch(() => [])
      ])
      const extra = onlyDub ? bayRank(bayRes.filter(t => t.dub)) : bayRank(bayRes)
      return json({ results: ytsRes, extra: extra.slice(0, 20) })
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Esta funcao ainda precisa de um servidor compativel com o Cinep2p completo.', route: url.pathname }, 501)
    }
    return env.ASSETS.fetch(request)
  }
}