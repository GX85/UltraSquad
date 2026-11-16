'use strict';
// Реальная разведка угроз: CISA KEV (реально эксплуатируемые уязвимости) и NVD (свежие CVE).
// Это публичные правительственные/официальные фиды — чтение, не атака.
const UA = { 'User-Agent': 'UltraSquad/1.0 threat-intel (local defensive monitor)', Accept: 'application/json' };
const sevFromCvss = s => s >= 9 ? 'critical' : s >= 7 ? 'high' : s >= 4 ? 'medium' : 'low';

// CISA Known Exploited Vulnerabilities — то, что атакуют прямо сейчас
async function cisaKev(limit = 60) {
  const r = await fetch('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('CISA ' + r.status);
  const j = await r.json();
  return (j.vulnerabilities || [])
    .slice()
    .sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''))
    .slice(0, limit)
    .map(v => ({
      cve: v.cveID, source: 'CISA KEV', kind: 'эксплуатируется',
      sev: 'critical', // в каталоге KEV — только активно эксплуатируемое
      vendor: v.vendorProject, product: v.product,
      title: `${v.vendorProject} ${v.product}: ${v.vulnerabilityName || ''}`.trim().slice(0, 140),
      desc: String(v.shortDescription || '').slice(0, 400),
      date: v.dateAdded, due: v.dueDate, ransomware: v.knownRansomwareCampaignUse === 'Known',
      url: `https://nvd.nist.gov/vuln/detail/${v.cveID}`
    }));
}

// NVD — свежие CVE за последние N дней, берём самые серьёзные
async function nvdRecent(days = 3, limit = 40) {
  const end = new Date().toISOString().slice(0, 23) + 'Z', start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 23) + 'Z';
  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate=${start}&pubEndDate=${end}&resultsPerPage=${Math.min(200, limit * 3)}`;
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('NVD ' + r.status);
  const j = await r.json();
  const out = [];
  for (const item of (j.vulnerabilities || [])) {
    const c = item.cve; if (!c) continue;
    const desc = (c.descriptions || []).find(d => d.lang === 'en');
    const m = c.metrics || {};
    const cvss = (m.cvssMetricV31 || m.cvssMetricV30 || m.cvssMetricV2 || [])[0];
    const score = cvss ? +cvss.cvssData?.baseScore || 0 : 0;
    out.push({
      cve: c.id, source: 'NVD', kind: 'CVE',
      sev: score ? sevFromCvss(score) : 'medium', score,
      title: (desc?.value || c.id).slice(0, 140), desc: String(desc?.value || '').slice(0, 400),
      date: (c.published || '').slice(0, 10), url: `https://nvd.nist.gov/vuln/detail/${c.id}`
    });
  }
  // самые серьёзные вперёд
  return out.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
}

module.exports = { cisaKev, nvdRecent };
