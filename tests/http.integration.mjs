import assert from 'node:assert/strict';
import test from 'node:test';

const base = process.env.TOOLBOX_BASE_URL;
const token = process.env.TOOLBOX_API_TOKEN;
if (!base || new URL(base).hostname !== '127.0.0.1' || !token) throw new Error('Run npm run test:http against the isolated local Worker.');
const call = (path, options = {}) => fetch(`${base}${path}`, {
  redirect: 'manual', signal: AbortSignal.timeout(10000),
  ...options,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
});
const post = (path, body) => call(path, { method: 'POST', body: JSON.stringify(body) });

await test('real Worker, D1 and Static Assets contract', async (t) => {
  await t.test('static pages bypass API authentication and support navigation', async () => {
    for (const path of ['/', '/pb', '/marquee', '/surl']) {
      const result = await call(path, { headers: { Authorization: '', 'Sec-Fetch-Mode': 'navigate' } });
      assert.equal(result.status, 200, path);
      assert.match(result.headers.get('content-type'), /text\/html/);
      assert.ok(result.headers.get('content-security-policy'));
    }
    const missing = await call('/missing/path');
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('content-type'), /application\/json/);
  });

  await t.test('authentication protects reads, writes, lists and deletes', async () => {
    for (const [path, method] of [['/api/v1/pb', 'GET'], ['/api/v1/pb', 'POST'], ['/api/v1/surl', 'GET'], ['/api/v1/surl', 'POST'], ['/api/v1/surl/anycode', 'DELETE']]) {
      const response = await call(path, { method, headers: { Authorization: '' } });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal((await call('/api/v1/pb', { method: 'PUT' })).status, 405);
    assert.equal((await call('/api/v1/pb', { method: 'OPTIONS', headers: { Authorization: '' } })).status, 204);
  });

  await t.test('clipboard distinguishes missing, empty, Unicode and malformed JSON', async () => {
    assert.equal((await call('/api/v1/pb')).status, 404);
    for (const text of ['', '台灣\n<script>alert(1)</script>', 'x'.repeat(10000)]) {
      assert.equal((await post('/api/v1/pb', { text })).status, 204);
      assert.deepEqual(await (await call('/api/v1/pb')).json(), { text });
    }
    for (const body of [{}, { text: null }, { text: '台'.repeat(3334) }]) {
      assert.equal((await post('/api/v1/pb', body)).status, 400);
    }
    assert.equal((await call('/api/v1/pb', { method: 'POST', body: '{' })).status, 400);
    assert.equal((await call('/api/v1/pb', { method: 'HEAD' })).status, 200);
    assert.equal(await (await call('/api/v1/pb', { method: 'HEAD' })).text(), '');
  });

  await t.test('limits both fixed-length and chunked bodies', async () => {
    assert.equal((await post('/api/v1/pb', { text: 'x'.repeat(70000) })).status, 413);
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(70000))); controller.close(); } });
    const response = await call('/api/v1/pb', { method: 'POST', body, duplex: 'half' });
    assert.equal(response.status, 413);
  });

  await t.test('custom codes update and deletion removes redirects immediately', async () => {
    for (const url of ['https://example.com/first', 'https://example.com/second']) {
      const created = await post('/api/v1/surl', { url, shorten: 'custom' });
      assert.equal(created.status, 200);
      assert.deepEqual(await created.json(), { url, shorten: 'custom' });
      const redirect = await call('/custom', { headers: { Authorization: '', 'Sec-Fetch-Mode': 'navigate' } });
      assert.equal(redirect.status, 302);
      assert.equal(redirect.headers.get('location'), url);
      assert.equal(redirect.headers.get('cache-control'), 'no-store');
    }
    assert.equal((await call('/custom', { method: 'HEAD' })).status, 302);
    assert.equal((await call('/custom', { method: 'POST' })).status, 405);
    assert.equal((await call('/api/v1/surl/custom', { method: 'DELETE' })).status, 204);
    assert.equal((await call('/custom')).status, 404);
    assert.equal((await call('/api/v1/surl/custom', { method: 'DELETE' })).status, 404);
  });

  await t.test('rejects unsafe destinations and reserved or invalid codes', async () => {
    for (const url of ['javascript:alert(1)', '/relative', 'https://u:p@example.com/']) {
      assert.equal((await post('/api/v1/surl', { url })).status, 400);
    }
    for (const shorten of ['pb', 'PB', 'api', 'marquee', 'surl', '../x', 'a/b', 'a%2fb']) {
      assert.equal((await post('/api/v1/surl', { url: 'https://example.com/', shorten })).status, 400);
    }
  });

  await t.test('concurrent generated codes remain distinct and resolve', async () => {
    const responses = await Promise.all(Array.from({ length: 24 }, (_, i) => post('/api/v1/surl', { url: `https://example.com/${i}` })));
    for (const response of responses) assert.equal(response.status, 200);
    const links = await Promise.all(responses.map((response) => response.json()));
    assert.equal(new Set(links.map((link) => link.shorten)).size, 24);
    for (const link of links) {
      assert.match(link.shorten, /^[A-Za-z0-9_-]{8}$/);
      assert.equal((await call(`/${link.shorten}`)).headers.get('location'), link.url);
    }
  });

  await t.test('list pagination returns bounded arrays without duplicates', async () => {
    let cursor = '';
    const codes = [];
    do {
      const response = await call(`/api/v1/surl?limit=5${cursor ? `&after=${cursor}` : ''}`);
      assert.equal(response.status, 200);
      const rows = await response.json();
      assert.ok(rows.length <= 5);
      codes.push(...rows.map((row) => row.shorten));
      cursor = response.headers.get('X-Next-Cursor');
    } while (cursor);
    assert.equal(codes.length, 24);
    assert.equal(new Set(codes).size, 24);
    for (const limit of [0, 1001, 'bad']) assert.equal((await call(`/api/v1/surl?limit=${limit}`)).status, 400);
  });
});
