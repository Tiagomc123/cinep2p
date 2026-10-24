'use strict';

const HOSTS_IMAGEM_AUTORIZADOS = new Set(['image.tmdb.org', 'upload.wikimedia.org']);

function posterUrlPermitida(value) {
    try {
        const url = new URL(String(value || ''));
        return url.protocol === 'https:'
            && !url.username
            && !url.password
            && !url.port
            && HOSTS_IMAGEM_AUTORIZADOS.has(url.hostname.toLowerCase());
    } catch (_) {
        return false;
    }
}

module.exports = { posterUrlPermitida };
