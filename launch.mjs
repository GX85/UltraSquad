import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = import.meta.dirname;
const data = join(root, 'data');
const lock = join(data, 'launch.lock');
const port = Number(process.env.ULTRASQUAD_PORT || 4177);
const origin = 'http://127.0.0.1:' + port;
const openBrowser = process.argv.slice(2).includes('--open');

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('ULTRASQUAD_PORT must be between 1024 and 65535.');
}
mkdirSync(data, { recursive: true });

async function health() {
  try {
    const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(800) });
    if (!response.ok) return 'occupied';
    const result = await response.json();
    return result.app === 'UltraSquad' && result.ok === true ? 'ready' : 'occupied';
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return 'offline';
    return 'occupied';
  }
}

function ownerAlive() {
  try {
    const owner = JSON.parse(readFileSync(lock, 'utf8'));
    if (!Number.isInteger(owner.pid) || owner.pid < 1) return false;
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'EPERM') return true;
    if (error.code === 'ESRCH' || error.code === 'ENOENT') return false;
    try {
      return Date.now() - statSync(lock).mtimeMs < 10000;
    } catch {
      return false;
    }
  }
}

async function acquireLock() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const file = openSync(lock, 'wx');
      try {
        writeFileSync(file, JSON.stringify({ pid: process.pid }));
      } finally {
        closeSync(file);
      }
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!ownerAlive()) {
        try { unlinkSync(lock); } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      } else {
        await delay(150);
      }
    }
  }
  throw new Error('Another UltraSquad launch is still in progress.');
}

function releaseLock() {
  try {
    const owner = JSON.parse(readFileSync(lock, 'utf8'));
    if (owner.pid === process.pid) unlinkSync(lock);
  } catch {}
}

async function boot() {
  const status = await health();
  if (status === 'ready') return;
  if (status === 'occupied') throw new Error('Port ' + port + ' is occupied by another service or an unresponsive server.');

  const output = openSync(join(data, 'server.log'), 'a');
  const errors = openSync(join(data, 'server-error.log'), 'a');
  let child;
  try {
    child = spawn(process.execPath, [join(root, 'server.mjs')], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', output, errors]
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
  } finally {
    closeSync(output);
    closeSync(errors);
  }

  for (let attempt = 0; attempt < 40; attempt++) {
    if (await health() === 'ready') {
      writeFileSync(join(data, 'server.pid'), String(child.pid));
      return;
    }
    await delay(200);
  }
  throw new Error('Server did not become ready. See data/server-error.log.');
}

function openPanel() {
  const child = spawn('explorer.exe', [origin], { detached: true, windowsHide: true, stdio: 'ignore' });
  child.on('error', error => {
    console.error('Could not open the browser:', error.message);
  });
  child.unref();
}

let locked = false;
try {
  await acquireLock();
  locked = true;
  await boot();
  if (openBrowser) openPanel();
  console.log('UltraSquad ready at ' + origin);
} catch (error) {
  console.error(error.message);
  writeFileSync(join(data, 'launcher-error.log'), new Date().toISOString() + '\n' + error.message + '\n');
  process.exitCode = 1;
} finally {
  if (locked) releaseLock();
}
