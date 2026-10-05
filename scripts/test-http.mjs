import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const temporary = mkdtempSync(join(tmpdir(), 'toolbox-http-'));
const config = JSON.parse(readFileSync('wrangler.json', 'utf8'));
const token = randomBytes(24).toString('hex');
config.main = resolve(config.main);
config.assets.directory = resolve(config.assets.directory);
config.d1_databases[0].migrations_dir = resolve(config.d1_databases[0].migrations_dir);
config.vars = { API_TOKEN: token };
delete config.build;
delete config.$schema;
const configFile = join(temporary, 'wrangler.json');
writeFileSync(configFile, JSON.stringify(config));
const cli = resolve('node_modules/wrangler/bin/wrangler.js');
const state = join(temporary, 'state');
const shared = ['--config', configFile, '--persist-to', state];
let server;
let log = '';
const base = 'http://127.0.0.1:18787';

async function start() {
  server = spawn(process.execPath, [cli, 'dev', '--local', '--ip', '127.0.0.1', '--port', '18787', ...shared], {
    cwd: root,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (data) => { log += data; });
  server.stderr.on('data', (data) => { log += data; });
  server.on('error', (error) => { log += error.message; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Worker exited: ${log}`);
    try {
      if ((await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) })).status === 200) return;
    } catch { /* Server not ready. */ }
    await delay(300);
  }
  throw new Error(`Worker did not start: ${log}`);
}

async function stop() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  for (let attempt = 0; attempt < 50 && server.exitCode === null; attempt++) await delay(100);
  if (server.exitCode === null) server.kill('SIGKILL');
}

try {
  const migration = spawnSync(process.execPath, [cli, 'd1', 'migrations', 'apply', 'DB', '--local', ...shared], {
    cwd: root, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (migration.error || migration.status !== 0) throw new Error(migration.error?.message || migration.stdout + migration.stderr);
  await start();
  const tests = spawnSync(process.execPath, ['--test', 'tests/http.integration.mjs'], {
    stdio: 'inherit', timeout: 90_000,
    env: { ...process.env, TOOLBOX_BASE_URL: base, TOOLBOX_API_TOKEN: token },
  });
  if (tests.error || tests.status !== 0) throw new Error(`HTTP tests failed. ${tests.error?.message || ''}\n${log}`);
  await stop();
  // Exercise fail-closed behaviour with no configured secret, not just a bad token.
  config.vars = {};
  writeFileSync(configFile, JSON.stringify(config));
  await start();
  const missingSecret = await fetch(`${base}/api/v1/pb`, { signal: AbortSignal.timeout(5000) });
  if (missingSecret.status !== 503) throw new Error(`Expected 503 without API_TOKEN, got ${missingSecret.status}`);
  console.log('Missing-secret fail-closed test passed.');
} finally {
  await stop();
  rmSync(temporary, { recursive: true, force: true });
}
