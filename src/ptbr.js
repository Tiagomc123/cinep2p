'use strict';

/**
 * Classificador de audio brasileiro - REGRA DE OURO DUAL 5.1.
 *
 * Lancamentos BR em indexadores globais nao escrevem "Dublado": escrevem
 * DUAL (ou MULTI) junto de 5.1, o que significa container com faixa original
 * + faixa PT-BR embutida. Ex: Moana.2026.1080p.WEB-DL.x264.DUAL.5.1
 *
 * Pontuacao aditiva, com penalidade pesada para dublagem alheia:
 *   PT/PTBR/NACIONAL .... +3000     lista [RUS + POR] .... +1400
 *   DUAL / MULTI ........ +1500     5.1 / 7.1 ............ +700
 *   DUAL + 5.1 (combo) .. +1000     fonte multi (agreg.) . +400
 *   DUBLADO ............. +1200     LEGENDADO ............ +260
 *   idioma estrangeiro sem PT .... -1300
 *   dublagem estrangeira adjacente -1500
 *
 * Niveis: duals51 > confirmado > provavel > incerto > fraco > estrangeiro
 */

const fontes = require('./fontes');

const RE_PT = [
  /\bpt[\s._-]?br\b/i, /\bptbr\b/i, /\[\s?br\s?\]/i, /\(\s?br\s?\)/i,
  /\bbrasileir[ao]\b/i, /\bnacional\b/i, /\bportugu[eê]s\b/i,
  /\bpor\b/i, /\bpt\b/i, /\bbr\b/i
];

const RE_LISTA_COM_PT = /(\+|e)\s*(por|pt)\b|\b(por|pt)\s*\+|\[\s*(por|pt)\s*\]/i;

const RE_DUAL = /\bdual\b|\bmulti\b|\bmulti[\s._-]?audio\b/i;
const RE_51 = /\b5[\s._-]?1\b|\b7[\s._-]?1\b|\bdts[\s._-]?hd\b|\bdts[\s._-]?x\b/i;
const RE_DUB = /\bdublad|\bdublagem\b|\bdub\b/i;
const RE_LEG = /\blegendad|subtitulad|\bsub\b|\bleg\b/i;

const ESTRANGEIROS = [
  { nome: 'russo',    re: /\bruss?[oa]?\b|\brus\b|\brussian\b|русск/i },
  { nome: 'espanhol', re: /\bespanhol\b|\bespa[nñ]ol\b|\bcastellano\b|\blatino\b|\besp\b|\bspa\b/i },
  { nome: 'ingles',   re: /\bingl[eê]s\b|\benglish\b|\beng\b/i },
  { nome: 'frances',  re: /\bfranc[eê]s\b|\bfrench\b|\btruefrench\b|\bvff?\b|\bvostfr\b/i },
  { nome: 'alemao',   re: /\balem[aã]o\b|\bgerman\b|\bdeutsch\b/i },
  { nome: 'italiano', re: /\bitalian[oa]\b|\bita\b/i },
  { nome: 'hindi',    re: /\bhindi\b|\btamil\b|\btelugu\b/i },
  { nome: 'asiatico', re: /\bjapon[eê]s\b|\bjap\b|\bchin[eê]s\b|\bchinese\b|\bkorean\b|\bkor\b/i }
];

const RE_ADJ_ESTRANGEIRO = /(dublad\w*|dual\w*|multi\w*|\b5[\s._-]?1\b)\W{0,3}(rus\w*|esp\w*|castellano|latino|ingl\w*|english|\beng\b|franc\w*|french|vff?|alem\w*|german|deutsch|ital\w*|hindi|jap\w*|chin\w*|kor\w*)/i;

const LIMITES = [
  { nivel: 'duals51',    min: 5500 },
  { nivel: 'confirmado', min: 3800 },
  { nivel: 'provavel',   min: 2000 },
  { nivel: 'incerto',    min: 700 },
  { nivel: 'fraco',      min: 150 }
];

function normalizar(txt) {
  return ' ' + String(txt || '').replace(/[._]/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim() + ' ';
}

function rotulo(nivel, s) {
  if (s.dual && s.cincoUm) return nivel === 'duals51' ? 'DUAL 5.1 PT-BR' : (nivel === 'estrangeiro' ? 'DUAL 5.1 (outro idioma)' : 'DUAL 5.1');
  if (s.dual) return nivel === 'estrangeiro' ? 'DUAL (outro idioma)' : 'DUAL Audio';
  if (s.dub) return nivel === 'estrangeiro' ? 'Dublado (outro idioma)' : 'Dublado';
  if (s.leg) return 'Legendado';
  return 'Original';
}

function avaliar(titulo, fonte) {
  const t = normalizar(titulo);
  const meta = fontes.info(fonte);

  const s = {
    pt: RE_PT.some(function (r) { return r.test(t); }),
    listaComPt: RE_LISTA_COM_PT.test(t),
    dual: RE_DUAL.test(t),
    cincoUm: RE_51.test(t),
    dub: RE_DUB.test(t),
    leg: RE_LEG.test(t)
  };

  const riscos = [];
  ESTRANGEIROS.forEach(function (e) { if (e.re.test(t)) riscos.push(e.nome); });
  const adj = RE_ADJ_ESTRANGEIRO.test(t);
  const prova = s.pt || s.listaComPt;

  let pontos = 0;
  const motivos = [];

  if (s.pt) { pontos += 3000; motivos.push('marcador PT/BR'); }
  if (s.listaComPt) { pontos += 1400; motivos.push('lista de idiomas inclui POR/PT'); }
  if (s.dual) { pontos += 1500; motivos.push('tag DUAL/MULTI'); }
  if (s.cincoUm) { pontos += 700; motivos.push('faixa 5.1/7.1'); }
  if (s.dual && s.cincoUm) { pontos += 1000; motivos.push('combo DUAL + 5.1'); }
  if (meta.multi && s.dual) { pontos += 400; motivos.push('agregador multilingue'); }
  if (meta.nacional && (s.dub || s.dual)) { pontos += 1900; motivos.push('fonte nacional'); }
  if (s.dub) { pontos += 1200; motivos.push('DUBLADO'); }
  if (s.leg && !s.dual && !s.dub) { pontos += 260; }

  if (riscos.length && !prova) { pontos -= 1300; motivos.push('idiomas estrangeiros: ' + riscos.join('/')); }
  if (adj && !prova) { pontos -= 1500; motivos.push('dublagem estrangeira adjacente'); }

  let nivel = 'estrangeiro';
  for (const l of LIMITES) { if (pontos >= l.min) { nivel = l.nivel; break; } }
  if (pontos < 0) pontos = 0;

  return {
    nivel: nivel,
    pontos: pontos,
    audio: rotulo(nivel, s),
    motivos: motivos,
    riscos: riscos,
    temDual51: s.dual && s.cincoUm,
    temPt: prova,
    fonteNacional: meta.nacional,
    elegivel: (nivel === 'duals51' || nivel === 'confirmado' || nivel === 'provavel')
  };
}

module.exports = { avaliar: avaliar, LIMITES: LIMITES };