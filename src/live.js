// Canais de TV ao vivo e publicos via iptv-org (playlists M3U, sem chave).

const COUNTRY_LIST = 'https://iptv-org.github.io/iptv/index.country.m3u'
const CATEGORY_LIST = 'https://iptv-org.github.io/iptv/index.category.m3u'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
const TTL = 12 * 60 * 60 * 1000

let cache = { at: 0, byCountry: [], byCategory: [] }

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
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.text()
  } finally { clearTimeout(to) }
}

export async function ensureLive() {
  if (cache.at && Date.now() - cache.at < TTL) return cache
  const [countries, categories] = await Promise.all([
    getText(COUNTRY_LIST).then(parseM3U).catch(() => []),
    getText(CATEGORY_LIST).then(parseM3U).catch(() => [])
  ])
  if (!countries.length && !categories.length && cache.at) return cache
  cache = { at: Date.now(), byCountry: countries, byCategory: categories }
  return cache
}

export async function liveMeta() {
  const c = await ensureLive()
  const countries = [...new Set(c.byCountry.map(x => x.group).filter(Boolean))].sort()
  const categories = [...new Set(c.byCategory.map(x => x.group).filter(Boolean))].sort()
  return { countries, categories, total: c.byCountry.length }
}

export async function liveChannels({ country = '', category = '', q = '', page = 1, limit = 60 } = {}) {
  const c = await ensureLive()
  let base
  if (country && category) {
    const urls = new Set(c.byCategory.filter(x => x.group === category).map(x => x.url))
    base = c.byCountry.filter(x => x.group === country && urls.has(x.url))
  } else if (country) {
    base = c.byCountry.filter(x => x.group === country)
  } else if (category) {
    base = c.byCategory.filter(x => x.group === category)
  } else {
    base = c.byCountry
  }
  const term = String(q || '').trim().toLowerCase()
  if (term) base = base.filter(x => x.name.toLowerCase().includes(term) || x.group.toLowerCase().includes(term))
  const seen = new Set()
  const uniq = []
  for (const x of base) { if (seen.has(x.url)) continue; seen.add(x.url); uniq.push(x) }
  const p = Math.max(1, page)
  return { total: uniq.length, page: p, channels: uniq.slice((p - 1) * limit, (p - 1) * limit + limit) }
}