#!/usr/bin/env node
// UltraSquad MCP-сервер — управление отрядом из приложения Claude (Claude Desktop).
// Говоришь Claude «покажи угрозы / мобилизуй отряд / поставь задачу», он дёргает локальный API UltraSquad.
// Без зависимостей. Протокол MCP поверх stdio (JSON-RPC 2.0, построчно).
// Подключение: см. README (claude_desktop_config.json). Сервер локальный: работает, пока запущен UltraSquad.
'use strict';
import readline from 'node:readline';

const BASE = (process.env.ULTRASQUAD_URL || 'http://127.0.0.1:7777').replace(/\/+$/, '');
const api = async (path, method = 'GET', body) => {
  const r = await fetch(BASE + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
};

const TOOLS = [
  { name: 'ultrasquad_status', description: 'Статус UltraSquad: сколько агентов, найденные угрозы, мобилизация, карантин, Defender.', inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const s = await api('/api/state');
      const real = (s.intel || []).filter(t => t.real);
      return [
        `Агентов: ${s.agents.length}/${s.max}, в работе: ${s.agents.filter(a => a.state && a.state !== 'idle').length}`,
        `Страниц прочитано: ${s.agents.reduce((n, a) => n + (a.steps || 0), 0)}`,
        `Реальных угроз в ленте: ${real.length} (из них critical: ${real.filter(t => t.sev === 'critical').length})`,
        `Фиды: CISA KEV ${s.intelStatus?.kev || 0}, NVD ${s.intelStatus?.nvd || 0}`,
        `Мобилизация: ${s.defense?.mode === 'mobilized' ? 'ДА — ' + s.defense.topic : 'нет'}`,
        `Карантин: ${s.lock?.on ? 'включён' : 'выключен'} · оценка защиты: ${s.sec?.score ?? '—'}/100 · в бане: ${s.sec?.banned ?? 0}`,
        `Defender: ${s.defender?.available ? 'включён' : 'нет/недоступен'}${s.defender?.activeThreats ? ', активных угроз ' + s.defender.activeThreats : ''}`
      ].join('\n');
    } },
  { name: 'ultrasquad_threats', description: 'Последние реальные угрозы, найденные отрядом (CVE из CISA KEV / NVD).', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'сколько показать (по умолчанию 15)' } } },
    run: async (a) => {
      const s = await api('/api/state');
      const list = (s.intel || []).filter(t => t.real).slice(-(a.limit || 15)).reverse();
      if (!list.length) return 'Пока реальных угроз нет (фиды подгружаются).';
      return list.map(t => `• [${t.sev}] ${t.match} ${t.ransomware ? '⚠ransomware ' : ''}— ${t.title} (${t.source}, ${t.date || ''}) ${t.url}`).join('\n');
    } },
  { name: 'ultrasquad_mobilize', description: 'Мобилизовать отряд на угрозу (весь отряд + карантин), либо отбой.', inputSchema: { type: 'object', properties: { on: { type: 'boolean', description: 'true — мобилизация, false — отбой' }, topic: { type: 'string', description: 'тема угрозы (необязательно)' } } },
    run: async (a) => { const r = await api('/api/mobilize', 'POST', { on: a.on !== false, topic: a.topic }); return 'Режим: ' + (r.mode === 'mobilized' ? 'МОБИЛИЗАЦИЯ — ' + r.topic : 'спокойно'); } },
  { name: 'ultrasquad_lockdown', description: 'Включить или снять защитный карантин сервера.', inputSchema: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
    run: async (a) => { const r = await api('/api/lockdown', 'POST', { on: !!a.on }); return 'Карантин: ' + (r.on ? 'включён' : 'выключен'); } },
  { name: 'ultrasquad_patrol', description: 'Запустить защитный патруль Sentinel (разбор журнала и бан атакующих).', inputSchema: { type: 'object', properties: {} },
    run: async () => { const r = await api('/api/patrol', 'POST'); return r.reply + (r.banned?.length ? '\nЗаблокированы: ' + r.banned.join(', ') : ''); } },
  { name: 'ultrasquad_spawn', description: 'Добавить агентов в отряд (до 1000 всего).', inputSchema: { type: 'object', properties: { count: { type: 'number' }, template: { type: 'string', description: 'cve|malware|ransom|botnet|rogue|breach|phish|threat (необязательно)' } }, required: ['count'] },
    run: async (a) => { const r = await api('/api/agents', 'POST', { count: a.count, template: a.template }); return 'Добавлено агентов: ' + (r.created ?? 0); } },
  { name: 'ultrasquad_task', description: 'Поставить задачу отряду в чат (например «найди свежие уязвимости Windows»). @ИМЯ — одному агенту.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run: async (a) => { await api('/api/chat', 'POST', { text: String(a.text || '').slice(0, 500) }); return 'Отправлено отряду: ' + a.text; } },
  { name: 'ultrasquad_pause', description: 'Поставить отряд на паузу.', inputSchema: { type: 'object', properties: {} },
    run: async () => { await api('/api/settings', 'POST', { running: false }); return 'Отряд на паузе.'; } },
  { name: 'ultrasquad_resume', description: 'Снять паузу, отряд продолжает работу.', inputSchema: { type: 'object', properties: {} },
    run: async () => { await api('/api/settings', 'POST', { running: true }); return 'Отряд снова в работе.'; } }
];
const byName = Object.fromEntries(TOOLS.map(t => [t.name, t]));

const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ultrasquad', version: '1.0.0' } });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return; // без ответа
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (method === 'tools/call') {
    const tool = byName[params?.name];
    if (!tool) return fail(id, -32602, 'Нет такого инструмента: ' + params?.name);
    try {
      const text = await tool.run(params.arguments || {});
      return reply(id, { content: [{ type: 'text', text: String(text) }] });
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: 'Ошибка UltraSquad: ' + e.message + '\n(UltraSquad запущен? ' + BASE + ')' }], isError: true });
    }
  }
  if (id !== undefined) return fail(id, -32601, 'Метод не поддерживается: ' + method);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => { line = line.trim(); if (!line) return; let msg; try { msg = JSON.parse(line); } catch { return; } Promise.resolve(handle(msg)).catch(e => process.stderr.write('mcp error: ' + e.message + '\n')); });
process.stderr.write('UltraSquad MCP готов → ' + BASE + '\n');
