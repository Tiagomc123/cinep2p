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
const MODE_LABEL = { direct: 'Direto', remux: 'Compativel', transcode: 'Leve' }
const CHAIN = ['direct', 'remux', 'transcode']

const video = $('#video')
const rowsEl = $('#rows')
let activeGenre = ''
let onlyDub = localStorage.getItem('cinep2p.dub') === '1'
let health = { ffmpeg: false }
const state = { progressByHash: {} }

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

/* ---------- cartoes ---------- */
function progressFor(movie) {
  if (movie.progressKey) return state.progressByHash[movie.hash]
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
  img.src = movie.poster || fallback
  img.onerror = async () => {
    img.onerror = null
    const j = await lookupPoster(movie.title, movie.imdb)
    img.src = j?.poster || fallback
  }
  const t = document.createElement('div'); t.className = 't'; t.textContent = movie.title || 'Sem titulo'
  const m = document.createElement('div'); m.className = 'm'
  m.textContent = [movie.year || '', movie.rating ? 'Nota ' + movie.rating : '', movie.dub ? 'Dublado' : ''].filter(Boolean).join(' | ')
  d.append(img, t, m)
  const p = progressFor(movie)
  if (p && p.d) {
    const bar = document.createElement('div'); bar.className = 'bar'
    const i = document.createElement('i'); i.style.width = Math.min(100, (p.t / p.d) * 100) + '%'
    bar.appendChild(i); d.appendChild(bar)
  }
  d.onclick = () => opts.direct ? openPlayer(movie.source, movie, movie.file) : openDetail(movie)
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

/* ---------- catalogo ---------- */
async function loadCatalog() {
  rowsEl.innerHTML = '<div class="loading">Carregando catalogo...</div>'
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
  if (!rowsEl.children.length) rowsEl.innerHTML = '<div class="loading">Nao foi possivel carregar o catalogo.</div>'
}

async function refreshContinue() {
  let items = []
  try { items = (await api('/api/progress')).items || [] } catch {}
  items = items.filter(i => i.d && i.t > 30)
  state.progressByHash = Object.fromEntries(items.map(i => [i.hash, i]))
  const cont = $('#contRow')
  cont.innerHTML = ''
  if (!items.length) return
  const row = document.createElement('div'); row.className = 'row'
  const h = document.createElement('h2'); h.textContent = 'Continuar assistindo'
  const s = document.createElement('div'); s.className = 'strip'
  for (const i of items) {
    s.appendChild(card({
      title: i.title || i.name, year: i.year, poster: i.poster,
      hash: i.hash, progressKey: i.key,
      source: { hash: i.hash, title: i.title, source: 'retomar', quality: '' },
      file: i.file
    }, { direct: true }))
  }
  row.append(h, s); cont.appendChild(row)
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

$('#dubChip').classList.toggle('on', onlyDub)
$('#dubChip').onclick = () => {
  onlyDub = !onlyDub
  localStorage.setItem('cinep2p.dub', onlyDub ? '1' : '0')
  $('#dubChip').classList.toggle('on', onlyDub)
  const q = $('#q').value.trim()
  if (q) runSearch(q); else loadCatalog()
}

async function runSearch(q) {
  rowsEl.innerHTML = '<div class="loading">Buscando...</div>'
  try {
    const j = await api(`/api/search?q=${encodeURIComponent(q)}${onlyDub ? '&dub=1' : ''}`)
    rowsEl.innerHTML = ''
    const g = document.createElement('div'); g.className = 'grid'
    ;(j.results || []).forEach(m => g.appendChild(card(m)))
    ;(j.extra || []).forEach(x => g.appendChild(card({
      title: x.title.slice(0, 70), year: '', dub: x.dub, imdb: x.imdb,
      torrents: [x], genres: [], summary: `Fonte extra | ${x.seeds} seeds | ${x.size}`
    })))
    rowsEl.appendChild(g)
    if (!g.children.length) rowsEl.innerHTML = '<div class="loading">Nada encontrado.</div>'
  } catch (e) {
    rowsEl.innerHTML = `<div class="loading">Erro: ${esc(e.message)}</div>`
  }
}

/* ---------- detalhe ---------- */
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

async function openDetail(movie) {
  const t = (movie.torrents || []).filter(x => x.seeds > 0)
  $('#detail').innerHTML = `
    <div class="hero" style="background-image:url('${esc(movie.background || movie.poster || '')}')"></div>
    <div class="dbody">
      <h1></h1><div class="dmeta"></div><div class="dsum"></div>
      <div class="sec">Fontes (${t.length})</div><div id="srcList"></div>
      <div class="sec">Outras fontes (indice extra)</div>
      <button class="alt focusable" id="dubBtn">So dublado</button>
      <button class="alt focusable" id="more">Buscar no indice extra</button>
      <div id="extraList"></div>
    </div>`
  $('#detail h1').textContent = `${movie.title || ''} ${movie.year ? '(' + movie.year + ')' : ''}`
  $('#detail .dmeta').textContent = [(movie.genres || []).join(' | '), movie.rating ? 'Nota ' + movie.rating : '', movie.runtime ? movie.runtime + ' min' : ''].filter(Boolean).join(' | ')
  $('#detail .dsum').textContent = movie.summary || ''

  const list = $('#srcList')
  if (!t.length) list.innerHTML = '<div class="dsum">Nenhuma fonte com seed agora.</div>'
  t.forEach(x => list.appendChild(srcRow(x, movie)))

  let extraDub = onlyDub
  const dubBtn = $('#dubBtn')
  dubBtn.classList.toggle('on', extraDub)
  dubBtn.onclick = () => { extraDub = !extraDub; dubBtn.classList.toggle('on', extraDub); $('#more').click() }

  $('#more').onclick = async e => {
    e.target.disabled = true
    e.target.textContent = 'Buscando...'
    try {
      const j = await api(`/api/extra?title=${encodeURIComponent(movie.title)}&year=${movie.year || ''}${extraDub ? '&dub=1' : ''}`)
      const ex = $('#extraList'); ex.innerHTML = ''
      if (!j.results?.length) ex.innerHTML = '<div class="dsum">Nada encontrado.</div>'
      ;(j.results || []).forEach(x => ex.appendChild(srcRow(x, movie)))
      e.target.textContent = 'Atualizar indice extra'
      e.target.disabled = false
    } catch {
      e.target.textContent = 'Tentar novamente'
      e.target.disabled = false
    }
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

  clearInterval(poll)
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
  const key = `${state.hash}:${state.fileIndex ?? 'main'}`
  state.key = key
  let p = null
  try { p = await api('/api/progress/' + encodeURIComponent(key)) } catch {}
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
  try { video.pause() } catch {}
  video.removeAttribute('src'); video.load()
  $('#player').classList.add('hidden')
  $('#pmenu').classList.add('hidden')
  state.open = false
  try { document.exitFullscreen?.() } catch {}
  refreshContinue()
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
video.onplay = () => { $('#pplay').textContent = 'Pausar'; requestWakeLock() }
video.onpause = () => { $('#pplay').textContent = 'Tocar'; saveProgress() }
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
refreshContinue().then(loadCatalog)
setInterval(async () => {
  try { const j = await api('/api/active'); $('#badge').textContent = j.active + ' ativos' } catch {}
}, 5000)
