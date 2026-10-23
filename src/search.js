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
    all = all.filter(t => matchesLang(t, 'dub'))
  }

  const pt = []
  const rest = []
  for (const t of all) (matchesLang(t, 'pt') ? pt : rest).push(t)

  return { extras: [...rank(pt), ...rank(rest)].slice(0, limit), total: all.length }
}
