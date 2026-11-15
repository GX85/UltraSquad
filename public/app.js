(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const sections = { overview: 'Обзор', agents: 'Агенты', chat: 'Чат агентов', code: 'Ревью кода', live: 'Лента действий', events: 'Журнал', models: 'Модели' };
  const statuses = { new: 'Открыт', reviewed: 'Проверен', logged: 'Без сигнала' };
  const dates = new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'medium' });
  const times = new Intl.DateTimeFormat('ru', { timeStyle: 'medium' });
  let state;
  let selectedId;
  let models = [{ id: 'openrouter/free', label: 'Автовыбор бесплатной модели' }];
  let busy = 0;
  let dirty = false;
  let polling = false;
  let noticeTimer;

  function escape(value) {
    const chars = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value ?? '').replace(/[&<>"']/g, character => chars[character]);
  }
  async function api(path, body) {
    const response = await fetch('/api/' + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Запрос не выполнен.');
    return result;
  }
  function notify(message, error = false) {
    const element = $('#notice');
    element.textContent = message;
    element.classList.toggle('error', error);
    element.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { element.hidden = true; }, error ? 10000 : 4500);
  }
  function navigate() {
    const candidate = location.hash.slice(1);
    const section = Object.hasOwn(sections, candidate) ? candidate : 'overview';
    document.querySelectorAll('.page').forEach(page => { page.hidden = page.id !== section; });
    document.querySelectorAll('[data-nav]').forEach(link => {
      if (link.dataset.nav === section) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    $('#crumb').textContent = sections[section];
    window.scrollTo(0, 0);
    if (section === 'chat') $('#room-feed').scrollTop = $('#room-feed').scrollHeight;
  }
  function modelOptions(agent) {
    const list = models.some(model => model.id === agent.model) ? models : [...models, { id: agent.model, label: agent.model }];
    return list.map(model => '<option value="' + escape(model.id) + '"' + (model.id === agent.model ? ' selected' : '') + '>' + escape(model.label) + '</option>').join('');
  }
  function activityLabel(agent, measure) {
    if (!agent.enabled) return 'Агент на паузе';
    if (!measure?.lastRun) return 'Ожидание событий по правилу';
    return 'Обработка ' + dates.format(new Date(measure.lastRun));
  }
  function renderAgentList() {
    const search = $('#agent-search').value.toLocaleLowerCase('ru');
    const matches = state.agents.filter(agent => agent.name.toLocaleLowerCase('ru').includes(search));
    $('#agent-list').innerHTML = matches.map(agent => '<button type="button" class="agent-choice" data-select="' + escape(agent.id)
      + '" aria-pressed="' + (agent.id === selectedId) + '"><strong>' + escape(agent.name) + '</strong><small>'
      + escape(activityLabel(agent, state.runtime.operating?.[agent.id])) + ' · ' + escape(state.types[agent.type]) + '</small></button>').join('') || '<p class="empty">Агенты не найдены</p>';
  }
  function renderEditor() {
    const agent = state.agents.find(item => item.id === selectedId);
    if (!agent) {
      $('#agent-editor').innerHTML = '<p class="empty">Добавьте агента, чтобы настроить обработку событий.</p>';
      return;
    }
    const disabledBrief = !agent.enabled || !agent.allowBrief;
    const measure = state.runtime.operating?.[agent.id];
    $('#agent-editor').innerHTML = [
      '<div class="editor-heading"><h3>' + escape(agent.name) + '</h3><button type="button" data-toggle="' + escape(agent.id) + '" data-enabled="' + !agent.enabled + '">' + (agent.enabled ? 'Пауза' : 'Запустить') + '</button></div>',
      '<p class="editor-description">' + escape(state.types[agent.type]) + ' · Порог на один источник за 10 минут</p>',
      '<dl class="agent-activity"><div><dt>Обработано</dt><dd>' + (measure?.processed ?? 0) + '</dd></div>'
        + '<div><dt>Сигналов</dt><dd>' + (measure?.flagged ?? 0) + '</dd></div>'
        + '<div><dt>Последнее событие</dt><dd>' + (measure?.lastEventTime
          ? escape(dates.format(new Date(measure.lastEventTime))) + ' · ' + escape(measure.lastSource ?? '')
          : '—') + '</dd></div></dl>',
      '<form class="agent-form" data-agent="' + escape(agent.id) + '">',
      '<label>Порог событий<input name="threshold" type="number" min="1" max="50" value="' + agent.threshold + '" required></label>',
      '<label>Источник<input name="source" maxlength="40" value="' + escape(agent.source) + '" placeholder="Все источники"></label>',
      '<label class="wide">Бесплатная модель<select name="model">' + modelOptions(agent) + '</select></label>',
      '<label class="toggle wide"><input name="allowBrief" type="checkbox"' + (agent.allowBrief ? ' checked' : '') + '>Разрешить сводки</label>',
      '<label class="toggle wide"><input name="autoBrief" type="checkbox"' + (agent.autoBrief ? ' checked' : '') + '>Запрашивать сводку при новом сигнале</label>',
      '<p class="muted wide">Автосводки используют общую очередь, до 36 запросов за сутки.</p>',
      '<div class="actions"><button type="submit">Сохранить</button><button type="button" data-brief="' + escape(agent.id) + '"' + (disabledBrief ? ' disabled' : '') + '>Сводка ↗</button><button type="button" class="ghost delete" data-remove="' + escape(agent.id) + '">Удалить</button></div>',
      '</form>'
    ].join('');
    renderBrief();
  }
  function renderBrief() {
    const brief = state.modelHistory?.[selectedId] || (state.brief?.agent === state.agents.find(agent => agent.id === selectedId)?.name ? state.brief : null);
    $('#brief').innerHTML = brief
      ? '<p>' + escape(brief.agent) + ' · ' + escape(brief.model) + ' · ' + escape(dates.format(new Date(brief.time))) + '</p><pre>' + escape(brief.text) + '</pre>'
      : '<p class="empty">Сводка появится после запроса к модели.</p>';
  }
  const roomKinds = { note: 'Заметка', report: 'Отчёт', signal: 'Сигнал', request: 'Запрос подмоги',
    support: 'Сверка', summary: 'Сводка модели', code: 'Ревью', question: 'Запрос', reply: 'Ответ' };
  function supportButton(eventId) {
    return '<button type="button" class="ghost support-button" data-support="' + escape(eventId) + '">Вызвать подмогу</button>';
  }
  function renderRoom() {
    const filter = $('#room-filter').value;
    const posts = (state.room || []).filter(post => filter === 'all' || ['signal', 'request', 'support', 'code'].includes(post.kind));
    const supported = new Set((state.room || []).filter(post => post.kind === 'support').map(post => post.eventId));
    const eventIds = new Set(state.events.map(event => event.id));
    const feed = $('#room-feed');
    const key = filter + ':' + posts.map(post => post.id).join(',') + ':' + state.imported;
    if (feed.dataset.key === key) return;
    const atEnd = feed.scrollHeight - feed.clientHeight - feed.scrollTop < 90 || !feed.dataset.key;
    feed.dataset.key = key;
    feed.innerHTML = posts.map(post => '<article class="room-post" data-kind="' + escape(post.kind) + '">'
      + '<div class="room-avatar" aria-hidden="true">' + escape(post.author.slice(0, 1).toUpperCase()) + '</div>'
      + '<div class="room-bubble"><header><strong>' + escape(post.author) + '</strong><span>' + escape(roomKinds[post.kind])
      + '</span><time datetime="' + escape(post.time) + '">' + escape(dates.format(new Date(post.time))) + '</time></header>'
      + '<p>' + escape(post.text) + '</p>'
      + (post.kind === 'signal' && eventIds.has(post.eventId) && !supported.has(post.eventId) ? supportButton(post.eventId) : '')
      + '</div></article>').join('') || '<p class="empty">Сообщений по этому фильтру пока нет.</p>';
    if (atEnd) feed.scrollTop = feed.scrollHeight;
  }
  function signalDetails(event) {
    if (!event.agent) return '—';
    const items = (event.evidence || []).map(item => '<li><strong>' + escape(item.name) + '</strong> · '
      + item.count + ' событий за 10 мин, порог ' + item.threshold + '</li>').join('');
    return '<details class="signal-detail" data-evidence="' + escape(event.id) + '"><summary>' + escape(event.agent)
      + '</summary><p>Источник ' + escape(event.source) + '</p>' + (items ? '<ul>' + items + '</ul>' : '')
      + (!(state.room || []).some(post => post.kind === 'support' && post.eventId === event.id) ? supportButton(event.id) : '')
      + '</details>';
  }
  function showTable(element, events, review = false) {
    const opened = new Set(Array.from(element.querySelectorAll('details[open]'), detail => detail.dataset.evidence));
    element.innerHTML = table(events, review);
    for (const detail of element.querySelectorAll('details[data-evidence]')) {
      if (opened.has(detail.dataset.evidence)) detail.open = true;
    }
  }
  function table(events, review = false) {
    if (!events.length) return '<p class="empty">Нет событий по этим условиям</p>';
    const rows = events.map(event => '<tr><td>' + escape(dates.format(new Date(event.time))) + '</td><td>'
      + escape(state.types[event.type]) + '</td><td>' + escape(event.source) + '</td><td>' + signalDetails(event) + '</td><td>'
      + escape(statuses[event.status]) + '</td>' + (review ? '<td>' + (event.status === 'new' ? '<button data-review="' + escape(event.id)
      + '">Проверено</button>' : '') + '</td>' : '') + '</tr>').join('');
    return '<table><thead><tr><th>Время</th><th>Событие</th><th>Источник</th><th>Агент</th><th>Статус</th>' + (review ? '<th>Действия</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function renderEvents() {
    if (!state) return;
    const query = $('#search').value.trim().toLocaleLowerCase('ru');
    const status = $('#filter').value;
    const matches = state.events.filter(event => (!status || status === event.status) &&
      [event.source, state.types[event.type], event.agent, ...(event.evidence || []).map(item => item.name)].some(value => String(value || '').toLocaleLowerCase('ru').includes(query)));
    showTable($('#event-table'), matches, true);
  }
  function renderRuntime() {
    const runtime = state.runtime;
    $('#watch-state').textContent = !runtime.monitoring ? 'Мониторинг на паузе' : runtime.error ? 'Ошибка источника событий' : 'Фоновое наблюдение';
    $('#watch').textContent = runtime.monitoring ? 'Пауза мониторинга' : 'Запустить мониторинг';
    $('#watch').disabled = false;
    $('#watch').dataset.enabled = String(!runtime.monitoring);
    $('#last-poll').textContent = runtime.monitoring && runtime.lastTick ? 'Проверка ' + times.format(new Date(runtime.lastTick)) : 'Пауза';
    $('#watch-count').textContent = runtime.error || ('Принято строк ' + runtime.watched + ' · Ошибок формата ' + runtime.rejected);
    const windows = runtime.windows;
    const label = $('#windows-status');
    label.hidden = !windows?.enabled;
    if (windows?.enabled) {
      const available = windows.available.length ? windows.available.join(', ') : 'подключение';
      const failed = windows.failed.length ? ' · Недоступны ' + windows.failed.join(', ') : '';
      const checked = windows.lastTick ? ' · Опрос ' + times.format(new Date(windows.lastTick)) : '';
      label.textContent = 'Журналы Windows · ' + available + ' · Получено ' + windows.received + checked + failed;
    }
    $('#queue-state').textContent = 'В очереди ' + (runtime.queue || 0);
    const metrics = runtime.operating || {};
    const maximum = Math.max(1, ...Object.values(metrics).map(item => item.processed || 0));
    $('#agent-chart').innerHTML = state.agents.map(agent => {
      const measure = metrics[agent.id] || { processed: 0, flagged: 0 };
      return '<div class="agent-bar"><div><span>' + escape(agent.name) + '</span><span>' + measure.processed + '</span></div><meter min="0" max="' + maximum + '" value="' + measure.processed
        + '" aria-label="Обработано агентом ' + escape(agent.name) + '"></meter><small>Сигналов ' + measure.flagged + ' · ' + escape(activityLabel(agent, measure)) + '</small></div>';
    }).join('') || '<p class="empty">Добавьте агентов для наблюдения.</p>';
  }
  function render(options = {}) {
    if (!state.agents.some(agent => agent.id === selectedId)) { selectedId = state.agents[0]?.id; dirty = false; }
    $('#stat-total').textContent = state.imported;
    $('#stat-open').textContent = state.events.filter(event => event.status === 'new').length;
    $('#stat-agents').textContent = state.agents.filter(agent => agent.enabled).length + ' / ' + state.agents.length;
    showTable($('#recent'), state.events.filter(event => event.agent).slice(0, 5));
    $('#demo').disabled = state.demoLoaded;
    const remaining = (state.limit || 100) - state.agents.length;
    $('#agent-capacity').textContent = state.agents.length + ' из ' + (state.limit || 100) + ' агентов';
    $('#add-form').elements.count.max = Math.max(1, remaining);
    $('#add-form button').disabled = remaining === 0;
    if (!$('#add-type').options.length) $('#add-type').innerHTML = Object.entries(state.types).map(([value, label]) => '<option value="' + escape(value) + '">' + escape(label) + '</option>').join('');
    $('#model-state').textContent = state.connected ? 'Ключ установлен на сервере.' : 'Добавьте ключ для запросов сводок.';
    $('#disconnect').disabled = !state.connected;
    $('#model-list').innerHTML = models.map(model => '<li>' + escape(model.label) + '</li>').join('');
    renderAgentList();
    if (!dirty || options.forceEditor) renderEditor();
    else renderBrief();
    renderEvents();
    const recipients = $('#room-agent');
    const previousRecipient = recipients.value;
    recipients.innerHTML = '<option value="">Все активные агенты</option>'
      + state.agents.filter(agent => agent.enabled).map(agent => '<option value="' + escape(agent.id) + '">' + escape(agent.name) + '</option>').join('');
    if ([...recipients.options].some(option => option.value === previousRecipient)) recipients.value = previousRecipient;
    renderRoom();
    renderRuntime();
    window.updateSignal(state.events);
  }
  async function refresh(forceEditor = false) {
    state = await api('state');
    render({ forceEditor });
  }
  async function run(control, work) {
    if (control.disabled) return;
    busy++;
    const text = control.textContent;
    control.disabled = true;
    control.textContent = 'Выполняется…';
    try { await work(); }
    catch (error) { notify(error.message, true); }
    finally {
      busy--;
      if (control.isConnected) {
        control.textContent = text;
        control.disabled = false;
        if (control.id === 'disconnect') control.disabled = !state?.connected;
        if (control.id === 'demo') control.disabled = Boolean(state?.demoLoaded);
        if (control.form?.id === 'add-form') control.disabled = state.agents.length >= (state.limit || 100);
      }
    }
  }
  $('#demo').addEventListener('click', event => run(event.currentTarget, async () => {
    const result = await api('demo', {});
    await refresh();
    notify('Добавлено ' + result.added + ' событий. Сигналов ' + result.flagged + '.');
  }));
  $('#watch').addEventListener('click', event => {
    const control = event.currentTarget;
    run(control, async () => {
      await api('watch', { enabled: control.dataset.enabled === 'true' });
      await refresh();
      control.textContent = state.runtime.monitoring ? 'Пауза мониторинга' : 'Запустить мониторинг';
    }).then(() => { if (state) renderRuntime(); });
  });
  const picker = $('#file');
  document.querySelectorAll('.import').forEach(button => button.addEventListener('click', () => picker.click()));
  picker.addEventListener('change', async () => {
    const [file] = picker.files;
    picker.value = '';
    if (!file) return;
    try {
      if (file.size > 256 * 1024) throw new Error('Файл превышает 256 КБ.');
      let rows;
      try { rows = JSON.parse(await file.text()); } catch { throw new Error('Файл содержит некорректный JSON.'); }
      const result = await api('import', { events: Array.isArray(rows) ? rows : rows?.events });
      location.hash = 'events';
      await refresh();
      notify('Добавлено ' + result.added + ' событий. Сигналов ' + result.flagged + '.');
    } catch (error) { notify(error.message, true); }
  });
  $('#search').addEventListener('input', renderEvents);
  $('#filter').addEventListener('change', renderEvents);
  $('#agent-search').addEventListener('input', renderAgentList);
  $('#agent-list').addEventListener('click', event => {
    const control = event.target.closest('[data-select]');
    if (!control || control.dataset.select === selectedId) return;
    if (dirty && !confirm('Перейти к другому агенту и сбросить несохранённые настройки?')) return;
    selectedId = control.dataset.select;
    dirty = false;
    renderAgentList();
    renderEditor();
  });
  $('#code-form').addEventListener('submit', event => {
    event.preventDefault();
    run(event.submitter, async () => {
      const result = await api('source-review', { source: $('#source-code').value, scope: $('#code-scope').value });
      $('#code-result').innerHTML = result.findings.length
        ? '<ol>' + result.findings.map(item => '<li><strong>Строка ' + item.line + ' · ' + escape(item.title)
          + '</strong><p>' + escape(item.fix) + '</p></li>').join('') + '</ol>'
        : '<p>Совпадений по пяти правилам нет.</p>';
      await refresh();
      notify('Отчёт добавлен в чат.');
    });
  });
  $('#room-filter').addEventListener('change', () => { if (state) renderRoom(); });
  document.querySelector('.room-shortcuts').addEventListener('click', event => {
    const button = event.target.closest('[data-room-action]');
    if (!button) return;
    const mode = $('#room-mode');
    mode.value = button.dataset.roomAction;
    mode.dispatchEvent(new Event('change'));
    const field = $('#room-note');
    if (mode.value === 'status' && !field.value.trim()) {
      field.value = 'Что вы проверили?';
      $('#room-form').requestSubmit($('#room-form button'));
    } else field.focus();
  });
  $('#room-mode').addEventListener('change', event => {
    $('#room-note').placeholder = event.target.value === 'search' ? 'Источник или событие' : 'Что проверили?';
  });
  $('#room-form').addEventListener('submit', event => {
    event.preventDefault();
    const field = $('#room-note');
    const mode = $('#room-mode').value;
    const query = mode === 'search' ? field.value.trim() : '';
    run(event.submitter, async () => {
      if (mode === 'search') {
        if (query.length > 100) throw new Error('Запрос должен быть короче 101 символа.');
        location.hash = 'events';
        const search = $('#search');
        search.value = '';
        $('#filter').value = '';
        const step = Math.max(1, Math.ceil(query.length / 6));
        for (let end = step; end < query.length + step; end += step) {
          search.value = query.slice(0, end);
          search.dispatchEvent(new Event('input'));
          if (end < query.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            await new Promise(resolve => setTimeout(resolve, 32));
          }
        }
      }
      await api('room-ask', { text: field.value, agentId: $('#room-agent').value, mode, query });
      field.value = '';
      $('#room-filter').value = 'all';
      await refresh();
      location.hash = 'chat';
      $('#room-feed').scrollTop = $('#room-feed').scrollHeight;
    });
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-support]');
    if (!button) return;
    run(button, async () => {
      await api('support', { eventId: button.dataset.support });
      location.hash = 'chat';
      await refresh();
      $('#room-feed').scrollTop = $('#room-feed').scrollHeight;
      notify('Ответ агента добавлен в чат.');
    });
  });
  $('#event-table').addEventListener('click', event => {
    const control = event.target.closest('[data-review]');
    if (control) run(control, async () => { await api('review', { id: control.dataset.review }); await refresh(); });
  });
  $('#add-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    run(event.submitter, async () => {
      await api('add-agents', { name: form.elements.name.value.trim(), count: form.elements.count.valueAsNumber, type: form.elements.type.value });
      await refresh();
      notify('Агенты добавлены.');
    });
  });
  $('#agent-editor').addEventListener('input', () => { dirty = true; });
  $('#agent-editor').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.target;
    run(event.submitter, async () => {
      const fields = form.elements;
      await api('agents', { id: form.dataset.agent, threshold: fields.threshold.valueAsNumber,
        model: fields.model.value, source: fields.source.value.trim(), allowBrief: fields.allowBrief.checked, autoBrief: fields.autoBrief.checked });
      dirty = false;
      await refresh(true);
      notify('Настройки сохранены.');
    });
  });
  $('#agent-editor').addEventListener('click', event => {
    const control = event.target.closest('button');
    if (!control) return;
    if (control.dataset.toggle) run(control, async () => {
      await api('toggle', { id: control.dataset.toggle, enabled: control.dataset.enabled === 'true' });
      await refresh();
      // Preserve unsaved fields while showing the new execution state.
      const agent = state.agents.find(item => item.id === selectedId);
      const toggle = $('#agent-editor [data-toggle]');
      if (toggle && agent) { toggle.dataset.enabled = String(!agent.enabled); toggle.textContent = agent.enabled ? 'Пауза' : 'Запустить'; }
    }).then(() => { if (!dirty) renderEditor(); });
    if (control.dataset.brief) run(control, async () => {
      if (dirty) throw new Error('Сохраните настройки перед запросом сводки.');
      await api('brief', { id: control.dataset.brief });
      await refresh();
      $('#brief').scrollIntoView({ block: 'nearest' });
    });
    if (control.dataset.remove && confirm('Удалить настройки агента «' + state.agents.find(agent => agent.id === control.dataset.remove).name + '»?')) run(control, async () => {
      await api('remove-agent', { id: control.dataset.remove });
      dirty = false;
      await refresh(true);
      notify('Агент удалён.');
    });
  });
  $('#key-form').addEventListener('submit', event => {
    event.preventDefault();
    run(event.submitter, async () => { await api('key', { key: $('#key').value.trim() }); $('#key').value = ''; await refresh(); notify('Ключ установлен. Доступ проверяется при запросе сводки.'); });
  });
  $('#disconnect').addEventListener('click', event => run(event.currentTarget, async () => { await api('key', { key: '' }); await refresh(); notify('Ключ удалён из памяти сервера.'); }));
  $('#models-refresh').addEventListener('click', event => run(event.currentTarget, async () => {
    const result = await api('models', {});
    models = result.models;
    render();
    $('#ollama-model-state').textContent = result.ollamaAvailable ? 'Ollama подключена на этом компьютере.' : 'Локальная Ollama недоступна на этом компьютере.';
    notify(result.routerAvailable ? 'Каталог обновлён.' : 'Каталог OpenRouter временно недоступен.', !result.routerAvailable);
  }));
  async function poll() {
    if (busy || polling || document.hidden) return;
    polling = true;
    try {
      const runtime = await api('runtime');
      if (busy) return;
      if (!state || state.runtime.revision !== runtime.revision) await refresh();
      else { state.runtime = runtime; renderRuntime(); window.updateSignal(state.events); }
    } catch {
      $('#watch-state').textContent = 'Сервер недоступен';
      $('#watch').disabled = true;
    } finally { polling = false; }
  }
  document.addEventListener('ultrasquad:state', () => { void poll(); });
  window.addEventListener('hashchange', navigate);
  $('#local-host').textContent = location.host;
  navigate();
  $('#clock').textContent = times.format(new Date());
  setInterval(() => { $('#clock').textContent = times.format(new Date()); }, 1000);
  setInterval(poll, 2000);
  refresh().catch(error => notify(error.message, true));
})();