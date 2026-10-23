// Detecta idiomas explicitamente indicados no nome do release.
const NAMES = {
  por: 'Português', pob: 'Português (BR)', pt: 'Português',
  ptbr: 'Português (BR)', eng: 'Inglês', en: 'Inglês',
  spa: 'Espanhol', es: 'Espanhol', lat: 'Latino',
  ita: 'Italiano', it: 'Italiano', fra: 'Francês', fre: 'Francês',
  fr: 'Francês', deu: 'Alemão', ger: 'Alemão', de: 'Alemão',
  jpn: 'Japonês', jp: 'Japonês', kor: 'Coreano', rus: 'Russo',
  zho: 'Chinês', chi: 'Chinês', zh: 'Chinês',
  mul: 'Multi-idioma', und: 'Original'
}

export const langName = c =>
  NAMES[String(c || '').toLowerCase()] ||
  String(c || '').toUpperCase() || 'Desconhecido'

const PT = /dublado|dublada|dublagem|nacional|brasileir[oa]|brazilian|\bptbr\b|\bpt[-_. ]?br\b|\bpob\b|\bbrdub\b|\bbr[-_. ]?dub\b|portugu[eê]s|\bpor\b/i
const DUAL = /dual[ ._-]?audio|dual[ ._-]?áudio|\bdual\b|multi[ ._-]?audio|multi[ ._-]?áudio/i
const LEG = /legendad[oa]s?|legendas?|subbed|subtitled|\bsubs?\b/i

const LANGS = [
  [/\b(ita|italian)\b/i, 'ita'],
  [/\b(spa|español|espanol|castellano|latino|spanish)\b/i, 'spa'],
  [/\b(fra|french|truefrench|vff|vfq)\b/i, 'fra'],
  [/\b(german|deutsch|ger)\b/i, 'deu'],
  [/\b(japanese|jap|jpn)\b/i, 'jpn'],
  [/\b(korean|kor)\b/i, 'kor'],
  [/\b(russian|rus)\b/i, 'rus'],
  [/\b(hindi|hin)\b/i, 'hin'],
  [/\b(chinese|mandarin|cantonese|chi|zho)\b/i, 'zho'],
  [/\b(english|eng)\b/i, 'eng'],
  [/\b(pt[-_. ]?br|portugu[eê]s|portugues|dublado|dublada|nacional|\bpob\b)\b/i, 'ptbr']
]

export function isPortuguese(name) {
  return PT.test(String(name || ''))
}

export function detectAudio(name) {
  const s = String(name || '')
  const langs = []
  if (isPortuguese(s)) langs.push('ptbr')
  for (const [re, code] of LANGS) {
    if (re.test(s)) langs.push(code)
  }
  return {
    dub: isPortuguese(s),
    dual: DUAL.test(s),
    subs: LEG.test(s),
    langs: [...new Set(langs)]
  }
}

export function matchesLang(item, lang) {
  const wanted = String(lang || '').trim().toLowerCase()
  if (!wanted || wanted === 'all' || wanted === 'world') return true

  const title = typeof item === 'string'
    ? item
    : String(item?.title || item?.name || '')
  const meta = item && typeof item === 'object' ? item : {}
  const audio = detectAudio(title)
  const languages = Array.isArray(meta.langs) ? meta.langs : audio.langs
  const dub = Boolean(meta.dub) || isPortuguese(title)
  const dual = Boolean(meta.dual) || DUAL.test(title)
  const subs = Boolean(meta.subs) || LEG.test(title)

  if (['dub', 'dublado', 'dublada'].includes(wanted)) return dub
  if (['dual', 'dual-audio', 'dualaudio'].includes(wanted)) return dual
  if (['subs', 'sub', 'legendado'].includes(wanted)) return subs

  // Áudio em português exige indicação explícita; dual/legendas não bastam.
  if (['ptbr', 'pt-br', 'pt', 'por', 'pob', 'portuguese', 'portugues'].includes(wanted)) {
    return dub || languages.includes('ptbr')
  }

  return languages.includes(wanted)
}
