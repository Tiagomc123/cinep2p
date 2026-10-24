<#
    CineP2P 4.0 - PT-BR RIGOROSO + Player imediato (30s / legendas) + concorrencia total
    -----------------------------------------------------------------------------------
    Executa SOBRE a versao anterior (CineP2P 3.0).

    Novidades desta rodada:
      * Classificador rigoroso de audio brasileiro (antidublagem estrangeira)
      * Registro de confianca por fonte (trackers nacionais = PT-BR nativo)
      * 3 scrapers nacionais novos (RedeTorrent, BluDV, TorrentDosFilmes)
      * Selecao automatica do melhor magnet PT-BR (sem modal intermediario)
      * Player abre IMEDIATAMENTE e carrega tudo dentro da area do video
      * Controles: +/-30s, seek, volume, fullscreen e seletor de LEGENDAS
      * Legendas: arquivos do proprio torrent (.srt/.ass/.vtt) convertidos p/ VTT
      * Limpeza absoluta de disco mantida (cache/<jobId> destruido ao sair)

    Uso:  powershell -ExecutionPolicy Bypass -File .\atualizar.ps1
    Flags: -SkipInstall  -Root <pasta>
#>
[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [string]$Root
)

# ----------------------------------------------------------------------
if ($PSVersionTable.PSVersion.Major -le 5 -and -not $env:CINEP2P_UTF8) {
    try {
        $selfPath = $MyInvocation.MyCommand.Path
        if ($selfPath -and (Test-Path -LiteralPath $selfPath)) {
            $raw = [System.IO.File]::ReadAllBytes($selfPath)
            $hasBom = ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF)
            $hasNonAscii = $false
            foreach ($b in $raw) { if ($b -gt 127) { $hasNonAscii = $true; break } }
            if (-not $hasBom -and $hasNonAscii) {
                $text = [System.Text.Encoding]::UTF8.GetString($raw)
                $tmp = Join-Path $env:TEMP ('cinep2p-' + [guid]::NewGuid().ToString('N') + '.ps1')
                [System.IO.File]::WriteAllText($tmp, $text, [System.Text.UTF8Encoding]::new($true))
                $env:CINEP2P_UTF8 = '1'
                Write-Host 'Reexecutando com codificacao UTF-8...' -ForegroundColor DarkGray
                & powershell -NoProfile -ExecutionPolicy Bypass -File $tmp @args
                exit $LASTEXITCODE
            }
        }
    } catch { }
}

$ErrorActionPreference = 'Stop'

if (-not $Root -or $Root.Trim() -eq '') { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $Root -or $Root.Trim() -eq '') { $Root = (Get-Location).Path }
if (-not (Test-Path -LiteralPath $Root)) { throw "Pasta nao encontrada: $Root" }
Set-Location -LiteralPath $Root

$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Write-ProjectFile {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Content
    )
    $full = Join-Path $Root $RelativePath
    $dir = Split-Path -Parent $full
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [System.IO.File]::WriteAllText($full, $Content, $Utf8NoBom)
    Write-Host ("  [ok] " + $RelativePath) -ForegroundColor DarkGray
}

function Write-Step { param([string]$Text) Write-Host ''; Write-Host ("== " + $Text) -ForegroundColor Cyan }

Write-Host ''
Write-Host '  CineP2P 4.0 - PT-BR rigoroso + player imediato' -ForegroundColor White
Write-Host '  ----------------------------------------------' -ForegroundColor DarkGray

# ----------------------------------------------------------------------
Write-Step 'Backup'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupDir = Join-Path $Root ('.backup-' + $Stamp)
$madeBackup = $false
foreach ($t in @('server.js', 'src', 'public', '.env', 'package.json')) {
    $p = Join-Path $Root $t
    if (Test-Path -LiteralPath $p) {
        if (-not $madeBackup) { New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null; $madeBackup = $true }
        Copy-Item -LiteralPath $p -Destination (Join-Path $BackupDir $t) -Recurse -Force
    }
}
if ($madeBackup) { Write-Host ("  backup: " + (Split-Path -Leaf $BackupDir)) -ForegroundColor DarkGray }

New-Item -ItemType Directory -Force -Path (Join-Path $Root 'src\scrapers') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'public') | Out-Null

# ======================================================================
Write-Step 'Filtro PT-BR rigoroso'

# ----------------------------------------------------------------------
$fontesJs = @'
'use strict';

/**
 * Registro de confianca por fonte.
 *
 * nacional = true  -> tracker lusofono: "DUBLADO"/"NACIONAL" significa
 *                     nativamente portugues do Brasil (nao precisa de marcador extra)
 * regiao           -> 'br' | 'fr' | 'global' (usado para desconfiar de dublagem alheia)
 */
const FONTES = {
  'Commandotorrents': { nacional: true,  regiao: 'br' },
  'Lapumia':          { nacional: true,  regiao: 'br' },
  'RedeTorrent':      { nacional: true,  regiao: 'br' },
  'BluDV':            { nacional: true,  regiao: 'br' },
  'TorrentDosFilmes': { nacional: true,  regiao: 'br' },

  'Torrent9':         { nacional: false, regiao: 'fr' },

  'Torrentio':        { nacional: false, regiao: 'global' },
  'YTS':              { nacional: false, regiao: 'global' },
  'ThePirateBay':     { nacional: false, regiao: 'global' },
  'EZTV':             { nacional: false, regiao: 'global' },
  'SolidTorrents':    { nacional: false, regiao: 'global' },
  'TorrentGalaxy':    { nacional: false, regiao: 'global' },
  '1337x':            { nacional: false, regiao: 'global' }
};

function info(nome) {
  return FONTES[nome] || { nacional: false, regiao: 'global' };
}

module.exports = { FONTES: FONTES, info: info };
'@
Write-ProjectFile 'src/fontes.js' $fontesJs

# ----------------------------------------------------------------------
$ptbrJs = @'
'use strict';

/**
 * Classificador RIGOROSO de audio brasileiro.
 *
 * O problema real: o mundo inteiro escreve "DUBLADO" no titulo. Um release
 * russo/espanhol/frances tambem diz "DUBLADO". Aqui a classificacao exige
 * prova ou desconfia explicitamente.
 *
 * Niveis:
 *   confirmado  -> marcador PT-BR explicito, OU fonte nacional + DUBLADO/DUAL
 *   provavel    -> DUAL AUDIO limpo, ou DUBLADO sem nenhum termo estrangeiro
 *   incerto     -> DUBLADO/DUAL convivendo com idiomas estrangeiros
 *   estrangeiro -> dublagem estrangeira declarada (russo, VF, castellano...)
 */

const fontes = require('./fontes');

const RE_PTBR = [
  /\bpt[\s._-]?br\b/i,
  /\bptbr\b/i,
  /\[\s?br\s?\]/i,
  /\(\s?br\s?\)/i,
  /\bbrasileir[ao]\b/i,
  /\bnacional\b/i,
  /\bportugu[eê]s\b/i,
  /\bdublado\s?br\b/i,
  /\bdub\s?br\b/i,
  /\baudio[\s._-]?(pt|por)\b/i,
  /(?:\+|\be\b)\s*(?:por|pt)\b/i,
  /\bpor\s*\+/i,
  /\bpt[\s._-]?pt\b/i
];

const RE_ESTRANGEIROS = [
  { nome: 'russo',    re: /\bruss?[oa]?\b|\brus\b|\brussian\b|русск|италь/i },
  { nome: 'espanhol', re: /\bespanhol\b|\bespa[nñ]ol\b|\bcastellano\b|\blatino\b|\besp\b|\bspa\b/i },
  { nome: 'ingles',   re: /\bingl[eê]s\b|\benglish\b|\beng\b/i },
  { nome: 'frances',  re: /\bfranc[eê]s\b|\bfrench\b|\btruefrench\b|\bvff?\b|\bvostfr\b/i },
  { nome: 'alemao',   re: /\balem[aã]o\b|\bgerman\b|\bdeutsch\b/i },
  { nome: 'italiano', re: /\bitalian[oa]\b|\bita\b/i },
  { nome: 'hindi',    re: /\bhindi\b|\btamil\b|\btelugu\b/i },
  { nome: 'asiatico', re: /\bjapon[eê]s\b|\bjap\b|\bchin[eê]s\b|\bchinese\b|\bkorean\b|\bkor\b/i }
];

const RE_ADJ_ESTRANGEIRO = /(dublad\w*|dual[\s._-]?audio|audio[\s._-]?dual|\bdual\b)\W{0,3}(rus\w*|esp\w*|castellano|latino|ingl\w*|english|\beng\b|franc\w*|french|vff?|alem\w*|german|deutsch|ital\w*|hindi|jap\w*|chin\w*|kor\w*)/i;

const RE_ESTRANGEIRO_MAIS_PT = /(rus\w*|esp\w*|castellano|latino|ingl\w*|english|franc\w*|alem\w*|ital\w*|hindi)\s*\+\s*(por|pt|ptbr|dublado|portugu)/i;

const PESOS = {
  confirmado: 100,
  provavel: 70,
  incerto: 30,
  estrangeiro: 10,
  desconhecido: 0
};

function normalizar(txt) {
  return ' ' + String(txt || '').replace(/[._]/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim() + ' ';
}

function rotulo(nivel, sinais) {
  if (sinais.dual) return nivel === 'confirmado' ? 'Dual Audio (PT-BR)' : (nivel === 'provavel' ? 'Dual Audio (provavel PT-BR)' : 'Dual Audio ?');
  if (sinais.dublado) {
    if (nivel === 'confirmado') return 'Dublado PT-BR';
    if (nivel === 'provavel') return 'Dublado (provavel PT-BR)';
    return 'Dublado ?';
  }
  if (sinais.leg) return 'Legendado';
  return 'Original';
}

/**
 * @param {string} titulo  nome do release
 * @param {string} fonte   nome do indexador (para checar confianca)
 */
function avaliar(titulo, fonte) {
  const t = normalizar(titulo);
  const meta = fontes.info(fonte);

  const sinais = {
    ptbr: RE_PTBR.some(function (r) { return r.test(t); }),
    dublado: /dublad|dublagem|\bdub\b/.test(t),
    dual: /\bdual\b|\bmulti\b/.test(t),
    leg: /legendad|\bleg\b|subtitulad|\bsub\b/.test(t)
  };

  const riscos = [];
  RE_ESTRANGEIROS.forEach(function (e) { if (e.re.test(t)) riscos.push(e.nome); });

  const adjEstrangeiro = RE_ADJ_ESTRANGEIRO.test(t);
  const estrangeiroComPt = RE_ESTRANGEIRO_MAIS_PT.test(t);
  const motivos = [];
  let nivel;

  if (estrangeiroComPt && !sinais.ptbr) {
    nivel = 'confirmado';
    motivos.push('idioma estrangeiro listado junto com POR/PT');
    sinais.ptbr = true;
  } else if (sinais.ptbr && !adjEstrangeiro) {
    nivel = 'confirmado';
    motivos.push('marcador PT-BR explicito');
  } else if (sinais.ptbr) {
    nivel = 'provavel';
    motivos.push('marcador PT-BR com dublagem estrangeira citada');
  } else if (meta.nacional && (sinais.dublado || sinais.dual)) {
    nivel = 'confirmado';
    motivos.push('fonte nacional (' + meta.regiao.toUpperCase() + ') + ' + (sinais.dual ? 'DUAL AUDIO' : 'DUBLADO'));
  } else if (sinais.dual && riscos.length === 0) {
    nivel = 'provavel';
    motivos.push('DUAL AUDIO sem termo estrangeiro');
  } else if (sinais.dual) {
    nivel = 'incerto';
    motivos.push('DUAL AUDIO convivendo com ' + riscos.join('/'));
  } else if (sinais.dublado && riscos.length === 0 && meta.regiao !== 'fr') {
    nivel = 'provavel';
    motivos.push('DUBLADO sem termo estrangeiro');
  } else if (sinais.dublado) {
    nivel = 'incerto';
    motivos.push('DUBLADO possivelmente estrangeiro (' + riscos.join('/') + ')');
  } else if (adjEstrangeiro) {
    nivel = 'estrangeiro';
    motivos.push('dublagem estrangeira declarada');
  } else if (sinais.leg) {
    nivel = 'incerto';
    motivos.push('legendado');
  } else {
    nivel = 'desconhecido';
  }

  return {
    nivel: nivel,
    peso: PESOS[nivel],
    audio: rotulo(nivel, sinais),
    motivos: motivos,
    riscos: riscos,
    fonteNacional: meta.nacional,
    regiaoFonte: meta.regiao,
    elegivel: (nivel === 'confirmado' || nivel === 'provavel')
  };
}

module.exports = { avaliar: avaliar, PESOS: PESOS, RE_PTBR: RE_PTBR };
'@
Write-ProjectFile 'src/ptbr.js' $ptbrJs

# ----------------------------------------------------------------------
$rankingJs = @'
'use strict';

/**
 * Ranking final: PT-BR confirmado > PT-BR provavel > seeders > qualidade.
 * Deduplica por infoHash mantendo a melhor ocorrencia.
 */

const ptbr = require('./ptbr');

function pesoQualidade(q) {
  switch (String(q || '').toLowerCase()) {
    case '2160p': return 3.2;
    case '1080p': return 4;
    case '720p': return 2.4;
    case '480p': return 1;
    default: return 1.5;
  }
}

const PESO_NIVEL = { confirmado: 3200, provavel: 1800, incerto: 480, estrangeiro: 90, desconhecido: 0 };

function contemPalavras(titulo, alvo) {
  if (!alvo) return false;
  const t = String(titulo).toLowerCase();
  return String(alvo).toLowerCase().split(/[^a-z0-9]+/)
    .filter(function (w) { return w.length > 3; })
    .some(function (w) { return t.indexOf(w) !== -1; });
}

function pontuar(item, ctx) {
  let s = PESO_NIVEL[item.ptbr.nivel] || 0;
  s += pesoQualidade(item.quality) * 340;
  s += Math.log10(Math.max(1, item.seeders)) * 150;

  if (item.ptbr.fonteNacional) s += 220;
  if (ctx.ano && String(item.title).indexOf(String(ctx.ano)) !== -1) s += 180;
  if (contemPalavras(item.title, ctx.titulo)) s += 150;
  if (contemPalavras(item.title, ctx.tituloOriginal)) s += 120;
  if (item.fileIdx !== null && item.fileIdx !== undefined) s += 60;
  if (/(\bcam\b|\bts\b|hdcam|hdts|telesync)/i.test(item.title)) s -= 260;
  if (item.seeders === 0) s -= 110;
  if (item.sizeBytes && item.sizeBytes < 250 * 1024 * 1024) s -= 50;

  return s;
}

function normalizar(item) {
  const nome = String(item.title || '').replace(/\s+/g, ' ').trim();
  return {
    title: nome || 'Torrent',
    magnet: item.magnet,
    hash: String(item.hash || '').toLowerCase(),
    quality: item.quality || '',
    size: item.size || '',
    sizeBytes: item.sizeBytes || 0,
    seeders: Number(item.seeders || 0),
    fileIdx: (item.fileIdx === null || item.fileIdx === undefined) ? null : item.fileIdx,
    source: item.source || 'Desconhecida',
    score: 0,
    ptbr: null,
    elegivel: false
  };
}

function deduplicar(lista) {
  const mapa = new Map();
  lista.forEach(function (item) {
    const chave = item.hash || item.magnet;
    if (!chave) return;
    const atual = mapa.get(chave);
    if (!atual) { mapa.set(chave, item); return; }
    if (item.score > atual.score) {
      mapa.set(chave, item);
      return;
    }
    if (item.seeders > atual.seeders) atual.seeders = item.seeders;
    if (!atual.size && item.size) { atual.size = item.size; atual.sizeBytes = item.sizeBytes; }
    if (atual.fileIdx === null && item.fileIdx !== null) atual.fileIdx = item.fileIdx;
    if (!atual.quality && item.quality) atual.quality = item.quality;
  });
  return Array.from(mapa.values());
}

function preparar(lista, ctx) {
  const validos = lista
    .filter(function (i) { return i && i.magnet && /^magnet:/i.test(i.magnet); })
    .map(normalizar);

  validos.forEach(function (i) {
    i.ptbr = ptbr.avaliar(i.title, i.source);
    i.elegivel = i.ptbr.elegivel;
    i.score = pontuar(i, ctx);
  });

  const unicos = deduplicar(validos);
  unicos.sort(function (a, b) {
    if (a.elegivel !== b.elegivel) return a.elegivel ? -1 : 1;
    return b.score - a.score;
  });
  return unicos;
}

module.exports = { preparar: preparar, pontuar: pontuar };
'@
Write-ProjectFile 'src/ranking.js' $rankingJs

# ----------------------------------------------------------------------
$magnetsJs = @'
'use strict';

/**
 * Esteira concorrente: todos os scrapers em paralelo (Promise.all),
 * unificacao, dedupe por hash, classificacao PT-BR e escolha automatica.
 */

const scrapers = require('./scrapers');
const ranking = require('./ranking');

async function buscar(ctx) {
  const t0 = Date.now();
  const resultados = await scrapers.executar(ctx);

  const stats = resultados.map(function (r) {
    return { fonte: r.label, nacional: !!r.nacional, itens: r.itens.length, ms: r.ms, erro: r.erro };
  }).sort(function (a, b) { return b.itens - a.itens; });

  let brutos = [];
  resultados.forEach(function (r) {
    r.itens.forEach(function (item) {
      item.source = item.source || r.label;
      brutos.push(item);
    });
  });

  const ranqueados = ranking.preparar(brutos, ctx);
  const elegiveis = ranqueados.filter(function (f) { return f.elegivel; });
  const melhor = elegiveis[0] || ranqueados[0] || null;

  return {
    melhor: melhor,
    fontes: ranqueados.slice(0, 40),
    ptbr: elegiveis.slice(0, 20),
    total: ranqueados.length,
    ptbrTotal: elegiveis.length,
    confirmados: ranqueados.filter(function (f) { return f.ptbr.nivel === 'confirmado'; }).length,
    ms: Date.now() - t0,
    scrapers: stats
  };
}

module.exports = { buscar: buscar };
'@
Write-ProjectFile 'src/magnets.js' $magnetsJs

# ======================================================================
Write-Step 'Scrapers nacionais'

# ----------------------------------------------------------------------
$scraperRede = @'
'use strict';

const http = require('./_http');

const HOSTS = ['https://redetorrent.com', 'https://www.redetorrent.com'];

module.exports = {
  name: 'redetorrent',
  label: 'RedeTorrent',
  nacional: true,
  supports: function () { return true; },
  search: async function (ctx) {
    const termo = encodeURIComponent(ctx.tituloOriginal || ctx.titulo || '');
    if (!termo) return [];
    for (const host of HOSTS) {
      try {
        const url = host + '/?s=' + termo;
        const html = await http.fetchText(url);
        const direto = http.rowsFromHtml(html, { source: 'RedeTorrent' });
        if (direto.length >= 2) return direto.slice(0, 20);
        const profundo = await http.deepSearch(url, 'href="(' + host.replace(/\./g, '\\.') + '/[^"?#]+)"', 4, 'RedeTorrent');
        if (profundo.length) return profundo.slice(0, 20);
      } catch (e) { }
    }
    return [];
  }
};
'@
Write-ProjectFile 'src/scrapers/redetorrent.js' $scraperRede

# ----------------------------------------------------------------------
$scraperBludv = @'
'use strict';

const http = require('./_http');

const HOSTS = ['https://bludv.xyz', 'https://bludv.tv', 'https://bludv.site'];

module.exports = {
  name: 'bludv',
  label: 'BluDV',
  nacional: true,
  supports: function () { return true; },
  search: async function (ctx) {
    const termo = encodeURIComponent(ctx.tituloOriginal || ctx.titulo || '');
    if (!termo) return [];
    for (const host of HOSTS) {
      try {
        const url = host + '/?s=' + termo;
        const html = await http.fetchText(url);
        const direto = http.rowsFromHtml(html, { source: 'BluDV' });
        if (direto.length >= 2) return direto.slice(0, 20);
        const profundo = await http.deepSearch(url, 'href="(' + host.replace(/\./g, '\\.') + '/[^"?#]+)"', 4, 'BluDV');
        if (profundo.length) return profundo.slice(0, 20);
      } catch (e) { }
    }
    return [];
  }
};
'@
Write-ProjectFile 'src/scrapers/bludv.js' $scraperBludv

# ----------------------------------------------------------------------
$scraperTdf = @'
'use strict';

const http = require('./_http');

const HOSTS = ['https://torrentdosfilmes.tv', 'https://www.torrentdosfilmes.tv'];

module.exports = {
  name: 'torrentdosfilmes',
  label: 'TorrentDosFilmes',
  nacional: true,
  supports: function () { return true; },
  search: async function (ctx) {
    const termo = encodeURIComponent(ctx.tituloOriginal || ctx.titulo || '');
    if (!termo) return [];
    for (const host of HOSTS) {
      const candidatos = [
        host + '/?s=' + termo,
        host + '/torrents/search/?search=' + termo
      ];
      for (const url of candidatos) {
        try {
          const html = await http.fetchText(url);
          const direto = http.rowsFromHtml(html, { source: 'TorrentDosFilmes' });
          if (direto.length >= 2) return direto.slice(0, 20);
          const profundo = await http.deepSearch(url, 'href="(' + host.replace(/\./g, '\\.') + '/[^"?#]+)"', 4, 'TorrentDosFilmes');
          if (profundo.length) return profundo.slice(0, 20);
        } catch (e) { }
      }
    }
    return [];
  }
};
'@
Write-ProjectFile 'src/scrapers/torrentdosfilmes.js' $scraperTdf

# ----------------------------------------------------------------------
$scrapersIndex = @'
'use strict';

/**
 * Registry de scrapers. Tudo roda em PARALELO via Promise.all.
 * Fontes nacionais primeiro (elas provam PT-BR nativamente).
 */

const TODOS = [
  require('./commandotorrents'),
  require('./lapumia'),
  require('./redetorrent'),
  require('./bludv'),
  require('./torrentdosfilmes'),
  require('./torrent9'),
  require('./torrentio'),
  require('./yts'),
  require('./piratebay'),
  require('./eztv'),
  require('./solidtorrents'),
  require('./torrentgalaxy'),
  require('./x1337')
];

function ativos() {
  const env = String(process.env.SCRAPERS_ENABLED || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!env.length) return TODOS;
  return TODOS.filter(function (s) { return env.indexOf(s.name) !== -1; });
}

async function executar(ctx) {
  const lista = ativos();
  const tarefas = lista.map(async function (s) {
    const t0 = Date.now();
    if (s.supports && !s.supports(ctx)) {
      return { nome: s.name, label: s.label, nacional: !!s.nacional, itens: [], ms: 0, erro: null };
    }
    try {
      const itens = await s.search(ctx);
      return { nome: s.name, label: s.label, nacional: !!s.nacional, itens: Array.isArray(itens) ? itens : [], ms: Date.now() - t0, erro: null };
    } catch (e) {
      return { nome: s.name, label: s.label, nacional: !!s.nacional, itens: [], ms: Date.now() - t0, erro: e.message };
    }
  });
  return Promise.all(tarefas);
}

module.exports = { executar: executar, todos: TODOS, ativos: ativos };
'@
Write-ProjectFile 'src/scrapers/index.js' $scrapersIndex

# ======================================================================
Write-Step 'Legendas + player'

# ----------------------------------------------------------------------
$subtitulosJs = @'
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
'@
Write-ProjectFile 'src/subtitulos.js' $subtitulosJs

# ----------------------------------------------------------------------
$streamerJs = @'
'use strict';

/**
 * Player P2P blindado + legendas + limpeza absoluta de disco.
 *
 *  - announce list massiva no magnet, no add() e re-anuncio a cada 6s
 *  - timeout com retentativas automaticas
 *  - cada job vive em cache/<jobId> e a pasta e destruida ao fechar
 *  - legendas do proprio torrent sao coletadas e servidas em WebVTT
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebTorrent = require('webtorrent');
const trackers = require('./trackers');
const subtitulos = require('./subtitulos');

const TRACKERS = trackers.TRACKERS;
const appendTrackers = trackers.appendTrackers;

const cacheSetting = process.env.TORRENT_CACHE_DIR || 'cache';
const CACHE_ROOT = path.isAbsolute(cacheSetting) ? cacheSetting : path.join(__dirname, '..', cacheSetting);

const CACHE_MODE = (process.env.CACHE_MODE || 'session').toLowerCase();
const METADATA_TIMEOUT = Number(process.env.METADATA_TIMEOUT || 40) * 1000;
const IDLE_TIMEOUT = Number(process.env.IDLE_TIMEOUT || 12 * 60 * 1000);
const MAX_JOBS = Number(process.env.MAX_JOBS || 3);
const MAX_CONNS = Number(process.env.MAX_CONNS || 200);
const MIN_BUFFER_PERCENT = Number(process.env.MIN_BUFFER_PERCENT || 3);
const MIN_BUFFER_MB = Number(process.env.MIN_BUFFER_MB || 8);
const MAX_SUBS = Number(process.env.MAX_SUBS || 8);

fs.mkdirSync(CACHE_ROOT, { recursive: true });

const client = new WebTorrent({
  maxConns: MAX_CONNS, dht: true, tracker: true, lsd: true, utp: true, webSeeds: true
});

client.on('error', function (e) { console.error('[webtorrent] ' + e.message); });
client.on('warning', function (e) { console.warn('[webtorrent] ' + e.message); });

const jobs = new Map();

const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|avi|mov|ogv|ogg|ts|mpg|mpeg|flv)$/i;
const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', mov: 'video/quicktime', ogv: 'video/ogg', ts: 'video/mp2t'
};

function mimeFor(nome) {
  const ext = String(nome).split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function agora() { return Date.now(); }

/* ----------------------------- limpeza ----------------------------- */

function apagarPasta(dir, tentativa) {
  const n = tentativa || 0;
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    if (!fs.existsSync(dir)) return;
  } catch (e) { }
  if (n < 6) setTimeout(function () { apagarPasta(dir, n + 1); }, 300 * (n + 1));
}

function limparOrfaos() {
  if (CACHE_MODE === 'keep') return;
  try {
    fs.readdirSync(CACHE_ROOT).forEach(function (nome) {
      const p = path.join(CACHE_ROOT, nome);
      try { if (fs.statSync(p).isDirectory()) apagarPasta(p); } catch (e) { }
    });
  } catch (e) { }
}
limparOrfaos();

/* ------------------------------- job ------------------------------- */

function start(params) {
  const magnet = appendTrackers(params.magnet);
  if (!magnet) throw new Error('Magnet link invalido.');

  if (jobs.size >= MAX_JOBS) destruirMaisAntigo();

  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(CACHE_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });

  const job = {
    id: id, dir: dir,
    createdAt: agora(), lastAccess: agora(),
    state: 'conectando',
    message: 'Conectando aos peers...',
    magnet: magnet,
    titulo: params.titulo || '',
    qualidade: params.qualidade || '',
    fileIdx: (params.fileIdx === undefined || params.fileIdx === null || params.fileIdx === '') ? null : Number(params.fileIdx),
    peers: 0, progress: 0, buffer: 0, speed: 0, downloaded: 0, total: 0,
    fileName: '', streamUrl: null, canPlay: false,
    subs: [], subsSelecionadas: [],
    tentativas: 0, torrent: null, file: null, nudge: null, timers: []
  };

  jobs.set(id, job);
  attach(job);
  return job;
}

function limparTimers(job) {
  if (job.nudge) { clearInterval(job.nudge); job.nudge = null; }
  (job.timers || []).forEach(function (t) { clearTimeout(t); });
  job.timers = [];
}

function attach(job) {
  let torrent;
  try {
    torrent = client.add(job.magnet, { path: job.dir, announce: TRACKERS });
  } catch (err) {
    job.state = 'erro';
    job.message = 'Nao foi possivel abrir o magnet: ' + err.message;
    return;
  }

  job.torrent = torrent;
  job.state = 'conectando';
  job.message = 'Procurando peers em ' + TRACKERS.length + ' trackers...';
  try { torrent.strategy = 'sequential'; } catch (e) { }

  job.nudge = setInterval(function () {
    if (job.state === 'pronto') return;
    job.peers = torrent.numPeers || 0;
    if (job.peers === 0) {
      TRACKERS.forEach(function (t) { try { torrent.addTracker(t); } catch (e) { } });
      job.message = 'Reforcando announce list (' + TRACKERS.length + ' trackers)...';
    }
  }, 6000);

  job.timers.push(setTimeout(function () {
    if (job.state === 'pronto') return;
    job.message = 'Metadados demorando. Tentando trackers alternativos...';
  }, 14000));

  job.timers.push(setTimeout(function () {
    if (job.state === 'pronto') return;
    if (job.tentativas < 2) {
      job.tentativas += 1;
      job.message = 'Tentativa ' + job.tentativas + ' expirada. Reiniciando...';
      restart(job);
    } else {
      job.state = 'erro';
      job.message = 'Tempo esgotado: nenhum peer respondeu.';
      limparTimers(job);
    }
  }, METADATA_TIMEOUT));

  torrent.on('metadata', function () {
    job.state = 'metadados';
    job.message = 'Metadados recebidos. Selecionando video...';
    setTimeout(function () { onReady(job); }, 400);
  });

  torrent.on('ready', function () { onReady(job); });
  torrent.on('noPeers', function () { job.message = 'Sem peers no momento, reforcando trackers...'; });
  torrent.on('wire', function () { job.peers = torrent.numPeers || 0; });

  torrent.on('download', function () {
    job.progress = torrent.progress || 0;
    job.speed = torrent.downloadSpeed || 0;
    job.downloaded = torrent.downloaded || 0;
    job.peers = torrent.numPeers || 0;
    if (job.file) {
      job.buffer = (job.file.progress || 0) * 100;
      if (!job.canPlay) {
        const baixado = job.file.downloaded || 0;
        if (job.buffer >= MIN_BUFFER_PERCENT || baixado >= MIN_BUFFER_MB * 1024 * 1024) {
          job.canPlay = true;
          job.state = 'pronto';
          job.message = 'Buffer pronto.';
        }
      }
    }
  });

  torrent.on('error', function (err) {
    job.state = 'erro';
    job.message = 'Erro no torrent: ' + err.message;
    limparTimers(job);
  });

  torrent.on('warning', function (e) { console.warn('[torrent] ' + e.message); });
}

function restart(job) {
  limparTimers(job);
  try { if (job.torrent) job.torrent.destroy({ destroyStore: false }); } catch (e) { }
  job.torrent = null;
  job.state = 'conectando';
  job.peers = 0;
  setTimeout(function () { if (job.state !== 'pronto' && !job.torrent) attach(job); }, 500);
}

function pickFile(torrent, fileIdx) {
  const files = torrent.files || [];
  if (!files.length) return null;
  if (fileIdx !== null && fileIdx >= 0 && files[fileIdx]) {
    const cand = files[fileIdx];
    if (VIDEO_EXT.test(cand.name)) return cand;
    const vids = files.filter(function (f) { return VIDEO_EXT.test(f.name); });
    if (vids.length <= 1) return cand;
  }
  const vids = files.filter(function (f) { return VIDEO_EXT.test(f.name); });
  const pool = vids.length ? vids : files;
  return pool.slice().sort(function (a, b) { return b.length - a.length; })[0] || null;
}

function coletarSubs(torrent, video) {
  const base = String(video.name).replace(/\.[^.]+$/, '').toLowerCase();
  return (torrent.files || [])
    .map(function (f, i) { return { f: f, i: i }; })
    .filter(function (x) { return subtitulos.ehLegenda(x.f.name); })
    .sort(function (a, b) {
      const ca = String(a.f.name).toLowerCase().indexOf(base) === 0 ? 0 : 1;
      const cb = String(b.f.name).toLowerCase().indexOf(base) === 0 ? 0 : 1;
      return ca - cb || a.f.length - b.f.length;
    })
    .slice(0, MAX_SUBS)
    .map(function (x, idx) {
      const lang = subtitulos.idiomaDe(x.f.name);
      return { idx: idx, fileIndex: x.i, nome: String(x.f.name).split('/').pop(), code: lang.code, label: lang.label };
    });
}

function onReady(job) {
  if (job.file) return;
  const torrent = job.torrent;
  if (!torrent) return;

  const file = pickFile(torrent, job.fileIdx);
  if (!file) {
    job.state = 'erro';
    job.message = 'Nenhum arquivo de video neste torrent.';
    limparTimers(job);
    return;
  }

  job.file = file;
  job.fileName = file.name;
  job.total = file.length;
  job.streamUrl = '/api/play/stream?jobId=' + job.id;
  job.state = 'bufferizando';
  job.message = 'Conectando aos peers (buffer)...';

  job.subs = coletarSubs(torrent, file);
  const manter = [file].concat(job.subs.map(function (s) { return torrent.files[s.fileIndex]; }));
  manter.forEach(function (f) { try { f.select(); } catch (e) { } });
  (torrent.files || []).forEach(function (f) {
    if (manter.indexOf(f) === -1) { try { f.deselect(); } catch (e) { } }
  });
}

/* ------------------------------- HTTP ------------------------------ */

function handle(jobId, req, res) {
  const job = jobs.get(jobId);
  if (!job) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Job nao encontrado.'); return; }
  job.lastAccess = agora();

  if (job.state === 'erro') { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); res.end(job.message); return; }

  const file = job.file;
  if (!file) { res.writeHead(202, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Aguardando metadados...'); return; }

  const total = file.length;
  const base = {
    'content-type': mimeFor(file.name),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'content-range,content-length,accept-ranges'
  };

  if (req.method === 'HEAD') { res.writeHead(200, Object.assign({ 'content-length': total }, base)); res.end(); return; }

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    if (start > end) { res.writeHead(416, Object.assign({ 'content-range': 'bytes */' + total }, base)); res.end(); return; }
    res.writeHead(206, Object.assign({
      'content-range': 'bytes ' + start + '-' + end + '/' + total,
      'content-length': end - start + 1
    }, base));
    const stream = file.createReadStream({ start: start, end: end });
    stream.on('error', function () { try { res.end(); } catch (e) { } });
    res.on('close', function () { try { stream.destroy(); } catch (e) { } });
    stream.pipe(res);
    return;
  }

  res.writeHead(200, Object.assign({ 'content-length': total }, base));
  const stream = file.createReadStream();
  stream.on('error', function () { try { res.end(); } catch (e) { } });
  res.on('close', function () { try { stream.destroy(); } catch (e) { } });
  stream.pipe(res);
}

/* ---------------------------- legendas ----------------------------- */

function lerArquivo(file, limite) {
  return new Promise(function (resolve, reject) {
    const pedacos = [];
    let total = 0;
    let resolvido = false;
    const stream = file.createReadStream();
    const fim = function (erro) {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(timer);
      if (erro) reject(erro); else resolve(subtitulos.decodificar(Buffer.concat(pedacos)));
    };
    const timer = setTimeout(function () { try { stream.destroy(); } catch (e) { } fim(); }, 25000);
    stream.on('data', function (c) {
      pedacos.push(c);
      total += c.length;
      if (total > (limite || 4 * 1024 * 1024)) { try { stream.destroy(); } catch (e) { } fim(); }
    });
    stream.on('end', function () { fim(); });
    stream.on('close', function () { fim(); });
    stream.on('error', function (e) { fim(e); });
  });
}

async function legenda(jobId, idx) {
  const job = jobs.get(jobId);
  if (!job || !job.subs || !job.subs[idx]) return null;
  const sub = job.subs[idx];
  const file = job.torrent && job.torrent.files[sub.fileIndex];
  if (!file) return null;
  job.lastAccess = agora();
  const texto = await lerArquivo(file);
  return {
    nome: sub.nome,
    code: sub.code,
    label: sub.label,
    vtt: subtitulos.converter(texto, subtitulos.extensao(file.name))
  };
}

/* ------------------------------ status ----------------------------- */

function status(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  job.lastAccess = agora();
  const t = job.torrent;
  return {
    id: job.id,
    state: job.state,
    message: job.message,
    titulo: job.titulo,
    qualidade: job.qualidade,
    fileName: job.fileName,
    peers: t ? (t.numPeers || 0) : job.peers,
    progress: t ? (t.progress || 0) : 0,
    buffer: job.buffer || 0,
    speed: t ? (t.downloadSpeed || 0) : 0,
    downloaded: t ? (t.downloaded || 0) : 0,
    total: job.total || 0,
    canPlay: !!job.canPlay,
    minBuffer: MIN_BUFFER_PERCENT,
    subs: job.subs ? job.subs.map(function (s) { return { idx: s.idx, nome: s.nome, code: s.code, label: s.label }; }) : [],
    elapsed: Math.round((agora() - job.createdAt) / 1000),
    streamUrl: job.streamUrl
  };
}

function stop(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  limparTimers(job);
  jobs.delete(jobId);

  const dir = job.dir;
  const finalizar = function () { if (CACHE_MODE !== 'keep') apagarPasta(dir); };

  try {
    if (job.torrent) job.torrent.destroy({ destroyStore: true }, function () { finalizar(); });
    else finalizar();
  } catch (e) { finalizar(); }
  return true;
}

function destruirMaisAntigo() {
  let alvo = null;
  jobs.forEach(function (j) { if (!alvo || j.lastAccess < alvo.lastAccess) alvo = j; });
  if (alvo) stop(alvo.id);
}

function stopTudo() { Array.from(jobs.keys()).forEach(function (id) { stop(id); }); }

setInterval(function () {
  const t = agora();
  jobs.forEach(function (j) { if (t - j.lastAccess > IDLE_TIMEOUT) stop(j.id); });
}, 45000);

process.on('SIGINT', function () { try { client.destroy(); } catch (e) { } stopTudo(); process.exit(0); });
process.on('SIGTERM', function () { try { client.destroy(); } catch (e) { } stopTudo(); process.exit(0); });

module.exports = {
  start: start, status: status, stop: stop, stopTudo: stopTudo,
  handle: handle, legenda: legenda, jobs: jobs, CACHE_ROOT: CACHE_ROOT
};
'@
Write-ProjectFile 'src/streamer.js' $streamerJs

# ======================================================================
Write-Step 'Servidor'

# ----------------------------------------------------------------------
$serverJs = @'
'use strict';

/**
 * CineP2P 4.0 - API desacoplada (Capacitor/Cordova ready).
 */

require('dotenv').config();

if (typeof fetch !== 'function') { console.error('Node.js 18+ necessario.'); process.exit(1); }

const path = require('path');
const express = require('express');

const tmdb = require('./src/tmdb');
const magnets = require('./src/magnets');
const streamer = require('./src/streamer');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const VERSAO = '4.0.0';

const app = express();
app.disable('x-powered-by');
app.use(express.json());

app.use(function (req, res, next) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type,range,accept');
  res.setHeader('access-control-expose-headers', 'content-range,content-length,accept-ranges');
  res.setHeader('access-control-allow-methods', 'GET,HEAD,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  next();
});

function fail(res, err, status) {
  const code = (err && err.code === 'TMDB_NOT_CONFIGURED') ? 503 : (status || 500);
  console.error('[api] ' + (err && err.message));
  res.status(code).json({ error: (err && err.message) ? err.message : 'Erro interno.' });
}

/* ------------------------------ config ----------------------------- */

app.get('/api/health', function (req, res) {
  res.json({ ok: true, versao: VERSAO, tmdb: tmdb.isConfigured(), uptime: Math.round(process.uptime()) });
});

app.get('/api/config', function (req, res) {
  res.json({
    versao: VERSAO,
    tmdbConfigurado: tmdb.isConfigured(),
    idioma: tmdb.cfg().language,
    cache: streamer.CACHE_ROOT,
    minBuffer: Number(process.env.MIN_BUFFER_PERCENT || 3)
  });
});

app.get('/api/generos', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json({ generos: await tmdb.generos(tipo) }); } catch (err) { fail(res, err); }
});

/* ------------------------------- home ------------------------------ */

app.get('/api/home', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try {
    const base = tipo === 'tv'
      ? [tmdb.list('/tv/popular', null, 'tv'), tmdb.list('/tv/top_rated', null, 'tv'), tmdb.list('/trending/tv/week', null, 'tv')]
      : [tmdb.list('/movie/popular', null, 'movie'), tmdb.list('/movie/top_rated', null, 'movie'), tmdb.list('/trending/movie/week', null, 'movie')];

    const r = await Promise.all(base.concat([
      tmdb.lancamentos(tipo),
      tmdb.porGenero(tipo, tipo === 'tv' ? 10759 : 28),
      tmdb.porGenero(tipo, 35),
      tmdb.porGenero(tipo, 16),
      tmdb.porGenero(tipo, tipo === 'tv' ? 9648 : 53),
      tmdb.porGenero(tipo, 27)
    ]));

    const hero = (r[2] && r[2][0]) || (r[0] && r[0][0]) || null;
    const rows = [
      { titulo: 'Lancamentos (Ultimo Ano)', itens: (r[3] || []).slice(0, 20) },
      { titulo: 'Populares', itens: (r[0] || []).slice(0, 20) },
      { titulo: 'Em Alta Agora', itens: (r[2] || []).slice(0, 20) },
      { titulo: 'Mais Bem Avaliados', itens: (r[1] || []).slice(0, 20) },
      { titulo: 'Acao', itens: (r[4] || []).slice(0, 20) },
      { titulo: 'Comedia', itens: (r[5] || []).slice(0, 20) },
      { titulo: 'Animacao', itens: (r[6] || []).slice(0, 20) },
      { titulo: 'Suspense', itens: (r[7] || []).slice(0, 20) },
      { titulo: 'Terror', itens: (r[8] || []).slice(0, 20) }
    ].filter(function (x) { return x.itens.length; });

    res.json({ tipo: tipo, hero: hero, rows: rows, atualizado: Date.now() });
  } catch (err) { fail(res, err); }
});

/* ---------------------------- catalogo ----------------------------- */

app.get('/api/filmes/populares', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json({ itens: await tmdb.list(tipo === 'tv' ? '/tv/popular' : '/movie/popular', { page: req.query.pagina || 1 }, tipo) }); }
  catch (err) { fail(res, err); }
});

app.get('/api/filmes/lancamentos', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json({ itens: await tmdb.lancamentos(tipo) }); } catch (err) { fail(res, err); }
});

app.get('/api/filmes/top', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json({ itens: await tmdb.list(tipo === 'tv' ? '/tv/top_rated' : '/movie/top_rated', { page: req.query.pagina || 1 }, tipo) }); }
  catch (err) { fail(res, err); }
});

app.get('/api/filmes/genero/:id', async function (req, res) {
  const tipo = req.query.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json({ itens: await tmdb.porGenero(tipo, req.params.id, req.query.pagina) }); }
  catch (err) { fail(res, err); }
});

app.get('/api/media/:tipo/:id', async function (req, res) {
  const tipo = req.params.tipo === 'tv' ? 'tv' : 'movie';
  try { res.json(await tmdb.detalhes(tipo, req.params.id)); } catch (err) { fail(res, err); }
});

app.get('/api/buscar', async function (req, res) {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ itens: [] });
  try { res.json({ itens: await tmdb.buscar(q, req.query.tipo || null) }); } catch (err) { fail(res, err); }
});

/* ---------------------------- torrents ----------------------------- */

app.get('/api/torrent', async function (req, res) {
  const q = req.query;
  const ctx = {
    titulo: q.titulo || q.query || '',
    tituloOriginal: q.tituloOriginal || '',
    ano: q.ano || '',
    imdbId: q.imdbId || null,
    tipo: q.tipo === 'tv' ? 'tv' : 'movie',
    temporada: Number(q.temporada) || 1,
    episodio: Number(q.episodio) || 1
  };
  if (!ctx.titulo && !ctx.imdbId) return res.status(400).json({ error: 'Informe titulo ou imdbId.' });
  try {
    const r = await magnets.buscar(ctx);
    res.json({
      melhor: r.melhor,
      fontes: r.fontes,
      ptbr: r.ptbr,
      total: r.total,
      ptbrTotal: r.ptbrTotal,
      confirmados: r.confirmados,
      ms: r.ms,
      scrapers: r.scrapers
    });
  } catch (err) { fail(res, err); }
});

/* ------------------------------ player ----------------------------- */

app.get('/api/play', function (req, res) {
  if (!req.query.magnet) return res.status(400).json({ error: 'Parametro magnet obrigatorio.' });
  try {
    const job = streamer.start({
      magnet: String(req.query.magnet),
      fileIdx: req.query.fileIdx,
      titulo: req.query.titulo,
      qualidade: req.query.qualidade
    });
    res.json({ jobId: job.id, statusUrl: '/api/play/status?jobId=' + job.id, streamUrl: '/api/play/stream?jobId=' + job.id });
  } catch (err) { fail(res, err); }
});

app.get('/api/play/status', function (req, res) {
  const s = streamer.status(String(req.query.jobId || ''));
  if (!s) return res.status(404).json({ error: 'Job nao encontrado.' });
  res.json(s);
});

app.get('/api/play/stream', function (req, res) { streamer.handle(String(req.query.jobId || ''), req, res); });

app.get('/api/play/subs', function (req, res) {
  const s = streamer.status(String(req.query.jobId || ''));
  if (!s) return res.status(404).json({ error: 'Job nao encontrado.' });
  res.json({ subs: s.subs || [] });
});

app.get('/api/play/subtitle', async function (req, res) {
  try {
    const r = await streamer.legenda(String(req.query.jobId || ''), Number(req.query.idx) || 0);
    if (!r) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Legenda indisponivel.'); return; }
    res.writeHead(200, {
      'content-type': 'text/vtt; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    });
    res.end(r.vtt);
  } catch (err) { fail(res, err); }
});

app.all('/api/play/stop', function (req, res) {
  const id = String((req.query && req.query.jobId) || '');
  res.json({ parado: id ? streamer.stop(id) : (streamer.stopTudo(), true) });
});

app.use('/api', function (req, res) { res.status(404).json({ error: 'Rota nao encontrada: ' + req.originalUrl }); });

/* ---------------------------- estaticos ---------------------------- */

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('*', function (req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, HOST, function () {
  console.log('');
  console.log('  CineP2P ' + VERSAO + ' -> http://localhost:' + PORT);
  console.log('  Cache (apagado ao fechar o player): ' + streamer.CACHE_ROOT);
  if (!tmdb.isConfigured()) console.log('  ATENCAO: TMDB_API_KEY ausente no .env');
  console.log('');
});
'@
Write-ProjectFile 'server.js' $serverJs

# ======================================================================
Write-Step 'Frontend'

# ----------------------------------------------------------------------
$indexHtml = @'
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0a0b">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>CineP2P</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/placeholder.svg">
<link rel="preconnect" href="https://image.tmdb.org">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/player.css">
</head>
<body>

<header class="topbar">
  <button class="icon-btn" id="menuBtn" aria-label="Abrir menu">
    <svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
  </button>

  <a class="brand" id="brand" href="#">Cine<span>P2P</span></a>

  <nav class="topnav" id="topnav">
    <button class="nav-link active" data-view="inicio">Inicio</button>
    <button class="nav-link" data-view="buscar">Buscar</button>
    <button class="nav-link" data-view="historico">Historico</button>
    <button class="nav-link" data-view="lista">Minha Lista</button>
    <button class="nav-link" data-view="categorias">Categorias</button>
  </nav>

  <div class="topbar-actions">
    <button class="chip" id="tipoToggle">Filmes</button>
    <button class="icon-btn" id="searchBtn" aria-label="Buscar">
      <svg viewBox="0 0 24 24" width="21" height="21"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16.5 16.5 21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
  </div>
</header>

<aside id="drawer" class="drawer hidden">
  <div class="drawer-head">
    <span class="brand">Cine<span>P2P</span></span>
    <button class="icon-btn" id="drawerClose" aria-label="Fechar">
      <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
  </div>
  <nav class="drawer-nav">
    <button class="nav-link" data-view="inicio">Inicio</button>
    <button class="nav-link" data-view="buscar">Buscar</button>
    <button class="nav-link" data-view="historico">Historico</button>
    <button class="nav-link" data-view="lista">Minha Lista</button>
    <button class="nav-link" data-view="categorias">Categorias</button>
  </nav>
  <p class="drawer-foot">CineP2P 4.0 &middot; audio PT-BR priorizado</p>
</aside>
<div id="drawerBackdrop" class="drawer-backdrop hidden"></div>

<main id="app">
  <section id="view-inicio" class="view">
    <section id="hero" class="hero"></section>
    <div id="rows" class="rows"></div>
  </section>

  <section id="view-buscar" class="view hidden">
    <div class="searchbar">
      <input id="searchInput" type="search" placeholder="Buscar filmes, series..." autocomplete="off">
      <button class="btn small" id="searchGo">Buscar</button>
    </div>
    <div id="searchResults" class="grid"></div>
  </section>

  <section id="view-lista" class="view hidden">
    <h1 class="view-title">Minha Lista</h1>
    <div id="listaGrid" class="grid"></div>
  </section>

  <section id="view-historico" class="view hidden">
    <h1 class="view-title">Historico</h1>
    <div id="historicoGrid" class="grid"></div>
    <button class="btn ghost limpar" id="limparHistorico">Limpar historico</button>
  </section>

  <section id="view-categorias" class="view hidden">
    <h1 class="view-title">Categorias</h1>
    <div id="categoriasChips" class="chips"></div>
    <div id="categoriasGrid" class="grid"></div>
  </section>
</main>

<nav class="bottom-nav">
  <button class="bn-item active" data-view="inicio">
    <svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
    <span>Inicio</span>
  </button>
  <button class="bn-item" data-view="buscar">
    <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16.5 16.5 21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <span>Buscar</span>
  </button>
  <button class="bn-item" data-view="lista">
    <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
    <span>Lista</span>
  </button>
  <button class="bn-item" data-view="historico">
    <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <span>Historico</span>
  </button>
</nav>

<div id="modal" class="modal hidden">
  <div class="modal-backdrop" data-close></div>
  <div class="modal-card" role="dialog" aria-modal="true">
    <button class="modal-close" data-close aria-label="Fechar">
      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
    <div id="modalBody" class="modal-body"></div>
  </div>
</div>

<!-- ============================ PLAYER ============================ -->
<div id="player" class="player hidden">
  <video id="video" playsinline webkit-playsinline preload="metadata"></video>

  <div class="pv-top" id="pvTop">
    <button class="pv-btn" id="pvClose" aria-label="Voltar">
      <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="pv-title" id="pvTitle">Reproduzindo</div>
    <button class="pv-btn pv-txt" id="pvFontes">Fontes</button>
  </div>

  <div class="pv-center" id="pvCenter">
    <div class="pv-spinner"></div>
    <p class="pv-msg" id="pvMsg">Conectando aos peers...</p>
    <div class="pv-bar"><i id="pvFill"></i></div>
    <p class="pv-stats" id="pvStats"></p>
    <p class="pv-fonte" id="pvFonte"></p>
  </div>

  <div class="pv-bottom" id="pvBottom">
    <div class="pv-seek" id="pvSeek">
      <div class="pv-seek-track"><i id="pvProgress"></i></div>
      <div class="pv-seek-knob" id="pvKnob"></div>
    </div>
    <div class="pv-row">
      <button class="pv-btn" id="pvPlay" aria-label="Play/Pause">
        <svg id="icoPlay" viewBox="0 0 24 24" width="26" height="26"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>
        <svg id="icoPause" class="hidden" viewBox="0 0 24 24" width="26" height="26"><path d="M7 4.5h4v15H7zM13 4.5h4v15h-4z" fill="currentColor"/></svg>
      </button>
      <button class="pv-btn" id="pvBack30" aria-label="Voltar 30 segundos">
        <svg viewBox="0 0 24 24" width="26" height="26"><path d="M11 5V2L6 6l5 4V7a6 6 0 1 1-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="17" font-size="8" font-weight="700" fill="currentColor" text-anchor="middle">30</text></svg>
      </button>
      <button class="pv-btn" id="pvFwd30" aria-label="Avancar 30 segundos">
        <svg viewBox="0 0 24 24" width="26" height="26"><path d="M13 5V2l5 4-5 4V7a6 6 0 1 0 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="17" font-size="8" font-weight="700" fill="currentColor" text-anchor="middle">30</text></svg>
      </button>
      <span class="pv-time" id="pvTime">0:00 / 0:00</span>
      <span class="pv-spacer"></span>
      <button class="pv-btn" id="pvMute" aria-label="Volume">
        <svg id="icoVol" viewBox="0 0 24 24" width="24" height="24"><path d="M4 9h3l5-4v14l-5-4H4z" fill="currentColor"/><path d="M15 9.5a4 4 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <svg id="icoMudo" class="hidden" viewBox="0 0 24 24" width="24" height="24"><path d="M4 9h3l5-4v14l-5-4H4z" fill="currentColor"/><path d="M15 9l5 6M20 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      <button class="pv-btn pv-cc" id="pvCC" aria-label="Legendas">CC</button>
      <button class="pv-btn" id="pvFull" aria-label="Tela cheia">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>

  <div class="pv-sheet hidden" id="pvSheet">
    <div class="pv-sheet-head">
      <strong id="pvSheetTitle">Fontes</strong>
      <button class="pv-btn" id="pvSheetClose" aria-label="Fechar">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="pv-sheet-body" id="pvSheetBody"></div>
  </div>
</div>

<div id="toast" class="toast hidden"></div>

<script src="/config.js"></script>
<script src="/app.js"></script>
</body>
</html>
'@
Write-ProjectFile 'public/index.html' $indexHtml

# ----------------------------------------------------------------------
$playerCss = @'
/* ================= CineP2P - player imediato + controles ================= */

.player{position:fixed;inset:0;z-index:120;background:#000;display:flex;align-items:center;justify-content:center}
.player video{width:100%;height:100%;max-height:100%;object-fit:contain;background:#000}

.pv-btn{
  border:0;background:rgba(0,0,0,.42);color:#fff;border-radius:50%;
  width:44px;height:44px;display:grid;place-items:center;cursor:pointer;
  transition:background .15s, transform .12s;flex:0 0 auto;
}
.pv-btn:active{transform:scale(.92);background:rgba(255,255,255,.18)}
.pv-btn.pv-txt{width:auto;border-radius:999px;padding:0 16px;font-weight:700;font-size:13.5px}
.pv-btn.pv-cc{font-weight:800;font-size:13px;letter-spacing:.5px}
.pv-btn.ativo{background:var(--brand);color:#fff}
.pv-btn:disabled{opacity:.4}

.pv-top{
  position:absolute;top:0;left:0;right:0;z-index:5;
  display:flex;align-items:center;gap:10px;padding:10px 12px;
  padding-top:calc(10px + env(safe-area-inset-top));
  background:linear-gradient(180deg,rgba(0,0,0,.85),transparent);
  transition:opacity .25s;
}
.pv-title{flex:1;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 2px 8px #000}

.pv-center{
  position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:14px;text-align:center;padding:30px;
  background:radial-gradient(600px 400px at 50% 50%, rgba(20,24,34,.9), #000 75%);
  transition:opacity .3s, visibility .3s;
}
.pv-center.oculto{opacity:0;visibility:hidden}
.pv-msg{margin:0;font-size:15px;font-weight:600}
.pv-stats{margin:0;font-size:12.5px;color:#9aa2b1}
.pv-fonte{margin:0;font-size:11.5px;color:#5f6878;max-width:80vw;line-height:1.5}
.pv-bar{width:min(340px,78vw);height:6px;border-radius:99px;background:#20242e;overflow:hidden}
.pv-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--brand),#ff7b73);transition:width .3s}
.pv-spinner{
  width:40px;height:40px;border-radius:50%;
  border:3px solid rgba(255,255,255,.14);border-top-color:var(--brand);
  animation:girar .85s linear infinite;
}
@keyframes girar{to{transform:rotate(360deg)}}
.pv-erro{color:#ff8f88;font-size:13.5px;line-height:1.6;max-width:420px}

.pv-bottom{
  position:absolute;left:0;right:0;bottom:0;z-index:5;
  padding:10px 14px calc(14px + env(safe-area-inset-bottom));
  background:linear-gradient(0deg,rgba(0,0,0,.92),transparent);
  transition:opacity .25s;
}
.pv-seek{position:relative;height:26px;display:flex;align-items:center;cursor:pointer;touch-action:none}
.pv-seek-track{position:relative;width:100%;height:5px;border-radius:99px;background:rgba(255,255,255,.22);overflow:hidden}
.pv-seek-track i{display:block;height:100%;width:0;background:var(--brand)}
.pv-seek-knob{
  position:absolute;top:50%;left:0;width:14px;height:14px;border-radius:50%;
  background:#fff;transform:translate(-50%,-50%);box-shadow:0 2px 8px rgba(0,0,0,.7);
  pointer-events:none;
}
.pv-row{display:flex;align-items:center;gap:6px;margin-top:4px}
.pv-time{font-size:12.5px;color:#c8cfda;margin-left:6px;font-variant-numeric:tabular-nums}
.pv-spacer{flex:1}

.player.controles-ocultos .pv-top,
.player.controles-ocultos .pv-bottom{opacity:0;pointer-events:none}
.player.controles-ocultos{cursor:none}

.pv-sheet{
  position:absolute;right:0;top:0;bottom:0;z-index:9;width:min(420px,92vw);
  background:rgba(12,13,17,.97);backdrop-filter:blur(10px);
  border-left:1px solid #24272f;display:flex;flex-direction:column;
  animation:entrarSheet .18s ease;
}
@keyframes entrarSheet{from{transform:translateX(30px);opacity:.5}to{transform:translateX(0);opacity:1}}
.pv-sheet-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #24272f}
.pv-sheet-body{flex:1;overflow:auto;padding:12px 14px 30px}
.pv-fonte-item{
  display:flex;justify-content:space-between;align-items:center;gap:10px;
  padding:11px 12px;border:1px solid #24272f;border-radius:11px;margin-bottom:8px;
  background:rgba(255,255,255,.02);cursor:pointer;
}
.pv-fonte-item.atual{border-color:var(--brand);background:rgba(229,9,20,.12)}
.pv-fonte-item:active{background:rgba(255,255,255,.07)}
.pv-fonte-nome{font-size:12.5px;color:#d9dfe9;line-height:1.35;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pv-fonte-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;font-size:11px;color:#9aa2b1}
.pv-badge{font-weight:800;padding:2px 7px;border-radius:6px;background:rgba(51,198,255,.16);color:var(--accent)}
.pv-badge.br{background:rgba(61,220,132,.18);color:var(--ok)}
.pv-badge.ruim{background:rgba(255,255,255,.08);color:#8d95a5}
.pv-legenda-item{display:flex;justify-content:space-between;padding:13px;border-radius:11px;margin-bottom:6px;cursor:pointer;border:1px solid #24272f}
.pv-legenda-item.atual{border-color:var(--brand);background:rgba(229,9,20,.12)}
.pv-vazio{color:#9aa2b1;font-size:13px;text-align:center;padding:26px 10px;line-height:1.6}

@media (min-width:860px){
  .pv-time{font-size:13.5px}
  .pv-btn{width:48px;height:48px}
  .player:fullscreen .pv-center{background:radial-gradient(700px 500px at 50% 50%, rgba(20,24,34,.92), #000 78%)}
}
'@
Write-ProjectFile 'public/player.css' $playerCss

# ----------------------------------------------------------------------
$appJs = @'
'use strict';

/* =====================================================================
   CineP2P 4.0 - frontend vanilla (mobile-first, Capacitor-ready)
   Player abre IMEDIATAMENTE; toda a informacao tecnica fica dentro do video.
   ===================================================================== */

const API_BASE = String(window.CINEP2P_API_BASE || '').replace(/\/+$/, '');
const PLACEHOLDER = '/placeholder.svg';

const $ = function (s, r) { return (r || document).querySelector(s); };
const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

const LS = {
  get: function (k, d) { try { const v = window.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set: function (k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
  del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { } }
};

const K = { lista: 'cinep2p:lista', historico: 'cinep2p:historico', continuar: 'cinep2p:continuar', tipo: 'cinep2p:tipo' };

const state = {
  view: 'inicio',
  tipo: LS.get(K.tipo, 'movie'),
  generos: [],
  media: null,
  job: null,
  poll: null,
  podeTocar: false,
  streamUrl: null,
  buscaTimer: null,
  ultimoSalvar: 0,
  fontes: [],
  melhor: null,
  subs: [],
  legendaAtiva: null,
  esconderTimer: null,
  arrastandoSeek: false
};

const els = {
  hero: $('#hero'), rows: $('#rows'),
  searchInput: $('#searchInput'), searchResults: $('#searchResults'),
  listaGrid: $('#listaGrid'), historicoGrid: $('#historicoGrid'),
  categoriasChips: $('#categoriasChips'), categoriasGrid: $('#categoriasGrid'),
  modal: $('#modal'), modalBody: $('#modalBody'),
  toast: $('#toast'), drawer: $('#drawer'), drawerBackdrop: $('#drawerBackdrop'),
  tipoToggle: $('#tipoToggle'),
  player: $('#player'), video: $('#video'),
  pvTop: $('#pvTop'), pvBottom: $('#pvBottom'), pvCenter: $('#pvCenter'),
  pvTitle: $('#pvTitle'), pvMsg: $('#pvMsg'), pvStats: $('#pvStats'), pvFill: $('#pvFill'),
  pvFonte: $('#pvFonte'), pvTime: $('#pvTime'), pvProgress: $('#pvProgress'), pvKnob: $('#pvKnob'),
  pvSeek: $('#pvSeek'), pvSheet: $('#pvSheet'), pvSheetBody: $('#pvSheetBody'), pvSheetTitle: $('#pvSheetTitle'),
  icoPlay: $('#icoPlay'), icoPause: $('#icoPause'), icoVol: $('#icoVol'), icoMudo: $('#icoMudo')
};

/* ------------------------------ utils ------------------------------ */

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function fmtSize(b) {
  const n = Number(b);
  if (!n || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v = v / 1024; i++; }
  return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}

function fmtSpeed(b) { const n = Number(b); return n > 0 ? fmtSize(n) + '/s' : '0 B/s'; }

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
}

let toastTimer = null;
function toast(msg, tipo) {
  els.toast.textContent = msg;
  els.toast.className = 'toast' + (tipo === 'error' ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { els.toast.classList.add('hidden'); }, 4600);
}

function url(path, params) {
  const u = new URL(API_BASE + path, API_BASE ? API_BASE + '/' : window.location.origin);
  if (params) {
    Object.keys(params).forEach(function (k) {
      const v = params[k];
      if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
    });
  }
  return u.toString();
}

async function api(path, params) {
  const res = await fetch(url(path, params));
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) throw new Error(data.error || ('Erro HTTP ' + res.status));
  return data;
}

/* ------------------------------ cards ------------------------------ */

function cardHtml(item, opts) {
  const o = opts || {};
  const prog = (o.progresso && item.progresso)
    ? '<div class="card-progress"><i style="width:' + Math.min(100, item.progresso) + '%"></i></div>' : '';
  const img = '<img loading="lazy" src="' + esc(item.poster || item.backdrop || PLACEHOLDER) +
    '" alt="' + esc(item.titulo || '') + '" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'">';
  return '<button class="card" data-card data-id="' + esc(item.id) + '" data-tipo="' + esc(item.tipo || 'movie') + '">' +
      '<div class="card-img">' + img + prog + '</div>' +
      '<div class="card-meta"><span>' + esc(item.ano || '') + '</span>' +
      (item.nota ? '<span>&#9733; ' + item.nota.toFixed(1) + '</span>' : '') + '</div>' +
      '<div class="card-title">' + esc(item.titulo || '') + '</div>' +
    '</button>';
}

function gridHtml(itens, opts) {
  if (!itens || !itens.length) return '<p class="vazio">Nada por aqui ainda.</p>';
  return itens.map(function (i) { return cardHtml(i, opts); }).join('');
}

/* ------------------------------ views ------------------------------ */

function setView(nome) {
  state.view = nome;
  ['inicio', 'buscar', 'lista', 'historico', 'categorias'].forEach(function (v) {
    const el = $('#view-' + v);
    if (el) el.classList.toggle('hidden', v !== nome);
  });
  $$('.nav-link, .bn-item').forEach(function (b) { b.classList.toggle('active', b.dataset.view === nome); });
  window.scrollTo({ top: 0 });
  if (nome === 'lista') renderLista();
  if (nome === 'historico') renderHistorico();
  if (nome === 'categorias') renderCategorias();
  if (nome === 'buscar') setTimeout(function () { els.searchInput.focus(); }, 120);
}

function abrirDrawer() { els.drawer.classList.remove('hidden'); els.drawerBackdrop.classList.remove('hidden'); }
function fecharDrawer() { els.drawer.classList.add('hidden'); els.drawerBackdrop.classList.add('hidden'); }

/* ------------------------------- home ------------------------------ */

function skeleton() {
  let html = '';
  for (let i = 0; i < 3; i++) {
    html += '<div class="row"><div class="sk sk-title"></div><div class="scroller">';
    for (let j = 0; j < 6; j++) html += '<div class="sk sk-card"></div>';
    html += '</div></div>';
  }
  return html;
}

function renderHero(item) {
  if (!item) { els.hero.innerHTML = ''; els.hero.style.backgroundImage = 'none'; return; }
  els.hero.style.backgroundImage = 'url("' + (item.backdrop || item.poster || PLACEHOLDER) + '")';
  els.hero.innerHTML =
    '<div class="hero-inner">' +
      '<p class="hero-kicker">Destaque de hoje</p>' +
      '<h1 class="hero-title">' + esc(item.titulo) + '</h1>' +
      '<p class="hero-meta">' + esc(item.ano || '') +
        (item.nota ? ' &middot; &#9733; ' + item.nota.toFixed(1) : '') + '</p>' +
      '<p class="hero-sinopse">' + esc(item.sinopse || '') + '</p>' +
      '<div class="hero-actions">' +
        '<button class="btn primary" id="heroAssistir">Assistir agora</button>' +
        '<button class="btn ghost" id="heroTrailer">Assistir trailer</button>' +
        '<button class="btn ghost" id="heroFavoritar">Favoritar</button>' +
      '</div>' +
    '</div>';
  $('#heroAssistir').addEventListener('click', function () { assistir(item); });
  $('#heroTrailer').addEventListener('click', function () { abrirDetalhes(item.tipo || 'movie', item.id, true); });
  $('#heroFavoritar').addEventListener('click', function () { alternarFavorito(item); });
}

function rowHtml(titulo, itens, opts) {
  return '<section class="row"><h2>' + esc(titulo) + '</h2><div class="scroller">' +
    itens.map(function (i) { return cardHtml(i, opts); }).join('') + '</div></section>';
}

async function carregarInicio() {
  els.rows.innerHTML = skeleton();
  try {
    const data = await api('/api/home', { tipo: state.tipo });
    renderHero(data.hero);
    let html = '';
    const continuar = LS.get(K.continuar, []);
    if (continuar.length) html += rowHtml('Continue Assistindo', continuar, { progresso: true });
    data.rows.forEach(function (r) { html += rowHtml(r.titulo, r.itens, {}); });
    els.rows.innerHTML = html || '<p class="vazio">Sem resultados.</p>';
  } catch (e) {
    els.rows.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>';
    if (/TMDB_API_KEY/.test(e.message)) mostrarAviso();
    toast(e.message, 'error');
  }
}

function mostrarAviso() {
  if ($('#aviso')) return;
  const div = document.createElement('div');
  div.id = 'aviso';
  div.className = 'aviso';
  div.innerHTML = 'Configure a chave do TMDb no <code>.env</code>: <code>TMDB_API_KEY=sua_chave</code> e reinicie.';
  els.rows.parentNode.insertBefore(div, els.rows);
}

/* ------------------------------ buscar ----------------------------- */

async function buscar(termo) {
  const q = String(termo || '').trim();
  if (q.length < 2) { els.searchResults.innerHTML = ''; return; }
  els.searchResults.innerHTML = '<p class="vazio">Buscando...</p>';
  try {
    const data = await api('/api/buscar', { q: q, tipo: state.tipo });
    els.searchResults.innerHTML = gridHtml(data.itens, {});
  } catch (e) { els.searchResults.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>'; }
}

/* ----------------------- lista / historico / cats ------------------ */

function renderLista() { els.listaGrid.innerHTML = gridHtml(LS.get(K.lista, []), {}); }
function renderHistorico() { els.historicoGrid.innerHTML = gridHtml(LS.get(K.historico, []), { progresso: true }); }

function renderCategorias() {
  els.categoriasChips.innerHTML = state.generos.map(function (g) {
    return '<button class="chip" data-genero="' + g.id + '">' + esc(g.nome) + '</button>';
  }).join('') || '<p class="vazio">Carregando...</p>';
  $$('#categoriasChips .chip').forEach(function (b) {
    b.addEventListener('click', function () { abrirGenero(b.dataset.genero, b.textContent); });
  });
}

async function abrirGenero(id, nome) {
  els.categoriasGrid.innerHTML = '<p class="vazio">Carregando ' + esc(nome) + '...</p>';
  try {
    const data = await api('/api/filmes/genero/' + id, { tipo: state.tipo });
    els.categoriasGrid.innerHTML = gridHtml(data.itens, {});
  } catch (e) { els.categoriasGrid.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>'; }
}

function chaveItem(i) { return (i.tipo || 'movie') + ':' + i.id; }
function resumo(i) {
  return { id: i.id, tipo: i.tipo || 'movie', titulo: i.titulo, poster: i.poster, backdrop: i.backdrop, ano: i.ano, nota: i.nota };
}

function alternarFavorito(item) {
  const lista = LS.get(K.lista, []);
  const chave = chaveItem(item);
  if (lista.some(function (i) { return chaveItem(i) === chave; })) {
    LS.set(K.lista, lista.filter(function (i) { return chaveItem(i) !== chave; }));
    toast('Removido da Minha Lista');
  } else {
    lista.unshift(resumo(item));
    LS.set(K.lista, lista.slice(0, 120));
    toast('Adicionado a Minha Lista');
  }
  if (state.view === 'lista') renderLista();
}

function marcarHistorico(item) {
  const h = LS.get(K.historico, []).filter(function (i) { return chaveItem(i) !== chaveItem(item); });
  h.unshift(Object.assign(resumo(item), { atualizado: Date.now() }));
  LS.set(K.historico, h.slice(0, 80));
}

function salvarProgresso(seg, dur) {
  if (!state.media || !dur) return;
  const pct = Math.min(100, (seg / dur) * 100);
  if (pct < 1 || pct > 98) return;
  const chave = chaveItem(state.media);
  const lista = LS.get(K.continuar, []).filter(function (i) { return chaveItem(i) !== chave; });
  lista.unshift(Object.assign(resumo(state.media), { progresso: pct, atualizado: Date.now() }));
  LS.set(K.continuar, lista.slice(0, 15));
}

/* ------------------------------ detalhes --------------------------- */

function abrirModal(html) {
  els.modalBody.innerHTML = html;
  els.modal.classList.remove('hidden');
  document.body.classList.add('no-scroll');
}
function fecharModal() {
  els.modal.classList.add('hidden');
  els.modalBody.innerHTML = '';
  if (els.player.classList.contains('hidden')) document.body.classList.remove('no-scroll');
}

async function abrirDetalhes(tipo, id, abrirTrailer) {
  abrirModal('<p class="vazio">Carregando...</p>');
  try {
    const m = await api('/api/media/' + tipo + '/' + id);
    state.media = m;
    renderDetalhes(m, abrirTrailer);
  } catch (e) { abrirModal('<p class="vazio">' + esc(e.message) + '</p>'); }
}

function renderDetalhes(m, abrirTrailer) {
  const generos = (m.generos || []).map(function (g) { return g.nome; }).join(' &middot; ');
  const elenco = (m.elenco || []).map(function (c) {
    return '<div class="elenco-item"><div class="elenco-foto">' +
      (c.foto ? '<img loading="lazy" src="' + esc(c.foto) + '" alt="' + esc(c.nome) + '" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'">' : '') +
      '</div><span>' + esc(c.nome) + '</span></div>';
  }).join('');

  els.modalBody.innerHTML =
    '<div class="details" style="--bd:url(\'' + (m.backdrop || m.poster || PLACEHOLDER) + '\')">' +
      '<div class="details-top">' +
        '<div class="details-poster"><img src="' + esc(m.poster || PLACEHOLDER) + '" alt="' + esc(m.titulo) + '" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'"></div>' +
        '<div class="details-head">' +
          '<h2>' + esc(m.titulo) + '</h2>' +
          '<p class="details-meta">' + esc(m.ano || '') +
            (m.nota ? ' &middot; &#9733; ' + m.nota.toFixed(1) : '') +
            (m.duracao ? ' &middot; ' + m.duracao + ' min' : '') +
            (m.tipo === 'tv' ? ' &middot; Serie' : '') + '</p>' +
          (generos ? '<p class="details-gen">' + generos + '</p>' : '') +
        '</div>' +
      '</div>' +
      '<div class="details-body">' +
        '<p class="details-sinopse">' + esc(m.sinopse || 'Sinopse nao disponivel.') + '</p>' +
        '<div class="details-actions">' +
          '<button class="btn primary big" id="btnAssistir">Assistir agora</button>' +
          '<div class="linha">' +
            (m.trailer ? '<button class="btn ghost" id="btnTrailer">Trailer</button>' : '') +
            '<button class="btn ghost" id="btnFavoritar">Favoritar</button>' +
            (m.imdbId ? '<a class="btn ghost" target="_blank" rel="noreferrer" href="https://www.imdb.com/title/' + esc(m.imdbId) + '/">IMDb</a>' : '') +
          '</div>' +
        '</div>' +
        (elenco ? '<div class="elenco"><h3>Elenco</h3><div class="elenco-list">' + elenco + '</div></div>' : '') +
      '</div>' +
    '</div>';

  $('#btnAssistir').addEventListener('click', function () { fecharModal(); assistir(m); });
  if ($('#btnTrailer')) $('#btnTrailer').addEventListener('click', function () { mostrarTrailer(m.trailer); });
  $('#btnFavoritar').addEventListener('click', function () { alternarFavorito(m); });
  if (abrirTrailer && m.trailer) mostrarTrailer(m.trailer);
}

function mostrarTrailer(trailer) {
  if (!trailer) return;
  const box = document.createElement('div');
  box.className = 'trailer';
  box.innerHTML = '<iframe src="https://www.youtube.com/embed/' + esc(trailer.key) +
    '?autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
  els.modalBody.appendChild(box);
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* =============================== PLAYER ============================ */

function abrirPlayer(titulo) {
  state.podeTocar = false;
  state.streamUrl = null;
  state.subs = [];
  state.legendaAtiva = null;
  els.video.removeAttribute('src');
  $$('#video track').forEach(function (t) { t.remove(); });
  els.video.load();
  els.pvTitle.textContent = titulo || 'Reproduzindo';
  els.pvCenter.classList.remove('oculto');
  els.pvCenter.innerHTML =
    '<div class="pv-spinner"></div>' +
    '<p class="pv-msg" id="pvMsg">Buscando fontes PT-BR...</p>' +
    '<div class="pv-bar"><i id="pvFill"></i></div>' +
    '<p class="pv-stats" id="pvStats"></p>' +
    '<p class="pv-fonte" id="pvFonte"></p>';
  els.pvMsg = $('#pvMsg'); els.pvStats = $('#pvStats'); els.pvFill = $('#pvFill'); els.pvFonte = $('#pvFonte');
  els.pvFill.style.width = '0%';
  els.pvStats.textContent = '';
  els.pvFonte.textContent = '';
  els.pvProgress.style.width = '0%';
  els.pvKnob.style.left = '0%';
  els.pvTime.textContent = '0:00 / 0:00';
  els.pvSheet.classList.add('hidden');
  els.player.classList.remove('hidden', 'controles-ocultos');
  document.body.classList.add('no-scroll');
  mostrarControles();
}

function fecharPlayer() {
  if (state.job) {
    const jobId = state.job;
    state.job = null;
    fetch(url('/api/play/stop', { jobId: jobId }), { keepalive: true }).catch(function () { });
  }
  clearTimeout(state.poll);
  clearTimeout(state.esconderTimer);
  try { els.video.pause(); } catch (e) { }
  els.video.removeAttribute('src');
  els.video.load();
  els.player.classList.add('hidden');
  els.player.classList.remove('controles-ocultos');
  document.body.classList.remove('no-scroll');
  if (state.view === 'inicio') carregarInicio();
}

/** Clicou em assistir: player aparece JÁ, sem modal nenhum. */
async function assistir(media) {
  state.media = media;
  marcarHistorico(media);
  abrirPlayer(media.titulo);

  const params = {
    titulo: media.titulo,
    tituloOriginal: media.tituloOriginal,
    ano: media.ano,
    imdbId: media.imdbId,
    tipo: media.tipo
  };

  try {
    const data = await api('/api/torrent', params);
    state.fontes = data.fontes || [];
    state.melhor = data.melhor;
    if (!state.melhor) {
      erroPlayer('Nenhum torrent encontrado. Tente pelo titulo original.');
      return;
    }
    els.pvFonte.textContent = 'Fonte selecionada: ' + state.melhor.source + ' - ' + (state.melhor.ptbr ? state.melhor.ptbr.audio : '');
    iniciarJob(state.melhor);
  } catch (e) {
    erroPlayer(e.message);
  }
}

async function iniciarJob(fonte) {
  if (!fonte) return;
  if (state.job) {
    const antigo = state.job;
    state.job = null;
    fetch(url('/api/play/stop', { jobId: antigo }), { keepalive: true }).catch(function () { });
  }
  clearTimeout(state.poll);
  state.podeTocar = false;
  state.legendaAtiva = null;
  state.subs = [];
  els.video.removeAttribute('src');
  $$('#video track').forEach(function (t) { t.remove(); });
  els.video.load();
  els.pvCenter.classList.remove('oculto');
  els.pvMsg.textContent = 'Conectando aos peers...';
  els.pvFill.style.width = '0%';

  try {
    const data = await api('/api/play', {
      magnet: fonte.magnet,
      fileIdx: fonte.fileIdx,
      titulo: fonte.title,
      qualidade: fonte.quality
    });
    state.job = data.jobId;
    poll();
  } catch (e) { erroPlayer(e.message); }
}

function erroPlayer(msg) {
  clearTimeout(state.poll);
  els.pvCenter.classList.remove('oculto');
  els.pvCenter.innerHTML =
    '<p class="pv-erro">' + esc(msg) + '</p>' +
    '<button class="btn small" id="pvOutraFonte">Escolher outra fonte</button>' +
    '<button class="btn small ghost" id="pvSair">Sair</button>';
  $('#pvOutraFonte').addEventListener('click', function () { abrirSheetFontes(); });
  $('#pvSair').addEventListener('click', fecharPlayer);
}

function atualizarOverlay(s) {
  if (s.canPlay && !state.podeTocar) {
    state.podeTocar = true;
    state.streamUrl = s.streamUrl;
    if (API_BASE) els.video.crossOrigin = 'anonymous';
    els.video.src = API_BASE + s.streamUrl;
    const p = els.video.play();
    if (p && p.catch) p.catch(function () { });
    carregarLegendas();
  }

  els.pvFill.style.width = Math.max(2, Math.min(100, s.buffer || 0)).toFixed(0) + '%';

  if (!state.podeTocar) {
    els.pvMsg.textContent = s.message || 'Conectando aos peers...';
    els.pvStats.textContent = (s.buffer || 0).toFixed(1) + '% do buffer | ' + s.peers + ' peers | ' +
      fmtSpeed(s.speed) + ' | ' + fmtSize(s.downloaded) + ' de ' + fmtSize(s.total) + ' | ' + s.elapsed + 's';
  } else {
    els.pvMsg.textContent = 'Iniciando...';
    els.pvStats.textContent = s.peers + ' peers | ' + fmtSpeed(s.speed);
  }
}

async function poll() {
  if (!state.job) return;
  try {
    const s = await api('/api/play/status', { jobId: state.job });
    atualizarOverlay(s);
    if (s.state === 'erro') { erroPlayer(s.message); return; }
  } catch (e) { erroPlayer(e.message); return; }
  state.poll = setTimeout(poll, state.podeTocar ? 2500 : 850);
}

/* ----------------------------- legendas ---------------------------- */

async function carregarLegendas() {
  if (!state.job) return;
  try {
    const data = await api('/api/play/subs', { jobId: state.job });
    state.subs = data.subs || [];
    if (state.subs.length) {
      const pt = state.subs.filter(function (s) { return s.code === 'pt-BR'; })[0];
      aplicarLegenda(pt ? pt.idx : null);
    }
  } catch (e) { }
}

function aplicarLegenda(idx) {
  $$('#video track').forEach(function (t) { t.remove(); });
  state.legendaAtiva = idx;
  if (idx === null || idx === undefined) return;
  const s = state.subs.filter(function (x) { return x.idx === idx; })[0];
  if (!s) return;
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = s.label;
  track.srclang = s.code;
  track.src = API_BASE + '/api/play/subtitle?jobId=' + state.job + '&idx=' + s.idx;
  track.default = true;
  els.video.appendChild(track);
  setTimeout(function () { try { if (track.track) track.track.mode = 'showing'; } catch (e) { } }, 120);
}

/* ------------------------------ sheets ----------------------------- */

function abrirSheet(titulo, html) {
  els.pvSheetTitle.textContent = titulo;
  els.pvSheetBody.innerHTML = html;
  els.pvSheet.classList.remove('hidden');
  mostrarControles();
}

function abrirSheetFontes() {
  if (!state.fontes.length) { abrirSheet('Fontes', '<p class="pv-vazio">Nenhuma fonte carregada.</p>'); return; }
  const html = state.fontes.map(function (f, i) {
    const atual = state.melhor && f.hash === state.melhor.hash ? ' atual' : '';
    const nivel = f.ptbr ? f.ptbr.nivel : 'desconhecido';
    const cls = nivel === 'confirmado' || nivel === 'provavel' ? 'br' : (nivel === 'estrangeiro' ? 'ruim' : '');
    return '<div class="pv-fonte-item' + atual + '" data-fonte-idx="' + i + '">' +
        '<div><div class="pv-fonte-nome">' + esc(f.title) + '</div>' +
          '<div class="pv-fonte-tags">' +
            '<span class="pv-badge">' + esc(f.quality || 'SD') + '</span>' +
            '<span class="pv-badge ' + cls + '">' + esc(f.ptbr ? f.ptbr.audio : '') + '</span>' +
            (f.size ? '<span>' + esc(f.size) + '</span>' : '') +
            '<span>' + f.seeders + ' seeds</span><span>' + esc(f.source) + '</span>' +
          '</div>' +
        '</div>' +
        '<button class="btn small' + (atual ? ' primary' : '') + '">' + (atual ? 'Atual' : 'Usar') + '</button>' +
      '</div>';
  }).join('');
  abrirSheet('Fontes (' + state.fontes.length + ')', html);
  $$('#pvSheetBody [data-fonte-idx]').forEach(function (n) {
    n.addEventListener('click', function () {
      const f = state.fontes[Number(n.dataset.fonteIdx)];
      state.melhor = f;
      els.pvSheet.classList.add('hidden');
      els.pvFonte.textContent = 'Fonte: ' + f.source + ' - ' + (f.ptbr ? f.ptbr.audio : '');
      iniciarJob(f);
    });
  });
}

function abrirSheetLegendas() {
  if (!state.subs.length) { abrirSheet('Legendas', '<p class="pv-vazio">Nenhuma legenda encontrada dentro do torrent.</p>'); return; }
  const itens = [{ idx: null, label: 'Desativado', code: '' }].concat(state.subs);
  const html = itens.map(function (s) {
    const atual = (state.legendaAtiva === s.idx) ? ' atual' : '';
    return '<div class="pv-legenda-item' + atual + '" data-legenda="' + (s.idx === null ? '' : s.idx) + '">' +
      '<span>' + esc(s.label) + '</span><span>' + esc(s.code) + '</span></div>';
  }).join('');
  abrirSheet('Legendas', html);
  $$('#pvSheetBody [data-legenda]').forEach(function (n) {
    n.addEventListener('click', function () {
      const v = n.dataset.legenda;
      aplicarLegenda(v === '' ? null : Number(v));
      els.pvSheet.classList.add('hidden');
      toast(v === '' ? 'Legenda desativada' : 'Legenda ativada');
    });
  });
}

/* ----------------------------- controles --------------------------- */

function mostrarControles() {
  els.player.classList.remove('controles-ocultos');
  clearTimeout(state.esconderTimer);
  if (!els.video.paused && !els.pvSheet.classList.contains('hidden') === false) { /* noop */ }
  state.esconderTimer = setTimeout(function () {
    if (!els.video.paused && els.pvSheet.classList.contains('hidden')) {
      els.player.classList.add('controles-ocultos');
    }
  }, 3400);
}

function alternarPlay() {
  if (els.video.paused) { const p = els.video.play(); if (p && p.catch) p.catch(function () { }); }
  else els.video.pause();
}

function pular(segundos) {
  if (!isFinite(els.video.duration)) return;
  els.video.currentTime = Math.max(0, Math.min(els.video.duration - 1, els.video.currentTime + segundos));
  mostrarControles();
}

function atualizarTempo() {
  const dur = isFinite(els.video.duration) ? els.video.duration : 0;
  const pct = dur ? (els.video.currentTime / dur) * 100 : 0;
  els.pvProgress.style.width = pct + '%';
  els.pvKnob.style.left = pct + '%';
  els.pvTime.textContent = fmtTime(els.video.currentTime) + ' / ' + fmtTime(dur);
}

function seekPara(clientX) {
  const r = els.pvSeek.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  if (isFinite(els.video.duration)) els.video.currentTime = pct * els.video.duration;
}

/* ------------------------------ wiring ----------------------------- */

function wire() {
  $('#menuBtn').addEventListener('click', abrirDrawer);
  $('#drawerClose').addEventListener('click', fecharDrawer);
  els.drawerBackdrop.addEventListener('click', fecharDrawer);

  $$('.nav-link, .bn-item').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.dataset.view); fecharDrawer(); });
  });

  $('#brand').addEventListener('click', function (e) { e.preventDefault(); setView('inicio'); });
  $('#searchBtn').addEventListener('click', function () { setView('buscar'); });

  els.tipoToggle.addEventListener('click', function () {
    state.tipo = state.tipo === 'movie' ? 'tv' : 'movie';
    LS.set(K.tipo, state.tipo);
    els.tipoToggle.textContent = state.tipo === 'movie' ? 'Filmes' : 'Series';
    carregarInicio();
  });
  els.tipoToggle.textContent = state.tipo === 'movie' ? 'Filmes' : 'Series';

  $('#searchGo').addEventListener('click', function () { buscar(els.searchInput.value); });
  els.searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') buscar(els.searchInput.value); });
  els.searchInput.addEventListener('input', function () {
    clearTimeout(state.buscaTimer);
    state.buscaTimer = setTimeout(function () { buscar(els.searchInput.value); }, 420);
  });

  $('#limparHistorico').addEventListener('click', function () {
    LS.del(K.historico); LS.del(K.continuar); renderHistorico(); toast('Historico limpo');
  });

  document.addEventListener('click', function (e) {
    const card = e.target.closest('[data-card]');
    if (card) { abrirDetalhes(card.dataset.tipo, card.dataset.id, false); return; }
    const gen = e.target.closest('[data-genero]');
    if (gen) { abrirGenero(gen.dataset.genero, gen.textContent); return; }
    if (e.target.closest('[data-close]')) fecharModal();
  });

  /* ---- player ---- */
  $('#pvClose').addEventListener('click', fecharPlayer);
  $('#pvFontes').addEventListener('click', abrirSheetFontes);
  $('#pvSheetClose').addEventListener('click', function () { els.pvSheet.classList.add('hidden'); });
  $('#pvPlay').addEventListener('click', alternarPlay);
  $('#pvBack30').addEventListener('click', function () { pular(-30); });
  $('#pvFwd30').addEventListener('click', function () { pular(30); });
  $('#pvCC').addEventListener('click', abrirSheetLegendas);
  $('#pvMute').addEventListener('click', function () {
    els.video.muted = !els.video.muted;
    els.icoVol.classList.toggle('hidden', els.video.muted);
    els.icoMudo.classList.toggle('hidden', !els.video.muted);
  });
  $('#pvFull').addEventListener('click', function () {
    const alvo = els.player;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (alvo.requestFullscreen) alvo.requestFullscreen();
    else if (els.video.webkitEnterFullscreen) els.video.webkitEnterFullscreen();
  });

  els.pvSeek.addEventListener('pointerdown', function (e) {
    state.arrastandoSeek = true;
    els.pvSeek.setPointerCapture(e.pointerId);
    seekPara(e.clientX);
  });
  els.pvSeek.addEventListener('pointermove', function (e) { if (state.arrastandoSeek) seekPara(e.clientX); });
  els.pvSeek.addEventListener('pointerup', function () { state.arrastandoSeek = false; });
  els.pvSeek.addEventListener('pointercancel', function () { state.arrastandoSeek = false; });

  els.player.addEventListener('pointermove', mostrarControles);
  els.player.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.pv-bottom') || e.target.closest('.pv-top') || e.target.closest('.pv-sheet')) { mostrarControles(); return; }
    if (!els.player.classList.contains('controles-ocultos')) els.player.classList.add('controles-ocultos');
    else mostrarControles();
  });

  els.video.addEventListener('play', function () {
    els.icoPlay.classList.add('hidden');
    els.icoPause.classList.remove('hidden');
    mostrarControles();
  });
  els.video.addEventListener('pause', function () {
    els.icoPlay.classList.remove('hidden');
    els.icoPause.classList.add('hidden');
    mostrarControles();
  });
  els.video.addEventListener('playing', function () {
    els.pvCenter.classList.add('oculto');
    mostrarControles();
  });
  els.video.addEventListener('waiting', function () {
    if (state.podeTocar) {
      els.pvCenter.classList.remove('oculto');
      els.pvMsg.textContent = 'Carregando mais dados...';
      els.pvStats.textContent = '';
    }
  });
  els.video.addEventListener('timeupdate', function () {
    atualizarTempo();
    const agora = Date.now();
    if (agora - state.ultimoSalvar < 5000) return;
    state.ultimoSalvar = agora;
    if (els.video.duration) salvarProgresso(els.video.currentTime, els.video.duration);
  });
  els.video.addEventListener('loadedmetadata', atualizarTempo);
  els.video.addEventListener('error', function () {
    if (state.podeTocar) toast('O navegador nao reproduziu este arquivo. Use "Fontes" para trocar ou abra no VLC.', 'error');
  });

  document.addEventListener('keydown', function (e) {
    if (!els.player.classList.contains('hidden')) {
      if (e.key === 'Escape') fecharPlayer();
      if (e.key === ' ') { e.preventDefault(); alternarPlay(); }
      if (e.key === 'ArrowLeft') pular(-30);
      if (e.key === 'ArrowRight') pular(30);
      if (e.key === 'f' || e.key === 'F') $('#pvFull').click();
      return;
    }
    if (e.key === 'Escape') { if (!els.modal.classList.contains('hidden')) fecharModal(); else fecharDrawer(); }
  });

  window.addEventListener('pagehide', function () {
    if (state.job) {
      const u = url('/api/play/stop', { jobId: state.job });
      if (navigator.sendBeacon) navigator.sendBeacon(u); else fetch(u, { keepalive: true }).catch(function () { });
    }
  });
}

/* -------------------------------- init ----------------------------- */

async function init() {
  wire();
  try {
    const cfg = await api('/api/config');
    if (!cfg.tmdbConfigurado) mostrarAviso();
    const g = await api('/api/generos', { tipo: state.tipo });
    state.generos = g.generos || [];
  } catch (e) { if (/TMDB_API_KEY/.test(e.message)) mostrarAviso(); }
  carregarInicio();
  renderLista();
  renderHistorico();
}

init();
'@
Write-ProjectFile 'public/app.js' $appJs

# ======================================================================
Write-Step 'Configuracao'

# ----------------------------------------------------------------------
$envPath = Join-Path $Root '.env'
$existingKey = ''
if (Test-Path -LiteralPath $envPath) {
    $existing = [System.IO.File]::ReadAllText($envPath)
    $m = [regex]::Match($existing, '(?m)^\s*TMDB_API_KEY\s*=\s*(.*)$')
    if ($m.Success) { $existingKey = $m.Groups[1].Value.Trim() }
}
$keyToWrite = 'SUA_CHAVE_AQUI'
if ($existingKey -ne '' -and $existingKey -ne 'SUA_CHAVE_AQUI') { $keyToWrite = $existingKey }

$envContent = @"
# ============================================================
#  CineP2P 4.0
#  TMDB_API_KEY obrigatoria. https://www.themoviedb.org/settings/api
# ============================================================
TMDB_API_KEY=$keyToWrite
TMDB_LANGUAGE=pt-BR
TMDB_REGION=BR

# Servidor (0.0.0.0 permite abrir no celular da mesma rede)
PORT=3000
HOST=0.0.0.0

# Scrapers (vazio = todos os 13 em paralelo)
SCRAPER_TIMEOUT=9
SCRAPERS_ENABLED=

# Player / buffer
METADATA_TIMEOUT=40
MAX_CONNS=200
MAX_JOBS=3
IDLE_TIMEOUT=720000
MIN_BUFFER_PERCENT=3
MIN_BUFFER_MB=8

# Legendas
MAX_SUBS=8

# Limpeza de disco: session = apaga ao fechar | keep = mantem cache
CACHE_MODE=session
TORRENT_CACHE_DIR=cache
"@
Write-ProjectFile '.env' $envContent
Write-ProjectFile '.env.example' ($envContent -replace [regex]::Escape($keyToWrite), 'SUA_CHAVE_AQUI')
if ($keyToWrite -ne 'SUA_CHAVE_AQUI') { Write-Host '  TMDB_API_KEY preservada' -ForegroundColor DarkGray }

# ----------------------------------------------------------------------
$packageJson = @'
{
  "name": "cinep2p",
  "version": "4.0.0",
  "private": true,
  "description": "Clone Netflix de streaming P2P com catalogo TMDb e selecao automatica de audio PT-BR.",
  "type": "commonjs",
  "main": "server.js",
  "scripts": { "start": "node server.js", "dev": "node server.js" },
  "engines": { "node": ">=18" },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "webtorrent": "^1.9.7"
  }
}
'@
Write-ProjectFile 'package.json' $packageJson

# ----------------------------------------------------------------------
$readme = @'
# CineP2P 4.0

Catalogo TMDb PT-BR + streaming P2P com selecao automatica de audio brasileiro.

## Rodar
1. `TMDB_API_KEY=sua_chave` no `.env`
2. `npm install`
3. `npm start` -> http://localhost:3000 (celular: http://SEU-IP:3000)

## Classificacao de audio (src/ptbr.js)
Niveis: `confirmado` > `provável` > `incerto` > `estrangeiro`.
- `confirmado`: marcador PT-BR explicito OU fonte nacional (Commandotorrents,
  Lapumia, RedeTorrent, BluDV, TorrentDosFilmes) + DUBLADO/DUAL AUDIO.
- `provável`: DUAL AUDIO limpo, ou DUBLADO sem termo estrangeiro.
- Rebaixa quando detecta dublagem alheia: russo, castellano, latino, VF,
  truefrench, english, deutsch, italiano, hindi, japones...
- So `confirmado`/`provável` podem virar "melhor fonte" automatica.

## Player
Abre imediatamente, sem modal. O buffer (peers, velocidade, %) roda dentro da
area do video. Controles: play/pause, -30s, +30s, seek, volume, fullscreen e
seletor de legendas (arquivos .srt/.ass/.vtt do proprio torrent, convertidos
para WebVTT em `/api/play/subtitle`).

## Disco
Cada job vive em `cache/<jobId>`. Ao fechar o player, sair da pagina ou trocar
de fonte: `destroy({destroyStore:true})` + rm recursivo com retry.
`CACHE_MODE=keep` mantem os arquivos.

## Endpoints
`/api/home`, `/api/filmes/*`, `/api/buscar`, `/api/media/:tipo/:id`,
`/api/torrent`, `/api/play`, `/api/play/status`, `/api/play/stream`,
`/api/play/subs`, `/api/play/subtitle`, `/api/play/stop`.

## Capacitor
`public/` e estatico e sem rotas rigidas. Edite `public/config.js` com
`window.CINEP2P_API_BASE = 'http://SEU_IP:3000'` e empacote normalmente.
'@
Write-ProjectFile 'README.md' $readme

# ======================================================================
if (-not $SkipInstall) {
    Write-Step 'Instalando dependencias'
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Push-Location -LiteralPath $Root
        try {
            & npm install --no-fund --no-audit --loglevel=error
            if ($LASTEXITCODE -ne 0) { Write-Host '  npm install com erro. Rode manualmente.' -ForegroundColor Yellow }
        } finally { Pop-Location }
    } else { Write-Host '  npm nao encontrado. Instale Node.js 18+.' -ForegroundColor Yellow }
} else { Write-Step 'npm install ignorado' }

Write-Step 'Validando'
if (Get-Command node -ErrorAction SilentlyContinue) {
    Push-Location -LiteralPath $Root
    try {
        & node -e "require('./src/ptbr');require('./src/ranking');require('./src/subtitulos');require('./src/scrapers');require('./src/magnets');require('./src/streamer');console.log('  modulos ok')"
    } catch { }
    finally { Pop-Location }
}

Write-Host ''
Write-Host '==================================================================' -ForegroundColor Green
Write-Host ' CineP2P 4.0 aplicado' -ForegroundColor Green
Write-Host '==================================================================' -ForegroundColor Green
Write-Host ''
Write-Host ' Filtro PT-BR: src/ptbr.js + src/fontes.js (5 fontes nacionais)' -ForegroundColor White
Write-Host ' Player: abre imediato, buffer interno, -30s/+30s, legendas' -ForegroundColor White
Write-Host ' Limpeza: cache/<jobId> destruido ao sair' -ForegroundColor White
Write-Host ''
Write-Host ' PROXIMOS PASSOS:' -ForegroundColor Yellow
Write-Host '   1) .env -> TMDB_API_KEY=sua_chave'
Write-Host '   2) npm start'
Write-Host '   3) http://localhost:3000'
Write-Host ''
if ($madeBackup) { Write-Host (' Backup: ' + (Split-Path -Leaf $BackupDir)) -ForegroundColor DarkGray }
Write-Host ''