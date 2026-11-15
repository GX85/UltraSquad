import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const channels = [
  { name: 'System', label: 'System', type: 'windows_error', filter: '(Level=1 or Level=2)' },
  { name: 'Application', label: 'Application', type: 'windows_error', filter: '(Level=1 or Level=2)' },
  { name: 'Microsoft-Windows-Windows Defender/Operational', label: 'Defender', type: 'defender_detection', filter: '(EventID=1116 or EventID=1006)' }
];

async function readChannel(channel, cursor) {
  const position = Number.isSafeInteger(cursor) && cursor > 0
    ? 'EventRecordID>' + cursor
    : 'TimeCreated[timediff(@SystemTime) <= 86400000]';
  const binary = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wevtutil.exe');
  const { stdout } = await run(binary, ['qe', channel.name, '/q:*[System[' + channel.filter + ' and ' + position + ']]',
    '/f:xml', '/uni:true', '/rd:false', '/c:100'],
  { encoding: 'buffer', windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 9000 });
  const xml = stdout.includes(0) ? stdout.toString('utf16le') : stdout.toString('utf8');
  const events = [];
  let latest = cursor || 0;
  for (const record of xml.matchAll(/<System>([\s\S]*?)<\/System>/g)) {
    const system = record[1];
    const eventId = system.match(/<EventID(?: [^>]*)?>(\d+)<\/EventID>/)?.[1];
    const recordId = Number(system.match(/<EventRecordID>(\d+)<\/EventRecordID>/)?.[1]);
    const time = system.match(/\bSystemTime=['"]([^'"]+)['"]/)?.[1];
    if (!eventId || !Number.isSafeInteger(recordId) || !Number.isFinite(Date.parse(time))) continue;
    events.push({
      time,
      type: channel.type,
      source: 'Windows.' + channel.label + '.' + eventId,
      eventId: 'windows.' + channel.label + '.' + recordId
    });
    latest = Math.max(latest, recordId);
  }
  return { label: channel.label, latest, events };
}

export async function readWindows(cursor = {}) {
  const results = await Promise.allSettled(channels.map(channel => readChannel(channel, cursor[channel.label])));
  const next = { ...cursor };
  const events = [];
  const available = [];
  const failed = [];
  for (const [index, result] of results.entries()) {
    const label = channels[index].label;
    if (result.status === 'rejected') {
      failed.push(label);
      continue;
    }
    available.push(label);
    next[label] = result.value.latest;
    events.push(...result.value.events);
  }
  return { events, cursor: next, available, failed };
}
