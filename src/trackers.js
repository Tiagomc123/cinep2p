'use strict';

/**
 * Announce list MASSIVA. Toda requisicao do player sai com esta lista
 * (magnet + opcao announce do WebTorrent + re-anuncio periodico).
 * Maioria UDP para resposta imediata dos trackers.
 */
const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://9.rarbg.com:2810/announce',
  'udp://9.rarbg.to:2710/announce',
  'udp://9.rarbg.me:2730/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
  'udp://tracker.internetwarriors.net:1337/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://tracker.tryhackx.org:6969/announce',
  'udp://tracker1.bt.moack.co.kr:80/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.0x7c0.com:6969/announce',
  'udp://tracker-udp.gbitt.info:80/announce',
  'udp://tracker.zupix.top:6969/announce',
  'udp://tracker.skyts.net:6969/announce',
  'udp://tracker.dump.cl:6969/announce',
  'udp://tracker.gbitt.info:80/announce',
  'udp://tracker.ipv6tracker.ru:80/announce',
  'udp://tracker.cubonegro.lol:6969/announce',
  'udp://tracker.theoks.net:6969/announce',
  'udp://retracker01-msk-virt.corbina.net:80/announce',
  'udp://bt1.archive.org:6969/announce',
  'udp://bt2.archive.org:6969/announce',
  'udp://retracker.lanta-net.ru:2710/announce',
  'udp://open.free-tracker.ga:6969/announce',
  'udp://vibe.community:6969/announce',
  'udp://tracker.fnix.net:6969/announce',
  'udp://tracker.filemail.com:6969/announce',
  'udp://tracker.leech.ie:1337/announce',
  'udp://tracker.bitsearch.to:1337/announce',
  'udp://tracker.uw0.xyz:6969/announce',
  'udp://tracker.kuroy.me:5944/announce',
  'udp://tr.bangumi.moe:6969/announce',
  'udp://retracker.hotplug.ru:2710/announce',
  'udp://tracker.army:6969/announce',
  'udp://tracker.dix.tf:6969/announce',
  'udp://tracker.parrotsec.org:6969/announce',
  'udp://tracker.srv00.com:6969/announce',
  'udp://tracker.bittorrent.cloud:6969/announce',
  'udp://tracker.bt4g.com:2095/announce',
  'udp://tracker.nitrix.me:6969/announce',
  'udp://ipv4.tracker.harry.lu:80/announce',
  'udp://tracker.open-tracker.org:1337/announce',
  'udp://tracker2.dler.org:80/announce',
  'udp://tracker3.dler.org:2710/announce',
  'udp://tracker4.dler.org:443/announce',
  'udp://udp.tracker.projectk.org:23333/announce',
  'udp://tracker.zerobytes.xyz:1337/announce',
  'udp://tracker.darkferret.dev:6969/announce',
  'udp://tracker1.itzmx.com:8080/announce',
  'udp://tracker2.itzmx.com:6961/announce',
  'udp://tracker3.itzmx.com:6961/announce',
  'udp://tracker4.itzmx.com:2710/announce',
  'udp://tracker.corpscorp.online:80/announce',
  'udp://tracker.lintk.me:2710/announce',
  'udp://tracker.zhuqiy.com:6969/announce',
  'udp://tracker.ml:6969/announce',
  'https://tracker.gbitt.info:443/announce',
  'https://tracker.tamersunion.org:443/announce',
  'https://tracker.imgoingto.icu:443/announce',
  'https://tracker.lilithraws.org:443/announce',
  'https://tracker.foreverpirates.co:443/announce',
  'https://tracker.bt4g.com:443/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.files.fm:7073/announce'
];

function uniq(lista) {
  const vistos = new Set();
  const saida = [];
  for (const item of lista) {
    if (!item) continue;
    const chave = String(item).toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(item);
  }
  return saida;
}

function extractAnnounce(magnet) {
  const saida = [];
  const re = /[?&]tr=([^&]+)/g;
  let m;
  while ((m = re.exec(magnet)) !== null) {
    try { saida.push(decodeURIComponent(m[1])); } catch (e) { saida.push(m[1]); }
  }
  return saida;
}

function magnetFromHash(hash, nome, extra) {
  const partes = ['magnet:?xt=urn:btih:' + String(hash).toLowerCase()];
  if (nome) {
    const dn = String(nome).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (dn) partes.push('dn=' + encodeURIComponent(dn));
  }
  for (const tr of uniq((extra || []).concat(TRACKERS))) {
    partes.push('tr=' + encodeURIComponent(tr));
  }
  return partes.join('&');
}

function appendTrackers(magnet) {
  if (!magnet || !/^magnet:/i.test(magnet)) return magnet;
  const tem = new Set(extractAnnounce(magnet).map(function (t) { return t.toLowerCase(); }));
  const faltando = TRACKERS.filter(function (t) { return !tem.has(t.toLowerCase()); });
  if (!faltando.length) return magnet;
  let saida = magnet;
  for (const tr of faltando) saida += '&tr=' + encodeURIComponent(tr);
  return saida;
}

module.exports = { TRACKERS: TRACKERS, magnetFromHash: magnetFromHash, appendTrackers: appendTrackers, extractAnnounce: extractAnnounce };