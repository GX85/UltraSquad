import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readTelemetry } from './telemetry.mjs';
import { readWindows } from './windows-events.mjs';
import { reviewSource } from './source-review.mjs';
import { createLiveFeed } from './live.mjs';
import { join } from 'node:path';

const port = Number(process.env.ULTRASQUAD_PORT || 4177);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Некорректный порт');
const host = '127.0.0.1';
const origin = 'http://' + host + ':' + port;
const root = import.meta.dirname;
const folder = join(root, 'data');
const stateFile = join(folder, 'state.json');
const inbox = join(root, 'telemetry', 'events.jsonl');
mkdirSync(join(root, 'telemetry'), { recursive: true });
const runtime = { lastTick: null, error: null };
const windowsStatus = { lastTick: null, available: [], failed: [] };
let readingWindows = false;
const live = createLiveFeed();
const limit = 100;
const summaryQueue = new Set();
let revision = 0;
let lastAuto = 0;
const slots = [
  { id: 'sentinel', name: 'Дозор', mark: '◈', color: 'cyan', desc: 'Отслеживает повторные отказы входа', type: 'auth_failed', enabled: true, threshold: 5 },
  { id: 'warden', name: 'Контур', mark: '⬡', color: 'violet', desc: 'Отмечает изменения прав доступа', type: 'permission_changed', enabled: true, threshold: 1 },
  { id: 'relay', name: 'Маяк', mark: '◇', color: 'amber', desc: 'Отмечает исходящий трафик по журналу', type: 'outbound_flagged', enabled: true, threshold: 3 }
];
const types = {
  auth_failed: 'Отказ во входе',
  permission_changed: 'Изменение прав',
  outbound_flagged: 'Исходящий трафик',
  service_ok: 'Штатная проверка',
  windows_error: 'Ошибка Windows',
  defender_detection: 'Обнаружение Защитника Windows'
};
const baseModel = { id: 'openrouter/free', label: 'Автовыбор бесплатной модели' };
const saved = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
let state = {
  agents: (saved.agents ?? slots).slice(0, limit).map(agent => ({
    model: baseModel.id, allowBrief: true, autoBrief: false, source: '', ...agent
  })),
  events: saved.events || [], seen: saved.seen || [],
  imported: saved.imported || 0, brief: saved.brief || null, demoLoaded: saved.demoLoaded || false,
  cursor: saved.cursor || {}, monitoring: saved.monitoring ?? true, watched: saved.watched || 0,
  rejected: saved.rejected || 0,
  modelHistory: saved.modelHistory || {},
  windowsCursor: saved.windowsCursor || {},
  windowsRead: saved.windowsRead || 0,
  windowsBootstrap: Boolean(saved.windowsBootstrap),
  agentStats: saved.agentStats || {},
  room: saved.room || [],
  autoCalls: (saved.autoCalls || []).filter(at => at >= Date.now() - 86400000)
};
if (process.platform === 'win32' && !saved.windowsBootstrap) {
  for (const [id, name, type] of [
    ['windows-errors', 'Журнал Windows', 'windows_error'],
    ['windows-defender', 'Защитник Windows', 'defender_detection']
  ]) {
    if (state.agents.length >= limit) break;
    if (state.agents.some(agent => agent.id === id)) continue;
    state.agents.push({ id, name, type, desc: types[type], enabled: true, threshold: 1,
      mark: '◇', color: 'cyan', model: baseModel.id, allowBrief: true, autoBrief: false, source: '' });
  }
  state.windowsBootstrap = true;
}
if (!saved.room) {
  state.room = state.agents.flatMap(agent => {
    const stats = state.agentStats[agent.id];
    if (!stats?.lastRun) return [];
    const signal = state.events.find(event => event.matches?.includes(agent.id));
    const post = roomPost(agent.name, signal ? 'signal' : 'report',
      'Сохранённый отчёт · Обработано: ' + stats.processed + ' · Сигналов: ' + stats.flagged, signal?.id);
    return [{ ...post, time: stats.lastRun }];
  }).sort((a, b) => a.time.localeCompare(b.time));
}
let apiKey = process.env.OPENROUTER_API_KEY?.trim() || '';
const localPrefix = 'ollama-local:';
const localBase = 'http://127.0.0.1:11434/api';
let models = [baseModel];
let catalogFetchedAt = 0;
let briefing = false;
let activeAgentId = null;

const assets = new Map([
  ['/', ['home.html', 'text/html; charset=utf-8']],
  ['/console', ['index.html', 'text/html; charset=utf-8']],
  ['/video/', ['video/host.html', 'text/html; charset=utf-8']],
  ['/video/view', ['video/index.html', 'text/html; charset=utf-8']],
  ['/video/host.js', ['video/host.js', 'text/javascript; charset=utf-8']],
  ['/video/viewer.js', ['video/viewer.js', 'text/javascript; charset=utf-8']],
  ['/video/rtc.js', ['video/rtc.js', 'text/javascript; charset=utf-8']],
  ['/video/broadcast.css', ['video/broadcast.css', 'text/css; charset=utf-8']],
  ['/home.css', ['home.css', 'text/css; charset=utf-8']],
  ['/home.js', ['home.js', 'text/javascript; charset=utf-8']],
  ['/live.js', ['live.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/signal.js', ['signal.js', 'text/javascript; charset=utf-8']]
]);

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function save(next) {
  mkdirSync(folder, { recursive: true });
  const temp = join(folder, 'state.tmp');
  writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(temp, stateFile);
  state = next;
  revision++;
}

async function readJson(req) {
  if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') {
    fail(403, 'Запрос разрешён только из локальной панели.');
  }
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    fail(415, 'Ожидается JSON.');
  }
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 256 * 1024) fail(413, 'Файл превышает 256 КБ.');
    parts.push(part);
  }
  try {
    const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {}
  fail(400, 'Ожидается объект JSON.');
}

function status() {
  return {
    ...runtime, monitoring: state.monitoring, watched: state.watched,
    rejected: state.rejected,
    windows: { enabled: process.platform === 'win32', ...windowsStatus, received: state.windowsRead },
    revision, queue: summaryQueue.size, briefing,
    activeAgentId, operating: state.agentStats,
    autoCallsToday: state.autoCalls.filter(at => at >= Date.now() - 86400000).length
  };
}

function snapshot() {
  return {
    agents: state.agents, events: state.events, imported: state.imported,
    brief: state.brief, connected: Boolean(apiKey), types, demoLoaded: state.demoLoaded,
    runtime: status(), limit, modelHistory: state.modelHistory, room: state.room
  };
}

function normalize(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) {
    fail(400, 'В журнале должно быть от 1 до 500 событий.');
  }
  return rows.map((row, index) => {
    const at = typeof row?.time === 'string' ? Date.parse(row.time) : NaN;
    const source = row?.source;
    if (!Number.isFinite(at) || !Object.hasOwn(types, row?.type)
        || typeof source !== 'string' || !/^[\p{L}\p{N} _.-]{1,40}$/u.test(source)) {
      fail(400, 'Некорректное событие в строке ' + (index + 1) + '. Проверьте time, type и source.');
    }
    const event = { time: new Date(at).toISOString(), source, type: row.type };
    if (row.eventId !== undefined) {
      if (typeof row.eventId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(row.eventId)) {
        fail(400, 'Некорректный eventId в строке ' + (index + 1) + '.');
      }
      event.eventId = row.eventId;
    }
    return event;
  });
}

function ingest(rows, changes = {}) {
  const seen = new Set(state.seen);
  const fresh = (rows.length ? normalize(rows) : []).filter(event => {
    const fingerprint = JSON.stringify(event);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
  const history = [...state.events, ...fresh].sort((a, b) => a.time.localeCompare(b.time));
  const matches = new Map();
  const runs = [];
  const check = new Set(fresh);
  for (const agent of state.agents.filter(item => item.enabled)) {
    const bySource = new Map();
    let processed = 0;
    let flagged = 0;
    let latest;
    let latestSignal;
    for (const event of history) {
      if (event.type !== agent.type || (agent.source && agent.source !== event.source)) continue;
      const queue = bySource.get(event.source) || [];
      const cutoff = Date.parse(event.time) - 600000;
      while (queue.length && Date.parse(queue[0].time) < cutoff) queue.shift();
      queue.push(event);
      bySource.set(event.source, queue);
      if (!check.has(event)) continue;
      processed++;
      latest = event;
      if (queue.length >= agent.threshold) {
        const agents = matches.get(event) || [];
        agents.push({ id: agent.id, name: agent.name, count: queue.length, threshold: agent.threshold });
        matches.set(event, agents);
        flagged++;
        latestSignal = event;
      }
    }
    if (processed) runs.push({ agent, processed, flagged, latest, latestSignal });
  }
  const eventIds = new Map(fresh.map(event => [event, randomUUID()]));
  const events = history.map(event => check.has(event)
    ? { ...event, id: eventIds.get(event), agent: matchLabel(matches.get(event)),
        matches: (matches.get(event) || []).map(agent => agent.id),
        ...(matches.has(event) && { evidence: matches.get(event) }),
        status: matches.has(event) ? 'new' : 'logged' } : event)
    .reverse().slice(0, 1000);
  const agentStats = { ...state.agentStats };
  const lastRun = new Date().toISOString();
  for (const { agent, processed, flagged, latest } of runs) {
    const before = agentStats[agent.id] || { processed: 0, flagged: 0 };
    agentStats[agent.id] = {
      processed: before.processed + processed, flagged: before.flagged + flagged,
      lastRun, lastSource: latest.source, lastEventTime: latest.time
    };
  }
  const reports = runs.map(({agent, processed, flagged, latestSignal}) =>
    roomPost(agent.name, flagged ? 'signal' : 'report',
      'Проверено: ' + processed + ' · Сигналов: ' + flagged + ' · ' + types[agent.type],
      latestSignal ? eventIds.get(latestSignal) : undefined));
  save({ ...state, ...changes, events, agentStats, room: appendRoom(reports), seen: [...seen].slice(-5000), imported: state.imported + fresh.length });
  if (fresh.length) live.publish('input', 'Принято событий: ' + fresh.length + ' · Сигналов: ' + matches.size);
  for (const { agent, processed, flagged } of runs) {
    live.publish(flagged ? 'alert' : 'analysis', 'Проверено: ' + processed + ' · Сигналов: ' + flagged + ' · Порог: ' + agent.threshold + ' за 10 мин', agent.name);
    if (flagged && modelReady(agent) && agent.allowBrief && agent.autoBrief) summaryQueue.add(agent.id);
  }
  return { added: fresh.length, flagged: matches.size };
}

function roomPost(author, kind, text, eventId) {
  return { id: randomUUID(), author, kind, text, eventId, time: new Date().toISOString() };
}
function appendRoom(posts) {
  return [...state.room, ...posts].slice(-200);
}
function requestSupport(eventId) {
  const event = state.events.find(item => item.id === eventId && item.agent);
  if (!event) fail(404, 'Сигнал больше не доступен в журнале.');
  if (state.room.some(post => post.kind === 'support' && post.eventId === event.id)) {
    fail(409, 'Этот сигнал уже проверен другим агентом.');
  }
  const end = Date.parse(event.time);
  const candidates = state.agents.filter(agent => agent.enabled && agent.type !== event.type
    && (!agent.source || agent.source === event.source));
  if (!candidates.length) fail(409, 'Добавьте активного агента для другой категории событий.');
  const helper = candidates.map(agent => ({
    agent,
    count: state.events.filter(item => item.type === agent.type && item.source === event.source
      && Date.parse(item.time) >= end - 600000 && Date.parse(item.time) <= end).length
  })).sort((a, b) => b.count - a.count)[0];
  const message = 'Сверка источника ' + event.source + ' за 10 минут до сигнала. '
    + types[helper.agent.type] + ': ' + helper.count + ' записей в сохранённом журнале.';
  const request = roomPost('Оператор', 'request', 'Запросил сверку сигнала по источнику ' + event.source + '.', event.id);
  const result = roomPost(helper.agent.name, 'support', message, event.id);
  save({ ...state, room: appendRoom([request, result]) });
  live.publish('analysis', message, helper.agent.name);
  return result;
}

function matchLabel(agents = []) {
  const names = agents.slice(0, 2).map(agent => agent.name).join(', ');
  return names + (agents.length > 2 ? ' +' + (agents.length - 2) : '');
}

function addAgents(body) {
  const { count, type } = body;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!Number.isInteger(count) || count < 1 || count > limit - state.agents.length) {
    fail(400, 'Свободно мест: ' + (limit - state.agents.length) + '.');
  }
  if (!name || name.length > 32 || !Object.hasOwn(types, type)) fail(400, 'Укажите имя и тип события.');
  const names = new Set(state.agents.map(agent => agent.name));
  const created = [];
  let index = 1;
  while (created.length < count) {
    const label = count === 1 && !names.has(name) ? name : name + ' ' + index++;
    if (names.has(label)) continue;
    names.add(label);
    created.push({
      id: randomUUID(), name: label, type, desc: types[type], mark: '◇', color: 'cyan',
      enabled: true, model: baseModel.id, allowBrief: true, autoBrief: false, source: '',
      threshold: type === 'auth_failed' ? 5 : 1
    });
  }
  save({ ...state, agents: [...state.agents, ...created] });
  live.publish('operation', 'Запущено агентов: ' + created.length);
  return { added: created.length };
}

function demo() {
  if (state.demoLoaded) return { added: 0, flagged: 0 };
  const now = Date.now();
  const event = (seconds, type, source) => ({ time: new Date(now - seconds * 1000).toISOString(), type, source });
  return ingest([
    ...[290, 281, 273, 259, 243, 219].map(t => event(t, 'auth_failed', 'demo-gateway')),
    event(201, 'permission_changed', 'demo-console'),
    event(179, 'service_ok', 'demo-worker'),
    ...[165, 131, 94].map(t => event(t, 'outbound_flagged', 'demo-worker')),
    event(56, 'service_ok', 'demo-gateway')
  ], { demoLoaded: true });
}

function watch() {
  if (!state.monitoring) return;
  runtime.lastTick = new Date().toISOString();
  try {
    const batch = readTelemetry(inbox, state.cursor, row => normalize([row])[0]);
    if (batch) ingest(batch.events, {
      cursor: batch.cursor, watched: state.watched + batch.events.length, rejected: state.rejected + batch.rejected
    });
    if (batch?.rejected) live.publish('operation', 'Строк с ошибками формата: ' + batch.rejected);
    runtime.error = null;
  } catch {
    if (!runtime.error) live.publish('operation', 'Ошибка чтения или сохранения журнала');
    runtime.error = 'Не удалось прочитать telemetry/events.jsonl или сохранить события.';
  }
}

async function watchWindows() {
  if (process.platform !== 'win32' || !state.monitoring || readingWindows) return;
  readingWindows = true;
  try {
    const batch = await readWindows(state.windowsCursor);
    if (!state.monitoring) return;
    windowsStatus.lastTick = new Date().toISOString();
    const statusChanged = batch.available.join() !== windowsStatus.available.join()
      || batch.failed.join() !== windowsStatus.failed.join();
    windowsStatus.available = batch.available;
    windowsStatus.failed = batch.failed;
    if (statusChanged && batch.available.length) {
      live.publish('operation', 'Подключены журналы Windows: ' + batch.available.join(', '));
    }
    if (statusChanged && batch.failed.length) {
      live.publish('operation', 'Недоступны журналы Windows: ' + batch.failed.join(', '));
    }
    if (batch.events.length) {
      ingest(batch.events, { windowsCursor: batch.cursor, windowsRead: state.windowsRead + batch.events.length });
    }
  } catch {
    live.publish('operation', 'Не удалось сохранить события Windows');
  } finally {
    readingWindows = false;
  }
}

function modelReady(agent) {
  return agent.model.startsWith(localPrefix) || Boolean(apiKey);
}

async function localModels() {
  const response = await fetch(localBase + '/tags', { redirect: 'error', signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error('Ollama catalog');
  const result = await response.json();
  return (result.models || []).filter(item => typeof item.name === 'string'
    && !/cloud/i.test(item.name) && !item.remote_host && !item.remote_model && item.size > 0)
    .map(item => ({ id: localPrefix + item.name, label: 'Ollama · ' + item.name }));
}

async function catalog() {
  if (Date.now() - catalogFetchedAt < 300000) return models;
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    signal: AbortSignal.timeout(8000), redirect: 'error'
  });
  if (!response.ok) throw new Error('catalog');
  const result = await response.json();
  const free = result.data.filter(model => model.id?.endsWith(':free')
    && model.architecture?.output_modalities?.includes('text')
    && model.architecture?.input_modalities?.includes('text')
    && model.pricing?.prompt === '0' && model.pricing?.completion === '0');
  models = [baseModel, ...free.map(model => ({ id: model.id, label: model.name }))];
  catalogFetchedAt = Date.now();
  return models;
}

async function makeBrief(agentId, automatic = false) {
  const agent = state.agents.find(item => item.id === agentId && item.enabled);
  if (!agent?.allowBrief) fail(400, 'Запустите агента и разрешите сводки в его настройках.');
  const local = agent.model.startsWith(localPrefix);
  const provider = local ? 'Ollama' : 'OpenRouter';
  if (!modelReady(agent)) fail(400, 'Подключите ключ OpenRouter в разделе «Модели».');
  if (briefing) fail(409, 'Сводка уже формируется.');
  const offers = local ? await localModels().catch(() => [])
    : agent.model === baseModel.id ? [baseModel] : await catalog().catch(() => []);
  if ((local || agent.model !== baseModel.id) && !offers.some(model => model.id === agent.model)) {
    fail(409, local ? 'Модель Ollama недоступна. Проверьте приложение Ollama и обновите каталог.' : 'Эта бесплатная модель сейчас недоступна. Выберите автовыбор или обновите каталог.');
  }
  if (briefing) fail(409, 'Сводка уже формируется.');
  if (!modelReady(agent) || !state.agents.includes(agent) || (automatic && (!state.monitoring || !agent.autoBrief))) {
    fail(409, 'Настройки агента изменились. Повторите запрос.');
  }
  const events = state.events.filter(event => event.type === agent.type && (!agent.source || event.source === agent.source));
  const hits = events.filter(event => event.matches?.includes(agent.id) ?? (event.agent === agent.name));
  const stats = { events: events.length, flagged: hits.length, open: hits.filter(event => event.status === 'new').length };
  if (!stats.events) fail(400, 'Сначала загрузите события для этого агента.');
  briefing = true;
  activeAgentId = agent.id;
  live.publish('model', 'Запрошена сводка · ' + agent.model, agent.name);
  try {
    const messages = [{ role: 'user', content: 'Кратко, по-русски опиши эти счётчики и подскажи, что проверить в собственном журнале. Не называй виновников. Категория и счётчики: ' + JSON.stringify({ category: types[agent.type], ...stats }) }];
    const headers = { 'Content-Type': 'application/json' };
    if (!local) headers.Authorization = 'Bearer ' + apiKey;
    const body = local
      ? { model: agent.model.slice(localPrefix.length), stream: false, options: { num_predict: 600 }, messages }
      : { model: agent.model, max_tokens: 1100, messages };
    const response = await fetch(local ? localBase + '/chat' : 'https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(local ? 90000 : 35000), headers,
      body: JSON.stringify(body)
    });
    if (response.status === 401 || response.status === 403) fail(502, provider + ' отклонил доступ.');
    if (response.status === 429) fail(429, provider + ' ограничил частоту запросов. Попробуйте позже.');
    if (!response.ok) fail(502, provider + ' вернул HTTP ' + response.status + '.');
    const result = await response.json();
    const answer = (local ? result.message?.content : result.choices?.[0]?.message?.content)?.trim();
    if (!answer) {
      const choice = result.choices?.[0];
      if (choice?.finish_reason === 'length') fail(502, 'Модель исчерпала лимит ответа. Выберите другую бесплатную модель.');
      if (result.error || choice?.error || choice?.finish_reason === 'error') fail(502, 'Провайдер модели вернул ошибку. Выберите другую бесплатную модель.');
      fail(502, 'Модель не вернула текст. Выберите другой бесплатный вариант.');
    }
    const brief = { agent: agent.name, model: local ? agent.model : result.model || agent.model, time: new Date().toISOString(), text: answer.slice(0, 5000) };
    if (state.agents.some(item => item.id === agent.id)) {
      save({ ...state, brief, modelHistory: { ...state.modelHistory, [agent.id]: brief },
        room: appendRoom([roomPost(agent.name, 'summary', brief.text)]) });
    }
    live.publish('model', 'Получена сводка · ' + brief.model, agent.name);
    return brief;
  } catch (error) {
    live.publish('model', error.status ? error.message : 'Запрос к ' + provider + ' не завершился.', agent.name);
    if (error.status) throw error;
    fail(502, 'Запрос к ' + provider + ' не завершился.');
  } finally {
    activeAgentId = null;
    briefing = false;
  }
}

async function runQueue() {
  if (briefing || !state.monitoring || !summaryQueue.size || Date.now() - lastAuto < 18000) return;
  const calls = state.autoCalls.filter(at => at >= Date.now() - 86400000);
  if (calls.length >= 36) return;
  const [id] = summaryQueue;
  summaryQueue.delete(id);
  const agent = state.agents.find(item => item.id === id);
  if (!agent?.enabled || !agent.allowBrief || !agent.autoBrief || !modelReady(agent)) return;
  lastAuto = Date.now();
  save({ ...state, autoCalls: [...calls, lastAuto] });
  try {
    await makeBrief(id, true);
  } catch (error) {
    if (error.status === 409 && briefing) summaryQueue.add(id);
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://d8j0ntlcm91z4.cloudfront.net; media-src 'self' blob: https://d8j0ntlcm91z4.cloudfront.net; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  const reply = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  try {
    if (req.headers.host !== host + ':' + port) fail(403, 'Откройте ' + origin);
    const path = new URL(req.url, origin).pathname;
    const asset = assets.get(path);
    if (req.method === 'GET' && asset) {
      res.writeHead(200, { 'Content-Type': asset[1] });
      res.end(readFileSync(join(root, 'public', asset[0])));
      return;
    }
    if (req.method === 'GET' && path === '/api/health') return reply(200, { app: 'UltraSquad', ok: true });
    if (req.method === 'GET' && path === '/api/state') return reply(200, snapshot());
    if (req.method === 'GET' && path === '/api/runtime') return reply(200, status());
    if (req.method === 'GET' && path === '/api/live') return live.subscribe(req, res);
    const routes = ['/api/demo', '/api/import', '/api/agents', '/api/review', '/api/models', '/api/watch', '/api/toggle', '/api/add-agents', '/api/remove-agent', '/api/key', '/api/brief', '/api/room-note', '/api/support', '/api/source-review'];
    if (req.method !== 'POST' || !routes.includes(path)) fail(404, 'Страница не найдена.');
    const body = await readJson(req);
    if (path === '/api/demo') return reply(200, demo());
    if (path === '/api/support') return reply(200, requestSupport(body.eventId));
    if (path === '/api/source-review') {
      if (typeof body.source !== 'string' || !body.source.trim() || Buffer.byteLength(body.source) > 120000) {
        fail(400, 'Вставьте исходный код размером до 120 КБ.');
      }
      const scope = typeof body.scope === 'string' ? body.scope.trim() : '';
      if (scope.length > 100) fail(400, 'Сократите название домена или компонента до 100 символов.');
      const findings = reviewSource(body.source);
      const text = findings.length
        ? findings.length + ' замечаний для ручной проверки.\n' + findings.map(item => 'Строка ' + item.line + ' · ' + item.title + '. ' + item.fix).join('\n')
        : 'Завершена локальная проверка по пяти правилам. Совпадений нет.';
      save({ ...state, room: appendRoom([roomPost('Ревью кода', 'code', scope ? scope + '\n' + text : text)]) });
      live.publish('analysis', 'Локальное ревью кода · Замечаний: ' + findings.length, 'Ревью кода');
      return reply(200, { findings });
    }
    if (path === '/api/room-note') {
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > 800) fail(400, 'Напишите заметку длиной от 1 до 800 символов.');
      const post = roomPost('Оператор', 'note', text);
      save({ ...state, room: appendRoom([post]) });
      return reply(200, post);
    }
    if (path === '/api/add-agents') return reply(200, addAgents(body));
    if (path === '/api/remove-agent') {
      const removed = state.agents.find(agent => agent.id === body.id);
      if (!removed) fail(404, 'Агент не найден.');
      const agents = state.agents.filter(agent => agent.id !== body.id);
      const modelHistory = { ...state.modelHistory };
      const agentStats = { ...state.agentStats };
      delete modelHistory[body.id];
      delete agentStats[body.id];
      save({ ...state, agents, modelHistory, agentStats });
      summaryQueue.delete(body.id);
      live.publish('operation', 'Конфигурация удалена', removed.name);
      return reply(200, { ok: true });
    }
    if (path === '/api/import') {
      if (!Array.isArray(body.events) || !body.events.length) fail(400, 'Укажите массив событий.');
      return reply(200, ingest(body.events));
    }
    if (path === '/api/watch') {
      if (typeof body.enabled !== 'boolean') fail(400, 'Укажите режим наблюдения.');
      save({ ...state, monitoring: body.enabled });
      live.publish('operation', body.enabled ? 'Мониторинг запущен' : 'Мониторинг на паузе');
      if (body.enabled) { watch(); void watchWindows(); }
      return reply(200, { enabled: state.monitoring });
    }
    if (path === '/api/toggle') {
      if (typeof body.enabled !== 'boolean' || !state.agents.some(agent => agent.id === body.id)) fail(400, 'Выберите агента и режим работы.');
      const agents = state.agents.map(agent => agent.id === body.id ? { ...agent, enabled: body.enabled } : agent);
      save({ ...state, agents });
      if (!body.enabled) summaryQueue.delete(body.id);
      live.publish('operation', body.enabled ? 'Агент запущен' : 'Агент на паузе', agents.find(agent => agent.id === body.id).name);
      return reply(200, { ok: true });
    }
    if (path === '/api/key') {
      if (typeof body.key !== 'string' || (body.key !== '' && !/^sk-or-v1-[\da-f]{64}$/i.test(body.key))) fail(400, 'Проверьте формат ключа OpenRouter.');
      apiKey = body.key;
      revision++;
      if (!apiKey) for (const id of summaryQueue) {
        const agent = state.agents.find(item => item.id === id);
        if (agent && !modelReady(agent)) summaryQueue.delete(id);
      }
      return reply(200, { connected: Boolean(apiKey) });
    }
    if (path === '/api/models') {
      const [router, ollama] = await Promise.allSettled([catalog(), localModels()]);
      return reply(200, { models: [
        ...(router.status === 'fulfilled' ? router.value : [baseModel]),
        ...(ollama.status === 'fulfilled' ? ollama.value : [])
      ], ollamaAvailable: ollama.status === 'fulfilled', routerAvailable: router.status === 'fulfilled' });
    }
    if (path === '/api/brief') return reply(200, await makeBrief(body.id));
    if (path === '/api/review') {
      if (!state.events.some(event => event.id === body.id && event.status === 'new')) fail(404, 'Открытый сигнал не найден.');
      const events = state.events.map(event => event.id === body.id ? { ...event, status: 'reviewed' } : event);
      save({ ...state, events });
      live.publish('operation', 'Сигнал отмечен проверенным');
      return reply(200, { ok: true });
    }
    const agent = state.agents.find(item => item.id === body.id);
    if (!agent || typeof body.allowBrief !== 'boolean' || typeof body.autoBrief !== 'boolean' || typeof body.source !== 'string'
        || (body.source && !/^[\p{L}\p{N} _.-]{1,40}$/u.test(body.source)) || !Number.isInteger(body.threshold)
        || body.threshold < 1 || body.threshold > 50
        || (body.model !== agent.model && !models.some(model => model.id === body.model)
          && !(typeof body.model === 'string' && body.model.startsWith(localPrefix)
            && (await localModels().catch(() => [])).some(model => model.id === body.model)))) {
      fail(400, 'Проверьте модель, переключатель и порог от 1 до 50.');
    }
    const agents = state.agents.map(item => item.id === agent.id
      ? { ...item, allowBrief: body.allowBrief, autoBrief: body.allowBrief && body.autoBrief,
          source: body.source, threshold: body.threshold, model: body.model } : item);
    save({ ...state, agents });
    if (!body.allowBrief || !body.autoBrief) summaryQueue.delete(body.id);
    live.publish('operation', 'Настройки сохранены', agent.name);
    return reply(200, { ok: true });
  } catch (error) {
    if (!res.destroyed) reply(error.status || 500, { error: error.status ? error.message : 'Ошибка локального сервера.' });
  }
});

server.listen(port, host, () => {
  console.log('UltraSquad • ' + origin);
  live.publish('operation', 'Локальный сервер запущен');
  watch();
  void watchWindows();
  setInterval(watch, 1500).unref();
  setInterval(watchWindows, 12000).unref();
  setInterval(() => runQueue().catch(() => live.publish('operation', 'Ошибка очереди сводок')), 2500).unref();
});
