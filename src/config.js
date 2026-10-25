'use strict';

const path = require('path');
const fs = require('fs');

function carregarEnvLocal() {
    const arquivo = path.resolve(__dirname, '..', '.env');
    if (!fs.existsSync(arquivo)) return;
    for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
        const correspondencia = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linha);
        if (!correspondencia || Object.prototype.hasOwnProperty.call(process.env, correspondencia[1])) continue;
        let valor = correspondencia[2];
        if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
            valor = valor.slice(1, -1);
        } else {
            valor = valor.replace(/\s+#.*$/, '').trim();
        }
        process.env[correspondencia[1]] = valor;
    }
}

carregarEnvLocal();

const RAIZ = path.resolve(__dirname, '..');
const CACHE_DIR = process.env.CINE_CACHE_DIR || path.join(RAIZ, '.cache');

function numero(valor, padrao) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : padrao;
}

function booleano(valor, padrao) {
    if (valor === undefined || valor === null || valor === '') return padrao;
    return /^(1|true|sim|on|yes)$/i.test(String(valor));
}

function lista(valor) {
    if (!valor) return [];
    return String(valor).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

const config = {
    RAIZ,
    CACHE_DIR,
    TORRENT_DIR: process.env.CINE_TORRENT_DIR || path.join(CACHE_DIR, 'torrents'),
    CATALOGO_ARQ: process.env.CINE_CATALOGO_ARQ || path.join(CACHE_DIR, 'catalogo.json'),

    PORT: numero(process.env.PORT, 3000),
    HOST: process.env.HOST || '0.0.0.0',

    MAX_TORRENTS_ATIVOS: numero(process.env.CINE_MAX_TORRENTS, 3),
    TORRENT_IDLE_MIN: numero(process.env.CINE_IDLE_MIN, 12),
    MAX_CACHE_GB: numero(process.env.CINE_MAX_CACHE_GB, 25),

    HTTP_TIMEOUT: numero(process.env.CINE_HTTP_TIMEOUT, 15000),
    HTTP_RETRIES: numero(process.env.CINE_HTTP_RETRIES, 2),
    FONTES_CONCORRENCIA: numero(process.env.CINE_FONTES_CONCORRENCIA, 8),
    WORKER_CONCORRENCIA: Math.max(1, Math.floor(numero(process.env.CINE_WORKER_CONCORRENCIA, 2))),

    APENAS_PTBR: booleano(process.env.CINE_APENAS_PTBR, true),
    FONTES_OFF: lista(process.env.CINE_FONTES_OFF),
    TMDB_API_KEY: process.env.TMDB_API_KEY || '',

    FFMPEG_PATH: process.env.FFMPEG_PATH || null,
    FFPROBE_PATH: process.env.FFPROBE_PATH || null,

    TTL_BUSCA_MS: numero(process.env.CINE_TTL_BUSCA_MS, 10 * 60 * 1000),
    TTL_STATUS_MS: numero(process.env.CINE_TTL_STATUS_MS, 60 * 1000)
};

fs.mkdirSync(config.CACHE_DIR, { recursive: true });
fs.mkdirSync(config.TORRENT_DIR, { recursive: true });

module.exports = config;
