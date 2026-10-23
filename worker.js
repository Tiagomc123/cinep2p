const BASES = [
  'https://movies-api.accel.li/api/v2',
  'https://yts.lt/api/v2',
  'https://yts.gg/api/v2',
  'https://yts.bz/api/v2',
  'https://yts.rs/api/v2'
]
const APIS = ['https://apibay.org', 'https://apibay.qicp.vip']
const VIDEO_CATS = new Set([201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213])
const TVMAZE = 'https://api.tvmaze.com'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

const PT = /(dublado|dublada|dublagem|nacional|brasileir[oa]|brazilian|\bptbr\b|\bpt[-_. ]?br\b|\bpob\b|\bbrdub\b|\bbr[-_. ]?dub\b|portugu[eÃª]s|\bpor\b)/i
const DUAL = /(dual[ ._-]?[aÃ¡]udio|dual[ ._-]?audio|\bdual\b)/i
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
      const response = await fetch(base + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
      if (!response.ok) { lastError = 'Fonte respondeu HTTP ' + response.status; continue }
      const body = await response.json()
      if (body?.status === 'ok' && body?.data) return body.data
      lastError = 'Resposta inesperada da fonte'
    } catch (error) { lastError = String(error?.message || error) }
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

async function getJSON(url, ms = 15000) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(ms) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return await r.json()
}

const plain = (html, n) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)

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

const COUNTRY_LIST = 'https://iptv-org.github.io/iptv/index.country.m3u'
const CATEGORY_LIST = 'https://iptv-org.github.io/iptv/index.category.m3u'
let liveCache = { at: 0, byCountry: [], byCategory: [] }

function parseM3U(text) {
  const out = []
  let cur = null
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#EXTINF')) {
      const logo = (/(?:tvg-logo|logo)="([^"]*)"/i.exec(line) || [])[1] || ''
      const group = (/group-title="([^"]*)"/i.exec(line) || [])[1] || ''
      const name = (line.split(',').pop() || '').trim()
      cur = { name, logo, group, url: '' }
    } else if (line.startsWith('#')) {
      continue
    } else if (cur) {
      cur.url = line
      if (cur.url && cur.name) out.push(cur)
      cur = null
    }
  }
  return out
}

async function getText(url, ms = 30000) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(ms) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return await r.text()
}

async function ensureLive() {
  if (liveCache.at && Date.now() - liveCache.at < 12 * 60 * 60 * 1000) return liveCache
  const [countries, categories] = await Promise.all([
    getText(COUNTRY_LIST).then(parseM3U).catch(() => []),
    getText(CATEGORY_LIST).then(parseM3U).catch(() => [])
  ])
  if (!countries.length && !categories.length && liveCache.at) return liveCache
  liveCache = { at: Date.now(), byCountry: countries, byCategory: categories }
  return liveCache
}

const proxify = u => '/api/live/proxy?url=' + encodeURIComponent(u)
function rewritePlaylist(text, baseUrl) {
  const abs = u => { try { return new URL(u, baseUrl).href } catch { return u } }
  return String(text).split(/\r?\n/).map(line => {
    const t = line.trim()
    if (!t) return line
    if (t.startsWith('#')) return t.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxify(abs(u))}"`)
    return proxify(abs(t))
  }).join('\n')
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return json({ ok: true, platform: 'cloudflare-workers', catalog: true, brCatalog: true, live: true, archive: true, tv: true, torrentStreaming: false })
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
      const terms = onlyDub ? [q + ' dublado', q + ' nacional'] : [q, q + ' dublado', q + ' nacional', q + ' dual audio', q + ' legendado']
      const [ytsRes, ...bayLists] = await Promise.all([
        yts('/list_movies.json?' + new URLSearchParams({ query_term: q, limit: '20' }).toString())
          .then(d => (d.movies || []).map(normalize)).catch(() => []),
        ...terms.map(t => apibay('/q.php?q=' + encodeURIComponent(t)).then(cleanBay).catch(() => []))
      ])
      const seen = new Map()
      for (const arr of bayLists) for (const t of arr) if (!seen.has(t.hash)) seen.set(t.hash, t)
      let all = [...seen.values()]
      const pt = all.filter(t => matchesLang(t, 'pt'))
      const rest = all.filter(t => !pt.includes(t))
      return json({ results: ytsRes, extra: [...bayRank(pt), ...bayRank(rest)].slice(0, 60) })
    }

    if (url.pathname === '/api/tv/search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80)
      if (!q) return json({ results: [] })
      try {
        const data = await getJSON(TVMAZE + '/search/shows?q=' + encodeURIComponent(q))
        return json({
          results: (Array.isArray(data) ? data : []).map(x => x?.show).filter(Boolean).map(s => ({
            id: s.id, name: s.name, year: (s.premiered || '').slice(0, 4),
            poster: s.image?.medium || '', summary: plain(s.summary, 400),
            genres: s.genres || [], status: s.status || ''
          }))
        })
      } catch (e) { return json({ results: [], error: String(e?.message || e) }) }
    }

    const showMatch = /^\/api\/tv\/show\/(\d+)$/.exec(url.pathname)
    if (showMatch) {
      try {
        const id = Number(showMatch[1])
        const [show, eps] = await Promise.all([
          getJSON(`${TVMAZE}/shows/${id}`).catch(() => null),
          getJSON(`${TVMAZE}/shows/${id}/episodes`).catch(() => [])
        ])
        const list = (Array.isArray(eps) ? eps : []).filter(e => Number(e.season) > 0 && Number(e.number) > 0)
        const bySeason = new Map()
        for (const e of list) {
          if (!bySeason.has(e.season)) bySeason.set(e.season, [])
          bySeason.get(e.season).push({ season: e.season, episode: e.number, name: e.name || `Episodio ${e.number}`, airdate: e.airdate || '', summary: plain(e.summary, 300) })
        }
        return json({
          show: show ? { id: show.id, name: show.name, poster: show.image?.medium || '', year: (show.premiered || '').slice(0, 4) } : null,
          seasons: [...bySeason.entries()].map(([season, episodes]) => ({ season, episodes: episodes.sort((a, b) => a.episode - b.episode) })).sort((a, b) => a.season - b.season)
        })
      } catch (e) { return json({ show: null, seasons: [], error: String(e?.message || e) }) }
    }

    if (url.pathname === '/api/tv/find') {
      const title = (url.searchParams.get('title') || '').trim().slice(0, 100)
      const season = Number(url.searchParams.get('season') || 1)
      const episode = Number(url.searchParams.get('episode') || 1)
      const dub = url.searchParams.get('dub') !== '0'
      if (!title) return json({ results: [] })
      const s = String(season).padStart(2, '0')
      const e = String(episode).padStart(2, '0')
      const code = `S${s}E${e}`
      const terms = [`${title} ${code}`, `${title} ${code} dublado`, `${title} ${code} 1080p`, `${title} ${season}x${episode}`]
      try {
        const lists = await Promise.all(terms.map(t => apibay('/q.php?q=' + encodeURIComponent(t)).then(cleanBay).catch(() => [])))
        const seen = new Map()
        for (const arr of lists) for (const t of arr) if (!seen.has(t.hash)) seen.set(t.hash, t)
        const norm = v => String(v).toUpperCase().replace(/[^A-Z0-9]/g, '')
        const alt = new RegExp(`\\b${season}\\s*[xX]\\s*${episode}\\b`)
        let all = [...seen.values()].filter(t => norm(t.title).includes(code) || alt.test(t.title))
        if (!all.length) all = [...seen.values()]
        if (dub) { const pt = all.filter(t => matchesLang(t, 'pt')); if (pt.length) all = pt }
        return json({ results: bayRank(all).slice(0, 30) })
      } catch (e) { return json({ results: [], error: String(e?.message || e) }) }
    }

    if (url.pathname === '/api/live/meta') {
      try {
        const c = await ensureLive()
        return json({
          countries: [...new Set(c.byCountry.map(x => x.group).filter(Boolean))].sort(),
          categories: [...new Set(c.byCategory.map(x => x.group).filter(Boolean))].sort(),
          total: c.byCountry.length
        })
      } catch (e) { return json({ countries: [], categories: [], total: 0, error: String(e?.message || e) }) }
    }

    if (url.pathname === '/api/live') {
      const country = (url.searchParams.get('country') || '').trim()
      const category = (url.searchParams.get('category') || '').trim()
      const q = (url.searchParams.get('q') || '').trim().toLowerCase()
      const limit = Math.max(12, Math.min(120, Number(url.searchParams.get('limit') || 60)))
      try {
        const c = await ensureLive()
        let base
        if (country && category) {
          const urls = new Set(c.byCategory.filter(x => x.group === category).map(x => x.url))
          base = c.byCountry.filter(x => x.group === country && urls.has(x.url))
        } else if (country) base = c.byCountry.filter(x => x.group === country)
        else if (category) base = c.byCategory.filter(x => x.group === category)
        else base = c.byCountry
        if (q) base = base.filter(x => x.name.toLowerCase().includes(q) || x.group.toLowerCase().includes(q))
        const seen = new Set(); const uniq = []
        for (const x of base) { if (seen.has(x.url)) continue; seen.add(x.url); uniq.push(x) }
        return json({ total: uniq.length, page: 1, channels: uniq.slice(0, limit) })
      } catch (e) { return json({ channels: [], total: 0, error: String(e?.message || e) }) }
    }

    if (url.pathname === '/api/live/proxy') {
      const target = url.searchParams.get('url') || ''
      if (!/^https?:\/\//i.test(target)) return new Response('url invalida', { status: 400 })
      let up
      try { up = await fetch(target, { headers: { 'user-agent': UA }, redirect: 'follow' }) }
      catch (e) { return new Response('falha no stream: ' + (e?.message || e), { status: 502 }) }
      const ct = up.headers.get('content-type') || ''
      const isPlaylist = /mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(target)
      if (isPlaylist) {
        const text = await up.text()
        return new Response(rewritePlaylist(text, target), {
          headers: { 'content-type': 'application/vnd.apple.mpegurl; charset=utf-8', 'access-control-allow-origin': '*' }
        })
      }
      const headers = new Headers(up.headers)
      headers.set('access-control-allow-origin', '*')
      return new Response(up.body, { status: up.status, headers })
    }

    if (url.pathname === '/api/archive') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80)
      const collection = (url.searchParams.get('col') || '').trim().slice(0, 40)
      const limit = Math.max(6, Math.min(48, Number(url.searchParams.get('limit') || 24)))
      const parts = ['mediatype:movies']
      if (collection) parts.push(`collection:${collection}`)
      if (q) parts.push(`(${q})`)
      const params = new URLSearchParams()
      params.set('q', parts.join(' AND '))
      for (const f of ['identifier', 'title', 'year', 'description']) params.append('fl[]', f)
      params.set('sort[]', 'downloads desc')
      params.set('rows', String(limit))
      params.set('output', 'json')
      try {
        const data = await getJSON('https://archive.org/advancedsearch.php?' + params)
        const docs = data?.response?.docs || []
        return json({
          total: Number(data?.response?.numFound) || 0,
          results: docs.map(d => ({
            id: d.identifier,
            title: String(d.title || d.identifier || '').replace(/\s+/g, ' ').trim(),
            year: d.year || '',
            summary: String(d.description || '').replace(/\s+/g, ' ').slice(0, 400),
            poster: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
            source: 'Archive.org'
          })).filter(x => x.id)
        })
      } catch (e) { return json({ results: [], total: 0, error: String(e?.message || e) }, 502) }
    }

    const archiveMatch = /^\/api\/archive\/(.+)$/.exec(url.pathname)
    if (archiveMatch) {
      const id = decodeURIComponent(archiveMatch[1]).trim()
      if (!/^[\w.\-]{1,120}$/.test(id)) return json({ error: 'id invalido' }, 400)
      try {
        const md = await getJSON('https://archive.org/metadata/' + id)
        const files = md?.files || []
        const pick =
          files.find(f => /\.(mp4|m4v)$/i.test(f.name || '') && /h\.?264|mpeg4|512kb|mp4/i.test(f.format || '')) ||
          files.find(f => /\.(mp4|m4v)$/i.test(f.name || '')) ||
          files.find(f => /\.(ogv|webm)$/i.test(f.name || ''))
        if (!pick) return json({ error: 'sem arquivo reproduzivel' }, 404)
        return json({ url: `https://archive.org/download/${id}/${encodeURIComponent(pick.name)}`, size: Number(pick.size) || 0, format: pick.format || '' })
      } catch (e) { return json({ error: String(e?.message || e) }, 502) }
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Esta funcao ainda precisa de um servidor compativel com o Cinep2p completo.', route: url.pathname }, 501)
    }
    return env.ASSETS.fetch(request)
  }
}