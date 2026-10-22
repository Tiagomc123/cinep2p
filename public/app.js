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
const posterLookups = new Map()

function qs(params) {
  return Object.entries(params).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
}

function placeholderPoster(title) {
  const safeTitle = String(title || 'Filme').replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  })[c])
  const shortTitle = safeTitle.length > 34 ? safeTitle.slice(0, 31) + '...' : safeTitle
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#30204f"/><stop offset="1" stop-color="#101018"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/><circle cx="150" cy="150" r="52" fill="none" stroke="#8b5cf6" stroke-width="3" opacity=".8"/><path d="M135 119 L180 150 L135 181 Z" fill="#c4b5fd"/><text x="150" y="260" fill="#ffffff" font-family="Arial,sans-serif" font-size="18" font-weight="700" text-anchor="middle">${shortTitle}</text><text x="150" y="292" fill="#a78bfa" font-family="Arial,sans-serif" font-size="12" letter-spacing="3" text-anchor="middle">CINEP2P</text></svg>`
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
}

async function lookupPoster(title) {
  const key = String(title || '').trim().toLocaleLowerCase('pt-BR')
  if (!key) return ''
  if (!posterLookups.has(key)) {
    posterLookups.set(key, fetch('/api/poster?title=' + encodeURIComponent(title))
      .then(r => r.ok ? r.json() : { poster: '' })
      .then(j => j.poster || '')
      .catch(() => ''))
  }
  return posterLookups.get(key)
}

function setPoster(img, movie, tryLookup = true) {
  const fallback = placeholderPoster(movie.title)
  img.onerror = async () => {
    img.onerror = null
    img.src = fallback
    if (tryLookup && !img.dataset.posterLookup) {
      img.dataset.posterLookup = '1'
      const poster = await lookupPoster(movie.title)
      if (poster) {
        img.onerror = () => {
          img.onerror = null
          img.src = fallback
        }
        img.src = poster
      }
    }
  }

  if (movie.poster) {
    img.src = movie.poster
  } else {
    img.src = fallback
    if (tryLookup) {
      img.dataset.posterLookup = '1'
      lookupPoster(movie.title).then(poster => {
        if (poster && img.isConnected && img.src === fallback) img.src = poster
      })
    }
  }
}

function card(movie) {
  const d = document.createElement('div')
  d.className = 'card'
  const img = document.createElement('img')
  img.className = 'poster'
  img.loading = 'lazy'
  img.alt = `Capa de ${movie.title || 'filme'}`
  setPoster(img, movie)

  const title = document.createElement('div')
  title.className = 't'
  title.textContent = movie.title || 'Titulo indisponivel'

  const meta = document.createElement('div')
  meta.className = 'm'
  meta.textContent = [movie.year || '', movie.rating ? 'Nota ' + movie.rating : ''].filter(Boolean).join(' | ')

  d.append(img, title, meta)
  d.onclick = () => openDetail(movie)
  return d
}

function strip(title, movies) {
  const row = document.createElement('div')
  row.className = 'row'
  const heading = document.createElement('h2')
  heading.textContent = title
  row.appendChild(heading)
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
  if (!rowsEl.children.length) rowsEl.innerHTML = '<div class="loading">Nao foi possivel carregar o catalogo. Tente novamente.</div>'
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
  $('#detail').innerHTML = `
    <div class="hero" style="background-image:url('${movie.background || movie.poster || ''}')"></div>
    <div class="dbody">
      <h1></h1>
      <div class="dmeta"></div>
      <div class="dsum"></div>
      <div class="sec">Reproduzir com magnet</div>
      <p class="magnet-help">Cole o link magnet de um conteúdo que você tenha autorização para acessar.</p>
      <form id="magnetForm" class="magnet-form">
        <input id="magnetInput" type="text" autocomplete="off" spellcheck="false" placeholder="magnet:?xt=urn:btih:..." required>
        <button class="play" type="submit">Assistir</button>
      </form>
      <div id="magnetError" class="magnet-error" role="status"></div>
    </div>`
  $('#detail h1').textContent = `${movie.title || ''} ${movie.year ? '(' + movie.year + ')' : ''}`
  $('#detail .dmeta').textContent = `${(movie.genres || []).join(' | ')} ${movie.rating ? '| Nota ' + Number(movie.rating).toFixed(1) : ''} ${movie.runtime ? '| ' + movie.runtime + ' min' : ''}`
  $('#detail .dsum').textContent = movie.summary || ''

  $('#magnetForm').addEventListener('submit', event => {
    event.preventDefault()
    const value = $('#magnetInput').value.trim()
    const match = /^magnet:\\?[^#]*xt=urn:btih:([a-f0-9]{40})(?:&|$)/i.test(value)
      ? value.match(/xt=urn:btih:([a-f0-9]{40})/i)
      : null
    if (!value.startsWith('magnet:?') || !match) {
      $('#magnetError').textContent = 'Magnet inválido. É necessário um infohash hexadecimal de 40 caracteres.'
      return
    }
    $('#magnetError').textContent = ''
    play({ hash: match[1].toLowerCase(), quality: 'Magnet', source: 'Magnet informado pelo usuário' }, movie)
  })

  $('#modal').classList.remove('hidden')
}

function srcRow(x, movie) {
  const d = document.createElement('div')
  d.className = 'src'
  d.innerHTML = `<span class="q"></span>
    <span class="tag codec"></span>
    <span class="tag source"></span>
    <span class="s"></span>
    <button class="play">Assistir</button>`
  d.querySelector('.q').textContent = x.quality || 'SD'
  d.querySelector('.codec').textContent = x.codec || 'n/d'
  d.querySelector('.source').textContent = x.source || 'Fonte'
  d.querySelector('.s').textContent = `${x.seeds || 0} seeds | ${x.size || '?'}`
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
    try {
      const response = await fetch('/api/search?q=' + encodeURIComponent(q))
      const j = await response.json()
      rowsEl.innerHTML = ''
      if (!response.ok) {
        rowsEl.innerHTML = '<div class="loading">' + (j.error || 'Erro ao pesquisar filmes.') + '</div>'
        return
      }
      const g = document.createElement('div')
      g.className = 'grid'
      ;(j.results || []).forEach(m => g.appendChild(card(m)))
      rowsEl.appendChild(g)
      if (!g.children.length) rowsEl.innerHTML = '<div class="loading">Nenhum filme encontrado.</div>'
    } catch {
      rowsEl.innerHTML = '<div class="loading">Erro ao pesquisar. Tente novamente.</div>'
    }
  }, 500)
}

renderGenres()
loadCatalog()
