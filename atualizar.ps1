<#
============================================================================
 cinep2p :: atualizar.ps1
 Reestruturacao total do nucleo de scraping/busca para PT-BR
 ---------------------------------------------------------------------------
 Alvos : filmes | series | animes | doramas | novelas | curtas
 Fluxo : catalogo -> busca multi-fonte -> score -> magnet -> WebTorrent
         -> stream sequencial -> remux/transcode FFmpeg -> player browser
 ---------------------------------------------------------------------------
 Uso   : .\atualizar.ps1
         .\atualizar.ps1 -Raiz "C:\projetos\cinep2p" -SemNpm
         .\atualizar.ps1 -Forcar -ManterCRLF

 NOTA  : todo conteudo de arquivo usa Here-String SIMPLES (@' ... '@)
         portanto nada e interpolado pelo PowerShell. Regra de ouro
         mantida: nenhuma linha de codigo JS/CSS pode comecar com '@
============================================================================
#>

[CmdletBinding()]
param(
    [string] $Raiz,
    [switch] $SemBackup,
    [switch] $SemNpm,
    [switch] $Forcar,
    [switch] $ManterCRLF
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# ---------------------------------------------------------------------------
# Resolucao de raiz
# ---------------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($Raiz)) {
    if ($PSScriptRoot) { $Raiz = $PSScriptRoot } else { $Raiz = (Get-Location).Path }
}
if (-not (Test-Path -LiteralPath $Raiz)) {
    throw "Pasta raiz nao encontrada: $Raiz"
}
$Raiz = (Resolve-Path -LiteralPath $Raiz).Path

$script:Marcador = Get-Date -Format 'yyyyMMdd-HHmmss'
$script:PastaBackup = Join-Path $Raiz ('.backup\' + $script:Marcador)
$script:TotalGravado = 0

# ---------------------------------------------------------------------------
# Helpers de console
# ---------------------------------------------------------------------------
function Escrever-Cabecalho {
    param([string] $Texto)
    Write-Host ''
    Write-Host ('-' * 78) -ForegroundColor DarkGray
    Write-Host ('  ' + $Texto) -ForegroundColor Cyan
    Write-Host ('-' * 78) -ForegroundColor DarkGray
}
function Escrever-Ok    { param([string] $m) Write-Host ('   [ok]  ' + $m) -ForegroundColor Green }
function Escrever-Info  { param([string] $m) Write-Host ('   [..]  ' + $m) -ForegroundColor Gray }
function Escrever-Aviso { param([string] $m) Write-Host ('   [!!]  ' + $m) -ForegroundColor Yellow }
function Escrever-Erro  { param([string] $m) Write-Host ('   [xx]  ' + $m) -ForegroundColor Red }

# ---------------------------------------------------------------------------
# Validacao do alvo
# ---------------------------------------------------------------------------
Escrever-Cabecalho 'cinep2p :: ATUALIZADOR DE NUCLEO  (PT-BR / multi-fonte)'

$indicios = @('package.json', 'server.js', 'public', 'src') |
    Where-Object { Test-Path -LiteralPath (Join-Path $Raiz $_) }

if ($indicios.Count -eq 0 -and -not $Forcar) {
    Escrever-Aviso "Nenhum arquivo tipico do cinep2p encontrado em: $Raiz"
    Escrever-Aviso "Rode com -Forcar para gravar assim mesmo."
    $resposta = Read-Host '  Continuar? (s/N)'
    if ($resposta -notmatch '^(s|S|y|Y)') { exit 1 }
}

Escrever-Info "Raiz do projeto : $Raiz"
if (-not $SemBackup) { Escrever-Info "Backup           : $script:PastaBackup" }
Escrever-Info ("Line endings     : " + $(if ($ManterCRLF) { 'CRLF (mantido)' } else { 'LF (normalizado)' }))

# ---------------------------------------------------------------------------
# Mapa de arquivos -> conteudo
# ---------------------------------------------------------------------------
$Arquivos = [ordered]@{}

# ===========================================================================
#  package.json
# ===========================================================================
$Arquivos['package.json'] = @'
{
  "name": "cinep2p",
  "version": "3.0.0",
  "private": true,
  "description": "Streaming P2P de Filmes, Series, Animes, Doramas e Novelas em PT-BR via WebTorrent + FFmpeg",
  "main": "server.js",
  "type": "commonjs",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "worker": "node worker.js",
    "aquecer": "node worker.js --once",
    "fontes": "node scripts/atualizar-fontes.js",
    "cache:limpar": "node scripts/atualizar-fontes.js --limpar-cache"
  },
  "engines": {
    "node": ">=18.17.0"
  },
  "dependencies": {
    "axios": "^1.7.7",
    "cheerio": "^1.0.0",
    "compression": "^1.7.5",
    "cors": "^2.8.5",
    "express": "^4.21.2",
    "ffmpeg-static": "^5.2.0",
    "ffprobe-static": "^3.1.0",
    "iconv-lite": "^0.6.3",
    "morgan": "^1.10.0",
    "webtorrent": "^2.5.1"
  }
}
'@

# ===========================================================================
#  .env.example
# ===========================================================================
$Arquivos['.env.example'] = @'
# ---------------------------------------------------------------------------
# cinep2p :: configuracao local (copie para .env ou exporte no shell)
# ---------------------------------------------------------------------------

# Servidor
PORT=3000
HOST=0.0.0.0

# Armazenamento / cache P2P
# CINE_MAX_TORRENTS   -> quantos torrents ficam ativos simultaneamente
# CINE_IDLE_MIN       -> minutos de ociosidade antes da limpeza agressiva
# CINE_MAX_CACHE_GB   -> teto de disco do cache antes de despejar o LRU
CINE_MAX_TORRENTS=3
CINE_IDLE_MIN=12
CINE_MAX_CACHE_GB=25

# Rede
CINE_HTTP_TIMEOUT=15000
CINE_HTTP_RETRIES=2
CINE_FONTES_CONCORRENCIA=8

# Busca
# Somente fontes com indicio PT-BR (dublado/dual/legendado) por padrao
CINE_APENAS_PTBR=true

# Binarios externos (opcional - se vazio usa ffmpeg-static / ffprobe-static)
FFMPEG_PATH=
FFPROBE_PATH=

# Fontes individuais podem ser desativadas
CINE_FONTES_OFF=
'@

# ===========================================================================
#  .gitignore
# ===========================================================================
$Arquivos['.gitignore'] = @'
node_modules/
.cache/
.backup/
.env
npm-debug.log*
yarn-error.log*
.DS_Store
Thumbs.db
*.tmp
'@

# ===========================================================================
#  src/config.js
# ===========================================================================
$Arquivos['src/config.js'] = @'
'use strict';

const path = require('path');
const fs = require('fs');

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

    APENAS_PTBR: booleano(process.env.CINE_APENAS_PTBR, true),
    FONTES_OFF: lista(process.env.CINE_FONTES_OFF),

    FFMPEG_PATH: process.env.FFMPEG_PATH || null,
    FFPROBE_PATH: process.env.FFPROBE_PATH || null,

    TTL_BUSCA_MS: numero(process.env.CINE_TTL_BUSCA_MS, 10 * 60 * 1000),
    TTL_STATUS_MS: numero(process.env.CINE_TTL_STATUS_MS, 60 * 1000)
};

fs.mkdirSync(config.CACHE_DIR, { recursive: true });
fs.mkdirSync(config.TORRENT_DIR, { recursive: true });

module.exports = config;
'@

# ===========================================================================
#  src/util/logger.js
# ===========================================================================
$Arquivos['src/util/logger.js'] = @'
'use strict';

const NIVEIS = { erro: 0, aviso: 1, info: 2, debug: 3 };
const ATUAL = NIVEIS[(process.env.CINE_LOG || 'info').toLowerCase()] ?? NIVEIS.info;

function carimbo() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function emitir(nivel, escopo, args) {
    if (NIVEIS[nivel] > ATUAL) return;
    const rotulo = nivel.toUpperCase().padEnd(5, ' ');
    const linha = '[' + carimbo() + '] ' + rotulo + ' ' + escopo.padEnd(14, ' ') + ' ::';
    const fn = nivel === 'erro' ? console.error : nivel === 'aviso' ? console.warn : console.log;
    fn(linha, ...args);
}

function criar(escopo) {
    return {
        erro: (...a) => emitir('erro', escopo, a),
        aviso: (...a) => emitir('aviso', escopo, a),
        info: (...a) => emitir('info', escopo, a),
        debug: (...a) => emitir('debug', escopo, a)
    };
}

module.exports = { criar, log: criar('cinep2p') };
'@

# ===========================================================================
#  src/util/magnet.js
# ===========================================================================
$Arquivos['src/util/magnet.js'] = @'
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
'@

# ===========================================================================
#  src/util/http.js
# ===========================================================================
$Arquivos['src/util/http.js'] = @'
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
'@

# ===========================================================================
#  src/util/text.js
# ===========================================================================
$Arquivos['src/util/text.js'] = @'
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
'@

# ===========================================================================
#  src/util/pool.js
# ===========================================================================
$Arquivos['src/util/pool.js'] = @'
'use strict';

async function mapLimit(itens, limite, fn) {
    const lista = Array.from(itens || []);
    const resultados = new Array(lista.length);
    if (!lista.length) return resultados;

    const trabalhadores = Math.max(1, Math.min(Number(limite) || 1, lista.length));
    let cursor = 0;

    async function operario() {
        while (cursor < lista.length) {
            const indice = cursor++;
            try {
                resultados[indice] = await fn(lista[indice], indice);
            } catch (erro) {
                resultados[indice] = { __erro: erro };
            }
        }
    }

    await Promise.all(new Array(trabalhadores).fill(0).map(operario));
    return resultados;
}

function comPrazo(promessa, ms, rotulo) {
    let timer;
    const timeout = new Promise((_, rejeitar) => {
        timer = setTimeout(() => rejeitar(new Error('prazo esgotado: ' + (rotulo || 'operacao'))), ms);
    });
    return Promise.race([promessa, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { mapLimit, comPrazo };
'@

# ===========================================================================
#  src/util/ffmpeg.js
# ===========================================================================
$Arquivos['src/util/ffmpeg.js'] = @'
'use strict';

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const config = require('../config');
const { criar } = require('./logger');

const log = criar('ffmpeg');

const EXTENSOES_DIRETAS = ['mp4', 'm4v', 'mov', 'webm'];
const CODECS_VIDEO_DIRETOS = ['h264', 'avc1', 'vp8', 'vp9', 'av1', 'av01'];
const CODECS_VIDEO_REMUXAVEIS = ['h264', 'avc1', 'hevc', 'h265', 'vp8', 'vp9', 'av1', 'av01'];
const CODECS_AUDIO_DIRETOS = ['aac', 'mp3', 'opus', 'vorbis', 'mp4a'];

let binFfmpeg = config.FFMPEG_PATH;
let binFfprobe = config.FFPROBE_PATH;
let resolvido = false;

function resolverBinarios() {
    if (resolvido) return;
    resolvido = true;

    if (!binFfmpeg) {
        try {
            const p = require('ffmpeg-static');
            if (p && fs.existsSync(p)) binFfmpeg = p;
        } catch (_) { /* opcional */ }
    }
    if (!binFfprobe) {
        try {
            const p = require('ffprobe-static');
            const caminho = p && (p.path || p);
            if (caminho && fs.existsSync(caminho)) binFfprobe = caminho;
        } catch (_) { /* opcional */ }
    }

    if (!binFfmpeg) binFfmpeg = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    if (!binFfprobe) binFfprobe = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
}

function disponivel() {
    resolverBinarios();
    try {
        fs.accessSync(binFfmpeg, fs.constants.X_OK);
        return true;
    } catch (_) {
        return true;
    }
}

function probe(caminho, opcoes) {
    resolverBinarios();
    const opt = opcoes || {};
    return new Promise((resolver) => {
        const args = [
            '-v', 'error',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            caminho
        ];
        execFile(binFfprobe, args, { timeout: opt.timeoutMs || 20000, maxBuffer: 8 * 1024 * 1024 }, (erro, stdout) => {
            if (erro || !stdout) {
                log.debug('ffprobe falhou:', erro ? erro.message : 'sem saida');
                return resolver(null);
            }
            try {
                const dados = JSON.parse(stdout);
                const streams = dados.streams || [];
                const video = streams.find((s) => s.codec_type === 'video') || {};
                const audio = streams.find((s) => s.codec_type === 'audio') || {};
                const formato = dados.format || {};
                return resolver({
                    container: (formato.format_name || '').split(',')[0],
                    duracaoSeg: parseFloat(formato.duration) || 0,
                    tamanhoBytes: parseInt(formato.size, 10) || 0,
                    videoCodec: video.codec_name || null,
                    audioCodec: audio.codec_name || null,
                    largura: video.width || 0,
                    altura: video.height || 0,
                    canais: audio.channels || 0
                });
            } catch (_) {
                return resolver(null);
            }
        });
    });
}

function planejar(info) {
    if (!info) return { modo: 'remux', tag: null, motivo: 'ffprobe indisponivel' };

    const container = String(info.container || '').toLowerCase().split(',')[0];
    const v = String(info.videoCodec || '').toLowerCase();
    const a = String(info.audioCodec || '').toLowerCase();

    const containerOk = EXTENSOES_DIRETAS.includes(container);
    const videoDireto = CODECS_VIDEO_DIRETOS.includes(v);
    const audioDireto = CODECS_AUDIO_DIRETOS.includes(a) || !a;

    if (containerOk && videoDireto && audioDireto) {
        return { modo: 'direto', tag: null, motivo: 'container e codecs nativos do browser' };
    }

    if (CODECS_VIDEO_REMUXAVEIS.includes(v)) {
        const precisaAac = !CODECS_AUDIO_DIRETOS.includes(a) && !!a;
        return {
            modo: 'remux',
            tag: v === 'hevc' || v === 'h265' ? 'hvc1' : null,
            precisaAac: precisaAac,
            motivo: 'remux de container' + (precisaAac ? ' + audio para AAC' : '')
        };
    }

    return { modo: 'transcode', tag: null, motivo: 'codec de video incompativel (' + (v || 'desconhecido') + ')' };
}

function argumentosConversao(caminho, opcoes) {
    const opt = opcoes || {};
    const plano = opt.plano || { modo: 'remux' };
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];

    if (opt.seek && opt.seek > 0.5) {
        args.push('-ss', String(Math.floor(opt.seek)));
    }

    args.push('-i', caminho, '-map', '0:v:0', '-map', '0:a:0?');

    if (plano.modo === 'transcode') {
        args.push(
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-g', '48',
            '-sc_threshold', '0'
        );
    } else {
        args.push('-c:v', 'copy');
    }

    if (plano.tag) args.push('-tag:v', plano.tag);

    if (plano.modo === 'transcode' || plano.precisaAac) {
        args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000');
    } else {
        args.push('-c:a', 'copy');
    }

    args.push(
        '-sn',
        '-dn',
        '-max_muxing_queue_size', '8192',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4',
        'pipe:1'
    );

    return args;
}

function converter(caminho, opcoes) {
    resolverBinarios();
    const args = argumentosConversao(caminho, opcoes);
    log.debug('ffmpeg', args.join(' '));
    return spawn(binFfmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function caminhoDoBinario() {
    resolverBinarios();
    return { ffmpeg: binFfmpeg, ffprobe: binFfprobe };
}

module.exports = { probe, planejar, converter, disponivel, caminhoDoBinario };
'@

# ===========================================================================
#  src/sources/generic.js
# ===========================================================================
$Arquivos['src/sources/generic.js'] = @'
'use strict';

const cheerio = require('cheerio');
const http = require('../util/http');
const { absolutizar, decodificarEntidades, limparTitulo, parseBytes, truncar } = require('../util/text');
const { infoHashDe, montarMagnet, TRACKERS_PADRAO } = require('../util/magnet');

const RE_MAGNET = /magnet:\?xt=urn:btih:[0-9a-zA-Z]{32,40}[^"'\s<>\\]*/g;

const SELETOR_CARDS = 'article, .post, .item, .card, .resultado, .result, li.post, .box, .entry, .torrent, tr.torrent_row';

const SELETOR_LINK = [
    'h1 a', 'h2 a', 'h3 a', 'h4 a',
    '.entry-title a', '.titulo a', '.title a', '.nome a',
    'a[rel="bookmark"]', 'a.torrent-name', 'a.lnk', 'a[href*="torrents.php?id="]'
].join(', ');

const SELETOR_POSTER = 'img';

function carregar(htmlTexto) {
    return cheerio.load(String(htmlTexto || ''), { decodeEntities: true });
}

function extrairMagnets(htmlTexto, base) {
    const achados = new Map();
    const texto = String(htmlTexto || '');
    let m;
    RE_MAGNET.lastIndex = 0;
    while ((m = RE_MAGNET.exec(texto)) !== null) {
        const bruto = decodificarEntidades(m[0]).replace(/['"]+$/, '');
        const hash = infoHashDe(bruto);
        if (!hash) continue;
        if (!achados.has(hash)) {
            achados.set(hash, montarMagnet(hash, null) || bruto);
        }
    }
    return [...achados.values()];
}

function extrairArquivosTorrent(htmlTexto, base) {
    const $ = carregar(htmlTexto);
    const achados = new Set();
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        if (!/\.torrent(\?|$)/i.test(href)) return;
        const url = absolutizar(href, base);
        if (url) achados.add(url);
    });
    return [...achados];
}

function metaOg($, base, propriedade) {
    const valor =
        $(`meta[property="${propriedade}"]`).attr('content') ||
        $(`meta[name="${propriedade}"]`).attr('content') ||
        $(`meta[name="twitter:image"]`).attr('content');
    return valor ? absolutizar(valor, base) : null;
}

function lerCardsPadrao($, ctx, opcoes) {
    const opt = opcoes || {};
    const seletorItem = opt.item || SELETOR_CARDS;
    const seletorLink = opt.link || SELETOR_LINK;
    const itens = [];

    $(seletorItem).each((_, el) => {
        const $el = $(el);
        const $a = $el.find(seletorLink).first().length ? $el.find(seletorLink).first() : $el.find('a[href]').first();
        const href = $a.attr('href');
        if (!href || /^(#|javascript:)/i.test(href)) return;

        let titulo = ($a.attr('title') || $a.text() || '').replace(/\s+/g, ' ').trim();
        if (!titulo || titulo.length < 3) {
            titulo = ($el.find('.entry-title, .titulo, .title, h2, h3').first().text() || '').replace(/\s+/g, ' ').trim();
        }
        if (!titulo || titulo.length < 3) return;

        const $img = $el.find(opt.img || SELETOR_POSTER).first();
        const posterBruto =
            $img.attr('src') ||
            $img.attr('data-src') ||
            $img.attr('data-lazy-src') ||
            $img.attr('data-original') ||
            $el.find('img').first().attr('src');

        const $magnet = $el.find('a[href^="magnet:"]').first();

        itens.push({
            titulo: limparTitulo(titulo),
            tituloBruto: titulo,
            detalheUrl: absolutizar(href, ctx.base),
            poster: posterBruto ? absolutizar(posterBruto, ctx.base) : null,
            sinopse: truncar($el.find('p').first().text(), 400),
            tamanhoBytes: parseBytes($el.text()),
            seeds: parseInt((/(\d+)\s*(?:seed|seeds|sementes|s\b)/i.exec($el.text()) || [])[1], 10) || 0,
            magnet: $magnet.length ? decodificarEntidades($magnet.attr('href')) : null,
            base: ctx.base,
            urlFonte: ctx.url
        });
    });

    return itens;
}

function construirFonteHtml(cfg) {
    return {
        id: cfg.id,
        nome: cfg.nome,
        tipo: 'html',
        categoriaPadrao: cfg.categoriaPadrao || 'filmes',
        confiabilidade: cfg.confiabilidade == null ? 50 : cfg.confiabilidade,
        bases: cfg.bases.slice(),
        timeout: cfg.timeout || 15000,

        async buscar(termo, opcoes) {
            const opt = opcoes || {};
            const limite = opt.limite || 20;
            const falhas = [];

            for (const base of this.bases) {
                try {
                    const url = cfg.montarBusca(base, termo);
                    const htmlTexto = await http.html(url, {
                        referer: base,
                        timeout: cfg.timeout,
                        tentativas: 1
                    });
                    const $ = carregar(htmlTexto);
                    const itens = (cfg.lerLista($, { base, url, termo }) || [])
                        .filter((i) => i && i.titulo)
                        .slice(0, limite);

                    if (!itens.length) {
                        falhas.push(base + ': 0 resultados');
                        continue;
                    }
                    return { base, url, itens };
                } catch (erro) {
                    falhas.push(base + ': ' + erro.message);
                }
            }

            throw new Error('bases indisponiveis -> ' + falhas.join(' | '));
        },

        async resolver(item) {
            if (!item) return { magnets: [], torrents: [] };
            if (item.magnet && !item.detalheUrl) {
                return { magnets: [item.magnet], torrents: [] };
            }

            const alvo = item.detalheUrl || item.magnet;
            const htmlTexto = await http.html(alvo, { referer: item.base, timeout: cfg.timeout, tentativas: 1 });

            let magnets = extrairMagnets(htmlTexto, alvo);
            let torrents = extrairArquivosTorrent(htmlTexto, alvo);

            const $ = carregar(htmlTexto);

            if (cfg.lerDetalhe) {
                const extra = cfg.lerDetalhe($, { base: item.base, url: alvo }) || {};
                if (Array.isArray(extra.magnets)) magnets = magnets.concat(extra.magnets);
                if (Array.isArray(extra.torrents)) torrents = torrents.concat(extra.torrents);
                if (extra.poster && !item.poster) item.poster = extra.poster;
                if (extra.sinopse && !item.sinopse) item.sinopse = extra.sinopse;
                if (extra.ano && !item.ano) item.ano = extra.ano;
            }

            if (!item.poster) item.poster = metaOg($, item.base, 'og:image');
            if (!item.sinopse) item.sinopse = truncar(metaOg($, item.base, 'og:description') || $('meta[name="description"]').attr('content'), 400);
            if (!item.ano) item.ano = (/(19|20)\d{2}/.exec($('title').text() || '') || [null])[0];

            const unicos = new Map();
            for (const m of magnets) {
                const hash = infoHashDe(m);
                if (hash && !unicos.has(hash)) unicos.set(hash, montarMagnet(hash, item.tituloBruto || item.titulo) || m);
            }

            return { magnets: [...unicos.values()], torrents: [...new Set(torrents)] };
        }
    };
}

function construirFonteJson(cfg) {
    return {
        id: cfg.id,
        nome: cfg.nome,
        tipo: 'json',
        categoriaPadrao: cfg.categoriaPadrao || 'filmes',
        confiabilidade: cfg.confiabilidade == null ? 50 : cfg.confiabilidade,
        bases: cfg.bases.slice(),

        async buscar(termo, opcoes) {
            const limite = (opcoes && opcoes.limite) || 20;
            const falhas = [];

            for (const base of this.bases) {
                try {
                    const url = cfg.montarBusca(base, termo);
                    const dados = await http.json(url, Object.assign({ referer: base, tentativas: 1 }, cfg.cabecalhos ? { headers: cfg.cabecalhos } : {}));
                    const itens = (cfg.lerLista(dados, { base, url, termo }) || []).slice(0, limite);
                    if (!itens.length) {
                        falhas.push(base + ': 0 resultados');
                        continue;
                    }
                    return { base, url, itens };
                } catch (erro) {
                    falhas.push(base + ': ' + erro.message);
                }
            }
            throw new Error('bases indisponiveis -> ' + falhas.join(' | '));
        },

        async resolver(item) {
            if (item && item.magnet) return { magnets: [item.magnet], torrents: [] };
            return { magnets: [], torrents: [] };
        }
    };
}

module.exports = {
    construirFonteHtml,
    construirFonteJson,
    lerCardsPadrao,
    extrairMagnets,
    extrairArquivosTorrent,
    metaOg,
    carregar,
    TRACKERS_PADRAO
};
'@

# ===========================================================================
#  src/sources/sites.js
# ===========================================================================
$Arquivos['src/sources/sites.js'] = @'
'use strict';

const {
    construirFonteHtml,
    construirFonteJson,
    lerCardsPadrao
} = require('./generic');
const { montarMagnet, infoHashDe } = require('../util/magnet');
const { limparTitulo, parseBytes } = require('../util/text');

/* ---------------------------------------------------------------------------
   Fontes HTML PT-BR
   Cada fonte declara uma lista de bases (TLDs mudam com frequencia) e o motor
   tenta em cascata ate obter uma resposta com resultados.
--------------------------------------------------------------------------- */

const comandotorrents = construirFonteHtml({
    id: 'comandotorrents',
    nome: 'Comando Torrents',
    bases: [
        'https://comandotorrents.com.br',
        'https://comandotorrents.com',
        'https://comandotorrents.tv'
    ],
    categoriaPadrao: 'filmes',
    confiabilidade: 88,
    montarBusca: (base, termo) => base + '/?s=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'article, .item, .post, .resultado',
        link: 'h2 a, h3 a, .entry-title a, a[rel="bookmark"], .titulo a'
    }),
    lerDetalhe: ($, ctx) => ({
        poster: ($('meta[property="og:image"]').attr('content') || $('.poster img, .capa img, .thumb img').first().attr('src')) || null,
        sinopse: ($('meta[property="og:description"]').attr('content') || $('.sinopse, .resumo, .entry-content p').first().text() || '').trim()
    })
});

const torrentdosfilmes = construirFonteHtml({
    id: 'torrentdosfilmes',
    nome: 'Torrent dos Filmes',
    bases: [
        'https://torrentdosfilmes.tv',
        'https://torrentdosfilmes.com.br',
        'https://torrentdosfilmes.com'
    ],
    categoriaPadrao: 'filmes',
    confiabilidade: 84,
    montarBusca: (base, termo) => base + '/?s=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'article, .item, .post, .box-filme, .resultado',
        link: 'h2 a, h3 a, .entry-title a, .titulo a'
    }),
    lerDetalhe: ($, ctx) => ({
        poster: ($('meta[property="og:image"]').attr('content') || $('.poster img, .capa img').first().attr('src')) || null,
        sinopse: ($('meta[property="og:description"]').attr('content') || '').trim()
    })
});

const bludv = construirFonteHtml({
    id: 'bludv',
    nome: 'BluDV',
    bases: ['https://bludv.tv', 'https://bludv.xyz', 'https://www.bludv.tv'],
    categoriaPadrao: 'filmes',
    confiabilidade: 82,
    montarBusca: (base, termo) => base + '/?s=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'article, .item, .post, .movie, .resultado',
        link: 'h2 a, h3 a, .entry-title a, .title a'
    }),
    lerDetalhe: ($, ctx) => ({
        poster: ($('meta[property="og:image"]').attr('content') || $('.poster img').first().attr('src')) || null,
        sinopse: ($('meta[property="og:description"]').attr('content') || '').trim()
    })
});

const redetorrent = construirFonteHtml({
    id: 'redetorrent',
    nome: 'Rede Torrent',
    bases: ['https://redetorrent.com', 'https://www.redetorrent.com', 'https://redetorrent.org'],
    categoriaPadrao: 'filmes',
    confiabilidade: 74,
    montarBusca: (base, termo) => base + '/?s=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'article, .item, .post, .resultado',
        link: 'h2 a, h3 a, .entry-title a'
    })
});

const bjshare = construirFonteHtml({
    id: 'bjshare',
    nome: 'BJ-Share',
    bases: ['https://bj-share.com', 'https://bj-share.info'],
    categoriaPadrao: 'filmes',
    confiabilidade: 92,
    timeout: 18000,
    montarBusca: (base, termo) =>
        base + '/torrents.php?searchstr=' + encodeURIComponent(termo) + '&order_by=seeders&order_way=desc&filter=all',
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'table.torrent_table tr, tr.torrent_row, .torrent_row, .torrent, table#torrent_table tr',
        link: 'a[href*="torrents.php?id="], a.torrent-name, h3 a'
    }),
    lerDetalhe: ($, ctx) => ({
        poster: ($('#poster img, .poster img').first().attr('src') || null)
    })
});

/* ---------------------------------------------------------------------------
   Fontes especializadas por nicho
--------------------------------------------------------------------------- */

const animestorrent = construirFonteHtml({
    id: 'animestorrent',
    nome: 'AnimesTorrent',
    bases: ['https://animestorrent.com', 'https://www.animestorrent.com', 'https://animestorrent.tv'],
    categoriaPadrao: 'animes',
    confiabilidade: 80,
    montarBusca: (base, termo) => base + '/?s=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'article, .item, .post, .anime, .resultado',
        link: 'h2 a, h3 a, .entry-title a, .titulo a'
    })
});

const animetorrents = construirFonteHtml({
    id: 'animetorrents',
    nome: 'Anime Torrents',
    bases: ['https://animetorrents.me', 'https://www.animetorrents.me'],
    categoriaPadrao: 'animes',
    confiabilidade: 68,
    montarBusca: (base, termo) => base + '/torrents-search.php?search=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'table tr, .item, .resultado',
        link: 'a[href*="details.php?id="], a[href*="torrent"]'
    })
});

const doramastorrent = construirFonteHtml({
    id: 'doramastorrent',
    nome: 'Doramas Torrent',
    bases: [
        'https://doramastorrent.com',
        'https://www.doramastorrent.com',
        'https://doramasytorrents.com'
    ],
    categoriaPadrao: 'doramas',
    confiabilidade: 70,
    montarBusca: (base, termo) => base + '/?s=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'article, .item, .post, .resultado',
        link: 'h2 a, h3 a, .entry-title a'
    })
});

const novelastorrent = construirFonteHtml({
    id: 'novelastorrent',
    nome: 'Novelas Torrent',
    bases: [
        'https://novelastorrent.com',
        'https://www.novelastorrent.com',
        'https://novelasbr.net'
    ],
    categoriaPadrao: 'novelas',
    confiabilidade: 66,
    montarBusca: (base, termo) => base + '/?s=' + encodeURIComponent(termo),
    lerLista: ($, ctx) => lerCardsPadrao($, ctx, {
        item: 'article, .item, .post, .resultado',
        link: 'h2 a, h3 a, .entry-title a'
    })
});

/* ---------------------------------------------------------------------------
   Fontes internacionais com bom indice de releases DUPLO AUDIO / PT-BR
--------------------------------------------------------------------------- */

const apibay = construirFonteJson({
    id: 'apibay',
    nome: 'The Pirate Bay (API)',
    bases: ['https://apibay.org'],
    categoriaPadrao: 'filmes',
    confiabilidade: 72,
    montarBusca: (base, termo) => base + '/q.php?q=' + encodeURIComponent(termo) + '&cat=0',
    lerLista: (dados, ctx) => {
        if (!Array.isArray(dados)) return [];
        return dados
            .filter((x) => x && x.info_hash && x.info_hash !== '0000000000000000000000000000000000000000')
            .map((x) => ({
                titulo: limparTitulo(x.name),
                tituloBruto: x.name,
                infoHash: String(x.info_hash).toLowerCase(),
                seeds: parseInt(x.seeders, 10) || 0,
                leechers: parseInt(x.leechers, 10) || 0,
                tamanhoBytes: parseInt(x.size, 10) || 0,
                magnet: montarMagnet(x.info_hash, x.name),
                base: ctx.base,
                urlFonte: ctx.url
            }));
    }
});

const yts = construirFonteJson({
    id: 'yts',
    nome: 'YTS',
    bases: ['https://yts.mx', 'https://yts.lt', 'https://yts.rs'],
    categoriaPadrao: 'filmes',
    confiabilidade: 76,
    montarBusca: (base, termo) =>
        base + '/api/v2/list_movies.json?limit=20&query_term=' + encodeURIComponent(termo),
    lerLista: (dados, ctx) => {
        const filmes = dados && dados.data && Array.isArray(dados.data.movies) ? dados.data.movies : [];
        const itens = [];
        for (const filme of filmes) {
            for (const t of filme.torrents || []) {
                itens.push({
                    titulo: limparTitulo(filme.title_long || filme.title) + ' ' + (t.quality || '') + ' ' + (t.type || ''),
                    tituloBruto: filme.title_long || filme.title,
                    infoHash: String(t.hash || '').toLowerCase(),
                    seeds: parseInt(t.seeds, 10) || 0,
                    leechers: parseInt(t.peers, 10) || 0,
                    tamanhoBytes: parseBytes(t.size),
                    poster: filme.medium_cover_image || filme.large_cover_image || null,
                    sinopse: filme.summary || '',
                    ano: filme.year ? String(filme.year) : null,
                    magnet: montarMagnet(t.hash, filme.title_long || filme.title),
                    base: ctx.base,
                    urlFonte: ctx.url
                });
            }
        }
        return itens;
    }
});

const FONTES = [
    comandotorrents,
    torrentdosfilmes,
    bludv,
    bjshare,
    redetorrent,
    animestorrent,
    animetorrents,
    doramastorrent,
    novelastorrent,
    apibay,
    yts
];

module.exports = { FONTES };
'@

# ===========================================================================
#  src/sources/index.js
# ===========================================================================
$Arquivos['src/sources/index.js'] = @'
'use strict';

const { FONTES } = require('./sites');
const config = require('../config');
const { mapLimit, comPrazo } = require('../util/pool');
const { criar } = require('../util/logger');
const http = require('../util/http');
const {
    detectarIdioma,
    detectarQualidade,
    detectarCategoria,
    chaveDedupe,
    limparTitulo
} = require('../util/text');
const { infoHashDe, montarMagnet, validarInfoHash } = require('../util/magnet');

const log = criar('fontes');

const cacheBuscas = new Map();
const cacheStatus = { em: 0, dados: null };

function fontesAtivas() {
    return FONTES.filter((f) => !config.FONTES_OFF.includes(f.id));
}

function fontePorId(id) {
    return FONTES.find((f) => f.id === id) || null;
}

function pontuar(item) {
    const texto = [item.titulo, item.tituloBruto, item.sinopse].filter(Boolean).join(' ');
    const idioma = detectarIdioma(texto);
    const qualidade = detectarQualidade(texto);

    let pontos = 0;
    pontos += Math.min(Number(item.seeds) || 0, 600) * 0.35;
    pontos += idioma.pontos;
    pontos += qualidade.peso;
    pontos += (Number(item.confiabilidade) || 0) * 0.3;

    if (!item.infoHash && !item.magnet) pontos -= 12;
    if (item.magnet && !item.infoHash) pontos -= 4;

    const gb = (Number(item.tamanhoBytes) || 0) / (1024 ** 3);
    if (gb > 0 && gb < 0.15) pontos -= 7;
    if (gb > 70) pontos -= 5;
    if (gb >= 0.7 && gb <= 25) pontos += 5;

    return { pontos: Math.round(pontos * 100) / 100, idioma, qualidade };
}

function normalizarItem(item, fonte, categoriaPedida) {
    const titulo = limparTitulo(item.titulo || item.tituloBruto || '');
    if (!titulo) return null;

    const hash = item.infoHash
        ? String(item.infoHash).toLowerCase()
        : infoHashDe(item.magnet || '');

    const magnet = item.magnet
        ? item.magnet
        : hash
            ? montarMagnet(hash, titulo)
            : null;

    const base = {
        titulo,
        tituloBruto: item.tituloBruto || item.titulo || titulo,
        infoHash: validarInfoHash(hash) ? hash : null,
        magnet,
        seeds: Number(item.seeds) || 0,
        leechers: Number(item.leechers) || 0,
        tamanhoBytes: Number(item.tamanhoBytes) || 0,
        poster: item.poster || null,
        sinopse: item.sinopse || '',
        ano: item.ano || null,
        detalheUrl: item.detalheUrl || null,
        torrentUrl: item.torrentUrl || null,
        base: item.base || null,
        fonte: fonte.id,
        fonteNome: fonte.nome,
        confiabilidade: fonte.confiabilidade,
        categoria: detectarCategoria([titulo, item.sinopse].join(' '), fonte.categoriaPadrao || categoriaPedida)
    };

    const score = pontuar(base);
    base.idioma = score.idioma;
    base.qualidade = score.qualidade.rotulo;
    base.pontuacao = score.pontos;
    base.chave = chaveDedupe(titulo);

    return base;
}

function mesclar(a, b) {
    const melhor = a.pontuacao >= b.pontuacao ? a : b;
    const outro = melhor === a ? b : a;

    melhor.seeds = Math.max(a.seeds, b.seeds);
    melhor.leechers = Math.max(a.leechers, b.leechers);
    melhor.poster = melhor.poster || outro.poster;
    melhor.sinopse = melhor.sinopse || outro.sinopse;
    melhor.ano = melhor.ano || outro.ano;
    melhor.magnet = melhor.magnet || outro.magnet;
    melhor.infoHash = melhor.infoHash || outro.infoHash;
    melhor.torrentUrl = melhor.torrentUrl || outro.torrentUrl;
    melhor.detalheUrl = melhor.detalheUrl || outro.detalheUrl;
    melhor.fontesExtras = [...new Set([...(melhor.fontesExtras || []), outro.fonte])];

    return melhor;
}

function deduplicar(itens) {
    const porHash = new Map();
    const semHash = new Map();

    for (const item of itens) {
        if (item.infoHash) {
            const atual = porHash.get(item.infoHash);
            porHash.set(item.infoHash, atual ? mesclar(atual, item) : item);
        } else {
            const atual = semHash.get(item.chave);
            semHash.set(item.chave, atual ? mesclar(atual, item) : item);
        }
    }

    const hashados = [...porHash.values()];
    const chavesComHash = new Set(
        hashados.flatMap((i) => [i.chave, chaveDedupe(i.titulo)])
    );

    const restantes = [...semHash.values()].filter(
        (i) => !chavesComHash.has(i.chave) || (i.magnet && !i.infoHash)
    );

    return hashados.concat(restantes);
}

async function buscarEmFonte(fonte, termo, opcoes) {
    const inicio = Date.now();
    const limite = (opcoes && opcoes.limitePorFonte) || 18;

    try {
        const resposta = await comPrazo(
            fonte.buscar(termo, { limite }),
            (opcoes && opcoes.timeoutFonte) || 22000,
            'busca ' + fonte.id
        );

        let itens = (resposta.itens || [])
            .map((i) => normalizarItem(Object.assign({}, i, { urlFonte: resposta.url }), fonte, opcoes.categoria))
            .filter(Boolean);

        // Resolve magnet nos detalhes das melhores entradas sem hash direto.
        if (opcoes.resolverMagnet !== false) {
            const pendentes = itens.filter((i) => !i.magnet && i.detalheUrl).slice(0, 8);
            await mapLimit(pendentes, 3, async (item) => {
                try {
                    const detalhe = await comPrazo(
                        fonte.resolver(item),
                        18000,
                        'detalhe ' + fonte.id
                    );
                    const magnet = (detalhe.magnets || [])[0];
                    if (magnet) {
                        item.magnet = magnet;
                        item.infoHash = infoHashDe(magnet);
                    }
                    if (!item.torrentUrl && detalhe.torrents && detalhe.torrents.length) {
                        item.torrentUrl = detalhe.torrents[0];
                    }
                    const rescore = pontuar(item);
                    item.pontuacao = rescore.pontos;
                    item.idioma = rescore.idioma;
                } catch (_) { /* detalhe opcional */ }
            });
            itens = itens.filter((i) => i.magnet || i.detalheUrl);
        }

        return {
            fonte: fonte.id,
            nome: fonte.nome,
            ok: true,
            ms: Date.now() - inicio,
            total: itens.length,
            itens
        };
    } catch (erro) {
        log.aviso('fonte falhou', fonte.id, '-', erro.message);
        return { fonte: fonte.id, nome: fonte.nome, ok: false, ms: Date.now() - inicio, erro: erro.message, total: 0, itens: [] };
    }
}

async function buscar(termo, opcoes) {
    const opt = Object.assign(
        {
            categoria: 'todos',
            limitePorFonte: 18,
            resolverMagnet: true,
            apenasPtBr: config.APENAS_PTBR,
            pagina: 1,
            porPagina: 60
        },
        opcoes || {}
    );

    const consulta = String(termo || '').trim();
    if (!consulta) return { termo: consulta, total: 0, itens: [], fontes: [], categorias: {} };

    const chaveCache = [consulta.toLowerCase(), opt.categoria, opt.apenasPtBr, opt.limitePorFonte].join('|');
    const emCache = cacheBuscas.get(chaveCache);
    if (emCache && Date.now() - emCache.em < config.TTL_BUSCA_MS) {
        return Object.assign({}, emCache.dados, { cache: true });
    }

    const ativas = fontesAtivas();
    const resultados = await mapLimit(ativas, config.FONTES_CONCORRENCIA, (fonte) =>
        buscarEmFonte(fonte, consulta, opt)
    );

    let itens = resultados.flatMap((r) => r.itens || []);
    itens = deduplicar(itens);

    if (opt.categoria && opt.categoria !== 'todos') {
        itens = itens.filter((i) => i.categoria === opt.categoria);
    }

    if (opt.apenasPtBr) {
        const comPtBr = itens.filter((i) => i.idioma && i.idioma.ptbr);
        if (comPtBr.length >= 3) itens = comPtBr;
    }

    itens.sort((a, b) => b.pontuacao - a.pontuacao);

    const porCategoria = {};
    for (const item of itens) {
        porCategoria[item.categoria] = (porCategoria[item.categoria] || 0) + 1;
    }

    const pagina = Math.max(1, Number(opt.pagina) || 1);
    const porPagina = Math.max(1, Number(opt.porPagina) || 60);
    const fatiado = itens.slice((pagina - 1) * porPagina, pagina * porPagina);

    const dados = {
        termo: consulta,
        total: itens.length,
        pagina,
        porPagina,
        totalPaginas: Math.max(1, Math.ceil(itens.length / porPagina)),
        categorias: porCategoria,
        itens: fatiado,
        fontes: resultados.map((r) => ({
            fonte: r.fonte,
            nome: r.nome,
            ok: r.ok,
            ms: r.ms,
            total: r.total,
            erro: r.erro || null
        }))
    };

    cacheBuscas.set(chaveCache, { em: Date.now(), dados });
    if (cacheBuscas.size > 120) {
        const maisAntiga = [...cacheBuscas.entries()].sort((a, b) => a[1].em - b[1].em)[0];
        if (maisAntiga) cacheBuscas.delete(maisAntiga[0]);
    }

    return dados;
}

async function statusFontes(forcar) {
    if (!forcar && cacheStatus.dados && Date.now() - cacheStatus.em < config.TTL_STATUS_MS) {
        return cacheStatus.dados;
    }

    const relatorio = await mapLimit(fontesAtivas(), 6, async (fonte) => {
        const base = fonte.bases[0];
        const teste = await http.ping(base, { tentativas: 0, timeout: 9000 });
        let buscaTeste = null;
        if (true) {
            try {
                const r = await comPrazo(fonte.buscar('dublado', { limite: 3 }), 16000, 'teste');
                buscaTeste = { ok: true, total: (r.itens || []).length };
            } catch (erro) {
                buscaTeste = { ok: false, erro: erro.message };
            }
        }
        return {
            id: fonte.id,
            nome: fonte.nome,
            categoriaPadrao: fonte.categoriaPadrao,
            confiabilidade: fonte.confiabilidade,
            bases: fonte.bases,
            baseTestada: base,
            online: teste.ok || !!(buscaTeste && buscaTeste.ok),
            status: teste.status || null,
            ms: teste.ms,
            erro: teste.erro || null,
            buscaTeste
        };
    });

    const dados = {
        em: new Date().toISOString(),
        total: relatorio.length,
        online: relatorio.filter((r) => r.online).length,
        fontes: relatorio
    };

    cacheStatus.em = Date.now();
    cacheStatus.dados = dados;
    return dados;
}

function limparCache() {
    cacheBuscas.clear();
    cacheStatus.em = 0;
    cacheStatus.dados = null;
}

module.exports = { buscar, statusFontes, fontesAtivas, fontePorId, limparCache, pontuar };
'@

# ===========================================================================
#  src/catalogo.js
# ===========================================================================
$Arquivos['src/catalogo.js'] = @'
'use strict';

const fs = require('fs');
const config = require('./config');
const { criar } = require('./util/logger');
const { chaveDedupe } = require('./util/text');

const log = criar('catalogo');

const CATEGORIAS = ['filmes', 'series', 'animes', 'doramas', 'novelas', 'curtas', 'documentarios'];
const MAX_POR_CATEGORIA = 400;

let estado = { atualizadoEm: null, versao: 3, categorias: {} };
let carregado = false;
let gravando = false;

function carregar() {
    if (carregado) return estado;
    carregado = true;
    try {
        if (fs.existsSync(config.CATALOGO_ARQ)) {
            const bruto = JSON.parse(fs.readFileSync(config.CATALOGO_ARQ, 'utf8'));
            if (bruto && bruto.categorias) estado = bruto;
            log.info('catalogo carregado de', config.CATALOGO_ARQ);
        }
    } catch (erro) {
        log.aviso('falha ao ler catalogo:', erro.message);
    }
    for (const c of CATEGORIAS) if (!estado.categorias[c]) estado.categorias[c] = [];
    return estado;
}

function gravar() {
    if (gravando) return;
    gravando = true;
    try {
        estado.atualizadoEm = new Date().toISOString();
        fs.writeFileSync(config.CATALOGO_ARQ, JSON.stringify(estado), 'utf8');
    } catch (erro) {
        log.aviso('falha ao gravar catalogo:', erro.message);
    } finally {
        gravando = false;
    }
}

function adicionar(categoria, itens) {
    carregar();
    const alvo = estado.categorias[categoria] || (estado.categorias[categoria] = []);
    const indice = new Map(alvo.map((i) => [i.infoHash || chaveDedupe(i.titulo), i]));

    for (const item of itens || []) {
        const chave = item.infoHash || chaveDedupe(item.titulo);
        const existente = indice.get(chave);
        if (existente) {
            if (item.pontuacao > existente.pontuacao) Object.assign(existente, item);
            continue;
        }
        indice.set(chave, item);
        alvo.push(item);
    }

    alvo.sort((a, b) => (b.pontuacao || 0) - (a.pontuacao || 0));
    if (alvo.length > MAX_POR_CATEGORIA) alvo.length = MAX_POR_CATEGORIA;
    estado.categorias[categoria] = alvo;
    return alvo.length;
}

function listar(categoria, opcoes) {
    carregar();
    const opt = opcoes || {};
    const pagina = Math.max(1, Number(opt.pagina) || 1);
    const porPagina = Math.max(1, Number(opt.porPagina) || 60);

    let itens;
    if (!categoria || categoria === 'inicio') {
        const amostra = [];
        for (const c of ['filmes', 'series', 'animes', 'doramas', 'novelas', 'curtas']) {
            amostra.push(...(estado.categorias[c] || []).slice(0, 40));
        }
        itens = amostra.sort((a, b) => (b.pontuacao || 0) - (a.pontuacao || 0));
    } else {
        itens = estado.categorias[categoria] || [];
    }

    if (opt.termo) {
        const alvo = String(opt.termo).toLowerCase();
        itens = itens.filter((i) => String(i.titulo).toLowerCase().includes(alvo));
    }

    const total = itens.length;
    return {
        categoria: categoria || 'inicio',
        total,
        pagina,
        porPagina,
        totalPaginas: Math.max(1, Math.ceil(total / porPagina)),
        atualizadoEm: estado.atualizadoEm,
        itens: itens.slice((pagina - 1) * porPagina, pagina * porPagina)
    };
}

function resumo() {
    carregar();
    const contagem = {};
    for (const c of CATEGORIAS) contagem[c] = (estado.categorias[c] || []).length;
    return {
        atualizadoEm: estado.atualizadoEm,
        total: Object.values(contagem).reduce((a, b) => a + b, 0),
        categorias: contagem
    };
}

module.exports = { CATEGORIAS, carregar, gravar, adicionar, listar, resumo };
'@

# ===========================================================================
#  src/torrent/engine.js
# ===========================================================================
$Arquivos['src/torrent/engine.js'] = @'
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { criar } = require('./../util/logger');
const { TRACKERS_PADRAO, infoHashDe, montarMagnet } = require('../util/magnet');
const ff = require('../util/ffmpeg');

const log = criar('webtorrent');

const EXTENSOES_VIDEO = ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.mpg', '.mpeg', '.ts', '.flv', '.ogv'];

let ModuloWebTorrent = null;
let cliente = null;
let temporizador = null;
let encerrando = false;

const ativos = new Map();

async function carregarWebTorrent() {
    if (ModuloWebTorrent) return ModuloWebTorrent;
    const mod = await import('webtorrent');
    ModuloWebTorrent = mod && mod.default ? mod.default : mod && mod.WebTorrent ? mod.WebTorrent : mod;
    return ModuloWebTorrent;
}

async function obterCliente() {
    if (cliente) return cliente;
    const WebTorrent = await carregarWebTorrent();

    fs.mkdirSync(config.TORRENT_DIR, { recursive: true });

    cliente = new WebTorrent({
        maxConns: 90,
        dht: true,
        tracker: true,
        lsd: true,
        utp: true
    });

    cliente.on('error', (erro) => log.aviso('erro no cliente:', erro.message));

    temporizador = setInterval(() => {
        varrer().catch((e) => log.debug('varredura:', e.message));
    }, 15000);

    log.info('cliente WebTorrent iniciado (max ativos = ' + config.MAX_TORRENTS_ATIVOS + ')');
    return cliente;
}

function montarMagnetSeguro(entrada) {
    const hash = infoHashDe(entrada);
    if (!hash) return null;
    if (String(entrada).startsWith('magnet:')) {
        return /tr=/.test(entrada) ? entrada : montarMagnet(hash);
    }
    return montarMagnet(hash);
}

function escolherArquivo(torrent) {
    const arquivos = torrent.files || [];
    if (!arquivos.length) return null;

    const videos = arquivos.filter((f) => EXTENSOES_VIDEO.includes(path.extname(f.name).toLowerCase()));
    const lista = videos.length ? videos : arquivos;

    const pontuar = (arquivo) => {
        let peso = arquivo.length;
        const nome = arquivo.name.toLowerCase();
        if (/1080p/.test(nome)) peso *= 1.7;
        else if (/720p/.test(nome)) peso *= 1.45;
        if (/(sample|trailer|extra|featurette)/.test(nome)) peso *= 0.3;
        if (/(\bs\d{1,2}e\d{1,2}\b)/.test(nome) && lista.length > 4) peso *= 0.85;
        return peso;
    };

    return lista.slice().sort((a, b) => pontuar(b) - pontuar(a))[0];
}

function removerPasta(caminho) {
    return new Promise((resolver) => {
        const tentar = (n) => {
            try {
                fs.rmSync(caminho, { recursive: true, force: true });
                resolver(true);
            } catch (_) {
                if (n <= 0) return resolver(false);
                setTimeout(() => tentar(n - 1), 350);
            }
        };
        tentar(5);
    });
}

function tamanhoPasta(caminho, profundidade) {
    const nivel = profundidade == null ? 0 : profundidade;
    if (nivel > 6) return 0;
    let total = 0;
    let entradas = [];
    try {
        entradas = fs.readdirSync(caminho, { withFileTypes: true });
    } catch (_) {
        return 0;
    }
    for (const entrada of entradas) {
        const completo = path.join(caminho, entrada.name);
        try {
            if (entrada.isDirectory()) total += tamanhoPasta(completo, nivel + 1);
            else total += fs.statSync(completo).size;
        } catch (_) { /* ignorado */ }
    }
    return total;
}

async function destruir(infoHash) {
    const registro = ativos.get(infoHash);
    if (!registro) return false;
    ativos.delete(infoHash);

    await new Promise((resolver) => {
        let pronto = false;
        const finalizar = () => {
            if (pronto) return;
            pronto = true;
            resolver();
        };
        try {
            registro.torrent.destroy({ destroyStore: true }, finalizar);
        } catch (_) {
            finalizar();
        }
        setTimeout(finalizar, 5000);
    });

    await removerPasta(path.join(config.TORRENT_DIR, infoHash));
    log.info('despejado do cache:', infoHash.slice(0, 12));
    return true;
}

async function liberarEspaco() {
    while (ativos.size >= config.MAX_TORRENTS_ATIVOS) {
        const ordenados = [...ativos.values()].sort((a, b) => a.ultimoAcesso - b.ultimoAcesso);
        const alvo = ordenados[0];
        if (!alvo) break;
        await destruir(alvo.infoHash);
    }

    const limiteBytes = config.MAX_CACHE_GB * (1024 ** 3);
    if (limiteBytes > 0 && tamanhoPasta(config.TORRENT_DIR) > limiteBytes) {
        const ordenados = [...ativos.values()].sort((a, b) => a.ultimoAcesso - b.ultimoAcesso);
        for (const alvo of ordenados) {
            await destruir(alvo.infoHash);
            if (tamanhoPasta(config.TORRENT_DIR) <= limiteBytes) break;
        }
    }
}

async function varrer() {
    if (encerrando) return;
    const agora = Date.now();
    const limiteOciosidade = config.TORRENT_IDLE_MIN * 60 * 1000;

    for (const registro of [...ativos.values()]) {
        const ocioso = agora - registro.ultimoAcesso;
        const concluido = registro.torrent.progress >= 0.999;
        if (ocioso > limiteOciosidade && (concluido || ocioso > limiteOciosidade * 2)) {
            await destruir(registro.infoHash);
        }
    }

    if (ativos.size === 0) {
        await liberarEspaco();
    }
}

async function abrir(entrada, opcoes) {
    const opt = opcoes || {};
    const infoHash = infoHashDe(entrada);
    if (!infoHash) throw new Error('magnet ou infohash invalido');

    const existente = ativos.get(infoHash);
    if (existente) {
        existente.ultimoAcesso = Date.now();
        return existente;
    }

    await liberarEspaco();

    const cli = await obterCliente();
    const magnet = montarMagnetSeguro(entrada);
    const pasta = path.join(config.TORRENT_DIR, infoHash);
    const prazo = opt.timeoutMs || 75000;

    const torrent = await new Promise((resolver, rejeitar) => {
        let finalizado = false;

        const finalizar = (fn, valor) => {
            if (finalizado) return;
            finalizado = true;
            clearTimeout(timer);
            fn(valor);
        };

        const instancia = cli.add(
            magnet,
            {
                path: pasta,
                announce: TRACKERS_PADRAO,
                destroyStoreOnDestroy: true
            },
            (t) => finalizar(resolver, t || instancia)
        );

        const timer = setTimeout(() => {
            if (finalizado) return;
            try { instancia.destroy({ destroyStore: true }); } catch (_) { /* noop */ }
            finalizar(rejeitar, new Error('tempo esgotado buscando peers/metadados (' + Math.round(prazo / 1000) + 's)'));
        }, prazo);

        instancia.on('error', (erro) => finalizar(rejeitar, erro));
        instancia.on('warning', (aviso) => log.debug('aviso torrent:', aviso && aviso.message));
    });

    const arquivo = escolherArquivo(torrent);
    if (!arquivo) {
        try { torrent.destroy({ destroyStore: true }); } catch (_) { /* noop */ }
        throw new Error('nenhum arquivo reproduzivel encontrado no torrent');
    }

    const registro = {
        infoHash,
        torrent,
        arquivo,
        indiceArquivo: torrent.files.indexOf(arquivo),
        criadoEm: Date.now(),
        ultimoAcesso: Date.now(),
        nome: torrent.name
    };

    ativos.set(infoHash, registro);

    try {
        torrent.files.forEach((f) => { if (f !== arquivo) f.deselect(); });
        arquivo.select();
    } catch (_) { /* noop */ }

    log.info('torrent ativo:', infoHash.slice(0, 12), '-', torrent.name, '(' + torrent.files.length + ' arquivos)');
    return registro;
}

async function aguardarMinimo(registro, bytesMinimos, prazoMs) {
    const alvo = Math.min(bytesMinimos, registro.arquivo.length);
    const limite = Date.now() + (prazoMs || 45000);

    while (Date.now() < limite) {
        if (registro.torrent.downloaded >= alvo || registro.torrent.progress >= 0.02) return true;
        if (registro.torrent.numPeers === 0 && Date.now() > limite - 20000) return false;
        await new Promise((r) => setTimeout(r, 400));
    }
    return registro.torrent.downloaded > 0;
}

function estatisticas(infoHash) {
    const registro = ativos.get(infoHash);
    if (!registro) return null;
    const t = registro.torrent;
    return {
        infoHash,
        nome: t.name,
        peers: t.numPeers,
        progresso: Math.round((t.progress || 0) * 10000) / 100,
        baixado: t.downloaded,
        tamanho: t.length,
        velocidadeDown: t.downloadSpeed,
        velocidadeUp: t.uploadSpeed,
        restanteSeg: t.timeRemaining,
        ativo: true
    };
}

function listarAtivos() {
    return [...ativos.values()].map((r) => ({
        infoHash: r.infoHash,
        nome: r.nome,
        arquivo: r.arquivo.name,
        ociosoSeg: Math.round((Date.now() - r.ultimoAcesso) / 1000),
        progresso: Math.round((r.torrent.progress || 0) * 10000) / 100,
        peers: r.torrent.numPeers
    }));
}

async function limparTudo() {
    for (const hash of [...ativos.keys()]) {
        await destruir(hash);
    }
    await removerPasta(config.TORRENT_DIR);
    fs.mkdirSync(config.TORRENT_DIR, { recursive: true });
    return true;
}

function caminhoArquivo(registro, indice) {
    const arquivo = indice == null ? registro.arquivo : registro.torrent.files[indice];
    if (!arquivo) return null;
    return path.join(registro.torrent.path || path.join(config.TORRENT_DIR, registro.infoHash), arquivo.path);
}

function encerrar() {
    encerrando = true;
    if (temporizador) clearInterval(temporizador);
    if (cliente) {
        try { cliente.destroy(); } catch (_) { /* noop */ }
    }
    cliente = null;
    ativos.clear();
}

module.exports = {
    EXTENSOES_VIDEO,
    abrir,
    destruir,
    varrer,
    aguardarMinimo,
    estatisticas,
    listarAtivos,
    limparTudo,
    caminhoArquivo,
    encerrar,
    ff
};
'@

# ===========================================================================
#  src/routes/api.js
# ===========================================================================
$Arquivos['src/routes/api.js'] = @'
'use strict';

const express = require('express');
const path = require('path');
const config = require('../config');
const fontes = require('../sources');
const motor = require('../torrent/engine');
const catalogo = require('../catalogo');
const ff = require('../util/ffmpeg');
const http = require('../util/http');
const { criar } = require('../util/logger');
const { infoHashDe } = require('../util/magnet');

const log = criar('api');
const rotas = express.Router();

function ah(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const MIMES = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.ts': 'video/mp2t',
    '.flv': 'video/x-flv',
    '.ogv': 'video/ogg'
};

function mimeDe(nome) {
    return MIMES[path.extname(String(nome || '')).toLowerCase()] || 'application/octet-stream';
}

/* --------------------------------------------------------------------------
   Saude / fontes
-------------------------------------------------------------------------- */

rotas.get('/api/saude', (req, res) => {
    res.json({
        ok: true,
        versao: 3,
        uptimeSeg: Math.round(process.uptime()),
        torrentsAtivos: motor.listarAtivos().length,
        catalogo: catalogo.resumo(),
        ffmpeg: ff.caminhoDoBinario()
    });
});

rotas.get('/api/fontes', ah(async (req, res) => {
    const relatorio = await fontes.statusFontes(req.query.forcar === '1');
    res.json(relatorio);
}));

rotas.get('/api/categorias', (req, res) => {
    res.json({
        categorias: [
            { id: 'inicio', rotulo: 'Início' },
            { id: 'filmes', rotulo: 'Filmes' },
            { id: 'series', rotulo: 'Séries' },
            { id: 'animes', rotulo: 'Animes' },
            { id: 'doramas', rotulo: 'Doramas' },
            { id: 'novelas', rotulo: 'Novelas' },
            { id: 'curtas', rotulo: 'Curtas' },
            { id: 'documentarios', rotulo: 'Documentários' }
        ]
    });
});

/* --------------------------------------------------------------------------
   Busca
-------------------------------------------------------------------------- */

rotas.get('/api/buscar', ah(async (req, res) => {
    const termo = String(req.query.q || '').trim();
    if (!termo) return res.json({ termo: '', total: 0, itens: [], fontes: [] });

    const dados = await fontes.buscar(termo, {
        categoria: req.query.categoria || 'todos',
        pagina: Number(req.query.pagina) || 1,
        porPagina: Math.min(120, Number(req.query.porPagina) || 60),
        apenasPtBr: req.query.ptbr === undefined ? config.APENAS_PTBR : req.query.ptbr !== '0',
        resolverMagnet: req.query.magnet !== '0'
    });

    res.json(dados);
}));

rotas.get('/api/catalogo', (req, res) => {
    res.json(catalogo.listar(req.query.categoria || 'inicio', {
        pagina: Number(req.query.pagina) || 1,
        porPagina: Math.min(120, Number(req.query.porPagina) || 60),
        termo: req.query.termo || ''
    }));
});

/* --------------------------------------------------------------------------
   Proxy de imagens (evita bloqueio de hotlink dos sites BR)
-------------------------------------------------------------------------- */

rotas.get('/api/img', ah(async (req, res) => {
    const alvo = String(req.query.u || '');
    if (!/^https?:\/\//i.test(alvo)) return res.status(400).end();

    const resposta = await http.binario(alvo, {
        referer: req.query.ref || undefined,
        tentativas: 1,
        timeout: 12000
    });

    res.setHeader('Content-Type', resposta.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(resposta.buffer);
}));

/* --------------------------------------------------------------------------
   Metadados do torrent
-------------------------------------------------------------------------- */

rotas.get('/api/torrent/:infoHash', ah(async (req, res) => {
    const registro = await motor.abrir(req.params.infoHash);
    const caminho = motor.caminhoArquivo(registro);
    const info = await ff.probe(caminho, { timeoutMs: 25000 });
    const plano = ff.planejar(info);

    res.json({
        infoHash: registro.infoHash,
        nome: registro.torrent.name,
        tamanho: registro.torrent.length,
        indice: registro.indiceArquivo,
        arquivo: registro.arquivo.name,
        arquivoTamanho: registro.arquivo.length,
        modo: plano.modo,
        motivo: plano.motivo,
        tecnico: info,
        arquivos: registro.torrent.files.map((f, i) => ({
            indice: i,
            nome: f.name,
            tamanho: f.length,
            video: motor.EXTENSOES_VIDEO.includes(path.extname(f.name).toLowerCase())
        })),
        estatisticas: motor.estatisticas(registro.infoHash)
    });
}));

rotas.get('/api/status/:infoHash', ah(async (req, res) => {
    const stats = motor.estatisticas(req.params.infoHash);
    if (!stats) return res.status(404).json({ ativo: false });
    res.json(stats);
}));

/* --------------------------------------------------------------------------
   Streaming direto (Range / 206)
-------------------------------------------------------------------------- */

rotas.get('/stream/:infoHash/:indice?', ah(async (req, res) => {
    const registro = await motor.abrir(req.params.infoHash);
    const indice = req.params.indice == null ? registro.indiceArquivo : Number(req.params.indice);
    const arquivo = registro.torrent.files[indice];
    if (!arquivo) return res.status(404).end();

    await motor.aguardarMinimo(registro, 2 * 1024 * 1024, 30000);
    registro.ultimoAcesso = Date.now();

    const total = arquivo.length;
    const cabecalho = req.headers.range;
    let inicio = 0;
    let fim = total - 1;

    if (cabecalho) {
        const m = /bytes=(\d*)-(\d*)/.exec(cabecalho);
        if (m) {
            if (m[1]) inicio = parseInt(m[1], 10);
            if (m[2]) fim = parseInt(m[2], 10);
            if (Number.isNaN(inicio) || inicio < 0) inicio = 0;
            if (Number.isNaN(fim) || fim >= total) fim = total - 1;
            if (inicio > fim) inicio = 0;
        }
    }

    res.status(cabecalho ? 206 : 200);
    res.setHeader('Content-Type', mimeDe(arquivo.name));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', fim - inicio + 1);
    res.setHeader('Cache-Control', 'no-store');
    if (cabecalho) res.setHeader('Content-Range', 'bytes ' + inicio + '-' + fim + '/' + total);

    const stream = arquivo.createReadStream({ start: inicio, end: fim });
    stream.on('error', (erro) => {
        log.debug('stream encerrado:', erro.message);
        try { res.end(); } catch (_) { /* noop */ }
    });
    req.on('close', () => { try { stream.destroy(); } catch (_) { /* noop */ } });
    stream.pipe(res);
}));

/* --------------------------------------------------------------------------
   Transcode / remux on-the-fly (fMP4)
-------------------------------------------------------------------------- */

rotas.get('/transcode/:infoHash/:indice?', ah(async (req, res) => {
    const registro = await motor.abrir(req.params.infoHash);
    const indice = req.params.indice == null ? registro.indiceArquivo : Number(req.params.indice);
    const arquivo = registro.torrent.files[indice];
    if (!arquivo) return res.status(404).end();

    await motor.aguardarMinimo(registro, 4 * 1024 * 1024, 40000);
    registro.ultimoAcesso = Date.now();

    const caminho = motor.caminhoArquivo(registro, indice);
    const info = await ff.probe(caminho, { timeoutMs: 25000 });
    const plano = ff.planejar(info);

    const seek = Number(req.query.t) || 0;

    res.status(200);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'none');

    const processo = ff.converter(caminho, { seek, plano });

    let erroFfmpeg = '';
    processo.stderr.on('data', (d) => { erroFfmpeg += d.toString(); });
    processo.on('error', (erro) => {
        log.erro('ffmpeg falhou:', erro.message);
        try { res.end(); } catch (_) { /* noop */ }
    });
    processo.on('close', (codigo) => {
        if (codigo !== 0 && erroFfmpeg) log.debug('ffmpeg saiu com', codigo, erroFfmpeg.slice(-400));
        try { res.end(); } catch (_) { /* noop */ }
    });

    processo.stdout.pipe(res);

    req.on('close', () => {
        try { processo.kill('SIGKILL'); } catch (_) { /* noop */ }
    });
}));

/* --------------------------------------------------------------------------
   Cache
-------------------------------------------------------------------------- */

rotas.get('/api/cache', (req, res) => {
    res.json({ ativos: motor.listarAtivos() });
});

rotas.delete('/api/cache', ah(async (req, res) => {
    const alvo = req.query.infoHash;
    if (alvo) {
        const ok = await motor.destruir(alvo);
        return res.json({ ok, removido: alvo });
    }
    await motor.limparTudo();
    fontes.limparCache();
    res.json({ ok: true });
}));

rotas.post('/api/cache/limpar', ah(async (req, res) => {
    await motor.limparTudo();
    fontes.limparCache();
    res.json({ ok: true });
}));

/* --------------------------------------------------------------------------
   Erros
-------------------------------------------------------------------------- */

rotas.use((erro, req, res, next) => {
    log.aviso(req.method, req.originalUrl, '->', erro.message);
    if (res.headersSent) return next(erro);
    res.status(500).json({
        erro: erro.message,
        dica: /tempo esgotado/i.test(erro.message)
            ? 'Poucos seeds no magnet. Tente outra fonte/qualidade.'
            : undefined
    });
});

module.exports = rotas;
'@

# ===========================================================================
#  server.js
# ===========================================================================
$Arquivos['server.js'] = @'
'use strict';

const path = require('path');
const express = require('express');
const compression = require('compression');
const cors = require('cors');

const config = require('./src/config');
const rotas = require('./src/routes/api');
const motor = require('./src/torrent/engine');
const catalogo = require('./src/catalogo');
const { log } = require('./src/util/logger');
const ff = require('./src/util/ffmpeg');

const app = express();

app.disable('x-powered-by');
app.use(compression({ threshold: 1024 }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
    if (/^\/(api|stream|transcode)\//.test(req.path)) {
        log.debug(req.method, req.originalUrl);
    }
    next();
});

app.use(rotas);

app.use('/api', (req, res) => res.status(404).json({ erro: 'rota nao encontrada', rota: req.originalUrl }));

app.use(express.static(path.join(config.RAIZ, 'public'), { maxAge: '1h' }));

app.get('*', (req, res) => {
    res.sendFile(path.join(config.RAIZ, 'public', 'index.html'));
});

catalogo.carregar();

const servidor = app.listen(config.PORT, config.HOST, () => {
    const bin = ff.caminhoDoBinario();
    log.info('cinep2p v3 no ar em http://localhost:' + config.PORT);
    log.info('cache P2P      :', config.TORRENT_DIR);
    log.info('max torrents   :', config.MAX_TORRENTS_ATIVOS, '| ociosidade:', config.TORRENT_IDLE_MIN + 'min');
    log.info('ffmpeg         :', bin.ffmpeg);
    log.info('catalogo       :', JSON.stringify(catalogo.resumo()));
});

function desligar(sinal) {
    log.info('encerrando (' + sinal + ')...');
    servidor.close(() => {
        motor.encerrar();
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 6000);
}

process.on('SIGINT', () => desligar('SIGINT'));
process.on('SIGTERM', () => desligar('SIGTERM'));
process.on('unhandledRejection', (e) => log.aviso('promise rejeitada:', e && e.message));
'@

# ===========================================================================
#  worker.js
# ===========================================================================
$Arquivos['worker.js'] = @'
'use strict';

/*
 * worker.js - daemon de aquecimento do catalogo e manutencao do cache.
 *
 *   node worker.js          -> roda um ciclo e mantem intervalo de 6h
 *   node worker.js --once   -> roda um ciclo e sai
 *   node worker.js --fontes -> apenas testa a saude das fontes
 */

const config = require('./src/config');
const fontes = require('./src/sources');
const catalogo = require('./src/catalogo');
const motor = require('./src/torrent/engine');
const { criar } = require('./src/util/logger');

const log = criar('worker');

const INTERVALO_MS = Number(process.env.CINE_WORKER_INTERVALO_MIN || 360) * 60 * 1000;

const CONSULTAS = {
    filmes: [
        'filme dublado 1080p',
        'filme dublado 720p',
        'filme dual audio 1080p',
        'lancamento dublado',
        'filme nacional 1080p',
        'animacao dublada 1080p',
        'filme legendado pt br 1080p'
    ],
    series: [
        'serie dublada 1080p',
        'serie completa dublada',
        'serie dual audio 1080p',
        'temporada completa dublada 720p',
        'serie legendada 1080p'
    ],
    animes: [
        'anime dublado 1080p',
        'anime dublado 720p',
        'anime dual audio 1080p',
        'anime completo dublado',
        'anime legendado 1080p'
    ],
    doramas: [
        'dorama dublado 1080p',
        'dorama legendado 1080p',
        'dorama completo dublado',
        'kdrama dublado 720p',
        'drama coreano dublado'
    ],
    novelas: [
        'novela dublada completa',
        'novela mexicana dublada 1080p',
        'novela turca dublada',
        'telenovela completa',
        'novela legendada 720p'
    ],
    curtas: [
        'curta animacao dublado',
        'curta metragem nacional',
        'curtas animados dublados'
    ]
};

async function ciclo() {
    const inicio = Date.now();
    log.info('iniciando ciclo de aquecimento do catalogo');
    let total = 0;

    for (const categoria of Object.keys(CONSULTAS)) {
        for (const termo of CONSULTAS[categoria]) {
            try {
                const dados = await fontes.buscar(termo, {
                    categoria,
                    limitePorFonte: 20,
                    apenasPtBr: true,
                    resolverMagnet: false
                });

                const uteis = (dados.itens || []).filter(
                    (i) => i.magnet && (i.idioma ? i.idioma.ptbr : true)
                );

                if (uteis.length) {
                    const tamanho = catalogo.adicionar(categoria, uteis);
                    total += uteis.length;
                    log.info('[' + categoria + '] "' + termo + '" ->', uteis.length, 'itens (catalogo:', tamanho + ')');
                }
            } catch (erro) {
                log.aviso('[' + categoria + '] "' + termo + '" falhou:', erro.message);
            }
        }
    }

    catalogo.gravar();
    log.info('ciclo concluido em', ((Date.now() - inicio) / 1000).toFixed(1) + 's | itens processados:', total);
    log.info('resumo do catalogo:', JSON.stringify(catalogo.resumo()));
}

async function testarFontes() {
    const relatorio = await fontes.statusFontes(true);
    log.info('fontes online:', relatorio.online + '/' + relatorio.total);
    for (const f of relatorio.fontes) {
        const marca = f.online ? 'OK ' : 'OFF';
        log.info(' ' + marca + ' ' + f.nome.padEnd(24, ' ') + ' ' + (f.erro || f.ms + 'ms') + ' busca=' + JSON.stringify(f.buscaTeste));
    }
}

(async () => {
    const args = process.argv.slice(2);

    if (args.includes('--fontes')) {
        await testarFontes();
        motor.encerrar();
        process.exit(0);
    }

    if (args.includes('--once')) {
        await ciclo();
        motor.encerrar();
        process.exit(0);
    }

    await ciclo();
    setInterval(() => {
        ciclo().catch((e) => log.erro('ciclo falhou:', e.message));
    }, INTERVALO_MS);
})();
'@

# ===========================================================================
#  scripts/atualizar-fontes.js
# ===========================================================================
$Arquivos['scripts/atualizar-fontes.js'] = @'
'use strict';

/*
 * CLI de diagnostico das fontes de indexacao.
 *
 *   node scripts/atualizar-fontes.js            -> testa todas as fontes
 *   node scripts/atualizar-fontes.js --limpar-cache
 *   node scripts/atualizar-fontes.js "termo"    -> busca real e mostra ranking
 */

const fontes = require('../src/sources');
const motor = require('../src/torrent/engine');
const { formatarBytes } = require('../src/util/text');

const CINZA = '\x1b[90m';
const VERDE = '\x1b[32m';
const AMARELO = '\x1b[33m';
const VERMELHO = '\x1b[31m';
const CIANO = '\x1b[36m';
const RESET = '\x1b[0m';

function linha() {
    console.log(CINZA + '-'.repeat(88) + RESET);
}

async function testarFontes() {
    console.log(CIANO + '\nTESTE DE SAUDE DAS FONTES DE INDEXACAO\n' + RESET);
    const relatorio = await fontes.statusFontes(true);

    for (const f of relatorio.fontes) {
        const marca = f.online ? VERDE + '[ONLINE]' + RESET : VERMELHO + '[OFFLINE]' + RESET;
        const teste = f.buscaTeste
            ? f.buscaTeste.ok
                ? VERDE + f.buscaTeste.total + ' resultados' + RESET
                : AMARELO + 'busca falhou: ' + f.buscaTeste.erro + RESET
            : CINZA + 'sem teste de busca' + RESET;

        console.log(marca + ' ' + f.nome.padEnd(26, ' ') + ' ' + CINZA + f.baseTestada.padEnd(36, ' ') + RESET + ' ' + teste);
        if (!f.online && f.erro) console.log('         ' + CINZA + f.erro + RESET);
    }

    console.log('\n' + CIANO + 'Resumo:' + RESET + ' ' + relatorio.online + '/' + relatorio.total + ' fontes respondendo\n');
}

async function buscar(termo) {
    console.log(CIANO + '\nBUSCA: "' + termo + '"\n' + RESET);
    const inicio = Date.now();
    const dados = await fontes.buscar(termo, { categoria: 'todos', apenasPtBr: false });

    console.log(CINZA + 'total: ' + dados.total + ' | tempo: ' + (Date.now() - inicio) + 'ms\n' + RESET);

    for (const f of dados.fontes) {
        const marca = f.ok ? VERDE + 'ok' + RESET : VERMELHO + 'falha' + RESET;
        console.log(' ' + marca + ' ' + f.nome.padEnd(24, ' ') + ' ' + String(f.total).padStart(3, ' ') + ' itens  ' + CINZA + f.ms + 'ms' + RESET);
    }

    linha();
    for (const item of dados.itens.slice(0, 25)) {
        const idioma = item.idioma.ptbr ? VERDE + item.idioma.rotulo.padEnd(11, ' ') + RESET : CINZA + 'Original   ' + RESET;
        console.log(
            idioma +
            ' ' + String(item.qualidade).padEnd(6, ' ') +
            ' ' + String(item.seeds).padStart(5, ' ') + ' seeds' +
            ' ' + formatarBytes(item.tamanhoBytes).padStart(9, ' ') +
            ' ' + CIANO + String(item.pontuacao).padStart(7, ' ') + RESET +
            '  ' + item.titulo.slice(0, 62)
        );
    }
    console.log('');
}

(async () => {
    const args = process.argv.slice(2);

    if (args.includes('--limpar-cache')) {
        await motor.limparTudo();
        console.log(VERDE + 'cache de torrents limpo.' + RESET);
        motor.encerrar();
        process.exit(0);
    }

    const termo = args.find((a) => !a.startsWith('--'));
    if (termo) await buscar(termo);
    else await testarFontes();

    motor.encerrar();
    process.exit(0);
})();
'@

# ===========================================================================
#  public/index.html
# ===========================================================================
$Arquivos['public/index.html'] = @'
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#0a0b0f" />
<title>CineP2P - Filmes, Séries, Animes, Doramas e Novelas</title>
<meta name="description" content="Streaming P2P de conteúdo em português: filmes, séries, animes, doramas, novelas e curtas via WebTorrent." />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/style.css" />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23ff2e63'/%3E%3Cpath d='M12 9l12 7-12 7z' fill='%23fff'/%3E%3C/svg%3E" />
</head>
<body>

<header class="topo">
  <div class="topo-linha">
    <a class="marca" href="/">CINE<span>P2P</span></a>

    <nav class="abas" id="abas" aria-label="Categorias"></nav>

    <div class="topo-acoes">
      <form class="busca" id="form-busca" role="search">
        <svg class="busca-icone" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2a8 8 0 105.3 14L21 21.7 22.4 20.3 16.7 14.6A8 8 0 0010 2zm0 2a6 6 0 110 12 6 6 0 010-12z"/></svg>
        <input id="campo-busca" type="search" placeholder="Buscar filme, série, anime, dorama, novela..." autocomplete="off" spellcheck="false" />
        <button type="submit">Buscar</button>
      </form>

      <select id="ordenacao" class="controle" title="Ordenar">
        <option value="seeds">Mais seeds</option>
        <option value="qualidade">Melhor qualidade</option>
        <option value="ptbr">Mais dublado</option>
        <option value="tamanho">Menor arquivo</option>
      </select>

      <button class="controle icone" id="btn-fontes" title="Status das fontes">Fontes</button>
      <button class="controle icone" id="btn-cache" title="Limpar cache de torrents">Cache</button>
    </div>
  </div>

  <div class="faixa-info" id="faixa-info" hidden></div>
</header>

<main class="conteudo">

  <section class="hero" id="hero" hidden>
    <div class="hero-fundo" id="hero-fundo"></div>
    <div class="hero-corpo">
      <span class="hero-etiqueta" id="hero-etiqueta">Destaque</span>
      <h1 id="hero-titulo"></h1>
      <p id="hero-sinopse"></p>
      <div class="hero-tags" id="hero-tags"></div>
      <div class="hero-acoes">
        <button class="btn primario" id="hero-play">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> Assistir agora
        </button>
        <button class="btn secundario" id="hero-favorito">+ Minha Lista</button>
      </div>
    </div>
  </section>

  <div class="trilho-controles">
    <h2 id="titulo-secao">Início</h2>
    <div class="chips" id="chips">
      <button class="chip ativo" data-ptbr="1">Só PT-BR</button>
      <button class="chip" data-ptbr="0">Todas as línguas</button>
      <button class="chip" id="chip-favoritos">Minha Lista</button>
    </div>
  </div>

  <section id="grade" class="grade"></section>
  <div class="vazio" id="vazio" hidden></div>

  <div class="paginacao" id="paginacao" hidden>
    <button class="btn secundario" id="pagina-anterior">Anterior</button>
    <span id="pagina-atual"></span>
    <button class="btn secundario" id="pagina-proxima">Próxima</button>
  </div>
</main>

<footer class="rodape">
  <span>CineP2P v3 - agregação multi-fonte PT-BR via WebTorrent + FFmpeg</span>
  <span id="rodape-fontes"></span>
</footer>

<!-- ====================== MODAL PLAYER ====================== -->
<div class="modal" id="modal" hidden>
  <div class="modal-caixa">
    <button class="fechar" id="btn-fechar" title="Fechar (Esc)">&times;</button>

    <div class="player-area">
      <video id="video" controls playsinline preload="metadata"></video>
      <div class="player-overlay" id="player-overlay">
        <div class="spinner"></div>
        <p id="overlay-texto">Conectando aos peers...</p>
      </div>
    </div>

    <div class="player-info">
      <div class="player-cabecalho">
        <h3 id="player-titulo">--</h3>
        <div class="player-badges" id="player-badges"></div>
      </div>

      <div class="medidor" id="medidor" hidden>
        <div class="medidor-barra"><span id="medidor-preenchido"></span></div>
        <div class="medidor-dados">
          <span id="medidor-peers">0 peers</span>
          <span id="medidor-velocidade">0 KB/s</span>
          <span id="medidor-progresso">0%</span>
        </div>
      </div>

      <div class="player-controles">
        <label class="campo">
          <span>Fonte</span>
          <select id="seletor-fonte"></select>
        </label>
        <label class="campo">
          <span>Modo</span>
          <select id="seletor-modo">
            <option value="auto">Automático</option>
            <option value="direto">Direto (sem conversão)</option>
            <option value="transcode">Converter (compatibilidade)</option>
          </select>
        </label>
        <button class="btn secundario" id="btn-magnet">Copiar magnet</button>
        <button class="btn secundario" id="btn-liberar">Liberar torrent</button>
      </div>

      <p class="player-nota" id="player-nota"></p>
      <p class="player-erro" id="player-erro" hidden></p>
    </div>
  </div>
</div>

<!-- ====================== MODAL FONTES ====================== -->
<div class="modal" id="modal-fontes" hidden>
  <div class="modal-caixa estreita">
    <button class="fechar" id="btn-fechar-fontes">&times;</button>
    <h3>Status dos indexadores</h3>
    <p class="nota">Verificação em tempo real das fontes PT-BR. Bases fora do ar são contornadas automaticamente pelo fallback de TLD.</p>
    <div id="lista-fontes" class="lista-fontes"></div>
    <button class="btn primario" id="btn-reverificar">Reverificar</button>
  </div>
</div>

<script src="/app.js"></script>
</body>
</html>
'@

# ===========================================================================
#  public/style.css
# ===========================================================================
$Arquivos['public/style.css'] = @'
/* =========================================================================
   cinep2p :: tema escuro inspirado em agregadores de streaming
   ========================================================================= */

:root {
    --fundo: #0a0b0f;
    --fundo-2: #101219;
    --fundo-3: #171a23;
    --borda: #232734;
    --texto: #eef0f6;
    --texto-fraco: #9aa1b4;
    --acento: #ff2e63;
    --acento-2: #6c5ce7;
    --verde: #22c55e;
    --amarelo: #facc15;
    --raio: 12px;
    --sombra: 0 18px 45px rgba(0, 0, 0, .55);
}

* { box-sizing: border-box; }

[hidden] { display: none !important; }

html, body {
    margin: 0;
    padding: 0;
    background: var(--fundo);
    color: var(--texto);
    font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
}

a { color: inherit; text-decoration: none; }
button, input, select { font-family: inherit; }

/* ---------------------------------- topo --------------------------------- */

.topo {
    position: sticky;
    top: 0;
    z-index: 40;
    background: linear-gradient(180deg, rgba(10, 11, 15, .98) 0%, rgba(10, 11, 15, .88) 100%);
    backdrop-filter: blur(14px);
    border-bottom: 1px solid var(--borda);
}

.topo-linha {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 12px 22px;
    flex-wrap: wrap;
}

.marca {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -.5px;
    white-space: nowrap;
}
.marca span { color: var(--acento); }

.abas {
    display: flex;
    gap: 4px;
    flex: 1;
    flex-wrap: wrap;
}

.aba {
    padding: 8px 14px;
    border-radius: 999px;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--texto-fraco);
    border: 1px solid transparent;
    cursor: pointer;
    background: transparent;
    transition: .15s;
}
.aba:hover { color: var(--texto); background: var(--fundo-3); }
.aba.ativo {
    color: #fff;
    background: linear-gradient(135deg, var(--acento), #b81f47);
    border-color: transparent;
    box-shadow: 0 6px 20px rgba(255, 46, 99, .28);
}

.topo-acoes { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.busca {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--fundo-3);
    border: 1px solid var(--borda);
    border-radius: 999px;
    padding: 6px 6px 6px 12px;
    min-width: 280px;
    transition: .15s;
}
.busca:focus-within { border-color: var(--acento); box-shadow: 0 0 0 3px rgba(255, 46, 99, .14); }
.busca-icone { width: 16px; height: 16px; fill: var(--texto-fraco); flex: none; }
.busca input {
    flex: 1;
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--texto);
    font-size: 14px;
    padding: 5px 0;
}
.busca button {
    border: 0;
    border-radius: 999px;
    padding: 8px 16px;
    background: var(--acento);
    color: #fff;
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
}
.busca button:hover { filter: brightness(1.1); }

.controle {
    background: var(--fundo-3);
    color: var(--texto);
    border: 1px solid var(--borda);
    border-radius: 10px;
    padding: 9px 12px;
    font-size: 13px;
    cursor: pointer;
}
.controle:hover { border-color: var(--acento); }
.controle.icone { font-weight: 600; }

.faixa-info {
    padding: 8px 22px;
    background: rgba(108, 92, 231, .14);
    border-top: 1px solid rgba(108, 92, 231, .3);
    color: #cfc8ff;
    font-size: 12.5px;
}

/* --------------------------------- hero ---------------------------------- */

.conteudo { max-width: 1520px; margin: 0 auto; padding: 22px; }

.hero {
    position: relative;
    border-radius: 18px;
    overflow: hidden;
    min-height: 340px;
    display: flex;
    align-items: flex-end;
    margin-bottom: 30px;
    border: 1px solid var(--borda);
    background: var(--fundo-2);
}
.hero-fundo {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center 22%;
    filter: saturate(1.1);
}
.hero-fundo::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, rgba(10, 11, 15, .97) 8%, rgba(10, 11, 15, .72) 45%, rgba(10, 11, 15, .25) 100%),
                linear-gradient(0deg, var(--fundo) 2%, transparent 60%);
}
.hero-corpo { position: relative; padding: 32px; max-width: 660px; }
.hero-etiqueta {
    display: inline-block;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    color: var(--acento);
    margin-bottom: 10px;
}
.hero h1 { margin: 0 0 10px; font-size: 38px; line-height: 1.08; font-weight: 800; letter-spacing: -.9px; }
.hero p { margin: 0 0 14px; color: var(--texto-fraco); font-size: 14.5px; line-height: 1.55; max-height: 88px; overflow: hidden; }
.hero-tags { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 16px; }
.hero-acoes { display: flex; gap: 10px; flex-wrap: wrap; }

/* ---------------------------------- chips -------------------------------- */

.trilho-controles {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 16px;
}
.trilho-controles h2 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -.4px; }
.chips { display: flex; gap: 7px; flex-wrap: wrap; }
.chip {
    background: var(--fundo-3);
    border: 1px solid var(--borda);
    color: var(--texto-fraco);
    border-radius: 999px;
    padding: 7px 14px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
}
.chip:hover { color: var(--texto); }
.chip.ativo { background: rgba(255, 46, 99, .16); border-color: var(--acento); color: #ffb3c6; }

/* ---------------------------------- grade -------------------------------- */

.grade {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
    gap: 18px;
}

.card {
    background: var(--fundo-2);
    border: 1px solid var(--borda);
    border-radius: var(--raio);
    overflow: hidden;
    cursor: pointer;
    transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
    display: flex;
    flex-direction: column;
    position: relative;
}
.card:hover { transform: translateY(-5px); border-color: rgba(255, 46, 99, .55); box-shadow: var(--sombra); }

.card-poster {
    position: relative;
    aspect-ratio: 2 / 3;
    background: linear-gradient(160deg, #191d28, #0d0f15);
    overflow: hidden;
}
.card-poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
.card-poster .sem-poster {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 30px;
    font-weight: 800;
    color: #2b3040;
}

.card-badges {
    position: absolute;
    top: 8px;
    left: 8px;
    right: 8px;
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
}

.selo {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .4px;
    text-transform: uppercase;
    padding: 3px 7px;
    border-radius: 6px;
    backdrop-filter: blur(6px);
    background: rgba(10, 11, 15, .78);
    border: 1px solid rgba(255, 255, 255, .14);
}
.selo.dublado { background: rgba(34, 197, 94, .9); border-color: transparent; color: #04220f; }
.selo.dual { background: rgba(108, 92, 231, .92); border-color: transparent; color: #fff; }
.selo.legendado { background: rgba(250, 204, 21, .9); border-color: transparent; color: #241c00; }
.selo.qualidade { background: rgba(255, 46, 99, .92); border-color: transparent; color: #fff; }

.card-seeds {
    position: absolute;
    bottom: 8px;
    right: 8px;
    font-size: 10.5px;
    font-weight: 700;
    padding: 3px 7px;
    border-radius: 6px;
    background: rgba(10, 11, 15, .8);
    color: var(--verde);
}

.card-corpo { padding: 10px 11px 12px; display: flex; flex-direction: column; gap: 5px; flex: 1; }
.card-titulo {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.32;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 34px;
}
.card-meta { font-size: 11px; color: var(--texto-fraco); display: flex; gap: 7px; flex-wrap: wrap; }
.card-fonte { font-size: 10.5px; color: #6f7689; }

.card-favorito {
    position: absolute;
    top: 7px;
    right: 7px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, .2);
    background: rgba(10, 11, 15, .72);
    color: #fff;
    font-size: 13px;
    cursor: pointer;
    display: grid;
    place-items: center;
    z-index: 3;
}
.card-favorito.ativo { background: var(--acento); border-color: transparent; }

/* --------------------------------- esqueletos ---------------------------- */

.esqueleto { pointer-events: none; }
.esqueleto .card-poster { animation: pulsar 1.35s infinite; }
.esqueleto .linha-falsa { height: 11px; border-radius: 5px; background: #1c202b; margin-top: 6px; }
@keyframes pulsar { 0%, 100% { opacity: 1 } 50% { opacity: .45 } }

/* ---------------------------------- botoes ------------------------------- */

.btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 0;
    border-radius: 10px;
    padding: 11px 18px;
    font-size: 13.5px;
    font-weight: 700;
    cursor: pointer;
    transition: .15s;
}
.btn svg { width: 17px; height: 17px; fill: currentColor; }
.btn.primario { background: var(--acento); color: #fff; }
.btn.primario:hover { filter: brightness(1.12); }
.btn.secundario { background: var(--fundo-3); color: var(--texto); border: 1px solid var(--borda); }
.btn.secundario:hover { border-color: var(--acento); }
.btn:disabled { opacity: .5; cursor: not-allowed; }

/* -------------------------------- paginacao ------------------------------ */

.paginacao { display: flex; align-items: center; justify-content: center; gap: 14px; padding: 34px 0; }
.paginacao span { color: var(--texto-fraco); font-size: 13px; }

.vazio { text-align: center; padding: 70px 20px; color: var(--texto-fraco); }
.vazio strong { display: block; font-size: 18px; color: var(--texto); margin-bottom: 8px; }

.rodape {
    border-top: 1px solid var(--borda);
    padding: 22px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    color: #626879;
    font-size: 12px;
}

/* ---------------------------------- modal -------------------------------- */

.modal {
    position: fixed;
    inset: 0;
    background: rgba(4, 5, 8, .9);
    backdrop-filter: blur(9px);
    z-index: 90;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    overflow: auto;
}

.modal-caixa {
    position: relative;
    width: min(1080px, 100%);
    background: var(--fundo-2);
    border: 1px solid var(--borda);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: var(--sombra);
}
.modal-caixa.estreita { width: min(620px, 100%); padding: 26px; }

.fechar {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 5;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, .18);
    background: rgba(10, 11, 15, .8);
    color: #fff;
    font-size: 19px;
    cursor: pointer;
    line-height: 1;
}

.player-area { position: relative; background: #000; aspect-ratio: 16 / 9; }
.player-area video { width: 100%; height: 100%; display: block; background: #000; }

.player-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: rgba(4, 5, 8, .82);
    color: var(--texto-fraco);
    font-size: 13.5px;
    text-align: center;
    padding: 20px;
}
.spinner {
    width: 38px;
    height: 38px;
    border: 3px solid rgba(255, 255, 255, .16);
    border-top-color: var(--acento);
    border-radius: 50%;
    animation: girar .8s linear infinite;
}
@keyframes girar { to { transform: rotate(360deg) } }

.player-info { padding: 18px 20px 22px; }
.player-cabecalho { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
.player-cabecalho h3 { margin: 0; font-size: 17px; font-weight: 700; line-height: 1.35; }
.player-badges { display: flex; gap: 6px; flex-wrap: wrap; }

.medidor { margin: 16px 0 4px; }
.medidor-barra { height: 6px; border-radius: 999px; background: var(--fundo-3); overflow: hidden; }
.medidor-barra span { display: block; height: 100%; width: 0%; background: linear-gradient(90deg, var(--acento-2), var(--acento)); transition: width .4s; }
.medidor-dados { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--texto-fraco); margin-top: 7px; }

.player-controles { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; align-items: flex-end; }
.campo { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; color: var(--texto-fraco); }
.campo select {
    background: var(--fundo-3);
    border: 1px solid var(--borda);
    color: var(--texto);
    border-radius: 9px;
    padding: 9px 11px;
    font-size: 12.5px;
    min-width: 190px;
}

.player-nota { margin: 14px 0 0; font-size: 12px; color: #6f7689; }
.player-erro { margin: 10px 0 0; font-size: 12.5px; color: #ff8fa3; }

.lista-fontes { display: flex; flex-direction: column; gap: 8px; margin: 16px 0; max-height: 52vh; overflow: auto; }
.linha-fonte {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--borda);
    border-radius: 10px;
    background: var(--fundo-3);
    font-size: 12.5px;
}
.ponto { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.ponto.ok { background: var(--verde); box-shadow: 0 0 10px var(--verde); }
.ponto.off { background: var(--acento); box-shadow: 0 0 10px var(--acento); }
.linha-fonte .nome { font-weight: 600; flex: 1; }
.linha-fonte .detalhe { color: var(--texto-fraco); font-size: 11.5px; }
.nota { color: var(--texto-fraco); font-size: 12.5px; line-height: 1.5; }

/* --------------------------------- mobile -------------------------------- */

@media (max-width: 860px) {
    .topo-linha { padding: 10px 14px; gap: 10px; }
    .abas { order: 3; width: 100%; overflow-x: auto; flex-wrap: nowrap; }
    .busca { min-width: 100%; order: 1; }
    .hero h1 { font-size: 27px; }
    .hero-corpo { padding: 20px; }
    .grade { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
    .conteudo { padding: 14px; }
}
'@

# ===========================================================================
#  public/app.js
# ===========================================================================
$Arquivos['public/app.js'] = @'
'use strict';

/* =========================================================================
   cinep2p :: front-end
   ========================================================================= */

const CATEGORIAS = [
    { id: 'inicio', rotulo: 'Início' },
    { id: 'filmes', rotulo: 'Filmes' },
    { id: 'series', rotulo: 'Séries' },
    { id: 'animes', rotulo: 'Animes' },
    { id: 'doramas', rotulo: 'Doramas' },
    { id: 'novelas', rotulo: 'Novelas' },
    { id: 'curtas', rotulo: 'Curtas' },
    { id: 'documentarios', rotulo: 'Documentários' }
];

const estado = {
    categoria: 'inicio',
    termo: '',
    pagina: 1,
    ptbr: true,
    ordenacao: 'seeds',
    modo: 'catalogo',
    itens: [],
    carregando: false,
    favoritos: new Set(),
    player: null
};

const $ = (id) => document.getElementById(id);

/* ------------------------------- utilitarios ------------------------------ */

function formatarBytes(bytes) {
    const n = Number(bytes) || 0;
    if (!n) return '--';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}

function escapar(texto) {
    return String(texto == null ? '' : texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function urlPoster(item) {
    if (!item.poster) return null;
    return '/api/img?u=' + encodeURIComponent(item.poster) + (item.base ? '&ref=' + encodeURIComponent(item.base) : '');
}

function selos(item) {
    const selos = [];
    const idioma = item.idioma || {};
    if (idioma.dublado) selos.push('<span class="selo dublado">Dublado</span>');
    else if (idioma.dual) selos.push('<span class="selo dual">Dual Áudio</span>');
    else if (idioma.legendado) selos.push('<span class="selo legendado">Legendado</span>');
    if (item.qualidade && item.qualidade !== 'SD') selos.push('<span class="selo qualidade">' + escapar(item.qualidade) + '</span>');
    if (item.ano) selos.push('<span class="selo">' + escapar(item.ano) + '</span>');
    return selos.join('');
}

function toast(mensagem) {
    const faixa = $('faixa-info');
    faixa.textContent = mensagem;
    faixa.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { faixa.hidden = true; }, 4200);
}

function salvarFavoritos() {
    try {
        localStorage.setItem('cinep2p:favoritos', JSON.stringify([...estado.favoritos]));
    } catch (_) { /* noop */ }
}

function carregarFavoritos() {
    try {
        const bruto = JSON.parse(localStorage.getItem('cinep2p:favoritos') || '[]');
        estado.favoritos = new Set(bruto);
    } catch (_) { estado.favoritos = new Set(); }
}

function chaveItem(item) {
    return item.infoHash || item.titulo;
}

/* --------------------------------- render -------------------------------- */

function montarAbas() {
    const container = $('abas');
    container.innerHTML = CATEGORIAS
        .map((c) => '<button class="aba' + (c.id === estado.categoria ? ' ativo' : '') + '" data-cat="' + c.id + '">' + c.rotulo + '</button>')
        .join('');

    container.querySelectorAll('.aba').forEach((botao) => {
        botao.addEventListener('click', () => {
            estado.categoria = botao.dataset.cat;
            estado.modo = 'catalogo';
            estado.termo = '';
            estado.pagina = 1;
            $('campo-busca').value = '';
            montarAbas();
            carregar();
        });
    });
}

function esqueletos(quantidade) {
    return new Array(quantidade).fill(0).map(() =>
        '<div class="card esqueleto"><div class="card-poster"></div><div class="card-corpo"><div class="linha-falsa" style="width:80%"></div><div class="linha-falsa" style="width:45%"></div></div></div>'
    ).join('');
}

function ordenar(itens) {
    const lista = itens.slice();
    switch (estado.ordenacao) {
        case 'qualidade':
            lista.sort((a, b) => (b.qualidade || '').localeCompare(a.qualidade || '') || b.seeds - a.seeds);
            break;
        case 'ptbr':
            lista.sort((a, b) => (b.idioma && b.idioma.pontos ? b.idioma.pontos : 0) - (a.idioma && a.idioma.pontos ? a.idioma.pontos : 0));
            break;
        case 'tamanho':
            lista.sort((a, b) => (a.tamanhoBytes || 1e15) - (b.tamanhoBytes || 1e15));
            break;
        default:
            lista.sort((a, b) => (b.seeds || 0) - (a.seeds || 0));
    }
    return lista;
}

function cardHtml(item) {
    const poster = urlPoster(item);
    const fav = estado.favoritos.has(chaveItem(item));
    return '' +
        '<article class="card" data-hash="' + escapar(item.infoHash || '') + '" data-titulo="' + escapar(item.titulo) + '">' +
            '<button class="card-favorito' + (fav ? ' ativo' : '') + '" title="Minha Lista">' + (fav ? '★' : '☆') + '</button>' +
            '<div class="card-poster">' +
                (poster ? '<img loading="lazy" src="' + poster + '" alt="" onerror="this.style.display=\'none\'" />' : '') +
                '<div class="sem-poster">' + escapar((item.titulo || '?').charAt(0).toUpperCase()) + '</div>' +
                '<div class="card-badges">' + selos(item) + '</div>' +
                '<span class="card-seeds">' + (item.seeds || 0) + ' seeds</span>' +
            '</div>' +
            '<div class="card-corpo">' +
                '<div class="card-titulo">' + escapar(item.titulo) + '</div>' +
                '<div class="card-meta"><span>' + escapar(item.categoria || '') + '</span><span>' + formatarBytes(item.tamanhoBytes) + '</span></div>' +
                '<div class="card-fonte">' + escapar(item.fonteNome || '') + '</div>' +
            '</div>' +
        '</article>';
}

function renderizar() {
    const grade = $('grade');
    const vazio = $('vazio');
    const itens = ordenar(estado.itens);

    if (!itens.length) {
        grade.innerHTML = '';
        vazio.hidden = false;
        vazio.innerHTML = '<strong>Nada encontrado</strong>Tente outro termo, remova o filtro "Só PT-BR" ou mude a categoria.';
        return;
    }

    vazio.hidden = true;
    grade.innerHTML = itens.map(cardHtml).join('');

    grade.querySelectorAll('.card').forEach((el) => {
        el.addEventListener('click', (ev) => {
            if (ev.target.closest('.card-favorito')) return;
            const hash = el.dataset.hash;
            const item = estado.itens.find((i) => (i.infoHash || '') === hash && i.titulo === el.dataset.titulo)
                || estado.itens.find((i) => i.titulo === el.dataset.titulo);
            if (item) abrirPlayer(item);
        });
    });

    grade.querySelectorAll('.card-favorito').forEach((botao) => {
        botao.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const card = botao.closest('.card');
            const item = estado.itens.find((i) => i.titulo === card.dataset.titulo);
            if (!item) return;
            const chave = chaveItem(item);
            if (estado.favoritos.has(chave)) estado.favoritos.delete(chave);
            else estado.favoritos.add(chave);
            salvarFavoritos();
            botao.classList.toggle('ativo');
            botao.textContent = estado.favoritos.has(chave) ? '★' : '☆';
        });
    });

    renderizarHero(itens[0]);
}

function renderizarHero(item) {
    const hero = $('hero');
    if (!item) { hero.hidden = true; return; }

    hero.hidden = false;
    const poster = urlPoster(item);
    $('hero-fundo').style.backgroundImage = poster ? 'url("' + poster + '")' : 'none';
    $('hero-etiqueta').textContent = (item.idioma && item.idioma.rotulo) || 'Destaque';
    $('hero-titulo').textContent = item.titulo;
    $('hero-sinopse').textContent = item.sinopse || 'Sem sinopse disponível. ' + (item.seeds || 0) + ' seeds ativos na rede.';
    $('hero-tags').innerHTML = selos(item) + '<span class="selo">' + formatarBytes(item.tamanhoBytes) + '</span>';

    $('hero-play').onclick = () => abrirPlayer(item);
    $('hero-favorito').onclick = () => {
        const chave = chaveItem(item);
        if (estado.favoritos.has(chave)) estado.favoritos.delete(chave);
        else estado.favoritos.add(chave);
        salvarFavoritos();
        toast(estado.favoritos.has(chave) ? 'Adicionado à Minha Lista' : 'Removido da Minha Lista');
        renderizar();
    };
}

function atualizarPaginacao(dados) {
    const pag = $('paginacao');
    if (!dados || dados.totalPaginas <= 1) { pag.hidden = true; return; }
    pag.hidden = false;
    $('pagina-atual').textContent = 'Página ' + dados.pagina + ' de ' + dados.totalPaginas + ' (' + dados.total + ' itens)';
    $('pagina-anterior').disabled = dados.pagina <= 1;
    $('pagina-proxima').disabled = dados.pagina >= dados.totalPaginas;
}

/* --------------------------------- cargas -------------------------------- */

async function carregar() {
    if (estado.carregando) return;
    estado.carregando = true;

    const titulo = CATEGORIAS.find((c) => c.id === estado.categoria);
    $('titulo-secao').textContent = estado.termo
        ? 'Resultados para "' + estado.termo + '"'
        : titulo ? titulo.rotulo : 'Início';

    if (estado.categoria === 'favoritos') {
        estado.itens = [...estado.favoritos].map((chave) => {
            const encontrado = estado.itens.find((i) => chaveItem(i) === chave);
            return encontrado || { titulo: chave, infoHash: chave.length === 40 ? chave : null, seeds: 0 };
        });
        renderizar();
        estado.carregando = false;
        return;
    }

    $('grade').innerHTML = esqueletos(12);

    try {
        const parametros = new URLSearchParams({ pagina: String(estado.pagina), porPagina: '60' });
        let url;

        if (estado.termo) {
            parametros.set('q', estado.termo);
            parametros.set('categoria', estado.categoria === 'inicio' ? 'todos' : estado.categoria);
            parametros.set('ptbr', estado.ptbr ? '1' : '0');
            url = '/api/buscar?' + parametros.toString();
        } else {
            parametros.set('categoria', estado.categoria);
            url = '/api/catalogo?' + parametros.toString();
        }

        const resposta = await fetch(url);
        const dados = await resposta.json();

        estado.itens = dados.itens || [];
        renderizar();
        atualizarPaginacao(dados);

        if (estado.termo && dados.fontes) {
            const ok = dados.fontes.filter((f) => f.ok).length;
            $('rodape-fontes').textContent = ok + '/' + dados.fontes.length + ' indexadores responderam';
            if (!estado.itens.length && ok === 0) {
                toast('Nenhuma fonte respondeu. Verifique sua conexão ou clique em "Fontes".');
            }
        }

        if (!estado.termo) {
            const atualizado = dados.atualizadoEm ? new Date(dados.atualizadoEm).toLocaleString('pt-BR') : 'nunca';
            $('rodape-fontes').textContent = 'catálogo aquecido: ' + atualizado;
        }
    } catch (erro) {
        toast('Erro ao carregar: ' + erro.message);
        $('grade').innerHTML = '';
    } finally {
        estado.carregando = false;
    }
}

/* --------------------------------- player -------------------------------- */

async function abrirPlayer(item) {
    const modal = $('modal');
    const video = $('video');

    estado.player = { item, modo: null, infoHash: null, indice: null, polling: null, transcode: false, alvoSeek: 0 };

    modal.hidden = false;
    document.body.style.overflow = 'hidden';

    video.pause();
    video.removeAttribute('src');
    video.load();

    $('player-titulo').textContent = item.titulo;
    $('player-badges').innerHTML = selos(item);
    $('player-erro').hidden = true;
    $('player-nota').textContent = 'Fonte: ' + (item.fonteNome || 'desconhecida') + ' | ' + (item.seeds || 0) + ' seeds | ' + formatarBytes(item.tamanhoBytes);
    $('seletor-fonte').innerHTML = '<option value="' + escapar(item.infoHash || item.magnet || '') + '">' + escapar(item.fonteNome + ' - ' + item.qualidade) + '</option>';

    if (!item.infoHash && !item.magnet) {
        mostrarErro('Este item não expõe magnet direto. Abra o link da fonte original.');
        return;
    }

    overlay('Buscando metadados do torrent...', true);
    $('medidor').hidden = false;

    try {
        const referencia = encodeURIComponent(item.infoHash || item.magnet);
        const resposta = await fetch('/api/torrent/' + referencia);

        if (!resposta.ok) {
            const erro = await resposta.json().catch(() => ({ erro: 'falha ao abrir torrent' }));
            throw new Error(erro.erro || 'falha ao abrir torrent');
        }

        const meta = await resposta.json();
        estado.player.infoHash = meta.infoHash;
        estado.player.indice = meta.indice;

        $('seletor-fonte').innerHTML = (meta.arquivos || [])
            .filter((a) => a.video)
            .map((a) => '<option value="' + a.indice + '"' + (a.indice === meta.indice ? ' selected' : '') + '>' + escapar(a.nome.slice(0, 70)) + ' (' + formatarBytes(a.tamanho) + ')</option>')
            .join('') || '<option value="' + meta.indice + '">' + escapar(meta.arquivo) + '</option>';

        $('player-nota').textContent = 'Modo: ' + meta.modo + ' (' + (meta.motivo || '') + ') | ' + meta.nome;
        iniciarReproducao(meta.modo === 'direto' ? 'direto' : 'transcode');
    } catch (erro) {
        mostrarErro(erro.message);
        overlay('Falha: ' + erro.message, false);
    }
}

function overlay(texto, girando) {
    const el = $('player-overlay');
    el.hidden = false;
    el.querySelector('.spinner').style.display = girando ? 'block' : 'none';
    $('overlay-texto').textContent = texto;
}

function mostrarErro(mensagem) {
    const el = $('player-erro');
    el.hidden = false;
    el.textContent = mensagem;
}

function iniciarReproducao(modo) {
    const video = $('video');
    const player = estado.player;
    if (!player || !player.infoHash) return;

    player.modo = modo;
    player.transcode = modo !== 'direto';

    const base = player.transcode
        ? '/transcode/' + player.infoHash + '/' + player.indice
        : '/stream/' + player.infoHash + '/' + player.indice;

    video.src = player.transcode && player.alvoSeek ? base + '?t=' + Math.floor(player.alvoSeek) : base;

    overlay('Conectando aos peers...', true);

    video.onloadedmetadata = () => {
        if (player.transcode && player.alvoSeek) {
            try { video.currentTime = Math.max(0, player.alvoSeek - Math.floor(player.alvoSeek)); } catch (_) { /* noop */ }
            player.alvoSeek = 0;
        }
    };

    video.oncanplay = () => { $('player-overlay').hidden = true; };

    video.onerror = () => {
        if (player.modo === 'direto') {
            overlay('Container incompatível, convertendo...', true);
            iniciarReproducao('transcode');
            return;
        }
        mostrarErro('Não foi possível reproduzir. Tente outro arquivo ou outra fonte.');
        overlay('Erro na reprodução.', false);
    };

    video.onwaiting = () => overlay('Armazenando buffer...', true);
    video.onplaying = () => { $('player-overlay').hidden = true; };

    video.onseeked = () => {
        if (player.transcode && player.alvoSeek) {
            const alvo = Math.floor(player.alvoSeek);
            player.alvoSeek = 0;
            video.src = '/transcode/' + player.infoHash + '/' + player.indice + '?t=' + alvo;
            overlay('Buscando ' + new Date(alvo * 1000).toISOString().substr(11, 8) + '...', true);
        }
    };

    const promessa = video.play();
    if (promessa && promessa.catch) promessa.catch(() => { /* autoplay bloqueado */ });

    iniciarPolling();
}

function iniciarPolling() {
    pararPolling();
    const player = estado.player;
    if (!player) return;

    player.polling = setInterval(async () => {
        try {
            const r = await fetch('/api/status/' + player.infoHash);
            if (!r.ok) return;
            const s = await r.json();

            $('medidor-preenchido').style.width = Math.min(100, s.progresso || 0) + '%';
            $('medidor-peers').textContent = (s.peers || 0) + ' peers';
            $('medidor-velocidade').textContent = formatarBytes(s.velocidadeDown) + '/s';
            $('medidor-progresso').textContent = (s.progresso || 0).toFixed(1) + '%';

            if (!s.peers && s.progresso < 5) {
                overlay('Procurando peers... (o magnet pode estar lento)', true);
            }
        } catch (_) { /* noop */ }
    }, 1500);
}

function pararPolling() {
    if (estado.player && estado.player.polling) clearInterval(estado.player.polling);
}

function fecharPlayer() {
    const video = $('video');
    pararPolling();
    try { video.pause(); } catch (_) { /* noop */ }
    video.removeAttribute('src');
    video.load();
    $('modal').hidden = true;
    document.body.style.overflow = '';
    estado.player = null;
}

/* ---------------------------------- fontes -------------------------------- */

async function abrirFontes(forcar) {
    $('modal-fontes').hidden = false;
    $('lista-fontes').innerHTML = '<p class="nota">Verificando...</p>';

    try {
        const r = await fetch('/api/fontes' + (forcar ? '?forcar=1' : ''));
        const dados = await r.json();

        $('lista-fontes').innerHTML = (dados.fontes || []).map((f) =>
            '<div class="linha-fonte">' +
                '<span class="ponto ' + (f.online ? 'ok' : 'off') + '"></span>' +
                '<span class="nome">' + escapar(f.nome) + '</span>' +
                '<span class="detalhe">' + (f.online ? (f.ms + 'ms') : 'offline') +
                (f.buscaTeste && f.buscaTeste.ok ? ' | ' + f.buscaTeste.total + ' resultados' : '') +
                '</span>' +
            '</div>'
        ).join('') || '<p class="nota">Sem fontes ativas.</p>';
    } catch (erro) {
        $('lista-fontes').innerHTML = '<p class="nota">Erro: ' + escapar(erro.message) + '</p>';
    }
}

/* --------------------------------- eventos -------------------------------- */

function ligarEventos() {
    $('form-busca').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const termo = $('campo-busca').value.trim();
        estado.termo = termo;
        estado.modo = termo ? 'busca' : 'catalogo';
        estado.pagina = 1;
        if (termo) estado.categoria = estado.categoria === 'inicio' ? 'inicio' : estado.categoria;
        carregar();
    });

    $('campo-busca').addEventListener('input', (ev) => {
        if (!ev.target.value.trim() && estado.termo) {
            estado.termo = '';
            estado.pagina = 1;
            carregar();
        }
    });

    $('ordenacao').addEventListener('change', (ev) => {
        estado.ordenacao = ev.target.value;
        renderizar();
    });

    document.querySelectorAll('.chip[data-ptbr]').forEach((chip) => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.chip[data-ptbr]').forEach((c) => c.classList.remove('ativo'));
            chip.classList.add('ativo');
            estado.ptbr = chip.dataset.ptbr === '1';
            estado.pagina = 1;
            if (estado.termo) carregar();
        });
    });

    $('chip-favoritos').addEventListener('click', () => {
        estado.categoria = estado.categoria === 'favoritos' ? 'inicio' : 'favoritos';
        $('chip-favoritos').classList.toggle('ativo');
        montarAbas();
        carregar();
    });

    $('pagina-anterior').addEventListener('click', () => { if (estado.pagina > 1) { estado.pagina--; carregar(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
    $('pagina-proxima').addEventListener('click', () => { estado.pagina++; carregar(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

    $('btn-fontes').addEventListener('click', () => abrirFontes(false));
    $('btn-reverificar').addEventListener('click', () => abrirFontes(true));
    $('btn-fechar-fontes').addEventListener('click', () => { $('modal-fontes').hidden = true; });

    $('btn-cache').addEventListener('click', async () => {
        const r = await fetch('/api/cache', { method: 'DELETE' });
        toast(r.ok ? 'Cache de torrents liberado.' : 'Falha ao limpar cache.');
    });

    $('btn-fechar').addEventListener('click', fecharPlayer);
    $('modal').addEventListener('click', (ev) => { if (ev.target === $('modal')) fecharPlayer(); });
    $('modal-fontes').addEventListener('click', (ev) => { if (ev.target === $('modal-fontes')) $('modal-fontes').hidden = true; });

    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            if (!$('modal').hidden) fecharPlayer();
            if (!$('modal-fontes').hidden) $('modal-fontes').hidden = true;
        }
    });

    $('seletor-fonte').addEventListener('change', (ev) => {
        if (!estado.player) return;
        estado.player.indice = Number(ev.target.value);
        estado.player.alvoSeek = 0;
        iniciarReproducao(estado.player.transcode ? 'transcode' : 'direto');
    });

    $('seletor-modo').addEventListener('change', (ev) => {
        if (!estado.player) return;
        estado.player.alvoSeek = 0;
        iniciarReproducao(ev.target.value === 'transcode' ? 'transcode' : 'direto');
    });

    $('btn-magnet').addEventListener('click', async () => {
        const item = estado.player && estado.player.item;
        if (!item) return;
        const magnet = item.magnet || ('magnet:?xt=urn:btih:' + item.infoHash);
        try {
            await navigator.clipboard.writeText(magnet);
            toast('Magnet copiado.');
        } catch (_) {
            window.prompt('Magnet:', magnet);
        }
    });

    $('btn-liberar').addEventListener('click', async () => {
        const player = estado.player;
        if (!player || !player.infoHash) return;
        await fetch('/api/cache?infoHash=' + player.infoHash, { method: 'DELETE' });
        toast('Torrent liberado da memória e do disco.');
        fecharPlayer();
    });
}

/* ---------------------------------- inicio -------------------------------- */

(async function iniciar() {
    carregarFavoritos();
    montarAbas();
    ligarEventos();
    await carregar();

    setInterval(() => {
        if (!estado.termo && estado.pagina === 1 && !estado.carregando && $('modal').hidden) carregar();
    }, 5 * 60 * 1000);
})();
'@

# ===========================================================================
#  README-PTBR.md
# ===========================================================================
# ===========================================================================
#  README-PTBR.md  - gerado por array de linhas (imune a falha de here-string)
# ===========================================================================
Escrever-Cabecalho 'GERANDO README-PTBR.md'

# Se a entrada antiga do README ainda existir em $Arquivos, remove
if ($Arquivos.Contains('README-PTBR.md')) { $Arquivos.Remove('README-PTBR.md') }

$linhasReadme = @(
    '# cinep2p v3 - Agregador P2P PT-BR'
    ''
    'Nucleo reescrito para priorizar **audio dublado, dual audio e legendas PT-BR**, cobrindo'
    'Filmes, Series, Animes, Doramas, Novelas, Curtas e Documentarios.'
    ''
    '## Fluxo'
    ''
    '```'
    'catalogo -> busca multi-fonte -> score de estabilidade -> magnet'
    '        -> WebTorrent (stream sequencial) -> remux/transcode FFmpeg -> player browser'
    '```'
    ''
    '## Como rodar'
    ''
    '```'
    'npm install'
    'npm start            # http://localhost:3000'
    'npm run worker       # daemon de aquecimento do catalogo (6h)'
    'npm run aquecer      # um unico ciclo de aquecimento'
    'npm run fontes       # diagnostico de saude dos indexadores'
    '```'
    ''
    '## Endpoints'
    ''
    '| Metodo | Rota | Descricao |'
    '|---|---|---|'
    '| GET | `/api/saude` | estado do processo, cache e binarios |'
    '| GET | `/api/fontes` | saude de cada indexador (com teste de busca real) |'
    '| GET | `/api/categorias` | categorias disponiveis |'
    '| GET | `/api/buscar?q=&categoria=&pagina=&ptbr=` | busca agregada e ranqueada |'
    '| GET | `/api/catalogo?categoria=&pagina=` | catalogo pre-aquecido |'
    '| GET | `/api/torrent/:infoHash` | metadados, lista de arquivos, plano de reproducao |'
    '| GET | `/api/status/:infoHash` | peers, velocidade, progresso |'
    '| GET | `/stream/:infoHash/:indice` | streaming direto com `Range` / HTTP 206 |'
    '| GET | `/transcode/:infoHash/:indice?t=` | remux/transcode FFmpeg para fMP4 |'
    '| GET | `/api/img?u=&ref=` | proxy de poster (contorna hotlink bloqueado) |'
    '| DELETE | `/api/cache` | limpa LRU (`?infoHash=` remove um so) |'
    ''
    '## Fontes de indexacao'
    ''
    'HTML: Comando Torrents, Torrent dos Filmes, BluDV, BJ-Share, Rede Torrent,'
    'AnimesTorrent, Anime Torrents, Doramas Torrent, Novelas Torrent.'
    'API JSON: The Pirate Bay (apibay), YTS.'
    ''
    'Cada fonte declara multiplas bases; o motor tenta em cascata ate obter resultados,'
    'o que absorve a troca frequente de TLD dos sites brasileiros.'
    ''
    '## Score de estabilidade'
    ''
    '```'
    'pontos = min(seeds, 600) * 0.35'
    '       + bonus de idioma   (dublado 62 / dual 50 / legendado 26 / nacional 14 / original -22)'
    '       + bonus de qualidade (2160p 22 / 1080p 15 / 720p 11 / 480p 5)'
    '       + confiabilidade da fonte * 0.3'
    '       + sanidade de tamanho'
    '```'
    ''
    '## Armazenamento'
    ''
    '- Maximo de torrents ativos simultaneos (`CINE_MAX_TORRENTS`, padrao 3).'
    '- Limpeza por ociosidade (`CINE_IDLE_MIN`, padrao 12 min).'
    '- Teto de disco com despejo LRU (`CINE_MAX_CACHE_GB`, padrao 25 GB).'
    '- Selecao sequencial de pecas: apenas o arquivo em reproducao e priorizado.'
    ''
    '## Compatibilidade de midia'
    ''
    '- **direto**: MP4/MOV/WebM com H.264/VP8/VP9/AV1 + AAC/MP3/Opus -> `Range` 206.'
    '- **remux**: MKV com codecs de video suportados -> fMP4 sem reencodar video.'
    '- **transcode**: codecs legados (XviD/MPEG-4) -> H.264 ultrafast.'
    ''
    '## Aviso'
    ''
    'Os arquivos sao servidos por torrents de terceiros. Seeders oscilam; se um magnet'
    'estiver lento, troque a fonte no player ou escolha outra qualidade.'
)

$caminhoReadme = Join-Path $Raiz 'README-PTBR.md'
if ((Test-Path -LiteralPath $caminhoReadme) -and -not $SemBackup) {
    $bkpReadme = Join-Path $script:PastaBackup 'README-PTBR.md'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $bkpReadme) | Out-Null
    Copy-Item -LiteralPath $caminhoReadme -Destination $bkpReadme -Force
}
$utf8Readme = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($caminhoReadme, (($linhasReadme -join "`n") + "`n"), $utf8Readme)
Escrever-Ok 'gravado  README-PTBR.md'

# ---------------------------------------------------------------------------
# Gravacao dos demais arquivos do nucleo
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Gravacao dos demais arquivos do nucleo
# ---------------------------------------------------------------------------
Escrever-Cabecalho 'GRAVANDO ARQUIVOS DO NUCLEO'

foreach ($relativo in $Arquivos.Keys) {
    $destino = Join-Path $Raiz $relativo
    $pasta   = Split-Path -Parent $destino

    if ($pasta -and -not (Test-Path -LiteralPath $pasta)) {
        New-Item -ItemType Directory -Force -Path $pasta | Out-Null
    }

    if ((Test-Path -LiteralPath $destino) -and -not $SemBackup) {
        $destinoBackup = Join-Path $script:PastaBackup $relativo
        $dirBackup     = Split-Path -Parent $destinoBackup
        if (-not (Test-Path -LiteralPath $dirBackup)) {
            New-Item -ItemType Directory -Force -Path $dirBackup | Out-Null
        }
        Copy-Item -LiteralPath $destino -Destination $destinoBackup -Force
    }

    $conteudo = $Arquivos[$relativo]
    if (-not $ManterCRLF) {
        $conteudo = $conteudo -replace "`r`n", "`n"
    }

    $utf8SemBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($destino, $conteudo, $utf8SemBom)

    $script:TotalGravado++
    Escrever-Ok ("gravado  {0,-34} {1,7} bytes" -f $relativo, $conteudo.Length)
}

# ---------------------------------------------------------------------------
# Pastas de runtime
# ---------------------------------------------------------------------------
Escrever-Cabecalho 'PREPARANDO PASTAS DE RUNTIME'

foreach ($pasta in @('.cache', '.cache\torrents', 'public', 'src\sources', 'src\routes', 'src\torrent', 'src\util', 'scripts')) {
    $caminho = Join-Path $Raiz $pasta
    if (-not (Test-Path -LiteralPath $caminho)) {
        New-Item -ItemType Directory -Force -Path $caminho | Out-Null
        Escrever-Info ("criada: " + $pasta)
    }
}

# ---------------------------------------------------------------------------
# npm install
# ---------------------------------------------------------------------------
if (-not $SemNpm) {
    Escrever-Cabecalho 'INSTALANDO DEPENDENCIAS (npm install)'

    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        Escrever-Aviso 'npm nao encontrado no PATH. Rode "npm install" manualmente.'
    } else {
        Push-Location $Raiz
        try {
            & npm install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) {
                Escrever-Aviso ("npm install retornou codigo " + $LASTEXITCODE)
            } else {
                Escrever-Ok 'dependencias instaladas'
            }
        } finally {
            Pop-Location
        }
    }
} else {
    Escrever-Aviso 'npm install ignorado (-SemNpm)'
}

# ---------------------------------------------------------------------------
# Verificacao de sintaxe
# ---------------------------------------------------------------------------
Escrever-Cabecalho 'VERIFICANDO SINTAXE DOS ARQUIVOS GERADOS'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Escrever-Aviso 'node nao encontrado. Pule a verificacao.'
} else {
    $jsParaChecar = @(
        'server.js', 'worker.js',
        'src\config.js', 'src\catalogo.js',
        'src\util\logger.js', 'src\util\magnet.js', 'src\util\http.js',
        'src\util\text.js', 'src\util\pool.js', 'src\util\ffmpeg.js',
        'src\sources\generic.js', 'src\sources\sites.js', 'src\sources\index.js',
        'src\torrent\engine.js', 'src\routes\api.js',
        'public\app.js', 'scripts\atualizar-fontes.js'
    )

    $falhas = 0
    foreach ($relativo in $jsParaChecar) {
        $caminho = Join-Path $Raiz $relativo
        if (-not (Test-Path -LiteralPath $caminho)) { continue }
        & node --check $caminho 2>$null
        if ($LASTEXITCODE -eq 0) {
            Escrever-Ok ("sintaxe ok: " + $relativo)
        } else {
            $falhas++
            Escrever-Erro ("erro de sintaxe em: " + $relativo)
        }
    }

    if ($falhas -eq 0) { Escrever-Ok 'todos os arquivos JS passaram no node --check' }
}

# ---------------------------------------------------------------------------
# Resumo
# ---------------------------------------------------------------------------
Escrever-Cabecalho 'CONCLUIDO'

Write-Host ''
Write-Host ("  arquivos gravados : " + $script:TotalGravado) -ForegroundColor White
if (-not $SemBackup) {
    Write-Host ("  backup em         : " + $script:PastaBackup) -ForegroundColor Gray
}
Write-Host ''
Write-Host '  Proximos passos:' -ForegroundColor Cyan
Write-Host '    1) npm run fontes        -> valida quais indexadores respondem' -ForegroundColor Gray
Write-Host '    2) npm run aquecer       -> popula o catalogo (filmes/series/animes/doramas/novelas)' -ForegroundColor Gray
Write-Host '    3) npm start             -> sobe o servidor em http://localhost:3000' -ForegroundColor Gray
Write-Host '    4) npm run worker        -> daemon opcional de atualizacao continua' -ForegroundColor Gray
Write-Host ''
Write-Host '  Variaveis uteis (.env ou shell):' -ForegroundColor Cyan
Write-Host '    CINE_MAX_TORRENTS=3   CINE_IDLE_MIN=12   CINE_MAX_CACHE_GB=25' -ForegroundColor Gray
Write-Host '    CINE_APENAS_PTBR=true CINE_FONTES_OFF=bludv,yts' -ForegroundColor Gray
Write-Host ''
Write-Host ('-' * 78) -ForegroundColor DarkGray
Write-Host '  COMMIT SUGERIDO' -ForegroundColor Yellow
Write-Host ('-' * 78) -ForegroundColor DarkGray
Write-Host ''
Write-Host '  git add -A'
Write-Host '  git commit -m "feat(core): reconstroi motor de scraping e catalogo focado em PT-BR"'
Write-Host ''