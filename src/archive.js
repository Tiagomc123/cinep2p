// Filmes de dominio publico, documentarios e animacao classica (Internet Archive).

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

export const COLLECTIONS = {
  documentarios: 'documentary',
  filmes: 'feature_films',
  animacao: 'animationandcartoons',
  classico: 'classic_cartoons',
  noir: 'film_noir',
  ficcao: 'sci-fi_horror',
  silencioso: 'silent_films',
  prelinger: 'prelinger'
}

async function getJSON(url, ms = 20000) {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'application/json' } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally { clearTimeout(to) }
}

export async function archiveSearch({ q = '', collection = '', page = 1, limit = 24 } = {}) {
  const parts = ['mediatype:movies']
  if (collection) parts.push(`collection:${collection}`)
  const term = String(q || '').trim()
  if (term) parts.push(`(${term})`)
  const params = new URLSearchParams()
  params.set('q', parts.join(' AND '))
  for (const f of ['identifier', 'title', 'year', 'description', 'downloads']) params.append('fl[]', f)
  params.set('sort[]', 'downloads desc')
  params.set('rows', String(limit))
  params.set('page', String(Math.max(1, page)))
  params.set('output', 'json')
  const data = await getJSON(`https://archive.org/advancedsearch.php?${params}`)
  const docs = data?.response?.docs || []
  return {
    total: Number(data?.response?.numFound) || 0,
    results: docs.map(d => ({
      id: d.identifier,
      title: String(d.title || d.identifier || '').replace(/\s+/g, ' ').trim(),
      year: d.year || '',
      summary: String(d.description || '').replace(/\s+/g, ' ').slice(0, 400),
      poster: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
      source: 'Archive.org'
    })).filter(x => x.id)
  }
}

export async function archiveStream(identifier) {
  const id = String(identifier || '').trim()
  if (!/^[\w.\-]{1,120}$/.test(id)) return null
  const md = await getJSON(`https://archive.org/metadata/${id}`)
  const files = md?.files || []
  const pick =
    files.find(f => /\.(mp4|m4v)$/i.test(f.name || '') && /h\.?264|mpeg4|512kb|mp4/i.test(f.format || '')) ||
    files.find(f => /\.(mp4|m4v)$/i.test(f.name || '')) ||
    files.find(f => /\.(ogv|webm)$/i.test(f.name || ''))
  if (!pick) return null
  return {
    url: `https://archive.org/download/${id}/${encodeURIComponent(pick.name)}`,
    size: Number(pick.size) || 0,
    format: pick.format || ''
  }
}