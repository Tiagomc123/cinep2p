'use strict';

const ALFABETO_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const TRACKERS_PADRAO = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.tracker.cl:1337/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.openbittorrent.com:6969/announce',
    'udp://exodus.desync.com:6969/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://tracker.dler.org:6969/announce',
    'udp://9.rarbg.com:2710/announce',
    'udp://opentracker.io:6969/announce',
    'http://tracker.openbittorrent.com:80/announce',
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz'
];

function base32ParaHex(base32) {
    let bits = '';
    const texto = String(base32 || '').toUpperCase();
    for (let i = 0; i < texto.length; i++) {
        const valor = ALFABETO_B32.indexOf(texto[i]);
        if (valor < 0) continue;
        bits += valor.toString(2).padStart(5, '0');
    }
    let hex = '';
    for (let i = 0; i + 8 <= bits.length && hex.length < 40; i += 8) {
        hex += parseInt(bits.slice(i, i + 8), 2).toString(16).padStart(2, '0');
    }
    return hex.slice(0, 40);
}

function infoHashDe(entrada) {
    if (!entrada) return null;
    const s = String(entrada).trim();

    let m = /urn:btih:([0-9a-fA-F]{40})/.exec(s);
    if (m) return m[1].toLowerCase();

    m = /urn:btih:([a-zA-Z2-7]{32})/.exec(s);
    if (m) return base32ParaHex(m[1]);

    m = /\b([0-9a-fA-F]{40})\b/.exec(s);
    if (m) return m[1].toLowerCase();

    m = /^([a-zA-Z2-7]{32})$/.exec(s);
    if (m) return base32ParaHex(m[1]);

    return null;
}

function montarMagnet(infoHash, nome, trackers) {
    const hash = String(infoHash || '').toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(hash)) return null;
    const params = ['xt=urn:btih:' + hash];
    if (nome) params.push('dn=' + encodeURIComponent(nome));
    const trs = Array.isArray(trackers) && trackers.length ? trackers : TRACKERS_PADRAO;
    for (const tr of trs) params.push('tr=' + encodeURIComponent(tr));
    return 'magnet:?' + params.join('&');
}

function normalizarMagnet(magnet, nome) {
    const hash = infoHashDe(magnet);
    if (!hash) return null;
    if (String(magnet).startsWith('magnet:') && /tr=/.test(magnet)) return magnet;
    return montarMagnet(hash, nome);
}

function validarInfoHash(hash) {
    return typeof hash === 'string' && /^[0-9a-f]{40}$/.test(hash.toLowerCase());
}

module.exports = {
    TRACKERS_PADRAO,
    base32ParaHex,
    infoHashDe,
    montarMagnet,
    normalizarMagnet,
    validarInfoHash
};