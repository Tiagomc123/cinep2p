const $ = s => document.querySelector(s)
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const rowsEl = $('#rows')
const video = $('#video')
let country = ''
let category = ''
let hls = null

async function api(url) {
  const r = await fetch(url)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

const layers = []
history.replaceState({ layer: false }, '')
function pushLayer(close) { layers.push(close); history.pushState({ layer: true }, '') }
function closeTop() { if (layers.length) history.back() }
window.addEventListener('popstate', () => { const fn = layers.pop(); if (fn) fn() })

function toast(msg, ms = 6000) {
  const el = $('#toast')
  el.textContent = msg
  el.classList.remove('hidden')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => el.classList.add('hidden'), ms)
}

if (localStorage.getItem('cinep2p.tv') === '1') document.documentElement.classList.add('tv')
$('#tvBtn').onclick = () => {
  const on = document.documentElement.classList.toggle('tv')
  localStorage.setItem('cinep2p.tv', on ? '1' : '0')
}

function chip(label, on, fn) {
  const b = document.createElement('button')
  b.className = 'chip focusable' + (on ? ' on' : '')
  b.textContent = label
  b.onclick = () => fn()
  return b
}

async function loadMeta() {
  try {
    const m = await api('/api/live/meta')
    const sel = $('#country')
    sel.innerHTML = '<option value="">Todos os paises</option>'
    for (const c of m.countries || []) {
      const o = document.createElement('option')
      o.value = c; o.textContent = c
      sel.appendChild(o)
    }
    sel.value = country
    const nav = $('#lchips')
    nav.innerHTML = ''
    nav.appendChild(chip('Tudo', !category, () => { category = ''; loadMeta(); load() }))
    for (const c of (m.categories || []).slice(0, 24)) {
      nav.appendChild(chip(c, category === c, () => { category = category === c ? '' : c; loadMeta(); load() }))
    }
  } catch (e) { toast('Falha ao carregar paises/categorias: ' + e.message) }
}

async function load() {
  rowsEl.innerHTML = '<div class="loading">Carregando canais...</div>'
  try {
    const p = new URLSearchParams({ limit: '120' })
    if (country) p.set('country', country)
    if (category) p.set('category', category)
    const q = $('#q').value.trim()
    if (q) p.set('q', q)
    const j = await api('/api/live?' + p)
    $('#total').textContent = (j.total || 0) + ' canais'
    rowsEl.innerHTML = ''
    if (!j.channels?.length) { rowsEl.innerHTML = '<div class="loading">Nenhum canal encontrado.</div>'; return }
    const g = document.createElement('div'); g.className = 'grid'
    for (const c of j.channels) {
      const d = document.createElement('div')
      d.className = 'card chan focusable'
      d.tabIndex = 0
      d.innerHTML = `<div class="box">${c.logo ? `<img loading="lazy" src="${esc(c.logo)}" alt="">` : '<span>TV</span>'}</div>
        <div class="t">${esc(c.name)}</div><div class="m">${esc(c.group || '')}</div>`
      d.onclick = () => play(c)
      d.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); d.click() } }
      g.appendChild(d)
    }
    rowsEl.appendChild(g)
  } catch (e) {
    rowsEl.innerHTML = `<div class="loading">Erro: ${esc(e.message)}</div>`
  }
}

let debounce
$('#q').oninput = () => { clearTimeout(debounce); debounce = setTimeout(load, 400) }
$('#country').onchange = e => { country = e.target.value; load() }

function stop() {
  try { hls?.destroy() } catch {}
  hls = null
  try { video.pause() } catch {}
  video.removeAttribute('src')
  video.load()
}

function play(c) {
  stop()
  $('#ptitle').textContent = c.name
  $('#pmsg').textContent = 'Conectando...'
  $('#pspin').classList.remove('hidden')
  $('#player').classList.remove('hidden')
  pushLayer(() => { $('#player').classList.add('hidden'); stop() })
  const url = '/api/live/proxy?url=' + encodeURIComponent(c.url)
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url
    video.play().catch(() => {})
  } else if (window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls({ lowLatencyMode: true, maxBufferLength: 20 })
    hls.on(window.Hls.Events.ERROR, (_e, data) => {
      if (data?.fatal) {
        if (data.type === 'networkError') hls.startLoad()
        else if (data.type === 'mediaError') hls.recoverMediaError()
      }
    })
    hls.loadSource(url)
    hls.attachMedia(video)
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}))
  } else {
    video.src = url
    video.play().catch(() => {})
  }
}

video.oncanplay = () => { $('#pspin').classList.add('hidden'); $('#pmsg').textContent = '' }
video.onerror = () => { $('#pspin').classList.add('hidden'); $('#pmsg').textContent = 'Stream fora do ar. Tente outro canal.' }
video.onclick = () => $('#ptop').classList.toggle('hidden')
$('#pReload').onclick = () => {
  const u = video.getAttribute('src')
  stop()
  setTimeout(() => { video.src = u; video.play().catch(() => {}) }, 150)
}
$('#pFs').onclick = () => { document.fullscreenElement ? document.exitFullscreen() : $('#player').requestFullscreen?.() }
$('#pClose').onclick = () => closeTop()

loadMeta()
load()