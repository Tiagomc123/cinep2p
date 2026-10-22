import fs from 'node:fs'
import path from 'node:path'

const DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const FILE = path.join(DIR, 'progress.json')
fs.mkdirSync(DIR, { recursive: true })

let data = {}
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {} } catch {}
let dirty = false

function save() {
  if (!dirty) return
  dirty = false
  try {
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(data))
    fs.renameSync(FILE + '.tmp', FILE)
  } catch {}
}
setInterval(save, 5000).unref()

export const get = key => data[key] || null
export const set = (key, val) => { data[key] = { ...val, ts: Date.now() }; dirty = true }
export const del = key => { delete data[key]; dirty = true }
export const recent = (limit = 24) =>
  Object.entries(data).map(([key, v]) => ({ key, ...v }))
    .filter(v => v.t > 15)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)

function prune() {
  const cut = Date.now() - 180 * 864e5
  for (const [k, v] of Object.entries(data)) if (v.ts < cut) { delete data[k]; dirty = true }
}
prune()
setInterval(prune, 3600e3).unref()
