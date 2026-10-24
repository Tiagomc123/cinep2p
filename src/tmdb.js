'use strict';

const BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

function cfg() {
  return {
    apiKey: (process.env.TMDB_API_KEY || '').trim(),
    bearer: (process.env.TMDB_BEARER_TOKEN || '').trim(),
    language: (process.env.TMDB_LANGUAGE || 'pt-BR').trim(),
    region: (process.env.TMDB_REGION || 'BR').trim()
  };
}

function isConfigured() {
  const c = cfg();
  if (c.bearer.length > 20) return true;
  if (!c.apiKey || c.apiKey === 'SUA_CHAVE_AQUI') return false;
  return c.apiKey.length >= 8;
}

function img(pathname, size) {
  if (!pathname) return null;
  return IMAGE_BASE + '/' + (size || 'w500') + pathname;
}

const cache = new Map();
const TTL = 1000 * 60 * 15;

function cacheGet(k) {
  const hit = cache.get(k);
  if (!hit) return null;
  if (Date.now() > hit.expires) { cache.delete(k); return null; }
  return hit.value;
}
function cacheSet(k, v) {
  if (cache.size > 500) cache.clear();
  cache.set(k, { value: v, expires: Date.now() + TTL });
}

async function request(pathname, params) {
  const c = cfg();
  if (!isConfigured()) {
    const err = new Error('TMDB_API_KEY nao configurada. Edite o .env e reinicie.');
    err.code = 'TMDB_NOT_CONFIGURED';
    throw err;
  }
  const url = new URL(BASE + pathname);
  url.searchParams.set('language', c.language);
  if (c.region) url.searchParams.set('region', c.region);
  if (params) {
    Object.keys(params).forEach(function (k) {
      const v = params[k];
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    });
  }
  const headers = { accept: 'application/json' };
  if (c.bearer.length > 20) headers.authorization = 'Bearer ' + c.bearer;
  else url.searchParams.set('api_key', c.apiKey);

  const key = url.toString();
  const cached = cacheGet(key);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 15000);
  try {
    const res = await fetch(url, { headers: headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(function () { return ''; });
      const err = new Error('TMDb respondeu ' + res.status + (body ? ' - ' + body.slice(0, 180) : ''));
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    cacheSet(key, data);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('TMDb demorou demais (timeout 15s).');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function normalize(item, tipo) {
  if (!item) return null;
  const kind = tipo || (item.media_type === 'tv' || item.first_air_date ? 'tv' : 'movie');
  const date = item.release_date || item.first_air_date || '';
  const titulo = item.title || item.name || item.original_title || item.original_name || 'Sem titulo';
  return {
    id: item.id,
    tipo: kind === 'tv' ? 'tv' : 'movie',
    titulo: titulo,
    tituloOriginal: item.original_title || item.original_name || titulo,
    ano: date ? String(date).slice(0, 4) : '',
    sinopse: item.overview || '',
    nota: typeof item.vote_average === 'number' ? item.vote_average : 0,
    votos: item.vote_count || 0,
    popularidade: item.popularity || 0,
    poster: img(item.poster_path, 'w500') || img(item.backdrop_path, 'w780'),
    backdrop: img(item.backdrop_path, 'w1280') || img(item.poster_path, 'w780'),
    generos: (item.genre_ids || []).slice()
  };
}

function filtrar(results, kind) {
  return (results || [])
    .filter(function (r) { return r && (r.poster_path || r.backdrop_path); })
    .map(function (r) { return normalize(r, kind); });
}

async function list(pathname, params, tipo) {
  const data = await request(pathname, params);
  const kind = tipo || (pathname.indexOf('/tv') === 0 ? 'tv' : 'movie');
  return filtrar((data && data.results) || [], kind);
}

async function discover(tipo, params) {
  const kind = tipo === 'tv' ? 'tv' : 'movie';
  const data = await request('/discover/' + kind, params);
  return filtrar((data && data.results) || [], kind);
}

function isoHoje(offsetDias) {
  const d = new Date(Date.now() + (offsetDias || 0) * 86400000);
  return d.toISOString().slice(0, 10);
}

async function lancamentos(tipo) {
  const campo = tipo === 'tv' ? 'first_air_date' : 'primary_release_date';
  const params = { sort_by: 'popularity.desc', 'vote_count.gte': 10, page: 1 };
  params[campo + '.gte'] = isoHoje(-365);
  params[campo + '.lte'] = isoHoje(0);
  return discover(tipo, params);
}

async function porGenero(tipo, generoId, pagina) {
  return discover(tipo, {
    with_genres: generoId,
    sort_by: 'popularity.desc',
    'vote_count.gte': 30,
    page: pagina || 1
  });
}

async function generos(tipo) {
  const kind = tipo === 'tv' ? 'tv' : 'movie';
  const data = await request('/genre/' + kind + '/list');
  return ((data && data.genres) || []).map(function (g) { return { id: g.id, nome: g.name }; });
}

function pickTrailer(videos) {
  const yt = (videos || []).filter(function (v) { return v.site === 'YouTube' && v.key; });
  if (!yt.length) return null;
  function score(v) {
    let s = 0;
    if (v.type === 'Trailer') s += 100;
    else if (v.type === 'Teaser') s += 40;
    if (v.iso_639_1 === 'pt') s += 30;
    else if (v.iso_639_1 === 'en') s += 15;
    if (v.official) s += 10;
    return s;
  }
  return yt.slice().sort(function (a, b) { return score(b) - score(a); })[0] || null;
}

async function detalhes(tipo, id) {
  const kind = tipo === 'tv' ? 'tv' : 'movie';
  const data = await request('/' + kind + '/' + id, { append_to_response: 'videos,external_ids,credits,images' });
  const base = normalize(data, kind);
  const videos = (data.videos && data.videos.results) || [];
  return Object.assign(base, {
    tagline: data.tagline || '',
    duracao: data.runtime || (Array.isArray(data.episode_run_time) ? data.episode_run_time[0] : null) || null,
    generos: (data.genres || []).map(function (g) { return { id: g.id, nome: g.name }; }),
    temporadas: (data.seasons || []).filter(function (s) { return s.season_number > 0; })
      .map(function (s) { return { numero: s.season_number, nome: s.name, episodios: s.episode_count }; }),
    elenco: ((data.credits && data.credits.cast) || []).slice(0, 14).map(function (c) {
      return { nome: c.name, personagem: c.character, foto: img(c.profile_path, 'w185') };
    }),
    imdbId: (data.external_ids && data.external_ids.imdb_id) || null,
    trailer: pickTrailer(videos)
  });
}

async function buscar(query, tipo) {
  const data = await request('/search/multi', { query: query, include_adult: 'false' });
  const results = ((data && data.results) || []).filter(function (r) {
    if (r.media_type !== 'movie' && r.media_type !== 'tv') return false;
    if (tipo && r.media_type !== tipo) return false;
    return r.poster_path || r.backdrop_path;
  });
  return results.map(function (r) { return normalize(r, r.media_type); }).slice(0, 40);
}

module.exports = {
  isConfigured, request, list, discover, lancamentos, porGenero, generos,
  detalhes, buscar, normalize, img, cfg
};