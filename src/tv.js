// Series: metadados via TVMaze (sem chave) + busca de release no TPB.

import { searchApibay, rank } from './apibay.js'
import { matchesLang } from './lang.js'

const TVMAZE = 'https://api.tvmaze.com'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

async function getJSON(url, ms = 15000) {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'application/json' } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally { clearTimeout(to) }
}

const plain = (html, n) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)

export async function tvSearch(q) {
  const term = String(q || '').trim().slice(0, 80)
  if (!term) return { results: [] }
  const data = await getJSON(`${TVMAZE}/search/shows?q=${encodeURIComponent(term)}`)
  const results = (Array.isArray(data) ? data : [])
    .map(x => x?.show).filter(Boolean)
    .map(s => ({
      id: s.id,
      name: s.name,
      year: (s.premiered || '').slice(0, 4),
      poster: s.image?.medium || s.image?.original || '',
      summary: plain(s.summary, 400),
      genres: s.genres || [],
      status: s.status || ''
    }))
  return { results }
}

export async function tvShow(showId) {
  const id = Number(showId)
  if (!Number.isFinite(id)) return { show: null, seasons: [] }
  const [show, eps] = await Promise.all([
    getJSON(`${TVMAZE}/shows/${id}`).catch(() => null),
    getJSON(`${TVMAZE}/shows/${id}/episodes`).catch(() => [])
  ])
  const list = (Array.isArray(eps) ? eps : []).filter(e => Number(e.season) > 0 && Number(e.number) > 0)
  const bySeason = new Map()
  for (const e of list) {
    if (!bySeason.has(e.season)) bySeason.set(e.season, [])
    bySeason.get(e.season).push({
      season: e.season,
      episode: e.number,
      name: e.name || `Episodio ${e.number}`,
      airdate: e.airdate || '',
      summary: plain(e.summary, 300)
    })
  }
  return {
    show: show ? {
      id: show.id, name: show.name,
      poster: show.image?.medium || '', year: (show.premiered || '').slice(0, 4)
    } : null,
    seasons: [...bySeason.entries()]
      .map(([season, episodes]) => ({ season, episodes: episodes.sort((a, b) => a.episode - b.episode) }))
      .sort((a, b) => a.season - b.season)
  }
}

export async function tvFind({ title, season, episode, dub = true }) {
  const clean = String(title || '').replace(/[^\w\s'.-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean) return { results: [] }
  const s = String(season).padStart(2, '0')
  const e = String(episode).padStart(2, '0')
  const code = `S${s}E${e}`

  const queries = [
    `${clean} ${code}`,
    `${clean} ${code} dublado`,
    `${clean} ${code} 1080p`,
    `${clean} ${season}x${e}`
  ]
  const lists = await Promise.all(queries.map(q => searchApibay(q).catch(() => [])))

  const seen = new Map()
  for (const arr of lists) for (const t of arr) if (!seen.has(t.hash)) seen.set(t.hash, t)

  const norm = v => String(v).toUpperCase().replace(/[^A-Z0-9]/g, '')
  const alt = new RegExp(`\\b${season}\\s*[xX]\\s*${e}\\b`)

  let all = [...seen.values()].filter(t => norm(t.title).includes(code) || alt.test(t.title))
  if (!all.length) all = [...seen.values()]

  if (dub) {
    const pt = all.filter(t => matchesLang(t, 'pt'))
    if (pt.length) all = pt
  }
  return { results: rank(all).slice(0, 30) }
}