export function createLiveFeed() {
  const clients = new Set();
  const history = [];
  const prefix = Date.now() + '-';
  let serial = 0;
  function write(res, item) {
    res.write('id: ' + item.id + '\ndata: ' + JSON.stringify(item) + '\n\n');
  }
  function publish(kind, text, agent = '') {
    const item = { id: prefix + ++serial, time: new Date().toISOString(), kind, text, agent };
    history.push(item);
    if (history.length > 180) history.shift();
    for (const res of clients) {
      if (res.writableLength > 128 * 1024) res.destroy();
      else write(res, item);
    }
  }
  function publishState(revision) {
    for (const res of clients) {
      if (res.writableLength > 128 * 1024) res.destroy();
      else res.write('event: state\ndata: ' + revision + '\n\n');
    }
  }
  function subscribe(req, res) {
    if (clients.size >= 12) {
      res.writeHead(503);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 2500\n\n');
    const last = req.headers['last-event-id'];
    const after = last?.startsWith(prefix) ? Number(last.slice(prefix.length)) : 0;
    for (const item of history) if (Number(item.id.slice(prefix.length)) > after) write(res, item);
    clients.add(res);
    res.on('close', () => clients.delete(res));
  }
  setInterval(() => {
    for (const res of clients) {
      if (res.writableLength > 128 * 1024) res.destroy();
      else res.write(': heartbeat\n\n');
    }
  }, 12000).unref();
  return { publish, publishState, subscribe };
}
