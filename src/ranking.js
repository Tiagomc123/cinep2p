'use strict';

/**
 * Ranking: identidade -> descarte de instalador -> nivel de audio -> seeders.
 *
 * Regra nova: qualquer resultado que pareca instalador de PC, ativador ou
 * imagem de disco e sumariamente rejeitado antes de tudo.
 */

const ptbr = require('./ptbr');
const validar = require('./validar');

const RANK_NIVEL = {
  duals51: 6, confirmado: 5, provavel: 4, incerto: 3, fraco: 2, estrangeiro: 1, desconhecido: 0
};

/* Sinais fortes: sozinhos ja condenam o arquivo */
const RE_INSTALADOR_FORTE = /(monkrus|preactivated|pre-activated|\bkeygen\b|\bcrack(ed|eado)?\b|\bactivator\b|\bativador\b|\bportable\b|\bkms(?:pico|auto)?\b|\.exe\b|\.iso\b|\.img\b|\.zip\b|\.rar\b|\.7z\b|\.msi\b|\bx64\b|\bx86\b|\bwin(?:dows)?\b)/i;

/* Sinais fracos: so condenam se nao houver marcador de video */
const RE_INSTALADOR_FRACO = /(\brepack\b|\bpatch\b|\bsetup\b|\binstaller\b|\binstalador\b|\bserial\b|\bmedicine\b|\bupdate\b)/i;

const RE_MARCADOR_VIDEO = /(2160p|1440p|1080p|720p|480p|4k|bluray|bdrip|brrip|webrip|web[\s._-]?dl|remux|hdtv|dvdrip|x264|x265|h264|h265|hevc|av1)/i;

function ehInstalador(nome) {
  const n = String(nome || '');
  if (RE_INSTALADOR_FORTE.test(n)) return true;
  if (RE_INSTALADOR_FRACO.test(n) && !RE_MARCADOR_VIDEO.test(n)) return true;
  if (RE_INSTALADOR_FRACO.test(n) && !/\b(19|20)\d{2}\b/.test(n) && !RE_MARCADOR_VIDEO.test(n)) return true;
  return false;
}

function pad(n) { return String(n || 1).padStart(2, '0'); }

function bonusQualidade(q) {
  switch (String(q || '').toLowerCase()) {
    case '1080p': return 520;
    case '720p': return 300;
    case '2160p': return 430;
    case '480p': return 80;
    default: return 150;
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
  let s = (RANK_NIVEL[item.ptbr.nivel] || 0) * 100000;
  s += Math.log10(Math.max(1, item.seeders) + 1) * 1200;
  s += bonusQualidade(item.quality);

  if (item.ptbr.temDual51) s += 900;
  if (contemPalavras(item.title, ctx.titulo)) s += 220;
  if (contemPalavras(item.title, ctx.tituloOriginal)) s += 180;
  if (item.fileIdx !== null && item.fileIdx !== undefined) s += 70;

  if (ctx.tipo === 'tv') {
    const tag = 'S' + pad(ctx.temporada) + 'E' + pad(ctx.episodio);
    const reExato = new RegExp(tag, 'i');
    const reOutroEp = /\bS\d{1,2}E\d{1,2}\b/i;
    const rePack = /(complete|completa|temporada\s*\d|season\s*\d|\bpack\b)/i;
    if (reExato.test(item.title)) s += 1200;
    else if (reOutroEp.test(item.title)) s -= 200;
    if (rePack.test(item.title) && !reExato.test(item.title)) s -= 600;
  } else if (ctx.ano && String(item.title).indexOf(String(ctx.ano)) !== -1) {
    s += 260;
  }

  if (item.quality === '2160p' && item.seeders < 15) s -= 900;
  if (item.quality === '2160p' && /(\bdv\b|dolby[\s._-]?vision|hdr10|\bhdr\b)/i.test(item.title)) s -= 250;
  if (/(\bcam\b|\bts\b|hdcam|hdts|telesync)/i.test(item.title)) s -= 450;
  if (item.seeders === 0) s -= 400;
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
    imdbConfirmado: !!item.imdbConfirmado,
    score: 0,
    ptbr: null,
    elegivel: false
  };
}

function deduplicar(lista) {
  const mapa = new Map();
  lista.forEach(function (item) {
    const chave = item.hash || item.magnet;
    if (!chave) return;
    const atual = mapa.get(chave);
    if (!atual) { mapa.set(chave, item); return; }
    if (item.score > atual.score) { mapa.set(chave, item); return; }
    if (item.seeders > atual.seeders) atual.seeders = item.seeders;
    if (!atual.size && item.size) { atual.size = item.size; atual.sizeBytes = item.sizeBytes; }
    if (atual.fileIdx === null && item.fileIdx !== null) atual.fileIdx = item.fileIdx;
    if (!atual.quality && item.quality) atual.quality = item.quality;
  });
  return Array.from(mapa.values());
}

function preparar(lista, ctx) {
  const estrito = process.env.FILTRO_ESTRITO !== '0';
  const semInstalador = process.env.FILTRO_INSTALADOR !== '0';

  const validos = [];
  const descartados = [];

  lista
    .filter(function (i) { return i && i.magnet && /^magnet:/i.test(i.magnet); })
    .forEach(function (bruto) {
      const item = normalizar(bruto);

      if (semInstalador && ehInstalador(item.title)) {
        item.valido = false;
        item.motivoInvalido = 'descartado: instalador/ativador/iso';
        descartados.push(item);
        return;
      }

      if (!estrito || item.imdbConfirmado) {
        item.valido = true;
        item.motivoInvalido = item.imdbConfirmado ? 'imdb id confirmado' : 'filtro desligado';
      } else {
        const v = validar.validar(item.title, ctx);
        item.valido = v.ok;
        item.motivoInvalido = v.ok ? v.motivo : ('descartado: ' + v.motivo);
      }

      if (item.valido) validos.push(item);
      else descartados.push(item);
    });

  validos.forEach(function (i) {
    i.ptbr = ptbr.avaliar(i.title, i.source);
    i.elegivel = i.ptbr.elegivel;
    i.score = pontuar(i, ctx);
  });

  const unicos = deduplicar(validos);
  unicos.sort(function (a, b) { return b.score - a.score; });
  return { validos: unicos, descartados: descartados };
}

module.exports = { preparar: preparar, RANK_NIVEL: RANK_NIVEL, ehInstalador: ehInstalador };