'use strict';
// Превентивная защита: реальные списки вредоносных IP/подсетей.
// Сервер блокирует их ДО того, как атакующий дойдёт до ловушек. Публичные threat-intel фиды — оборона, не атака.
const UA = { 'User-Agent': 'UltraSquad/1.0 defensive blocklist (local)' };
const FEEDS = [
  { name: 'abuse.ch', url: 'https://feodotracker.abuse.ch/downloads/ipblocklist.txt' },   // C2 ботнетов
  { name: 'blocklist.de', url: 'https://lists.blocklist.de/lists/all.txt' },              // атакующие IP
  { name: 'FireHOL', url: 'https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset' } // вредоносные сети
];
function ip2int(ip) {
  const p = String(ip).split('.'); if (p.length !== 4) return null;
  let n = 0; for (const o of p) { const x = +o; if (!(x >= 0 && x <= 255)) return null; n = (n * 256 + x) >>> 0; } return n >>> 0;
}
async function fetchFeeds() {
  const ips = new Set(); const ranges = []; const counts = {};
  for (const f of FEEDS) {
    let c = 0;
    try {
      const r = await fetch(f.url, { headers: UA, signal: AbortSignal.timeout(25000) });
      if (r.ok) {
        const text = await r.text();
        for (let line of text.split(/\r?\n/)) {
          line = line.trim(); if (!line || line[0] === '#' || line[0] === ';') continue;
          line = line.split(/\s/)[0];
          if (/^\d+\.\d+\.\d+\.\d+$/.test(line)) { ips.add(line); c++; continue; }
          const m = line.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
          if (m) { const base = ip2int(m[1]), bits = +m[2]; if (base != null && bits >= 0 && bits <= 32) {
            const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
            const start = (base & mask) >>> 0, end = (start + (bits === 0 ? 0xFFFFFFFF : 2 ** (32 - bits) - 1)) >>> 0;
            ranges.push([start, end]); c++;
          } }
        }
      }
    } catch {}
    counts[f.name] = c;
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return { ips, ranges, counts, total: ips.size + ranges.length, at: Date.now() };
}
module.exports = { fetchFeeds, ip2int };
