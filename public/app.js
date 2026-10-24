'use strict';

/* =====================================================================
   CineP2P 8.0 - player universal

   Video: stream BitTorrent bruto (Range), abre instantaneo.
   Audio: o navegador le o cabecalho MKV, escolhe a faixa PT e, quando o
          codec e AC3/EAC3/DTS (ou a faixa PT nao e a primeira), ativa o
          RESGATE: demux MKV em JavaScript + decodificacao via Web Audio,
          sincronizada com o video. Nenhum servidor de transcode.
   ===================================================================== */

const API_BASE = String(window.CINEP2P_API_BASE || '').replace(/\/+$/, '');
const PLACEHOLDER = '/placeholder.svg';
const NIVEIS_BONS = ['duals51', 'confirmado', 'provavel'];

const $ = function (s, r) { return (r || document).querySelector(s); };
const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

const LS = {
  get: function (k, d) { try { const v = window.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set: function (k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
  del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { } }
};

const K = { lista: 'cinep2p:lista', historico: 'cinep2p:historico', continuar: 'cinep2p:continuar', tipo: 'cinep2p:tipo' };

const state = {
  view: 'inicio',
  tipo: LS.get(K.tipo, 'movie'),
  generos: [],
  media: null,
  temporada: 1,
  episodio: 1,
  job: null,
  poll: null,
  podeTocar: false,
  streamUrl: null,
  buscaTimer: null,
  ultimoSalvar: 0,
  fontes: [],
  melhor: null,
  tentativa: 0,
  subs: [],
  legendaAtiva: null,
  total: 0,
  duracao: 0,
  mudo: false,
  volume: 1,
  esconderTimer: null,
  arrastandoSeek: false
};

const els = {
  hero: $('#hero'), rows: $('#rows'),
  searchInput: $('#searchInput'), searchResults: $('#searchResults'),
  listaGrid: $('#listaGrid'), historicoGrid: $('#historicoGrid'),
  categoriasChips: $('#categoriasChips'), categoriasGrid: $('#categoriasGrid'),
  modal: $('#modal'), modalBody: $('#modalBody'),
  toast: $('#toast'), drawer: $('#drawer'), drawerBackdrop: $('#drawerBackdrop'),
  player: $('#player'), video: $('#video'),
  pvCenter: $('#pvCenter'), pvTitle: $('#pvTitle'),
  pvMsg: $('#pvMsg'), pvStats: $('#pvStats'), pvFill: $('#pvFill'), pvFonte: $('#pvFonte'),
  pvTime: $('#pvTime'), pvProgress: $('#pvProgress'), pvKnob: $('#pvKnob'), pvSeek: $('#pvSeek'),
  pvSheet: $('#pvSheet'), pvSheetBody: $('#pvSheetBody'), pvSheetTitle: $('#pvSheetTitle'),
  icoPlay: $('#icoPlay'), icoPause: $('#icoPause'), icoVol: $('#icoVol'), icoMudo: $('#icoMudo')
};

/* ------------------------------ utils ------------------------------ */

function pad(n) { return String(n || 1).padStart(2, '0'); }

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function fmtSize(b) {
  const n = Number(b);
  if (!n || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v = v / 1024; i++; }
  return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}
function fmtSpeed(b) { const n = Number(b); return n > 0 ? fmtSize(n) + '/s' : '0 B/s'; }
function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
}
function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

let toastTimer = null;
function toast(msg, tipo) {
  els.toast.textContent = msg;
  els.toast.className = 'toast' + (tipo === 'error' ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { els.toast.classList.add('hidden'); }, 4000);
}

function url(path, params) {
  const u = new URL(API_BASE + path, API_BASE ? API_BASE + '/' : window.location.origin);
  if (params) Object.keys(params).forEach(function (k) {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  });
  return u.toString();
}

async function api(path, params) {
  const res = await fetch(url(path, params));
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) throw new Error(data.error || ('Erro HTTP ' + res.status));
  return data;
}

/* ------------------------------ cards ------------------------------ */

function cardHtml(item, opts) {
  const o = opts || {};
  const prog = (o.progresso && item.progresso)
    ? '<div class="card-progress"><i style="width:' + Math.min(100, item.progresso) + '%"></i></div>' : '';
  const img = '<img loading="lazy" src="' + esc(item.poster || item.backdrop || PLACEHOLDER) +
    '" alt="' + esc(item.titulo || '') + '" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'">';
  return '<button class="card" data-card data-id="' + esc(item.id) + '" data-tipo="' + esc(item.tipo || 'movie') + '">' +
      '<div class="card-img">' + img + prog + '</div>' +
      '<div class="card-meta"><span>' + esc(item.ano || '') + '</span>' +
      (item.nota ? '<span>&#9733; ' + item.nota.toFixed(1) + '</span>' : '') + '</div>' +
      '<div class="card-title">' + esc(item.titulo || '') + '</div>' +
    '</button>';
}

function gridHtml(itens, opts) {
  if (!itens || !itens.length) return '<p class="vazio">Nada por aqui ainda.</p>';
  return itens.map(function (i) { return cardHtml(i, opts); }).join('');
}

/* ------------------------------ views ------------------------------ */

function setView(nome) {
  state.view = nome;
  ['inicio', 'buscar', 'lista', 'historico', 'categorias'].forEach(function (v) {
    const el = $('#view-' + v);
    if (el) el.classList.toggle('hidden', v !== nome);
  });
  $$('.nav-link').forEach(function (b) { b.classList.toggle('active', b.dataset.view === nome); });
  window.scrollTo({ top: 0 });
  if (nome === 'lista') renderLista();
  if (nome === 'historico') renderHistorico();
  if (nome === 'categorias') renderCategorias();
  if (nome === 'buscar') setTimeout(function () { els.searchInput.focus(); }, 120);
}

function setTipo(tipo) {
  state.tipo = tipo === 'tv' ? 'tv' : 'movie';
  LS.set(K.tipo, state.tipo);
  $$('.tipo-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tipo === state.tipo); });
  $$('.bn-item[data-aba]').forEach(function (b) { b.classList.toggle('active', b.dataset.tipo === state.tipo); });
  els.searchInput.placeholder = state.tipo === 'tv' ? 'Buscar series...' : 'Buscar filmes...';
  api('/api/generos', { tipo: state.tipo }).then(function (g) { state.generos = g.generos || []; }).catch(function () { });
  carregarInicio();
}

function abrirDrawer() { els.drawer.classList.remove('hidden'); els.drawerBackdrop.classList.remove('hidden'); }
function fecharDrawer() { els.drawer.classList.add('hidden'); els.drawerBackdrop.classList.add('hidden'); }

/* ------------------------------- home ------------------------------ */

function skeleton() {
  let html = '';
  for (let i = 0; i < 3; i++) {
    html += '<div class="row"><div class="sk sk-title"></div><div class="scroller">';
    for (let j = 0; j < 6; j++) html += '<div class="sk sk-card"></div>';
    html += '</div></div>';
  }
  return html;
}

function renderHero(item) {
  if (!item) { els.hero.innerHTML = ''; els.hero.style.backgroundImage = 'none'; return; }
  els.hero.style.backgroundImage = 'url("' + (item.backdrop || item.poster || PLACEHOLDER) + '")';
  els.hero.innerHTML =
    '<div class="hero-inner">' +
      '<p class="hero-kicker">' + (item.tipo === 'tv' ? 'Serie em destaque' : 'Destaque de hoje') + '</p>' +
      '<h1 class="hero-title">' + esc(item.titulo) + '</h1>' +
      '<p class="hero-meta">' + esc(item.ano || '') + (item.nota ? ' &middot; &#9733; ' + item.nota.toFixed(1) : '') + '</p>' +
      '<p class="hero-sinopse">' + esc(item.sinopse || '') + '</p>' +
      '<div class="hero-actions">' +
        '<button class="btn primary" id="heroAssistir">' + (item.tipo === 'tv' ? 'Ver episodios' : 'Assistir agora') + '</button>' +
        '<button class="btn ghost" id="heroTrailer">Assistir trailer</button>' +
        '<button class="btn ghost" id="heroFavoritar">Favoritar</button>' +
      '</div>' +
    '</div>';
  $('#heroAssistir').addEventListener('click', function () {
    if (item.tipo === 'tv') abrirDetalhes('tv', item.id, false);
    else assistir(item);
  });
  $('#heroTrailer').addEventListener('click', function () { abrirDetalhes(item.tipo || 'movie', item.id, true); });
  $('#heroFavoritar').addEventListener('click', function () { alternarFavorito(item); });
}

function rowHtml(titulo, itens, opts) {
  return '<section class="row"><h2>' + esc(titulo) + '</h2><div class="scroller">' +
    itens.map(function (i) { return cardHtml(i, opts); }).join('') + '</div></section>';
}

async function carregarInicio() {
  els.rows.innerHTML = skeleton();
  try {
    const data = await api('/api/home', { tipo: state.tipo });
    renderHero(data.hero);
    let html = '';
    if (state.tipo === 'movie') {
      const continuar = LS.get(K.continuar, []);
      if (continuar.length) html += rowHtml('Continue Assistindo', continuar, { progresso: true });
    }
    data.rows.forEach(function (r) { html += rowHtml(r.titulo, r.itens, {}); });
    els.rows.innerHTML = html || '<p class="vazio">Sem resultados.</p>';
  } catch (e) {
    els.rows.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>';
    if (/TMDB_API_KEY/.test(e.message)) mostrarAviso();
    toast(e.message, 'error');
  }
}

function mostrarAviso() {
  if ($('#aviso')) return;
  const div = document.createElement('div');
  div.id = 'aviso';
  div.className = 'aviso';
  div.innerHTML = 'Configure a chave do TMDb no <code>.env</code>: <code>TMDB_API_KEY=sua_chave</code>.';
  els.rows.parentNode.insertBefore(div, els.rows);
}

/* ------------------------------ buscar ----------------------------- */

async function buscar(termo) {
  const q = String(termo || '').trim();
  if (q.length < 2) { els.searchResults.innerHTML = ''; return; }
  els.searchResults.innerHTML = '<p class="vazio">Buscando...</p>';
  try {
    const data = await api('/api/buscar', { q: q, tipo: state.tipo });
    els.searchResults.innerHTML = gridHtml(data.itens, {});
  } catch (e) { els.searchResults.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>'; }
}

/* --------------------- lista / historico / categorias -------------- */

function renderLista() { els.listaGrid.innerHTML = gridHtml(LS.get(K.lista, []), {}); }
function renderHistorico() { els.historicoGrid.innerHTML = gridHtml(LS.get(K.historico, []), { progresso: true }); }

function renderCategorias() {
  els.categoriasChips.innerHTML = state.generos.map(function (g) {
    return '<button class="chip" data-genero="' + g.id + '">' + esc(g.nome) + '</button>';
  }).join('') || '<p class="vazio">Carregando...</p>';
  $$('#categoriasChips .chip').forEach(function (b) {
    b.addEventListener('click', function () { abrirGenero(b.dataset.genero, b.textContent); });
  });
}

async function abrirGenero(id, nome) {
  els.categoriasGrid.innerHTML = '<p class="vazio">Carregando ' + esc(nome) + '...</p>';
  try {
    const data = await api('/api/filmes/genero/' + id, { tipo: state.tipo });
    els.categoriasGrid.innerHTML = gridHtml(data.itens, {});
  } catch (e) { els.categoriasGrid.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>'; }
}

function chaveItem(i) { return (i.tipo || 'movie') + ':' + i.id; }
function resumo(i) {
  return { id: i.id, tipo: i.tipo || 'movie', titulo: i.titulo, poster: i.poster, backdrop: i.backdrop, ano: i.ano, nota: i.nota };
}

function alternarFavorito(item) {
  const lista = LS.get(K.lista, []);
  const chave = chaveItem(item);
  if (lista.some(function (i) { return chaveItem(i) === chave; })) {
    LS.set(K.lista, lista.filter(function (i) { return chaveItem(i) !== chave; }));
    toast('Removido da Minha Lista');
  } else {
    lista.unshift(resumo(item));
    LS.set(K.lista, lista.slice(0, 120));
    toast('Adicionado a Minha Lista');
  }
  if (state.view === 'lista') renderLista();
}

function marcarHistorico(item, rotulo) {
  const alvo = Object.assign(resumo(item), { rotulo: rotulo || item.titulo, atualizado: Date.now() });
  const h = LS.get(K.historico, []).filter(function (i) { return chaveItem(i) !== chaveItem(item); });
  h.unshift(alvo);
  LS.set(K.historico, h.slice(0, 80));
}

function salvarProgresso() {
  if (!state.media || state.media.tipo === 'tv') return;
  const dur = els.video.duration;
  if (!dur || !isFinite(dur)) return;
  const pct = Math.min(100, (els.video.currentTime / dur) * 100);
  if (pct < 1 || pct > 98) return;
  const chave = chaveItem(state.media);
  const lista = LS.get(K.continuar, []).filter(function (i) { return chaveItem(i) !== chave; });
  lista.unshift(Object.assign(resumo(state.media), { progresso: pct, atualizado: Date.now() }));
  LS.set(K.continuar, lista.slice(0, 15));
}

/* ------------------------------ detalhes --------------------------- */

function abrirModal(html) {
  els.modalBody.innerHTML = html;
  els.modal.classList.remove('hidden');
  document.body.classList.add('no-scroll');
}
function fecharModal() {
  els.modal.classList.add('hidden');
  els.modalBody.innerHTML = '';
  if (els.player.classList.contains('hidden')) document.body.classList.remove('no-scroll');
}

async function abrirDetalhes(tipo, id, abrirTrailer) {
  abrirModal('<p class="vazio">Carregando...</p>');
  try {
    const m = await api('/api/media/' + tipo + '/' + id);
    state.media = m;
    renderDetalhes(m, abrirTrailer);
  } catch (e) { abrirModal('<p class="vazio">' + esc(e.message) + '</p>'); }
}

function renderDetalhes(m, abrirTrailer) {
  const generos = (m.generos || []).map(function (g) { return g.nome; }).join(' &middot; ');
  const elenco = (m.elenco || []).map(function (c) {
    return '<div class="elenco-item"><div class="elenco-foto">' +
      (c.foto ? '<img loading="lazy" src="' + esc(c.foto) + '" alt="' + esc(c.nome) + '" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'">' : '') +
      '</div><span>' + esc(c.nome) + '</span></div>';
  }).join('');

  const temporadas = (m.temporadas && m.temporadas.length) ? m.temporadas : [{ numero: 1, nome: 'Temporada 1' }];
  const blocoSeries = m.tipo === 'tv'
    ? '<div class="temporadas">' +
        '<label>Temporada<select id="selTemporada">' +
          temporadas.map(function (t) {
            return '<option value="' + t.numero + '">' + esc(t.nome || ('Temporada ' + t.numero)) + '</option>';
          }).join('') +
        '</select></label>' +
      '</div>' +
      '<div id="episodiosBox" class="episodios"><p class="vazio">Carregando episodios...</p></div>'
    : '';

  els.modalBody.innerHTML =
    '<div class="details" style="--bd:url(\'' + (m.backdrop || m.poster || PLACEHOLDER) + '\')">' +
      '<div class="details-top">' +
        '<div class="details-poster"><img src="' + esc(m.poster || PLACEHOLDER) + '" alt="' + esc(m.titulo) + '" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'"></div>' +
        '<div class="details-head">' +
          '<h2>' + esc(m.titulo) + '</h2>' +
          '<p class="details-meta">' + esc(m.ano || '') +
            (m.nota ? ' &middot; &#9733; ' + m.nota.toFixed(1) : '') +
            (m.duracao ? ' &middot; ' + m.duracao + ' min' : '') +
            (m.tipo === 'tv' ? ' &middot; ' + temporadas.length + ' temporada(s)' : '') + '</p>' +
          (generos ? '<p class="details-gen">' + generos + '</p>' : '') +
        '</div>' +
      '</div>' +
      '<div class="details-body">' +
        '<p class="details-sinopse">' + esc(m.sinopse || 'Sinopse nao disponivel.') + '</p>' +
        '<div class="details-actions">' +
          (m.tipo === 'tv' ? '' : '<button class="btn primary big" id="btnAssistir">Assistir agora</button>') +
          '<div class="linha">' +
            (m.trailer ? '<button class="btn ghost" id="btnTrailer">Trailer</button>' : '') +
            '<button class="btn ghost" id="btnFavoritar">Favoritar</button>' +
            (m.imdbId ? '<a class="btn ghost" target="_blank" rel="noreferrer" href="https://www.imdb.com/title/' + esc(m.imdbId) + '/">IMDb</a>' : '') +
          '</div>' +
        '</div>' +
        blocoSeries +
        (elenco ? '<div class="elenco"><h3>Elenco</h3><div class="elenco-list">' + elenco + '</div></div>' : '') +
      '</div>' +
    '</div>';

  if ($('#btnAssistir')) $('#btnAssistir').addEventListener('click', function () { fecharModal(); assistir(m); });
  if ($('#btnTrailer')) $('#btnTrailer').addEventListener('click', function () { mostrarTrailer(m.trailer); });
  $('#btnFavoritar').addEventListener('click', function () { alternarFavorito(m); });
  if (abrirTrailer && m.trailer) mostrarTrailer(m.trailer);

  if (m.tipo === 'tv') {
    $('#selTemporada').addEventListener('change', function () { carregarTemporada(m, Number(this.value)); });
    carregarTemporada(m, temporadas[0].numero);
  }
}

async function carregarTemporada(m, numero) {
  const box = $('#episodiosBox');
  if (!box) return;
  box.innerHTML = '<p class="vazio">Carregando episodios...</p>';
  try {
    const d = await api('/api/serie/' + m.id + '/temporada/' + numero);
    if (!d.episodios.length) { box.innerHTML = '<p class="vazio">Temporada sem episodios cadastrados.</p>'; return; }
    box.innerHTML = d.episodios.map(function (ep) {
      return '<button class="episodio" data-ep="' + ep.numero + '">' +
          '<div class="ep-thumb">' +
            (ep.imagem ? '<img loading="lazy" src="' + esc(ep.imagem) + '" alt="" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'">' : '') +
            '<span class="ep-play">&#9654;</span>' +
          '</div>' +
          '<div class="ep-info">' +
            '<strong><span class="ep-num">E' + pad(ep.numero) + '</span>' + esc(ep.titulo) + '</strong>' +
            '<span class="ep-meta">' + (ep.duracao ? ep.duracao + ' min' : '') + (ep.data ? ' &middot; ' + esc(ep.data) : '') + '</span>' +
            '<p>' + esc(ep.sinopse || 'Sinopse nao disponivel.') + '</p>' +
          '</div>' +
        '</button>';
    }).join('');

    $$('#episodiosBox .episodio').forEach(function (b) {
      b.addEventListener('click', function () {
        const ep = Number(b.dataset.ep);
        const rotulo = m.titulo + ' S' + pad(numero) + 'E' + pad(ep);
        fecharModal();
        assistir(m, { temporada: numero, episodio: ep, rotulo: rotulo });
      });
    });
  } catch (e) { box.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>'; }
}

function mostrarTrailer(trailer) {
  if (!trailer) return;
  const box = document.createElement('div');
  box.className = 'trailer';
  box.innerHTML = '<iframe src="https://www.youtube.com/embed/' + esc(trailer.key) +
    '?autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
  els.modalBody.appendChild(box);
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* =========================== DEMUX MKV ============================== */

const EBML = {
  SEG: 0x18538067, INFO: 0x1549A966, TRACKS: 0x1654AE6B, ENTRY: 0xAE,
  TRACKNUM: 0xD7, TRACKTYPE: 0x83, CODECID: 0x86, CODECPRIV: 0x63A2,
  LANG: 0x22B59C, LANG2: 0x22B59D, AUDIO: 0xE1, CHANNELS: 0x9F,
  CLUSTER: 0x1F43B675, TIMECODE: 0xE7, SIMPLEBLOCK: 0xA3, BLOCKGROUP: 0xA0, BLOCK: 0xA1,
  SCALE: 0x2AD7B1, HEADER: 0x1A45DFA3
};

function criarParserMkv(cb) {
  let buf = new Uint8Array(0);
  let pos = 0;
  const fins = [];
  const tipos = [];
  let escala = 1000000;
  let tsCluster = 0;
  let entry = {};
  let modoSimples = false;
  let sincronizado = false;
  let ligado = true;

  function lerId(p) {
    if (p >= buf.length) return null;
    const b0 = buf[p];
    if (b0 === 0) return null;
    let n = 1;
    if (!(b0 & 0x80)) {
      if (b0 & 0x40) n = 2; else if (b0 & 0x20) n = 3; else if (b0 & 0x10) n = 4; else return null;
    }
    if (p + n > buf.length) return null;
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + buf[p + i];
    return { v: v, n: n };
  }

  function lerTam(p) {
    if (p >= buf.length) return null;
    const b0 = buf[p];
    if (b0 === 0) return null;
    let n = 1, mask = 0x80;
    while (n <= 8 && !(b0 & mask)) { mask >>= 1; n++; }
    if (n > 8 || p + n > buf.length) return null;
    let v = b0 & (mask - 1);
    let todosFf = ((b0 & (mask - 1)) === (mask - 1));
    for (let i = 1; i < n; i++) {
      v = v * 256 + buf[p + i];
      if (buf[p + i] !== 0xFF) todosFf = false;
    }
    return { v: v, n: n, desconhecido: todosFf };
  }

  function uint(p, fim) {
    if (fim > buf.length) return null;
    let v = 0;
    for (let i = p; i < fim; i++) v = v * 256 + buf[i];
    return v;
  }

  function texto(p, fim) {
    if (fim > buf.length) return null;
    let s = '';
    for (let i = p; i < fim; i++) { const c = buf[i]; if (c >= 32 && c < 127) s += String.fromCharCode(c); }
    return s.trim();
  }

  function finalizarEntry() {
    if (entry && entry.n && entry.tipo === 2 && cb.aoFaixa) {
      cb.aoFaixa({
        numero: entry.n,
        lang: (entry.lang || '').toLowerCase(),
        codec: entry.codec || '',
        canais: entry.canais || 0,
        codecPrivado: entry.codecPrivado || null
      });
    }
    entry = {};
  }

  function blocos(p, fim) {
    const tn = lerTam(p);
    if (!tn) return;
    let off = p + tn.n;
    if (off + 3 > fim) return;
    let ts = (buf[off] << 8) | buf[off + 1];
    if (ts & 0x8000) ts -= 0x10000;
    off += 2;
    const flags = buf[off]; off++;
    const lace = (flags >> 1) & 3;
    const partes = [];

    if (lace === 0) {
      partes.push([off, fim]);
    } else {
      const n = buf[off] + 1; off++;
      const tamanhos = [];
      if (lace === 1) {
        let total = 0;
        for (let i = 0; i < n - 1; i++) {
          let s = 0, b;
          do { b = buf[off++]; s += b; } while (b === 255 && off < fim);
          tamanhos.push(s); total += s;
        }
        tamanhos.push(Math.max(0, fim - off - total));
      } else if (lace === 3) {
        const s0 = lerTam(off);
        if (!s0) return;
        off += s0.n;
        tamanhos.push(s0.v);
        let total = s0.v;
        for (let i = 1; i < n - 1; i++) {
          const d = lerTam(off);
          if (!d) return;
          off += d.n;
          const dv = d.v - Math.pow(2, 7 * d.n - 1) + 1;
          tamanhos.push(dv); total += dv;
        }
        tamanhos.push(Math.max(0, fim - off - total));
      } else {
        const t = Math.floor((fim - off) / n);
        for (let i = 0; i < n; i++) tamanhos.push(t);
      }
      let cur = off;
      tamanhos.forEach(function (t) { partes.push([cur, cur + t]); cur += t; });
    }

    const tsSeg = (tsCluster + ts) * escala / 1e9;
    partes.forEach(function (pp) {
      if (pp[1] > pp[0] && cb.aoFrame) cb.aoFrame(tn.v, tsSeg, buf.subarray(pp[0], pp[1]));
    });
  }

  function processar() {
    let voltas = 0;
    while (ligado && voltas++ < 200000) {
      while (fins.length && pos >= fins[fins.length - 1]) {
        const t = tipos.pop(); fins.pop();
        if (t === 'entry') finalizarEntry();
      }
      if (buf.length - pos < 2) break;

      if (modoSimples && !sincronizado) {
        let achou = -1;
        for (let i = pos; i + 4 <= buf.length; i++) {
          if (buf[i] === 0x1F && buf[i + 1] === 0x43 && buf[i + 2] === 0xB6 && buf[i + 3] === 0x75) { achou = i; break; }
        }
        if (achou < 0) { pos = Math.max(pos, buf.length - 3); break; }
        pos = achou;
        sincronizado = true;
      }

      const id = lerId(pos);
      if (!id) break;
      const tam = lerTam(pos + id.n);
      if (!tam) break;

      const idv = id.v;
      const ini = pos + id.n + tam.n;
      const fim = tam.desconhecido ? Infinity : ini + tam.v;

      if (idv === EBML.CLUSTER) { tsCluster = 0; pos = ini; fins.push(fim); tipos.push('cluster'); continue; }
      if (idv === EBML.SEG || idv === EBML.HEADER) { pos = ini; fins.push(fim); tipos.push('seg'); continue; }
      if (idv === EBML.INFO) { pos = ini; fins.push(fim); tipos.push('info'); continue; }
      if (!modoSimples && idv === EBML.TRACKS) { pos = ini; fins.push(fim); tipos.push('tracks'); continue; }
      if (!modoSimples && idv === EBML.ENTRY) { entry = {}; pos = ini; fins.push(fim); tipos.push('entry'); continue; }
      if (idv === EBML.AUDIO) { pos = ini; fins.push(fim); tipos.push('audio'); continue; }
      if (idv === EBML.BLOCKGROUP) { pos = ini; fins.push(fim); tipos.push('bg'); continue; }

      if (idv === EBML.SCALE) { const r = uint(ini, fim); if (r === null) break; escala = r || escala; pos = fim; continue; }
      if (idv === EBML.TIMECODE) { const r = uint(ini, fim); if (r === null) break; tsCluster = r; pos = fim; continue; }

      if (!modoSimples && idv === EBML.TRACKNUM) { const r = uint(ini, fim); if (r === null) break; entry.n = r; pos = fim; continue; }
      if (!modoSimples && idv === EBML.TRACKTYPE) { const r = uint(ini, fim); if (r === null) break; entry.tipo = r; pos = fim; continue; }
      if (!modoSimples && idv === EBML.CHANNELS) { const r = uint(ini, fim); if (r === null) break; entry.canais = r; pos = fim; continue; }
      if (!modoSimples && idv === EBML.CODECID) { const r = texto(ini, fim); if (r === null) break; entry.codec = r; pos = fim; continue; }
      if (!modoSimples && (idv === EBML.LANG || idv === EBML.LANG2)) { const r = texto(ini, fim); if (r === null) break; if (!entry.lang) entry.lang = r; pos = fim; continue; }
      if (!modoSimples && idv === EBML.CODECPRIV) { if (fim > buf.length) break; entry.codecPrivado = buf.subarray(ini, fim); pos = fim; continue; }

      if (idv === EBML.SIMPLEBLOCK || idv === EBML.BLOCK) {
        if (fim > buf.length) break;
        blocos(ini, fim);
        pos = fim;
        continue;
      }

      if (fim === Infinity) { pos = ini; fins.push(fim); tipos.push('x'); continue; }
      if (fim > buf.length) break;
      pos = fim;
    }

    if (pos > 0) { buf = buf.subarray(pos); pos = 0; }
  }

  return {
    empurrar: function (dados) {
      if (!ligado) return;
      const novo = new Uint8Array(buf.length + dados.length);
      novo.set(buf, 0);
      novo.set(dados, buf.length);
      buf = novo;
      processar();
    },
    modoSimples: function () { modoSimples = true; sincronizado = false; },
    desligar: function () { ligado = false; }
  };
}

function juntarBytes(lista) {
  let total = 0;
  lista.forEach(function (b) { total += b.length; });
  const out = new Uint8Array(total);
  let p = 0;
  lista.forEach(function (b) { out.set(b, p); p += b.length; });
  return out;
}

function comAdts(frame, asc) {
  if (!asc || asc.length < 2) return frame;
  const objType = (asc[0] >> 3) & 0x1F;
  const perfil = Math.max(0, objType - 1);
  const freq = ((asc[0] & 0x07) << 1) | ((asc[1] >> 7) & 0x01);
  const canais = (asc[1] >> 3) & 0x0F;
  const tam = frame.length + 7;
  const h = new Uint8Array(7);
  h[0] = 0xFF; h[1] = 0xF1;
  h[2] = (perfil << 6) | (freq << 2) | ((canais >> 2) & 1);
  h[3] = ((canais & 3) << 6) | ((tam >> 11) & 3);
  h[4] = (tam >> 3) & 0xFF;
  h[5] = ((tam & 7) << 5) | 0x1F;
  h[6] = 0xFC;
  const out = new Uint8Array(tam);
  out.set(h, 0);
  out.set(frame, 7);
  return out;
}

/* ========================== RESGATE DE AUDIO ======================== */

const audio = {
  ctx: null,
  ganho: null,
  ativo: false,
  abort: null,
  leitor: null,
  parser: null,
  trackNum: 0,
  asc: null,
  aac: false,
  pendente: [],
  pendenteTs: 0,
  pendenteTam: 0,
  fila: [],
  fontes: [],
  ultimoTs: 0,
  processando: false,
  falhas: 0,
  info: null
};

function pararResgate() {
  audio.ativo = false;
  if (audio.abort) { try { audio.abort.abort(); } catch (e) { } audio.abort = null; }
  if (audio.parser) { audio.parser.desligar(); audio.parser = null; }
  audio.fontes.forEach(function (s) { try { s.stop(); } catch (e) { } });
  audio.fontes = [];
  audio.fila = [];
  audio.pendente = [];
  audio.pendenteTam = 0;
  audio.pendenteTs = 0;
  audio.ultimoTs = 0;
  audio.leitor = null;
}

function volumeAplicado() {
  return state.mudo ? 0 : state.volume;
}

async function analisarCabecalho() {
  const alvo = API_BASE + state.streamUrl;
  const res = await fetch(alvo, { headers: { Range: 'bytes=0-1048575' } });
  const dados = new Uint8Array(await res.arrayBuffer());
  const info = { container: '?', audio: [] };
  if (dados.length > 8 && dados[0] === 0x1A && dados[1] === 0x45 && dados[2] === 0xDF && dados[3] === 0xA3) info.container = 'mkv';
  else if (dados.length > 12 && dados[4] === 0x66 && dados[5] === 0x74 && dados[6] === 0x79 && dados[7] === 0x70) info.container = 'mp4';
  if (info.container !== 'mkv') return info;

  const parser = criarParserMkv({
    aoFaixa: function (f) { info.audio.push(f); },
    aoFrame: function () { }
  });
  parser.empurrar(dados);
  parser.desligar();
  return info;
}

function decidirResgate(info) {
  if (!info || info.container !== 'mkv') return false;
  const faixas = info.audio || [];
  if (!faixas.length) return false;

  const pt = faixas.filter(function (f) { return /por|pt|bra|portugu/.test(f.lang); })[0];
  const alvo = pt || faixas[0];
  const codec = String(alvo.codec || '').toLowerCase();

  const seguro = /(a_aac|aac|a_mp3|mp3|a_opus|a_vorbis|a_flac|a_ac3|eac3|ec-3)/.test(codec);
  const problematico = /(dts|dca|truehd|mlp|pcm|lpcm|a_real)/.test(codec);
  const primeiro = faixas[0] === alvo;

  if (problematico) return true;
  if (!primeiro) return true;
  if (!seguro) return true;
  return false;
}

async function iniciarResgate(info, inicioBytes) {
  pararResgate();

  const faixas = info.audio || [];
  const pt = faixas.filter(function (f) { return /por|pt|bra|portugu/.test(f.lang); })[0];
  const alvo = pt || faixas[0];
  if (!alvo) return;

  audio.info = info;
  audio.trackNum = alvo.numero;
  audio.asc = alvo.codecPrivado || null;
  audio.aac = /aac/i.test(alvo.codec || '');

  if (!audio.ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio.ctx = new Ctx();
    audio.ganho = audio.ctx.createGain();
    audio.ganho.gain.value = volumeAplicado();
    audio.ganho.connect(audio.ctx.destination);
  }
  try { if (audio.ctx.state === 'suspended') await audio.ctx.resume(); } catch (e) { }

  const ctrl = new AbortController();
  audio.abort = ctrl;
  audio.ativo = true;
  audio.falhas = 0;
  audio.ultimoTs = 0;

  const parser = criarParserMkv({
    aoFaixa: function () { },
    aoFrame: function (tn, ts, bytes) {
      if (tn !== audio.trackNum) return;
      if (ts + 0.4 < els.video.currentTime - 1) return;
      let b = bytes;
      if (audio.aac) b = comAdts(bytes, audio.asc);
      if (audio.pendenteTs === 0) audio.pendenteTs = ts;
      audio.pendente.push(new Uint8Array(b));
      audio.pendenteTam += b.length;
      if (ts - audio.pendenteTs >= 0.45) descarregar();
    }
  });
  if (inicioBytes > 0) parser.modoSimples();
  audio.parser = parser;

  try {
    const res = await fetch(API_BASE + state.streamUrl, {
      headers: { Range: 'bytes=' + inicioBytes + '-' },
      signal: ctrl.signal
    });
    if (!res.body) throw new Error('sem corpo');
    audio.leitor = res.body.getReader();
  } catch (e) {
    audio.ativo = false;
    return;
  }

  while (audio.ativo) {
    if (audio.ultimoTs - els.video.currentTime > 12) { await esperar(150); continue; }
    let r;
    try { r = await audio.leitor.read(); } catch (e) { break; }
    if (r.done) break;
    parser.empurrar(r.value);
  }
}

function descarregar() {
  if (!audio.pendente.length) return;
  const dados = juntarBytes(audio.pendente);
  const ts = audio.pendenteTs;
  audio.pendente = [];
  audio.pendenteTam = 0;
  audio.pendenteTs = 0;
  audio.fila.push({ ts: ts, dados: dados });
  processarFila();
}

async function processarFila() {
  if (audio.processando) return;
  audio.processando = true;
  while (audio.fila.length && audio.ativo) {
    const item = audio.fila.shift();
    if (item.ts + 1 < els.video.currentTime - 0.5) continue;
    try {
      const copia = item.dados.slice(0);
      const buf = await audio.ctx.decodeAudioData(copia.buffer);
      agendar(item.ts, buf);
      audio.falhas = 0;
      if (els.video.muted !== true && audio.fontes.length === 1) {
        els.video.muted = true;
        audio.ganho.gain.value = volumeAplicado();
      }
    } catch (e) {
      audio.falhas++;
      if (audio.falhas > 12) { audio.ativo = false; els.video.muted = false; }
    }
  }
  audio.processando = false;
}

function agendar(ts, buf) {
  const agora = audio.ctx.currentTime;
  let quando = agora + (ts - els.video.currentTime);
  if (quando < agora + 0.02) quando = agora + 0.02;
  const src = audio.ctx.createBufferSource();
  src.buffer = buf;
  src.connect(audio.ganho);
  try { src.start(quando); } catch (e) { return; }
  audio.fontes.push(src);
  audio.ultimoTs = Math.max(audio.ultimoTs, ts + buf.duration);
  src.onended = function () {
    const i = audio.fontes.indexOf(src);
    if (i >= 0) audio.fontes.splice(i, 1);
  };
}

function byteEstimado(t) {
  const dur = els.video.duration;
  if (!dur || !isFinite(dur) || !state.total) return 0;
  return Math.max(0, Math.floor((t / dur) * state.total));
}

async function reiniciarResgate() {
  if (!audio.info) return;
  const t = els.video.currentTime;
  pararResgate();
  audio.fontes.forEach(function (s) { try { s.stop(); } catch (e) { } });
  audio.fontes = [];
  await iniciarResgate(audio.info, byteEstimado(t));
}

/* =============================== PLAYER ============================ */

function abrirPlayer(titulo) {
  state.podeTocar = false;
  state.streamUrl = null;
  state.subs = [];
  state.legendaAtiva = null;
  state.tentativa = 0;
  pararResgate();
  els.video.removeAttribute('src');
  $$('#video track').forEach(function (t) { t.remove(); });
  els.video.load();
  els.pvTitle.textContent = titulo || 'Reproduzindo';
  els.pvCenter.classList.remove('oculto');
  els.pvMsg.textContent = 'Buscando fontes DUAL 5.1 PT-BR...';
  els.pvStats.textContent = '';
  els.pvFonte.textContent = '';
  els.pvFill.style.width = '0%';
  els.pvProgress.style.width = '0%';
  els.pvKnob.style.left = '0%';
  els.pvTime.textContent = '0:00 / 0:00';
  els.pvSheet.classList.add('hidden');
  els.player.classList.remove('hidden', 'controles-ocultos');
  document.body.classList.add('no-scroll');
  mostrarControles();
}

function fecharPlayer() {
  if (state.job) {
    const jobId = state.job;
    state.job = null;
    fetch(url('/api/play/stop', { jobId: jobId }), { keepalive: true }).catch(function () { });
  }
  clearTimeout(state.poll);
  clearTimeout(state.esconderTimer);
  pararResgate();
  try { els.video.pause(); } catch (e) { }
  els.video.removeAttribute('src');
  els.video.load();
  els.player.classList.add('hidden');
  els.player.classList.remove('controles-ocultos');
  document.body.classList.remove('no-scroll');
  if (state.view === 'inicio') carregarInicio();
}

async function assistir(media, extra) {
  const ex = extra || {};
  state.media = media;
  state.temporada = ex.temporada || 1;
  state.episodio = ex.episodio || 1;
  marcarHistorico(media, ex.rotulo);
  abrirPlayer(ex.rotulo || media.titulo);

  const params = {
    titulo: media.titulo,
    tituloOriginal: media.tituloOriginal,
    ano: media.ano,
    imdbId: media.imdbId,
    tmdbId: media.id,
    tipo: media.tipo,
    temporada: state.temporada,
    episodio: state.episodio
  };

  try {
    const data = await api('/api/torrent', params);
    state.fontes = data.fontes || [];
    state.melhor = data.melhor;
    if (!state.melhor) { erroPlayer('Nenhum torrent encontrado para este titulo.'); return; }
    els.pvFonte.textContent = state.melhor.source + ' - ' +
      (state.melhor.ptbr ? state.melhor.ptbr.audio : '') + ' - ' + state.melhor.seeders + ' seeds';
    iniciarJob(state.melhor);
  } catch (e) { erroPlayer(e.message); }
}

async function iniciarJob(fonte) {
  if (!fonte) return;
  if (state.job) {
    const antigo = state.job;
    state.job = null;
    fetch(url('/api/play/stop', { jobId: antigo }), { keepalive: true }).catch(function () { });
  }
  clearTimeout(state.poll);
  state.podeTocar = false;
  state.legendaAtiva = null;
  state.subs = [];
  pararResgate();
  els.video.removeAttribute('src');
  $$('#video track').forEach(function (t) { t.remove(); });
  els.video.load();
  els.pvCenter.classList.remove('oculto');
  els.pvMsg.textContent = 'Conectando aos peers...';
  els.pvFill.style.width = '0%';

  try {
    const data = await api('/api/play', {
      magnet: fonte.magnet, fileIdx: fonte.fileIdx, titulo: fonte.title, qualidade: fonte.quality
    });
    state.job = data.jobId;
    poll();
  } catch (e) { erroPlayer(e.message); }
}

function proximaFonte() {
  const atual = state.melhor;
  const idx = state.fontes.findIndex(function (f) { return atual && f.hash === atual.hash; });
  return state.fontes[idx + 1] || null;
}

function erroPlayer(msg, permitirTroca) {
  clearTimeout(state.poll);

  if (permitirTroca !== false && state.tentativa < 3) {
    const proxima = proximaFonte();
    if (proxima) {
      state.tentativa += 1;
      state.melhor = proxima;
      els.pvCenter.classList.remove('oculto');
      els.pvMsg.textContent = 'Fonte sem peer. Tentando outra (' + state.tentativa + '/3)...';
      els.pvStats.textContent = proxima.title;
      els.pvFonte.textContent = proxima.source + ' - ' + proxima.seeders + ' seeds';
      iniciarJob(proxima);
      return;
    }
  }

  els.pvCenter.classList.remove('oculto');
  els.pvCenter.innerHTML =
    '<p class="pv-erro">' + esc(msg) + '</p>' +
    '<button class="btn small" id="pvOutraFonte">Escolher outra fonte</button>' +
    '<button class="btn small ghost" id="pvSair">Sair</button>';
  $('#pvOutraFonte').addEventListener('click', abrirSheetFontes);
  $('#pvSair').addEventListener('click', fecharPlayer);
}

let analiseEmCurso = false;

function atualizarOverlay(s) {
  if (s.total) state.total = s.total;

  if (s.canPlay && !state.podeTocar) {
    state.podeTocar = true;
    state.streamUrl = s.streamUrl;
    els.video.src = API_BASE + s.streamUrl;
    const p = els.video.play();
    if (p && p.catch) p.catch(function () { });
    carregarLegendas();
    if (!analiseEmCurso) {
      analiseEmCurso = true;
      analisarCabecalho().then(function (info) {
        if (decidirResgate(info)) iniciarResgate(info, 0);
      }).catch(function () { }).then(function () { analiseEmCurso = false; });
    }
  }

  els.pvFill.style.width = Math.max(2, Math.min(100, s.buffer || 0)).toFixed(0) + '%';

  if (!state.podeTocar) {
    els.pvMsg.textContent = s.message || 'Conectando aos peers...';
    els.pvStats.textContent = (s.buffer || 0).toFixed(1) + '% | ' + s.peers + ' peers | ' +
      fmtSpeed(s.speed) + ' | ' + fmtSize(s.downloaded) + ' de ' + fmtSize(s.total);
  } else {
    els.pvMsg.textContent = 'Iniciando...';
    els.pvStats.textContent = s.peers + ' peers | ' + fmtSpeed(s.speed);
  }
}

async function poll() {
  if (!state.job) return;
  try {
    const s = await api('/api/play/status', { jobId: state.job });
    atualizarOverlay(s);
    if (s.state === 'erro') { erroPlayer(s.message); return; }
  } catch (e) { erroPlayer(e.message); return; }
  state.poll = setTimeout(poll, state.podeTocar ? 2500 : 700);
}

/* ----------------------------- legendas ---------------------------- */

async function carregarLegendas() {
  if (!state.job) return;
  try {
    const data = await api('/api/play/subs', { jobId: state.job });
    state.subs = data.subs || [];
    if (state.subs.length) {
      const pt = state.subs.filter(function (s) { return s.code === 'pt-BR'; })[0];
      aplicarLegenda(pt ? pt.idx : null);
    }
  } catch (e) { }
}

function aplicarLegenda(idx) {
  $$('#video track').forEach(function (t) { t.remove(); });
  state.legendaAtiva = idx;
  if (idx === null || idx === undefined) return;
  const s = state.subs.filter(function (x) { return x.idx === idx; })[0];
  if (!s) return;
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = s.label;
  track.srclang = s.code;
  track.src = API_BASE + '/api/play/subtitle?jobId=' + state.job + '&idx=' + s.idx;
  track.default = true;
  els.video.appendChild(track);
  setTimeout(function () { try { if (track.track) track.track.mode = 'showing'; } catch (e) { } }, 120);
}

/* ------------------------------ sheets ----------------------------- */

function abrirSheet(titulo, html) {
  els.pvSheetTitle.textContent = titulo;
  els.pvSheetBody.innerHTML = html;
  els.pvSheet.classList.remove('hidden');
  mostrarControles();
}

function abrirSheetFontes() {
  if (!state.fontes.length) { abrirSheet('Fontes', '<p class="pv-vazio">Nenhuma fonte carregada.</p>'); return; }
  const html = state.fontes.map(function (f, i) {
    const atual = state.melhor && f.hash === state.melhor.hash ? ' atual' : '';
    const nivel = f.ptbr ? f.ptbr.nivel : 'desconhecido';
    const cls = NIVEIS_BONS.indexOf(nivel) !== -1 ? 'br' : (nivel === 'estrangeiro' ? 'ruim' : '');
    return '<div class="pv-fonte-item' + atual + '" data-fonte-idx="' + i + '">' +
        '<div><div class="pv-fonte-nome">' + esc(f.title) + '</div>' +
          '<div class="pv-fonte-tags">' +
            '<span class="pv-badge">' + esc(f.quality || 'SD') + '</span>' +
            '<span class="pv-badge ' + cls + '">' + esc(f.ptbr ? f.ptbr.audio : '') + '</span>' +
            (f.size ? '<span>' + esc(f.size) + '</span>' : '') +
            '<span>' + f.seeders + ' seeds</span><span>' + esc(f.source) + '</span>' +
          '</div>' +
        '</div>' +
        '<button class="btn small' + (atual ? ' primary' : '') + '">' + (atual ? 'Atual' : 'Usar') + '</button>' +
      '</div>';
  }).join('');
  abrirSheet('Fontes (' + state.fontes.length + ')', html);
  $$('#pvSheetBody [data-fonte-idx]').forEach(function (n) {
    n.addEventListener('click', function () {
      const f = state.fontes[Number(n.dataset.fonteIdx)];
      state.melhor = f;
      state.tentativa = 0;
      els.pvSheet.classList.add('hidden');
      els.pvFonte.textContent = f.source + ' - ' + (f.ptbr ? f.ptbr.audio : '') + ' - ' + f.seeders + ' seeds';
      iniciarJob(f);
    });
  });
}

function abrirSheetLegendas() {
  if (!state.subs.length) { abrirSheet('Legendas', '<p class="pv-vazio">Nenhuma legenda dentro do torrent.</p>'); return; }
  const itens = [{ idx: null, label: 'Desativado', code: '' }].concat(state.subs);
  const html = itens.map(function (s) {
    const atual = (state.legendaAtiva === s.idx) ? ' atual' : '';
    return '<div class="pv-legenda-item' + atual + '" data-legenda="' + (s.idx === null ? '' : s.idx) + '">' +
      '<span>' + esc(s.label) + '</span><span>' + esc(s.code) + '</span></div>';
  }).join('');
  abrirSheet('Legendas', html);
  $$('#pvSheetBody [data-legenda]').forEach(function (n) {
    n.addEventListener('click', function () {
      const v = n.dataset.legenda;
      aplicarLegenda(v === '' ? null : Number(v));
      els.pvSheet.classList.add('hidden');
      toast(v === '' ? 'Legenda desativada' : 'Legenda ativada');
    });
  });
}

/* ----------------------------- controles --------------------------- */

function mostrarControles() {
  els.player.classList.remove('controles-ocultos');
  clearTimeout(state.esconderTimer);
  state.esconderTimer = setTimeout(function () {
    if (!els.video.paused && els.pvSheet.classList.contains('hidden')) els.player.classList.add('controles-ocultos');
  }, 3400);
}

function alternarPlay() {
  if (els.video.paused) { const p = els.video.play(); if (p && p.catch) p.catch(function () { }); }
  else els.video.pause();
}

function pular(segundos) {
  if (!isFinite(els.video.duration)) return;
  els.video.currentTime = Math.max(0, Math.min(els.video.duration - 1, els.video.currentTime + segundos));
  mostrarControles();
}

function atualizarTempo() {
  const dur = isFinite(els.video.duration) ? els.video.duration : 0;
  const atual = els.video.currentTime || 0;
  const pct = dur ? Math.min(100, (atual / dur) * 100) : 0;
  els.pvProgress.style.width = pct + '%';
  els.pvKnob.style.left = pct + '%';
  els.pvTime.textContent = fmtTime(atual) + ' / ' + fmtTime(dur);
}

function seekPara(clientX) {
  const r = els.pvSeek.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  if (isFinite(els.video.duration)) els.video.currentTime = pct * els.video.duration;
}

/* ------------------------------ wiring ----------------------------- */

function wire() {
  $('#menuBtn').addEventListener('click', abrirDrawer);
  $('#drawerClose').addEventListener('click', fecharDrawer);
  els.drawerBackdrop.addEventListener('click', fecharDrawer);

  $$('.nav-link').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.dataset.view); fecharDrawer(); });
  });

  $$('.tipo-tab').forEach(function (b) {
    b.addEventListener('click', function () { setTipo(b.dataset.tipo); setView('inicio'); fecharDrawer(); });
  });

  $$('.bn-item').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.aba) setTipo(b.dataset.tipo);
      setView(b.dataset.view);
      $$('.bn-item').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      fecharDrawer();
    });
  });

  $('#brand').addEventListener('click', function (e) { e.preventDefault(); setView('inicio'); });
  $('#searchBtn').addEventListener('click', function () { setView('buscar'); });

  $('#searchGo').addEventListener('click', function () { buscar(els.searchInput.value); });
  els.searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') buscar(els.searchInput.value); });
  els.searchInput.addEventListener('input', function () {
    clearTimeout(state.buscaTimer);
    state.buscaTimer = setTimeout(function () { buscar(els.searchInput.value); }, 420);
  });

  $('#limparHistorico').addEventListener('click', function () {
    LS.del(K.historico); LS.del(K.continuar); renderHistorico(); toast('Historico limpo');
  });

  document.addEventListener('click', function (e) {
    const card = e.target.closest('[data-card]');
    if (card) { abrirDetalhes(card.dataset.tipo, card.dataset.id, false); return; }
    const gen = e.target.closest('[data-genero]');
    if (gen) { abrirGenero(gen.dataset.genero, gen.textContent); return; }
    if (e.target.closest('[data-close]')) fecharModal();
  });

  $('#pvClose').addEventListener('click', fecharPlayer);
  $('#pvFontes').addEventListener('click', abrirSheetFontes);
  $('#pvSheetClose').addEventListener('click', function () { els.pvSheet.classList.add('hidden'); });
  $('#pvPlay').addEventListener('click', alternarPlay);
  $('#pvBack30').addEventListener('click', function () { pular(-30); });
  $('#pvFwd30').addEventListener('click', function () { pular(30); });
  $('#pvCC').addEventListener('click', abrirSheetLegendas);

  $('#pvMute').addEventListener('click', function () {
    state.mudo = !state.mudo;
    els.icoVol.classList.toggle('hidden', state.mudo);
    els.icoMudo.classList.toggle('hidden', !state.mudo);
    if (audio.ativo && audio.ganho) audio.ganho.gain.value = volumeAplicado();
    else els.video.muted = state.mudo;
  });

  $('#pvFull').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (els.player.requestFullscreen) els.player.requestFullscreen();
    else if (els.video.webkitEnterFullscreen) els.video.webkitEnterFullscreen();
  });

  els.pvSeek.addEventListener('pointerdown', function (e) {
    state.arrastandoSeek = true;
    try { els.pvSeek.setPointerCapture(e.pointerId); } catch (err) { }
    seekPara(e.clientX);
  });
  els.pvSeek.addEventListener('pointermove', function (e) { if (state.arrastandoSeek) seekPara(e.clientX); });
  els.pvSeek.addEventListener('pointerup', function () { state.arrastandoSeek = false; });
  els.pvSeek.addEventListener('pointercancel', function () { state.arrastandoSeek = false; });

  els.player.addEventListener('pointermove', mostrarControles);
  els.player.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.pv-bottom') || e.target.closest('.pv-top') || e.target.closest('.pv-sheet')) { mostrarControles(); return; }
    if (!els.player.classList.contains('controles-ocultos')) els.player.classList.add('controles-ocultos');
    else mostrarControles();
  });

  els.video.addEventListener('loadedmetadata', atualizarTempo);
  els.video.addEventListener('play', function () {
    els.icoPlay.classList.add('hidden'); els.icoPause.classList.remove('hidden'); mostrarControles();
    if (audio.ctx && audio.ctx.state === 'suspended') { try { audio.ctx.resume(); } catch (e) { } }
  });
  els.video.addEventListener('pause', function () {
    els.icoPlay.classList.remove('hidden'); els.icoPause.classList.add('hidden'); mostrarControles();
    if (audio.ctx && audio.ctx.state === 'running') { try { audio.ctx.suspend(); } catch (e) { } }
  });
  els.video.addEventListener('playing', function () {
    els.pvCenter.classList.add('oculto'); mostrarControles();
  });
  els.video.addEventListener('waiting', function () {
    if (state.podeTocar) {
      els.pvCenter.classList.remove('oculto');
      els.pvMsg.textContent = 'Carregando mais dados...';
      els.pvStats.textContent = '';
    }
  });
  els.video.addEventListener('timeupdate', function () {
    atualizarTempo();
    const agora = Date.now();
    if (agora - state.ultimoSalvar < 5000) return;
    state.ultimoSalvar = agora;
    salvarProgresso();
  });
  els.video.addEventListener('seeked', function () {
    if (audio.ativo) reiniciarResgate();
  });
  els.video.addEventListener('error', function () {
    if (state.podeTocar) toast('Falha na reproducao. Use Fontes para trocar.', 'error');
  });

  document.addEventListener('keydown', function (e) {
    if (!els.player.classList.contains('hidden')) {
      if (e.key === 'Escape') fecharPlayer();
      if (e.key === ' ') { e.preventDefault(); alternarPlay(); }
      if (e.key === 'ArrowLeft') pular(-30);
      if (e.key === 'ArrowRight') pular(30);
      if (e.key === 'f' || e.key === 'F') $('#pvFull').click();
      return;
    }
    if (e.key === 'Escape') { if (!els.modal.classList.contains('hidden')) fecharModal(); else fecharDrawer(); }
  });

  window.addEventListener('pagehide', function () {
    if (state.job) {
      const u = url('/api/play/stop', { jobId: state.job });
      if (navigator.sendBeacon) navigator.sendBeacon(u); else fetch(u, { keepalive: true }).catch(function () { });
    }
  });
}

/* -------------------------------- init ----------------------------- */

async function init() {
  wire();
  setTipo(state.tipo);
  try {
    const cfg = await api('/api/config');
    if (!cfg.tmdbConfigurado) mostrarAviso();
    const g = await api('/api/generos', { tipo: state.tipo });
    state.generos = g.generos || [];
  } catch (e) { if (/TMDB_API_KEY/.test(e.message)) mostrarAviso(); }
  renderLista();
  renderHistorico();
}

init();