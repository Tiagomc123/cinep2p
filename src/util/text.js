'use strict';

const RE_ACENTOS = /[\u0300-\u036f]/g;

const QUALIDADES = [
    { re: /(2160p|4k|uhd)/i, rotulo: '2160p', peso: 22 },
    { re: /(1440p|2k)/i, rotulo: '1440p', peso: 16 },
    { re: /(1080p|fullhd|full hd)/i, rotulo: '1080p', peso: 15 },
    { re: /(720p|hd rip|hdrip)/i, rotulo: '720p', peso: 11 },
    { re: /(480p|dvdrip|dvd rip|sd\b)/i, rotulo: '480p', peso: 5 }
];

const RE_IDIOMA = {
    dublado: /\b(dublado|dublada|dublados|dubladas|dub)\b/,
    dual: /\b(dual|dual audio|dualaudio|dual-audio|dual audio pt br)\b/,
    legendado: /\b(legendado|legendada|legendados|leg|subbed|subtitulado|sub)\b/,
    ptbr: /\b(pt br|ptbr|pt-br|portugues|portugues br|brasil|nacional)\b/
};

const RE_CATEGORIA = {
    animes: /\b(anime|animes|ova|oad|fansub|fansubs|manga|naruto|bleach|one piece|onepiece|dragon ball|jujutsu|kimetsu|demon slayer|shingeki|attack on titan|my hero academia|boku no hero|hunter x hunter|fullmetal|death note|tokyo ghoul|sword art online|sao|chainsaw man|spy x family|jujutsu kaisen)\b/,
    doramas: /\b(dorama|doramas|kdrama|k drama|cdrama|jdrama|drama coreano|coreano|coreana|coreanos|chines|chinesa|japones|japonesa|tailandes|asiatico|asiaticos|asiatica)\b/,
    novelas: /\b(novela|novelas|telenovela|novelinha|novelas mexicanas|novela turca|novelas turcas|carrossel|chiquititas|mexicana|turca)\b/,
    series: /\b(serie|series|temporada|temporadas|season|completa|completo|s\d{1,2}\s?e\d{1,3})\b/,
    curtas: /\b(curta|curtas|short|shorts|curta metragem|animacao|animação)\b/,
    documentarios: /\b(documentario|documentarios|documentary|documental|bbc|discovery|natgeo|national geographic|natureza)\b/
};

function stripAcentos(texto) {
    return String(texto == null ? '' : texto).normalize('NFD').replace(RE_ACENTOS, '');
}

function normalizar(texto) {
    return stripAcentos(texto)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokens(texto) {
    return normalizar(texto).split(' ').filter((t) => t.length > 1);
}

function absolutizar(url, base) {
    if (!url) return null;
    const u = String(url).trim();
    if (/^(https?:|magnet:|data:|\/\/)/i.test(u)) {
        if (u.startsWith('//')) return 'https:' + u;
        return u;
    }
    try {
        return new URL(u, base).href;
    } catch (_) {
        return u;
    }
}

function parseBytes(texto) {
    const m = /([\d]+(?:[.,]\d+)?)\s*(tb|tib|gb|gib|mb|mib|kb|kib|b)\b/i.exec(String(texto || ''));
    if (!m) return 0;
    const valor = parseFloat(m[1].replace(',', '.'));
    const unidade = m[2].toLowerCase();
    const fatores = {
        b: 1,
        kb: 1024,
        kib: 1024,
        mb: 1024 ** 2,
        mib: 1024 ** 2,
        gb: 1024 ** 3,
        gib: 1024 ** 3,
        tb: 1024 ** 4,
        tib: 1024 ** 4
    };
    return Math.round(valor * (fatores[unidade] || 1));
}

function formatarBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return '--';
    const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let valor = n;
    while (valor >= 1024 && i < unidades.length - 1) {
        valor /= 1024;
        i++;
    }
    return valor.toFixed(valor >= 10 || i === 0 ? 0 : 1) + ' ' + unidades[i];
}

function detectarQualidade(texto) {
    const t = String(texto || '');
    for (const q of QUALIDADES) {
        if (q.re.test(t)) return { rotulo: q.rotulo, peso: q.peso };
    }
    return { rotulo: 'SD', peso: 3 };
}

function detectarIdioma(texto) {
    const t = ' ' + normalizar(texto) + ' ';

    const dublado = RE_IDIOMA.dublado.test(t);
    const dual = RE_IDIOMA.dual.test(t);
    const legendado = RE_IDIOMA.legendado.test(t);
    const nacional = RE_IDIOMA.ptbr.test(t);

    let pontos = 0;
    if (dublado) pontos += 62;
    if (dual) pontos += 50;
    if (nacional) pontos += 14;
    if (legendado) pontos += 26;

    const ptbr = dublado || dual || legendado || nacional;
    if (!ptbr) pontos -= 22;

    return {
        ptbr,
        dublado,
        dual,
        legendado,
        nacional,
        rotulo: dublado ? 'Dublado' : dual ? 'Dual Áudio' : legendado ? 'Legendado' : nacional ? 'Nacional' : 'Original',
        pontos
    };
}

function detectarCategoria(texto, padrao) {
    const t = ' ' + normalizar(texto) + ' ';

    if (/\bs\d{1,2}\s?e\d{1,3}\b/.test(t) || /\b(temporada|temporadas|season)\b/.test(t)) {
        if (RE_CATEGORIA.animes.test(t)) return 'animes';
        if (RE_CATEGORIA.doramas.test(t)) return 'doramas';
        if (RE_CATEGORIA.novelas.test(t)) return 'novelas';
        return 'series';
    }

    const ordem = ['animes', 'doramas', 'novelas', 'documentarios', 'curtas'];
    for (const c of ordem) {
        if (RE_CATEGORIA[c].test(t)) return c;
    }
    if (RE_CATEGORIA.series.test(t)) return 'series';
    return padrao || 'filmes';
}

function limparTitulo(titulo) {
    let t = String(titulo || '');
    t = t.replace(/\s*[|»\-–]\s*(comando\s*torrents?|torrent\s*dos\s*filmes?|bludv|bj-?share|animestorrent|rede\s*torrent|yts(\.\w+)?|the\s*pirate\s*bay|apibay|torrents?)\s*$/i, '');
    t = t.replace(/\[[^\]]{0,40}\]/g, ' ');
    t = t.replace(/\((?:19|20)\d{2}\)/g, (m) => m);
    t = t.replace(/\s{2,}/g, ' ').trim();
    return t;
}

function chaveDedupe(texto) {
    return normalizar(texto)
        .replace(/\b(2160p|1440p|1080p|720p|480p|4k|uhd|fullhd|bluray|blu ray|bdrip|brrip|webrip|web dl|webdl|hdtv|dvdrip|remux|hevc|x265|x264|h264|aac|ac3|dts|dd5 1|dublado|dual audio|dual|legendado|legendada|nacional|torrent|mkv|mp4|avi|completo|completa)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(texto) {
    return normalizar(texto).replace(/\s+/g, '-').slice(0, 120);
}

function truncar(texto, limite) {
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    return t.length > limite ? t.slice(0, limite - 1) + '…' : t;
}

function decodificarEntidades(texto) {
    return String(texto || '')
        .replace(/&amp;/gi, '&')
        .replace(/&#0?38;/g, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&nbsp;/gi, ' ');
}

module.exports = {
    stripAcentos,
    normalizar,
    tokens,
    absolutizar,
    parseBytes,
    formatarBytes,
    detectarQualidade,
    detectarIdioma,
    detectarCategoria,
    limparTitulo,
    chaveDedupe,
    slug,
    truncar,
    decodificarEntidades
};