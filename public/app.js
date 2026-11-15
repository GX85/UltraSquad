'use strict';
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = (p, o = {}) => fetch('/api' + p, { headers: { 'Content-Type': 'application/json' }, ...o, body: o.body && JSON.stringify(o.body) })
  .then(r => r.json()).catch(e => ({ error: 'Сервер недоступен: ' + e.message }));
const time = ts => new Date(ts).toLocaleTimeString('ru-RU');
const short = u => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? decodeURI(x.pathname) : ''); } catch { return u || ''; } };

let S = { agents: [], live: [], events: [], bans: {}, quota: {}, settings: { running: true }, sys: {}, templates: [], perms: {}, max: 100 };
let models = [];
const agent = id => S.agents.find(a => a.id === id);
const ST = { idle: 'ожидание', thinking: 'думает', searching: 'ищет', reading: 'читает' };

function toast(text, alert) { const d = document.createElement('div'); d.className = 'toast' + (alert ? ' alert' : ''); d.textContent = text; $('#toasts').append(d); setTimeout(() => d.remove(), 6000); }

// ---------- маршруты ----------
const VIEWS = ['live', 'graph', 'agents', 'security', 'models'];
function route() {
  const h = location.hash.slice(1), v = VIEWS.includes(h) ? h : null;
  document.body.classList.toggle('mode-app', !!v);
  $$('.view').forEach(x => x.classList.toggle('on', x.id === 'v-' + v));
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === v));
  closeMenu();
  if (v === 'models') renderModels();
  if (v === 'graph') requestAnimationFrame(graph.resize);
}
addEventListener('hashchange', route);

// ---------- мобильное меню ----------
const menu = $('#mobileMenu'), toggle = $('#menuToggle');
function setMenu(open) {
  menu.classList.toggle('on', open); toggle.classList.toggle('on', open); document.body.classList.toggle('menu-open', open);
  menu.setAttribute('aria-hidden', String(!open)); menu.inert = !open;
  toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  if (!open && document.activeElement && menu.contains(document.activeElement)) toggle.focus();
}
const closeMenu = () => setMenu(false);
toggle.onclick = () => setMenu(!menu.classList.contains('on'));
menu.onclick = e => { if (e.target === menu) closeMenu(); };
addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); $$('.modal.on').forEach(m => closeModal(m)); } });
matchMedia('(min-width:901px)').addEventListener('change', e => { if (e.matches) closeMenu(); });

// ---------- сводка ----------
function renderStrip() {
  const q = S.quota || {}, busy = S.agents.filter(a => a.state && a.state !== 'idle').length, pages = S.agents.reduce((n, a) => n + (a.steps || 0), 0);
  $('#sAgents').textContent = `${S.agents.length}/${S.max}`;
  $('#sActive').textContent = busy;
  $('#sPages').textContent = pages;
  $('#sLlm').textContent = `${q.used ?? 0}/${q.cap ?? 0}`;
  $('#sLlmSub').textContent = q.exhausted || q.used >= q.cap ? 'лимит исчерпан' : q.cooldown > 0 ? 'пауза api' : 'сегодня';
  const run = S.settings.running;
  $('#sStatus').classList.toggle('paused', !run); $('#sStatus em').textContent = run ? 'Эфир' : 'Пауза';
  $('#runBtn').textContent = run ? 'Пауза' : 'Запуск';
  $('#heroStat').textContent = `${S.agents.length} агентов · ${pages} страниц прочитано · ${run ? 'эфир идёт' : 'пауза'}`;
}
$('#runBtn').onclick = async () => { S.settings = await api('/settings', { method: 'POST', body: { running: !S.settings.running } }); renderStrip(); };

// ---------- эфир ----------
let follow = null, current = null, lastShow = 0, typer = null;
const lastBy = new Map();
const SHOWABLE = ['page', 'search', 'note', 'patrol'];

function type(node, text) {
  clearInterval(typer); node.textContent = ''; node.classList.add('typing');
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) { node.textContent = text; node.classList.remove('typing'); return; }
  let i = 0; const n = Math.max(2, Math.ceil(text.length / 260));
  typer = setInterval(() => { i += n; node.textContent = text.slice(0, i); if (i >= text.length) { clearInterval(typer); node.classList.remove('typing'); } }, 16);
}
function listItems(items) {
  $('#scrList').innerHTML = items.map((r, i) => `<div class="res" style="animation-delay:${i * 60}ms"><b>${esc(r.title || r.text)}</b><span>${esc(short(r.url))}</span>${r.snippet ? `<span>${esc(r.snippet)}</span>` : ''}</div>`).join('');
}
function show(e) {
  if (e.type === 'note') { if (current && current.agent === e.agent) { $('#scrNote').textContent = 'Заметка — ' + e.text; $('#scrThought').textContent = e.thought ? '› ' + e.thought : ''; } return; }
  current = e; lastShow = Date.now();
  $('#scrName').textContent = e.name;
  $('#scrMode').textContent = e.model ? 'модель · ' + e.model.replace(':free', '') : 'автопилот';
  $('#scrThought').textContent = e.thought ? '› ' + e.thought : '';
  $('#scrNote').textContent = ''; $('#scrView').scrollTop = 0;
  if (e.type === 'page') {
    let u = e.url; try { u = decodeURI(e.url); } catch {}
    $('#scrVerb').textContent = 'GET'; $('#scrUrl').textContent = u; $('#scrTitle').textContent = e.title;
    type($('#scrText'), e.text); listItems(e.links || []);
  } else if (e.type === 'search') {
    $('#scrVerb').textContent = 'SEARCH'; $('#scrUrl').textContent = `${e.query}  ·  ${e.engine}`; $('#scrTitle').textContent = 'Поиск: ' + e.query;
    clearInterval(typer); $('#scrText').textContent = ''; $('#scrText').classList.remove('typing'); listItems(e.results || []);
  } else {
    $('#scrVerb').textContent = 'PATROL'; $('#scrUrl').textContent = 'журнал угроз'; $('#scrTitle').textContent = 'Вердикт ' + e.name;
    type($('#scrText'), e.text + (e.banned?.length ? '\n\nЗаблокированы: ' + e.banned.join(', ') : '')); $('#scrList').innerHTML = '';
  }
  renderTiles();
}
function renderTiles() {
  const list = [...lastBy.values()].filter(e => !current || e.agent !== current.agent).sort((a, b) => b.ts - a.ts).slice(0, 4);
  $('#tiles').innerHTML = list.map(e => `<button class="tile" type="button" data-follow="${esc(e.agent)}"><small><span>${esc(e.name)}</span><span>${esc(e.type === 'page' ? e.host : 'поиск')}</span></small><b>${esc(e.type === 'page' ? e.title : e.query)}</b><p>${esc(e.type === 'page' ? e.text.slice(0, 90) : (e.results || []).map(r => r.title).join(' · ').slice(0, 90))}</p></button>`).join('');
}
function setFollow(id) {
  follow = id; const a = id && agent(id);
  $('#followBtn').textContent = a ? `Закреплён: ${a.name} ✕` : 'Авто-режиссёр';
  if (id && lastBy.has(id)) show(lastBy.get(id));
}
$('#followBtn').onclick = () => setFollow(null);
document.addEventListener('click', e => { const t = e.target.closest('[data-follow]'); if (t) { setFollow(t.dataset.follow); if (location.hash !== '#live') location.hash = '#live'; } });

const VERB = { page: 'open', search: 'search', note: 'note', error: 'err', patrol: 'patrol' };
function feedLine(e) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'fl' + (e.type === 'error' ? ' err' : ''); b.dataset.follow = e.agent;
  const target = e.type === 'page' ? short(e.url) : e.type === 'search' ? `«${e.query}»` : e.text || '';
  b.innerHTML = `<time>${time(e.ts)}</time><b>${esc(e.name)}<i>${VERB[e.type] || e.type}</i></b><span>${esc(target)}</span>`;
  const f = $('#feed'); f.prepend(b); while (f.children.length > 160) f.lastChild.remove();
  $('#feedCount').textContent = S.live.length;
}
function onLive(e, replay) {
  S.live.push(e); if (S.live.length > 600) S.live.shift();
  if (e.type === 'page' || e.type === 'search') lastBy.set(e.agent, e);
  if (e.type === 'page') { const a = agent(e.agent); if (a && !replay) { a.steps = (a.steps || 0) + 1; const c = $(`.row--agent[data-id="${e.agent}"] [data-steps]`); if (c) c.textContent = a.steps; } }
  feedLine(e); graph.onLive(e, replay);
  if (replay || !SHOWABLE.includes(e.type)) return;
  if (follow ? e.agent === follow : (!current || e.agent === current.agent || e.type === 'patrol' || Date.now() - lastShow > 7000)) show(e); else renderTiles();
}

// ---------- агенты ----------
function renderAgents() {
  const q = $('#aSearch').value.trim().toLowerCase();
  const list = S.agents.filter(a => !q || (a.name + a.role + a.mission).toLowerCase().includes(q));
  $('#aCount').textContent = `${S.agents.length} из ${S.max}`;
  $('#agentRows').innerHTML = list.map(a => `<div class="row row--agent ${a.enabled ? '' : 'off'}" data-id="${esc(a.id)}">
    <span class="st ${a.enabled && a.state !== 'idle' ? 'busy' : ''}" data-st>${a.enabled ? ST[a.state] || a.state : 'выключен'}</span>
    <b class="cut">${esc(a.name)}</b><span class="dim cut h-md">${esc(a.role)}</span><span class="cut h-sm">${esc(a.mission)}</span>
    <span class="mono dim cut h-md">${esc(a.model === 'auto' ? 'авто · free' : a.model.replace(':free', ''))}</span><span class="mono h-md" data-steps>${a.steps || 0}</span>
    <span class="acts"><button class="link" data-act="watch" type="button">Эфир</button><button class="link" data-act="chat" type="button">Чат</button><button class="link" data-act="edit" type="button">Настроить</button><button class="link" data-act="toggle" type="button">${a.enabled ? 'Выкл' : 'Вкл'}</button></span></div>`).join('')
    || '<p class="empty">Никого не найдено.</p>';
}
$('#aSearch').oninput = renderAgents;
$('#agentRows').onclick = async e => {
  const b = e.target.closest('[data-act]'); if (!b) return; const a = agent(b.closest('.row').dataset.id); if (!a) return;
  if (b.dataset.act === 'watch') { setFollow(a.id); location.hash = '#live'; }
  if (b.dataset.act === 'chat') openChat(a);
  if (b.dataset.act === 'edit') openEdit(a);
  if (b.dataset.act === 'toggle') await api('/agents/' + a.id, { method: 'PUT', body: { enabled: !a.enabled } });
};
$('#spawnBtn').onclick = async () => {
  const r = await api('/agents', { method: 'POST', body: { count: +$('#spawnN').value || 1, template: $('#spawnT').value } });
  toast(r.error || `Добавлено агентов: ${r.created}`, !!r.error);
};
$('#customBtn').onclick = () => openEdit(null);

// редактор
let editing = null;
const openModal = m => { m.classList.add('on'); m.setAttribute('aria-hidden', 'false'); };
const closeModal = m => { m.classList.remove('on'); m.setAttribute('aria-hidden', 'true'); };
$$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) closeModal(m); }));
async function ensureModels() { if (!models.length) { const m = await api('/models'); if (Array.isArray(m)) models = m; } }
async function openEdit(a) {
  await ensureModels(); editing = a ? a.id : null;
  const d = a || { name: '', role: 'Свободная миссия', mission: '', prompt: '', model: 'auto', permissions: ['web.browse'] };
  $('#eTitle').textContent = a ? 'Настройка · ' + a.name : 'Новый агент'; $('#eDel').style.visibility = a ? 'visible' : 'hidden';
  $('#eName').value = d.name; $('#eRole').value = d.role; $('#eMission').value = d.mission; $('#ePrompt').value = d.prompt || '';
  $('#eModel').innerHTML = `<option value="auto">Авто — ротация бесплатных моделей</option>` + models.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  $('#eModel').value = d.model; if (!$('#eModel').value) $('#eModel').value = 'auto';
  $('#ePerms').innerHTML = Object.entries(S.perms).map(([k, t]) => `<button type="button" class="perm ${d.permissions.includes(k) ? 'on' : ''}" data-p="${k}" aria-pressed="${d.permissions.includes(k)}">${esc(t)}<code>${k}</code></button>`).join('');
  openModal($('#editModal')); $('#eName').focus();
}
$('#ePerms').onclick = e => { const p = e.target.closest('.perm'); if (p) p.setAttribute('aria-pressed', String(p.classList.toggle('on'))); };
$('#eSave').onclick = async () => {
  const b = { name: $('#eName').value.trim(), role: $('#eRole').value.trim(), mission: $('#eMission').value.trim(), prompt: $('#ePrompt').value.trim(), model: $('#eModel').value, permissions: $$('#ePerms .perm.on').map(p => p.dataset.p) };
  if (!b.mission) return toast('Укажи миссию агента', true);
  let r;
  if (editing) r = await api('/agents/' + editing, { method: 'PUT', body: b });
  else { r = await api('/agents', { method: 'POST', body: { count: 1, ...b } }); }
  if (r.error) return toast(r.error, true);
  closeModal($('#editModal')); toast('Сохранено');
};
$('#eDel').onclick = async () => { if (editing && confirm('Удалить агента?')) { await api('/agents/' + editing, { method: 'DELETE' }); closeModal($('#editModal')); } };

// чат
let chatWith = null, hist = [];
function openChat(a) { chatWith = a; hist = []; $('#cTitle').textContent = 'Чат · ' + a.name; $('#msgs').innerHTML = ''; openModal($('#chatModal')); $('#cIn').focus(); }
function addMsg(cls, text, sub) { const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = text; if (sub) { const s = document.createElement('small'); s.textContent = sub; d.append(s); } $('#msgs').append(d); $('#msgs').scrollTop = 1e9; return d; }
$('#cForm').onsubmit = async e => {
  e.preventDefault(); const t = $('#cIn').value.trim(); if (!t || !chatWith) return; $('#cIn').value = '';
  hist.push({ role: 'user', content: t }); addMsg('u', t); const w = addMsg('a', '…');
  const r = await api(`/agents/${chatWith.id}/chat`, { method: 'POST', body: { messages: hist } }); w.remove();
  if (r.error) return addMsg('a', 'Ошибка: ' + r.error);
  hist.push({ role: 'assistant', content: r.reply }); addMsg('a', r.reply, (r.model || '').replace(':free', ''));
};

// ---------- охота ----------
function renderSecurity() {
  const ev = [...S.events].reverse();
  $('#evCount').textContent = ev.length;
  $('#evRows').innerHTML = ev.map(e => `<div class="row row--ev ${esc(e.severity)}"><span class="mono dim">${time(e.ts)}</span><span class="mono">${esc(e.kind)}</span><span class="mono h-sm">${esc(e.ip)}</span><span class="cut dim">${esc(e.detail)}</span></div>`).join('') || '<p class="empty">Тихо. Ловушки взведены.</p>';
  const b = Object.entries(S.bans);
  $('#banCount').textContent = b.length;
  $('#banRows').innerHTML = b.map(([ip, v]) => `<div class="row row--ban"><span class="mono">${esc(ip)}</span><span class="cut dim">${esc(v.reason)}</span><button class="link" data-unban="${esc(ip)}" type="button">Снять</button></div>`).join('') || '<p class="empty">Список пуст.</p>';
}
$('#banRows').onclick = async e => { const b = e.target.closest('[data-unban]'); if (b) { S.bans = await api('/bans', { method: 'DELETE', body: { ip: b.dataset.unban } }); renderSecurity(); } };
$('#simBtn').onclick = () => api('/simulate', { method: 'POST' });
$('#patrolBtn').onclick = async () => {
  const v = $('#verdict'), b = $('#patrolBtn'); b.disabled = true; v.classList.add('busy'); v.textContent = 'Sentinel читает журнал…';
  const r = await api('/patrol', { method: 'POST' });
  v.classList.remove('busy'); b.disabled = false;
  v.textContent = r.error ? 'Ошибка: ' + r.error : r.reply + (r.banned?.length ? '\n\nЗаблокированы: ' + r.banned.join(', ') : '') + (r.model ? '\n\n— ' + r.model.replace(':free', '') : '');
};

// ---------- модели ----------
async function renderModels() {
  await ensureModels(); const q = $('#mSearch').value.trim().toLowerCase(), k = S.quota || {};
  const list = models.filter(m => (m.id + m.name).toLowerCase().includes(q));
  $('#mCount').textContent = models.length;
  $('#quotaNote').textContent = `Подключены только бесплатные модели (:free) — платные заблокированы на уровне сервера. Сегодня использовано ${k.used ?? 0} из ${k.cap ?? 0} запросов, не более ${k.rpm ?? 16} в минуту. ` +
    (k.freeTier ? 'У аккаунта базовый лимит OpenRouter: 50 бесплатных запросов в сутки. Когда лимит кончается, агенты продолжают ходить по сети на автопилоте без модели.' : 'У аккаунта расширенный лимит бесплатных запросов.');
  $('#modelRows').innerHTML = list.map(m => `<div class="row row--model"><span class="cut">${esc(m.name)}</span><span class="mono dim cut">${esc(m.id)}</span><span class="mono dim">${m.ctx ? Math.round(m.ctx / 1000) + 'k ctx' : ''}</span></div>`).join('') || '<p class="empty">Модели не загружены — проверь ключ OpenRouter в .env.</p>';
}
$('#mSearch').oninput = renderModels;

// ---------- граф ----------
const graph = (() => {
  const c = $('#graph'), x = c.getContext('2d'), tip = $('#gtip');
  const N = new Map(), E = new Map(); let W = 0, H = 0, mouse = null, hover = null;
  function resize() { const r = c.parentElement.getBoundingClientRect(); if (!r.width) return; const d = devicePixelRatio || 1; W = r.width; H = r.height; c.width = W * d; c.height = H * d; x.setTransform(d, 0, 0, d, 0, 0); }
  function node(id, type, label) {
    let n = N.get(id);
    if (!n) { const a = Math.random() * 6.283, d = type === 'hub' ? 0 : 120 + Math.random() * 180; n = { id, type, x: (W || 900) / 2 + Math.cos(a) * d, y: (H || 600) / 2 + Math.sin(a) * d, vx: 0, vy: 0, pulse: 0, hits: 0 }; N.set(id, n); }
    n.label = label; return n;
  }
  function sync() {
    node('hub', 'hub', 'CORE'); const ids = new Set(S.agents.map(a => a.id));
    for (const a of S.agents) { node(a.id, 'agent', a.name); E.set('h|' + a.id, { a: 'hub', b: a.id, kind: 'hub', ts: 0 }); }
    for (const [k, n] of N) if (n.type === 'agent' && !ids.has(k)) { N.delete(k); for (const [ek, e] of E) if (e.a === k || e.b === k) E.delete(ek); }
    prune();
  }
  function prune() { const used = new Set(); for (const e of E.values()) if (e.kind === 'visit') used.add(e.b); for (const [k, n] of N) if (n.type === 'domain' && !used.has(k)) N.delete(k); }
  function onLive(e, replay) {
    const n = N.get(e.agent); if (!n) return; if (!replay) n.pulse = 1;
    if (e.type !== 'page' || !e.host) return;
    const d = node('d:' + e.host, 'domain', e.host.replace(/^www\./, '')); if (!replay) d.pulse = 1; d.hits++;
    if (d.hits === 1) { d.x = n.x + (Math.random() - .5) * 60; d.y = n.y + (Math.random() - .5) * 60; }
    E.set(e.agent + '|' + d.id, { a: e.agent, b: d.id, kind: 'visit', ts: e.ts });
    [...E.entries()].filter(([, v]) => v.kind === 'visit' && v.a === e.agent).sort((p, q) => q[1].ts - p[1].ts).slice(3).forEach(([k]) => E.delete(k));
    prune();
  }
  function physics() {
    const arr = [...N.values()], hubLen = Math.min(W, H) * .36, rep = arr.length > 60 ? 900 : 2600;
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j]; let dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy + .01; if (d2 > 90000) continue;
      const d = Math.sqrt(d2), f = rep / d2; dx /= d; dy /= d; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const e of E.values()) {
      const a = N.get(e.a), b = N.get(e.b); if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - (e.kind === 'hub' ? hubLen : 64)) * (e.kind === 'hub' ? .006 : .02);
      a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
    }
    for (const n of arr) {
      if (n.type === 'hub') { n.x = W / 2; n.y = H / 2; n.vx = n.vy = 0; continue; }
      n.vx *= .84; n.vy *= .84; n.x = Math.max(16, Math.min(W - 16, n.x + n.vx)); n.y = Math.max(16, Math.min(H - 16, n.y + n.vy));
      n.pulse = Math.max(0, n.pulse - .012);
    }
  }
  function draw() {
    const now = Date.now(); x.clearRect(0, 0, W, H); x.lineWidth = 1;
    for (const e of E.values()) {
      const a = N.get(e.a), b = N.get(e.b); if (!a || !b) continue; const fresh = e.kind === 'visit' && now - e.ts < 6000;
      x.strokeStyle = `rgba(255,255,255,${fresh ? .55 : e.kind === 'visit' ? .2 : .07})`; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
      if (fresh) { const t = ((now - e.ts) % 1100) / 1100; x.fillStyle = '#fff'; x.fillRect(a.x + (b.x - a.x) * t - 1.5, a.y + (b.y - a.y) * t - 1.5, 3, 3); }
    }
    const few = S.agents.length <= 36; x.font = '10px "JetBrains Mono",monospace'; x.textBaseline = 'middle';
    for (const n of N.values()) {
      const h = n === hover;
      if (n.type === 'hub') { x.strokeStyle = '#fff'; x.strokeRect(n.x - 9, n.y - 9, 18, 18); x.fillStyle = '#fff'; x.fillRect(n.x - 3, n.y - 3, 6, 6); continue; }
      if (n.type === 'agent') {
        const a = agent(n.id), busy = a && a.enabled && a.state !== 'idle', s = h ? 6 : 4;
        x.fillStyle = !a || !a.enabled ? 'rgba(255,255,255,.14)' : busy ? '#fff' : 'rgba(255,255,255,.42)'; x.fillRect(n.x - s, n.y - s, s * 2, s * 2);
        if (n.pulse > 0) { const r = s + (1 - n.pulse) * 18; x.strokeStyle = `rgba(255,255,255,${n.pulse * .7})`; x.strokeRect(n.x - r, n.y - r, r * 2, r * 2); }
        if (few || h || busy) { x.fillStyle = `rgba(255,255,255,${h || busy ? .9 : .45})`; x.fillText(n.label, n.x + 10, n.y); }
      } else {
        const r = 2.5 + Math.min(n.hits, 8) * .5; x.strokeStyle = `rgba(255,255,255,${.35 + n.pulse * .6})`; x.beginPath(); x.arc(n.x, n.y, r, 0, 6.283); x.stroke();
        if (h || n.pulse > .25) { x.fillStyle = `rgba(255,255,255,${h ? .9 : n.pulse})`; x.fillText(n.label, n.x + r + 6, n.y); }
      }
    }
  }
  function pick() {
    hover = null; if (!mouse) return (tip.style.display = 'none'); let best = 16;
    for (const n of N.values()) { const d = Math.hypot(n.x - mouse.x, n.y - mouse.y); if (d < best) { best = d; hover = n; } }
    c.style.cursor = hover && hover.type === 'agent' ? 'pointer' : 'crosshair';
    if (!hover) return (tip.style.display = 'none');
    const a = hover.type === 'agent' && agent(hover.id);
    tip.innerHTML = a ? `<b>${esc(a.name)}</b> · ${esc(a.role)}<br>${esc(a.mission)}<br><span class="dim">${a.enabled ? ST[a.state] || a.state : 'выключен'}${a.target ? ' · ' + esc(short(a.target)) : ''} · страниц: ${a.steps || 0}</span>`
      : hover.type === 'domain' ? `<b>${esc(hover.label)}</b><br><span class="dim">визитов: ${hover.hits}</span>` : `<b>CORE</b><br><span class="dim">сервер UltraSquad</span>`;
    tip.style.display = 'block'; tip.style.left = Math.min(mouse.x + 16, W - 330) + 'px'; tip.style.top = Math.min(mouse.y + 16, H - 90) + 'px';
  }
  c.onmousemove = e => { const r = c.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; };
  c.onmouseleave = () => { mouse = null; };
  c.onclick = () => { if (hover && hover.type === 'agent') { setFollow(hover.id); location.hash = '#live'; } };
  addEventListener('resize', resize);
  (function loop() { if ($('#v-graph').classList.contains('on') && W) { physics(); pick(); draw(); } requestAnimationFrame(loop); })();
  return { resize, sync, onLive };
})();

// ---------- синхронизация ----------
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('live', e => { onLive(JSON.parse(e.data)); renderStrip(); });
  es.addEventListener('astate', e => {
    const d = JSON.parse(e.data), a = agent(d.id); if (!a) return; a.state = d.state; a.target = d.target;
    const c = $(`.row--agent[data-id="${d.id}"] [data-st]`); if (c && a.enabled) { c.textContent = ST[d.state] || d.state; c.classList.toggle('busy', d.state !== 'idle'); }
    $('#sActive').textContent = S.agents.filter(v => v.state && v.state !== 'idle').length;
  });
  es.addEventListener('agents', e => { S.agents = JSON.parse(e.data); renderAgents(); renderStrip(); graph.sync(); });
  es.addEventListener('threat', e => { const ev = JSON.parse(e.data); S.events.push(ev); renderSecurity(); if (ev.kind !== 'ban') toast(`${ev.kind.toUpperCase()} · ${ev.ip}\n${ev.detail}`, true); });
  es.addEventListener('bans', e => { S.bans = JSON.parse(e.data); renderSecurity(); });
  es.addEventListener('quota', e => { S.quota = JSON.parse(e.data); renderStrip(); });
  es.addEventListener('settings', e => { S.settings = JSON.parse(e.data); renderStrip(); });
  es.addEventListener('sys', e => { S.sys = JSON.parse(e.data); });
}
(async () => {
  route();
  const s = await api('/state');
  if (s.error) { $('#heroStat').textContent = 'Сервер недоступен'; return; }
  const liveLog = s.live; S = { ...s, live: [] };
  $('#spawnT').innerHTML = '<option value="">Смешанный состав</option>' + S.templates.map(t => `<option value="${esc(t.key)}">${esc(t.role)}</option>`).join('');
  graph.sync(); liveLog.forEach(e => onLive(e, true));
  const last = [...liveLog].reverse().find(e => e.type === 'page' || e.type === 'search'); if (last) show(last);
  renderStrip(); renderAgents(); renderSecurity(); renderTiles(); connect();
  if (!s.keyOk) toast('Ключ OpenRouter не найден в .env — агенты работают на автопилоте', true);
})();
