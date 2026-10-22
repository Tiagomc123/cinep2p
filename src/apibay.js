import { detectAudio } from './lang.js'

const MIRRORS = ['https://apibay.org', 'https://apibay.qicp.vip']
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

const VIDEO_CATS = new Set([201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 505])
const CAT = { 201: 'DVD', 207: 'HD', 208: 'Serie', 209: '3D', 211: '4K', 505: 'Adulto', 601: 'Livro', 602: 'HQ', 104: 'FLAC', 102: 'Audio livro' }

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

async function fetchMirror(q) {
  let lastErr
  for (const base of MIRRORS) {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 12000)
    try {
      const r = await fetch(`${base}/q.php?q=${encodeURIComponent(q)}`, {
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

export async function searchApibay(q) {
  const j = await fetchMirror(q)
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

function score(t) {
  let s = Math.min(t.seeds, 250)
  if (t.quality === '1080p') s += 60
  else if (t.quality === '720p') s += 35
  else if (t.quality === '2160p') s += 12
  if (t.codec === 'x264') s += 14
  if (t.codec === 'x265') s += 6
  // Prioridade forte para audio em portugues; seeds/qualidade desempata depois.
  if (t.dub) s += 1000
  else if (t.dual || (t.langs || []).includes('ptbr')) s += 700
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

export function rank(list, { onlyDub = false } = {}) {
  const out = onlyDub ? list.filter(t => t.dub || t.dual) : [...list]
  return out.sort((a, b) => score(b) - score(a))
}
