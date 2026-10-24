'use strict';

/* =====================================================================
   CineP2P 3.0 - frontend vanilla (mobile-first, Capacitor-ready)
   ===================================================================== */

const API_BASE = String(window.CINEP2P_API_BASE || '').replace(/\/+$/, '');
const PLACEHOLDER = '/placeholder.svg';

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
  job: null,
  poll: null,
  podeTocar: false,
  streamUrl: null,
  buscaTimer: null,
  ultimoSalvar: 0,
  fontesAtuais: []
};

const els = {
  hero: $('#hero'),
  rows: $('#rows'),
  searchInput: $('#searchInput'),
  searchResults: $('#searchResults'),
  listaGrid: $('#listaGrid'),
  historicoGrid: $('#historicoGrid'),
  categoriasChips: $('#categoriasChips'),
  categoriasGrid: $('#categoriasGrid'),
  modal: $('#modal'),
  modalBody: $('#modalBody'),
  player: $('#player'),
  video: $('#video'),
  overlay: $('#playerOverlay'),
  playerTitle: $('#playerTitle'),
  toast: $('#toast'),
  drawer: $('#drawer'),
  drawerBackdrop: $('#drawerBackdrop'),
  tipoToggle: $('#tipoToggle')
};

/* ------------------------------ utils ------------------------------ */

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function fmtSize(b) {
  const n = Number(b);
  if (!n || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v = v / 1024; i++; }
  return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}

function fmtSpeed(b) { const n = Number(b); return n > 0 ? fmtSize(n) + '/s' : '0 B/s'; }

let toastTimer = null;
function toast(msg, tipo) {
  els.toast.textContent = msg;
  els.toast.className = 'toast' + (tipo === 'error' ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { els.toast.classList.add('hidden'); }, 4800);
}

function url(path, params) {
  const u = new URL(API_BASE + path, API_BASE ? API_BASE + '/' : window.location.origin);
  if (params) {
    Object.keys(params).forEach(function (k) {
      const v = params[k];
      if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
    });
  }
  return u.toString();
}

async function api(path, params) {
  const res = await fetch(url(path, params));
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) throw new Error(data.error || ('Erro HTTP ' + res.status));
  return data;
}

function poster(item, comProgresso) {
  const img = '<img loading="lazy" src="' + esc(item.poster || item.backdrop || PLACEHOLDER) +
    '" alt="' + esc(item.titulo || item.title || '') + '" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'">';
  const prog = (comProgresso && item.progresso) ? '<div class="card-progress"><i style="width:' + Math.min(100, item.progresso) + '%"></i></div>' : '';
  return img + prog;
}

function cardHtml(item, opts) {
  const o = opts || {};
  const tag = o.tag ? '<span class="card-tag">' + esc(o.tag) + '</span>' : '';
  return '<button class="card" data-card data-id="' + esc(item.id) + '" data-tipo="' + esc(item.tipo || 'movie') + '">' +
      '<div class="card-img">' + poster(item, o.progresso) + tag + '</div>' +
      '<div class="card-meta"><span>' + esc(item.ano || '') + '</span>' +
      (item.nota ? '<span>&#9733; ' + item.nota.toFixed(1) + '</span>' : '') + '</div>' +
      '<div class="card-title">' + esc(item.titulo || item.title || '') + '</div>' +
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
  $$('.nav-link, .bn-item').forEach(function (b) { b.classList.toggle('active', b.dataset.view === nome); });
  window.scrollTo({ top: 0 });
  if (nome === 'lista') renderLista();
  if (nome === 'historico') renderHistorico();
  if (nome === 'categorias') renderCategorias();
  if (nome === 'buscar') setTimeout(function () { els.searchInput.focus(); }, 120);
}

function abrirDrawer() { els.drawer.classList.remove('hidden'); els.drawerBackdrop.classList.remove('hidden'); }
function fecharDrawer() { els.drawer.classList.add('hidden'); els.drawerBackdrop.classList.add('hidden'); }

/* ------------------------------ home ------------------------------- */

function skeleton() {
  let html = '';
  for (let i = 0; i < 3; i++) {
    html += '<div class="row"><div class="sk sk-title"></div><div class="scroller">';
    for (let j = 0; j < 6; j++) html += '<div class="sk sk-card"></div>';
    html += '</div></div>';
  }
  return html;
}

function heroHtml(item) {
  return '<div class="hero-inner">' +
      '<p class="hero-kicker">Destaque de hoje</p>' +
      '<h1 class="hero-title">' + esc(item.titulo) + '</h1>' +
      '<p class="hero-meta">' + esc(item.ano || '') +
        (item.nota ? ' &middot; &#9733; ' + item.nota.toFixed(1) : '') + '</p>' +
      '<p class="hero-sinopse">' + esc(item.sinopse || '') + '</p>' +
      '<div class="hero-actions">' +
        '<button class="btn primary" id="heroAssistir">Assistir agora</button>' +
        '<button class="btn ghost" id="heroTrailer">Assistir trailer</button>' +
        '<button class="btn ghost" id="heroFavoritar">Favoritar</button>' +
      '</div>' +
    '</div>';
}

function renderHero(item) {
  if (!item) { els.hero.innerHTML = ''; els.hero.style.backgroundImage = 'none'; return; }
  els.hero.style.backgroundImage = 'url("' + (item.backdrop || item.poster || PLACEHOLDER) + '")';
  els.hero.innerHTML = heroHtml(item);
  $('#heroAssistir').addEventListener('click', function () { abrirDetalhes(item.tipo || 'movie', item.id, true); });
  $('#heroTrailer').addEventListener('click', function () { abrirDetalhes(item.tipo || 'movie', item.id, false, true); });
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

    const continuar = LS.get(K.continuar, []);
    if (continuar.length) html += rowHtml('Continue Assistindo', continuar, { progresso: true });

    data.rows.forEach(function (r) { html += rowHtml(r.titulo, r.itens, {}); });
    els.rows.innerHTML = html || '<p class="vazio">Sem resultados do TMDb.</p>';
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
  div.innerHTML = 'Falta configurar a chave do TMDb. Abra o <code>.env</code>, coloque <code>TMDB_API_KEY=sua_chave</code> e reinicie o servidor.';
  els.rows.parentNode.insertBefore(div, els.rows);
}

/* ----------------------------- buscar ------------------------------ */

async function buscar(termo) {
  const q = String(termo || '').trim();
  if (q.length < 2) { els.searchResults.innerHTML = ''; return; }
  els.searchResults.innerHTML = '<p class="vazio">Buscando...</p>';
  try {
    const data = await api('/api/buscar', { q: q, tipo: state.tipo });
    els.searchResults.innerHTML = gridHtml(data.itens, {});
  } catch (e) {
    els.searchResults.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>';
  }
}

/* ------------------------- lista / historico ----------------------- */

function renderLista() {
  const lista = LS.get(K.lista, []);
  els.listaGrid.innerHTML = gridHtml(lista, {});
}

function renderHistorico() {
  const hist = LS.get(K.historico, []);
  els.historicoGrid.innerHTML = gridHtml(hist, { progresso: true });
}

function renderCategorias() {
  els.categoriasChips.innerHTML = state.generos.map(function (g) {
    return '<button class="chip" data-genero="' + g.id + '">' + esc(g.nome) + '</button>';
  }).join('') || '<p class="vazio">Carregando categorias...</p>';
  $$('#categoriasChips .chip').forEach(function (b) {
    b.addEventListener('click', function () { abrirGenero(b.dataset.genero, b.textContent); });
  });
}

async function abrirGenero(id, nome) {
  els.categoriasGrid.innerHTML = '<p class="vazio">Carregando ' + esc(nome) + '...</p>';
  try {
    const data = await api('/api/filmes/genero/' + id, { tipo: state.tipo });
    els.categoriasGrid.innerHTML = gridHtml(data.itens, {});
  } catch (e) {
    els.categoriasGrid.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>';
  }
}

/* ------------------------- lista/historico ops --------------------- */

function chaveItem(item) { return (item.tipo || 'movie') + ':' + item.id; }

function resumo(item) {
  return {
    id: item.id, tipo: item.tipo || 'movie', titulo: item.titulo,
    poster: item.poster, backdrop: item.backdrop, ano: item.ano, nota: item.nota
  };
}

function alternarFavorito(item) {
  const lista = LS.get(K.lista, []);
  const chave = chaveItem(item);
  const existe = lista.some(function (i) { return chaveItem(i) === chave; });
  if (existe) {
    LS.set(K.lista, lista.filter(function (i) { return chaveItem(i) !== chave; }));
    toast('Removido da Minha Lista');
  } else {
    lista.unshift(resumo(item));
    LS.set(K.lista, lista.slice(0, 120));
    toast('Adicionado a Minha Lista');
  }
  if (state.view === 'lista') renderLista();
}

function marcarHistorico(item) {
  const hist = LS.get(K.historico, []).filter(function (i) { return chaveItem(i) !== chaveItem(item); });
  hist.unshift(Object.assign(resumo(item), { atualizado: Date.now(), progresso: 0 }));
  LS.set(K.historico, hist.slice(0, 80));
}

function salvarProgresso(segundos, duracao) {
  if (!state.media || !duracao) return;
  const pct = Math.min(100, (segundos / duracao) * 100);
  if (pct < 1 || pct > 98) return;
  const chave = chaveItem(state.media);
  const lista = LS.get(K.continuar, []).filter(function (i) { return chaveItem(i) !== chave; });
  lista.unshift(Object.assign(resumo(state.media), { progresso: pct, atualizado: Date.now() }));
  LS.set(K.continuar, lista.slice(0, 15));
}

/* ---------------------------- detalhes ----------------------------- */

function abrirModal(html) {
  els.modalBody.innerHTML = html;
  els.modal.classList.remove('hidden');
  document.body.classList.add('no-scroll');
}

function fecharModal() {
  els.modal.classList.add('hidden');
  els.modalBody.innerHTML = '';
  document.body.classList.remove('no-scroll');
}

async function abrirDetalhes(tipo, id, autoPlay, abrirTrailer) {
  abrirModal('<p class="vazio">Carregando...</p>');
  try {
    const m = await api('/api/media/' + tipo + '/' + id);
    state.media = m;
    renderDetalhes(m, autoPlay, abrirTrailer);
  } catch (e) {
    abrirModal('<p class="vazio">' + esc(e.message) + '</p>');
  }
}

function renderDetalhes(m, autoPlay, abrirTrailer) {
  const generos = (m.generos || []).map(function (g) { return g.nome; }).join(' &middot; ');
  const elenco = (m.elenco || []).map(function (c) {
    return '<div class="elenco-item"><div class="elenco-foto">' +
      (c.foto ? '<img loading="lazy" src="' + esc(c.foto) + '" alt="' + esc(c.nome) + '" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'">' : '') +
      '</div><span>' + esc(c.nome) + '</span></div>';
  }).join('');

  const temporadas = (m.temporadas && m.temporadas.length) ? m.temporadas : [{ numero: 1, nome: 'Temporada 1' }];
  const pickers = m.tipo === 'tv'
    ? '<div class="pickers">' +
        '<label>Temporada<select id="selTemporada">' +
          temporadas.map(function (t) { return '<option value="' + t.numero + '">' + esc(t.nome || ('Temporada ' + t.numero)) + '</option>'; }).join('') +
        '</select></label>' +
        '<label>Episodio<input id="inpEpisodio" type="number" min="1" value="1"></label>' +
      '</div>'
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
            (m.tipo === 'tv' ? ' &middot; Serie' : '') + '</p>' +
          (generos ? '<p class="details-gen">' + generos + '</p>' : '') +
        '</div>' +
      '</div>' +
      '<div class="details-body">' +
        '<p class="details-sinopse">' + esc(m.sinopse || 'Sinopse nao disponivel.') + '</p>' +
        '<div class="details-actions">' +
          '<button class="btn primary big" id="btnAssistir">Assistir agora</button>' +
          '<div class="linha">' +
            (m.trailer ? '<button class="btn ghost" id="btnTrailer">Trailer</button>' : '') +
            '<button class="btn ghost" id="btnFavoritar">Favoritar</button>' +
            (m.imdbId ? '<a class="btn ghost" target="_blank" rel="noreferrer" href="https://www.imdb.com/title/' + esc(m.imdbId) + '/">IMDb</a>' : '') +
          '</div>' +
        '</div>' +
        pickers +
        '<div id="fontesBox"></div>' +
        (elenco ? '<div class="elenco"><h3>Elenco</h3><div class="elenco-list">' + elenco + '</div></div>' : '') +
      '</div>' +
    '</div>';

  $('#btnAssistir').addEventListener('click', function () { carregarFontes(); });
  if ($('#btnTrailer')) $('#btnTrailer').addEventListener('click', function () { mostrarTrailer(m.trailer); });
  $('#btnFavoritar').addEventListener('click', function () { alternarFavorito(m); });

  if (abrirTrailer && m.trailer) mostrarTrailer(m.trailer);
  if (autoPlay) carregarFontes();
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

/* ------------------------------ fontes ----------------------------- */

async function carregarFontes() {
  const m = state.media;
  if (!m) return;
  const box = $('#fontesBox');
  box.innerHTML = '<p class="vazio">Varrendo indexadores em paralelo...</p>';

  const params = {
    titulo: m.titulo,
    tituloOriginal: m.tituloOriginal,
    ano: m.ano,
    imdbId: m.imdbId,
    tipo: m.tipo
  };
  if (m.tipo === 'tv') {
    params.temporada = $('#selTemporada') ? $('#selTemporada').value : 1;
    params.episodio = $('#inpEpisodio') ? ($('#inpEpisodio').value || 1) : 1;
  }

  try {
    const data = await api('/api/torrent', params);
    state.fontesAtuais = data.fontes || [];
    renderFontes(data);
  } catch (e) {
    box.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>';
  }
}

function tagsFonte(f) {
  return '<span class="tag">' + esc(f.quality || 'SD') + '</span>' +
    '<span class="tag audio">' + esc(f.audio || 'Original') + '</span>' +
    (f.size ? '<span>' + esc(f.size) + '</span>' : '') +
    '<span>' + f.seeders + ' seeds</span>' +
    '<span>' + esc(f.source) + '</span>';
}

function renderFontes(data) {
  const box = $('#fontesBox');
  const rec = data.recomendado;
  if (!rec) {
    box.innerHTML = '<div class="fontes"><p class="vazio">Nenhum torrent encontrado. Tente outra qualidade ou o titulo original.</p></div>';
    return;
  }

  const stats = (data.scrapers || []).map(function (s) {
    return esc(s.fonte) + ': ' + s.itens + (s.erro ? ' (falhou)' : '') + ' - ' + s.ms + 'ms';
  }).join('<br>');

  box.innerHTML =
    '<div class="fontes">' +
      '<div class="fontes-head"><h3>Melhor fonte</h3>' +
        '<span class="pill">' + data.total + ' encontrados</span>' +
        (data.dublados ? '<span class="pill">' + data.dublados + ' PT-BR</span>' : '') +
        '<span class="pill">' + data.ms + 'ms</span>' +
      '</div>' +
      '<div class="recomendado-card">' +
        '<button class="btn primary big" id="btnRecomendado">Assistir Recomendado</button>' +
        '<p class="recomendado-titulo">' + esc(rec.title) + '</p>' +
        '<div class="recomendado-tags">' + tagsFonte(rec) + '</div>' +
      '</div>' +
      '<button class="btn ghost small" id="btnOutras">Outras fontes (' + (state.fontesAtuais.length - 1) + ')</button>' +
      '<div id="outrasList" class="hidden" style="margin-top:12px">' +
        state.fontesAtuais.slice(1).map(function (f, i) {
          return '<div class="fonte">' +
            '<div class="fonte-main">' +
              '<div class="fonte-titulo">' + esc(f.title) + '</div>' +
              '<div class="fonte-sub">' + tagsFonte(f) + '</div>' +
            '</div>' +
            '<button class="btn small" data-fonte="' + (i + 1) + '">Ver</button>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="status-scrapers">' + stats + '</div>' +
    '</div>';

  $('#btnRecomendado').addEventListener('click', function () { iniciarPlayer(rec); });
  $('#btnOutras').addEventListener('click', function () {
    const l = $('#outrasList');
    l.classList.toggle('hidden');
    $('#btnOutras').textContent = l.classList.contains('hidden')
      ? 'Outras fontes (' + (state.fontesAtuais.length - 1) + ')'
      : 'Ocultar outras fontes';
  });
  $$('#outrasList [data-fonte]').forEach(function (b) {
    b.addEventListener('click', function () { iniciarPlayer(state.fontesAtuais[Number(b.dataset.fonte)]); });
  });
}

/* ------------------------------ player ----------------------------- */

function resetOverlay() {
  els.overlay.classList.remove('compact');
  els.overlay.querySelector('.spinner').style.display = '';
  els.overlay.querySelector('.ov-msg').innerHTML = 'Conectando aos peers (buffer)...';
  els.overlay.querySelector('.ov-fill').style.width = '0%';
  els.overlay.querySelector('.ov-stats').textContent = '';
  els.overlay.querySelector('#cancelPlay').style.display = '';
}

function abrirPlayer(titulo) {
  state.podeTocar = false;
  state.streamUrl = null;
  els.video.removeAttribute('src');
  els.video.load();
  els.playerTitle.textContent = titulo || 'Reproduzindo';
  resetOverlay();
  els.player.classList.remove('hidden');
  document.body.classList.add('no-scroll');
}

function fecharPlayer() {
  if (state.job) {
    const jobId = state.job;
    state.job = null;
    fetch(url('/api/play/stop', { jobId: jobId }), { method: 'GET', keepalive: true }).catch(function () { });
  }
  clearTimeout(state.poll);
  try { els.video.pause(); } catch (e) { }
  els.video.removeAttribute('src');
  els.video.load();
  els.player.classList.add('hidden');
  document.body.classList.remove('no-scroll');
  if (state.view === 'inicio') carregarInicio();
}

async function iniciarPlayer(fonte) {
  if (!fonte) return;
  fecharModal();
  abrirPlayer(fonte.title || (state.media && state.media.titulo));

  if (state.media) {
    marcarHistorico(state.media);
  }

  try {
    const data = await api('/api/play', {
      magnet: fonte.magnet,
      fileIdx: fonte.fileIdx,
      titulo: fonte.title,
      qualidade: fonte.quality
    });
    state.job = data.jobId;
    poll();
  } catch (e) {
    erroPlayer(e.message);
  }
}

function atualizarOverlay(s) {
  const msg = els.overlay.querySelector('.ov-msg');
  const stats = els.overlay.querySelector('.ov-stats');
  const fill = els.overlay.querySelector('.ov-fill');

  fill.style.width = Math.max(2, Math.min(100, s.buffer || 0)).toFixed(0) + '%';

  if (s.canPlay && !state.podeTocar) {
    state.podeTocar = true;
    state.streamUrl = s.streamUrl;
    els.video.src = API_BASE + s.streamUrl;
    const p = els.video.play();
    if (p && p.catch) p.catch(function () { });
  }

  if (state.podeTocar) {
    msg.innerHTML = 'Carregando video...';
    els.overlay.classList.add('compact');
  } else {
    msg.innerHTML = (s.message || 'Conectando aos peers...') +
      '<br><strong>' + (s.buffer || 0).toFixed(1) + '%</strong> do buffer';
  }

  stats.textContent = s.peers + ' peers | ' + fmtSpeed(s.speed) + ' | ' +
    fmtSize(s.downloaded) + ' de ' + fmtSize(s.total) + ' | ' + s.elapsed + 's';
}

function erroPlayer(mensagem) {
  clearTimeout(state.poll);
  els.overlay.classList.remove('compact');
  els.overlay.querySelector('.spinner').style.display = 'none';
  els.overlay.querySelector('.ov-msg').innerHTML =
    esc(mensagem) + '<br><button class="btn small" id="btnVoltarFontes" style="margin-top:12px">Escolher outra fonte</button>';
  const b = $('#btnVoltarFontes');
  if (b) b.addEventListener('click', function () {
    fecharPlayer();
    if (state.media) abrirDetalhes(state.media.tipo, state.media.id, false).then(carregarFontes);
  });
}

async function poll() {
  if (!state.job) return;
  try {
    const s = await api('/api/play/status', { jobId: state.job });
    atualizarOverlay(s);
    if (s.state === 'erro') { erroPlayer(s.message); return; }
  } catch (e) {
    erroPlayer(e.message);
    return;
  }
  state.poll = setTimeout(poll, state.podeTocar ? 2500 : 900);
}

/* ------------------------------- wiring ---------------------------- */

function wire() {
  $('#menuBtn').addEventListener('click', abrirDrawer);
  $('#drawerClose').addEventListener('click', fecharDrawer);
  els.drawerBackdrop.addEventListener('click', fecharDrawer);

  $$('.nav-link, .bn-item').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.dataset.view); fecharDrawer(); });
  });

  $('#brand').addEventListener('click', function (e) { e.preventDefault(); setView('inicio'); });
  $('#searchBtn').addEventListener('click', function () { setView('buscar'); });

  els.tipoToggle.addEventListener('click', function () {
    state.tipo = state.tipo === 'movie' ? 'tv' : 'movie';
    LS.set(K.tipo, state.tipo);
    els.tipoToggle.textContent = state.tipo === 'movie' ? 'Filmes' : 'Series';
    carregarInicio();
  });
  els.tipoToggle.textContent = state.tipo === 'movie' ? 'Filmes' : 'Series';

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
    const close = e.target.closest('[data-close]');
    if (close) fecharModal();
  });

  $('#closePlayer').addEventListener('click', fecharPlayer);
  $('#cancelPlay').addEventListener('click', fecharPlayer);

  $('#copyStream').addEventListener('click', function () {
    if (!state.streamUrl) return;
    const full = API_BASE + state.streamUrl;
    navigator.clipboard.writeText(full).then(function () { toast('URL copiada (abra no VLC se necessario)'); })
      .catch(function () { toast(full); });
  });

  els.video.addEventListener('playing', function () {
    if (state.podeTocar) els.overlay.classList.add('compact');
  });
  els.video.addEventListener('waiting', function () {
    if (state.podeTocar) {
      els.overlay.classList.remove('compact');
      els.overlay.querySelector('.spinner').style.display = '';
      els.overlay.querySelector('.ov-msg').textContent = 'Carregando mais dados...';
    }
  });
  els.video.addEventListener('timeupdate', function () {
    const agora = Date.now();
    if (agora - state.ultimoSalvar < 5000) return;
    state.ultimoSalvar = agora;
    if (els.video.duration) salvarProgresso(els.video.currentTime, els.video.duration);
  });
  els.video.addEventListener('error', function () {
    if (state.podeTocar) toast('O navegador nao reproduziu este arquivo. Tente outra fonte ou abra no VLC.', 'error');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!els.player.classList.contains('hidden')) fecharPlayer();
    else if (!els.modal.classList.contains('hidden')) fecharModal();
    else fecharDrawer();
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
  try {
    const cfg = await api('/api/config');
    if (!cfg.tmdbConfigurado) mostrarAviso();
    const g = await api('/api/generos', { tipo: state.tipo });
    state.generos = g.generos || [];
  } catch (e) {
    if (/TMDB_API_KEY/.test(e.message)) mostrarAviso();
  }
  carregarInicio();
  renderLista();
  renderHistorico();
}

init();