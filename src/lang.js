// Deteccao de idioma em nomes de release + nomes de codigos ISO.

const NAMES = {
  por: 'Portugues', pob: 'Portugues (BR)', pt: 'Portugues', ptbr: 'Portugues (BR)',
  eng: 'Ingles', en: 'Ingles', spa: 'Espanhol', es: 'Espanhol', lat: 'Latino',
  ita: 'Italiano', it: 'Italiano', fra: 'Frances', fre: 'Frances', fr: 'Frances',
  deu: 'Alemao', ger: 'Alemao', de: 'Alemao', jpn: 'Japones', jp: 'Japones',
  kor: 'Coreano', rus: 'Russo', zho: 'Chines', chi: 'Chines', zh: 'Chines',
  ara: 'Arabe', hin: 'Hindi', nld: 'Holandes', dut: 'Holandes', nl: 'Holandes',
  pol: 'Polones', tur: 'Turco', swe: 'Sueco', ces: 'Tcheco', cze: 'Tcheco',
  hun: 'Hungaro', heb: 'Hebraico', ell: 'Grego', gre: 'Grego', dan: 'Dinamarques',
  nor: 'Noruegues', fin: 'Finlandes', ukr: 'Ucraniano', ron: 'Romeno', rum: 'Romeno',
  ind: 'Indonesio', tha: 'Tailandes', vie: 'Vietnamita', cat: 'Catalao', fas: 'Persa',
  mul: 'Multi-idioma', und: 'Original'
}
export const langName = c => NAMES[String(c || '').toLowerCase()] || String(c || '').toUpperCase() || 'Desconhecido'

const PT = /(dublado|dublada|dublagem|nacional|brasileir[oa]|brazilian|\\bptbr\\b|\\bpt[-_. ]?br\\b|\\bpob\\b|\\bbrdub\\b|\\bbr[-_. ]?dub\\b|portugu[eê]s|\\bpor\\b)/i
const DUAL = /(dual[ ._-]?[aá]udio|dual)/i
const LEG = /(legendado|legendad[ao]|subbed)/i

const LANGS = [
  [/\b(ita|italian)\b/i, 'ita'], [/\b(spa|espa[ñn]ol|castellano|latino|spanish)\b/i, 'spa'],
  [/\b(fra|french|truefrench|vff|vfq)\b/i, 'fra'], [/\b(german|deutsch|ger)\b/i, 'deu'],
  [/\b(japanese|jap|jpn)\b/i, 'jpn'], [/\b(korean|kor)\b/i, 'kor'], [/\b(russian|rus)\b/i, 'rus'],
  [/\b(hindi|hin)\b/i, 'hin'], [/\b(chinese|mandarin|cantonese|chi|zho)\b/i, 'zho'],
  [/\b(english|eng)\b/i, 'eng'], [/\b(pt[-_ .]?br|portugu[eê]s|portugues|dublado)\b/i, 'ptbr']
]

export function isPortuguese(name) { return PT.test(String(name || '')) }

export function matchesLang(item, lang) {
  const s = String(lang || '').trim().toLowerCase()
  if (!s || s === 'all' || s === 'world') return true
  const title = typeof item === 'string' ? item : String(item?.title || item?.name || '')
  const meta = typeof item === 'object' && item ? item : {}
  const audio = detectAudio(title)
  if (['ptbr', 'pt-br', 'pt', 'por', 'pob', 'portuguese', 'portugues'].includes(s)) return isPortuguese(title) || Boolean(meta.dub) || (meta.langs || audio.langs).includes('ptbr')
  if (['dub', 'dublado', 'dublada'].includes(s)) return Boolean(meta.dub || /(dublado|dublada|dublagem|br[-_. ]?dub)/i.test(title))
  if (['dual', 'dual-audio', 'dualaudio'].includes(s)) return Boolean(meta.dual || DUAL.test(title))
  if (['subs', 'sub', 'legendado'].includes(s)) return Boolean(meta.subs || LEG.test(title))
  return (meta.langs || audio.langs).includes(s)
}

export function detectAudio(name) {
  const s = String(name || '')
  const langs = []
  const dub = isPortuguese(s)
  const dual = DUAL.test(s)
  if (dub) langs.push('ptbr')
  // "Dual" e "Multi" indicam varias faixas, nao quais idiomas elas contem.
  for (const [re, code] of LANGS) if (re.test(s)) langs.push(code)
  return { dub, dual, subs: LEG.test(s), langs: [...new Set(langs)] }
}
