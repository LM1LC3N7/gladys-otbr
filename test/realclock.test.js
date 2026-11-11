// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, setTimeout) and a real
// local HTTP server playing the border router: the readings really start at
// 0, the interval and twice the interval, with a bounded number of timers.
// The time is sped up 100 times (the 1 min of the interval is 600 ms) but it
// is the real clock: it moves between any two reads of it. The pace is
// measured where it is decided (a spy on readOnce), never on the connections
// the server sees. Everything is closed in t.after: a failure never leaves
// the process alive.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { OtbrApp } from '../src/app.js';
import { memoryStore } from '../src/store.js';
import { BA_ID, createFakeOtbr } from './helpers/fakeServer.js';

const SPEED = 100;
const INTERVAL = 60_000;

test('real clock: readings at 0, the interval and twice the interval; timers bounded', async (t) => {
  const otbr = createFakeOtbr({ timers: { setTimeout, clearTimeout } });
  let served = 0;
  const srv = http.createServer((req, res) => {
    if (req.url === '/node') served += 1;
    const answer = otbr.handle(req.method, req.url, '');
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(answer.body === undefined ? '' : JSON.stringify(answer.body));
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections();
    srv.close();
  });
  let created = 0;
  const live = new Set();
  const timers = {
    setTimeout(fn, ms) {
      created += 1;
      const handle = setTimeout(() => {
        live.delete(handle);
        fn();
      }, ms / SPEED);
      live.add(handle);
      return handle;
    },
    clearTimeout(handle) {
      live.delete(handle);
      clearTimeout(handle);
    },
  };
  const start = performance.now();
  const config = { host: `127.0.0.1:${srv.address().port}`, poll_interval: '1' };
  const gladys = createFakeGladys({ selector: 'otbr', config });
  await gladys.connect();
  t.after(() => gladys.disconnect());
  const app = new OtbrApp({
    gladys,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    now: () => Date.parse('2026-11-11T08:00:00Z') + (performance.now() - start) * SPEED,
    monotonic: () => performance.now() * SPEED,
    timers,
    store: memoryStore(),
  });
  t.after(() => app.stop());
  const reads = [];
  const original = app.readOnce.bind(app);
  app.readOnce = () => {
    reads.push(performance.now() * SPEED);
    return original();
  };
  await app.start(config);
  const deadline = performance.now() + 5_000;
  while ((reads.length < 3 || served < 3) && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(reads.length >= 3, true, `3 readings within 5 s, got ${reads.length}`);
  for (let i = 1; i < 3; i += 1) {
    const gap = reads[i] - reads[i - 1];
    assert.ok(gap >= 0.9 * INTERVAL && gap <= 1.5 * INTERVAL, `gap ${i}: ${Math.round(gap)} ms`);
  }
  assert.ok(served >= 3, `served ${served}`);
  assert.ok(gladys.fake.discoveredDevices[0].external_id.endsWith(BA_ID));
  await app.stop();
  assert.equal(live.size, 0, 'no timer after stop()');
  assert.ok(created < 40, `timers created: ${created}`);
});
