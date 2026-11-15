export const byId = id => document.getElementById(id);
export const newPeer = () => new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

export function parseCode(code, type) {
  if (code.length > 100000) throw new Error('Код слишком длинный.');
  let description;
  try { description = JSON.parse(atob(code.trim())); } catch { throw new Error('Проверьте код подключения.'); }
  if (description?.type !== type || typeof description.sdp !== 'string' || !description.sdp.startsWith('v=0')) {
    throw new Error('Этот код предназначен для другого шага подключения.');
  }
  return { type, sdp: description.sdp };
}

export async function localCode(peer, description) {
  await peer.setLocalDescription(description);
  if (peer.iceGatheringState !== 'complete') {
    await new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => { if (peer.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(done, 6500);
      peer.addEventListener('icegatheringstatechange', check);
      check();
    });
  }
  if (peer.signalingState === 'closed') throw new Error('Соединение закрыто.');
  return btoa(JSON.stringify(peer.localDescription.toJSON()));
}

export async function copyFrom(field) {
  try {
    await navigator.clipboard.writeText(field.value);
    return true;
  } catch {
    field.focus();
    field.select();
    return false;
  }
}
export function connectionLabel(state) {
  return {
    new: 'Ожидание подключения',
    connecting: 'Устанавливаем соединение',
    connected: 'Зритель подключён',
    disconnected: 'Соединение временно прервано',
    failed: 'Не удалось установить прямое соединение. Попробуйте из одной сети.',
    closed: 'Соединение закрыто'
  }[state] || 'Ожидание подключения';
}
