(function () {
  'use strict';
  const feed = document.querySelector('#activity-feed');
  const status = document.querySelector('#stream-state');
  const pause = document.querySelector('#feed-pause');
  const clock = new Intl.DateTimeFormat('ru', { timeStyle: 'medium' });
  const kinds = { operation: 'Система', input: 'Источник', analysis: 'Проверка', alert: 'Сигнал', model: 'Модель' };
  const history = [];
  const seen = new Set();
  let paused = false;
  let waiting = 0;
  const stream = new EventSource('/api/live');

  function entry(item) {
    const article = document.createElement('article');
    article.className = 'feed-entry';
    const meta = document.createElement('div');
    meta.className = 'feed-meta';
    const time = document.createElement('time');
    time.dateTime = item.time;
    time.textContent = clock.format(new Date(item.time));
    const label = document.createElement('span');
    label.textContent = item.agent || kinds[item.kind] || 'Система';
    const text = document.createElement('p');
    text.textContent = item.text;
    meta.append(time, label);
    article.append(meta, text);
    return article;
  }
  function showHistory() {
    feed.replaceChildren(...history.slice().reverse().map(entry));
    if (!history.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Ожидание действий сервера';
      feed.append(empty);
    }
  }
  stream.onopen = () => { status.textContent = paused ? 'Лента на паузе · Сервер подключён' : 'Трансляция подключена'; };
  stream.onerror = () => { status.textContent = 'Соединение прервано · Переподключение'; };
  stream.onmessage = event => {
    let item;
    try { item = JSON.parse(event.data); } catch { return; }
    if (typeof item.text !== 'string' || !Number.isFinite(Date.parse(item.time))) return;
    const key = item.id + ':' + item.time;
    if (seen.has(key)) return;
    seen.add(key);
    history.push(item);
    if (history.length > 180) {
      const oldest = history.shift();
      seen.delete(oldest.id + ':' + oldest.time);
    }
    if (paused) {
      waiting++;
      pause.textContent = 'Продолжить ленту' + (waiting ? ' (' + waiting + ')' : '');
      return;
    }
    feed.querySelector('.empty')?.remove();
    feed.prepend(entry(item));
    if (feed.children.length > 180) feed.lastElementChild.remove();
  };
  pause.addEventListener('click', () => {
    paused = !paused;
    pause.textContent = paused ? 'Продолжить ленту' : 'Пауза ленты';
    status.textContent = paused ? 'Лента на паузе · Сервер продолжает работу' : (stream.readyState === EventSource.OPEN ? 'Трансляция подключена' : 'Переподключение');
    if (!paused) { waiting = 0; showHistory(); }
  });
  window.addEventListener('pagehide', () => stream.close());
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
})();