import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const folder = join(import.meta.dirname, 'telemetry');
mkdirSync(folder, { recursive: true });
const now = Date.now();
const events = Array.from({ length: 6 }, (_, index) => ({
  time: new Date(now - (5 - index) * 1000).toISOString(),
  type: 'auth_failed',
  source: 'test-gateway',
  eventId: randomUUID()
}));
appendFileSync(join(folder, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
console.log('6 sample events → telemetry/events.jsonl');
