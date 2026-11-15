import { byId, connectionLabel, copyFrom, localCode, newPeer, parseCode } from './rtc.js';

const video = byId('video');
const status = byId('status');
const canvas = document.createElement('canvas');
canvas.width = 1280;
canvas.height = 720;
const ctx = canvas.getContext('2d');
const clock = new Intl.DateTimeFormat('ru', { timeStyle: 'medium' });
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const labels = { operation: 'СИСТЕМА', input: 'ЖУРНАЛ', analysis: 'ПРОВЕРКА', alert: 'СИГНАЛ', model: 'МОДЕЛЬ' };
const events = [];
let stream, source, timer, peer;
let online = false;
let latestAt = 0;

function text(value, x, y, size, color, maxWidth) {
  ctx.font = size + 'px "Segoe UI", sans-serif';
  ctx.fillStyle = color;
  const raw = String(value);
  if (!maxWidth || ctx.measureText(raw).width <= maxWidth) {
    ctx.fillText(raw, x, y);
    return;
  }
  let cropped = raw;
  while (cropped.length > 1 && ctx.measureText(cropped + '…').width > maxWidth) cropped = cropped.slice(0, -1);
  ctx.fillText(cropped + '…', x, y);
}

function draw() {
  const now = Date.now();
  ctx.fillStyle = '#141109';
  ctx.fillRect(0, 0, 1280, 720);
  const glow = ctx.createLinearGradient(0, 0, 850, 520);
  glow.addColorStop(0, '#463316');
  glow.addColorStop(1, '#1b150c');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1280, 213);
  ctx.fillStyle = online ? '#ffcd73' : '#bcab8b';
  ctx.beginPath();
  ctx.arc(58, 48, 5, 0, Math.PI * 2);
  ctx.fill();
  text(online ? 'ПРЯМОЙ ЭФИР' : 'ПЕРЕПОДКЛЮЧЕНИЕ', 73, 54, 16, '#d9e0e4');
  text(clock.format(new Date(now)), 1131, 54, 19, '#e2e6ec');
  text('UltraSquad', 51, 143, 65, '#f4f5f1');
  text('Обработка локальных событий', 55, 181, 24, '#c9cdd5');
  ctx.fillStyle = '#594528';
  ctx.fillRect(51, 211, 1178, 1);
  if (!reduce.matches && latestAt && now - latestAt < 900) {
    ctx.fillStyle = '#ffcd73';
    ctx.fillRect(51, 211, 1178 * (1 - (now - latestAt) / 900), 2);
  }
  const update = events.filter(item => item.kind !== 'operation');
  if (!update.length) {
    text(online ? 'Ожидание событий' : 'Подключение к журналу', 53, 300, 43, '#eef0ed');
    const operation = events[0];
    if (operation) text(operation.text, 55, 346, 22, '#b5bbc6', 1140);
  } else {
    const shown = events.slice(0, 6);
    for (const [index, item] of shown.entries()) {
      const y = 233 + index * 66;
      const emph = item.kind === 'alert';
      ctx.fillStyle = emph ? '#40301a' : index % 2 ? '#20190e' : '#2b2214';
      ctx.fillRect(51, y, 1178, 60);
      text(clock.format(new Date(item.time)), 67, y + 24, 15, '#b9bec9');
      text(labels[item.kind] || 'СИСТЕМА', 67, y + 47, 14, emph ? '#ffdb9c' : '#d9c4a0');
      text(item.agent || 'UltraSquad', 188, y + 36, 21, '#f2f4f2', 252);
      text(item.text, 456, y + 36, 20, '#dde2e9', 746);
    }
  }
  text('ЛОКАЛЬНАЯ ПАНЕЛЬ РЕАГИРОВАНИЯ', 53, 687, 15, '#b8bec8');
}

function clearPeer() {
  peer?.close();
  peer = null;
  byId('offer').value = '';
  byId('answer').value = '';
  byId('copy').disabled = true;
  byId('accept').disabled = true;
  byId('peer').textContent = '';
}
function stop() {
  clearPeer();
  clearInterval(timer);
  source?.close();
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  byId('start').disabled = false;
  byId('screen-share').disabled = false;
  byId('stop').disabled = true;
  byId('invite').disabled = true;
  status.textContent = 'Эфир остановлен';
}
byId('start').addEventListener('click', () => {
  try {
    events.length = 0;
    latestAt = 0;
    online = false;
    draw();
    stream = canvas.captureStream(12);
    video.srcObject = stream;
    video.play().catch(() => {});
    timer = setInterval(draw, 100);
    source = new EventSource('/api/live');
    source.onopen = () => {
      online = true;
      status.textContent = 'В эфире · Источник подключён';
    };
    source.onerror = () => {
      online = false;
      status.textContent = 'В эфире · Переподключаем журнал';
    };
    source.onmessage = event => {
      let item;
      try { item = JSON.parse(event.data); } catch { return; }
      if (typeof item.text !== 'string' || !Number.isFinite(Date.parse(item.time))) return;
      events.unshift(item);
      if (events.length > 180) events.pop();
      latestAt = Date.now();
    };
    byId('start').disabled = true;
    byId('screen-share').disabled = true;
    byId('stop').disabled = false;
    byId('invite').disabled = false;
    status.textContent = 'В эфире · Подключаем источник';
  } catch {
    stop();
    status.textContent = 'Этот браузер не может захватывать видео панели.';
  }
});
byId('screen-share').addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    status.textContent = 'Захват окна недоступен в этом браузере.';
    return;
  }
  byId('screen-share').disabled = true;
  byId('start').disabled = true;
  try {
    const picked = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const [track] = picked.getVideoTracks();
    if (!track) {
      picked.getTracks().forEach(item => item.stop());
      stop();
      return;
    }
    stream = picked;
    track.addEventListener('ended', () => { if (stream === picked) stop(); }, { once: true });
    video.srcObject = picked;
    video.play().catch(() => {});
    byId('stop').disabled = false;
    byId('invite').disabled = false;
    status.textContent = 'В эфире · Выбранная вкладка или окно';
  } catch {
    stop();
    status.textContent = 'Захват не запущен. Выберите вкладку или окно, чтобы продолжить.';
  }
});
byId('stop').addEventListener('click', stop);
byId('invite').addEventListener('click', async () => {
  if (!stream) return;
  clearPeer();
  byId('invite').disabled = true;
  try {
    const connection = newPeer();
    peer = connection;
    connection.onconnectionstatechange = () => {
      if (peer === connection) byId('peer').textContent = connectionLabel(connection.connectionState);
    };
    for (const track of stream.getTracks()) connection.addTrack(track, stream);
    byId('peer').textContent = 'Создаём приглашение';
    const code = await localCode(connection, await connection.createOffer());
    if (peer !== connection) return;
    byId('offer').value = code;
    byId('copy').disabled = false;
    byId('accept').disabled = false;
    byId('peer').textContent = 'Приглашение готово';
  } catch (error) {
    if (stream) byId('peer').textContent = error.message;
  } finally { byId('invite').disabled = !stream; }
});
byId('copy').addEventListener('click', async () => {
  byId('peer').textContent = await copyFrom(byId('offer')) ? 'Приглашение скопировано' : 'Скопируйте выделенный код';
});
byId('accept').addEventListener('click', async () => {
  const connection = peer;
  if (!connection) return;
  byId('accept').disabled = true;
  try {
    await connection.setRemoteDescription(parseCode(byId('answer').value, 'answer'));
    if (connection === peer) byId('peer').textContent = connectionLabel(connection.connectionState);
  } catch (error) {
    if (connection === peer) {
      byId('peer').textContent = error.message;
      byId('accept').disabled = false;
    }
  }
});
window.addEventListener('pagehide', stop);
