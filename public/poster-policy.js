'use strict';

(function (root) {
    function posterAutorizado(item) {
        if (!item || !item.poster || !item.provider) return false;
        let imagem;
        try { imagem = new URL(item.poster); } catch (_) { return false; }
        if (imagem.protocol !== 'https:' || imagem.username || imagem.password || imagem.port) return false;

        if (item.provider === 'TMDB') {
            return imagem.hostname === 'image.tmdb.org' && imagem.pathname.startsWith('/t/p/');
        }

        if (item.provider !== 'Wikimedia Commons' || imagem.hostname !== 'upload.wikimedia.org') return false;
        const credito = item.attribution || {};
        const license = String(credito.license || '').trim();
        const autor = String(credito.author || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        let pagina;
        try { pagina = new URL(credito.url); } catch (_) { return false; }
        if (pagina.protocol !== 'https:' || pagina.hostname !== 'commons.wikimedia.org') return false;
        if (!/^(?:CC0(?:\s|$)|Public domain(?:\s|$)|PD(?:\s|-|$)|CC BY(?:-SA)?(?:\s|$))/i.test(license)) return false;
        if (/^CC BY(?:-SA)?\b/i.test(license) && (!autor || /^(?:autor nao informado|unknown|anonymous|desconhecido)$/i.test(autor))) return false;
        return true;
    }

    function posterCredito(item) {
        if (!posterAutorizado(item) || item.provider !== 'Wikimedia Commons') return null;
        const credito = item.attribution || {};
        const author = String(credito.author || '').trim();
        const license = String(credito.license || '').trim();
        return {
            label: 'Wikimedia Commons · ' + (author ? author + ' · ' : '') + license,
            title: [author, license].filter(Boolean).join(' · '),
            url: credito.url
        };
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = { posterAutorizado, posterCredito };
    else root.CinePosterPolicy = { posterAutorizado, posterCredito };
})(typeof window !== 'undefined' ? window : globalThis);
