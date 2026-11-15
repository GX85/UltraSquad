import { byId, connectionLabel, copyFrom, localCode, newPeer, parseCode } from './rtc.js';
const status = byId('status');
const video = byId('video');
let peer;
byId('join').addEventListener('click', async () => {
  byId('join').disabled = true;
  try {
    const offer = parseCode(byId('offer').value, 'offer');
    peer?.close();
    byId('answer').value = '';
    byId('copy').disabled = true;
    video.srcObject = null;
    const connection = newPeer();
    peer = connection;
    connection.onconnectionstatechange = () => {
      if (connection === peer) status.textContent = connection.connectionState === 'connected'
        ? 'Соединение установлено' : connectionLabel(connection.connectionState);
    };
    connection.ontrack = event => {
      if (connection !== peer) return;
      video.srcObject = event.streams[0] || new MediaStream([event.track]);
      video.play().catch(() => {});
    };
    status.textContent = 'Готовим код ответа';
    await connection.setRemoteDescription(offer);
    byId('answer').value = await localCode(connection, await connection.createAnswer());
    status.textContent = 'Передайте код ответа оператору';
    byId('copy').disabled = false;
  } catch (error) {
    status.textContent = error.message;
  } finally { byId('join').disabled = false; }
});
byId('copy').addEventListener('click', async () => {
  status.textContent = await copyFrom(byId('answer')) ? 'Код ответа скопирован' : 'Скопируйте выделенный код';
});
window.addEventListener('pagehide', () => peer?.close());
