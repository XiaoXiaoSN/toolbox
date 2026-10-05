import assert from 'node:assert/strict';
import test from 'node:test';
import { createSaveQueue } from '../public/assets/save-queue.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('does not write an untouched or freshly loaded clipboard', async () => {
  let writes = 0;
  const queue = createSaveQueue('existing', async () => { writes++; });
  await queue.flush();
  assert.equal(writes, 0);
  assert.equal(queue.dirty(), false);
});

test('serialises writes and coalesces intermediate edits', async () => {
  const gate = deferred();
  const writes = [];
  const queue = createSaveQueue('', async (value) => {
    writes.push(value);
    if (writes.length === 1) await gate.promise;
  });
  queue.set('first');
  const running = queue.flush();
  queue.set('second');
  queue.set('latest');
  assert.equal(queue.flush(), running);
  assert.deepEqual(writes, ['first']);
  gate.resolve();
  await running;
  assert.deepEqual(writes, ['first', 'latest']);
  assert.equal(queue.dirty(), false);
});

test('a failed save remains dirty and can be retried', async () => {
  let attempts = 0;
  const queue = createSaveQueue('', async () => {
    if (++attempts === 1) throw new Error('offline');
  });
  queue.set('retain this');
  await assert.rejects(queue.flush(), /offline/);
  assert.equal(queue.dirty(), true);
  assert.equal(queue.busy(), false);
  await queue.flush();
  assert.equal(queue.dirty(), false);
});

test('can clear previously non-empty content', async () => {
  const writes = [];
  const queue = createSaveQueue('old', async (value) => { writes.push(value); });
  queue.set('');
  await queue.flush();
  assert.deepEqual(writes, ['']);
});
