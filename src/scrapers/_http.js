'use strict';

/**
 * Infraestrutura comum dos scrapers: HTTP com timeout, helpers de parsing
 * e extracao generica de magnet links a partir de HTML.
 */

const TIMEOUT = Number(process.env.SCRAPER_TIMEOUT || 9) * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchText(url, extraHeaders) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: Object.assign({
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      }, extraHeaders || {})
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJSON(url, extraHeaders) {
  return JSON.parse(await fetchText(url, extraHeaders));
}

/** Dispara todas as URLs em paralelo e devolve a primeira que responder. */
function anyHost(urls, extraHeaders) {
  return Promise.any(urls.map(function (u) { return fetchText(u, extraHeaders); }));
}

function decodeEntities(input) {
  return String(input === null || input === undefined ? '' : input)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(Number(d)); })
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(input) {
  return decodeEntities(String(input || '').replace(/<[^>]*>/g, ' '));
}

function detectQuality(name) {
  const m = /(2160p|1440p|1080p|720p|480p|360p|4k)/i.exec(String(name || ''));
  if (!m) return '';
  const q = m[1].toLowerCase();
  return q === '4k' ? '2160p' : q;
}

function parseSize(text) {
  const m = /(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|KB)/i.exec(String(text || ''));
  if (!m) return { bytes: 0, label: '' };
  const n = Number(m[1].replace(',', '.'));
  const unit = m[2].toUpperCase();
  const mult = { KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 }[unit];
  return { bytes: Math.round(n * mult), label: n.toFixed(n >= 10 ? 0 : 1) + ' ' + unit };
}

function humanSize(bytes) {
  const n = Number(bytes);
  if (!n || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v = v / 1024; i++; }
  return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + units[i];
}

const MAGNET_RE = /magnet:\?xt=urn:btih:([a-zA-Z0-9]{32,40})([^"'\s<>\\]*)/gi;

/**
 * Extrai linhas de resultado de qualquer pagina HTML que contenha magnets.
 * Heuristico e tolerante: titulo = ultimo texto-ancora antes do magnet.
 */
function rowsFromHtml(html, opts) {
  const options = opts || {};
  const out = [];
  const seen = new Set();
  MAGNET_RE.lastIndex = 0;
  let m;
  while ((m = MAGNET_RE.exec(html)) !== null) {
    const hash = m[1].toLowerCase();
    if (seen.has(hash)) continue;
    seen.add(hash);

    const magnet = decodeEntities(m[0]);
    const from = Math.max(0, m.index - 3000);
    const win = html.slice(from, Math.min(html.length, m.index + 300));

    let title = '';
    const anchors = win.match(/>([^<>]{6,170})</g) || [];
    for (let i = anchors.length - 1; i >= 0; i--) {
      const t = stripTags(anchors[i].slice(1, -1));
      if (!t) continue;
      if (/^(magnet|download|baixar|torrent|seeders?|leechers?|size|tamanho|detalhes?|ver)$/i.test(t)) continue;
      if (/^\d+([.,]\d+)?\s*(kb|mb|gb|tb)$/i.test(t)) continue;
      title = t;
      break;
    }
    if (!title) title = options.fallbackTitle || '';

    const size = parseSize(win);
    let seeders = 0;
    const sm = /(?:seeders?|seeds?|semeadores|semeando|s)$/i.exec('') ? null : /(?:seeders?|seeds?|semeadores|semeando)[^0-9]{0,25}(\d{1,6})/i.exec(win);
    if (sm) seeders = Number(sm[1]);
    if (!seeders) {
      const sm2 = /(\d{1,6})\s*<\/td>\s*<td[^>]*>\s*\d{1,6}/.exec(win);
      if (sm2) seeders = Number(sm2[1]);
    }

    out.push({
      title: title,
      magnet: magnet,
      hash: hash,
      quality: detectQuality(title || options.fallbackTitle || ''),
      size: size.label,
      sizeBytes: size.bytes,
      seeders: seeders,
      fileIdx: null,
      source: options.source || ''
    });
  }
  return out;
}

/** Scrape de 2 niveis: pagina de busca -> paginas de detalhe -> magnets. */
async function deepSearch(searchUrl, detailPattern, limit, source) {
  const html = await fetchText(searchUrl);
  const re = new RegExp(detailPattern, 'g');
  const links = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const link = m[1] || m[0];
    if (seen.has(link)) continue;
    seen.add(link);
    links.push(link);
    if (links.length >= (limit || 3)) break;
  }
  if (!links.length) return [];
  const pages = await Promise.all(links.map(function (u) {
    return fetchText(u).catch(function () { return ''; });
  }));
  const out = [];
  pages.forEach(function (page) {
    if (!page) return;
    rowsFromHtml(page, { source: source }).forEach(function (r) { out.push(r); });
  });
  return out;
}

module.exports = {
  fetchText, fetchJSON, anyHost, decodeEntities, stripTags,
  detectQuality, parseSize, humanSize, rowsFromHtml, deepSearch
};