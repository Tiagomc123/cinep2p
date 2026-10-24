'use strict';

const { normalizar } = require('./text');

function tituloComparavel(value) {
    return normalizar(value)
        .replace(/\b(19|20)\d{2}\b/g, ' ')
        .replace(/\b(2160p|1440p|1080p|720p|480p|4k|uhd|bluray|bdrip|brrip|webrip|webdl|hdtv|dvdrip|remux|hevc|x265|x264|h264|aac|ac3|dts|dublado|dublada|dublados|dubladas|dual|audio|legendado|legendada|nacional|torrent|mkv|mp4|avi)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function encontrarPoster(titulo, ano, itens) {
    const procurado = tituloComparavel(titulo);
    if (!procurado) return '';

    const anoProcurado = String(ano || '').match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
    const tokensProcurados = new Set(procurado.split(' ').filter(token => token.length > 1));
    let melhor = null;

    for (const item of itens || []) {
        if (!item || !item.poster) continue;

        const candidato = tituloComparavel(item.tituloBruto || item.titulo || '');
        if (!candidato) continue;

        const anoCandidato = String(item.ano || '').match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
        if (anoProcurado && anoCandidato && anoProcurado !== anoCandidato) continue;

        const tokensCandidato = new Set(candidato.split(' ').filter(token => token.length > 1));
        let comuns = 0;
        for (const token of tokensProcurados) if (tokensCandidato.has(token)) comuns++;
        const similaridade = comuns / Math.max(tokensProcurados.size, tokensCandidato.size);
        const exato = procurado === candidato;
        const pontuacao = (exato ? 1 : similaridade) + (anoProcurado && anoProcurado === anoCandidato ? 0.1 : 0);

        if (!melhor || pontuacao > melhor.pontuacao) melhor = { poster: item.poster, pontuacao };
    }

    return melhor && melhor.pontuacao >= 0.6 ? melhor.poster : '';
}

module.exports = { encontrarPoster };
