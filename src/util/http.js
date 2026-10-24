'use strict';

const axios = require('axios');
const iconv = require('iconv-lite');
const config = require('../config');
const { criar } = require('./logger');

const log = criar('http');

const UAS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

const cliente = axios.create({
    timeout: config.HTTP_TIMEOUT,
    maxRedirects: 8,
    responseType: 'arraybuffer',
    decompress: true,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        Connection: 'keep-alive'
    }
});

function dormir(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function uaAleatoria() {
    return UAS[Math.floor(Math.random() * UAS.length)];
}

function decodificar(buffer, contentType, forcar) {
    let charset = forcar || 'utf-8';
    const m = /charset=["']?([\w-]+)/i.exec(String(contentType || ''));
    if (m) charset = m[1].toLowerCase();
    if (['iso-8859-1', 'latin1', 'ascii', 'us-ascii'].includes(charset)) charset = 'windows-1252';
    if (!iconv.encodingExists(charset)) charset = 'utf-8';
    try {
        return iconv.decode(Buffer.from(buffer), charset);
    } catch (_) {
        return Buffer.from(buffer).toString('utf8');
    }
}

async function requisitar(url, opcoes) {
    const opt = opcoes || {};
    const max = Number.isFinite(opt.tentativas) ? opt.tentativas : config.HTTP_RETRIES;
    let ultimoErro = null;

    for (let tentativa = 0; tentativa <= max; tentativa++) {
        try {
            const resposta = await cliente.get(url, {
                timeout: opt.timeout || config.HTTP_TIMEOUT,
                headers: Object.assign(
                    {
                        'User-Agent': opt.userAgent || uaAleatoria()
                    },
                    opt.referer ? { Referer: opt.referer, Origin: origemDe(opt.referer) } : {},
                    opt.headers || {}
                )
            });
            return {
                url: url,
                status: resposta.status,
                headers: resposta.headers,
                buffer: Buffer.from(resposta.data),
                texto: decodificar(resposta.data, resposta.headers['content-type'], opt.encoding)
            };
        } catch (erro) {
            ultimoErro = erro;
            const status = erro.response && erro.response.status;
            if (status === 404) break;
            await dormir(220 * (tentativa + 1) + Math.floor(Math.random() * 200));
        }
    }

    throw new Error('HTTP falhou em ' + url + ' :: ' + (ultimoErro ? ultimoErro.message : 'desconhecido'));
}

function origemDe(url) {
    try {
        return new URL(url).origin;
    } catch (_) {
        return undefined;
    }
}

async function html(url, opcoes) {
    const r = await requisitar(url, opcoes);
    return r.texto;
}

async function json(url, opcoes) {
    const r = await requisitar(url, opcoes);
    return JSON.parse(r.texto);
}

async function binario(url, opcoes) {
    return requisitar(url, opcoes);
}

async function ping(url, opcoes) {
    const inicio = Date.now();
    try {
        const r = await requisitar(url, Object.assign({ tentativas: 0, timeout: 9000 }, opcoes || {}));
        return { ok: true, status: r.status, ms: Date.now() - inicio, bytes: r.buffer.length };
    } catch (erro) {
        return { ok: false, erro: erro.message, ms: Date.now() - inicio };
    }
}

module.exports = { requisitar, html, json, binario, ping, dormir, uaAleatoria, decodificar };