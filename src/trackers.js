'use strict';

/**
 * Announce list massiva (trackers publicos atualizados).
 * Injetada em TODO magnet link e re-anunciada quando nao ha peers.
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
  'https://tracker.gbitt.info:443/announce',
  'https://tracker.tamersunion.org:443/announce',
  'https://tracker.imgoingto.icu:443/announce',
  'https://tracker.lilithraws.org:443/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.files.fm:7073/announce'
];

function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item) continue;
    const key = String(item).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function extractAnnounce(magnet) {
  const out = [];
  const re = /[?&]tr=([^&]+)/g;
  let m;
  while ((m = re.exec(magnet)) !== null) {
    try { out.push(decodeURIComponent(m[1])); } catch (e) { out.push(m[1]); }
  }
  return out;
}

function magnetFromHash(hash, name, extra) {
  const parts = ['magnet:?xt=urn:btih:' + String(hash).toLowerCase()];
  if (name) {
    const dn = String(name).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (dn) parts.push('dn=' + encodeURIComponent(dn));
  }
  for (const tr of uniq((extra || []).concat(TRACKERS))) {
    parts.push('tr=' + encodeURIComponent(tr));
  }
  return parts.join('&');
}

function appendTrackers(magnet) {
  if (!magnet || !/^magnet:/i.test(magnet)) return magnet;
  const have = new Set(extractAnnounce(magnet).map(function (t) { return t.toLowerCase(); }));
  const missing = TRACKERS.filter(function (t) { return !have.has(t.toLowerCase()); });
  if (!missing.length) return magnet;
  let out = magnet;
  for (const tr of missing) out += '&tr=' + encodeURIComponent(tr);
  return out;
}

module.exports = { TRACKERS, magnetFromHash, appendTrackers, extractAnnounce };