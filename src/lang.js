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

const PT = /(dublado|dublada|pt[-_ .]?br|ptbr|portugu[eê]s|portugues|nacional|brazilian|br[-_ ]?dub)/i
const DUAL = /(dual[ ._-]?[aá]udio|dual)/i
const LEG = /(legendado|legendad[ao]|subbed)/i

const LANGS = [
  [/\b(ita|italian)\b/i, 'ita'], [/\b(spa|espa[ñn]ol|castellano|latino|spanish)\b/i, 'spa'],
  [/\b(fra|french|truefrench|vff|vfq)\b/i, 'fra'], [/\b(german|deutsch|ger)\b/i, 'deu'],
  [/\b(japanese|jap|jpn)\b/i, 'jpn'], [/\b(korean|kor)\b/i, 'kor'], [/\b(russian|rus)\b/i, 'rus'],
  [/\b(hindi|hin)\b/i, 'hin'], [/\b(chinese|mandarin|cantonese|chi|zho)\b/i, 'zho'],
  [/\b(english|eng)\b/i, 'eng'], [/\b(pt[-_ .]?br|portugu[eê]s|portugues|dublado)\b/i, 'ptbr']
]

export function detectAudio(name) {
  const s = String(name || '')
  const langs = []
  const dub = PT.test(s)
  const dual = DUAL.test(s)
  if (dub) langs.push('ptbr')
  // "Dual" e "Multi" indicam varias faixas, nao quais idiomas elas contem.
  for (const [re, code] of LANGS) if (re.test(s)) langs.push(code)
  return { dub, dual, subs: LEG.test(s), langs: [...new Set(langs)] }
}
