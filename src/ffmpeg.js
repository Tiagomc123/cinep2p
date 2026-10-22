// ffmpeg/ffprobe: usa o binario que vem junto (ffmpeg-static / ffprobe-static)
// e, se nao existir, tenta o do sistema. Sem isso, mkv/x265/audio AC3 nao tocam.

import fs from 'node:fs'
import { spawn } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

const staticFfmpeg = typeof ffmpegStatic === 'string' ? ffmpegStatic : (ffmpegStatic?.default || null)
const staticFfprobe = typeof ffprobeStatic === 'string' ? ffprobeStatic : (ffprobeStatic?.path || ffprobeStatic?.default?.path || null)

let ffmpegPath = null
let ffprobePath = null
let ffmpegSource = null
let checked = false

function fileOk(p) {
  if (!p) return false
  if (!p.includes('/') && !p.includes('\\')) return true
  try { return fs.existsSync(p) } catch { return false }
}

function works(cmd, args) {
  return new Promise(resolve => {
    if (!cmd) return resolve(false)
    let done = false
    let p
    try { p = spawn(cmd, args, { stdio: 'ignore' }) } catch { return resolve(false) }
    p.on('error', () => { if (!done) { done = true; resolve(false) } })
    p.on('close', code => { if (!done) { done = true; resolve(code === 0) } })
  })
}

async function pick(list, args) {
  for (const [cmd, source] of list) {
    if (!fileOk(cmd)) continue
    if (await works(cmd, args)) return { cmd, source }
  }
  return { cmd: null, source: null }
}

export async function ensureFfmpeg() {
  if (checked) return Boolean(ffmpegPath)
  checked = true
  if (process.env.FFMPEG_DISABLE === '1') return false
  const ff = await pick([
    [process.env.FFMPEG_PATH, 'env'],
    [staticFfmpeg, 'ffmpeg-static'],
    ['ffmpeg', 'PATH']
  ], ['-version'])
  const fp = await pick([
    [process.env.FFPROBE_PATH, 'env'],
    [staticFfprobe, 'ffprobe-static'],
    ['ffprobe', 'PATH']
  ], ['-version'])
  ffmpegPath = ff.cmd
  ffmpegSource = ff.source
  ffprobePath = fp.cmd
  return Boolean(ffmpegPath)
}

export const ffmpegCmd = () => ffmpegPath
export const ffprobeCmd = () => ffprobePath
export const ffmpegInfo = () => ({ ok: Boolean(ffmpegPath), source: ffmpegSource, path: ffmpegPath })

// Le alguns MB do stream e devolve faixas (video/audio/legenda) + duracao.
export function probe(makeStream, timeout = 25000) {
  return new Promise(resolve => {
    if (!ffprobePath) return resolve(null)
    const args = [
      '-hide_banner', '-v', 'error', '-probesize', '4M', '-analyzeduration', '4M', '-i', 'pipe:0',
      '-show_entries', 'stream=index,codec_type,codec_name,channels,width,height:stream_tags=language,title:format=duration,format_name',
      '-of', 'json'
    ]
    const p = spawn(ffprobePath, args, { stdio: ['pipe', 'pipe', 'ignore'] })
    const stream = makeStream()
    let out = ''
    let done = false
    const finish = val => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { stream.destroy() } catch {}
      try { p.kill('SIGKILL') } catch {}
      resolve(val)
    }
    const timer = setTimeout(() => finish(null), timeout)
    p.stdin.on('error', () => {})
    p.stdout.on('data', d => { out += d })
    p.on('error', () => finish(null))
    p.on('close', () => {
      try { finish(parse(JSON.parse(out))) } catch { finish(null) }
    })
    stream.on('error', () => finish(null))
    stream.pipe(p.stdin)
  })
}

function parse(j) {
  const st = j.streams || []
  const v = st.find(s => s.codec_type === 'video' && s.width)
  return {
    duration: Number(j.format?.duration) || 0,
    format: j.format?.format_name || '',
    video: v ? { codec: v.codec_name, width: v.width, height: v.height } : null,
    audios: st.filter(s => s.codec_type === 'audio').map((s, i) => ({
      i, codec: s.codec_name || '', channels: s.channels || 0,
      lang: String(s.tags?.language || '').toLowerCase(), title: s.tags?.title || ''
    })),
    subs: st.filter(s => s.codec_type === 'subtitle').map((s, i) => ({
      i, codec: s.codec_name || '',
      lang: String(s.tags?.language || '').toLowerCase(), title: s.tags?.title || ''
    }))
  }
}
