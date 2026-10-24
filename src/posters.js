'use strict';

const POSITIVE_TTL = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL = 6 * 60 * 60 * 1000;
const CACHE_LIMIT = 500;
const REQUEST_GAP_MS = 180;
const TMDB_BASE = 'https://api.themoviedb.org/3/search/movie';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

function semHtml(value) {
    return String(value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizarTitulo(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/(?:19|20)\d{2}/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(?:2160p|1440p|1080p|720p|480p|4k|uhd|bluray|bdrip|brrip|webrip|webdl|hdtv|dvdrip|remux|hevc|x265|x264|h264|aac|ac3|dts|dublado|dublada|dublados|dubladas|dual|audio|pt|br|ptbr|pob|por|portugues|portuguese|legendado|legendada|nacional|torrent|mkv|mp4|avi|jpg|jpeg|png|webp|gif|tif|poster|file)\b/g, ' ')
        .replace(/\b(?:the|a|an|o|os|as|um|uma|de|do|da|dos|das|movie|film|filme|filmes)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function anoDo(value) {
    return String(value || '').match(/(?:^|[^0-9])((?:19|20)\d{2})(?=$|[^0-9])/)?.[1] || '';
}

function limparTituloParaBusca(value) {
    return String(value || '')
        .replace(/(?:19|20)\d{2}/g, ' ')
        .replace(/\b(?:2160p|1440p|1080p|720p|480p|4k|uhd|bluray|bdrip|brrip|webrip|webdl|hdtv|dvdrip|remux|hevc|x265|x264|h264|aac|ac3|dts|dublado|dublada|dublados|dubladas|dual|audio|pt[-_ ]?br|ptbr|pt|br|pob|por|portugues|portuguese|legendado|legendada|nacional|torrent|mkv|mp4|avi|jpg|jpeg|png|webp|gif|tif|poster|file)\b/gi, ' ')
        .replace(/[._]+/g, ' ')
        .replace(/[()[\]{}]/g, ' ')
        .replace(/\//g, ' ')
        .replace(/\s*[-:]\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function similaridade(titulo, candidato, ano, anoCandidato) {
    const procurado = normalizarTitulo(titulo);
    const correspondente = normalizarTitulo(candidato);
    if (!procurado || !correspondente) return 0;
    if (ano && anoCandidato !== ano) return 0;
    if (procurado === correspondente) return 1;

    const tokens = new Set(procurado.split(' ').filter((token) => token.length > 1));
    const outros = new Set(correspondente.split(' ').filter((token) => token.length > 1));
    if (!tokens.size || !outros.size) return 0;
    let comuns = 0;
    for (const token of tokens) if (outros.has(token)) comuns++;
    return comuns / Math.max(tokens.size, outros.size);
}

function melhorResultadoTmdb(titulo, ano, itens) {
    let melhor = null;
    for (const item of itens || []) {
        const releaseYear = anoDo(item.release_date);
        const score = similaridade(titulo, item.title || item.original_title, ano, releaseYear);
        if (!item.poster_path || score < 0.65) continue;
        if (!melhor || score > melhor.score || (score === melhor.score && (item.vote_count || 0) > (melhor.item.vote_count || 0))) {
            melhor = { item, score, releaseYear };
        }
    }
    if (!melhor) return null;
    return {
        poster: 'https://image.tmdb.org/t/p/w500' + melhor.item.poster_path,
        provider: 'TMDB',
        title: melhor.item.title || melhor.item.original_title || titulo,
        year: melhor.releaseYear,
        attribution: null
    };
}

function licensePermitida(value) {
    const license = semHtml(value);
    return /^(?:CC0(?:\s|$)|Public domain(?:\s|$)|PD(?:\s|-|$)|CC BY(?:-SA)?(?:\s|$))/i.test(license);
}

function paginaDeImagem(pages) {
    if (Array.isArray(pages)) return pages.find((page) => page && page.imageinfo && page.imageinfo[0]) || null;
    return Object.values(pages || {}).find((page) => page && page.imageinfo && page.imageinfo[0]) || null;
}

function criarAtribuicaoCommons(info) {
    const meta = info.extmetadata || {};
    const license = semHtml(meta.LicenseShortName && meta.LicenseShortName.value);
    if (!licensePermitida(license)) return null;
    if (/^CC BY(?:-SA)?\b/i.test(license) && !semHtml((meta.Artist && meta.Artist.value) || (meta.Credit && meta.Credit.value))) return null;
    const author = semHtml((meta.Artist && meta.Artist.value) || (meta.Credit && meta.Credit.value)) || 'Autor não informado';
    if (!/^https:\/\/(?:commons\.wikimedia\.org|upload\.wikimedia\.org)\//i.test(info.descriptionurl || '')) return null;
    return { author: author.slice(0, 180), license, url: info.descriptionurl };
}

function criarPosterResolver(opcoes) {
    const opt = opcoes || {};
    const apiKey = opt.apiKey === undefined ? process.env.TMDB_API_KEY || '' : opt.apiKey;
    const fetchImpl = opt.fetchImpl || globalThis.fetch;
    const sleep = opt.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const now = opt.now || Date.now;
    const timeoutMs = Number(opt.timeoutMs) > 0 ? Number(opt.timeoutMs) : 6500;
    const cache = new Map();
    const pendentes = new Map();
    let proximaRequisicao = 0;

    async function requisitarJson(url) {
        const espera = Math.max(0, proximaRequisicao - now());
        proximaRequisicao = Math.max(now(), proximaRequisicao) + REQUEST_GAP_MS;
        if (espera) await sleep(espera);

        async function requisitarUmaVez() {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const resposta = await fetchImpl(url, {
                    signal: controller.signal,
                    headers: {
                        Accept: 'application/json',
                        'User-Agent': 'CineP2P/3.0 (poster lookup; https://www.themoviedb.org; https://commons.wikimedia.org)'
                    }
                });
                const dados = resposta.ok ? await resposta.json() : null;
                return { resposta, dados };
            } finally {
                clearTimeout(timeout);
            }
        }

        const primeira = await requisitarUmaVez();
        const resposta = primeira.resposta;

        if (resposta.status === 429) {
            const retryAfter = Number(resposta.headers && resposta.headers.get('retry-after'));
            if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 3) {
                await sleep(retryAfter * 1000);
                const retry = await requisitarUmaVez();
                if (!retry.resposta.ok) throw new Error('HTTP ' + retry.resposta.status);
                return retry.dados;
            }
            throw new Error('HTTP 429');
        }
        if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
        return primeira.dados;
    }

    async function buscarTmdb(titulo, ano) {
        if (!apiKey) return null;
        const consulta = limparTituloParaBusca(titulo) || titulo;
        const params = new URLSearchParams({
            api_key: apiKey,
            query: consulta,
            include_adult: 'false',
            language: 'pt-BR'
        });
        if (ano) params.set('year', ano);
        const dados = await requisitarJson(TMDB_BASE + '?' + params.toString());
        return melhorResultadoTmdb(titulo, ano, dados.results);
    }

    async function buscarCommons(titulo, ano) {
        const params = new URLSearchParams({
            action: 'query',
            list: 'search',
            srnamespace: '6',
            srlimit: '6',
            srsearch: '"' + titulo + '" poster' + (ano ? ' ' + ano : ''),
            format: 'json',
            formatversion: '2'
        });
        const search = await requisitarJson(COMMONS_API + '?' + params.toString());
        for (const result of (search.query && search.query.search) || []) {
            const fileTitle = String(result.title || '');
            const yearInTitle = anoDo(fileTitle);
            if (ano && yearInTitle !== ano) continue;
            if (similaridade(titulo, fileTitle, ano, yearInTitle) < 0.65) continue;

            const infoParams = new URLSearchParams({
                action: 'query',
                prop: 'imageinfo',
                iiprop: 'url|extmetadata',
                iiurlwidth: '500',
                titles: fileTitle,
                format: 'json',
                formatversion: '2'
            });
            const image = await requisitarJson(COMMONS_API + '?' + infoParams.toString());
            const page = paginaDeImagem(image.query && image.query.pages);
            const info = page && page.imageinfo && page.imageinfo[0];
            if (!info || !/^https:\/\/upload\.wikimedia\.org\//i.test(info.thumburl || info.url || '')) continue;
            const attribution = criarAtribuicaoCommons(info);
            if (!attribution) continue;
            return {
                poster: info.thumburl || info.url,
                provider: 'Wikimedia Commons',
                title: fileTitle.replace(/^File:/, ''),
                year: yearInTitle,
                attribution
            };
        }
        return null;
    }

    function gravarCache(key, value) {
        cache.delete(key);
        cache.set(key, { expires: now() + (value.poster ? POSITIVE_TTL : NEGATIVE_TTL), value });
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    }

    async function resolver(titulo, anoInformado) {
        const nome = String(titulo || '').trim().slice(0, 180);
        if (!nome) return { poster: '', provider: null, title: '', year: '', attribution: null };
        const ano = anoDo(anoInformado) || anoDo(nome);
        const chave = normalizarTitulo(nome) + '|' + ano;
        const guardado = cache.get(chave);
        if (guardado && guardado.expires > now()) {
            cache.delete(chave);
            cache.set(chave, guardado);
            return guardado.value;
        }
        if (guardado) cache.delete(chave);
        if (pendentes.has(chave)) return pendentes.get(chave);

        const pedido = (async () => {
            let resultado = null;
            try { resultado = await buscarTmdb(nome, ano); } catch (_) { /* tenta a fonte aberta de fallback */ }
            if (!resultado) {
                try { resultado = await buscarCommons(nome, ano); } catch (_) { /* fonte aberta indisponível */ }
            }
            const final = resultado || { poster: '', provider: null, title: nome, year: ano, attribution: null };
            gravarCache(chave, final);
            return final;
        })().finally(() => pendentes.delete(chave));

        pendentes.set(chave, pedido);
        return pedido;
    }

    return { resolve: resolver, clearCache: () => cache.clear(), cacheSize: () => cache.size };
}

module.exports = { criarPosterResolver, normalizarTitulo, similaridade, licensePermitida };
