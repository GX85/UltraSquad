'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const api = (p, o = {}) => fetch('/api' + p, { headers: { 'Content-Type': 'application/json' }, ...o, body: o.body && JSON.stringify(o.body) }).then(r => r.json());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let S = { agents: [], perms: {}, events: [], bans: {}, sys: {} };
let models = [];

// ---------- навигация ----------
$$('nav a').forEach(a => a.onclick = () => {
  $$('nav a').forEach(x => x.classList.toggle('on', x === a));
  $$('.view').forEach(v => v.classList.toggle('on', v.id === a.dataset.v));
  if (a.dataset.v === 'models') loadModels();
});

// ---------- toast ----------
function toast(t, ok) { const d = document.createElement('div'); d.className = 'toast' + (ok ? ' ok' : ''); d.innerHTML = t; $('#toasts').append(d); setTimeout(() => d.remove(), 5500); }

// ---------- счётчики с анимацией ----------
const cur = {};
function count(k, to) {
  const el = $(`[data-c=${k}]`); const from = cur[k] ?? 0; cur[k] = to; const t0 = performance.now();
  (function f(t) { const p = Math.min(1, (t - t0) / 700); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(f); })(t0);
}

// ---------- рендер ----------
const ago = ts => { const s = (Date.now() - ts) / 1000 | 0; return s < 60 ? s + 'с' : s < 3600 ? (s / 60 | 0) + 'м' : (s / 3600 | 0) + 'ч'; };
const evHtml = e => `<div class="ev ${e.severity}"><b>${esc(e.kind)}</b><span class="ip">${esc(e.ip)}</span><span>${esc(e.detail)}</span><span class="t">${ago(e.ts)}</span></div>`;
function renderAll() {
  count('agents', S.agents.filter(a => a.enabled).length);
  count('threats', S.events.filter(e => e.kind !== 'ban').length);
  count('bans', Object.keys(S.bans).length);
  renderFeed(); renderAgents(); renderBans(); renderSys();
}
function renderFeed() {
  const l = [...S.events].reverse();
  $('#feed').innerHTML = l.slice(0, 30).map(evHtml).join('') || '<span class="muted">Тихо. Ловушки взведены 🕸️</span>';
  $('#log').innerHTML = l.map(evHtml).join('') || '<span class="muted">Событий нет</span>';
}
function renderBans() {
  const e = Object.entries(S.bans);
  $('#banList').innerHTML = e.map(([ip, b]) => `<div class="ev high"><span class="ip">${esc(ip)}</span><span>${esc(b.reason)}</span><button class="btn ghost" style="padding:2px 10px;margin:0 0 0 auto" data-unban="${esc(ip)}">Снять</button></div>`).join('') || '<span class="muted">Пусто</span>';
  $$('[data-unban]').forEach(b => b.onclick = async () => { S.bans = await api('/bans', { method: 'DELETE', body: { ip: b.dataset.unban } }); renderAll(); });
}
function renderSys() {
  const s = S.sys; if (!s.memTotal) return;
  const used = 1 - s.memFree / s.memTotal, load = Math.min(1, s.load / s.cores);
  count('mem', Math.round(s.procMem / 1048576));
  const bar = (n, v, t) => `<div class="bar">${n} · ${t}<div class="tr"><div class="fl" style="width:${Math.round(v * 100)}%"></div></div></div>`;
  $('#sysbars').innerHTML = bar('Память', used, Math.round(used * 100) + '%') + bar('Нагрузка CPU', load, s.cores + ' ядер') + bar('Uptime', Math.min(1, (s.uptime % 86400) / 86400), (s.uptime / 3600).toFixed(1) + ' ч');
}
function renderAgents() {
  $('#agentGrid').innerHTML = S.agents.map(a => `
    <div class="card agent ${a.enabled ? '' : 'off'}" style="--c:${esc(a.color)}">
      <div class="sw ${a.enabled ? 'on' : ''}" data-tog="${a.id}"></div>
      <div class="ic">${esc(a.icon)}</div><h2>${esc(a.name)}</h2><div class="role">${esc(a.role)}</div>
      <span class="tag m">${esc(a.model)}</span><br>
      ${a.permissions.map(p => `<span class="tag">${esc(p)}</span>`).join('') || '<span class="tag">без прав</span>'}
      <div class="acts"><button class="btn" data-chat="${a.id}">Чат</button><button class="btn ghost" style="margin:0" data-edit="${a.id}">Настроить</button></div>
    </div>`).join('');
  $$('[data-tog]').forEach(b => b.onclick = async () => { const a = S.agents.find(x => x.id === b.dataset.tog); await api('/agents/' + a.id, { method: 'PUT', body: { enabled: !a.enabled } }); });
  $$('[data-edit]').forEach(b => b.onclick = () => openEdit(b.dataset.edit));
  $$('[data-chat]').forEach(b => b.onclick = () => openChat(b.dataset.chat));
}

// ---------- редактор ----------
let editing = null;
async function ensureModels() { if (!models.length) { try { const m = await api('/models'); if (Array.isArray(m)) models = m; } catch {} } }
async function openEdit(id) {
  await ensureModels();
  const a = id ? S.agents.find(x => x.id === id) : { name: '', role: '', icon: '🤖', color: '#7c4dff', model: 'openai/gpt-4o-mini', temperature: .5, prompt: '', permissions: [] };
  editing = id; $('#mTitle').textContent = id ? 'Настройка: ' + a.name : 'Новый агент'; $('#mDel').style.display = id ? '' : 'none';
  $('#fIcon').value = a.icon; $('#fName').value = a.name; $('#fColor').value = a.color; $('#fRole').value = a.role; $('#fModel').value = a.model;
  $('#fTemp').value = a.temperature; $('#tVal').textContent = a.temperature; $('#fPrompt').value = a.prompt;
  $('#modelOpts').innerHTML = models.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  $('#fPerms').innerHTML = Object.entries(S.perms).map(([k, d]) => `<div class="perm ${a.permissions.includes(k) ? 'on' : ''}" data-p="${k}">${esc(d)}<code>${k}</code></div>`).join('');
  $$('.perm').forEach(p => p.onclick = () => p.classList.toggle('on'));
  $('#modal').classList.add('on');
}
$('#fTemp').oninput = e => $('#tVal').textContent = e.target.value;
$('#newAgent').onclick = () => openEdit(null);
$('#mClose').onclick = () => $('#modal').classList.remove('on');
$('#mSave').onclick = async () => {
  const b = { icon: $('#fIcon').value, name: $('#fName').value, color: $('#fColor').value, role: $('#fRole').value, model: $('#fModel').value,
    temperature: +$('#fTemp').value, prompt: $('#fPrompt').value, permissions: $$('.perm.on').map(p => p.dataset.p) };
  await api(editing ? '/agents/' + editing : '/agents', { method: editing ? 'PUT' : 'POST', body: b });
  $('#modal').classList.remove('on'); toast('Сохранено', true);
};
$('#mDel').onclick = async () => { if (confirm('Удалить агента?')) { await api('/agents/' + editing, { method: 'DELETE' }); $('#modal').classList.remove('on'); } };

// ---------- чат ----------
let chatAgent = null, hist = [];
function openChat(id) { chatAgent = S.agents.find(a => a.id === id); hist = []; $('#cTitle').textContent = `${chatAgent.icon} ${chatAgent.name}`; $('#msgs').innerHTML = ''; $('#chatModal').classList.add('on'); $('#cIn').focus(); }
$('#cClose').onclick = () => $('#chatModal').classList.remove('on');
function addMsg(cls, t, extra) { const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = t; if (extra) d.insertAdjacentHTML('beforeend', `<small>${extra}</small>`); $('#msgs').append(d); $('#msgs').scrollTop = 1e9; return d; }
$('#cForm').onsubmit = async e => {
  e.preventDefault(); const t = $('#cIn').value.trim(); if (!t) return; $('#cIn').value = '';
  hist.push({ role: 'user', content: t }); addMsg('u', t); const w = addMsg('a', '…');
  const r = await api(`/agents/${chatAgent.id}/chat`, { method: 'POST', body: { messages: hist } });
  w.remove();
  if (r.error) return addMsg('a', '⚠ ' + r.error);
  hist.push({ role: 'assistant', content: r.reply }); addMsg('a', r.reply, r.tools?.length ? '🔧 ' + r.tools.join(', ') : '');
};

// ---------- охота ----------
$('#sim').onclick = () => api('/simulate', { method: 'POST' });
$('#hunt').onclick = async () => {
  const v = $('#verdict'), b = $('#hunt'); b.disabled = true; v.className = 'verdict loading'; v.textContent = 'Sentinel анализирует журнал…';
  const a = S.agents.find(x => x.id === 'sentinel') || S.agents.find(x => x.permissions.includes('security.read'));
  if (!a) { v.className = 'verdict'; v.textContent = 'Нет агента с правом security.read'; b.disabled = false; return; }
  const r = await api(`/agents/${a.id}/chat`, { method: 'POST', body: { messages: [{ role: 'user', content: 'Проанализируй журнал угроз. Кто атакует и как? Забань явных атакующих, если ещё не забанены. Ответь кратко по-русски.' }] } });
  v.className = 'verdict'; v.textContent = r.error ? '⚠ ' + r.error : r.reply + (r.tools?.length ? `\n\n🔧 ${r.tools.join(', ')}` : ''); b.disabled = false;
};

// ---------- модели ----------
async function loadModels() {
  await ensureModels(); const q = $('#mq').value.toLowerCase();
  $('#modelList').innerHTML = models.filter(m => (m.id + m.name).toLowerCase().includes(q)).slice(0, 80).map(m =>
    `<div class="m"><b>${esc(m.name)}</b><code>${esc(m.id)}</code><small>${m.ctx ? (m.ctx / 1000 | 0) + 'k ctx' : ''} · $${m.price.toFixed(2)}/M</small></div>`).join('') || '<span class="muted">Нет данных (проверь ключ OpenRouter)</span>';
}
$('#mq').oninput = loadModels;

// ---------- live ----------
function connect() {
  const es = new EventSource('/api/events');
  es.onopen = () => $('#live').classList.add('ok');
  es.onerror = () => $('#live').classList.remove('ok');
  es.addEventListener('threat', e => { const ev = JSON.parse(e.data); S.events.push(ev); renderAll(); pingRadar(ev); if (ev.kind !== 'ban') toast(`<b>${esc(ev.kind)}</b> · ${esc(ev.ip)}<br>${esc(ev.detail)}`); });
  es.addEventListener('bans', e => { S.bans = JSON.parse(e.data); renderAll(); });
  es.addEventListener('agents', e => { S.agents = JSON.parse(e.data); renderAll(); });
  es.addEventListener('sys', e => { S.sys = JSON.parse(e.data); renderSys(); });
}
(async () => {
  S = await api('/state'); $('#keyState').classList.toggle('ok', S.keyOk); renderAll(); connect();
  if (!S.keyOk) toast('Не найден ключ OpenRouter в .env');
  setInterval(renderFeed, 15000);
})();

// ---------- фон: нейросеть из частиц ----------
(() => {
  const c = $('#bg'), x = c.getContext('2d'); let W, H, P = [], mx = -999, my = -999;
  const rs = () => { W = c.width = innerWidth; H = c.height = innerHeight; P = Array.from({ length: Math.min(110, W * H / 14000 | 0) }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .4, vy: (Math.random() - .5) * .4 })); };
  addEventListener('resize', rs); addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; }); rs();
  (function f() {
    x.clearRect(0, 0, W, H);
    const g = x.createRadialGradient(W * .8, H * .1, 0, W * .8, H * .1, W * .7); g.addColorStop(0, 'rgba(124,77,255,.18)'); g.addColorStop(1, 'transparent'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    for (const p of P) {
      p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1;
      const dm = Math.hypot(p.x - mx, p.y - my); if (dm < 140) { p.x += (p.x - mx) / dm * 1.2; p.y += (p.y - my) / dm * 1.2; }
      x.fillStyle = 'rgba(0,229,255,.7)'; x.beginPath(); x.arc(p.x, p.y, 1.5, 0, 7); x.fill();
    }
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const d = Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y);
      if (d < 130) { x.strokeStyle = `rgba(124,77,255,${(1 - d / 130) * .35})`; x.beginPath(); x.moveTo(P[i].x, P[i].y); x.lineTo(P[j].x, P[j].y); x.stroke(); }
    }
    requestAnimationFrame(f);
  })();
})();

// ---------- радар ----------
let blips = [];
function pingRadar(ev) { if (ev.kind === 'ban') return; blips.push({ a: Math.random() * 6.283, r: .25 + Math.random() * .7, born: performance.now(), sev: ev.severity }); }
(() => {
  const c = $('#radar'), x = c.getContext('2d'), R = 200, cx = 210, cy = 210; let ang = 0;
  (function f(t) {
    x.clearRect(0, 0, 420, 420);
    x.strokeStyle = 'rgba(0,229,255,.18)'; x.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { x.beginPath(); x.arc(cx, cy, R * i / 4, 0, 7); x.stroke(); }
    x.beginPath(); x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.moveTo(cx, cy - R); x.lineTo(cx, cy + R); x.stroke();
    ang += .03;
    const g = x.createConicGradient(ang - 1.1, cx, cy); g.addColorStop(0, 'transparent'); g.addColorStop(.17, 'rgba(0,229,255,.45)'); g.addColorStop(.1750, 'transparent'); g.addColorStop(1, 'transparent');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.fill();
    x.strokeStyle = 'rgba(0,229,255,.9)'; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); x.stroke();
    blips = blips.filter(b => t - b.born < 30000);
    // последние события тоже на радаре
    for (const b of blips) {
      const age = (t - b.born) / 30000, bx = cx + Math.cos(b.a) * R * b.r, by = cy + Math.sin(b.a) * R * b.r;
      const col = b.sev === 'critical' ? '255,61,113' : '255,170,60';
      x.fillStyle = `rgba(${col},${1 - age})`; x.beginPath(); x.arc(bx, by, 5, 0, 7); x.fill();
      x.strokeStyle = `rgba(${col},${.7 * (1 - (t - b.born) % 1500 / 1500)})`; x.beginPath(); x.arc(bx, by, 5 + ((t - b.born) % 1500) / 1500 * 22, 0, 7); x.stroke();
    }
    x.fillStyle = '#2cf5a0'; x.beginPath(); x.arc(cx, cy, 5, 0, 7); x.fill();
    requestAnimationFrame(f);
  })(0);
})();
