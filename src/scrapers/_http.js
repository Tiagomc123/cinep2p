'use strict';

const TIMEOUT = Number(process.env.SCRAPER_TIMEOUT || 9) * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchText(url, extraHeaders) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: Object.assign({
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      }, extraHeaders || {})
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally { clearTimeout(timer); }
}

async function fetchJSON(url, extraHeaders) {
  return JSON.parse(await fetchText(url, extraHeaders));
}

async function fetchJSONPost(url, corpo, extraHeaders) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: Object.assign({
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': UA
      }, extraHeaders || {}),
      body: JSON.stringify(corpo)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

function decodeEntities(input) {
  return String(input === null || input === undefined ? '' : input)
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;/g, "'").replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ').replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(Number(d)); })
    .replace(/\s+/g, ' ').trim();
}

function stripTags(input) { return decodeEntities(String(input || '').replace(/<[^>]*>/g, ' ')); }

function detectQuality(name) {
  const m = /(2160p|1440p|1080p|720p|480p|360p|4k)/i.exec(String(name || ''));
  if (!m) return '';
  const q = m[1].toLowerCase();
  return q === '4k' ? '2160p' : q;
}

function humanSize(bytes) {
  const n = Number(bytes);
  if (!n || n <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v = v / 1024; i++; }
  return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}

function parseSize(texto) {
  const m = /(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|KB)/i.exec(String(texto || ''));
  if (!m) return { bytes: 0, label: '' };
  const n = Number(m[1].replace(',', '.'));
  const u = m[2].toUpperCase();
  const mult = { KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 }[u];
  return { bytes: Math.round(n * mult), label: n.toFixed(n >= 10 ? 0 : 1) + ' ' + u };
}

const MAGNET_RE = /magnet:\?xt=urn:btih:([a-zA-Z0-9]{32,40})([^"'\s<>\\]*)/gi;

function rowsFromHtml(html, opts) {
  const o = opts || {};
  const saida = [];
  const vistos = new Set();
  MAGNET_RE.lastIndex = 0;
  let m;
  while ((m = MAGNET_RE.exec(html)) !== null) {
    const hash = m[1].toLowerCase();
    if (vistos.has(hash)) continue;
    vistos.add(hash);
    const magnet = decodeEntities(m[0]);
    const win = html.slice(Math.max(0, m.index - 3000), Math.min(html.length, m.index + 300));
    let titulo = '';
    const ancoras = win.match(/>([^<>]{6,170})</g) || [];
    for (let i = ancoras.length - 1; i >= 0; i--) {
      const t = stripTags(ancoras[i].slice(1, -1));
      if (!t) continue;
      if (/^(magnet|download|baixar|torrent|seeders?|leechers?|size|tamanho)$/i.test(t)) continue;
      if (/^\d+([.,]\d+)?\s*(kb|mb|gb|tb)$/i.test(t)) continue;
      titulo = t; break;
    }
    if (!titulo) titulo = o.fallbackTitle || '';
    const tam = parseSize(win);
    let seeders = 0;
    const sm = /(?:seeders?|seeds?)[^0-9]{0,25}(\d{1,6})/i.exec(win);
    if (sm) seeders = Number(sm[1]);
    saida.push({
      title: titulo, magnet: magnet, hash: hash,
      quality: detectQuality(titulo), size: tam.label, sizeBytes: tam.bytes,
      seeders: seeders, fileIdx: null, source: o.source || ''
    });
  }
  return saida;
}

async function deepSearch(searchUrl, padrao, limite, source) {
  const html = await fetchText(searchUrl);
  const re = new RegExp(padrao, 'g');
  const links = [];
  const vistos = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const l = m[1] || m[0];
    if (vistos.has(l)) continue;
    vistos.add(l);
    links.push(l);
    if (links.length >= (limite || 3)) break;
  }
  if (!links.length) return [];
  const paginas = await Promise.all(links.map(function (u) { return fetchText(u).catch(function () { return ''; }); }));
  const saida = [];
  paginas.forEach(function (p) { if (p) rowsFromHtml(p, { source: source }).forEach(function (r) { saida.push(r); }); });
  return saida;
}

module.exports = {
  fetchText: fetchText, fetchJSON: fetchJSON, fetchJSONPost: fetchJSONPost,
  decodeEntities: decodeEntities, stripTags: stripTags, detectQuality: detectQuality,
  humanSize: humanSize, parseSize: parseSize, rowsFromHtml: rowsFromHtml, deepSearch: deepSearch
};