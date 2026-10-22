// fix.mjs - corrige "Invalid torrent identifier"
import fs from 'node:fs'

// 1) streamer.js: manda o infoHash direto, sem string de magnet
{
  const file = 'src/streamer.js'
  const s = fs.readFileSync(file, 'utf8')
  const oldS = "client.add(buildMagnet(key, name), {"
  const newS = "client.add({ infoHash: key, name: String(name || '').slice(0, 120) }, {"
  if (s.includes(oldS)) {
    fs.writeFileSync(file, s.split(oldS).join(newS))
    console.log('  ok  ' + file)
  } else console.log('  ! padrao nao encontrado em ' + file)
}

// 2) yts.js: magnet na forma canonica (xt e tr crus, sem percent-encoding)
{
  const file = 'src/yts.js'
  const s = fs.readFileSync(file, 'utf8')
  const NOVA = "export function buildMagnet(hash, name = '') {\n" +
    "  const dn = String(name || '').replace(/[^\\w .-]+/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 90)\n" +
    "  const parts = ['xt=urn:btih:' + hash]\n" +
    "  if (dn) parts.push('dn=' + dn.replace(/ /g, '+'))\n" +
    "  for (const t of TRACKERS) parts.push('tr=' + t)\n" +
    "  return 'magnet:?' + parts.join('&')\n" +
    "}"
  if (/export function buildMagnet[\s\S]*?\n}/.test(s)) {
    fs.writeFileSync(file, s.replace(/export function buildMagnet[\s\S]*?\n}/, NOVA))
    console.log('  ok  ' + file)
  } else console.log('  ! buildMagnet nao encontrado em ' + file)
}

console.log('')
console.log('  agora: Ctrl+C no servidor e rode npm run https')