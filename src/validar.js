'use strict';

/**
 * Validacao RIGIDA contra titulos misturados.
 *
 * Regras (todas precisam passar):
 *   1. todos os tokens significativos do titulo esperado devem aparecer no nome
 *      (usa titulo localizado + original + aliases BR/PT do TMDb)
 *   2. o ano do TMDb precisa aparecer no nome (tolerancia de 1 ano)
 *   3. se o nome nao tem ano, exige cobertura total de tokens
 *
 * Isso mata remakes, sequencias e homonimos:
 *   "Dune" 2021 x "Dune Part Two 2024"  -> rejeitado
 *   "Blade Runner" 1982 x "Blade Runner 2049" -> rejeitado
 */

const STOP = new Set([
  'the', 'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'and', 'of',
  'in', 'on', 'um', 'uma', 'la', 'le', 'el', 'les', 'der', 'die', 'en', 'y',
  'ao', 'aos', 'no', 'na', 'nos', 'nas', 'por', 'com', 'to', 'for'
]);

const NUM = {
  ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9',
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9',
  um: '1', dois: '2', tres: '3', quatro: '4', cinco: '5'
};

const TAGS = /\b(2160p|1440p|1080p|720p|480p|360p|4k|bluray|blu ray|bdrip|brrip|bdremux|remux|webrip|web dl|webdl|web|hdtv|dvdrip|dvd|hdrip|hdcam|cam|ts|dual|multi|dublado|dublada|legendado|nacional|portugues|audio|ac3|eac3|ddp|dd|dts hd|dts x|dts|truehd|atmos|aac|mp3|opus|x264|x265|h264|h265|hevc|avc|10bit|8bit|hdr|hdr10|dv|dolby|vision|proper|repack|extended|unrated|imax|remastered|yts|yify|rarbg|galaxyrg|eztv|amzn|nf|dsnp|hmax|atvp|hulu|ita|eng|rus|esp|fre|ger|jap|chi|kor|por|pt br|ptbr|br|mkv|mp4|avi|srt|subs|sub|full|hq|complete|completa|temporada|season)\b/gi;

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(texto) {
  return normalizar(texto).split(' ')
    .filter(Boolean)
    .map(function (t) { return NUM[t] || t; })
    .filter(function (t) { return t.length > 1 && !STOP.has(t); });
}

function anosDoNome(nome) {
  return (normalizar(nome).match(/\b(19\d{2}|20\d{2})\b/g) || []);
}

function nomeBase(nome) {
  return normalizar(String(nome || '').replace(TAGS, ' ').replace(/\bS\d{1,2}(E\d{1,2})?\b/gi, ' '));
}

function validar(nome, ctx) {
  if (!nome) return { ok: false, motivo: 'nome vazio' };

  const alvos = [ctx.titulo, ctx.tituloOriginal]
    .concat(ctx.aliases || [])
    .filter(Boolean);

  if (!alvos.length) return { ok: true, motivo: 'sem titulo de referencia' };

  const nomeNorm = ' ' + normalizar(nome) + ' ';

  let melhor = 0;
  let melhorAlvo = '';
  let faltando = [];

  alvos.forEach(function (alvo) {
    const tk = tokens(alvo);
    if (!tk.length) return;
    const ausentes = tk.filter(function (t) { return nomeNorm.indexOf(' ' + t + ' ') === -1; });
    const cobertura = (tk.length - ausentes.length) / tk.length;
    if (cobertura > melhor) { melhor = cobertura; melhorAlvo = alvo; faltando = ausentes; }
  });

  if (!melhorAlvo) return { ok: true, motivo: 'sem tokens comparaveis' };

  const anos = anosDoNome(nome);
  const anoCtx = Number(ctx.ano) || 0;
  const anoOk = !anoCtx || anos.indexOf(String(anoCtx)) !== -1;
  const anoProximo = !anoCtx || anos.some(function (a) { return Math.abs(Number(a) - anoCtx) <= 1; });

  if (melhor < 0.8) {
    return { ok: false, motivo: 'titulo diferente (' + Math.round(melhor * 100) + '% de "' + melhorAlvo + '")' };
  }
  if (anos.length && !anoProximo) {
    return { ok: false, motivo: 'ano diferente (' + anos.join('/') + ' vs ' + anoCtx + ')' };
  }
  if (!anos.length && melhor < 1) {
    return { ok: false, motivo: 'sem ano no nome e titulo parcial' };
  }
  if (faltando.length && melhor < 1) {
    return { ok: false, motivo: 'faltam tokens: ' + faltando.join(', ') };
  }

  return { ok: true, motivo: 'ok', cobertura: melhor, alvo: melhorAlvo };
}

module.exports = { validar: validar, normalizar: normalizar, tokens: tokens, nomeBase: nomeBase };