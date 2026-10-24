'use strict';

/**
 * Inteligencia de strings + deduplicacao + ordenacao.
 *
 * Prioridade: DUBLADO > PT-BR/NACIONAL > DUAL AUDIO > seeders > qualidade.
 * Penaliza CAM/TS e resultados sem peers.
 */

const RE_DUB = /(dublado|dublada|\bdub\b|\bdublagem\b)/i;
const RE_DUAL = /(dual[\s._-]?audio|\bdual\b)/i;
const RE_PTBR = /(pt[\s._-]?br|ptbr|\bnacional\b|portugu[eê]s|\bbr\b|brazilian|webdl br|bluray br)/i;
const RE_LEG = /(legendado|\bleg\b|subtitulad|\bsub\b)/i;
const RE_CAM = /(\bcam\b|\bts\b|hdcam|hdts|telesync|pre[\s._-]?dvd)/i;
const RE_REMO = /(remux|bluray|bdrip|brrip|web[\s._-]?dl|webrip|hdtv|dvdrip)/i;

function analisarTitulo(nome) {
  const n = String(nome || '');
  const info = {
    dub: RE_DUB.test(n),
    dual: RE_DUAL.test(n),
    ptbr: RE_PTBR.test(n),
    leg: RE_LEG.test(n),
    cam: RE_CAM.test(n)
  };
  info.br = info.dub || info.dual || info.ptbr;
  return info;
}

function rotuloAudio(info) {
  if (info.dub) return 'Dublado';
  if (info.dual) return 'Dual Audio';
  if (info.ptbr) return 'PT-BR';
  if (info.leg) return 'Legendado';
  return 'Original';
}

function pesoQualidade(q) {
  switch (String(q || '').toLowerCase()) {
    case '2160p': return 3.2;
    case '1080p': return 4;
    case '720p': return 2.4;
    case '480p': return 1;
    default: return 1.6;
  }
}

function contemPalavras(titulo, alvo) {
  if (!alvo) return false;
  const t = String(titulo).toLowerCase();
  return String(alvo).toLowerCase().split(/[^a-z0-9]+/)
    .filter(function (w) { return w.length > 3; })
    .some(function (w) { return t.indexOf(w) !== -1; });
}

function pontuar(item, ctx) {
  const info = item._info || analisarTitulo(item.title);
  let s = 0;

  if (info.dub) s += 1400;
  if (info.ptbr) s += 1200;
  if (info.dual) s += 1000;
  if (info.br) s += 400;
  if (info.leg) s += 120;

  s += pesoQualidade(item.quality) * 380;
  s += Math.log10(Math.max(1, item.seeders)) * 170;

  if (ctx.ano && String(item.title).indexOf(String(ctx.ano)) !== -1) s += 220;
  if (contemPalavras(item.title, ctx.titulo)) s += 180;
  if (contemPalavras(item.title, ctx.tituloOriginal)) s += 150;
  if (RE_REMO.test(item.title)) s += 90;
  if (item.fileIdx !== null && item.fileIdx !== undefined) s += 70;
  if (info.cam) s -= 320;
  if (item.seeders === 0) s -= 120;
  if (item.sizeBytes && item.sizeBytes < 200 * 1024 * 1024) s -= 60;

  return s;
}

function normalizar(item) {
  const nome = String(item.title || '').replace(/\s+/g, ' ').trim();
  return {
    title: nome || 'Torrent',
    magnet: item.magnet,
    hash: String(item.hash || '').toLowerCase(),
    quality: item.quality || '',
    size: item.size || '',
    sizeBytes: item.sizeBytes || 0,
    seeders: Number(item.seeders || 0),
    fileIdx: (item.fileIdx === null || item.fileIdx === undefined) ? null : item.fileIdx,
    source: item.source || 'Desconhecida',
    audio: rotuloAudio(analisarTitulo(nome))
  };
}

function deduplicar(lista) {
  const mapa = new Map();
  lista.forEach(function (item) {
    const chave = item.hash || item.magnet;
    if (!chave) return;
    const atual = mapa.get(chave);
    if (!atual) { mapa.set(chave, item); return; }
    // mantem o registro mais completo (seeders, fileIdx, tamanho)
    if (item.seeders > atual.seeders) atual.seeders = item.seeders;
    if (!atual.size && item.size) { atual.size = item.size; atual.sizeBytes = item.sizeBytes; }
    if (atual.fileIdx === null && item.fileIdx !== null) atual.fileIdx = item.fileIdx;
    if (!atual.quality && item.quality) atual.quality = item.quality;
  });
  return Array.from(mapa.values());
}

function preparar(lista, ctx) {
  const validos = lista
    .filter(function (i) { return i && i.magnet && /^magnet:/i.test(i.magnet); })
    .map(normalizar);

  validos.forEach(function (i) { i._info = analisarTitulo(i.title); });

  const unicos = deduplicar(validos);
  unicos.forEach(function (i) { i.score = pontuar(i, ctx); });
  unicos.sort(function (a, b) { return b.score - a.score; });
  return unicos;
}

module.exports = { preparar: preparar, analisarTitulo: analisarTitulo, rotuloAudio: rotuloAudio };