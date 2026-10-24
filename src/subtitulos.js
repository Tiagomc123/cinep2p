'use strict';

/**
 * Suporte a legendas: detecta arquivos de legenda dentro do proprio torrent
 * e converte para WebVTT (unico formato que o <track> do navegador entende).
 */

const EXT = /\.(srt|ass|ssa|vtt|sub|sbv)$/i;

function ehLegenda(nome) { return EXT.test(String(nome || '')); }

function extensao(nome) {
  const m = /\.([a-z0-9]+)$/i.exec(String(nome || ''));
  return m ? m[1].toLowerCase() : 'srt';
}

function idiomaDe(nome) {
  const n = String(nome || '').toLowerCase();
  if (/pt[\s._-]?br|ptbr|portugu|brasil|\bpt\b|\bpor\b|\bbr\b/.test(n)) return { code: 'pt-BR', label: 'Portugues (BR)' };
  if (/english|\beng\b|\ben\b|ingles/.test(n)) return { code: 'en', label: 'Ingles' };
  if (/spanish|espa|castellano|latino|\bes\b/.test(n)) return { code: 'es', label: 'Espanhol' };
  if (/french|franc|\bfr\b/.test(n)) return { code: 'fr', label: 'Frances' };
  return { code: 'pt-BR', label: 'Legenda' };
}

/** Decodifica respeitando arquivos antigos em Windows-1252 (comum no BR). */
function decodificar(buffer) {
  const utf8 = buffer.toString('utf8');
  if (utf8.indexOf('\uFFFD') === -1) return utf8;
  return buffer.toString('latin1');
}

function srtParaVtt(texto) {
  const corpo = String(texto)
    .replace(/^\uFEFF/, '')
    .replace(/\r+/g, '')
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2')
    .replace(/^WEBVTT\s*/i, '');
  return 'WEBVTT\n\n' + corpo.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function tempoAss(valor) {
  const m = /(\d+):(\d{2}):(\d{2})[.,](\d{1,2})/.exec(String(valor || '').trim());
  if (!m) return null;
  const cs = m[4].padEnd(3, '0').slice(0, 3);
  return m[1].padStart(2, '0') + ':' + m[2] + ':' + m[3] + '.' + cs;
}

function assParaVtt(texto) {
  const saida = ['WEBVTT', ''];
  let n = 0;
  String(texto).replace(/\r/g, '').split('\n').forEach(function (linha) {
    if (linha.indexOf('Dialogue:') !== 0) return;
    const partes = linha.slice('Dialogue:'.length).split(',');
    if (partes.length < 10) return;
    const ini = tempoAss(partes[1]);
    const fim = tempoAss(partes[2]);
    const txt = partes.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N|\\n/g, '\n').trim();
    if (!ini || !fim || !txt) return;
    n++;
    saida.push(String(n), ini + ' --> ' + fim, txt, '');
  });
  return saida.join('\n');
}

function converter(texto, ext) {
  const e = String(ext || 'srt').toLowerCase();
  if (e === 'vtt') return /^WEBVTT/i.test(texto) ? texto : 'WEBVTT\n\n' + texto;
  if (e === 'ass' || e === 'ssa') return assParaVtt(texto);
  return srtParaVtt(texto);
}

module.exports = { ehLegenda: ehLegenda, extensao: extensao, idiomaDe: idiomaDe, decodificar: decodificar, converter: converter };