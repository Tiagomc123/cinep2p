'use strict';

/**
 * Confianca por fonte.
 * nacional = true -> tracker lusofono (DUBLADO/DUAL significa PT-BR nativo)
 * multi    = true -> agregador que costuma devolver releases multilingues
 *                    (DUAL/MULTI ali quase sempre inclui faixa PT-BR)
 */
const FONTES = {
  'Torrentio':     { nacional: false, regiao: 'global', multi: true },
  'Knaben':        { nacional: false, regiao: 'global', multi: true },
  'BitSearch':     { nacional: false, regiao: 'global' },
  'TorrentsCSV':   { nacional: false, regiao: 'global' },
  'SolidTorrents': { nacional: false, regiao: 'global' },
  'ThePirateBay':  { nacional: false, regiao: 'global' },
  'BT4G':          { nacional: false, regiao: 'global' },
  'Nyaa':          { nacional: false, regiao: 'global' },
  'YTS':           { nacional: false, regiao: 'global' },
  'EZTV':          { nacional: false, regiao: 'global' },
  'TorrentGalaxy': { nacional: false, regiao: 'global' }
};

function info(nome) { return FONTES[nome] || { nacional: false, regiao: 'global' }; }

module.exports = { FONTES: FONTES, info: info };