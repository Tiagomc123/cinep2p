const BASE = 'https://api.themoviedb.org/3'
const IMAGE = 'https://image.tmdb.org/t/p'
const GENRES = {
  28: 'action', 12: 'adventure', 16: 'animation', 35: 'comedy',
  80: 'crime', 99: 'documentary', 18: 'drama', 10751: 'family',
  14: 'fantasy', 36: 'history', 27: 'horror', 10402: 'music',
  9648: 'mystery', 10749: 'romance', 878: 'sci-fi', 10770: 'tv-movie',
  53: 'thriller', 10752: 'war', 37: 'western'
}
const GENRE_IDS = Object.fromEntries(Object.entries(GENRES).map(([id, name]) => [name, id]))

function apiKey() {
  const key = String(process.env.TMDB_API_KEY || '').trim()
  if (!key) {
    const error = new Error('Configure TMDB_API_KEY no arquivo .env para ativar o catálogo real.')
    error.status = 503
    throw error
  }
  return key
}

async function request(path, params = {}) {
  const url = new URL(BASE + path)
  url.searchParams.set('api_key', apiKey())
  url.searchParams.set('language', 'pt-BR')
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!response.ok) {
    const error = new Error(`TMDB respondeu HTTP ${response.status}.`)
    error.status = response.status === 401 ? 503 : 502
    throw error
  }
  return response.json()
}

function normalize(movie) {
  const poster = movie.poster_path ? IMAGE + '/w500' + movie.poster_path : ''
  const background = movie.backdrop_path ? IMAGE + '/w1280' + movie.backdrop_path : poster
  return {
    id: `tmdb-${movie.id}`,
    tmdbId: movie.id,
    title: movie.title || movie.original_title || 'Título indisponível',
    year: movie.release_date ? Number(movie.release_date.slice(0, 4)) || '' : '',
    rating: Number(movie.vote_average || 0),
    runtime: null,
    genres: (movie.genre_ids || []).map(id => GENRES[id]).filter(Boolean),
    summary: movie.overview || 'Sinopse indisponível em português.',
    poster,
    background,
    torrents: [],
    sourceType: 'metadata'
  }
}

export async function listMovies({ genre = '', sort = 'year', order = 'desc', page = 1 } = {}) {
  const currentPage = Math.min(500, Math.max(1, Number(page) || 1))
  const params = { page: currentPage }
  const genreId = GENRE_IDS[String(genre).toLowerCase()]
  if (genreId) params.with_genres = genreId

  if (sort === 'rating') {
    params.sort_by = 'vote_average.desc'
    params['vote_count.gte'] = 30
  } else if (sort === 'download_count') {
    params.sort_by = 'popularity.desc'
  } else {
    params.sort_by = order === 'asc' ? 'primary_release_date.asc' : 'primary_release_date.desc'
  }

  const data = await request('/discover/movie', params)
  return {
    page: currentPage,
    totalPages: data.total_pages || 1,
    movies: (data.results || []).map(normalize),
    demo: false,
    source: 'TMDB'
  }
}

export async function searchMovies(query) {
  const q = String(query || '').trim().slice(0, 100)
  if (!q) return []
  const data = await request('/search/movie', { query: q, include_adult: 'false', page: 1 })
  return (data.results || []).map(normalize).slice(0, 20)
}
