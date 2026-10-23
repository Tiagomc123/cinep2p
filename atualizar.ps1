# cinep2p - aplica a atualizacao completa de uma vez
# Uso: coloque este arquivo na raiz do projeto (junto do package.json) e rode:
#   powershell -ExecutionPolicy Bypass -File .\atualizar.ps1

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $root 'package.json'))) { $root = (Get-Location).Path }
if (-not (Test-Path (Join-Path $root 'package.json'))) {
  Write-Host 'Coloque este script na raiz do projeto cinep2p (junto do package.json).' -ForegroundColor Red
  exit 1
}

$criados = 0
$mudados = 0

function W($rel, $text) {
  $full = Join-Path $root $rel
  $dir  = Split-Path -Parent $full
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $novo = -not (Test-Path $full)
  [System.IO.File]::WriteAllText($full, $text, $utf8)
  if ($novo) { $script:criados++; Write-Host ("  [criado]    " + $rel) -ForegroundColor Green }
  else       { $script:mudados++; Write-Host ("  [atualizado] " + $rel) -ForegroundColor Yellow }
}

Write-Host ''
Write-Host 'cinep2p - aplicando atualizacao' -ForegroundColor Cyan
Write-Host ''

# ---------------------------------------------------------------- RESUMO.md
W 'RESUMO.md' @'
# cinep2p — resumo do projeto

Agregador de catálogo + streaming de torrent no navegador, com catálogo PT-BR,
séries por episódio, TV ao vivo e acervo de domínio público.
Roda em PC, Android, TV Box e projetor (PWA instalável).

## Stack

- Node.js 20+ / Express
- WebTorrent (torrent no servidor)
- ffmpeg/ffprobe (remux e transcode)
- Front-end vanilla (sem build), PWA
- hls.js (apenas na página de TV ao vivo)

## Fontes de conteúdo

| Fonte | O que traz | Tipo |
|---|---|---|
| YTS | catálogo e capas de filme internacional | torrent |
| The Pirate Bay (apibay) | releases PT-BR (dublado, nacional, dual, legendado) e séries | torrent |
| iptv-org | canais de TV ao vivo do mundo (país e categoria) | HLS |
| Internet Archive | domínio público: documentários, clássicos, animação, noir | HTTP direto |
| TVMaze | metadados de série, temporadas e episódios | metadados |

Nenhuma fonte exige chave de API.

## Catálogo (4 modos)

- **PT-BR**: prateleiras dubladas/nacional/dual/legendado + tops HD e DVD
- **Mundo**: catálogo YTS
- **Séries**: prateleiras de séries PT-BR e busca de série por episódio (TVMaze)
- **Docs**: documentários, clássicos e animação de domínio público

Botão **Dublado** força PT-BR em todos os modos. Filtro de gênero ativo.

## Busca

- Consulta o YTS (metadados/capa) em paralelo com o TPB
- A busca no TPB dispara várias consultas em paralelo (termo, termo dublado,
  termo nacional, termo dual audio, termo legendado) e mescla por hash
- Releases PT-BR aparecem sempre primeiro; o resto vem depois
- Resultados sem capa buscam a arte automaticamente

## Player

- Modos: Direto -> Compatível (remux) -> Leve (transcode 720p/480p), com fallback
  automático quando o navegador recusa o formato
- Troca de faixa de áudio pelas trilhas reais do arquivo (remux)
- Legendas externas e embutidas no mkv, com ligar/desligar
- Retomar de onde parou, com cópia local no navegador
- Botão Diagnóstico (peers, arquivo, codec, leitura, decisão)
- Controle remoto: setas navegam, OK seleciona, Voltar fecha

## Séries

- Busca de série por nome (TVMaze) -> temporadas -> episódios
- Cada episódio busca releases no TPB e lista as fontes
- Progresso guardado por série/temporada/episódio (tv:<id>:<TxE>), então
  "Continuar assistindo" volta no episódio certo mesmo trocando de release

## TV ao vivo

- Página /live.html: filtro por país, categoria e busca
- Proxy HLS no servidor (resolve CORS e reescreve a playlist)

## Espaço em disco

- Os dados temporários ficam em ./downloads/<hash>
- Ao fechar o player ou terminar o vídeo, o torrent é removido e os arquivos apagados
- Torrents ociosos são liberados após IDLE_MINUTES (padrão 5 min)
- Botão Cache mostra o uso e permite liberar tudo na hora
- Só o progresso permanece, em ./data/progress.json

## Endpoints principais

/api/health /api/catalog /api/br /api/search /api/extra /api/poster
/api/tv/search /api/tv/show/:id /api/tv/find
/api/live/meta /api/live /api/live/proxy
/api/archive /api/archive/:id
/api/prepare/:hash /api/stream/:hash /api/subs/:hash /api/status/:hash
/api/stop/:hash /api/diag/:hash
/api/progress /api/storage /api/cleanup

## Variáveis de ambiente

PORT, DOWNLOAD_DIR, DATA_DIR, METADATA_TIMEOUT (120), IDLE_MINUTES (5),
TRANSCODE_PRESET, TRANSCODE_CRF, MAX_CONNS, PROBE_BYTES,
FFMPEG_PATH, FFPROBE_PATH, FFMPEG_DISABLE=1, QUIET=1, HTTPS=1

## Rodar

    npm install
    npm run https     # https://SEU-IP:3000  (use para instalar como app)
    npm start         # http://localhost:3000

## Limites conhecidos

- Canais de TV ao vivo são links públicos e caem com frequência
- O proxy HLS usa a banda do servidor
- Domínio público do Archive.org costuma ter legenda só em inglês
- Filme brasileiro obscuro pode não ter capa (o YTS não cataloga produção nacional)
'@

# ---------------------------------------------------------------- src/lang.js
W 'src/lang.js' @'
// Deteccao de idioma em nomes de release + nomes de codigos ISO.

const NAMES = {
  por: 'Portugues', pob: 'Portugues (BR)', pt: 'Portugues', ptbr: 'Portugues (BR)',
  eng: 'Ingles', en: 'Ingles', spa: 'Espanhol', es: 'Espanhol', lat: 'Latino',
  ita: 'Italiano', it: 'Italiano', fra: 'Frances', fre: 'Frances', fr: 'Frances',
  deu: 'Alemao', ger: 'Alemao', de: 'Alemao', jpn: 'Japones', jp: 'Japones',
  kor: 'Coreano', rus: 'Russo', zho: 'Chines', chi: 'Chines', zh: 'Chines',
  ara: 'Arabe', hin: 'Hindi', nld: 'Holandes', dut: 'Holandes', nl: 'Holandes',
  pol: 'Polones', tur: 'Turco', swe: 'Sueco', ces: 'Tcheco', cze: 'Tcheco',
  hun: 'Hungaro', heb: 'Hebraico', ell: 'Grego', gre: 'Grego', dan: 'Dinamarques',
  nor: 'Noruegues', fin: 'Finlandes', ukr: 'Ucraniano', ron: 'Romeno', rum: 'Romeno',
  ind: 'Indonesio', tha: 'Tailandes', vie: 'Vietnamita', cat: 'Catalao', fas: 'Persa',
  mul: 'Multi-idioma', und: 'Original'
}
export const langName = c => NAMES[String(c || '').toLowerCase()] || String(c || '').toUpperCase() || 'Desconhecido'

const PT = /(dublado|dublada|dublagem|nacional|brasileir[oa]|brazilian|\bptbr\b|\bpt[-_. ]?br\b|\bpob\b|\bbrdub\b|\bbr[-_. ]?dub\b|portugu[eê]s|\bpor\b)/i
const DUAL = /(dual[ ._-]?[aá]udio|dual[ ._-]?audio|\bdual\b|multi[ ._-]?[aá]udio)/i
const LEG = /(legendado|legendad[ao]|legendas?|subbed|subtitled|\bsubs?\b)/i

const LANGS = [
  [/\b(ita|italian)\b/i, 'ita'], [/\b(spa|espa[ñn]ol|castellano|latino|spanish)\b/i, 'spa'],
  [/\b(fra|french|truefrench|vff|vfq)\b/i, 'fra'], [/\b(german|deutsch|ger)\b/i, 'deu'],
  [/\b(japanese|jap|jpn)\b/i, 'jpn'], [/\b(korean|kor)\b/i, 'kor'], [/\b(russian|rus)\b/i, 'rus'],
  [/\b(hindi|hin)\b/i, 'hin'], [/\b(chinese|mandarin|cantonese|chi|zho)\b/i, 'zho'],
  [/\b(english|eng)\b/i, 'eng'], [/\b(pt[-_ .]?br|portugu[eê]s|portugues|dublado|nacional)\b/i, 'ptbr']
]

export function isPortuguese(name) { return PT.test(String(name || '')) }

export function detectAudio(name) {
  const s = String(name || '')
  const langs = []
  const dub = isPortuguese(s)
  const dual = DUAL.test(s)
  if (dub) langs.push('ptbr')
  for (const [re, code] of LANGS) if (re.test(s)) langs.push(code)
  return { dub, dual, subs: LEG.test(s), langs: [...new Set(langs)] }
}

export function matchesLang(item, lang) {
  const s = String(lang || '').trim().toLowerCase()
  if (!s || s === 'all' || s === 'world') return true
  const title = typeof item === 'string' ? item : String(item?.title || item?.name || '')
  const meta = item && typeof item === 'object' ? item : {}
  const audio = detectAudio(title)
  const dub = Boolean(meta.dub) || isPortuguese(title)
  const dual = Boolean(meta.dual) || DUAL.test(title)
  const subs = Boolean(meta.subs) || LEG.test(title)
  if (['dub', 'dublado', 'dublada'].includes(s)) return dub
  if (['dual', 'dual-audio', 'dualaudio'].includes(s)) return dual
  if (['subs', 'sub', 'legendado'].includes(s)) return subs
  if (['ptbr', 'pt-br', 'pt', 'por', 'pob', 'portuguese', 'portugues'].includes(s)) {
    return dub || (meta.langs || audio.langs).includes('ptbr') || dual || subs
  }
  return (meta.langs || audio.langs).includes(s)
}
'@

# ---------------------------------------------------------------- src/apibay.js
W 'src/apibay.js' @'
import { detectAudio, isPortuguese, matchesLang } from './lang.js'

const MIRRORS = ['https://apibay.org', 'https://apibay.qicp.vip']
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

const VIDEO_CATS = new Set([201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 505])
const CAT = { 201: 'DVD', 205: 'Serie', 207: 'HD', 208: 'Serie HD', 209: '3D', 211: '4K', 505: 'Adulto', 601: 'Livro', 602: 'HQ', 104: 'FLAC', 102: 'Audio livro' }

function human(bytes) {
  if (!bytes) return '?'
  const gb = bytes / 1e9
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1e6).toFixed(0)} MB`
}
function qualityOf(name) {
  if (/2160p|4k/i.test(name)) return '2160p'
  if (/1080p/i.test(name)) return '1080p'
  if (/720p/i.test(name)) return '720p'
  if (/480p/i.test(name)) return '480p'
  return 'SD'
}
function codecOf(name) {
  if (/x265|h\.?265|hevc/i.test(name)) return 'x265'
  if (/x264|h\.?264|avc/i.test(name)) return 'x264'
  if (/\bav1\b/i.test(name)) return 'AV1'
  if (/xvid|divx/i.test(name)) return 'XviD'
  return ''
}

async function fetchEndpoint(endpoint) {
  let lastErr
  for (const base of MIRRORS) {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 12000)
    try {
      const r = await fetch(`${base}/${endpoint}`, {
        signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'application/json' }
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      if (Array.isArray(j)) return j
      lastErr = new Error('resposta inesperada do apibay')
    } catch (e) { lastErr = e } finally { clearTimeout(to) }
  }
  throw lastErr || new Error('apibay indisponivel')
}

function normalizeResults(j) {
  if (!j.length || j[0].name === 'No results returned') return []
  return j.map(x => {
    const name = String(x.name || '')
    const size = Number(x.size) || 0
    const cat = Number(x.category) || 0
    const lang = detectAudio(name)
    return {
      hash: String(x.info_hash || '').toLowerCase(),
      title: name,
      seeds: Number(x.seeders) || 0,
      peers: Number(x.leechers) || 0,
      sizeBytes: size,
      size: human(size),
      quality: qualityOf(name),
      codec: codecOf(name),
      category: cat,
      kind: CAT[cat] || '',
      video: VIDEO_CATS.has(cat),
      imdb: x.imdb || '',
      files: Number(x.num_files) || 0,
      dub: lang.dub,
      dual: lang.dual,
      subs: lang.subs,
      langs: lang.langs,
      source: 'TPB'
    }
  }).filter(x => x.seeds > 0 && /^[0-9a-f]{40}$/.test(x.hash))
}

export function score(t) {
  let s = Math.min(t.seeds, 250)
  if (t.quality === '1080p') s += 60
  else if (t.quality === '720p') s += 35
  else if (t.quality === '2160p') s += 12
  if (t.codec === 'x264') s += 14
  if (t.codec === 'x265') s += 6
  if (t.dub || (t.langs || []).includes('ptbr') || isPortuguese(t.title)) s += 1500
  else if (t.dual) s += 350
  else if (t.subs) s += 100
  if (/\b(cam|hdcam|ts)\b/i.test(t.title)) s -= 45
  if (/\b3d\b/i.test(t.title)) s -= 12
  if (!t.video) s -= 90
  if (t.files === 0) s -= 25
  const gb = t.sizeBytes / 1e9
  if (gb > 4) s -= (gb - 4) * 4
  if (gb < 0.2) s -= 15
  return s
}

export async function searchApibay(q) { return normalizeResults(await fetchEndpoint(`q.php?q=${encodeURIComponent(q)}`)) }

export async function topMovies(cats = [201, 207]) {
  const categories = [...new Set((Array.isArray(cats) ? cats : [cats]).map(Number).filter(n => VIDEO_CATS.has(n)))].slice(0, 8)
  const lists = await Promise.all(categories.map(cat => fetchEndpoint(`top.php?cat=${encodeURIComponent(cat)}`).then(normalizeResults).catch(() => [])))
  return [...new Map(lists.flat().map(x => [x.hash, x])).values()]
}

export async function brShelf(queries = []) {
  const terms = [...new Set((Array.isArray(queries) ? queries : [queries]).map(x => String(x || '').trim()).filter(Boolean))].slice(0, 8)
  const lists = await Promise.all(terms.map(q => searchApibay(q).catch(() => [])))
  return [...new Map(lists.flat().map(x => [x.hash, x])).values()]
}

export function rank(list, { onlyDub = false } = {}) {
  const out = onlyDub ? list.filter(t => t.dub || matchesLang(t.title, 'dub')) : [...list]
  return out.sort((a, b) => score(b) - score(a))
}
'@

# ---------------------------------------------------------------- src/search.js
W 'src/search.js' @'
// Busca ampla no TPB: varias consultas em paralelo, PT-BR sempre primeiro.

import { searchApibay, rank } from './apibay.js'
import { matchesLang } from './lang.js'

const PT_TERMS = ['dublado', 'nacional', 'dual audio', 'legendado']

export async function searchAll(q, { onlyDub = false, limit = 50 } = {}) {
  const base = String(q || '').trim()
  if (!base) return { extras: [], total: 0 }

  const queries = onlyDub
    ? [`${base} dublado`, `${base} nacional`, `${base} dublado 1080p`]
    : [base, ...PT_TERMS.map(t => `${base} ${t}`)]

  const lists = await Promise.all(queries.map(x => searchApibay(x).catch(() => [])))

  const seen = new Map()
  for (const arr of lists) for (const t of arr) if (!seen.has(t.hash)) seen.set(t.hash, t)

  let all = [...seen.values()]
  if (onlyDub) {
    const dub = all.filter(t => matchesLang(t, 'dub'))
    if (dub.length) all = dub
  }

  const pt = []
  const rest = []
  for (const t of all) (matchesLang(t, 'pt') ? pt : rest).push(t)

  return { extras: [...rank(pt), ...rank(rest)].slice(0, limit), total: all.length }
}
'@

# ---------------------------------------------------------------- src/tv.js
W 'src/tv.js' @'
// Series: metadados via TVMaze (sem chave) + busca de release no TPB.

import { searchApibay, rank } from './apibay.js'
import { matchesLang } from './lang.js'

const TVMAZE = 'https://api.tvmaze.com'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

async function getJSON(url, ms = 15000) {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'application/json' } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally { clearTimeout(to) }
}

const plain = (html, n) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)

export async function tvSearch(q) {
  const term = String(q || '').trim().slice(0, 80)
  if (!term) return { results: [] }
  const data = await getJSON(`${TVMAZE}/search/shows?q=${encodeURIComponent(term)}`)
  const results = (Array.isArray(data) ? data : [])
    .map(x => x?.show).filter(Boolean)
    .map(s => ({
      id: s.id,
      name: s.name,
      year: (s.premiered || '').slice(0, 4),
      poster: s.image?.medium || s.image?.original || '',
      summary: plain(s.summary, 400),
      genres: s.genres || [],
      status: s.status || ''
    }))
  return { results }
}

export async function tvShow(showId) {
  const id = Number(showId)
  if (!Number.isFinite(id)) return { show: null, seasons: [] }
  const [show, eps] = await Promise.all([
    getJSON(`${TVMAZE}/shows/${id}`).catch(() => null),
    getJSON(`${TVMAZE}/shows/${id}/episodes`).catch(() => [])
  ])
  const list = (Array.isArray(eps) ? eps : []).filter(e => Number(e.season) > 0 && Number(e.number) > 0)
  const bySeason = new Map()
  for (const e of list) {
    if (!bySeason.has(e.season)) bySeason.set(e.season, [])
    bySeason.get(e.season).push({
      season: e.season,
      episode: e.number,
      name: e.name || `Episodio ${e.number}`,
      airdate: e.airdate || '',
      summary: plain(e.summary, 300)
    })
  }
  return {
    show: show ? {
      id: show.id, name: show.name,
      poster: show.image?.medium || '', year: (show.premiered || '').slice(0, 4)
    } : null,
    seasons: [...bySeason.entries()]
      .map(([season, episodes]) => ({ season, episodes: episodes.sort((a, b) => a.episode - b.episode) }))
      .sort((a, b) => a.season - b.season)
  }
}

export async function tvFind({ title, season, episode, dub = true }) {
  const clean = String(title || '').replace(/[^\w\s'.-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean) return { results: [] }
  const s = String(season).padStart(2, '0')
  const e = String(episode).padStart(2, '0')
  const code = `S${s}E${e}`

  const queries = [
    `${clean} ${code}`,
    `${clean} ${code} dublado`,
    `${clean} ${code} 1080p`,
    `${clean} ${season}x${e}`
  ]
  const lists = await Promise.all(queries.map(q => searchApibay(q).catch(() => [])))

  const seen = new Map()
  for (const arr of lists) for (const t of arr) if (!seen.has(t.hash)) seen.set(t.hash, t)

  const norm = v => String(v).toUpperCase().replace(/[^A-Z0-9]/g, '')
  const alt = new RegExp(`\\b${season}\\s*[xX]\\s*${e}\\b`)

  let all = [...seen.values()].filter(t => norm(t.title).includes(code) || alt.test(t.title))
  if (!all.length) all = [...seen.values()]

  if (dub) {
    const pt = all.filter(t => matchesLang(t, 'pt'))
    if (pt.length) all = pt
  }
  return { results: rank(all).slice(0, 30) }
}
'@

# ---------------------------------------------------------------- src/live.js
W 'src/live.js' @'
// Canais de TV ao vivo e publicos via iptv-org (playlists M3U, sem chave).

const COUNTRY_LIST = 'https://iptv-org.github.io/iptv/index.country.m3u'
const CATEGORY_LIST = 'https://iptv-org.github.io/iptv/index.category.m3u'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
const TTL = 12 * 60 * 60 * 1000

let cache = { at: 0, byCountry: [], byCategory: [] }

function parseM3U(text) {
  const out = []
  let cur = null
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#EXTINF')) {
      const logo = (/(?:tvg-logo|logo)="([^"]*)"/i.exec(line) || [])[1] || ''
      const group = (/group-title="([^"]*)"/i.exec(line) || [])[1] || ''
      const name = (line.split(',').pop() || '').trim()
      cur = { name, logo, group, url: '' }
    } else if (line.startsWith('#')) {
      continue
    } else if (cur) {
      cur.url = line
      if (cur.url && cur.name) out.push(cur)
      cur = null
    }
  }
  return out
}

async function getText(url, ms = 30000) {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.text()
  } finally { clearTimeout(to) }
}

export async function ensureLive() {
  if (cache.at && Date.now() - cache.at < TTL) return cache
  const [countries, categories] = await Promise.all([
    getText(COUNTRY_LIST).then(parseM3U).catch(() => []),
    getText(CATEGORY_LIST).then(parseM3U).catch(() => [])
  ])
  if (!countries.length && !categories.length && cache.at) return cache
  cache = { at: Date.now(), byCountry: countries, byCategory: categories }
  return cache
}

export async function liveMeta() {
  const c = await ensureLive()
  const countries = [...new Set(c.byCountry.map(x => x.group).filter(Boolean))].sort()
  const categories = [...new Set(c.byCategory.map(x => x.group).filter(Boolean))].sort()
  return { countries, categories, total: c.byCountry.length }
}

export async function liveChannels({ country = '', category = '', q = '', page = 1, limit = 60 } = {}) {
  const c = await ensureLive()
  let base
  if (country && category) {
    const urls = new Set(c.byCategory.filter(x => x.group === category).map(x => x.url))
    base = c.byCountry.filter(x => x.group === country && urls.has(x.url))
  } else if (country) {
    base = c.byCountry.filter(x => x.group === country)
  } else if (category) {
    base = c.byCategory.filter(x => x.group === category)
  } else {
    base = c.byCountry
  }
  const term = String(q || '').trim().toLowerCase()
  if (term) base = base.filter(x => x.name.toLowerCase().includes(term) || x.group.toLowerCase().includes(term))
  const seen = new Set()
  const uniq = []
  for (const x of base) { if (seen.has(x.url)) continue; seen.add(x.url); uniq.push(x) }
  const p = Math.max(1, page)
  return { total: uniq.length, page: p, channels: uniq.slice((p - 1) * limit, (p - 1) * limit + limit) }
}
'@

# ---------------------------------------------------------------- src/archive.js
W 'src/archive.js' @'
// Filmes de dominio publico, documentarios e animacao classica (Internet Archive).

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

export const COLLECTIONS = {
  documentarios: 'documentary',
  filmes: 'feature_films',
  animacao: 'animationandcartoons',
  classico: 'classic_cartoons',
  noir: 'film_noir',
  ficcao: 'sci-fi_horror',
  silencioso: 'silent_films',
  prelinger: 'prelinger'
}

async function getJSON(url, ms = 20000) {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'application/json' } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally { clearTimeout(to) }
}

export async function archiveSearch({ q = '', collection = '', page = 1, limit = 24 } = {}) {
  const parts = ['mediatype:movies']
  if (collection) parts.push(`collection:${collection}`)
  const term = String(q || '').trim()
  if (term) parts.push(`(${term})`)
  const params = new URLSearchParams()
  params.set('q', parts.join(' AND '))
  for (const f of ['identifier', 'title', 'year', 'description', 'downloads']) params.append('fl[]', f)
  params.set('sort[]', 'downloads desc')
  params.set('rows', String(limit))
  params.set('page', String(Math.max(1, page)))
  params.set('output', 'json')
  const data = await getJSON(`https://archive.org/advancedsearch.php?${params}`)
  const docs = data?.response?.docs || []
  return {
    total: Number(data?.response?.numFound) || 0,
    results: docs.map(d => ({
      id: d.identifier,
      title: String(d.title || d.identifier || '').replace(/\s+/g, ' ').trim(),
      year: d.year || '',
      summary: String(d.description || '').replace(/\s+/g, ' ').slice(0, 400),
      poster: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
      source: 'Archive.org'
    })).filter(x => x.id)
  }
}

export async function archiveStream(identifier) {
  const id = String(identifier || '').trim()
  if (!/^[\w.\-]{1,120}$/.test(id)) return null
  const md = await getJSON(`https://archive.org/metadata/${id}`)
  const files = md?.files || []
  const pick =
    files.find(f => /\.(mp4|m4v)$/i.test(f.name || '') && /h\.?264|mpeg4|512kb|mp4/i.test(f.format || '')) ||
    files.find(f => /\.(mp4|m4v)$/i.test(f.name || '')) ||
    files.find(f => /\.(ogv|webm)$/i.test(f.name || ''))
  if (!pick) return null
  return {
    url: `https://archive.org/download/${id}/${encodeURIComponent(pick.name)}`,
    size: Number(pick.size) || 0,
    format: pick.format || ''
  }
}
'@

# ---------------------------------------------------------------- src/streamer.js
W 'src/streamer.js' @'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import WebTorrent from 'webtorrent'
import { buildMagnet, TRACKERS } from './yts.js'
import { ensureFfmpeg, ffmpegCmd, ffmpegInfo, probe } from './ffmpeg.js'
import { langName } from './lang.js'

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(process.cwd(), 'downloads')
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const SUBS_DIR = path.join(DATA_DIR, 'subs')
const METADATA_TIMEOUT = Math.max(20, Number(process.env.METADATA_TIMEOUT || 120)) * 1000
const IDLE_MINUTES = Math.max(1, Number(process.env.IDLE_MINUTES || 5))
const PRESET = process.env.TRANSCODE_PRESET || 'veryfast'
const CRF = process.env.TRANSCODE_CRF || '23'
const PROBE_BYTES = Number(process.env.PROBE_BYTES || 8 * 1024 * 1024)

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
fs.mkdirSync(SUBS_DIR, { recursive: true })

const VIDEO_RE = /\.(mp4|m4v|mkv|webm|avi|mov|mpg|mpeg|m2ts|ts|flv|wmv|ogv|divx)$/i
const SUB_RE = /\.(srt|vtt|ass|ssa)$/i
const DIRECT_RE = /\.(mp4|m4v|webm|ogv)$/i
const SAFE_V = ['h264', 'vp8', 'vp9', 'av1']
const SAFE_A = ['aac', 'mp3', 'opus', 'vorbis']
const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime', ts: 'video/mp2t', ogv: 'video/ogg' }

const log = (...a) => { if (process.env.QUIET !== '1') console.log('[cinep2p]', ...a) }

const client = new WebTorrent({ maxConns: Number(process.env.MAX_CONNS || 80) })
const registry = new Map()
const probeCache = new Map()
const subJobs = new Map()

client.on('error', e => log('erro do cliente:', e?.message || e))
client.on('warning', e => log('aviso:', e?.message || e))

/* ---------- torrents ---------- */

export function ensureTorrent(hash, name = '') {
  const key = String(hash || '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(key)) return Promise.reject(new Error('hash invalido'))

  const hit = registry.get(key)
  if (hit) { hit.lastUsed = Date.now(); return hit.ready }

  const entry = { key, name, torrent: null, timer: null, lastUsed: Date.now() }
  entry.ready = new Promise((resolve, reject) => {
    let settled = false
    const fail = err => {
      if (settled) return
      settled = true
      clearTimeout(entry.timer)
      registry.delete(key)
      client.remove(key, { destroyStore: true }).catch(() => {})
      log('falha no torrent', key.slice(0, 8), '-', err.message)
      reject(err)
    }
    try {
      entry.torrent = client.add({ infoHash: key, name: String(name || '').slice(0, 120) }, { path: path.join(DOWNLOAD_DIR, key), announce: TRACKERS, destroyStoreOnDestroy: true })
    } catch (e) { return fail(e) }

    log('adicionado', key.slice(0, 8), name || '')

    entry.timer = setTimeout(() => {
      const peers = entry.torrent ? entry.torrent.numPeers : 0
      fail(new Error(peers
        ? `Os ${peers} peers conectados nao enviaram os metadados em ${METADATA_TIMEOUT / 1000}s. Tente outra fonte.`
        : `Nenhum peer encontrado em ${METADATA_TIMEOUT / 1000}s. Tente outra qualidade ou fonte.`))
    }, METADATA_TIMEOUT)

    entry.torrent.once('metadata', () => log('metadados ok', key.slice(0, 8)))
    entry.torrent.once('ready', () => {
      if (settled) return
      settled = true
      clearTimeout(entry.timer)
      log('pronto', key.slice(0, 8), entry.torrent.files.length, 'arquivo(s)')
      resolve(entry.torrent)
    })
    entry.torrent.on('error', err => fail(err))
  })

  registry.set(key, entry)
  entry.ready.catch(() => {})
  return entry.ready
}

export async function stop(hash) {
  const key = String(hash || '').toLowerCase()
  const entry = registry.get(key)
  registry.delete(key)
  if (entry) clearTimeout(entry.timer)
  try { await client.remove(key, { destroyStore: true }) } catch {}
}

export const active = () => registry.size

export function status(hash) {
  const entry = registry.get(String(hash || '').toLowerCase())
  if (!entry) return { state: 'idle', ready: false }
  entry.lastUsed = Date.now()
  const t = entry.torrent
  if (!t || !t.ready) {
    return { state: 'metadata', ready: false, peers: t ? t.numPeers : 0, progress: 0, name: entry.name }
  }
  return {
    state: 'ready', ready: true, name: t.name,
    progress: t.progress, downloaded: t.downloaded, length: t.length,
    downloadSpeed: t.downloadSpeed, uploadSpeed: t.uploadSpeed,
    peers: t.numPeers, timeRemaining: t.timeRemaining
  }
}

/* ---------- arquivos ---------- */

export function listFiles(torrent) {
  const files = torrent.files || []
  const vids = files.map((f, i) => ({ f, i })).filter(({ f }) => VIDEO_RE.test(f.name) && f.length > 0)
  const big = vids.filter(({ f }) => f.length > 30e6)
  const pool = big.length ? big : vids
  let main = null
  for (const v of pool) if (!main || v.f.length > main.f.length) main = v
  return {
    name: torrent.name,
    main: main ? main.i : null,
    files: files.map((f, i) => ({
      i, name: f.name, length: f.length,
      kind: VIDEO_RE.test(f.name) ? 'video' : SUB_RE.test(f.name) ? 'sub' : 'other'
    }))
  }
}

export function pickVideo(torrent, index) {
  const { main } = listFiles(torrent)
  if (index !== undefined && index !== null && index !== '') {
    const i = Number(index)
    const f = torrent.files[i]
    if (f && VIDEO_RE.test(f.name)) return { file: f, index: i }
  }
  if (main === null) return null
  return { file: torrent.files[main], index: main }
}

function subLangGuess(name) {
  const s = String(name).toLowerCase()
  if (/pt[-_ .]?br|ptbr|portugu[eê]s[-_ ]?br|brazil|pob/.test(s)) return 'pt-BR'
  if (/portugu|portugues|\bpt\b|\bpor\b/.test(s)) return 'pt'
  if (/english|\beng\b|\ben\b/.test(s)) return 'en'
  if (/spanish|espa|\bes\b|\bspa\b/.test(s)) return 'es'
  if (/italian|\bita\b/.test(s)) return 'it'
  if (/french|\bfra\b|\bfre\b/.test(s)) return 'fr'
  if (/german|deutsch|\bger\b|\bdeu\b/.test(s)) return 'de'
  return ''
}

export function externalSubs(torrent) {
  return (torrent.files || []).map((f, i) => ({ f, i }))
    .filter(({ f }) => SUB_RE.test(f.name) && f.length < 5e6)
    .map(({ f, i }) => {
      const lang = subLangGuess(f.name)
      return { kind: 'file', i, name: f.name, lang, label: langName(lang) || f.name.split('/').pop() }
    })
}

export function mediaInfo(p) {
  if (!p) return null
  return {
    duration: p.duration,
    format: p.format,
    video: p.video,
    audios: p.audios.map(a => ({
      i: a.i, codec: a.codec, channels: a.channels, lang: a.lang,
      label: [a.title, langName(a.lang)].filter(Boolean).join(' / ') || `Faixa ${a.i + 1}`
    })),
    subs: p.subs.map(s => ({
      i: s.i, codec: s.codec, lang: s.lang,
      label: [s.title, langName(s.lang)].filter(Boolean).join(' / ') || `Legenda ${s.i + 1}`,
      text: ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'].includes(String(s.codec).toLowerCase())
    }))
  }
}

export function getProbe(torrent, file) {
  const key = `${torrent.infoHash}:${file.name}`
  const hit = probeCache.get(key)
  if (hit && Date.now() - hit.at < 20 * 60e3) return hit.promise
  const promise = (async () => {
    if (!(await ensureFfmpeg())) return null
    const cap = Math.max(512 * 1024, Math.min(file.length, PROBE_BYTES))
    return probe(() => file.createReadStream({ start: 0, end: cap - 1 }))
  })()
  probeCache.set(key, { promise, at: Date.now() })
  return promise
}

export async function decideMode(torrent, file, { wantAudio = false, hint = '' } = {}) {
  const p = await getProbe(torrent, file)
  const vc = String(p?.video?.codec || hint || '').toLowerCase()
  const audios = p?.audios || []
  const audioOk = audios.length === 0 || audios.every(a => SAFE_A.includes(String(a.codec).toLowerCase()))
  const singleAudio = audios.length <= 1
  const containerOk = DIRECT_RE.test(file.name)
  if (containerOk && SAFE_V.includes(vc) && audioOk && singleAudio && !wantAudio) return 'direct'
  if (vc === 'h264' || vc === 'vp9' || vc === 'av1') return 'remux'
  if (!vc) return 'remux'
  return 'transcode'
}

/* ---------- entrega: direto (range) ---------- */

function serveDirect(file, req, res) {
  const total = file.length
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  const base = {
    'Accept-Ranges': 'bytes',
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  }
  let start = 0, end = total - 1, partial = false
  const range = req.headers.range
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim())
    if (m && (m[1] || m[2])) {
      if (!m[1]) { const n = Number(m[2]); start = Math.max(0, total - n) }
      else {
        start = Number(m[1])
        if (m[2]) end = Math.min(Number(m[2]), total - 1)
      }
      if (!Number.isFinite(start) || start < 0) start = 0
      if (!Number.isFinite(end) || end >= total) end = total - 1
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end() }
      partial = true
    }
  }
  res.writeHead(partial ? 206 : 200, {
    ...base,
    ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}),
    'Content-Length': end - start + 1,
    'X-Mode': 'direct'
  })
  if (req.method === 'HEAD') return res.end()
  const stream = file.createReadStream({ start, end })
  stream.on('error', e => { log('erro no stream direto:', e.message); try { res.end() } catch {} })
  res.on('close', () => { try { stream.destroy() } catch {} })
  stream.pipe(res)
}

/* ---------- entrega: remux / transcode ---------- */

async function serveFfmpeg({ torrent, file, mode, audioTrack, pos, q, req, res }) {
  const ff = ffmpegCmd()
  const info = await getProbe(torrent, file)
  const frac = Math.min(0.995, Math.max(0, Number(pos) || 0))
  const isMp4 = /mp4|mov|m4a|3gp|isom/.test(String(info?.format || '').toLowerCase())
  const duration = info?.duration || 0

  let start = 0
  if (!isMp4 && frac > 0.002) {
    const piece = torrent.pieceLength || 1
    start = Math.floor((file.length * frac) / piece) * piece
    if (start >= file.length) start = Math.max(0, file.length - piece)
  }

  const args = ['-hide_banner', '-loglevel', 'error', '-probesize', '4M', '-analyzeduration', '4M', '-fflags', '+genpts']
  if (frac > 0.002 && duration) args.push('-ss', (frac * duration).toFixed(3))
  args.push('-i', 'pipe:0', '-map', '0:v:0')

  const audios = info?.audios || []
  const aIdx = Math.min(Math.max(0, Number(audioTrack) || 0), Math.max(0, audios.length - 1))
  args.push('-map', audios.length ? `0:a:${aIdx}` : '0:a:0?')

  if (mode === 'transcode') {
    if (q === '720' || q === '480') args.push('-vf', `scale=-2:${q}`)
    args.push('-c:v', 'libx264', '-preset', PRESET, '-crf', CRF,
      '-pix_fmt', 'yuv420p', '-g', '48', '-keyint_min', '48', '-sc_threshold', '0')
  } else {
    args.push('-c:v', 'copy')
    if (info?.video?.codec === 'hevc') args.push('-tag:v', 'hvc1')
  }
  args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-sn',
    '-max_muxing_queue_size', '4096', '-avoid_negative_ts', 'make_zero',
    '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1')

  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'none',
    'X-Mode': mode
  })

  const proc = spawn(ff, args, { stdio: ['pipe', 'pipe', 'pipe'] })
  const input = file.createReadStream({ start, end: file.length - 1 })
  input.on('error', () => {})
  proc.stdin.on('error', () => {})
  proc.stdout.on('error', () => {})
  input.pipe(proc.stdin)
  proc.stdout.pipe(res)

  let err = ''
  proc.stderr.on('data', d => { err += d; if (err.length > 4000) err = err.slice(-4000) })

  const kill = () => { try { proc.kill('SIGKILL') } catch {}; try { input.destroy() } catch {} }
  res.on('close', kill)
  proc.on('close', code => {
    if (code && code !== 0) log(`ffmpeg/${mode} saida ${code}: ${err.trim().split('\n').pop() || ''}`)
    if (!res.writableEnded) res.end()
  })
}

export async function serveMedia({ torrent, fileIndex, mode = 'auto', audioTrack = 0, pos = 0, q = '', hint = '', req, res }) {
  const picked = pickVideo(torrent, fileIndex)
  if (!picked) { res.status(404).json({ error: 'Nenhum arquivo de video neste torrent.' }); return }
  const { file } = picked
  const wantAudio = Number(audioTrack) > 0

  let m = mode
  if (m === 'auto') m = await decideMode(torrent, file, { wantAudio, hint })
  if (m === 'direct' && wantAudio) m = 'remux'
  if (m !== 'direct' && !(await ensureFfmpeg())) {
    log('ffmpeg indisponivel, caindo para direto')
    m = 'direct'
  }
  log('stream', file.name.slice(0, 40), 'modo=' + m, 'audio=' + audioTrack, 'pos=' + pos)
  if (m === 'direct') return serveDirect(file, req, res)
  return serveFfmpeg({ torrent, file, mode: m, audioTrack, pos, q, req, res })
}

/* ---------- diagnostico ---------- */

function readBytes(file, n, ms) {
  return new Promise((resolve, reject) => {
    const end = Math.min(n, file.length) - 1
    const stream = file.createReadStream({ start: 0, end })
    let got = 0
    let done = false
    const finish = err => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { stream.destroy() } catch {}
      err ? reject(err) : resolve(got)
    }
    const timer = setTimeout(() => finish(), ms)
    stream.on('data', c => {
      got += c.length
      if (got >= n) finish()
    })
    stream.on('error', e => finish(e))
    stream.on('end', () => finish())
  })
}

export async function diagnose(hash, name = '') {
  const out = { hash, name, steps: [], errors: [] }
  const step = (label, ok, extra = {}) => out.steps.push({ label, ok, ...extra })
  const t0 = Date.now()
  let torrent
  try {
    torrent = await ensureTorrent(hash, name)
    step('metadados do torrent', true, { ms: Date.now() - t0 })
  } catch (e) {
    step('metadados do torrent', false, { ms: Date.now() - t0, error: e.message })
    out.errors.push(e.message)
    out.ffmpeg = ffmpegInfo()
    return out
  }
  const st = status(hash)
  out.peers = st.peers
  out.progress = st.progress
  step('peers conectados', st.peers > 0, { peers: st.peers })
  const list = listFiles(torrent)
  step('arquivos de video', list.main !== null, { total: list.files.length, escolhido: list.main })
  const picked = pickVideo(torrent, list.main)
  if (!picked) {
    out.errors.push('nenhum arquivo de video')
    out.ffmpeg = ffmpegInfo()
    return out
  }
  out.file = { nome: picked.file.name, bytes: picked.file.length }
  const ff = await ensureFfmpeg()
  out.ffmpeg = ffmpegInfo()
  step('ffmpeg', ff, { fonte: ffmpegInfo().source })
  const t1 = Date.now()
  try {
    const got = await readBytes(picked.file, 128 * 1024, 30000)
    step('leitura dos primeiros bytes', got > 0, { bytes: got, ms: Date.now() - t1 })
  } catch (e) {
    step('leitura dos primeiros bytes', false, { ms: Date.now() - t1, error: e.message })
    out.errors.push('leitura: ' + e.message)
  }
  const p = await getProbe(torrent, picked.file)
  step('ffprobe', Boolean(p), p ? { duracao: p.duration, video: p.video?.codec || null, audios: p.audios.length, legendas: p.subs.length } : {})
  out.media = mediaInfo(p)
  out.modoSugerido = await decideMode(torrent, picked.file)
  return out
}

/* ---------- legendas ---------- */

function decodeText(buf) {
  let t = buf.toString('utf8')
  if (t.includes('\uFFFD')) { try { t = new TextDecoder('windows-1252').decode(buf) } catch {} }
  return t.replace(/^\uFEFF/, '')
}

function srtToVtt(text) {
  const body = text.replace(/\r+/g, '')
    .replace(/^(\d+)[ \t]*$/gm, '')
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return 'WEBVTT\n\n' + body.trim() + '\n'
}

function assTime(t) {
  const m = /(\d+):(\d{2}):(\d{2})[.:](\d+)/.exec(t || '')
  if (!m) return '00:00:00.000'
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}.${m[4].padEnd(3, '0').slice(0, 3)}`
}

function assToVtt(text) {
  const cues = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^Dialogue:\s*([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),(.*)$/.exec(line)
    if (!m) continue
    const txt = m[10].replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\n/gi, '\n')
    cues.push(`${assTime(m[2])} --> ${assTime(m[3])}\n${txt}`)
  }
  return 'WEBVTT\n\n' + cues.join('\n\n') + '\n'
}

export async function externalSubVtt(torrent, fileIndex) {
  const f = torrent.files[Number(fileIndex)]
  if (!f || !SUB_RE.test(f.name)) throw new Error('legenda nao encontrada')
  const text = decodeText(Buffer.from(await f.arrayBuffer()))
  return /\.(ass|ssa)$/i.test(f.name) ? assToVtt(text) : srtToVtt(text)
}

export async function embeddedSubVtt(torrent, file, track) {
  if (!(await ensureFfmpeg())) throw new Error('ffmpeg nao encontrado')
  const safe = file.name.replace(/[^\w.-]/g, '_')
  const out = path.join(SUBS_DIR, `${torrent.infoHash}-${safe}-s${track}.vtt`)
  if (fs.existsSync(out)) return fs.readFileSync(out, 'utf8')
  if (subJobs.has(out)) return subJobs.get(out)

  const job = new Promise((resolve, reject) => {
    const tmp = out + '.tmp'
    const args = ['-hide_banner', '-loglevel', 'error', '-probesize', '4M', '-analyzeduration', '4M',
      '-i', 'pipe:0', '-map', `0:s:${Number(track)}`, '-f', 'webvtt', tmp]
    const proc = spawn(ffmpegCmd(), args, { stdio: ['pipe', 'ignore', 'pipe'] })
    const input = file.createReadStream({ start: 0, end: file.length - 1 })
    let err = ''
    input.on('error', () => {})
    proc.stdin.on('error', () => {})
    input.pipe(proc.stdin)
    proc.stderr.on('data', d => { err += d })
    proc.on('error', reject)
    proc.on('close', code => {
      try { input.destroy() } catch {}
      if (code !== 0) return reject(new Error('falha ao extrair legenda: ' + err.trim().split('\n').pop()))
      try { fs.renameSync(tmp, out); resolve(fs.readFileSync(out, 'utf8')) } catch (e) { reject(e) }
    })
  }).finally(() => subJobs.delete(out))

  subJobs.set(out, job)
  return job
}

/* ---------- limpeza por ociosidade ---------- */

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of registry) {
    if (now - entry.lastUsed > IDLE_MINUTES * 60e3) {
      registry.delete(key)
      clearTimeout(entry.timer)
      client.remove(key, { destroyStore: true }).catch(() => {})
    }
  }
}, 15e3).unref()

export function destroyClient() { try { client.destroy() } catch {} }

/* ---------- liberacao de espaco ---------- */

export async function stopAll() {
  const keys = [...registry.keys()]
  await Promise.all(keys.map(k => stop(k).catch(() => {})))
  return keys.length
}

export function storageInfo() {
  let bytes = 0, dirs = 0, files = 0
  const walk = dir => {
    let ents
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { dirs++; walk(p) }
      else { files++; try { bytes += fs.statSync(p).size } catch {} }
    }
  }
  walk(DOWNLOAD_DIR)
  return { bytes, dirs, files, active: registry.size }
}
'@

# ---------------------------------------------------------------- server.js
W 'server.js' @'
import express from 'express'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { listMovies, searchMovies } from './src/yts.js'
import { searchApibay, topMovies, brShelf, rank } from './src/apibay.js'
import { searchAll } from './src/search.js'
import { tvSearch, tvShow, tvFind } from './src/tv.js'
import { matchesLang } from './src/lang.js'
import { liveMeta, liveChannels } from './src/live.js'
import { archiveSearch, archiveStream } from './src/archive.js'
import {
  ensureTorrent, serveMedia, status, stop, active, listFiles, pickVideo,
  externalSubs, getProbe, mediaInfo, decideMode, diagnose,
  externalSubVtt, embeddedSubVtt, destroyClient, stopAll, storageInfo
} from './src/streamer.js'
import { ensureFfmpeg, ffmpegInfo } from './src/ffmpeg.js'
import { ensureCerts } from './src/tls.js'
import * as progress from './src/progress.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.PORT || 3000)
const USE_HTTPS = process.argv.includes('--https') || ['1', 'true'].includes(String(process.env.HTTPS))
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true }))

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  console.error('[cinep2p] erro na rota', req.path, '-', e.message)
  if (!res.headersSent) res.status(500).json({ error: e.message })
})
const hash40 = v => /^[0-9a-f]{40}$/.test(String(v || '').toLowerCase())

function cleanTitle(s) {
  return String(s || '')
    .replace(/\.(mp4|mkv|avi|mov|webm|m4v|ts)$/i, '')
    .replace(/[._]/g, ' ')
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|bluray|blu-?ray|web-?dl|webrip|hdrip|brrip|dvdrip|remux|hdr|dv|x264|x265|h\.?264|h\.?265|hevc|av1|aac|ac3|ddp?5[ .]?1|dts(-hd)?|truehd|atmos|yify|galaxyrg|yts|dublado|dublada|dublagem|dual|multi|legendado|legendas?|nacional|brasileir[oa]|repackage?d?|proper|extended|imax|10bit|8bit|hq|bone|psa|oft|turg|rarbg)\b/gi, ' ')
    .replace(/\s*-\s*[a-z0-9]+$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
const yearOf = s => (/\b(19\d{2}|20\d{2})\b/.exec(String(s || '')) || [])[1] || ''

const posterCache = new Map()

app.get('/api/health', wrap(async (_req, res) => {
  const ff = await ensureFfmpeg()
  res.json({ ok: true, ffmpeg: ff, ffmpegInfo: ffmpegInfo(), https: USE_HTTPS, version: '0.6.0', live: true, archive: true, tv: true })
}))

app.get('/api/active', (_req, res) => res.json({ active: active() }))

app.get('/api/catalog', wrap(async (req, res) => {
  const { genre = '', sort = 'year', order = 'desc', page = '1' } = req.query
  res.json(await listMovies({ genre, sort, order, page: Number(page) }))
}))

const brCache = new Map()
const BR_TTL = 120e3

app.get('/api/br', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 180)
  const catRaw = String(req.query.cat || '').trim()
  const cats = catRaw ? catRaw.split(',').map(Number).filter(Number.isFinite) : [201, 207]
  const lang = String(req.query.lang || '').trim().toLowerCase()
  const limit = Math.max(1, Math.min(60, Number.parseInt(req.query.limit || '24', 10) || 24))

  const cacheKey = `${q}|${cats.join(',')}|${lang}|${limit}`
  const hit = brCache.get(cacheKey)
  if (hit && Date.now() - hit.at < BR_TTL) return res.json(hit.data)

  let list = []
  try {
    list = q ? await brShelf([q]) : await topMovies(cats)
  } catch (e) {
    console.warn('[cinep2p] /api/br falhou:', e.message)
  }
  let filtered = lang ? list.filter(x => matchesLang(x, lang)) : list
  if (filtered.length < 3) filtered = list

  const data = {
    results: rank(filtered).slice(0, limit).map(x => ({ ...x, year: yearOf(x.title) })),
    source: 'TPB', lang: lang || 'all', count: filtered.length
  }
  brCache.set(cacheKey, { at: Date.now(), data })
  if (brCache.size > 200) brCache.clear()
  res.json(data)
}))

app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (!q) return res.json({ results: [], extra: [] })
  const onlyDub = req.query.dub === '1'
  const [yts, bay] = await Promise.all([
    searchMovies(q).catch(() => []),
    searchAll(q, { onlyDub, limit: 60 }).catch(() => ({ extras: [] }))
  ])
  res.json({ results: yts, extra: bay.extras || [] })
}))

app.get('/api/extra', wrap(async (req, res) => {
  const title = String(req.query.title || '').trim()
  if (!title) return res.json({ results: [] })
  const j = await searchAll(title, { onlyDub: req.query.dub === '1', limit: 30 }).catch(() => ({ extras: [] }))
  res.json({ results: j.extras || [] })
}))

app.get('/api/poster', wrap(async (req, res) => {
  const imdb = String(req.query.imdb || '').trim()
  const raw = String(req.query.title || '').trim().slice(0, 180)
  const term = imdb || cleanTitle(raw)
  if (!term) return res.json({ poster: '' })
  const key = term.toLowerCase()
  if (posterCache.has(key)) return res.json(posterCache.get(key))
  let out = { poster: '', title: '', year: '', summary: '', rating: 0, genres: [] }
  try {
    const movies = await searchMovies(term)
    const wanted = term.toLowerCase()
    const score = m => {
      const c = String(m.title || '').toLowerCase()
      return (c === wanted ? 4 : 0) + (c.startsWith(wanted) || wanted.startsWith(c) ? 2 : 0) + (m.poster ? 1 : 0)
    }
    const best = [...movies].sort((a, b) => score(b) - score(a))[0]
    if (best) out = {
      poster: best.poster, title: best.title, year: best.year,
      summary: best.summary, rating: best.rating, genres: best.genres, imdb: best.imdb
    }
  } catch {}
  posterCache.set(key, out)
  if (posterCache.size > 800) posterCache.clear()
  res.json(out)
}))

app.get('/api/tv/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (!q) return res.json({ results: [] })
  try { res.json(await tvSearch(q)) }
  catch (e) { res.json({ results: [], error: e.message }) }
}))

app.get('/api/tv/show/:id', wrap(async (req, res) => {
  try { res.json(await tvShow(Number(req.params.id))) }
  catch (e) { res.json({ show: null, seasons: [], error: e.message }) }
}))

app.get('/api/tv/find', wrap(async (req, res) => {
  const title = String(req.query.title || '').trim().slice(0, 100)
  const season = Number(req.query.season || 1)
  const episode = Number(req.query.episode || 1)
  if (!title) return res.json({ results: [] })
  try { res.json(await tvFind({ title, season, episode, dub: req.query.dub !== '0' })) }
  catch (e) { res.json({ results: [], error: e.message }) }
}))

app.get('/api/live/meta', wrap(async (_req, res) => {
  try { res.json(await liveMeta()) }
  catch (e) { res.json({ countries: [], categories: [], total: 0, error: e.message }) }
}))

app.get('/api/live', wrap(async (req, res) => {
  const country = String(req.query.country || '').trim().slice(0, 60)
  const category = String(req.query.category || '').trim().slice(0, 60)
  const q = String(req.query.q || '').trim().slice(0, 60)
  const page = Math.max(1, Number(req.query.page || 1))
  const limit = Math.max(12, Math.min(120, Number(req.query.limit || 60)))
  try { res.json(await liveChannels({ country, category, q, page, limit })) }
  catch (e) { res.json({ channels: [], total: 0, page, error: e.message }) }
}))

const proxify = u => '/api/live/proxy?url=' + encodeURIComponent(u)

function rewritePlaylist(text, baseUrl) {
  const abs = u => { try { return new URL(u, baseUrl).href } catch { return u } }
  return String(text).split(/\r?\n/).map(line => {
    const t = line.trim()
    if (!t) return line
    if (t.startsWith('#')) return t.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxify(abs(u))}"`)
    return proxify(abs(t))
  }).join('\n')
}

app.get('/api/live/proxy', wrap(async (req, res) => {
  const target = String(req.query.url || '')
  if (!/^https?:\/\//i.test(target)) return res.status(400).send('url invalida')
  let up
  try {
    up = await fetch(target, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow' })
  } catch (e) {
    return res.status(502).send('falha no stream: ' + e.message)
  }
  if (!up.ok) return res.status(up.status).end()
  const ct = String(up.headers.get('content-type') || '')
  const isPlaylist = /mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(target)
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Cache-Control', 'no-store')
  if (isPlaylist) {
    res.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8')
    return res.send(rewritePlaylist(await up.text(), target))
  }
  res.set('Content-Type', ct || 'application/octet-stream')
  if (up.body) Readable.fromWeb(up.body).pipe(res)
  else res.end()
}))

app.get('/api/archive', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80)
  const collection = String(req.query.col || '').trim().slice(0, 40)
  const page = Math.max(1, Number(req.query.page || 1))
  const limit = Math.max(6, Math.min(48, Number(req.query.limit || 24)))
  try { res.json(await archiveSearch({ q, collection, page, limit })) }
  catch (e) { res.json({ results: [], total: 0, error: e.message }) }
}))

app.get('/api/archive/:id', wrap(async (req, res) => {
  const info = await archiveStream(String(req.params.id))
  if (!info) return res.status(404).json({ error: 'sem arquivo reproduzivel neste item' })
  res.json(info)
}))

app.get('/api/storage', (_req, res) => res.json(storageInfo()))

app.post('/api/cleanup', wrap(async (_req, res) => {
  const before = storageInfo().bytes
  const torrents = await stopAll()
  await new Promise(r => setTimeout(r, 400))
  const after = storageInfo().bytes
  res.json({ ok: true, torrents, freed: Math.max(0, before - after), bytes: after })
}))

app.get('/api/status/:hash', (req, res) => {
  if (!hash40(req.params.hash)) return res.status(400).json({ error: 'hash invalido' })
  res.json(status(req.params.hash))
})

app.post('/api/stop/:hash', wrap(async (req, res) => {
  await stop(req.params.hash)
  res.json({ ok: true })
}))

app.get('/api/diag/:hash', wrap(async (req, res) => {
  if (!hash40(req.params.hash)) return res.status(400).json({ error: 'hash invalido' })
  res.json(await diagnose(String(req.params.hash).toLowerCase(), String(req.query.name || '')))
}))

app.get('/api/prepare/:hash', wrap(async (req, res) => {
  const hash = String(req.params.hash).toLowerCase()
  let torrent
  try {
    torrent = await ensureTorrent(hash, String(req.query.name || ''))
  } catch (e) {
    return res.status(504).json({ error: e.message })
  }
  const list = listFiles(torrent)
  const picked = pickVideo(torrent, req.query.file)
  const out = { hash, name: torrent.name, main: list.main, files: list.files, externalSubs: externalSubs(torrent), ffmpeg: await ensureFfmpeg() }
  if (picked) {
    out.file = picked.index
    out.playable = /\.(mp4|m4v|webm|ogv)$/i.test(picked.file.name)
    out.media = mediaInfo(await getProbe(torrent, picked.file))
    out.mode = out.ffmpeg ? await decideMode(torrent, picked.file) : 'direct'
  } else {
    out.mode = 'direct'
  }
  res.json(out)
}))

app.get('/api/stream/:hash', wrap(async (req, res) => {
  const torrent = await ensureTorrent(String(req.params.hash).toLowerCase(), String(req.query.name || ''))
  await serveMedia({
    torrent,
    fileIndex: req.query.file,
    mode: String(req.query.mode || 'auto'),
    audioTrack: Number(req.query.audio || 0),
    pos: Number(req.query.pos || 0),
    q: String(req.query.q || ''),
    hint: String(req.query.hint || ''),
    req, res
  })
}))

app.get('/api/subs/:hash', wrap(async (req, res) => {
  const torrent = await ensureTorrent(String(req.params.hash).toLowerCase(), String(req.query.name || ''))
  let vtt
  if (req.query.track !== undefined) {
    const picked = pickVideo(torrent, req.query.file)
    if (!picked) return res.status(404).json({ error: 'arquivo nao encontrado' })
    vtt = await embeddedSubVtt(torrent, picked.file, req.query.track)
  } else {
    vtt = await externalSubVtt(torrent, req.query.ext)
  }
  res.set('Content-Type', 'text/vtt; charset=utf-8').set('Cache-Control', 'no-store').send(vtt)
}))

app.get('/api/progress', (_req, res) => res.json({ items: progress.recent(24) }))
app.get('/api/progress/:key', (req, res) => res.json(progress.get(req.params.key) || {}))
app.delete('/api/progress', (_req, res) => { progress.clear(); res.json({ ok: true }) })
app.post('/api/progress', (req, res) => {
  const b = req.body || {}
  if (!b.key) return res.status(400).json({ error: 'key obrigatoria' })
  progress.set(String(b.key), {
    t: Number(b.t) || 0, d: Number(b.d) || 0,
    title: b.title || '', poster: b.poster || '', year: b.year || '',
    hash: b.hash || '', file: b.file ?? null, name: b.name || ''
  })
  res.json({ ok: true })
})
app.delete('/api/progress/:key', (req, res) => { progress.del(req.params.key); res.json({ ok: true }) })

app.use('/api', (_req, res) => res.status(404).json({ error: 'rota nao encontrada' }))

const server = USE_HTTPS
  ? https.createServer(ensureCerts(path.join(__dirname, 'certs')), app)
  : http.createServer(app)

const scheme = USE_HTTPS ? 'https' : 'http'

server.listen(PORT, '0.0.0.0', async () => {
  const ff = await ensureFfmpeg()
  console.log('')
  console.log('  cinep2p no ar' + (USE_HTTPS ? ' (HTTPS)' : ''))
  console.log('')
  console.log(`  Neste PC:  ${scheme}://localhost:${PORT}`)
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  Na rede:   ${scheme}://${a.address}:${PORT}   <- celular, TV Box, projetor`)
      }
    }
  }
  console.log('')
  console.log(`  ffmpeg: ${ff ? 'ok (' + ffmpegInfo().source + ')' : 'NAO ENCONTRADO'}`)
  console.log('  dica: para instalar como app no celular, use npm run https')
  console.log('')
  console.log('  Ctrl+C para parar.')
  console.log('')
})

process.on('SIGINT', () => { destroyClient(); process.exit(0) })
'@

# ---------------------------------------------------------------- worker.js
W 'worker.js' @'
const BASES = [
  'https://movies-api.accel.li/api/v2',
  'https://yts.lt/api/v2',
  'https://yts.gg/api/v2',
  'https://yts.bz/api/v2',
  'https://yts.rs/api/v2'
]
const APIS = ['https://apibay.org', 'https://apibay.qicp.vip']
const VIDEO_CATS = new Set([201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213])
const TVMAZE = 'https://api.tvmaze.com'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

const PT = /(dublado|dublada|dublagem|nacional|brasileir[oa]|brazilian|\bptbr\b|\bpt[-_. ]?br\b|\bpob\b|\bbrdub\b|\bbr[-_. ]?dub\b|portugu[eê]s|\bpor\b)/i
const DUAL = /(dual[ ._-]?[aá]udio|dual[ ._-]?audio|\bdual\b)/i
const LEG = /(legendado|legendad[ao]|legendas?|subbed|subtitled)/i

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*'
    }
  })
}

async function yts(path) {
  let lastError = 'Catalogo temporariamente indisponivel'
  for (const base of BASES) {
    try {
      const response = await fetch(base + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
      if (!response.ok) { lastError = 'Fonte respondeu HTTP ' + response.status; continue }
      const body = await response.json()
      if (body?.status === 'ok' && body?.data) return body.data
      lastError = 'Resposta inesperada da fonte'
    } catch (error) { lastError = String(error?.message || error) }
  }
  throw new Error(lastError)
}

async function apibay(path) {
  let lastError = 'Indice PT-BR indisponivel'
  for (const base of APIS) {
    try {
      const r = await fetch(base + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
      if (!r.ok) { lastError = 'Fonte respondeu HTTP ' + r.status; continue }
      const j = await r.json()
      if (Array.isArray(j)) return j
      lastError = 'Resposta inesperada'
    } catch (e) { lastError = String(e?.message || e) }
  }
  throw new Error(lastError)
}

async function getJSON(url, ms = 15000) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(ms) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return await r.json()
}

const plain = (html, n) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)

function normalize(movie) {
  return {
    id: 'yts-' + (movie.id || movie.imdb_code || movie.title),
    imdb: movie.imdb_code || '',
    title: movie.title_english || movie.title || '',
    year: movie.year || '',
    rating: movie.rating || 0,
    runtime: movie.runtime || 0,
    genres: movie.genres || [],
    language: movie.language || '',
    summary: movie.summary || movie.description_full || movie.synopsis || '',
    poster: movie.large_cover_image || movie.medium_cover_image || movie.small_cover_image || '',
    background: movie.background_image_original || movie.background_image || '',
    torrents: (movie.torrents || []).map(t => ({
      hash: String(t.hash || '').toLowerCase(),
      quality: t.quality || 'SD',
      codec: t.video_codec || '',
      type: t.type || '',
      seeds: Number(t.seeds) || 0,
      peers: Number(t.peers) || 0,
      size: t.size || '',
      sizeBytes: Number(t.size_bytes) || 0,
      audioChannels: t.audio_channels || '',
      source: 'YTS'
    })).filter(t => /^[0-9a-f]{40}$/.test(t.hash)).sort((a, b) => b.seeds - a.seeds)
  }
}

function qualityOf(n) {
  if (/2160p|4k/i.test(n)) return '2160p'
  if (/1080p/i.test(n)) return '1080p'
  if (/720p/i.test(n)) return '720p'
  if (/480p/i.test(n)) return '480p'
  return 'SD'
}
function codecOf(n) {
  if (/x265|h\.?265|hevc/i.test(n)) return 'x265'
  if (/x264|h\.?264|avc/i.test(n)) return 'x264'
  if (/\bav1\b/i.test(n)) return 'AV1'
  return ''
}
function human(bytes) {
  if (!bytes) return '?'
  const gb = bytes / 1e9
  return gb >= 1 ? gb.toFixed(2) + ' GB' : (bytes / 1e6).toFixed(0) + ' MB'
}
const yearOf = s => (/\b(19\d{2}|20\d{2})\b/.exec(String(s || '')) || [])[1] || ''

function normalizeBay(x) {
  const name = String(x.name || '')
  if (!name || name === 'No results returned') return null
  const size = Number(x.size) || 0
  const cat = Number(x.category) || 0
  const dub = PT.test(name)
  return {
    hash: String(x.info_hash || '').toLowerCase(),
    title: name,
    seeds: Number(x.seeders) || 0,
    peers: Number(x.leechers) || 0,
    sizeBytes: size,
    size: human(size),
    quality: qualityOf(name),
    codec: codecOf(name),
    category: cat,
    video: VIDEO_CATS.has(cat),
    imdb: x.imdb || '',
    year: yearOf(name),
    dub,
    dual: DUAL.test(name),
    subs: LEG.test(name),
    langs: dub ? ['ptbr'] : [],
    source: 'TPB'
  }
}
const cleanBay = list => list.map(normalizeBay).filter(t => t && t.seeds > 0 && /^[0-9a-f]{40}$/.test(t.hash))

function matchesLang(item, lang) {
  const s = String(lang || '').trim().toLowerCase()
  if (!s || s === 'all' || s === 'world') return true
  const t = String(item?.title || item || '')
  const dub = Boolean(item?.dub) || PT.test(t)
  const dual = Boolean(item?.dual) || DUAL.test(t)
  const subs = Boolean(item?.subs) || LEG.test(t)
  if (['dub', 'dublado', 'dublada'].includes(s)) return dub
  if (['dual', 'dual-audio', 'dualaudio'].includes(s)) return dual
  if (['subs', 'sub', 'legendado'].includes(s)) return subs
  if (['ptbr', 'pt-br', 'pt', 'por', 'pob', 'portuguese', 'portugues'].includes(s)) return dub || dual || subs
  return true
}

function bayScore(t) {
  let s = Math.min(t.seeds, 250)
  if (t.quality === '1080p') s += 60
  else if (t.quality === '720p') s += 35
  else if (t.quality === '2160p') s += 12
  if (t.codec === 'x264') s += 14
  if (t.codec === 'x265') s += 6
  if (t.dub || (t.langs || []).includes('ptbr')) s += 1500
  else if (t.dual) s += 350
  else if (t.subs) s += 100
  if (/\b(cam|hdcam|ts)\b/i.test(t.title)) s -= 45
  if (!t.video) s -= 90
  return s
}
const bayRank = list => [...list].sort((a, b) => bayScore(b) - bayScore(a))

const COUNTRY_LIST = 'https://iptv-org.github.io/iptv/index.country.m3u'
const CATEGORY_LIST = 'https://iptv-org.github.io/iptv/index.category.m3u'
let liveCache = { at: 0, byCountry: [], byCategory: [] }

function parseM3U(text) {
  const out = []
  let cur = null
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#EXTINF')) {
      const logo = (/(?:tvg-logo|logo)="([^"]*)"/i.exec(line) || [])[1] || ''
      const group = (/group-title="([^"]*)"/i.exec(line) || [])[1] || ''
      const name = (line.split(',').pop() || '').trim()
      cur = { name, logo, group, url: '' }
    } else if (line.startsWith('#')) {
      continue
    } else if (cur) {
      cur.url = line
      if (cur.url && cur.name) out.push(cur)
      cur = null
    }
  }
  return out
}

async function getText(url, ms = 30000) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(ms) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return await r.text()
}

async function ensureLive() {
  if (liveCache.at && Date.now() - liveCache.at < 12 * 60 * 60 * 1000) return liveCache
  const [countries, categories] = await Promise.all([
    getText(COUNTRY_LIST).then(parseM3U).catch(() => []),
    getText(CATEGORY_LIST).then(parseM3U).catch(() => [])
  ])
  if (!countries.length && !categories.length && liveCache.at) return liveCache
  liveCache = { at: Date.now(), byCountry: countries, byCategory: categories }
  return liveCache
}

const proxify = u => '/api/live/proxy?url=' + encodeURIComponent(u)
function rewritePlaylist(text, baseUrl) {
  const abs = u => { try { return new URL(u, baseUrl).href } catch { return u } }
  return String(text).split(/\r?\n/).map(line => {
    const t = line.trim()
    if (!t) return line
    if (t.startsWith('#')) return t.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxify(abs(u))}"`)
    return proxify(abs(t))
  }).join('\n')
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return json({ ok: true, platform: 'cloudflare-workers', catalog: true, brCatalog: true, live: true, archive: true, tv: true, torrentStreaming: false })
    }

    if (url.pathname === '/api/catalog') {
      try {
        const page = Math.max(1, Math.min(100, Number(url.searchParams.get('page') || 1)))
        const sort = url.searchParams.get('sort') || 'year'
        const order = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc'
        const genre = (url.searchParams.get('genre') || '').slice(0, 40)
        const params = new URLSearchParams({ limit: '24', page: String(page), sort_by: sort, order_by: order })
        if (genre) params.set('genre', genre)
        const data = await yts('/list_movies.json?' + params.toString())
        return json({ page, movies: (data.movies || []).map(normalize), demo: false })
      } catch (error) {
        return json({ error: 'Nao foi possivel carregar o catalogo agora.', detail: String(error?.message || error), movies: [] }, 502)
      }
    }

    if (url.pathname === '/api/br') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 180)
      const catRaw = (url.searchParams.get('cat') || '').trim()
      const cats = catRaw ? catRaw.split(',').map(Number).filter(Number.isFinite) : [201, 207]
      const lang = (url.searchParams.get('lang') || '').trim().toLowerCase()
      const limit = Math.max(1, Math.min(60, Number(url.searchParams.get('limit') || 24)))
      try {
        let list = []
        if (q) {
          list = cleanBay(await apibay('/q.php?q=' + encodeURIComponent(q)))
        } else {
          const parts = await Promise.all(cats.map(c => apibay('/top.php?cat=' + c).catch(() => [])))
          const seen = new Set()
          for (const arr of parts) for (const t of cleanBay(arr)) { if (!seen.has(t.hash)) { seen.add(t.hash); list.push(t) } }
        }
        let filtered = lang ? list.filter(x => matchesLang(x, lang)) : list
        if (filtered.length < 3) filtered = list
        return json({ results: bayRank(filtered).slice(0, limit), source: 'TPB', lang: lang || 'all', count: filtered.length })
      } catch (error) {
        return json({ results: [], error: String(error?.message || error) }, 502)
      }
    }

    if (url.pathname === '/api/search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 120)
      if (!q) return json({ results: [], extra: [] })
      const onlyDub = url.searchParams.get('dub') === '1'
      const terms = onlyDub ? [q + ' dublado', q + ' nacional'] : [q, q + ' dublado', q + ' nacional', q + ' dual audio', q + ' legendado']
      const [ytsRes, ...bayLists] = await Promise.all([
        yts('/list_movies.json?' + new URLSearchParams({ query_term: q, limit: '20' }).toString())
          .then(d => (d.movies || []).map(normalize)).catch(() => []),
        ...terms.map(t => apibay('/q.php?q=' + encodeURIComponent(t)).then(cleanBay).catch(() => []))
      ])
      const seen = new Map()
      for (const arr of bayLists) for (const t of arr) if (!seen.has(t.hash)) seen.set(t.hash, t)
      let all = [...seen.values()]
      const pt = all.filter(t => matchesLang(t, 'pt'))
      const rest = all.filter(t => !pt.includes(t))
      return json({ results: ytsRes, extra: [...bayRank(pt), ...bayRank(rest)].slice(0, 60) })
    }

    if (url.pathname === '/api/tv/search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80)
      if (!q) return json({ results: [] })
      try {
        const data = await getJSON(TVMAZE + '/search/shows?q=' + encodeURIComponent(q))
        return json({
          results: (Array.isArray(data) ? data : []).map(x => x?.show).filter(Boolean).map(s => ({
            id: s.id, name: s.name, year: (s.premiered || '').slice(0, 4),
            poster: s.image?.medium || '', summary: plain(s.summary, 400),
            genres: s.genres || [], status: s.status || ''
          }))
        })
      } catch (e) { return json({ results: [], error: String(e?.message || e) }) }
    }

    const showMatch = /^\/api\/tv\/show\/(\d+)$/.exec(url.pathname)
    if (showMatch) {
      try {
        const id = Number(showMatch[1])
        const [show, eps] = await Promise.all([
          getJSON(`${TVMAZE}/shows/${id}`).catch(() => null),
          getJSON(`${TVMAZE}/shows/${id}/episodes`).catch(() => [])
        ])
        const list = (Array.isArray(eps) ? eps : []).filter(e => Number(e.season) > 0 && Number(e.number) > 0)
        const bySeason = new Map()
        for (const e of list) {
          if (!bySeason.has(e.season)) bySeason.set(e.season, [])
          bySeason.get(e.season).push({ season: e.season, episode: e.number, name: e.name || `Episodio ${e.number}`, airdate: e.airdate || '', summary: plain(e.summary, 300) })
        }
        return json({
          show: show ? { id: show.id, name: show.name, poster: show.image?.medium || '', year: (show.premiered || '').slice(0, 4) } : null,
          seasons: [...bySeason.entries()].map(([season, episodes]) => ({ season, episodes: episodes.sort((a, b) => a.episode - b.episode) })).sort((a, b) => a.season - b.season)
        })
      } catch (e) { return json({ show: null, seasons: [], error: String(e?.message || e) }) }
    }

    if (url.pathname === '/api/tv/find') {
      const title = (url.searchParams.get('title') || '').trim().slice(0, 100)
      const season = Number(url.searchParams.get('season') || 1)
      const episode = Number(url.searchParams.get('episode') || 1)
      const dub = url.searchParams.get('dub') !== '0'
      if (!title) return json({ results: [] })
      const s = String(season).padStart(2, '0')
      const e = String(episode).padStart(2, '0')
      const code = `S${s}E${e}`
      const terms = [`${title} ${code}`, `${title} ${code} dublado`, `${title} ${code} 1080p`, `${title} ${season}x${episode}`]
      try {
        const lists = await Promise.all(terms.map(t => apibay('/q.php?q=' + encodeURIComponent(t)).then(cleanBay).catch(() => [])))
        const seen = new Map()
        for (const arr of lists) for (const t of arr) if (!seen.has(t.hash)) seen.set(t.hash, t)
        const norm = v => String(v).toUpperCase().replace(/[^A-Z0-9]/g, '')
        const alt = new RegExp(`\\b${season}\\s*[xX]\\s*${episode}\\b`)
        let all = [...seen.values()].filter(t => norm(t.title).includes(code) || alt.test(t.title))
        if (!all.length) all = [...seen.values()]
        if (dub) { const pt = all.filter(t => matchesLang(t, 'pt')); if (pt.length) all = pt }
        return json({ results: bayRank(all).slice(0, 30) })
      } catch (e) { return json({ results: [], error: String(e?.message || e) }) }
    }

    if (url.pathname === '/api/live/meta') {
      try {
        const c = await ensureLive()
        return json({
          countries: [...new Set(c.byCountry.map(x => x.group).filter(Boolean))].sort(),
          categories: [...new Set(c.byCategory.map(x => x.group).filter(Boolean))].sort(),
          total: c.byCountry.length
        })
      } catch (e) { return json({ countries: [], categories: [], total: 0, error: String(e?.message || e) }) }
    }

    if (url.pathname === '/api/live') {
      const country = (url.searchParams.get('country') || '').trim()
      const category = (url.searchParams.get('category') || '').trim()
      const q = (url.searchParams.get('q') || '').trim().toLowerCase()
      const limit = Math.max(12, Math.min(120, Number(url.searchParams.get('limit') || 60)))
      try {
        const c = await ensureLive()
        let base
        if (country && category) {
          const urls = new Set(c.byCategory.filter(x => x.group === category).map(x => x.url))
          base = c.byCountry.filter(x => x.group === country && urls.has(x.url))
        } else if (country) base = c.byCountry.filter(x => x.group === country)
        else if (category) base = c.byCategory.filter(x => x.group === category)
        else base = c.byCountry
        if (q) base = base.filter(x => x.name.toLowerCase().includes(q) || x.group.toLowerCase().includes(q))
        const seen = new Set(); const uniq = []
        for (const x of base) { if (seen.has(x.url)) continue; seen.add(x.url); uniq.push(x) }
        return json({ total: uniq.length, page: 1, channels: uniq.slice(0, limit) })
      } catch (e) { return json({ channels: [], total: 0, error: String(e?.message || e) }) }
    }

    if (url.pathname === '/api/live/proxy') {
      const target = url.searchParams.get('url') || ''
      if (!/^https?:\/\//i.test(target)) return new Response('url invalida', { status: 400 })
      let up
      try { up = await fetch(target, { headers: { 'user-agent': UA }, redirect: 'follow' }) }
      catch (e) { return new Response('falha no stream: ' + (e?.message || e), { status: 502 }) }
      const ct = up.headers.get('content-type') || ''
      const isPlaylist = /mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(target)
      if (isPlaylist) {
        const text = await up.text()
        return new Response(rewritePlaylist(text, target), {
          headers: { 'content-type': 'application/vnd.apple.mpegurl; charset=utf-8', 'access-control-allow-origin': '*' }
        })
      }
      const headers = new Headers(up.headers)
      headers.set('access-control-allow-origin', '*')
      return new Response(up.body, { status: up.status, headers })
    }

    if (url.pathname === '/api/archive') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80)
      const collection = (url.searchParams.get('col') || '').trim().slice(0, 40)
      const limit = Math.max(6, Math.min(48, Number(url.searchParams.get('limit') || 24)))
      const parts = ['mediatype:movies']
      if (collection) parts.push(`collection:${collection}`)
      if (q) parts.push(`(${q})`)
      const params = new URLSearchParams()
      params.set('q', parts.join(' AND '))
      for (const f of ['identifier', 'title', 'year', 'description']) params.append('fl[]', f)
      params.set('sort[]', 'downloads desc')
      params.set('rows', String(limit))
      params.set('output', 'json')
      try {
        const data = await getJSON('https://archive.org/advancedsearch.php?' + params)
        const docs = data?.response?.docs || []
        return json({
          total: Number(data?.response?.numFound) || 0,
          results: docs.map(d => ({
            id: d.identifier,
            title: String(d.title || d.identifier || '').replace(/\s+/g, ' ').trim(),
            year: d.year || '',
            summary: String(d.description || '').replace(/\s+/g, ' ').slice(0, 400),
            poster: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
            source: 'Archive.org'
          })).filter(x => x.id)
        })
      } catch (e) { return json({ results: [], total: 0, error: String(e?.message || e) }, 502) }
    }

    const archiveMatch = /^\/api\/archive\/(.+)$/.exec(url.pathname)
    if (archiveMatch) {
      const id = decodeURIComponent(archiveMatch[1]).trim()
      if (!/^[\w.\-]{1,120}$/.test(id)) return json({ error: 'id invalido' }, 400)
      try {
        const md = await getJSON('https://archive.org/metadata/' + id)
        const files = md?.files || []
        const pick =
          files.find(f => /\.(mp4|m4v)$/i.test(f.name || '') && /h\.?264|mpeg4|512kb|mp4/i.test(f.format || '')) ||
          files.find(f => /\.(mp4|m4v)$/i.test(f.name || '')) ||
          files.find(f => /\.(ogv|webm)$/i.test(f.name || ''))
        if (!pick) return json({ error: 'sem arquivo reproduzivel' }, 404)
        return json({ url: `https://archive.org/download/${id}/${encodeURIComponent(pick.name)}`, size: Number(pick.size) || 0, format: pick.format || '' })
      } catch (e) { return json({ error: String(e?.message || e) }, 502) }
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Esta funcao ainda precisa de um servidor compativel com o Cinep2p completo.', route: url.pathname }, 501)
    }
    return env.ASSETS.fetch(request)
  }
}
'@

# ---------------------------------------------------------------- public/index.html
W 'public/index.html' @'
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>cinep2p</title>
<meta name="theme-color" content="#0b0b11">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg">
<link rel="apple-touch-icon" href="/icon.svg">
<link rel="stylesheet" href="/style.css">
</head>
<body>

<header>
  <div class="logo">cine<span>p2p</span></div>
  <input id="q" type="search" placeholder="Buscar filme, serie ou doc..." enterkeyhint="search">
  <div class="hbtns">
    <button class="chip" id="liveBtn" title="Canais de TV ao vivo">Ao Vivo</button>
    <button class="chip" id="dubChip" title="So resultados dublados">Dublado</button>
    <button class="chip" id="spaceBtn" title="Espaco usado e liberar agora">Cache: 0 MB</button>
    <button class="chip" id="tvBtn" title="Aumentar interface">TV</button>
    <button class="chip" id="installBtn" title="Instalar como aplicativo">Instalar app</button>
    <span class="badge" id="badge">0 ativos</span>
  </div>
</header>

<nav id="modes">
  <button class="chip focusable" id="modeBr">PT-BR</button>
  <button class="chip focusable" id="modeWorld">Mundo</button>
  <button class="chip focusable" id="modeSeries">Series</button>
  <button class="chip focusable" id="modeDocs">Docs</button>
</nav>

<nav id="genres"></nav>

<main>
  <div id="contRow"></div>
  <div id="watchedRow"></div>
  <div id="rows"><div class="loading">Carregando catalogo...</div></div>
</main>

<div id="modal" class="hidden">
  <div class="sheet">
    <button class="close" id="closeModal">x</button>
    <div id="detail"></div>
  </div>
</div>

<div id="diagModal" class="hidden">
  <div class="sheet">
    <button class="close" id="closeDiag">x</button>
    <div class="dbody">
      <h1>Diagnostico</h1>
      <div class="dsum" id="diagText">Rodando...</div>
      <button class="alt focusable" id="diagCopy">Copiar</button>
    </div>
  </div>
</div>

<div id="player" class="hidden">
  <video id="video" tabindex="0" playsinline preload="auto"></video>

  <div class="ptop hidden" id="ptop">
    <div class="ptitle" id="ptitle"></div>
    <div class="pacts">
      <button id="pAudio">Audio</button>
      <button id="pSubs">Legenda</button>
      <button id="pMode">Modo</button>
      <button id="pDiag">Diagnostico</button>
      <button id="pLink">Copiar link</button>
      <button id="pFs">Tela cheia</button>
      <button id="pClose">Fechar</button>
    </div>
  </div>

  <div class="pctl hidden" id="pctl">
    <button id="pplay">Pausar</button>
    <span id="ptime">0:00</span>
    <input type="range" id="pseek" min="0" max="1000" step="1" value="0">
    <span id="pdur">0:00</span>
    <button id="pvolD">Vol -</button>
    <button id="pvolU">Vol +</button>
  </div>

  <div class="pmsg" id="pmsg"></div>
  <div class="pspin" id="pspin"><div class="spin"></div></div>
  <div class="pmenu hidden" id="pmenu"></div>
</div>

<div id="toast" class="hidden"></div>

<script src="/app.js"></script>
</body>
</html>
'@

# ---------------------------------------------------------------- public/style.css
W 'public/style.css' @'
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
:root {
  --bg:#0b0b11; --card:#16161f; --line:#2a2a35; --fg:#eaeaf2; --mut:#8d8da0; --acc:#7c3aed;
  --pad: clamp(14px, 2.2vw, 30px);
}
html { font-size: 16px; }
html.tv { font-size: 21px; }
body {
  background: var(--bg); color: var(--fg); padding-bottom: 60px;
  font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  overscroll-behavior: none;
  padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right);
}
button { font: inherit; color: inherit; }
:focus { outline: none; }
:focus-visible, .focusable:focus { outline: 3px solid var(--acc); outline-offset: 3px; border-radius: 10px; }

header {
  display: flex; align-items: center; gap: 12px; padding: 14px var(--pad);
  border-bottom: 1px solid var(--line); position: sticky; top: 0;
  background: rgba(11,11,17,.94); backdrop-filter: blur(8px); z-index: 20; flex-wrap: wrap;
}
.logo { font-weight: 800; font-size: 1.2rem; letter-spacing: -.02em; text-decoration: none; color: inherit; }
.logo span { color: var(--acc); }
#q { flex: 1; min-width: 160px; background: var(--card); border: 1px solid var(--line); color: var(--fg); padding: 10px 16px; border-radius: 999px; outline: none; font-size: .95rem; }
#q:focus { border-color: var(--acc); }
.hbtns { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; }
.badge { font-size: .7rem; color: var(--mut); border: 1px solid var(--line); padding: 5px 11px; border-radius: 999px; white-space: nowrap; }

#genres, #modes { display: flex; gap: 8px; padding: 14px var(--pad) 4px; overflow-x: auto; scrollbar-width: none; }
#genres::-webkit-scrollbar, #modes::-webkit-scrollbar { display: none; }
.chip { white-space: nowrap; font-size: .85rem; padding: 9px 16px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--mut); cursor: pointer; }
.chip.on { background: var(--acc); border-color: var(--acc); color: #fff; font-weight: 600; }

main { padding: 8px 0 24px; }
.row { margin-top: 24px; }
.row h2 { font-size: 1rem; padding: 0 var(--pad) 10px; font-weight: 700; }
.strip { display: flex; gap: 12px; overflow-x: auto; padding: 0 var(--pad) 8px; scrollbar-width: none; }
.strip::-webkit-scrollbar { display: none; }

.card { flex: 0 0 clamp(130px, 16vw, 180px); cursor: pointer; transition: transform .15s; position: relative; }
.card:hover { transform: translateY(-4px); }
.card img { width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: 10px; background: var(--card); display: block; }
.card .t { font-size: .8rem; margin-top: 7px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card .m { font-size: .72rem; color: var(--mut); }
.card .bar { position: absolute; left: 6px; right: 6px; bottom: 30%; height: 4px; background: rgba(255,255,255,.25); border-radius: 3px; overflow: hidden; }
.card .bar i { display: block; height: 100%; background: var(--acc); }
.card .progress-label { font-size: .68rem; color: var(--mut); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; padding: 8px var(--pad); }
.grid .card { flex: none; }
.loading { padding: 40px var(--pad); color: var(--mut); }

#modal, #diagModal { position: fixed; inset: 0; background: rgba(0,0,0,.75); z-index: 40; display: flex; align-items: center; justify-content: center; padding: 16px; }
#diagModal { z-index: 70; }
.hidden { display: none !important; }
.sheet { background: #12121a; border: 1px solid var(--line); border-radius: 16px; max-width: 820px; width: 100%; max-height: 92vh; overflow-y: auto; position: relative; }
.close { position: absolute; top: 12px; right: 12px; background: rgba(0,0,0,.6); border: 1px solid var(--line); color: #fff; width: 38px; height: 38px; border-radius: 50%; cursor: pointer; z-index: 2; }
.hero { height: clamp(140px, 26vh, 240px); background-size: cover; background-position: center; border-radius: 16px 16px 0 0; background-color: #1b1b26; }
.dbody { padding: 18px var(--pad) 26px; }
.dbody h1 { font-size: 1.4rem; }
.dmeta { color: var(--mut); font-size: .85rem; margin: 6px 0 12px; }
.dsum { font-size: .88rem; color: #c6c6d4; margin-bottom: 18px; }
pre.dsum { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, Consolas, monospace; font-size: .78rem; }
.sec { font-size: .74rem; text-transform: uppercase; letter-spacing: .1em; color: var(--mut); margin: 20px 0 10px; font-weight: 700; }
.src { display: flex; align-items: center; gap: 10px; padding: 11px 13px; border: 1px solid var(--line); border-radius: 10px; margin-bottom: 8px; font-size: .85rem; flex-wrap: wrap; }
.src .q { font-weight: 700; min-width: 58px; }
.src .s { color: var(--mut); flex: 1; min-width: 120px; }
.play { background: var(--acc); border: 0; color: #fff; font-weight: 700; padding: 10px 20px; border-radius: 8px; cursor: pointer; }
.tag { font-size: .68rem; border: 1px solid var(--line); color: var(--mut); padding: 3px 8px; border-radius: 5px; }
.tag.dub { border-color: #16a34a; color: #4ade80; }
.tag.pt { border-color: #0891b2; color: #67e8f9; }
.tag.warn { border-color: #b45309; color: #fbbf24; }
.alt { background: transparent; border: 1px solid var(--acc); color: #a78bfa; padding: 9px 15px; border-radius: 8px; cursor: pointer; font-size: .85rem; margin-right: 8px; margin-bottom: 8px; }
.alt.on { background: var(--acc); color: #fff; }

#player { position: fixed; inset: 0; background: #000; z-index: 60; display: flex; flex-direction: column; }
#video { flex: 1; width: 100%; min-height: 0; background: #000; }
video::cue { background: rgba(0,0,0,.65); font-size: 1.15em; }
.ptop { display: flex; align-items: center; gap: 10px; padding: 10px var(--pad); background: linear-gradient(180deg, rgba(0,0,0,.85), transparent); position: absolute; top: 0; left: 0; right: 0; z-index: 3; flex-wrap: wrap; }
.ptitle { font-weight: 700; flex: 1; min-width: 120px; }
.pacts { display: flex; gap: 8px; flex-wrap: wrap; }
.pacts button, .pctl button { background: rgba(20,20,28,.9); border: 1px solid var(--line); padding: 9px 14px; border-radius: 8px; cursor: pointer; font-size: .85rem; }
.pctl { display: flex; align-items: center; gap: 10px; padding: 8px var(--pad); background: #0b0b11; border-top: 1px solid var(--line); }
.pctl input[type=range] { flex: 1; min-width: 80px; accent-color: var(--acc); height: 26px; }
.pmsg { position: absolute; bottom: 68px; left: var(--pad); right: var(--pad); font-size: .85rem; color: #cfcfe0; z-index: 3; pointer-events: none; text-shadow: 0 1px 3px #000; }
.pmsg.err { color: #fca5a5; }
.pspin { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 4; background: rgba(0,0,0,.5); }
.spin { width: 46px; height: 46px; border: 4px solid rgba(255,255,255,.25); border-top-color: var(--acc); border-radius: 50%; animation: sp 1s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
.pmenu { position: absolute; right: var(--pad); top: 62px; background: #12121a; border: 1px solid var(--line); border-radius: 12px; padding: 10px; z-index: 5; min-width: 230px; max-height: 70vh; overflow-y: auto; }
.pmenu h3 { font-size: .72rem; text-transform: uppercase; color: var(--mut); letter-spacing: .1em; margin: 8px 4px 4px; }
.pmenu button { display: block; width: 100%; text-align: left; background: transparent; border: 0; padding: 10px 12px; border-radius: 8px; cursor: pointer; font-size: .88rem; }
.pmenu button:hover, .pmenu button.on { background: #1d1d29; }
.pmenu button.on::after { content: ' *'; color: var(--acc); font-weight: 700; }

#toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 26px; background: #17171f; border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; z-index: 90; display: flex; gap: 10px; align-items: center; max-width: 92vw; flex-wrap: wrap; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
#toast button { background: var(--acc); border: 0; color: #fff; padding: 8px 14px; border-radius: 8px; cursor: pointer; }

@media (min-width: 1100px) { html { font-size: 17px; } }

.history-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 var(--pad) 10px; }
.history-head h2 { padding: 0; }
.history-clear { flex: none; background: transparent; border: 1px solid var(--line); color: var(--mut); border-radius: 8px; padding: 5px 10px; font-size: .75rem; cursor: pointer; }
.history-clear:hover { border-color: #ef4444; color: #fca5a5; }

#lbar { display: flex; gap: 8px; padding: 12px var(--pad); flex-wrap: wrap; align-items: center; }
#lbar select, #lbar input { background: var(--card); border: 1px solid var(--line); color: var(--fg); padding: 10px 14px; border-radius: 999px; font: inherit; }
#lbar input { flex: 1; min-width: 150px; }
#lchips { display: flex; gap: 8px; padding: 0 var(--pad) 6px; overflow-x: auto; scrollbar-width: none; }
#lchips::-webkit-scrollbar { display: none; }
.chan { flex: 0 0 clamp(120px, 15vw, 170px); cursor: pointer; }
.chan .box { aspect-ratio: 16/10; background: #12121a; border: 1px solid var(--line); border-radius: 10px; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 10px; }
.chan img { max-width: 100%; max-height: 100%; object-fit: contain; }
.chan .t { font-size: .78rem; margin-top: 6px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chan .m { font-size: .7rem; color: var(--mut); }

.seasonbar { display: flex; gap: 8px; overflow-x: auto; padding: 4px 0 14px; scrollbar-width: none; }
.seasonbar::-webkit-scrollbar { display: none; }
.ep { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; margin-bottom: 8px; cursor: pointer; }
.ep .n { font-weight: 800; color: var(--mut); min-width: 28px; text-align: center; }
.ep .info { flex: 1; min-width: 0; }
.ep .info b { display: block; font-size: .9rem; font-weight: 600; }
.ep .info i { font-size: .74rem; color: var(--mut); font-style: normal; }
.ep:hover { border-color: var(--acc); }
.backbar { margin-bottom: 10px; }
'@

# ---------------------------------------------------------------- public/live.html
W 'public/live.html' @'
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Canais ao vivo - cinep2p</title>
<meta name="theme-color" content="#0b0b11">
<link rel="icon" href="/icon.svg">
<link rel="stylesheet" href="/style.css">
</head>
<body>

<header>
  <a class="logo" href="/">cine<span>p2p</span></a>
  <div id="lbar">
    <select id="country"><option value="">Todos os paises</option></select>
    <input id="q" type="search" placeholder="Buscar canal...">
    <button class="chip" id="tvBtn">TV</button>
  </div>
  <span class="badge" id="total">0 canais</span>
</header>

<nav id="lchips"></nav>

<main><div id="rows"><div class="loading">Carregando canais...</div></div></main>

<div id="player" class="hidden">
  <video id="video" tabindex="0" playsinline></video>
  <div class="ptop" id="ptop">
    <div class="ptitle" id="ptitle"></div>
    <div class="pacts">
      <button id="pReload">Recarregar</button>
      <button id="pFs">Tela cheia</button>
      <button id="pClose">Fechar</button>
    </div>
  </div>
  <div class="pmsg" id="pmsg"></div>
  <div class="pspin" id="pspin"><div class="spin"></div></div>
</div>

<div id="toast" class="hidden"></div>

<script src="https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js"></script>
<script src="/live.js"></script>
</body>
</html>
'@

# ---------------------------------------------------------------- public/live.js
W 'public/live.js' @'
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
'@

# ---------------------------------------------------------------- public/app.js
W 'public/app.js' @'
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
const BR_SHELVES = [
  { title: 'Em Alta (Dublado)', q: 'dublado 1080p', lang: 'dub' },
  { title: 'Lancamentos Dublados', q: 'dublado web-dl', lang: 'dub' },
  { title: 'Nacional / Brasileiro', q: 'nacional 1080p', lang: 'ptbr' },
  { title: 'Dual Audio (PT + Original)', q: 'dual audio 1080p', lang: 'dual' },
  { title: 'Legendado', q: 'legendado 1080p', lang: 'subs' },
  { title: 'Animacao Dublada', q: 'animacao dublado', lang: 'dub' }
]
const SERIES_SHELVES = [
  { title: 'Series Dubladas', q: 'serie dublada 1080p', lang: 'dub' },
  { title: 'Series Legendadas', q: 'serie legendada 1080p', lang: 'subs' },
  { title: 'Series Nacionais', q: 'serie nacional', lang: 'ptbr' },
  { title: 'Top Series HD', cat: '208', lang: 'all' }
]
const DOC_SHELVES = [
  { title: 'Documentarios (dominio publico)', col: 'documentary' },
  { title: 'Filmes classicos', col: 'feature_films' },
  { title: 'Animacao classica', col: 'classic_cartoons' },
  { title: 'Film noir', col: 'film_noir' },
  { title: 'Ficcao cientifica', col: 'sci-fi_horror' },
  { title: 'Prelinger', col: 'prelinger' }
]
const BR_GENRE = {
  action: 'acao', comedy: 'comedia', horror: 'terror', 'sci-fi': 'ficcao',
  animation: 'animacao', thriller: 'suspense', crime: 'crime',
  romance: 'romance', adventure: 'aventura', family: 'familia'
}
const MODE_LABEL = { direct: 'Direto', remux: 'Compativel', transcode: 'Leve' }
const CHAIN = ['direct', 'remux', 'transcode']
const MODE_EL = { br: '#modeBr', world: '#modeWorld', series: '#modeSeries', docs: '#modeDocs' }

const video = $('#video')
const rowsEl = $('#rows')
let activeGenre = ''
let catalogMode = localStorage.getItem('cinep2p.catalogMode') || 'br'
let onlyDub = localStorage.getItem('cinep2p.dub') === '1'
let health = { ffmpeg: false }
const state = { progressByHash: {}, progressByKey: {} }
const LOCAL_PROGRESS_KEY = 'cinep2p.progress.v1'

function readLocalProgress() {
  try { return JSON.parse(localStorage.getItem(LOCAL_PROGRESS_KEY) || '{}') || {} }
  catch { return {} }
}
function saveLocalProgress(item) {
  try {
    const all = readLocalProgress()
    all[item.key] = { ...item, ts: Date.now() }
    const kept = Object.entries(all).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0)).slice(0, 100)
    localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {}
}

async function clearWatchHistory() {
  if (!confirm('Apagar todo o historico de reproducao? Essa acao nao pode ser desfeita.')) return
  clearInterval(saveTimer)
  saveTimer = null
  state.key = null
  try {
    await api('/api/progress', { method: 'DELETE' })
    localStorage.removeItem(LOCAL_PROGRESS_KEY)
    state.progressByHash = {}
    state.progressByKey = {}
    await refreshContinue()
    alert('Historico apagado.')
  } catch {
    localStorage.removeItem(LOCAL_PROGRESS_KEY)
    state.progressByHash = {}
    state.progressByKey = {}
    alert('O historico local foi apagado, mas nao foi possivel apagar o historico do servidor. Verifique a conexao e tente novamente.')
  }
}

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

/* ---------- limpeza de nome de release ---------- */
const JUNK = /\b(2160p|1080p|720p|480p|4k|uhd|bluray|blu-?ray|web-?dl|webrip|hdrip|brrip|dvdrip|remux|hdr|dv|x264|x265|h\.?264|h\.?265|hevc|av1|aac|ac3|ddp?5[ .]?1|dts(-hd)?|truehd|atmos|yify|galaxyrg|yts|dublado|dublada|dublagem|dual|multi|legendado|legendas?|nacional|brasileir[oa]|repackage?d?|proper|extended|imax|10bit|8bit|hq|bone|psa|oft|turg|rarbg)\b/gi
function prettyTitle(name) {
  return String(name || '')
    .replace(/\.(mp4|mkv|avi|mov|webm|m4v|ts)$/i, '')
    .replace(/[._]/g, ' ')
    .replace(JUNK, ' ')
    .replace(/\s*-\s*[a-z0-9]+$/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
const yearOf = name => (/\b(19\d{2}|20\d{2})\b/.exec(String(name || '')) || [])[1] || ''

/* ---------- cartoes ---------- */
function progressFor(movie) {
  if (movie.progressKey) return state.progressByKey[movie.progressKey]
  if (movie.tvKey) return state.progressByKey[movie.tvKey]
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
  if (movie.poster) {
    img.src = movie.poster
    img.onerror = async () => {
      img.onerror = null
      const j = await lookupPoster(movie.title, movie.imdb)
      img.src = j?.poster || fallback
    }
  } else {
    img.src = fallback
    lookupPoster(movie.title, movie.imdb).then(j => { if (j?.poster) img.src = j.poster })
  }
  const t = document.createElement('div'); t.className = 't'; t.textContent = movie.title || 'Sem titulo'
  const m = document.createElement('div'); m.className = 'm'
  const languageLabels = []
  if (movie.dub) languageLabels.push('Dublado')
  else if (movie.dual) languageLabels.push('Dual audio')
  else if ((movie.langs || []).includes('ptbr')) languageLabels.push('Portugues')
  if (movie.subs) languageLabels.push('Legendado')
  m.textContent = [movie.year || '', movie.rating ? 'Nota ' + movie.rating : '', ...languageLabels].filter(Boolean).join(' | ')
  d.append(img, t, m)
  const p = progressFor(movie)
  if (p && p.d) {
    const bar = document.createElement('div'); bar.className = 'bar'
    const i = document.createElement('i'); i.style.width = Math.min(100, (p.t / p.d) * 100) + '%'
    bar.appendChild(i); d.appendChild(bar)
    const label = document.createElement('div'); label.className = 'progress-label'
    label.textContent = (p.t >= p.d * 0.92 || p.d - p.t <= 90) ? 'Assistido' : 'Parou em ' + fmtTime(p.t)
    d.appendChild(label)
  }
  d.onclick = () => opts.direct ? openPlayer(movie.source, movie, movie.file) : openDetail(movie)
  d.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); d.click() } }
  return d
}

function asTorrentMovie(x) {
  return {
    title: prettyTitle(x.title), rawTitle: x.title, year: x.year || yearOf(x.title), poster: '',
    imdb: x.imdb || '', dub: x.dub, dual: x.dual, subs: x.subs, langs: x.langs || [],
    torrents: [x], genres: [], summary: `TPB | ${x.seeds || 0} seeds | ${x.size || '?'}`
  }
}

function archiveCard(item) {
  const d = document.createElement('div')
  d.className = 'card focusable'
  d.tabIndex = 0
  const img = document.createElement('img')
  img.loading = 'lazy'
  img.alt = item.title
  img.src = item.poster
  img.onerror = () => { img.onerror = null; img.src = placeholder(item.title) }
  const t = document.createElement('div'); t.className = 't'; t.textContent = item.title
  const m = document.createElement('div'); m.className = 'm'
  m.textContent = [item.year, 'Archive.org'].filter(Boolean).join(' | ')
  d.append(img, t, m)
  d.onclick = () => openArchive(item)
  d.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); d.click() } }
  return d
}

function showCard(s) {
  const d = document.createElement('div')
  d.className = 'card focusable'
  d.tabIndex = 0
  const img = document.createElement('img')
  img.loading = 'lazy'
  img.alt = s.name
  img.src = s.poster || placeholder(s.name)
  img.onerror = () => { img.onerror = null; img.src = placeholder(s.name) }
  const t = document.createElement('div'); t.className = 't'; t.textContent = s.name
  const m = document.createElement('div'); m.className = 'm'
  m.textContent = [s.year, (s.genres || [])[0], s.status].filter(Boolean).join(' | ')
  d.append(img, t, m)
  d.onclick = () => openShow(s)
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

function stripNodes(title, nodes) {
  const row = document.createElement('div')
  row.className = 'row'
  const h = document.createElement('h2'); h.textContent = title
  const s = document.createElement('div'); s.className = 'strip'
  nodes.forEach(n => s.appendChild(n))
  row.append(h, s)
  return row
}

/* ---------- catalogos ---------- */
function renderBlocks(blocks, emptyMsg) {
  rowsEl.innerHTML = ''
  const frag = document.createDocumentFragment()
  for (const b of blocks) if (b.movies?.length) frag.appendChild(strip(b.shelf.title, b.movies))
  rowsEl.appendChild(frag)
  if (!rowsEl.children.length) rowsEl.innerHTML = `<div class="loading">${esc(emptyMsg)}</div>`
}

async function tpbShelfBlocks(shelves, extraTerm = '') {
  return Promise.all(shelves.map(async shelf => {
    try {
      const p = new URLSearchParams({ limit: '18' })
      const termo = [shelf.q, extraTerm].filter(Boolean).join(' ').trim()
      if (termo) p.set('q', termo)
      if (shelf.cat) p.set('cat', shelf.cat)
      p.set('lang', onlyDub ? 'dub' : shelf.lang)
      const j = await api('/api/br?' + p)
      return { shelf, movies: (j.results || []).map(asTorrentMovie) }
    } catch { return { shelf, movies: [] } }
  }))
}

async function loadBrazilCatalog() {
  const genre = activeGenre ? (BR_GENRE[activeGenre] || '') : ''
  renderBlocks(await tpbShelfBlocks(BR_SHELVES, genre), 'Nada encontrado. Use a busca ou troque de modo.')
}

async function loadSeriesCatalog() {
  const genre = activeGenre ? (BR_GENRE[activeGenre] || '') : ''
  renderBlocks(await tpbShelfBlocks(SERIES_SHELVES, genre), 'Nada encontrado em series. Use a busca para achar uma serie.')
}

async function loadWorldCatalog() {
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
  if (!rowsEl.children.length) rowsEl.innerHTML = '<div class="loading">Nao foi possivel carregar o catalogo Mundo.</div>'
}

async function loadDocsCatalog() {
  const blocks = await Promise.all(DOC_SHELVES.map(async shelf => {
    try {
      const j = await api(`/api/archive?col=${encodeURIComponent(shelf.col)}&limit=18`)
      return { shelf, nodes: (j.results || []).map(archiveCard) }
    } catch { return { shelf, nodes: [] } }
  }))
  rowsEl.innerHTML = ''
  const frag = document.createDocumentFragment()
  for (const b of blocks) if (b.nodes?.length) frag.appendChild(stripNodes(b.shelf.title, b.nodes))
  rowsEl.appendChild(frag)
  if (!rowsEl.children.length) rowsEl.innerHTML = '<div class="loading">Nada encontrado no Archive.org.</div>'
}

async function loadCatalog() {
  rowsEl.innerHTML = '<div class="loading">Carregando catalogo...</div>'
  if (catalogMode === 'br') return loadBrazilCatalog()
  if (catalogMode === 'series') return loadSeriesCatalog()
  if (catalogMode === 'docs') return loadDocsCatalog()
  return loadWorldCatalog()
}

async function refreshContinue() {
  let remote = []
  try { remote = (await api('/api/progress')).items || [] } catch {}
  const local = Object.values(readLocalProgress())
  const merged = new Map()
  for (const item of [...remote, ...local]) {
    if (!item?.key || !item.hash) continue
    const prev = merged.get(item.key)
    if (!prev || Number(item.ts || 0) >= Number(prev.ts || 0)) merged.set(item.key, item)
  }
  const items = [...merged.values()]
    .filter(i => i.d && i.t > 30)
    .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
    .slice(0, 100)
  state.progressByHash = Object.fromEntries(items.map(i => [i.hash, i]))
  state.progressByKey = Object.fromEntries(items.map(i => [i.key, i]))
  const watched = items.filter(i => i.t >= i.d * 0.92 || i.d - i.t <= 90)
  const continuing = items.filter(i => !watched.includes(i))
  const renderRow = (containerId, title, list) => {
    const cont = $(containerId)
    cont.innerHTML = ''
    if (!list.length) return
    const row = document.createElement('div'); row.className = 'row'
    const head = document.createElement('div'); head.className = 'history-head'
    const h = document.createElement('h2'); h.textContent = title
    const clear = document.createElement('button'); clear.className = 'history-clear'; clear.textContent = 'Apagar historico'
    clear.onclick = clearWatchHistory
    head.append(h, clear)
    const s = document.createElement('div'); s.className = 'strip'
    for (const i of list) {
      s.appendChild(card({
        title: i.title || i.name, year: i.year, poster: i.poster,
        hash: i.hash, progressKey: i.key,
        source: { hash: i.hash, title: i.title, source: 'retomar', quality: '' },
        file: i.file
      }, { direct: true }))
    }
    row.append(head, s); cont.appendChild(row)
  }
  renderRow('#contRow', 'Continuar assistindo', continuing)
  renderRow('#watchedRow', 'Ja assistidos', watched)
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

function syncCatalogMode() {
  for (const [k, sel] of Object.entries(MODE_EL)) $(sel).classList.toggle('on', catalogMode === k)
}
for (const [k, sel] of Object.entries(MODE_EL)) {
  $(sel).onclick = () => {
    catalogMode = k
    localStorage.setItem('cinep2p.catalogMode', k)
    syncCatalogMode()
    const q = $('#q').value.trim()
    if (q) runSearch(q); else loadCatalog()
  }
}
$('#liveBtn').onclick = () => { location.href = '/live.html' }
syncCatalogMode()

$('#dubChip').classList.toggle('on', onlyDub)
$('#dubChip').onclick = () => {
  onlyDub = !onlyDub
  localStorage.setItem('cinep2p.dub', onlyDub ? '1' : '0')
  $('#dubChip').classList.toggle('on', onlyDub)
  const q = $('#q').value.trim()
  if (q) runSearch(q); else loadCatalog()
}

/* ---------- espaco em disco ---------- */
async function refreshStorage() {
  try {
    const j = await api('/api/storage')
    $('#spaceBtn').textContent = 'Cache: ' + (j.bytes / 1e6).toFixed(0) + ' MB'
  } catch {}
}
$('#spaceBtn').onclick = async () => {
  if (!confirm('Apagar os arquivos temporarios agora? O progresso e mantido.')) return
  try {
    const j = await api('/api/cleanup', { method: 'POST' })
    toast('Espaco liberado: ' + (j.freed / 1e6).toFixed(0) + ' MB')
    refreshStorage()
  } catch (e) { toast('Falha: ' + e.message) }
}
function releaseTorrent(hash) {
  if (!hash) return
  fetch('/api/stop/' + hash, { method: 'POST', keepalive: true }).catch(() => {})
}

async function runSearch(q) {
  if (catalogMode === 'series') return searchShows(q)
  rowsEl.innerHTML = '<div class="loading">Buscando...</div>'
  try {
    const j = await api(`/api/search?q=${encodeURIComponent(q)}${onlyDub ? '&dub=1' : ''}`)
    rowsEl.innerHTML = ''
    const g = document.createElement('div'); g.className = 'grid'
    const extras = j.extra || []
    const portuguese = extras.filter(x => x.dub || x.dual || (x.langs || []).includes('ptbr'))
    const others = extras.filter(x => !x.dub && !x.dual && !(x.langs || []).includes('ptbr'))
    portuguese.forEach(x => g.appendChild(card(asTorrentMovie(x))))
    ;(j.results || []).forEach(m => g.appendChild(card(m)))
    others.forEach(x => g.appendChild(card(asTorrentMovie(x))))
    rowsEl.appendChild(g)
    if (!g.children.length) rowsEl.innerHTML = '<div class="loading">Nada encontrado.</div>'
  } catch (e) {
    rowsEl.innerHTML = `<div class="loading">Erro: ${esc(e.message)}</div>`
  }
}

async function searchShows(q) {
  rowsEl.innerHTML = '<div class="loading">Buscando series...</div>'
  try {
    const j = await api('/api/tv/search?q=' + encodeURIComponent(q))
    rowsEl.innerHTML = ''
    if (!j.results?.length) { rowsEl.innerHTML = '<div class="loading">Nenhuma serie encontrada.</div>'; return }
    const g = document.createElement('div'); g.className = 'grid'
    j.results.forEach(s => g.appendChild(showCard(s)))
    rowsEl.appendChild(g)
  } catch (e) {
    rowsEl.innerHTML = `<div class="loading">Erro: ${esc(e.message)}</div>`
  }
}

/* ---------- serie: temporadas e episodios ---------- */
async function openShow(show) {
  $('#detail').innerHTML = `
    <div class="hero" style="background-image:url('${esc(show.poster)}')"></div>
    <div class="dbody">
      <h1></h1><div class="dmeta"></div><div class="dsum"></div>
      <div class="seasonbar" id="seasonBar"></div>
      <div id="epList"></div>
    </div>`
  $('#detail h1').textContent = show.name + (show.year ? ` (${show.year})` : '')
  $('#detail .dmeta').textContent = [(show.genres || []).join(' | '), show.status].filter(Boolean).join(' | ')
  $('#detail .dsum').textContent = show.summary || ''
  $('#modal').classList.remove('hidden')
  pushLayer(() => $('#modal').classList.add('hidden'))

  const epList = $('#epList')
  epList.innerHTML = '<div class="dsum">Carregando episodios...</div>'

  let data
  try { data = await api('/api/tv/show/' + show.id) }
  catch (e) { epList.innerHTML = `<div class="dsum">Erro: ${esc(e.message)}</div>`; return }
  if (!data.seasons?.length) { epList.innerHTML = '<div class="dsum">Sem episodios cadastrados.</div>'; return }

  let current = data.seasons[0].season
  const bar = $('#seasonBar')

  const renderEps = () => {
    const season = data.seasons.find(s => s.season === current)
    epList.innerHTML = ''
    for (const ep of season.episodes) {
      const key = `tv:${show.id}:${ep.season}x${ep.episode}`
      const prog = state.progressByKey[key]
      const d = document.createElement('div')
      d.className = 'ep focusable'
      d.tabIndex = 0
      const status = prog && prog.d
        ? (prog.t >= prog.d * 0.92 ? 'assistido' : 'parou em ' + fmtTime(prog.t))
        : (ep.airdate || '')
      d.innerHTML = `<span class="n">${ep.episode}</span>
        <span class="info"><b>${esc(ep.name)}</b><i>${esc(status)}</i></span>
        <button class="play">Fontes</button>`
      d.onclick = () => findEpisode(show, ep)
      d.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); d.click() } }
      epList.appendChild(d)
    }
  }

  const paintSeasons = () => {
    bar.innerHTML = ''
    data.seasons.forEach(s => {
      const b = document.createElement('button')
      b.className = 'chip focusable' + (s.season === current ? ' on' : '')
      b.textContent = 'T' + s.season
      b.onclick = () => { current = s.season; paintSeasons(); renderEps() }
      bar.appendChild(b)
    })
  }

  paintSeasons()
  renderEps()
}

async function findEpisode(show, ep) {
  const epList = $('#epList')
  epList.innerHTML = '<div class="dsum">Buscando fontes...</div>'
  try {
    const p = new URLSearchParams({ title: show.name, season: ep.season, episode: ep.episode })
    if (onlyDub) p.set('dub', '1')
    const j = await api('/api/tv/find?' + p)
    const results = j.results || []
    epList.innerHTML = ''
    const back = document.createElement('button')
    back.className = 'alt focusable backbar'
    back.textContent = 'Voltar para episodios'
    back.onclick = () => openShow(show)
    epList.appendChild(back)
    const head = document.createElement('div')
    head.className = 'dsum'
    head.textContent = `${show.name} T${ep.season}E${ep.episode} - ${ep.name} (${results.length} fontes)`
    epList.appendChild(head)
    if (!results.length) {
      const none = document.createElement('div')
      none.className = 'dsum'
      none.textContent = 'Nenhuma fonte encontrada para este episodio. Tente sem o filtro Dublado.'
      epList.appendChild(none)
      return
    }
    for (const x of results) {
      const movie = {
        title: `${show.name} T${ep.season}E${ep.episode}`,
        rawTitle: x.title,
        year: show.year,
        poster: show.poster,
        tvKey: `tv:${show.id}:${ep.season}x${ep.episode}`,
        torrents: [x],
        genres: [],
        dub: x.dub, dual: x.dual, subs: x.subs, langs: x.langs || []
      }
      epList.appendChild(srcRow(x, movie))
    }
  } catch (e) {
    epList.innerHTML = `<div class="dsum">Erro: ${esc(e.message)}</div>`
  }
}

/* ---------- detalhe (filme) ---------- */
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
      <div class="sec">Outras fontes (busca ampla)</div>
      <button class="alt focusable" id="dubBtn">So dublado</button>
      <button class="alt focusable" id="more">Buscar mais fontes</button>
      <div id="extraList"></div>
    </div>`
  $('#detail h1').textContent = `${movie.title || ''} ${movie.year ? '(' + movie.year + ')' : ''}`
  $('#detail .dmeta').textContent = [(movie.genres || []).join(' | '), movie.rating ? 'Nota ' + movie.rating : '', movie.runtime ? movie.runtime + ' min' : ''].filter(Boolean).join(' | ')
  $('#detail .dsum').textContent = movie.summary || ''

  const list = $('#srcList')
  if (!t.length) list.innerHTML = '<div class="dsum">Nenhuma fonte com seed agora. Use "Buscar mais fontes".</div>'
  t.forEach(x => list.appendChild(srcRow(x, movie)))

  let extraDub = onlyDub
  const dubBtn = $('#dubBtn')
  dubBtn.classList.toggle('on', extraDub)
  dubBtn.onclick = () => { extraDub = !extraDub; dubBtn.classList.toggle('on', extraDub); $('#more').click() }

  $('#more').onclick = async e => {
    e.target.disabled = true
    e.target.textContent = 'Buscando...'
    try {
      const alvo = movie.rawTitle || movie.title
      const j = await api(`/api/extra?title=${encodeURIComponent(alvo)}&year=${movie.year || ''}${extraDub ? '&dub=1' : ''}`)
      const ex = $('#extraList'); ex.innerHTML = ''
      if (!j.results?.length) ex.innerHTML = '<div class="dsum">Nada encontrado.</div>'
      ;(j.results || []).forEach(x => ex.appendChild(srcRow(x, movie)))
      e.target.textContent = 'Buscar mais fontes'
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

function startStatusPolling() {
  clearInterval(poll)
  if (!state.hash) return
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
}

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
    tvKey: movie.tvKey || null,
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

  startStatusPolling()

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
  const key = state.tvKey || `${state.hash}:${state.fileIndex ?? 'main'}`
  state.key = key
  let p = null
  try { p = await api('/api/progress/' + encodeURIComponent(key)) } catch {}
  const local = readLocalProgress()[key]
  if (!p?.t || Number(local?.ts || 0) > Number(p?.ts || 0)) p = local || p
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

/* ---------- player direto (Archive.org) ---------- */
async function openArchive(item) {
  toast('Preparando stream...')
  try {
    const j = await api('/api/archive/' + encodeURIComponent(item.id))
    openDirect(j.url, item.title)
  } catch (e) { toast('Nao foi possivel abrir: ' + e.message) }
}

function openDirect(url, title) {
  Object.assign(state, {
    open: true, movie: { title }, source: { direct: true }, hash: null, fileIndex: null,
    tvKey: null, label: title, mode: 'direct', media: null, files: [], externalSubs: [],
    duration: 0, base: 0, key: null, sub: -1, forceCompat: false, audio: 0, q: ''
  })
  $('#ptitle').textContent = title
  $('#player').classList.remove('hidden')
  $('#pmsg').textContent = ''
  $('#pmsg').classList.remove('err')
  $$('track').forEach(t => t.remove())
  $('#pspin').classList.add('hidden')
  $('#ptop').classList.add('hidden')
  $('#pmenu').classList.add('hidden')
  $('#pctl').classList.remove('hidden')
  video.controls = true
  pushLayer(closePlayer)
  requestWakeLock()
  try { $('#player').requestFullscreen?.().catch(() => {}) } catch {}
  video.src = url
  video.play().catch(() => {})
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
  saveLocalProgress(body)
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
  const hash = state.hash
  try { video.pause() } catch {}
  video.removeAttribute('src'); video.load()
  $('#player').classList.add('hidden')
  $('#pmenu').classList.add('hidden')
  state.open = false
  try { document.exitFullscreen?.() } catch {}
  releaseTorrent(hash)
  refreshContinue()
  refreshStorage()
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
  if (state.source?.direct) { showError('Nao foi possivel reproduzir este stream.', true); return }
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
video.onplay = () => { $('#pplay').textContent = 'Pausar'; requestWakeLock(); if (!poll && state.open && state.hash) startStatusPolling() }
video.onpause = () => { $('#pplay').textContent = 'Tocar'; saveProgress() }
video.onended = () => {
  saveProgress(true)
  clearInterval(poll); poll = null
  const hash = state.hash
  refreshContinue()
  releaseTorrent(hash)
  refreshStorage()
}
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
refreshStorage()
setInterval(refreshStorage, 20000)
refreshContinue().then(loadCatalog)
setInterval(async () => {
  try { const j = await api('/api/active'); $('#badge').textContent = j.active + ' ativos' } catch {}
}, 5000)
'@

# ---------------------------------------------------------------- fim
Write-Host ''
Write-Host ("Pronto. " + $criados + " arquivo(s) criado(s), " + $mudados + " atualizado(s).") -ForegroundColor Cyan
Write-Host ''
Write-Host 'Proximos passos:' -ForegroundColor Cyan
Write-Host '  1) npm install     (so na primeira vez)'
Write-Host '  2) npm start'
Write-Host '  3) abra http://localhost:3000'
Write-Host ''
Write-Host 'Para commitar:' -ForegroundColor Cyan
Write-Host '  git add -A'
Write-Host '  git commit -m "Catalogo PT-BR ampliado, series por episodio, TV ao vivo e liberacao de espaco"'
Write-Host '  git push'
Write-Host ''