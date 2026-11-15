// UltraSquad — локальный сервер для агентов. Без внешних зависимостей (Node 18+).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ---------- .env ----------
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const PORT = +process.env.PORT || 7777;
const HOST = process.env.HOST || '127.0.0.1';
const OR_KEY = process.env.OPENROUTER_API_KEY || '';
const PUB = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

// ---------- хранилище ----------
const file = n => path.join(DATA, n + '.json');
const load = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
const save = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v, null, 2));

const PERMS = {
  'web.search':   'Поиск в интернете (модель :online)',
  'security.read':'Читать журнал угроз',
  'security.ban': 'Банить IP-адреса',
  'system.info':  'Видеть состояние системы',
  'agents.read':  'Видеть других агентов'
};
const DEFAULT_AGENTS = [
  { id: 'sentinel', name: 'Sentinel', role: 'Охотник за хакерами', color: '#ff3d71', icon: '🛡️',
    model: 'openai/gpt-4o-mini', temperature: 0.2, enabled: true,
    permissions: ['security.read', 'security.ban', 'system.info'],
    prompt: 'Ты Sentinel — защитный агент. Анализируй журнал угроз, находи атакующих (сканеры, брутфорс, ханипоты), объясняй кратко и банить IP только при явных признаках атаки.' },
  { id: 'scout', name: 'Scout', role: 'Разведчик / поиск', color: '#00e5ff', icon: '🔭',
    model: 'openai/gpt-4o-mini', temperature: 0.5, enabled: true,
    permissions: ['web.search'],
    prompt: 'Ты Scout — исследователь. Ищи информацию в сети, отвечай кратко со ссылками на источники.' },
  { id: 'nexus', name: 'Nexus', role: 'Координатор', color: '#b388ff', icon: '🧠',
    model: 'openai/gpt-4o-mini', temperature: 0.4, enabled: true,
    permissions: ['agents.read', 'system.info', 'security.read'],
    prompt: 'Ты Nexus — координатор отряда UltraSquad. Помогай пользователю управлять агентами и ставить им задачи.' }
];
let agents = load('agents', null) || (save('agents', DEFAULT_AGENTS), DEFAULT_AGENTS);
let events = load('events', []);
let bans = load('bans', {});
const persist = () => { save('agents', agents); save('events', events.slice(-1000)); save('bans', bans); };

// ---------- SSE ----------
const clients = new Set();
const push = (type, data) => { const s = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); };

// ---------- безопасность ----------
const HONEYPOTS = ['/wp-login.php', '/wp-admin', '/.env', '/.git/config', '/phpmyadmin', '/admin.php', '/xmlrpc.php',
  '/cgi-bin/', '/etc/passwd', '/server-status', '/actuator/health', '/shell', '/config.json', '/backup.sql'];
const SUSPICIOUS = /(\.\.\/|%2e%2e|<script|union\s+select|\bor\s+1=1|;\s*(cat|wget|curl)\s|\$\{jndi:|\/bin\/sh)/i;
const hits = new Map(); // ip -> [timestamps]
const norm = ip => (ip || '').replace(/^::ffff:/, '');

function logEvent(ev) {
  ev = { id: crypto.randomUUID().slice(0, 8), ts: Date.now(), ...ev };
  events.push(ev); if (events.length > 2000) events.shift();
  persist(); push('threat', ev); return ev;
}
function ban(ip, reason, by = 'auto') {
  if (!ip || bans[ip] || (isLocal(ip) && by !== 'sim')) return false;
  bans[ip] = { ts: Date.now(), reason, by };
  logEvent({ kind: 'ban', severity: 'high', ip, detail: `${by}: ${reason}` });
  persist(); push('bans', bans); return true;
}
function inspect(req, ip) {
  const url = decodeURIComponent((req.url || '').split('?')[0].toLowerCase());
  const raw = req.url || '';
  const ua = req.headers['user-agent'] || '';
  if (HONEYPOTS.some(h => url.startsWith(h))) {
    logEvent({ kind: 'honeypot', severity: 'high', ip, detail: `Ловушка ${url} · ${ua.slice(0, 60)}` });
    ban(ip, `ханипот ${url}`); return 'honeypot';
  }
  if (SUSPICIOUS.test(raw) || /sqlmap|nikto|nmap|masscan|zgrab|dirbuster/i.test(ua)) {
    logEvent({ kind: 'attack', severity: 'critical', ip, detail: `Подозрительный запрос: ${raw.slice(0, 80)} · ${ua.slice(0, 40)}` });
    ban(ip, 'сигнатура атаки'); return 'attack';
  }
  const now = Date.now(); const a = (hits.get(ip) || []).filter(t => now - t < 10000); a.push(now); hits.set(ip, a);
  if (a.length > 120) { logEvent({ kind: 'flood', severity: 'medium', ip, detail: `${a.length} запросов за 10 сек` }); ban(ip, 'флуд'); return 'flood'; }
  return null;
}
const isLocal = ip => ['127.0.0.1', '::1', ''].includes(ip);

// ---------- OpenRouter ----------
let modelCache = { ts: 0, list: [] };
async function orFetch(p, body) {
  if (!OR_KEY) throw new Error('OPENROUTER_API_KEY не задан в .env');
  const r = await fetch('https://openrouter.ai/api/v1' + p, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + OR_KEY, 'Content-Type': 'application/json', 'X-Title': 'UltraSquad' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || 'OpenRouter ' + r.status);
  return j;
}
async function getModels() {
  if (Date.now() - modelCache.ts < 600000 && modelCache.list.length) return modelCache.list;
  const j = await orFetch('/models');
  modelCache = { ts: Date.now(), list: j.data.map(m => ({ id: m.id, name: m.name, ctx: m.context_length, price: +m.pricing?.prompt * 1e6 || 0 })) };
  return modelCache.list;
}

// инструменты агента (проверка разрешений на сервере)
const TOOLS = {
  get_threats:  { perm: 'security.read', def: { description: 'Последние события безопасности', parameters: { type: 'object', properties: { limit: { type: 'number' } } } },
    run: a => events.slice(-(a.limit || 20)) },
  ban_ip:       { perm: 'security.ban', def: { description: 'Забанить IP-адрес атакующего', parameters: { type: 'object', properties: { ip: { type: 'string' }, reason: { type: 'string' } }, required: ['ip', 'reason'] } },
    run: a => isLocal(a.ip) ? 'Нельзя банить localhost' : { banned: ban(a.ip, a.reason, 'agent') } },
  system_info:  { perm: 'system.info', def: { description: 'Состояние сервера', parameters: { type: 'object', properties: {} } },
    run: () => sysInfo() },
  list_agents:  { perm: 'agents.read', def: { description: 'Список агентов отряда', parameters: { type: 'object', properties: {} } },
    run: () => agents.map(a => ({ id: a.id, name: a.name, role: a.role, model: a.model, enabled: a.enabled })) }
};
async function runAgent(agent, messages) {
  const tools = Object.entries(TOOLS).filter(([, t]) => agent.permissions.includes(t.perm))
    .map(([name, t]) => ({ type: 'function', function: { name, ...t.def } }));
  const model = agent.model + (agent.permissions.includes('web.search') && !agent.model.endsWith(':online') ? ':online' : '');
  const msgs = [{ role: 'system', content: agent.prompt }, ...messages];
  const used = [];
  for (let i = 0; i < 5; i++) {
    const j = await orFetch('/chat/completions', { model, messages: msgs, temperature: agent.temperature, ...(tools.length ? { tools } : {}) });
    const m = j.choices?.[0]?.message; if (!m) throw new Error('Пустой ответ модели');
    if (!m.tool_calls?.length) return { reply: m.content || '', tools: used, usage: j.usage };
    msgs.push(m);
    for (const c of m.tool_calls) {
      const t = TOOLS[c.function.name]; let out;
      if (!t || !agent.permissions.includes(t.perm)) out = 'Отказано: нет разрешения';
      else { try { out = t.run(JSON.parse(c.function.arguments || '{}')); } catch (e) { out = 'Ошибка: ' + e.message; } }
      used.push(c.function.name);
      msgs.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(out).slice(0, 6000) });
    }
  }
  return { reply: '(достигнут лимит шагов)', tools: used };
}

function sysInfo() {
  const cpus = os.cpus();
  return { host: os.hostname(), platform: os.platform(), uptime: os.uptime(), cpu: cpus[0]?.model, cores: cpus.length,
    load: os.loadavg()[0], memTotal: os.totalmem(), memFree: os.freemem(), procMem: process.memoryUsage().rss, node: process.version };
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
const json = (res, code, v) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
const body = req => new Promise(r => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });

http.createServer(async (req, res) => {
  const ip = norm(req.socket.remoteAddress);
  const url = req.url.split('?')[0];
  if (bans[ip] && !isLocal(ip)) { res.writeHead(403); return res.end('banned'); }
  const verdict = isLocal(ip) && !HONEYPOTS.some(h => url.startsWith(h)) ? null : inspect(req, ip);
  if (verdict) { // ловушка: отвечаем правдоподобно, но пусто
    res.writeHead(verdict === 'honeypot' ? 200 : 400); return res.end(verdict === 'honeypot' ? '<html><body>Login</body></html>' : 'Bad Request');
  }
  try {
    if (url.startsWith('/api/')) {
      if (!isLocal(ip) && process.env.ALLOW_REMOTE !== '1') return json(res, 403, { error: 'API только с localhost' });
      if (url === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write('retry: 2000\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
      }
      if (url === '/api/state') return json(res, 200, { agents, perms: PERMS, events: events.slice(-100), bans, sys: sysInfo(), keyOk: !!OR_KEY });
      if (url === '/api/sys') return json(res, 200, sysInfo());
      if (url === '/api/models') return json(res, 200, await getModels());
      if (url === '/api/agents' && req.method === 'POST') {
        const b = await body(req);
        const a = { id: (b.name || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + crypto.randomUUID().slice(0, 4), name: b.name || 'Agent', role: b.role || '',
          color: b.color || '#7c4dff', icon: b.icon || '🤖', model: b.model || 'openai/gpt-4o-mini', temperature: b.temperature ?? 0.5, enabled: true,
          permissions: (b.permissions || []).filter(p => p in PERMS), prompt: b.prompt || '' };
        agents.push(a); persist(); push('agents', agents); return json(res, 200, a);
      }
      const m = url.match(/^\/api\/agents\/([\w-]+)(\/chat)?$/);
      if (m) {
        const i = agents.findIndex(a => a.id === m[1]); if (i < 0) return json(res, 404, { error: 'нет такого агента' });
        if (m[2] && req.method === 'POST') {
          if (!agents[i].enabled) return json(res, 400, { error: 'Агент выключен' });
          const b = await body(req); const r = await runAgent(agents[i], (b.messages || []).slice(-20));
          return json(res, 200, r);
        }
        if (req.method === 'PUT') {
          const b = await body(req); const a = agents[i];
          for (const k of ['name', 'role', 'color', 'icon', 'model', 'temperature', 'enabled', 'prompt']) if (k in b) a[k] = b[k];
          if (b.permissions) a.permissions = b.permissions.filter(p => p in PERMS);
          persist(); push('agents', agents); return json(res, 200, a);
        }
        if (req.method === 'DELETE') { agents.splice(i, 1); persist(); push('agents', agents); return json(res, 200, { ok: true }); }
      }
      if (url === '/api/bans' && req.method === 'DELETE') { const b = await body(req); delete bans[b.ip]; persist(); push('bans', bans); return json(res, 200, bans); }
      if (url === '/api/simulate' && req.method === 'POST') { // демо-атака для проверки охотника
        const fake = '203.0.113.' + (1 + Math.floor(Math.random() * 250));
        const kinds = [['honeypot', 'high', 'Ловушка /wp-login.php · python-requests'], ['attack', 'critical', "Подозрительный запрос: /?id=1' or 1=1 · sqlmap"], ['flood', 'medium', '240 запросов за 10 сек']];
        const k = kinds[Math.floor(Math.random() * 3)];
        logEvent({ kind: k[0], severity: k[1], ip: fake, detail: k[2] }); ban(fake, k[2], 'sim'); return json(res, 200, { ip: fake });
      }
      return json(res, 404, { error: 'not found' });
    }
    // статика
    let f = path.normalize(path.join(PUB, url === '/' ? 'index.html' : url));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { json(res, 500, { error: e.message }); }
}).listen(PORT, HOST, () => {
  console.log(`\n  ⚡ UltraSquad запущен: http://${HOST}:${PORT}\n  OpenRouter: ${OR_KEY ? 'ключ найден' : 'КЛЮЧ НЕ ЗАДАН (.env)'}\n`);
});

setInterval(() => push('sys', sysInfo()), 2000);
