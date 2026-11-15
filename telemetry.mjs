import { existsSync } from 'node:fs';

import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';

const MAX_CHUNK = 256 * 1024;

export function readTelemetry(path, cursor, sanitize) {
  if (!existsSync(path)) return null;
  if (!lstatSync(path).isFile()) throw new Error('Ожидается обычный файл.');
  const fd = openSync(path, 'r');
  try {
    const file = fstatSync(fd);
    const identity = file.dev + ':' + file.ino + ':' + file.birthtimeMs;
    const same = cursor.identity === identity && file.size >= cursor.offset;
    const offset = same ? cursor.offset : 0;
    const dropping = same && cursor.dropping;
    if (file.size <= offset) return null;
    const buffer = Buffer.alloc(Math.min(file.size - offset, MAX_CHUNK));
    const count = readSync(fd, buffer, 0, buffer.length, offset);
    if (!count) return null;

    let end = 0;
    let start = 0;
    let rejected = 0;
    const events = [];
    for (let i = 0; i < count && events.length < 500; i++) {
      if (buffer[i] !== 10) continue;
      end = i + 1;
      const line = buffer.toString('utf8', start, i).trim();
      if (line && !(dropping && start === 0)) {
        try {
          events.push(sanitize(JSON.parse(line)));
        } catch {
          rejected++;
        }
      }
      start = end;
    }
    if (!end && count === MAX_CHUNK) {
      return { events, rejected: dropping ? 0 : 1, cursor: { identity, offset: offset + count, dropping: true } };
    }
    if (!end) return null;
    return { events, rejected, cursor: { identity, offset: offset + end, dropping: false } };
  } finally {
    closeSync(fd);
  }
}
