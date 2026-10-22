import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import selfsigned from 'selfsigned'

export function ensureCerts(dir) {
  const keyPath = path.join(dir, 'key.pem')
  const certPath = path.join(dir, 'cert.pem')
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
  }
  const ips = ['127.0.0.1']
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address)
  }
  const altNames = [{ type: 2, value: 'localhost' }, ...ips.map(ip => ({ type: 7, ip }))]
  const pems = selfsigned.generate([{ name: 'commonName', value: 'cinep2p' }], {
    days: 3650, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }, { name: 'basicConstraints', cA: true }]
  })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(keyPath, pems.private)
  fs.writeFileSync(certPath, pems.cert)
  return { key: pems.private, cert: pems.cert }
}
