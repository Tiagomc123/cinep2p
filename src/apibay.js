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

export async function searchApibay(q) {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), 12000)
  let j
  try {
    const r = await fetch(`https://apibay.org/q.php?q=${encodeURIComponent(q)}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'cinep2p/0.1' }
    })
    j = await r.json()
  } finally {
    clearTimeout(to)
  }
  if (!Array.isArray(j) || !j.length) return []
  if (j[0].name === 'No results returned') return []
  return j.map(x => ({
    hash: x.info_hash,
    title: x.name,
    seeds: Number(x.seeders) || 0,
    peers: Number(x.leechers) || 0,
    sizeBytes: Number(x.size) || 0,
    size: human(Number(x.size) || 0),
    quality: qualityOf(x.name),
    source: 'TPB'
  })).filter(x => x.seeds > 0 && x.hash && x.hash.length === 40)
}

function score(t) {
  let s = Math.min(t.seeds, 200)
  if (t.quality === '1080p') s += 60
  else if (t.quality === '720p') s += 35
  else if (t.quality === '2160p') s += 15
  if (/x264|h\.?264|avc/i.test(t.title)) s += 12
  if (/dual|dublado|legendado|pt-?br|portugu/i.test(t.title)) s += 30
  if (/\b(cam|hdcam|ts)\b/i.test(t.title)) s -= 45
  if (/\b3d\b/i.test(t.title)) s -= 15
  const gb = t.sizeBytes / 1e9
  if (gb > 4) s -= (gb - 4) * 4
  return s
}

export function rank(list) {
  return [...list].sort((a, b) => score(b) - score(a))
}