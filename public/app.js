const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]

const GENRES = [
  ['', 'Tudo'], ['action', 'Acao'], ['comedy', 'Comedia'], ['horror', 'Terror'],
  ['sci-fi', 'Ficcao'], ['animation', 'Animacao'], ['thriller', 'Suspense'],
  ['crime', 'Crime'], ['romance', 'Romance'], ['adventure', 'Aventura'], ['family', 'Familia']
]
const ROWS = [
  { t: 'Em Alta', p: { sort: 'download_count', order: 'desc' } },
  { t: 'Lancamentos', p: { sort: 'year', order: 'desc' } },
  { t: 'Melhores Notas', p: { sort: 'rating', order: 'desc' } },
  { t: 'Acao', p: { genre: 'action', sort: 'download_count', order: 'desc' } },
  { t: 'Terror', p: { genre: 'horror', sort: 'download_count', order: 'desc' } },
  { t: 'Comedia', p: { genre: 'comedy', sort: 'download_count', order: 'desc' } }
]
const BR_SHELVES = [
  { title: 'Em Alta (Dublado)', q: 'dublado 1080p', lang: 'dub' },
  { title: 'Lancamentos Dublados', q: 'dublado web-dl', lang: 'dub' },
  { title: 'Nacional / Brasileiro', q: 'nacional 1080p', lang: 'ptbr' },
  { title: 'Dual Audio (PT + Original)', q: 'dual audio 1080p', lang: 'dual' },
  { title: 'Legendado', q: 'legendado 1080p', lang: 'subs' },
  { title: 'Animacao Dublada', q: 'animacao dublado', lang: 'dub' }
]
const SERIES_SHELVES = [
  { title: 'Series Dubladas', q: 'serie dublada 1080p', lang: 'dub' },
  { title: 'Series Legendadas', q: 'serie legendada 1080p', lang: 'subs' },
  { title: 'Series Nacionais', q: 'serie nacional', lang: 'ptbr' },
  { title: 'Top Series HD', cat: '208', lang: 'all' }
]
const DOC_SHELVES = [
  { title: 'Documentarios (dominio publico)', col: 'documentary' },
  { title: 'Filmes classicos', col: 'feature_films' },
  { title: 'Animacao classica', col: 'classic_cartoons' },
  { title: 'Film noir', col: 'film_noir' },
  { title: 'Ficcao cientifica', col: 'sci-fi_horror' },
  { title: 'Prelinger', col: 'prelinger' }
]
const BR_GENRE = {
  action: 'acao', comedy: 'comedia', horror: 'terror', 'sci-fi': 'ficcao',
  animation: 'animacao', thriller: 'suspense', crime: 'crime',
  romance: 'romance', adventure: 'aventura', family: 'familia'
}
const MODE_LABEL = { direct: 'Direto', remux: 'Compativel', transcode: 'Leve' }
const CHAIN = ['direct', 'remux', 'transcode']
const MODE_EL = { br: '#modeBr', world: '#modeWorld', series: '#modeSeries', docs: '#modeDocs' }

const video = $('#video')
const rowsEl = $('#rows')
let activeGenre = ''
let catalogMode = localStorage.getItem('cinep2p.catalogMode') || 'br'
let onlyDub = localStorage.getItem('cinep2p.dub') === '1'
let health = { ffmpeg: false }
const state = { progressByHash: {}, progressByKey: {} }
const LOCAL_PROGRESS_KEY = 'cinep2p.progress.v1'

function readLocalProgress() {
  try { return JSON.parse(localStorage.getItem(LOCAL_PROGRESS_KEY) || '{}') || {} }
  catch { return {} }
}
function saveLocalProgress(item) {
  try {
    const all = readLocalProgress()
    all[item.key] = { ...item, ts: Date.now() }
    const kept = Object.entries(all).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0)).slice(0, 100)
    localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {}
}

async function clearWatchHistory() {
  if (!confirm('Apagar todo o historico de reproducao? Essa acao nao pode ser desfeita.')) return
  clearInterval(saveTimer)
  saveTimer = null
  state.key = null
  try {
    await api('/api/progress', { method: 'DELETE' })
    localStorage.removeItem(LOCAL_PROGRESS_KEY)
    state.progressByHash = {}
    state.progressByKey = {}
    await refreshContinue()
    alert('Historico apagado.')
  } catch {
    localStorage.removeItem(LOCAL_PROGRESS_KEY)
    state.progressByHash = {}
    state.progressByKey = {}
    alert('O historico local foi apagado, mas nao foi possivel apagar o historico do servidor. Verifique a conexao e tente novamente.')
  }
}

const fmtTime = s => {
  s = Math.max(0, Math.floor(s || 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + ':' + String(x).padStart(2, '0')
}
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

async function api(url, opts) {
  const r = await fetch(url, opts)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

/* ---------- camadas / botao voltar ---------- */
const layers = []
history.replaceState({ layer: false }, '')
function pushLayer(close) { layers.push(close); history.pushState({ layer: true }, '') }
function closeTop() { if (layers.length) history.back() }
window.addEventListener('popstate', () => { const fn = layers.pop(); if (fn) fn() })

/* ---------- foco (controle remoto) ---------- */
function focusables() {
  return $$('button, input, [tabindex="0"]').filter(el => el.offsetParent !== null && !el.disabled)
}
function moveFocus(dir) {
  const items = focusables()
  if (!items.length) return
  const cur = document.activeElement
  if (!cur || !items.includes(cur)) return items[0].focus()
  const r = cur.getBoundingClientRect()
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  let best = null, bestScore = Infinity
  for (const el of items) {
    if (el === cur) continue
    const b = el.getBoundingClientRect()
    const dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy
    const ok = dir === 'left' ? dx < -6 : dir === 'right' ? dx > 6 : dir === 'up' ? dy < -6 : dy > 6
    if (!ok) continue
    const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy)
    const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    const sc = primary + secondary * 2
    if (sc < bestScore) { bestScore = sc; best = el }
  }
  if (best) best.focus()
}

document.addEventListener('keydown', e => {
  const k = e.key
  const a = document.activeElement
  const tag = a?.tagName || ''
  const typing = tag === 'INPUT' && a.type !== 'range'

  if (k === 'Escape') {
    e.preventDefault()
    if (!$('#pmenu').classList.contains('hidden')) return $('#pmenu').classList.add('hidden')
    closeTop()
    return
  }
  if (k === 'Backspace' && !typing) { e.preventDefault(); closeTop(); return }

  if (!typing && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) {
    if (a === video) return
    if (a && a.type === 'range' && (k === 'ArrowLeft' || k === 'ArrowRight')) return
    e.preventDefault()
    moveFocus(k.replace('Arrow', '').toLowerCase())
    return
  }

  if (!typing && (k === 'Enter' || k === ' ' || k === 'MediaPlayPause') && a === video) {
    e.preventDefault()
    if (k === ' ') return video.paused ? video.play() : video.pause()
    showTop(true); (focusables()[0] || video).focus()
  }
  if (!typing && (k === 'm' || k === 'M' || k === 'ContextMenu') && state.open) { e.preventDefault(); openMenu('audio') }
})

/* ---------- toast ---------- */
let toastTimer
function toast(msg, actions = [], ms = 6000) {
  const el = $('#toast')
  el.innerHTML = ''
  const span = document.createElement('span')
  span.textContent = msg
  el.appendChild(span)
  for (const [label, fn] of actions) {
    const b = document.createElement('button')
    b.textContent = label
    b.onclick = () => { hide(); fn() }
    el.appendChild(b)
  }
  el.classList.remove('hidden')
  clearTimeout(toastTimer)
  if (ms) toastTimer = setTimeout(hide, ms)
  function hide() { el.classList.add('hidden') }
}

/* ---------- capas ---------- */
const posterCache = new Map()
function placeholder(title) {
  const t = esc(String(title || 'Filme').slice(0, 32))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#30204f"/><stop offset="1" stop-color="#101018"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/><circle cx="150" cy="150" r="52" fill="none" stroke="#8b5cf6" stroke-width="3"/><path d="M135 119 L180 150 L135 181 Z" fill="#c4b5fd"/><text x="150" y="270" fill="#fff" font-family="Arial" font-size="17" font-weight="700" text-anchor="middle">${t}</text></svg>`
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
}
function lookupPoster(title, imdb) {
  const key = (imdb || title || '').toLowerCase()
  if (!key) return Promise.resolve(null)
  if (!posterCache.has(key)) {
    posterCache.set(key, api(`/api/poster?title=${encodeURIComponent(title || '')}&imdb=${encodeURIComponent(imdb || '')}`).catch(() => null))
  }
  return posterCache.get(key)
}

/* ---------- limpeza de nome de release ---------- */
const JUNK = /\b(2160p|1080p|720p|480p|4k|uhd|bluray|blu-?ray|web-?dl|webrip|hdrip|brrip|dvdrip|remux|hdr|dv|x264|x265|h\.?264|h\.?265|hevc|av1|aac|ac3|ddp?5[ .]?1|dts(-hd)?|truehd|atmos|yify|galaxyrg|yts|dublado|dublada|dublagem|dual|multi|legendado|legendas?|nacional|brasileir[oa]|repackage?d?|proper|extended|imax|10bit|8bit|hq|bone|psa|oft|turg|rarbg)\b/gi
function prettyTitle(name) {
  return String(name || '')
    .replace(/\.(mp4|mkv|avi|mov|webm|m4v|ts)$/i, '')
    .replace(/[._]/g, ' ')
    .replace(JUNK, ' ')
    .replace(/\s*-\s*[a-z0-9]+$/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
const yearOf = name => (/\b(19\d{2}|20\d{2})\b/.exec(String(name || '')) || [])[1] || ''

/* ---------- cartoes ---------- */
function progressFor(movie) {
  if (movie.progressKey) return state.progressByKey[movie.progressKey]
  if (movie.tvKey) return state.progressByKey[movie.tvKey]
  const hashes = [...(movie.torrents || []).map(t => t.hash), movie.hash].filter(Boolean)
  for (const h of hashes) if (state.progressByHash[h]) return state.progressByHash[h]
  return null
}

function card(movie, opts = {}) {
  const d = document.createElement('div')
  d.className = 'card focusable'
  d.tabIndex = 0
  const img = document.createElement('img')
  img.loading = 'lazy'
  img.alt = movie.title || 'filme'
  const fallback = placeholder(movie.title)
  if (movie.poster) {
    img.src = movie.poster
    img.onerror = async () => {
      img.onerror = null
      const j = await lookupPoster(movie.title, movie.imdb)
      img.src = j?.poster || fallback
    }
  } else {
    img.src = fallback
    lookupPoster(movie.title, movie.imdb).then(j => { if (j?.poster) img.src = j.poster })
  }
  const t = document.createElement('div'); t.className = 't'; t.textContent = movie.title || 'Sem titulo'
  const m = document.createElement('div'); m.className = 'm'
  const languageLabels = []
  if (movie.dub) languageLabels.push('Dublado')
  else if (movie.dual) languageLabels.push('Dual audio')
  else if ((movie.langs || []).includes('ptbr')) languageLabels.push('Portugues')
  if (movie.subs) languageLabels.push('Legendado')
  m.textContent = [movie.year || '', movie.rating ? 'Nota ' + movie.rating : '', ...languageLabels].filter(Boolean).join(' | ')
  d.append(img, t, m)
  const p = progressFor(movie)
  if (p && p.d) {
    const bar = document.createElement('div'); bar.className = 'bar'
    const i = document.createElement('i'); i.style.width = Math.min(100, (p.t / p.d) * 100) + '%'
    bar.appendChild(i); d.appendChild(bar)
    const label = document.createElement('div'); label.className = 'progress-label'
    label.textContent = (p.t >= p.d * 0.92 || p.d - p.t <= 90) ? 'Assistido' : 'Parou em ' + fmtTime(p.t)
    d.appendChild(label)
  }
  d.onclick = () => opts.direct ? openPlayer(movie.source, movie, movie.file) : openDetail(movie)
  d.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); d.click() } }
  return d
}

function asTorrentMovie(x) {
  return {
    title: prettyTitle(x.title), rawTitle: x.title, year: x.year || yearOf(x.title), poster: '',
    imdb: x.imdb || '', dub: x.dub, dual: x.dual, subs: x.subs, langs: x.langs || [],
    torrents: [x], genres: [], summary: `TPB | ${x.seeds || 0} seeds | ${x.size || '?'}`
  }
}

function archiveCard(item) {
  const d = document.createElement('div')
  d.className = 'card focusable'
  d.tabIndex = 0
  const img = document.createElement('img')
  img.loading = 'lazy'
  img.alt = item.title
  img.src = item.poster
  img.onerror = () => { img.onerror = null; img.src = placeholder(item.title) }
  const t = document.createElement('div'); t.className = 't'; t.textContent = item.title
  const m = document.createElement('div'); m.className = 'm'
  m.textContent = [item.year, 'Archive.org'].filter(Boolean).join(' | ')
  d.append(img, t, m)
  d.onclick = () => openArchive(item)
  d.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); d.click() } }
  return d
}

function showCard(s) {
  const d = document.createElement('div')
  d.className = 'card focusable'
  d.tabIndex = 0
  const img = document.createElement('img')
  img.loading = 'lazy'
  img.alt = s.name
  img.src = s.poster || placeholder(s.name)
  img.onerror = () => { img.onerror = null; img.src = placeholder(s.name) }
  const t = document.createElement('div'); t.className = 't'; t.textContent = s.name
  const m = document.createElement('div'); m.className = 'm'
  m.textContent = [s.year, (s.genres || [])[0], s.status].filter(Boolean).join(' | ')
  d.append(img, t, m)
  d.onclick = () => openShow(s)
  d.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); d.click() } }
  return d
}

function strip(title, movies) {
  const row = document.createElement('div')
  row.className = 'row'
  const h = document.createElement('h2'); h.textContent = title
  const s = document.createElement('div'); s.className = 'strip'
  movies.forEach(m => s.appendChild(card(m)))
  row.append(h, s)
  return row
}

function stripNodes(title, nodes) {
  const row = document.createElement('div')
  row.className = 'row'
  const h = document.createElement('h2'); h.textContent = title
  const s = document.createElement('div'); s.className = 'strip'
  nodes.forEach(n => s.appendChild(n))
  row.append(h, s)
  return row
}

/* ---------- catalogos ---------- */
function renderBlocks(blocks, emptyMsg) {
  rowsEl.innerHTML = ''
  const frag = document.createDocumentFragment()
  for (const b of blocks) if (b.movies?.length) frag.appendChild(strip(b.shelf.title, b.movies))
  rowsEl.appendChild(frag)
  if (!rowsEl.children.length) rowsEl.innerHTML = `<div class="loading">${esc(emptyMsg)}</div>`
}

async function tpbShelfBlocks(shelves, extraTerm = '') {
  return Promise.all(shelves.map(async shelf => {
    try {
      const p = new URLSearchParams({ limit: '18' })
      const termo = [shelf.q, extraTerm].filter(Boolean).join(' ').trim()
      if (termo) p.set('q', termo)
      if (shelf.cat) p.set('cat', shelf.cat)
      p.set('lang', onlyDub ? 'dub' : shelf.lang)
      const j = await api('/api/br?' + p)
      return { shelf, movies: (j.results || []).map(asTorrentMovie) }
    } catch { return { shelf, movies: [] } }
  }))
}

async function loadBrazilCatalog() {
  const genre = activeGenre ? (BR_GENRE[activeGenre] || '') : ''
  renderBlocks(await tpbShelfBlocks(BR_SHELVES, genre), 'Nada encontrado. Use a busca ou troque de modo.')
}

async function loadSeriesCatalog() {
  const genre = activeGenre ? (BR_GENRE[activeGenre] || '') : ''
  renderBlocks(await tpbShelfBlocks(SERIES_SHELVES, genre), 'Nada encontrado em series. Use a busca para achar uma serie.')
}

async function loadWorldCatalog() {
  const frag = document.createDocumentFragment()
  for (const r of ROWS) {
    try {
      const p = { ...r.p, ...(activeGenre ? { genre: activeGenre } : {}) }
      const j = await api('/api/catalog?' + new URLSearchParams(p))
      if (j.movies?.length) frag.appendChild(strip(r.t, j.movies))
    } catch {}
  }
  rowsEl.innerHTML = ''
  rowsEl.appendChild(frag)
  if (!rowsEl.children.length) rowsEl.innerHTML = '<div class="loading">Nao foi possivel carregar o catalogo Mundo.</div>'
}

async function loadDocsCatalog() {
  const blocks = await Promise.all(DOC_SHELVES.map(async shelf => {
    try {
      const j = await api(`/api/archive?col=${encodeURIComponent(shelf.col)}&limit=18`)
      return { shelf, nodes: (j.results || []).map(archiveCard) }
    } catch { return { shelf, nodes: [] } }
  }))
  rowsEl.innerHTML = ''
  const frag = document.createDocumentFragment()
  for (const b of blocks) if (b.nodes?.length) frag.appendChild(stripNodes(b.shelf.title, b.nodes))
  rowsEl.appendChild(frag)
  if (!rowsEl.children.length) rowsEl.innerHTML = '<div class="loading">Nada encontrado no Archive.org.</div>'
}

async function loadCatalog() {
  rowsEl.innerHTML = '<div class="loading">Carregando catalogo...</div>'
  if (catalogMode === 'br') return loadBrazilCatalog()
  if (catalogMode === 'series') return loadSeriesCatalog()
  if (catalogMode === 'docs') return loadDocsCatalog()
  return loadWorldCatalog()
}

async function refreshContinue() {
  let remote = []
  try { remote = (await api('/api/progress')).items || [] } catch {}
  const local = Object.values(readLocalProgress())
  const merged = new Map()
  for (const item of [...remote, ...local]) {
    if (!item?.key || !item.hash) continue
    const prev = merged.get(item.key)
    if (!prev || Number(item.ts || 0) >= Number(prev.ts || 0)) merged.set(item.key, item)
  }
  const items = [...merged.values()]
    .filter(i => i.d && i.t > 3)
    .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
    .slice(0, 100)
  state.progressByHash = Object.fromEntries(items.map(i => [i.hash, i]))
  state.progressByKey = Object.fromEntries(items.map(i => [i.key, i]))
  renderHistory(items)
}

function renderHistory(items = []) {
  const list = $('#historyList')
  if (!list) return
  const filter = $('#historyFilter')?.value || 'all'
  const filtered = items.filter(i => {
    const isSeries = String(i.key || '').startsWith('tv:')
    return filter === 'all' || (filter === 'series' && isSeries) || (filter === 'movies' && !isSeries)
  })
  list.innerHTML = ''
  if (!filtered.length) {
    list.innerHTML = '<div class="loading">Seu histórico aparecerá aqui depois que você assistir.</div>'
    return
  }
  const grid = document.createElement('div')
  grid.className = 'history-grid'
  for (const i of filtered) {
    const isSeries = String(i.key || '').startsWith('tv:')
    const movie = {
      title: i.title || i.name || 'Sem título', year: i.year, poster: i.poster,
      hash: i.hash, progressKey: i.key, historyType: isSeries ? 'Série / episódio' : 'Filme',
      source: { hash: i.hash, title: i.title, source: 'retomar', quality: '' }, file: i.file
    }
    const c = card(movie, { direct: true })
    const type = document.createElement('span')
    type.className = 'history-type'
    type.textContent = movie.historyType
    c.appendChild(type)
    grid.appendChild(c)
  }
  list.appendChild(grid)
}

$('#historyBtn').onclick = () => {
  renderHistory([...new Map([...Object.values(readLocalProgress()), ...Object.values(state.progressByKey)].map(i => [i.key, i])).values()])
  $('#historyModal').classList.remove('hidden')
  pushLayer(() => $('#historyModal').classList.add('hidden'))
}
$('#closeHistory').onclick = () => closeTop()
$('#clearHistoryBtn').onclick = clearWatchHistory
$('#historyFilter').onchange = () => {
  renderHistory([...new Map([...Object.values(readLocalProgress()), ...Object.values(state.progressByKey)].map(i => [i.key, i])).values()])
}

function renderGenres() {
  const nav = $('#genres')
  nav.innerHTML = ''
  GENRES.forEach(([id, label]) => {
    const b = document.createElement('button')
    b.className = 'chip focusable' + (id === activeGenre ? ' on' : '')
    b.textContent = label
    b.onclick = () => { activeGenre = id; renderGenres(); loadCatalog() }
    nav.appendChild(b)
  })
}

/* ---------- busca ---------- */
let debounce
$('#q').oninput = e => {
  clearTimeout(debounce)
  const q = e.target.value.trim()
  debounce = setTimeout(() => { if (!q) loadCatalog(); else runSearch(q) }, 500)
}
$('#q').onkeydown = e => {
  if (e.key === 'Enter') {
    e.preventDefault(); e.target.blur()
    if (e.target.value.trim()) runSearch(e.target.value.trim())
  }
}

function syncCatalogMode() {
  for (const [k, sel] of Object.entries(MODE_EL)) $(sel).classList.toggle('on', catalogMode === k)
}
for (const [k, sel] of Object.entries(MODE_EL)) {
  $(sel).onclick = () => {
    catalogMode = k
    localStorage.setItem('cinep2p.catalogMode', k)
    syncCatalogMode()
    const q = $('#q').value.trim()
    if (q) runSearch(q); else loadCatalog()
  }
}
$('#liveBtn').onclick = () => { location.href = '/live.html' }
syncCatalogMode()

$('#dubChip').classList.toggle('on', onlyDub)
$('#dubChip').onclick = () => {
  onlyDub = !onlyDub
  localStorage.setItem('cinep2p.dub', onlyDub ? '1' : '0')
  $('#dubChip').classList.toggle('on', onlyDub)
  const q = $('#q').value.trim()
  if (q) runSearch(q); else loadCatalog()
}

/* ---------- espaco em disco ---------- */
async function refreshStorage() {
  try {
    const j = await api('/api/storage')
    $('#spaceBtn').textContent = 'Cache: ' + (j.bytes / 1e6).toFixed(0) + ' MB'
  } catch {}
}
$('#spaceBtn').onclick = async () => {
  if (!confirm('Apagar os arquivos temporarios agora? O progresso e mantido.')) return
  try {
    const j = await api('/api/cleanup', { method: 'POST' })
    toast('Espaco liberado: ' + (j.freed / 1e6).toFixed(0) + ' MB')
    refreshStorage()
  } catch (e) { toast('Falha: ' + e.message) }
}
function releaseTorrent(hash) {
  if (!hash) return
  fetch('/api/stop/' + hash, { method: 'POST', keepalive: true }).catch(() => {})
}

async function runSearch(q) {
  if (catalogMode === 'series') return searchShows(q)
  rowsEl.innerHTML = '<div class="loading">Buscando...</div>'
  try {
    const j = await api(`/api/search?q=${encodeURIComponent(q)}${onlyDub ? '&dub=1' : ''}`)
    rowsEl.innerHTML = ''
    const g = document.createElement('div'); g.className = 'grid'
    const extras = j.extra || []
    const portuguese = extras.filter(x => x.dub || (x.langs || []).includes('ptbr'))
    const others = extras.filter(x => !x.dub && !(x.langs || []).includes('ptbr'))
    portuguese.forEach(x => g.appendChild(card(asTorrentMovie(x))))
    if (!onlyDub) (j.results || []).forEach(m => g.appendChild(card(m)))
    if (!onlyDub) others.forEach(x => g.appendChild(card(asTorrentMovie(x))))
    rowsEl.appendChild(g)
    if (!g.children.length) rowsEl.innerHTML = '<div class="loading">Nada encontrado.</div>'
  } catch (e) {
    rowsEl.innerHTML = `<div class="loading">Erro: ${esc(e.message)}</div>`
  }
}

async function searchShows(q) {
  rowsEl.innerHTML = '<div class="loading">Buscando series...</div>'
  try {
    const j = await api('/api/tv/search?q=' + encodeURIComponent(q))
    rowsEl.innerHTML = ''
    if (!j.results?.length) { rowsEl.innerHTML = '<div class="loading">Nenhuma serie encontrada.</div>'; return }
    const g = document.createElement('div'); g.className = 'grid'
    j.results.forEach(s => g.appendChild(showCard(s)))
    rowsEl.appendChild(g)
  } catch (e) {
    rowsEl.innerHTML = `<div class="loading">Erro: ${esc(e.message)}</div>`
  }
}

/* ---------- serie: temporadas e episodios ---------- */
async function openShow(show) {
  $('#detail').innerHTML = `
    <div class="hero" style="background-image:url('${esc(show.poster)}')"></div>
    <div class="dbody">
      <h1></h1><div class="dmeta"></div><div class="dsum"></div>
      <div class="seasonbar" id="seasonBar"></div>
      <div id="epList"></div>
    </div>`
  $('#detail h1').textContent = show.name + (show.year ? ` (${show.year})` : '')
  $('#detail .dmeta').textContent = [(show.genres || []).join(' | '), show.status].filter(Boolean).join(' | ')
  $('#detail .dsum').textContent = show.summary || ''
  $('#modal').classList.remove('hidden')
  pushLayer(() => $('#modal').classList.add('hidden'))

  const epList = $('#epList')
  epList.innerHTML = '<div class="dsum">Carregando episodios...</div>'

  let data
  try { data = await api('/api/tv/show/' + show.id) }
  catch (e) { epList.innerHTML = `<div class="dsum">Erro: ${esc(e.message)}</div>`; return }
  if (!data.seasons?.length) { epList.innerHTML = '<div class="dsum">Sem episodios cadastrados.</div>'; return }

  let current = data.seasons[0].season
  const bar = $('#seasonBar')

  const renderEps = () => {
    const season = data.seasons.find(s => s.season === current)
    epList.innerHTML = ''
    for (const ep of season.episodes) {
      const key = `tv:${show.id}:${ep.season}x${ep.episode}`
      const prog = state.progressByKey[key]
      const d = document.createElement('div')
      d.className = 'ep focusable'
      d.tabIndex = 0
      const status = prog && prog.d
        ? (prog.t >= prog.d * 0.92 ? 'assistido' : 'parou em ' + fmtTime(prog.t))
        : (ep.airdate || '')
      d.innerHTML = `<span class="n">${ep.episode}</span>
        <span class="info"><b>${esc(ep.name)}</b><i>${esc(status)}</i></span>
        <button class="play">Fontes</button>`
      d.onclick = () => findEpisode(show, ep)
      d.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); d.click() } }
      epList.appendChild(d)
    }
  }

  const paintSeasons = () => {
    bar.innerHTML = ''
    data.seasons.forEach(s => {
      const b = document.createElement('button')
      b.className = 'chip focusable' + (s.season === current ? ' on' : '')
      b.textContent = 'T' + s.season
      b.onclick = () => { current = s.season; paintSeasons(); renderEps() }
      bar.appendChild(b)
    })
  }

  paintSeasons()
  renderEps()
}

async function findEpisode(show, ep) {
  const epList = $('#epList')
  epList.innerHTML = '<div class="dsum">Buscando fontes...</div>'
  try {
    const p = new URLSearchParams({ title: show.name, season: ep.season, episode: ep.episode })
    if (onlyDub) p.set('dub', '1')
    const j = await api('/api/tv/find?' + p)
    const results = j.results || []
    epList.innerHTML = ''
    const back = document.createElement('button')
    back.className = 'alt focusable backbar'
    back.textContent = 'Voltar para episodios'
    back.onclick = () => openShow(show)
    epList.appendChild(back)
    const head = document.createElement('div')
    head.className = 'dsum'
    head.textContent = `${show.name} T${ep.season}E${ep.episode} - ${ep.name} (${results.length} fontes)`
    epList.appendChild(head)
    if (!results.length) {
      const none = document.createElement('div')
      none.className = 'dsum'
      none.textContent = 'Nenhuma fonte encontrada para este episodio. Tente sem o filtro Dublado.'
      epList.appendChild(none)
      return
    }
    for (const x of results) {
      const movie = {
        title: `${show.name} T${ep.season}E${ep.episode}`,
        rawTitle: x.title,
        year: show.year,
        poster: show.poster,
        tvKey: `tv:${show.id}:${ep.season}x${ep.episode}`,
        torrents: [x],
        genres: [],
        dub: x.dub, dual: x.dual, subs: x.subs, langs: x.langs || []
      }
      epList.appendChild(srcRow(x, movie))
    }
  } catch (e) {
    epList.innerHTML = `<div class="dsum">Erro: ${esc(e.message)}</div>`
  }
}

/* ---------- detalhe (filme) ---------- */
function langTags(x) {
  const tags = []
  if (x.dub) tags.push('<span class="tag dub">Dublado</span>')
  else if (x.dual) tags.push('<span class="tag dub">Dual audio</span>')
  if (x.subs) tags.push('<span class="tag">Legendado</span>')
  if ((x.langs || []).includes('ptbr')) tags.push('<span class="tag pt">PT-BR</span>')
  if (x.codec === 'x265') tags.push('<span class="tag warn">x265</span>')
  if (x.codec === 'XviD') tags.push('<span class="tag warn">XviD</span>')
  return tags.join('')
}

function srcRow(x, movie) {
  const d = document.createElement('div')
  d.className = 'src'
  d.innerHTML = `<span class="q">${esc(x.quality || 'SD')}</span>
    <span class="tag">${esc(x.codec || 'n/d')}</span>
    <span class="tag">${esc(x.source || 'Fonte')}</span>
    ${langTags(x)}
    <span class="s">${x.seeds || 0} seeds | ${esc(x.size || '?')}</span>`
  const b = document.createElement('button')
  b.className = 'play focusable'
  b.textContent = 'Assistir'
  b.onclick = () => openPlayer(x, movie)
  d.appendChild(b)
  return d
}

function sourceLanguage(x, movie) {
  const name = String(x.title || '').toLowerCase()
  if (x.dub || /dublado|dublada|dublagem|\bpt[- .]?br\b|\bptbr\b/.test(name)) return 'pt'
  if (x.dual || /dual audio|multi audio|multi-audio/.test(name)) return 'dual'
  if ((x.langs || []).includes('ptbr') || /portugu[eê]s|\bnacional\b/.test(name)) return 'pt'
  if (/legendado|subbed|\bsubs?\b/.test(name) || x.subs) return 'sub'
  if (String(movie.language || '').toLowerCase() === 'en' || /\b(english|eng)\b/.test(name)) return 'en'
  return 'unknown'
}
function sourceQuality(x) {
  const q = String(x.quality || x.resolution || '').toLowerCase()
  if (/2160|4k/.test(q)) return '2160p'
  if (/1080/.test(q)) return '1080p'
  if (/720/.test(q)) return '720p'
  if (/480/.test(q)) return '480p'
  return q ? q.toUpperCase() : 'SD / não informado'
}
function sourceScore(x, movie) {
  const lang = sourceLanguage(x, movie)
  const q = sourceQuality(x)
  return (Number(x.seeds) || 0) * 10 +
    (q === '2160p' ? 450 : q === '1080p' ? 350 : q === '720p' ? 200 : q === '480p' ? 80 : 0) +
    (lang === 'pt' ? 180 : lang === 'dual' ? 150 : 0)
}
async function openDetail(movie) {
  let sources = [...(movie.torrents || [])].filter(x => x.hash && x.seeds > 0)
  const unique = new Map()
  sources.forEach(x => unique.set(x.hash, x))
  sources = [...unique.values()]
  let selectedLang = 'best'
  let selectedQuality = 'best'
  $('#detail').innerHTML = `
    <div class="hero" style="background-image:url('${esc(movie.background || movie.poster || '')}')"></div>
    <div class="dbody chooser-body">
      <h1></h1><div class="dmeta"></div><div class="dsum"></div>
      <div class="watch-panel">
        <div class="sec">Idioma</div>
        <div id="languageChoices" class="choice-row"></div>
        <div class="sec">Qualidade</div>
        <div id="qualityChoices" class="choice-row"></div>
        <div id="sourceHint" class="source-hint"></div>
        <button class="play main-play" id="watchNow">▶ Assistir agora</button>
        <button class="alt focusable" id="moreSources">Procurar outras opções</button>
        <div class="dsum" id="sourceStatus"></div>
      </div>
    </div>`
  $('#detail h1').textContent = `${movie.title || ''} ${movie.year ? '(' + movie.year + ')' : ''}`
  $('#detail .dmeta').textContent = [(movie.genres || []).join(' | '), movie.rating ? 'Nota ' + movie.rating : '', movie.runtime ? movie.runtime + ' min' : ''].filter(Boolean).join(' | ')
  $('#detail .dsum').textContent = movie.summary || ''

  const languageName = k => ({best:'Melhor opção',pt:'Português / dublado',dual:'Dual áudio',en:'Inglês / original',sub:'Legendado',unknown:'Idioma não confirmado'}[k] || k)
  const langOrder = ['best','pt','dual','en','sub','unknown']
  const qualityOrder = ['best','2160p','1080p','720p','480p','SD / não informado']
  const buildButtons = (container, values, current, setter) => {
    container.innerHTML = ''
    values.forEach(value => {
      const b = document.createElement('button')
      b.className = 'alt focusable' + (value === current ? ' on' : '')
      b.textContent = value === 'best' ? (container.id === 'languageChoices' ? 'Melhor idioma' : 'Melhor qualidade') : value
      b.onclick = () => { setter(value); buildButtons(container, values, value, setter); updateHint() }
      container.appendChild(b)
    })
  }
  const availableLangs = () => [...new Set(sources.map(x => sourceLanguage(x, movie)))]
  const availableQualities = () => [...new Set(sources.map(sourceQuality))]
  const candidates = () => sources.filter(x => {
    const lang = sourceLanguage(x, movie), quality = sourceQuality(x)
    return (selectedLang === 'best' || lang === selectedLang) && (selectedQuality === 'best' || quality === selectedQuality)
  }).sort((a,b) => sourceScore(b,movie)-sourceScore(a,movie))
  const updateHint = () => {
    const best = candidates()[0]
    const hint = $('#sourceHint')
    if (!best) { hint.textContent = 'Não encontrei uma fonte que combine com essas escolhas.'; $('#watchNow').disabled = true; return }
    $('#watchNow').disabled = false
    hint.textContent = `Fonte selecionada automaticamente: ${sourceQuality(best)} · ${languageName(sourceLanguage(best,movie))} · ${best.seeds || 0} seeds · ${best.size || 'tamanho não informado'}`
  }
  const languages = ['best', ...langOrder.slice(1).filter(x => availableLangs().includes(x))]
  const qualities = ['best', ...qualityOrder.slice(1).filter(x => availableQualities().includes(x))]
  buildButtons($('#languageChoices'), languages, selectedLang, v => { selectedLang = v })
  buildButtons($('#qualityChoices'), qualities, selectedQuality, v => { selectedQuality = v })
  updateHint()
  $('#watchNow').onclick = () => {
    const chosen = candidates()[0]
    if (!chosen) return toast('Não há fonte disponível com essas opções.')
    $('#modal').classList.add('hidden')
    openPlayer(chosen, movie)
  }
  $('#moreSources').onclick = async e => {
    e.currentTarget.disabled = true
    e.currentTarget.textContent = 'Procurando...'
    try {
      const target = movie.rawTitle || movie.title
      const j = await api(`/api/extra?title=${encodeURIComponent(target)}&year=${movie.year || ''}`)
      for (const x of (j.results || [])) if (x.hash && x.seeds > 0 && !sources.some(s => s.hash === x.hash)) sources.push(x)
      const ls = ['best', ...langOrder.slice(1).filter(x => availableLangs().includes(x))]
      const qs = ['best', ...qualityOrder.slice(1).filter(x => availableQualities().includes(x))]
      buildButtons($('#languageChoices'), ls, selectedLang, v => { selectedLang = v })
      buildButtons($('#qualityChoices'), qs, selectedQuality, v => { selectedQuality = v })
      updateHint()
      $('#sourceStatus').textContent = `${j.results?.length || 0} opções adicionais encontradas.`
    } catch (err) { $('#sourceStatus').textContent = 'Não foi possível buscar outras opções agora.' }
    e.currentTarget.disabled = false
    e.currentTarget.textContent = 'Procurar outras opções'
  }
  $('#modal').classList.remove('hidden')
  pushLayer(() => $('#modal').classList.add('hidden'))
}

$('#closeModal').onclick = () => closeTop()
$('#closeDiag').onclick = () => closeTop()

/* ---------- player ---------- */
let poll = null
let saveTimer = null
let wakeLock = null
let hideTopTimer = null
let watchdog = null

function startStatusPolling() {
  clearInterval(poll)
  if (!state.hash) return
  poll = setInterval(async () => {
    try {
      const s = await api('/api/status/' + state.hash)
      if (s.state === 'metadata') $('#pmsg').textContent = `Procurando peers... ${s.peers || 0} conectados`
      else if (s.state === 'ready' && !$('#pmsg').classList.contains('err')) {
        $('#pmsg').textContent = `${s.peers} peers | ${(s.downloadSpeed / 1e6).toFixed(1)} MB/s | ${(s.progress * 100).toFixed(1)}% em cache`
        $('#badge').textContent = s.peers + ' ativos'
      }
    } catch {}
  }, 1000)
}

function setSrc(posFrac) {
  const p = new URLSearchParams({ name: state.label })
  if (state.fileIndex != null) p.set('file', state.fileIndex)
  p.set('mode', state.mode)
  if (state.hint) p.set('hint', state.hint)
  if (state.mode !== 'direct') {
    p.set('audio', state.audio || 0)
    if (state.q) p.set('q', state.q)
    if (posFrac) p.set('pos', posFrac.toFixed(5))
    state.base = (posFrac || 0) * (state.duration || 0)
  } else {
    state.base = 0
  }
  clearTimeout(watchdog)
  watchdog = setTimeout(() => {
    if (video.readyState < 2) showError('Ainda conectando aos peers / preparando. Se demorar, tente outra fonte.', true)
  }, 60000)
  video.src = `/api/stream/${state.hash}?${p}`
  video.play().catch(() => {})
}

function syncControls() {
  const ffm = state.mode !== 'direct'
  $('#pctl').classList.toggle('hidden', !ffm)
  video.controls = !ffm
  $('#pAudio').disabled = !(state.media?.audios?.length > 1)
  if (ffm) { showTop(true); setTimeout(() => { try { $('#pseek').focus() } catch {} }, 60) }
  else { $('#ptop').classList.add('hidden'); setTimeout(() => { try { video.focus() } catch {} }, 60) }
}

async function openPlayer(source, movie, fileIndex) {
  Object.assign(state, {
    open: true, movie, source, hash: source.hash, fileIndex: fileIndex ?? null,
    tvKey: movie.tvKey || null,
    label: `${movie.title || source.title || ''} ${movie.year || ''}`.trim(),
    hint: source.codec || '',
    audio: 0, q: '', mode: 'auto', media: null, files: [], externalSubs: [],
    duration: 0, base: 0, sub: -1, tried: 0, forceCompat: false, key: null
  })
  $('#ptitle').textContent = state.label
  $('#player').classList.remove('hidden')
  $('#pmsg').textContent = ''
  $('#pmsg').classList.remove('err')
  video.removeAttribute('src')
  $$('track').forEach(t => t.remove())
  $('#pspin').classList.remove('hidden')
  $('#ptop').classList.add('hidden')
  $('#pctl').classList.add('hidden')
  $('#pmenu').classList.add('hidden')
  pushLayer(closePlayer)
  requestWakeLock()
  try { $('#player').requestFullscreen?.().catch(() => {}) } catch {}

  startStatusPolling()

  try {
    const j = await api(`/api/prepare/${state.hash}?name=${encodeURIComponent(state.label)}${state.fileIndex != null ? '&file=' + state.fileIndex : ''}`)
    applyPrepared(j)
  } catch (e) {
    $('#pspin').classList.add('hidden')
    clearInterval(poll)
    showError(e.message, true)
  }
}

function applyPrepared(j) {
  state.files = j.files || []
  state.externalSubs = j.externalSubs || []
  state.media = j.media || null
  state.duration = state.media?.duration || 0
  if (j.file != null) state.fileIndex = j.file

  const audios = state.media?.audios || []
  if (audios.length > 1) {
    const pt = audios.findIndex(a => ['pt', 'pt-br', 'por', 'pob'].includes(String(a.lang).toLowerCase()))
    if (pt > 0) state.audio = pt
  }
  state.mode = state.forceCompat ? state.mode : (j.mode || 'auto')
  if (state.mode === 'direct' && state.audio) state.mode = 'remux'
  syncControls()
  buildSubs()
  setSrc(0)
  $('#pspin').classList.add('hidden')
  if (!j.ffmpeg) toast('ffmpeg nao encontrado: so mp4/h264 vai tocar.', [], 8000)
  resumeOrStart()
}

function buildSubs() {
  $$('track').forEach(t => t.remove())
  const list = [
    ...state.externalSubs.map(s => ({ ...s, url: `/api/subs/${state.hash}?file=${state.fileIndex}&ext=${s.i}` })),
    ...(state.media?.subs || []).filter(s => s.text).map(s => ({ ...s, kind: 'embedded', url: `/api/subs/${state.hash}?file=${state.fileIndex}&track=${s.i}` }))
  ]
  state.subList = list
  for (const s of list) {
    const tr = document.createElement('track')
    tr.kind = 'subtitles'
    tr.label = s.label || 'Legenda'
    tr.srclang = s.lang || 'und'
    tr.src = s.url
    video.appendChild(tr)
  }
  const idx = list.findIndex(s => ['pt-br', 'pt', 'pob'].includes(String(s.lang).toLowerCase()))
  setSub(idx >= 0 ? idx : -1)
}

function setSub(idx) {
  const tracks = $$('#video track')
  tracks.forEach((t, i) => { try { t.track.mode = i === idx ? 'showing' : 'disabled' } catch {} })
  state.sub = idx
  if (idx >= 0 && state.subList?.[idx]?.kind === 'embedded') toast('Preparando legenda do arquivo... pode demorar na primeira vez.')
}

async function resumeOrStart() {
  const key = state.tvKey || `${state.hash}:${state.fileIndex ?? 'main'}`
  state.key = key
  let p = null
  try { p = await api('/api/progress/' + encodeURIComponent(key)) } catch {}
  const local = readLocalProgress()[key]
  if (!p?.t || Number(local?.ts || 0) > Number(p?.ts || 0)) p = local || p
  const t = Number(p?.t || 0)
  const d = Number(p?.d || state.duration || 0)
  const resume = (t > 30 && d && t < d - 60) ? t : 0
  if (resume) {
    toast(`Retomando de ${fmtTime(resume)}`, [
      ['Comecar do inicio', () => { setSrc(0); video.play().catch(() => {}) }]
    ], 9000)
    state.pendingSeek = resume
    seekTo(resume)
  }
  clearInterval(saveTimer)
  saveTimer = setInterval(() => saveProgress(), 5000)
}

/* ---------- player direto (Archive.org) ---------- */
async function openArchive(item) {
  toast('Preparando stream...')
  try {
    const j = await api('/api/archive/' + encodeURIComponent(item.id))
    openDirect(j.url, item.title)
  } catch (e) { toast('Nao foi possivel abrir: ' + e.message) }
}

function openDirect(url, title) {
  Object.assign(state, {
    open: true, movie: { title }, source: { direct: true }, hash: null, fileIndex: null,
    tvKey: null, label: title, mode: 'direct', media: null, files: [], externalSubs: [],
    duration: 0, base: 0, key: null, sub: -1, forceCompat: false, audio: 0, q: ''
  })
  $('#ptitle').textContent = title
  $('#player').classList.remove('hidden')
  $('#pmsg').textContent = ''
  $('#pmsg').classList.remove('err')
  $$('track').forEach(t => t.remove())
  $('#pspin').classList.add('hidden')
  $('#ptop').classList.add('hidden')
  $('#pmenu').classList.add('hidden')
  $('#pctl').classList.remove('hidden')
  video.controls = true
  pushLayer(closePlayer)
  requestWakeLock()
  try { $('#player').requestFullscreen?.().catch(() => {}) } catch {}
  video.src = url
  video.play().catch(() => {})
}

function position() { return (state.base || 0) + (video.currentTime || 0) }
function total() { return state.duration || video.duration || 0 }

function seekTo(seconds) {
  const d = total()
  if (!d) return
  if (state.mode === 'direct') {
    if (video.readyState >= 1) video.currentTime = seconds
    else state.pendingSeek = seconds
    return
  }
  const frac = Math.min(0.995, Math.max(0, seconds / d))
  setSrc(frac)
  video.play().catch(() => {})
}

function saveProgress(force) {
  if (!state.hash || !state.key) return
  const t = position(), d = total()
  if (!d || t < 3) return
  const body = {
    key: state.key, t, d, hash: state.hash, file: state.fileIndex,
    title: state.movie?.title || state.label, year: state.movie?.year || '',
    poster: state.movie?.poster || '', name: state.label
  }
  saveLocalProgress(body)
  const blob = new Blob([JSON.stringify(body)], { type: 'application/json' })
  if (force && navigator.sendBeacon && navigator.sendBeacon('/api/progress', blob)) return
  fetch('/api/progress', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), keepalive: !!force
  }).catch(() => {})
}

function closePlayer() {
  saveProgress(true)
  clearInterval(poll); clearInterval(saveTimer); clearTimeout(watchdog)
  releaseWakeLock()
  const hash = state.hash
  try { video.pause() } catch {}
  video.removeAttribute('src'); video.load()
  $('#player').classList.add('hidden')
  $('#pmenu').classList.add('hidden')
  state.open = false
  try { document.exitFullscreen?.() } catch {}
  releaseTorrent(hash)
  refreshContinue()
  refreshStorage()
}

function showError(msg, sticky) {
  $('#pmsg').textContent = msg
  $('#pmsg').classList.add('err')
  if (!sticky) setTimeout(() => $('#pmsg').classList.remove('err'), 5000)
}

function showTop(v) {
  $('#ptop').classList.toggle('hidden', !v)
  if (v) {
    clearTimeout(hideTopTimer)
    hideTopTimer = setTimeout(() => { if (state.mode === 'direct') $('#ptop').classList.add('hidden') }, 7000)
  }
}

video.onerror = () => {
  if (!state.open || !video.getAttribute('src')) return
  if (state.source?.direct) { showError('Nao foi possivel reproduzir este stream.', true); return }
  const i = CHAIN.indexOf(state.mode)
  if (health.ffmpeg && i >= 0 && i < CHAIN.length - 1) {
    state.mode = CHAIN[i + 1]
    state.forceCompat = true
    syncControls()
    showError(`O navegador recusou o formato. Tentando modo ${MODE_LABEL[state.mode]}...`)
    setSrc(total() ? position() / total() : 0)
    return
  }
  showError('Nao foi possivel reproduzir. Abra o Diagnostico e me mande o resultado.', true)
}
video.onloadedmetadata = () => {
  clearTimeout(watchdog)
  if (!state.duration && isFinite(video.duration)) state.duration = video.duration
  if (state.pendingSeek && state.mode === 'direct') { video.currentTime = state.pendingSeek; state.pendingSeek = null }
}
video.oncanplay = () => { clearTimeout(watchdog); $('#pmsg').classList.remove('err') }
video.onplay = () => { $('#pplay').textContent = 'Pausar'; requestWakeLock(); if (!poll && state.open && state.hash) startStatusPolling() }
video.onpause = () => { $('#pplay').textContent = 'Tocar'; saveProgress() }
video.onended = () => {
  saveProgress(true)
  clearInterval(poll); poll = null
  const hash = state.hash
  refreshContinue()
  releaseTorrent(hash)
  refreshStorage()
}
video.ontimeupdate = () => {
  const d = total()
  $('#ptime').textContent = fmtTime(position())
  $('#pdur').textContent = d ? fmtTime(d) : '--:--'
  if (d && document.activeElement !== $('#pseek')) $('#pseek').value = Math.round((position() / d) * 1000)
}
video.onclick = () => { if (state.mode === 'direct') showTop($('#ptop').classList.contains('hidden')) }

$('#pseek').onchange = e => seekTo((Number(e.target.value) / 1000) * total())
$('#pplay').onclick = () => video.paused ? video.play() : video.pause()
$('#pvolD').onclick = () => { video.volume = Math.max(0, video.volume - 0.1) }
$('#pvolU').onclick = () => { video.volume = Math.min(1, video.volume + 0.1) }
$('#pClose').onclick = () => closeTop()
$('#pFs').onclick = () => { document.fullscreenElement ? document.exitFullscreen() : $('#player').requestFullscreen?.() }
$('#pAudio').onclick = () => openMenu('audio')
$('#pSubs').onclick = () => openMenu('subs')
$('#pMode').onclick = () => openMenu('mode')
$('#pDiag').onclick = () => runDiag()
$('#pLink').onclick = () => {
  const url = new URL(video.getAttribute('src') || '', location.origin).href
  navigator.clipboard?.writeText(url).then(
    () => toast('Link copiado. Cole no VLC para testar.'),
    () => toast(url, [], 12000)
  )
}

async function runDiag() {
  $('#diagText').textContent = 'Rodando...'
  $('#diagModal').classList.remove('hidden')
  pushLayer(() => $('#diagModal').classList.add('hidden'))
  try {
    const j = await api(`/api/diag/${state.hash}?name=${encodeURIComponent(state.label)}`)
    const linhas = []
    linhas.push('torrent: ' + state.label)
    linhas.push('peers: ' + (j.peers ?? '-') + '   progresso: ' + ((j.progress || 0) * 100).toFixed(1) + '%')
    linhas.push('ffmpeg: ' + (j.ffmpeg?.ok ? 'ok (' + j.ffmpeg.source + ')' : 'NAO ENCONTRADO'))
    linhas.push('modo sugerido: ' + (j.modoSugerido || '-'))
    if (j.file) linhas.push('arquivo: ' + j.file.nome + ' (' + Math.round(j.file.bytes / 1e6) + ' MB)')
    if (j.media) linhas.push('codec: ' + (j.media.video?.codec || '?') + '  audios: ' + j.media.audios.length + '  legendas: ' + j.media.subs.length)
    linhas.push('')
    linhas.push('passos:')
    for (const s of j.steps) linhas.push('  [' + (s.ok ? 'ok' : 'FALHOU') + '] ' + s.label + ' ' + JSON.stringify({ ...s, label: undefined, ok: undefined }))
    if (j.errors?.length) { linhas.push(''); linhas.push('erros: ' + j.errors.join(' | ')) }
    const txt = linhas.join('\n')
    $('#diagText').textContent = txt
    $('#diagCopy').onclick = () => navigator.clipboard?.writeText(txt)
  } catch (e) {
    $('#diagText').textContent = 'Falhou: ' + e.message
  }
}

function openMenu(kind) {
  const m = $('#pmenu')
  m.innerHTML = ''
  m.classList.remove('hidden')
  const h = txt => { const e = document.createElement('h3'); e.textContent = txt; m.appendChild(e) }
  const add = (label, on, fn) => {
    const b = document.createElement('button')
    b.className = 'focusable' + (on ? ' on' : '')
    b.textContent = label
    b.onclick = () => { m.classList.add('hidden'); fn() }
    m.appendChild(b)
  }
  const reSeek = () => setSrc(total() ? position() / total() : 0)

  if (kind === 'audio') {
    h('Idioma do audio')
    const list = state.media?.audios || []
    if (list.length < 2) add('So uma faixa neste arquivo', true, () => {})
    list.forEach(a => add(a.label || `Faixa ${a.i + 1}`, state.audio === a.i, () => {
      if (!health.ffmpeg) return toast('ffmpeg nao encontrado.')
      state.audio = a.i
      state.forceCompat = true
      if (state.mode === 'direct') state.mode = 'remux'
      syncControls(); reSeek()
    }))
  }

  if (kind === 'subs') {
    h('Legenda')
    add('Desligada', state.sub === -1, () => setSub(-1))
    ;(state.subList || []).forEach((s, i) => add((s.label || `Legenda ${i + 1}`) + (s.kind === 'embedded' ? ' (no arquivo)' : ''), state.sub === i, () => setSub(i)))
  }

  if (kind === 'mode') {
    h('Modo de reproducao')
    CHAIN.forEach(md => add(MODE_LABEL[md] + (md === 'direct' ? ' (menos CPU)' : md === 'transcode' ? ' (converter)' : ''), state.mode === md, () => {
      state.mode = md
      state.forceCompat = true
      syncControls()
      md === 'direct' ? setSrc(0) : reSeek()
    }))
    h('Qualidade (modo leve)')
    ;[['', 'Original'], ['720', '720p'], ['480', '480p']].forEach(([v, l]) =>
      add(l, state.q === v, () => {
        state.q = v
        if (state.mode !== 'transcode') { state.mode = 'transcode'; state.forceCompat = true }
        syncControls(); reSeek()
      }))
  }

  const first = m.querySelector('button')
  if (first) first.focus()
}
$('#pmenu').onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); $('#pmenu').classList.add('hidden') } }

/* ---------- tela sempre ligada ---------- */
async function requestWakeLock() {
  try { if (!wakeLock && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen') } catch {}
}
function releaseWakeLock() { try { wakeLock?.release(); wakeLock = null } catch {} }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.open) requestWakeLock()
  if (document.visibilityState === 'hidden') saveProgress(true)
})
window.addEventListener('pagehide', () => saveProgress(true))

/* ---------- modo TV ---------- */
if (localStorage.getItem('cinep2p.tv') === '1') document.documentElement.classList.add('tv')
$('#tvBtn').onclick = () => {
  const on = document.documentElement.classList.toggle('tv')
  localStorage.setItem('cinep2p.tv', on ? '1' : '0')
}

/* ---------- instalar como app ---------- */
let installEvt = null
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone
if (standalone) $('#installBtn').classList.add('hidden')
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault()
  installEvt = e
})
$('#installBtn').onclick = async () => {
  if (installEvt) { installEvt.prompt(); installEvt = null; return }
  const https = location.protocol === 'https:'
  toast(https
    ? 'Menu do navegador -> "Instalar aplicativo" ou "Adicionar a tela inicial".'
    : 'Para instalar como app rode "npm run https" e abra pelo https.', [], 12000)
}

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

/* ---------- boot ---------- */
renderGenres()
api('/api/health').then(h => {
  health = h
  if (!h.ffmpeg) toast('ffmpeg nao encontrado: mkv/x265 pode nao tocar.', [], 9000)
}).catch(() => {})
refreshStorage()
setInterval(refreshStorage, 20000)
refreshContinue().then(loadCatalog)
setInterval(async () => {
  try { const j = await api('/api/active'); $('#badge').textContent = j.active + ' ativos' } catch {}
}, 5000)
