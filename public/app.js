'use strict';

/* =========================================================================
   cinep2p :: front-end
   ========================================================================= */

const CATEGORIAS = [
    { id: 'inicio', rotulo: 'Início' },
    { id: 'filmes', rotulo: 'Filmes' },
    { id: 'series', rotulo: 'Séries' },
    { id: 'animes', rotulo: 'Animes' },
    { id: 'doramas', rotulo: 'Doramas' },
    { id: 'novelas', rotulo: 'Novelas' },
    { id: 'curtas', rotulo: 'Curtas' },
    { id: 'documentarios', rotulo: 'Documentários' }
];

const estado = {
    categoria: 'inicio',
    termo: '',
    pagina: 1,
    ptbr: true,
    ordenacao: 'seeds',
    modo: 'catalogo',
    itens: [],
    carregando: false,
    favoritos: new Set(),
    player: null
};

const $ = (id) => document.getElementById(id);
const cacheCapas = new Map();
const capasPendentes = new Map();
const posterAutorizado = (item) => Boolean(window.CinePosterPolicy && window.CinePosterPolicy.posterAutorizado(item));

/* ------------------------------- utilitarios ------------------------------ */

function formatarBytes(bytes) {
    const n = Number(bytes) || 0;
    if (!n) return '--';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}

function escapar(texto) {
    return String(texto == null ? '' : texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function urlPoster(item) {
    if (!posterAutorizado(item)) return null;
    return '/api/img?u=' + encodeURIComponent(item.poster) + (item.base ? '&ref=' + encodeURIComponent(item.base) : '');
}

function anoDoItem(item) {
    return String((item && item.ano) || (item && item.titulo) || '').match(/(?:^|[^0-9])((?:19|20)\d{2})(?=$|[^0-9])/)?.[1] || '';
}

function tituloParaBuscaDeCapa(titulo) {
    return String(titulo || '')
        .replace(/(?:19|20)\d{2}/g, ' ')
        .replace(/\b(?:2160p|1440p|1080p|720p|480p|4k|uhd|bluray|bdrip|brrip|webrip|webdl|hdtv|dvdrip|remux|hevc|x265|x264|h264|aac|ac3|dts|dublado|dublada|dublados|dubladas|dual[a-z]*audio[a-z]*|dual|audio|pt[-_ ]?br|ptbr|pt|br|pob|por|portugues|portuguese|legendado|legendada|nacional|torrent|mkv|mp4|avi|jpg|jpeg|png|webp|gif|tif|poster|file)\b/gi, ' ')
        .replace(/[._()[\]{}]/g, ' ')
        .replace(/[\/:]+/g, ' ')
        .replace(/\s*[-:]\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function chaveCard(item) {
    return item.infoHash || item.magnet || item.titulo;
}

async function obterPoster(item) {
    if (posterAutorizado(item)) return { poster: item.poster, attribution: item.attribution || null, provider: item.provider || '' };
    const ano = anoDoItem(item);
    const chave = (item.titulo || '').toLocaleLowerCase() + '|' + ano;
    if (cacheCapas.has(chave)) {
        const guardada = cacheCapas.get(chave);
        if (guardada.poster || guardada.expires > Date.now()) return guardada;
        cacheCapas.delete(chave);
    }
    if (capasPendentes.has(chave)) return capasPendentes.get(chave);

    const tituloBusca = tituloParaBuscaDeCapa(item.tituloBruto || item.titulo || '');
    const parametros = new URLSearchParams({ title: tituloBusca || item.titulo || '' });
    if (ano) parametros.set('year', ano);
    const pedido = fetch('/api/poster?' + parametros.toString())
        .then((resposta) => {
            if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
            return resposta.json();
        })
        .then((dados) => {
            const capa = {
                poster: dados.poster || '',
                provider: dados.provider || '',
                attribution: dados.attribution || null,
                expires: dados.poster ? Infinity : Date.now() + 5 * 60 * 1000
            };
            cacheCapas.set(chave, capa);
            return capa;
        })
        .catch(() => {
            const vazia = { poster: '', provider: '', attribution: null, expires: Date.now() + 60 * 1000 };
            cacheCapas.set(chave, vazia);
            return vazia;
        })
        .finally(() => capasPendentes.delete(chave));

    capasPendentes.set(chave, pedido);
    return pedido;
}

function carregarPosterAusente(item, container) {
    obterPoster(item).then((capa) => {
        if (!capa.poster || !container.isConnected || container.querySelector('img')) return;

        const imagem = document.createElement('img');
        imagem.alt = '';
        imagem.loading = 'lazy';
        imagem.decoding = 'async';
        imagem.onload = () => {
            const fallback = container.querySelector('.sem-poster');
            if (fallback) fallback.hidden = true;
        };
        imagem.onerror = () => imagem.remove();
        imagem.src = urlPoster({ poster: capa.poster, provider: capa.provider, attribution: capa.attribution });
        container.prepend(imagem);
        const creditoDados = window.CinePosterPolicy.posterCredito(capa);
        if (creditoDados) {
            const credito = document.createElement('a');
            credito.className = 'poster-credit';
            credito.href = creditoDados.url;
            credito.target = '_blank';
            credito.rel = 'noopener noreferrer';
            credito.title = creditoDados.title;
            credito.textContent = creditoDados.label;
            container.appendChild(credito);
        }
    });
}

function selos(item) {
    const selos = [];
    const idioma = item.idioma || {};
    if (idioma.dublado) selos.push('<span class="selo dublado">Dublado</span>');
    else if (idioma.dual) selos.push('<span class="selo dual">Dual Áudio</span>');
    else if (idioma.legendado) selos.push('<span class="selo legendado">Legendado</span>');
    if (item.qualidade && item.qualidade !== 'SD') selos.push('<span class="selo qualidade">' + escapar(item.qualidade) + '</span>');
    if (item.ano) selos.push('<span class="selo">' + escapar(item.ano) + '</span>');
    return selos.join('');
}

function toast(mensagem) {
    const faixa = $('faixa-info');
    faixa.textContent = mensagem;
    faixa.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { faixa.hidden = true; }, 4200);
}

function salvarFavoritos() {
    try {
        localStorage.setItem('cinep2p:favoritos', JSON.stringify([...estado.favoritos]));
    } catch (_) { /* noop */ }
}

function carregarFavoritos() {
    try {
        const bruto = JSON.parse(localStorage.getItem('cinep2p:favoritos') || '[]');
        estado.favoritos = new Set(bruto);
    } catch (_) { estado.favoritos = new Set(); }
}

function chaveItem(item) {
    return item.infoHash || item.titulo;
}

/* --------------------------------- render -------------------------------- */

function montarAbas() {
    const container = $('abas');
    container.innerHTML = CATEGORIAS
        .map((c) => '<button class="aba' + (c.id === estado.categoria ? ' ativo' : '') + '" data-cat="' + c.id + '">' + c.rotulo + '</button>')
        .join('');

    container.querySelectorAll('.aba').forEach((botao) => {
        botao.addEventListener('click', () => {
            estado.categoria = botao.dataset.cat;
            estado.modo = 'catalogo';
            estado.termo = '';
            estado.pagina = 1;
            $('campo-busca').value = '';
            montarAbas();
            carregar();
        });
    });
}

function esqueletos(quantidade) {
    return new Array(quantidade).fill(0).map(() =>
        '<div class="card esqueleto"><div class="card-poster"></div><div class="card-corpo"><div class="linha-falsa" style="width:80%"></div><div class="linha-falsa" style="width:45%"></div></div></div>'
    ).join('');
}

function ordenar(itens) {
    const lista = itens.slice();
    switch (estado.ordenacao) {
        case 'qualidade':
            lista.sort((a, b) => (b.qualidade || '').localeCompare(a.qualidade || '') || b.seeds - a.seeds);
            break;
        case 'ptbr':
            lista.sort((a, b) => (b.idioma && b.idioma.pontos ? b.idioma.pontos : 0) - (a.idioma && a.idioma.pontos ? a.idioma.pontos : 0));
            break;
        case 'tamanho':
            lista.sort((a, b) => (a.tamanhoBytes || 1e15) - (b.tamanhoBytes || 1e15));
            break;
        default:
            lista.sort((a, b) => (b.seeds || 0) - (a.seeds || 0));
    }
    return lista;
}

function cardHtml(item) {
    const poster = urlPoster(item);
    const credito = window.CinePosterPolicy.posterCredito(item);
    const fav = estado.favoritos.has(chaveItem(item));
    return '' +
        '<article class="card" data-key="' + escapar(chaveCard(item)) + '" data-hash="' + escapar(item.infoHash || '') + '" data-titulo="' + escapar(item.titulo) + '">' +
            '<button class="card-favorito' + (fav ? ' ativo' : '') + '" title="Minha Lista" aria-label="' + (fav ? 'Remover da Minha Lista' : 'Adicionar à Minha Lista') + '">' + (fav ? '&#9733;' : '&#9734;') + '</button>' +
            '<div class="card-poster">' +
                (poster ? '<img loading="lazy" src="' + poster + '" alt="" />' : '') +
                (credito ? '<a class="poster-credit" href="' + escapar(credito.url) + '" title="' + escapar(credito.title) + '" target="_blank" rel="noopener noreferrer">' + escapar(credito.label) + '</a>' : '') +
                '<div class="sem-poster">' + escapar((item.titulo || '?').charAt(0).toUpperCase()) + '</div>' +
                '<div class="card-badges">' + selos(item) + '</div>' +
                '<span class="card-seeds">' + (item.seeds || 0) + ' seeds</span>' +
            '</div>' +
            '<div class="card-corpo">' +
                '<div class="card-titulo">' + escapar(item.titulo) + '</div>' +
                '<div class="card-meta"><span>' + escapar(anoDoItem(item)) + '</span><span>' + formatarBytes(item.tamanhoBytes) + '</span></div>' +
                '<div class="card-fonte">' + escapar(item.fonteNome || '') + '</div>' +
            '</div>' +
        '</article>';
}

function secoesDaHome(itens) {
    const porAno = itens.map((item) => ({ item, ano: Number(anoDoItem(item)) || 0 }));
    const limite = new Date().getFullYear() - 2;
    const todosComAno = porAno.filter((registro) => registro.ano > 0)
        .sort((a, b) => b.ano - a.ano || (b.item.seeds || 0) - (a.item.seeds || 0))
        .map((registro) => registro.item);
    const recentes = todosComAno.filter((item) => Number(anoDoItem(item)) >= limite);
    const secoes = [];
    const maisNovos = recentes.length ? recentes : todosComAno;
    if (maisNovos.length) secoes.push({
        titulo: recentes.length ? 'Lançamentos recentes' : 'Mais recentes cadastrados',
        itens: maisNovos.slice(0, 18),
        classe: recentes.length ? 'recentes' : 'mais-recentes'
    });

    const emAlta = ordenar(itens).slice(0, 18);
    if (emAlta.length) secoes.push({ titulo: 'Em alta no CineP2P', itens: emAlta, classe: 'em-alta' });

    const categorias = [
        ['filmes', 'Filmes'], ['series', 'Séries'], ['animes', 'Animes'],
        ['doramas', 'Doramas'], ['novelas', 'Novelas'], ['curtas', 'Curtas'],
        ['documentarios', 'Documentários']
    ];
    for (const [id, titulo] of categorias) {
        const grupo = itens.filter((item) => String(item.categoria || '').toLowerCase() === id);
        if (grupo.length) secoes.push({ titulo, itens: ordenar(grupo).slice(0, 18), classe: 'categoria-' + id });
    }
    return secoes;
}

function conectarCards(raiz, itens) {
    raiz.querySelectorAll('.card-poster img').forEach((imagem) => {
        imagem.addEventListener('load', () => {
            const fallback = imagem.parentElement.querySelector('.sem-poster');
            if (fallback) fallback.hidden = true;
        });
        imagem.addEventListener('error', () => imagem.remove());
    });

    raiz.querySelectorAll('.card').forEach((el) => {
        el.addEventListener('click', (ev) => {
            if (ev.target.closest('.card-favorito, .poster-credit')) return;
            const item = itens.find((candidato) => String(chaveCard(candidato)) === el.dataset.key);
            if (item) abrirPlayer(item);
        });
    });

    raiz.querySelectorAll('.card-favorito').forEach((botao) => {
        botao.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const card = botao.closest('.card');
            const item = itens.find((candidato) => String(chaveCard(candidato)) === card.dataset.key);
            if (!item) return;
            const chave = chaveItem(item);
            if (estado.favoritos.has(chave)) estado.favoritos.delete(chave);
            else estado.favoritos.add(chave);
            salvarFavoritos();
            botao.classList.toggle('ativo');
            botao.innerHTML = estado.favoritos.has(chave) ? '&#9733;' : '&#9734;';
            botao.setAttribute('aria-label', estado.favoritos.has(chave) ? 'Remover da Minha Lista' : 'Adicionar à Minha Lista');
        });
    });

    const cardsSemPoster = [...raiz.querySelectorAll('.card')]
        .filter((card) => !card.querySelector('.card-poster img'));
    if ('IntersectionObserver' in window) {
        const observador = new IntersectionObserver((entradas) => {
            entradas.forEach((entrada) => {
                if (!entrada.isIntersecting) return;
                observador.unobserve(entrada.target);
                const item = itens.find((candidato) => String(chaveCard(candidato)) === entrada.target.dataset.key);
                if (item) carregarPosterAusente(item, entrada.target.querySelector('.card-poster'));
            });
        }, { rootMargin: '250px' });
        cardsSemPoster.forEach((card) => observador.observe(card));
    } else {
        cardsSemPoster.forEach((card) => {
            const item = itens.find((candidato) => String(chaveCard(candidato)) === card.dataset.key);
            if (item) carregarPosterAusente(item, card.querySelector('.card-poster'));
        });
    }
}

function renderizar() {
    const grade = $('grade');
    const vazio = $('vazio');
    const itens = ordenar(estado.itens);
    const home = estado.categoria === 'inicio' && !estado.termo;
    const secoesHome = $('home-secoes');

    if (!itens.length) {
        grade.innerHTML = '';
        grade.hidden = false;
        secoesHome.hidden = true;
        $('hero').hidden = true;
        vazio.hidden = false;
        vazio.innerHTML = '<strong>Nada encontrado</strong>Tente outro termo, remova o filtro "Só PT-BR" ou mude a categoria.';
        return;
    }

    vazio.hidden = true;
    if (home) {
        grade.hidden = true;
        secoesHome.hidden = false;
        const secoes = secoesDaHome(itens);
        secoesHome.innerHTML = secoes.map((secao) =>
            '<section class="home-secao ' + escapar(secao.classe) + '">' +
                '<div class="home-secao-titulo"><h2>' + escapar(secao.titulo) + '</h2><span>' + secao.itens.length + ' títulos</span></div>' +
                '<div class="home-trilho">' + secao.itens.map(cardHtml).join('') + '</div>' +
            '</section>'
        ).join('');
        conectarCards(secoesHome, itens);
        const maisNovos = secoes.find((secao) => secao.classe === 'recentes' || secao.classe === 'mais-recentes');
        renderizarHero(maisNovos ? maisNovos.itens[0] : itens[0], Boolean(maisNovos && maisNovos.classe === 'recentes'));
    } else {
        grade.hidden = false;
        secoesHome.hidden = true;
        secoesHome.innerHTML = '';
        grade.innerHTML = itens.map(cardHtml).join('');
        conectarCards(grade, itens);
        renderizarHero(null, false);
    }
}

function renderizarHero(item, recente) {
    const hero = $('hero');
    const credito = $('hero-credit');
    if (!item) { hero.hidden = true; return; }

    hero.hidden = false;
    const poster = urlPoster(item);
    $('hero-fundo').style.backgroundImage = poster ? 'url("' + poster + '")' : 'none';
    credito.hidden = true;
    credito.removeAttribute('href');
    const creditoExistente = window.CinePosterPolicy.posterCredito(item);
    if (creditoExistente) {
        credito.href = creditoExistente.url;
        credito.textContent = 'Imagem: ' + creditoExistente.label;
        credito.hidden = false;
    }
    if (!poster) {
        obterPoster(item).then((capa) => {
            if (capa.poster && $('hero-titulo').textContent === item.titulo) {
                $('hero-fundo').style.backgroundImage = 'url("' + urlPoster({ poster: capa.poster, provider: capa.provider, attribution: capa.attribution }) + '")';
                const creditoResolvido = window.CinePosterPolicy.posterCredito(capa);
                if (creditoResolvido) {
                    credito.href = creditoResolvido.url;
                    credito.textContent = 'Imagem: ' + creditoResolvido.label;
                    credito.hidden = false;
                }
            }
        });
    }
    $('hero-etiqueta').textContent = recente ? 'Lançamento recente' : 'Em destaque';
    $('hero-titulo').textContent = item.titulo;
    $('hero-sinopse').textContent = item.sinopse || 'Sem sinopse disponível. ' + (item.seeds || 0) + ' seeds ativos na rede.';
    $('hero-tags').innerHTML = selos(item) + '<span class="selo">' + formatarBytes(item.tamanhoBytes) + '</span>';

    $('hero-play').onclick = () => abrirPlayer(item);
    $('hero-favorito').onclick = () => {
        const chave = chaveItem(item);
        if (estado.favoritos.has(chave)) estado.favoritos.delete(chave);
        else estado.favoritos.add(chave);
        salvarFavoritos();
        toast(estado.favoritos.has(chave) ? 'Adicionado à Minha Lista' : 'Removido da Minha Lista');
        renderizar();
    };
}

function atualizarPaginacao(dados) {
    const pag = $('paginacao');
    if (!dados || dados.totalPaginas <= 1) { pag.hidden = true; return; }
    pag.hidden = false;
    $('pagina-atual').textContent = 'Página ' + dados.pagina + ' de ' + dados.totalPaginas + ' (' + dados.total + ' itens)';
    $('pagina-anterior').disabled = dados.pagina <= 1;
    $('pagina-proxima').disabled = dados.pagina >= dados.totalPaginas;
}

/* --------------------------------- cargas -------------------------------- */

async function carregar() {
    if (estado.carregando) return;
    estado.carregando = true;

    const titulo = CATEGORIAS.find((c) => c.id === estado.categoria);
    $('titulo-secao').textContent = estado.termo
        ? 'Resultados para "' + estado.termo + '"'
        : titulo ? titulo.rotulo : 'Início';

    if (estado.categoria === 'favoritos') {
        estado.itens = [...estado.favoritos].map((chave) => {
            const encontrado = estado.itens.find((i) => chaveItem(i) === chave);
            return encontrado || { titulo: chave, infoHash: chave.length === 40 ? chave : null, seeds: 0 };
        });
        renderizar();
        estado.carregando = false;
        return;
    }

    $('grade').innerHTML = esqueletos(12);

    try {
        const parametros = new URLSearchParams({ pagina: String(estado.pagina), porPagina: '60' });
        let url;

        if (estado.termo) {
            parametros.set('q', estado.termo);
            parametros.set('categoria', estado.categoria === 'inicio' ? 'todos' : estado.categoria);
            parametros.set('ptbr', estado.ptbr ? '1' : '0');
            url = '/api/buscar?' + parametros.toString();
        } else {
            parametros.set('categoria', estado.categoria);
            url = '/api/catalogo?' + parametros.toString();
        }

        const resposta = await fetch(url);
        const dados = await resposta.json();

        estado.itens = dados.itens || [];
        renderizar();
        atualizarPaginacao(dados);

        if (estado.termo && dados.fontes) {
            const ok = dados.fontes.filter((f) => f.ok).length;
            $('rodape-fontes').textContent = ok + '/' + dados.fontes.length + ' indexadores responderam';
            if (!estado.itens.length && ok === 0) {
                toast('Nenhuma fonte respondeu. Verifique sua conexão ou clique em "Fontes".');
            }
        }

        if (!estado.termo) {
            const atualizado = dados.atualizadoEm ? new Date(dados.atualizadoEm).toLocaleString('pt-BR') : 'nunca';
            $('rodape-fontes').textContent = 'catálogo aquecido: ' + atualizado;
        }
    } catch (erro) {
        toast('Erro ao carregar: ' + erro.message);
        $('grade').innerHTML = '';
    } finally {
        estado.carregando = false;
    }
}

/* --------------------------------- player -------------------------------- */

async function abrirPlayer(item) {
    const modal = $('modal');
    const video = $('video');

    estado.player = { item, modo: null, infoHash: null, indice: null, polling: null, transcode: false, alvoSeek: 0 };

    modal.hidden = false;
    document.body.style.overflow = 'hidden';

    video.pause();
    video.removeAttribute('src');
    video.load();

    $('player-titulo').textContent = item.titulo;
    $('player-badges').innerHTML = selos(item);
    $('player-erro').hidden = true;
    $('player-nota').textContent = 'Fonte: ' + (item.fonteNome || 'desconhecida') + ' | ' + (item.seeds || 0) + ' seeds | ' + formatarBytes(item.tamanhoBytes);
    $('seletor-fonte').innerHTML = '<option value="' + escapar(item.infoHash || item.magnet || '') + '">' + escapar(item.fonteNome + ' - ' + item.qualidade) + '</option>';

    if (!item.infoHash && !item.magnet) {
        mostrarErro('Este item não expõe magnet direto. Abra o link da fonte original.');
        return;
    }

    overlay('Buscando metadados do torrent...', true);
    $('medidor').hidden = false;

    try {
        const referencia = encodeURIComponent(item.infoHash || item.magnet);
        const resposta = await fetch('/api/torrent/' + referencia);

        if (!resposta.ok) {
            const erro = await resposta.json().catch(() => ({ erro: 'falha ao abrir torrent' }));
            throw new Error(erro.erro || 'falha ao abrir torrent');
        }

        const meta = await resposta.json();
        estado.player.infoHash = meta.infoHash;
        estado.player.indice = meta.indice;

        $('seletor-fonte').innerHTML = (meta.arquivos || [])
            .filter((a) => a.video)
            .map((a) => '<option value="' + a.indice + '"' + (a.indice === meta.indice ? ' selected' : '') + '>' + escapar(a.nome.slice(0, 70)) + ' (' + formatarBytes(a.tamanho) + ')</option>')
            .join('') || '<option value="' + meta.indice + '">' + escapar(meta.arquivo) + '</option>';

        $('player-nota').textContent = 'Modo: ' + meta.modo + ' (' + (meta.motivo || '') + ') | ' + meta.nome;
        iniciarReproducao(meta.modo === 'direto' ? 'direto' : 'transcode');
    } catch (erro) {
        mostrarErro(erro.message);
        overlay('Falha: ' + erro.message, false);
    }
}

function overlay(texto, girando) {
    const el = $('player-overlay');
    el.hidden = false;
    el.querySelector('.spinner').style.display = girando ? 'block' : 'none';
    $('overlay-texto').textContent = texto;
}

function mostrarErro(mensagem) {
    const el = $('player-erro');
    el.hidden = false;
    el.textContent = mensagem;
}

function iniciarReproducao(modo) {
    const video = $('video');
    const player = estado.player;
    if (!player || !player.infoHash) return;

    player.modo = modo;
    player.transcode = modo !== 'direto';

    const base = player.transcode
        ? '/transcode/' + player.infoHash + '/' + player.indice
        : '/stream/' + player.infoHash + '/' + player.indice;

    video.src = player.transcode && player.alvoSeek ? base + '?t=' + Math.floor(player.alvoSeek) : base;

    overlay('Conectando aos peers...', true);

    video.onloadedmetadata = () => {
        if (player.transcode && player.alvoSeek) {
            try { video.currentTime = Math.max(0, player.alvoSeek - Math.floor(player.alvoSeek)); } catch (_) { /* noop */ }
            player.alvoSeek = 0;
        }
    };

    video.oncanplay = () => { $('player-overlay').hidden = true; };

    video.onerror = () => {
        if (player.modo === 'direto') {
            overlay('Container incompatível, convertendo...', true);
            iniciarReproducao('transcode');
            return;
        }
        mostrarErro('Não foi possível reproduzir. Tente outro arquivo ou outra fonte.');
        overlay('Erro na reprodução.', false);
    };

    video.onwaiting = () => overlay('Armazenando buffer...', true);
    video.onplaying = () => { $('player-overlay').hidden = true; };

    video.onseeked = () => {
        if (player.transcode && player.alvoSeek) {
            const alvo = Math.floor(player.alvoSeek);
            player.alvoSeek = 0;
            video.src = '/transcode/' + player.infoHash + '/' + player.indice + '?t=' + alvo;
            overlay('Buscando ' + new Date(alvo * 1000).toISOString().substr(11, 8) + '...', true);
        }
    };

    const promessa = video.play();
    if (promessa && promessa.catch) promessa.catch(() => { /* autoplay bloqueado */ });

    iniciarPolling();
}

function iniciarPolling() {
    pararPolling();
    const player = estado.player;
    if (!player) return;

    player.polling = setInterval(async () => {
        try {
            const r = await fetch('/api/status/' + player.infoHash);
            if (!r.ok) return;
            const s = await r.json();

            $('medidor-preenchido').style.width = Math.min(100, s.progresso || 0) + '%';
            $('medidor-peers').textContent = (s.peers || 0) + ' peers';
            $('medidor-velocidade').textContent = formatarBytes(s.velocidadeDown) + '/s';
            $('medidor-progresso').textContent = (s.progresso || 0).toFixed(1) + '%';

            if (!s.peers && s.progresso < 5) {
                overlay('Procurando peers... (o magnet pode estar lento)', true);
            }
        } catch (_) { /* noop */ }
    }, 1500);
}

function pararPolling() {
    if (estado.player && estado.player.polling) clearInterval(estado.player.polling);
}

function fecharPlayer() {
    const video = $('video');
    pararPolling();
    try { video.pause(); } catch (_) { /* noop */ }
    video.removeAttribute('src');
    video.load();
    $('modal').hidden = true;
    document.body.style.overflow = '';
    estado.player = null;
}

/* ---------------------------------- fontes -------------------------------- */

async function abrirFontes(forcar) {
    $('modal-fontes').hidden = false;
    $('lista-fontes').innerHTML = '<p class="nota">Verificando...</p>';

    try {
        const r = await fetch('/api/fontes' + (forcar ? '?forcar=1' : ''));
        const dados = await r.json();

        $('lista-fontes').innerHTML = (dados.fontes || []).map((f) =>
            '<div class="linha-fonte">' +
                '<span class="ponto ' + (f.online ? 'ok' : 'off') + '"></span>' +
                '<span class="nome">' + escapar(f.nome) + '</span>' +
                '<span class="detalhe">' + (f.online ? (f.ms + 'ms') : 'offline') +
                (f.buscaTeste && f.buscaTeste.ok ? ' | ' + f.buscaTeste.total + ' resultados' : '') +
                '</span>' +
            '</div>'
        ).join('') || '<p class="nota">Sem fontes ativas.</p>';
    } catch (erro) {
        $('lista-fontes').innerHTML = '<p class="nota">Erro: ' + escapar(erro.message) + '</p>';
    }
}

/* --------------------------------- eventos -------------------------------- */

function ligarEventos() {
    $('form-busca').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const termo = $('campo-busca').value.trim();
        estado.termo = termo;
        estado.modo = termo ? 'busca' : 'catalogo';
        estado.pagina = 1;
        if (termo) estado.categoria = estado.categoria === 'inicio' ? 'inicio' : estado.categoria;
        carregar();
    });

    $('campo-busca').addEventListener('input', (ev) => {
        if (!ev.target.value.trim() && estado.termo) {
            estado.termo = '';
            estado.pagina = 1;
            carregar();
        }
    });

    $('ordenacao').addEventListener('change', (ev) => {
        estado.ordenacao = ev.target.value;
        renderizar();
    });

    document.querySelectorAll('.chip[data-ptbr]').forEach((chip) => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.chip[data-ptbr]').forEach((c) => c.classList.remove('ativo'));
            chip.classList.add('ativo');
            estado.ptbr = chip.dataset.ptbr === '1';
            estado.pagina = 1;
            if (estado.termo) carregar();
        });
    });

    $('chip-favoritos').addEventListener('click', () => {
        estado.categoria = estado.categoria === 'favoritos' ? 'inicio' : 'favoritos';
        $('chip-favoritos').classList.toggle('ativo');
        montarAbas();
        carregar();
    });

    $('pagina-anterior').addEventListener('click', () => { if (estado.pagina > 1) { estado.pagina--; carregar(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
    $('pagina-proxima').addEventListener('click', () => { estado.pagina++; carregar(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

    $('btn-fontes').addEventListener('click', () => abrirFontes(false));
    $('btn-reverificar').addEventListener('click', () => abrirFontes(true));
    $('btn-fechar-fontes').addEventListener('click', () => { $('modal-fontes').hidden = true; });

    $('btn-cache').addEventListener('click', async () => {
        const r = await fetch('/api/cache', { method: 'DELETE' });
        toast(r.ok ? 'Cache de torrents liberado.' : 'Falha ao limpar cache.');
    });

    $('btn-fechar').addEventListener('click', fecharPlayer);
    $('modal').addEventListener('click', (ev) => { if (ev.target === $('modal')) fecharPlayer(); });
    $('modal-fontes').addEventListener('click', (ev) => { if (ev.target === $('modal-fontes')) $('modal-fontes').hidden = true; });

    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            if (!$('modal').hidden) fecharPlayer();
            if (!$('modal-fontes').hidden) $('modal-fontes').hidden = true;
        }
    });

    $('seletor-fonte').addEventListener('change', (ev) => {
        if (!estado.player) return;
        estado.player.indice = Number(ev.target.value);
        estado.player.alvoSeek = 0;
        iniciarReproducao(estado.player.transcode ? 'transcode' : 'direto');
    });

    $('seletor-modo').addEventListener('change', (ev) => {
        if (!estado.player) return;
        estado.player.alvoSeek = 0;
        iniciarReproducao(ev.target.value === 'transcode' ? 'transcode' : 'direto');
    });

    $('btn-magnet').addEventListener('click', async () => {
        const item = estado.player && estado.player.item;
        if (!item) return;
        const magnet = item.magnet || ('magnet:?xt=urn:btih:' + item.infoHash);
        try {
            await navigator.clipboard.writeText(magnet);
            toast('Magnet copiado.');
        } catch (_) {
            window.prompt('Magnet:', magnet);
        }
    });

    $('btn-liberar').addEventListener('click', async () => {
        const player = estado.player;
        if (!player || !player.infoHash) return;
        await fetch('/api/cache?infoHash=' + player.infoHash, { method: 'DELETE' });
        toast('Torrent liberado da memória e do disco.');
        fecharPlayer();
    });
}

/* ---------------------------------- inicio -------------------------------- */

function verificarConfiguracaoCapas() {
    fetch('/api/saude')
        .then((resposta) => {
            if (!resposta.ok) throw new Error('falha ao consultar configuração');
            return resposta.json();
        })
        .then((saude) => {
            const aviso = document.getElementById('aviso-config-capas');
            if (aviso) aviso.hidden = Boolean(saude.metadados && saude.metadados.tmdbConfigurado);
        })
        .catch(() => { /* o aviso não bloqueia o catálogo */ });
}

(async function iniciar() {
    carregarFavoritos();
    montarAbas();
    ligarEventos();
    verificarConfiguracaoCapas();
    await carregar();

    setInterval(() => {
        if (!estado.termo && estado.pagina === 1 && !estado.carregando && $('modal').hidden) carregar();
    }, 5 * 60 * 1000);
})();
