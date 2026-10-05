import { strict as httpAssert } from 'node:assert';
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
const origin = 'https://magic-box.example';

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
    if ((server.exitCode !== null || server.signalCode !== null)) throw new Error(`Worker exited: ${log}`);
    try {
      if ((await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) })).status === 200) return;
    } catch { /* Server not ready. */ }
    await delay(300);
  }
  throw new Error(`Worker did not start: ${log}`);
}

async function stop() {
  if (!server || (server.exitCode !== null || server.signalCode !== null)) return;
  server.kill('SIGTERM');
  for (let attempt = 0; attempt < 50 && server.exitCode === null && server.signalCode === null; attempt++) await delay(100);
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
}

async function checkPublicApi() {
  const call = (path, method = 'GET', body) => fetch(`${base}${path}`, {
    method, redirect: 'manual', signal: AbortSignal.timeout(5000),
    headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const [path, method] of [['/api/v1/pb', 'POST'], ['/api/v1/surl', 'POST'], ['/api/v1/surl/publicmode', 'DELETE']]) {
    const preflight = await fetch(`${base}${path}`, {
      method: 'OPTIONS', signal: AbortSignal.timeout(5000),
      headers: { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'content-type' },
    });
    httpAssert.equal(preflight.status, 204);
    httpAssert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    httpAssert.ok(preflight.headers.get('access-control-allow-methods').split(/,\s*/).includes(method));
    httpAssert.match(preflight.headers.get('access-control-allow-headers'), /content-type/i);
  }
  httpAssert.equal((await call('/api/v1/pb', 'POST', { text: 'public clipboard' })).status, 204);
  const clipboard = await call('/api/v1/pb');
  httpAssert.equal(clipboard.status, 200);
  httpAssert.equal(clipboard.headers.get('access-control-allow-origin'), '*');
  httpAssert.deepEqual(await clipboard.json(), { text: 'public clipboard' });
  httpAssert.equal((await call('/api/v1/pb', 'HEAD')).status, 200);
  for (const url of ['https://example.com/public-first', 'https://example.com/public-second']) {
    const saved = await call('/api/v1/surl', 'POST', { url, shorten: 'publicmode' });
    httpAssert.equal(saved.status, 200);
    httpAssert.deepEqual(await saved.json(), { url, shorten: 'publicmode' });
    const redirect = await call('/publicmode');
    httpAssert.equal(redirect.status, 302);
    httpAssert.equal(redirect.headers.get('location'), url);
  }
  const listed = await call('/api/v1/surl?limit=1');
  httpAssert.equal(listed.status, 200);
  httpAssert.equal(listed.headers.get('access-control-expose-headers'), 'X-Next-Cursor');
  httpAssert.equal((await listed.json()).length, 1);
  httpAssert.equal((await call('/api/v1/surl/publicmode', 'DELETE')).status, 204);
  httpAssert.equal((await call('/publicmode')).status, 404);
  const invalid = await call('/api/v1/pb', 'POST', {});
  httpAssert.equal(invalid.status, 400);
  httpAssert.equal(invalid.headers.get('access-control-allow-origin'), '*');
  await invalid.text();
}

try {
  const migration = spawnSync(process.execPath, [cli, 'd1', 'migrations', 'apply', 'DB', '--local', ...shared], {
    cwd: root, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (migration.error || migration.status !== 0) throw new Error(migration.error?.message || migration.stdout + migration.stderr);
  await start();
  const unauthorised = await fetch(`${base}/api/v1/pb`, {
    signal: AbortSignal.timeout(5000), headers: { Origin: origin, Authorization: 'Bearer incorrect' },
  });
  httpAssert.equal(unauthorised.status, 401);
  httpAssert.equal(unauthorised.headers.get('access-control-allow-origin'), '*');
  await unauthorised.text();
  // Keep the parent event loop running so workerd error logs are drained during tests.
  const status = await new Promise((resolveTest, rejectTest) => {
    const tests = spawn(process.execPath, ['--test', 'tests/http.integration.mjs'], {
      stdio: 'inherit', timeout: 90_000,
      env: { ...process.env, TOOLBOX_BASE_URL: base, TOOLBOX_API_TOKEN: token },
    });
    tests.on('error', rejectTest);
    tests.on('close', (code) => resolveTest(code));
  });
  if (status !== 0) throw new Error(`HTTP tests failed.\n${log}`);
  await stop();
  // Both missing and explicitly empty tokens select the public API mode.
  for (const vars of [{}, { API_TOKEN: '' }]) {
    config.vars = vars;
    writeFileSync(configFile, JSON.stringify(config));
    await start();
    await checkPublicApi();
    console.log(`Public API and CORS tests passed (${Object.hasOwn(vars, 'API_TOKEN') ? 'empty' : 'missing'} API_TOKEN).`);
    await stop();
  }
} finally {
  await stop();
  rmSync(temporary, { recursive: true, force: true });
}
