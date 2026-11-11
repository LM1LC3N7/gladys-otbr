// -----------------------------------------------------------------------------
// /data: a missing file is a first start; anything else unreadable is not;
// a FIFO never holds a read nor a write; the state read back is bounded.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStore, normalizeMemory, serializeMemory } from '../src/store.js';

async function dir(t) {
  const d = await mkdtemp(join(tmpdir(), 'otbr-store-'));
  t.after(() => rm(d, { recursive: true, force: true }));
  return d;
}

test('missing: null; saved: read back, 0600', async (t) => {
  const d = await dir(t);
  const store = fileStore(join(d, 'state.json'));
  assert.equal(await store.load(), null);
  await store.save({ lastAttemptAt: 1 });
  assert.deepEqual(await store.load(), { lastAttemptAt: 1 });
  assert.equal((await stat(join(d, 'state.json'))).mode & 0o777, 0o600);
});

test('not JSON, too large, not an object: unreadable (never a first start)', async (t) => {
  const d = await dir(t);
  const path = join(d, 'state.json');
  const store = fileStore(path);
  await writeFile(path, '{');
  await assert.rejects(store.load(), { code: 'EINVAL' });
  await writeFile(path, ' '.repeat(20_000));
  await assert.rejects(store.load(), { code: 'EFBIG' });
  await writeFile(path, '[]');
  await assert.rejects(store.load(), { code: 'EINVAL' });
});

test('a FIFO in place of the file or of its temporary: refused at once, never waited for', async (t) => {
  const d = await dir(t);
  const path = join(d, 'state.json');
  execFileSync('mkfifo', [path]);
  const store = fileStore(path);
  const started = performance.now();
  await assert.rejects(store.load(), { code: 'EINVAL', message: /regular file/ });
  assert.ok(performance.now() - started < 1000);
  await rm(path);
  execFileSync('mkfifo', [`${path}.tmp`]);
  await store.save({ lastAttemptAt: 2 });
  assert.equal(JSON.parse(await readFile(path, 'utf8')).lastAttemptAt, 2);
});

test('normalized: unknown keys dropped, times capped, no prototype pollution', () => {
  const now = Date.parse('2026-11-11T08:00:00Z');
  const m = normalizeMemory(
    JSON.parse(
      '{"__proto__":{"x":1},"networkKey":"00112233","pause":{"key":"http://a:8081","until":9e15,"status":503},"lastAction":{"key":"http://a:8081","kind":"disable","outcome":"confirmed","at":1},"lastAttemptAt":9e15,"attemptKey":"http://a:8081"}',
    ),
    now,
  );
  assert.deepEqual(Object.keys(m).sort(), ['attemptKey', 'lastAction', 'lastAttemptAt', 'pause']);
  assert.equal(m.pause.until, now + 6 * 3600_000, 'capped at 6 h');
  assert.equal(m.lastAttemptAt, now, 'a future time is now');
  assert.equal(m.attemptKey, 'http://a:8081');
  assert.equal(m.lastAction.outcome, 'confirmed');
  assert.equal({}.x, undefined);
  assert.equal(JSON.stringify(m).includes('00112233'), false, 'never a key it does not know');
});

test('normalized: wrong shapes are dropped, never guessed', () => {
  const now = Date.parse('2026-11-11T08:00:00Z');
  const m = normalizeMemory(
    {
      pause: { key: 'k', until: now - 1, status: 503 },
      lastAction: { key: 'k', kind: 'reboot', outcome: 'confirmed', at: 1 },
      lastAttemptAt: 'yesterday',
      attemptKey: 'bad key\n',
    },
    now,
  );
  assert.equal(m.pause, null, 'over');
  assert.equal(m.lastAction, null, 'unknown kind');
  assert.equal(m.lastAttemptAt, 0);
  assert.equal(m.attemptKey, null);
  const future = normalizeMemory(
    { lastAction: { key: 'k', kind: 'enable', outcome: 'no_answer', at: now + 1 } },
    now,
  );
  assert.equal(future.lastAction, null, 'a date in the future is invalid');
  assert.deepEqual(normalizeMemory(null, now), {
    pause: null,
    lastAction: null,
    lastAttemptAt: 0,
    attemptKey: null,
  });
});

test('serialized: only what is kept', () => {
  const m = normalizeMemory({ lastAttemptAt: 5, attemptKey: 'http://a:8081' }, 10);
  assert.deepEqual(serializeMemory(m), {
    pause: null,
    lastAction: null,
    lastAttemptAt: 5,
    attemptKey: 'http://a:8081',
  });
});
