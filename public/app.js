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

const $ = s => document.querySelector(s)
const rowsEl = $('#rows')
let activeGenre = ''

function qs(params) {
  return Object.entries(params).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
}

function card(movie) {
  const d = document.createElement('div')
  d.className = 'card'
  d.innerHTML = `<img loading="lazy" src="${movie.poster || ''}" alt="">
    <div class="t">${movie.title}</div>
    <div class="m">${movie.year || ''} ${movie.rating ? '| ' + movie.rating : ''}</div>`
  d.onclick = () => openDetail(movie)
  return d
}

function strip(title, movies) {
  const row = document.createElement('div')
  row.className = 'row'
  row.innerHTML = `<h2>${title}</h2>`
  const s = document.createElement('div')
  s.className = 'strip'
  movies.forEach(m => s.appendChild(card(m)))
  row.appendChild(s)
  return row
}

async function loadCatalog() {
  rowsEl.innerHTML = '<div class="loading">Carregando catalogo...</div>'
  const frag = document.createDocumentFragment()
  for (const r of ROWS) {
    try {
      const p = { ...r.p, ...(activeGenre ? { genre: activeGenre } : {}) }
      const res = await fetch('/api/catalog?' + qs(p))
      const j = await res.json()
      if (j.movies && j.movies.length) frag.appendChild(strip(r.t, j.movies))
    } catch (e) {}
  }
  rowsEl.innerHTML = ''
  rowsEl.appendChild(frag)
}

function renderGenres() {
  const nav = $('#genres')
  nav.innerHTML = ''
  GENRES.forEach(([id, label]) => {
    const b = document.createElement('button')
    b.className = 'chip' + (id === activeGenre ? ' on' : '')
    b.textContent = label
    b.onclick = () => { activeGenre = id; renderGenres(); loadCatalog() }
    nav.appendChild(b)
  })
}

function openDetail(movie) {
  const t = (movie.torrents || []).filter(x => x.seeds > 0)
  $('#detail').innerHTML = `
    <div class="hero" style="background-image:url('${movie.background || movie.poster}')"></div>
    <div class="dbody">
      <h1>${movie.title} ${movie.year ? '(' + movie.year + ')' : ''}</h1>
      <div class="dmeta">${(movie.genres || []).join(' | ')} ${movie.rating ? '| Nota ' + movie.rating : ''} ${movie.runtime ? '| ' + movie.runtime + ' min' : ''}</div>
      <div class="dsum">${movie.summary || ''}</div>
      <div class="sec">Fontes disponiveis (${t.length})</div>
      <div id="srcList"></div>
      <div class="sec">Outras fontes</div>
      <button class="alt" id="more">Buscar no indice extra</button>
      <div id="extraList"></div>
    </div>`

  const list = $('#srcList')
  if (!t.length) list.innerHTML = '<div class="dsum">Nenhuma fonte com seed agora.</div>'
  t.forEach(x => list.appendChild(srcRow(x, movie)))

  $('#more').onclick = async (e) => {
    e.target.disabled = true
    e.target.textContent = 'Buscando...'
    const r = await fetch(`/api/extra?title=${encodeURIComponent(movie.title)}&year=${movie.year || ''}`)
    const j = await r.json()
    const ex = $('#extraList')
    ex.innerHTML = ''
    if (!j.results.length) ex.innerHTML = '<div class="dsum">Nada encontrado.</div>'
    j.results.forEach(x => ex.appendChild(srcRow(x, movie)))
    e.target.remove()
  }

  $('#modal').classList.remove('hidden')
}

function srcRow(x, movie) {
  const d = document.createElement('div')
  d.className = 'src'
  d.innerHTML = `<span class="q">${x.quality}</span>
    <span class="tag">${x.codec || 'n/d'}</span>
    <span class="tag">${x.source}</span>
    <span class="s">${x.seeds} seeds | ${x.size}</span>
    <button class="play">Assistir</button>`
  d.querySelector('.play').onclick = () => play(x, movie)
  return d
}

let poll = null

function play(torrent, movie) {
  $('#modal').classList.add('hidden')
  $('#player').classList.remove('hidden')
  const v = $('#video')
  const name = `${movie.title} ${movie.year || ''} ${torrent.quality}`
  v.src = `/api/stream/${torrent.hash}?name=${encodeURIComponent(name)}`
  v.play().catch(() => {})
  $('#pinfo').textContent = 'Conectando aos peers... pode levar ate 40s no primeiro play.'

  clearInterval(poll)
  poll = setInterval(async () => {
    try {
      const s = await (await fetch(`/api/status/${torrent.hash}`)).json()
      if (!s.ready) return
      const mb = n => (n / 1e6).toFixed(1)
      $('#pinfo').textContent =
        `${s.peers} peers | baixando ${mb(s.downloadSpeed)} MB/s | enviando ${mb(s.uploadSpeed)} MB/s | ${(s.progress * 100).toFixed(1)}% em cache`
      if (v.readyState >= 3) $('#badge').textContent = `${s.peers} ativos`
    } catch (e) {}
  }, 1000)
}

$('#closeModal').onclick = () => $('#modal').classList.add('hidden')
$('#closePlayer').onclick = () => {
  const v = $('#video')
  clearInterval(poll)
  v.pause()
  v.removeAttribute('src')
  v.load()
  $('#player').classList.add('hidden')
}

let debounce
$('#q').oninput = e => {
  clearTimeout(debounce)
  const q = e.target.value.trim()
  debounce = setTimeout(async () => {
    if (!q) return loadCatalog()
    rowsEl.innerHTML = '<div class="loading">Buscando...</div>'
    const j = await (await fetch('/api/search?q=' + encodeURIComponent(q))).json()
    rowsEl.innerHTML = ''
    const g = document.createElement('div')
    g.className = 'grid'
    ;(j.results || []).forEach(m => g.appendChild(card(m)))
    ;(j.extra || []).forEach(x => {
      g.appendChild(card({
        title: x.title.slice(0, 60), year: '', poster: '',
        torrents: [x], genres: [], summary: `Fonte extra | ${x.seeds} seeds | ${x.size}`
      }))
    })
    rowsEl.appendChild(g)
    if (!g.children.length) rowsEl.innerHTML = '<div class="loading">Nada encontrado.</div>'
  }, 500)
}

renderGenres()
loadCatalog()