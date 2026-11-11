// -----------------------------------------------------------------------------
// The integration end to end: the fake Gladys of the SDK, the fake border
// router, the virtual clock, the wiring of the container.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES as F } from '../src/constants.js';
import { CODES, OtbrError } from '../src/otbr/errors.js';
import { memoryStore } from '../src/store.js';
import {
  HOST,
  HOUR,
  KEY,
  MINUTE,
  POLL,
  SECOND,
  SECRETS,
  T0,
  badge,
  device,
  deviceId,
  everything,
  settle,
  setup,
  state,
  status,
} from './helpers/app.js';
import { BA_ID, OTHER_BA_ID, createFakeOtbr } from './helpers/fakeServer.js';

const ALLOW = { allow_thread_control: true };
const reads = (otbr) => otbr.count('GET', '/node');
const puts = (otbr) => otbr.count('PUT', '/node/state');
const noSecret = (ctx) => {
  const all = everything(ctx);
  for (const secret of SECRETS) assert.ok(!all.includes(secret), 'a secret leaked');
};

test('the first reading: the device discovered, the status connected, every value published', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const { gladys, otbr } = ctx;
  assert.equal(reads(otbr), 1);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(gladys.fake.discoveredDevices[0].external_id, deviceId());
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.en, /leader, 3 Thread router/);
  assert.equal(state(gladys, F.ROLE), 'leader');
  assert.equal(state(gladys, F.ATTACHED), 1);
  assert.equal(state(gladys, F.ROUTERS), 3);
  assert.equal(state(gladys, F.NETWORK_NAME), 'GladysNet');
  assert.equal(state(gladys, F.CHANNEL), 15);
  assert.equal(state(gladys, F.PAN_ID), '0x34ad');
  assert.equal(state(gladys, F.EXT_PAN_ID), 'a5988faff7b57610');
  assert.equal(state(gladys, F.DATASET), 1);
  assert.equal(state(gladys, F.LAST_ACTION), undefined, 'no action yet');
  assert.equal(badge(gladys).transport, 'local');
  noSecret(ctx);
});

test('the network key and the PSKc never reach a log, /data, a status, a state nor Discovery', async (t) => {
  const store = memoryStore();
  const ctx = await setup({ store, config: ALLOW });
  t.after(() => ctx.app.stop());
  // A failing dataset route, debug logs, a full action, a restart: still nothing.
  ctx.otbr.routes['GET /node/dataset/active'] = () => ({
    status: 200,
    body: '{"networkKey":"' + SECRETS[0] + '", broken',
    raw: true,
  });
  await ctx.wait(POLL);
  delete ctx.otbr.routes['GET /node/dataset/active'];
  await ctx.act('disable_thread');
  await ctx.act('disable_thread');
  await ctx.wait(POLL);
  await ctx.app.stop();
  noSecret(ctx);
  assert.ok(store.saves > 0);
});

test('an old ot-br-posix (PascalCase keys, numeric role) is read the same', async (t) => {
  const otbr = createFakeOtbr({ timers: null, pascal: true });
  const ctx = await setup({ pascal: true });
  t.after(() => ctx.app.stop());
  assert.equal(otbr.pascal, true);
  ctx.otbr.numericRole = true;
  await ctx.wait(POLL);
  const { gladys } = ctx;
  assert.equal(state(gladys, F.ROLE), 'leader');
  assert.equal(state(gladys, F.ROUTERS), 3);
  assert.equal(state(gladys, F.CHANNEL), 15);
  assert.equal(state(gladys, F.PAN_ID), '0x34ad');
  noSecret(ctx);
});

test('Thread disabled: network down, the name and ext PAN ID of the dataset (not the leftovers of /node)', async (t) => {
  const ctx = await setup({ connect: false });
  t.after(() => ctx.app.stop());
  Object.assign(ctx.otbr, { role: 'disabled', routers: 0, networkName: 'OpenThread' });
  await ctx.gladys.connect();
  await ctx.wait(0);
  const { gladys } = ctx;
  assert.equal(state(gladys, F.ROLE), 'disabled');
  assert.equal(state(gladys, F.ATTACHED), 0);
  assert.equal(state(gladys, F.ROUTERS), undefined, 'a leftover of /node, not a count');
  assert.equal(state(gladys, F.NETWORK_NAME), 'GladysNet');
  assert.match(status(gladys).message.en, /Thread is disabled/);
});

test('no active dataset (204): "dataset" 0, channel and PAN ID unknown, never 0', async (t) => {
  const ctx = await setup({ connect: false });
  t.after(() => ctx.app.stop());
  Object.assign(ctx.otbr, { role: 'disabled', dataset: null });
  await ctx.gladys.connect();
  await ctx.wait(0);
  const { gladys } = ctx;
  assert.equal(state(gladys, F.DATASET), 0);
  assert.equal(state(gladys, F.CHANNEL), undefined);
  assert.equal(state(gladys, F.PAN_ID), undefined);
  assert.equal(
    state(gladys, F.NETWORK_NAME),
    undefined,
    'the default "OpenThread" is not a network',
  );
});

test('a dataset route failing never stops the reading nor pauses it', async (t) => {
  const ctx = await setup({ connect: false });
  t.after(() => ctx.app.stop());
  ctx.otbr.routes['GET /node/dataset/active'] = () => ({ status: 503 });
  await ctx.gladys.connect();
  await ctx.wait(0);
  const { gladys, otbr } = ctx;
  assert.equal(status(gladys).connected, true);
  assert.equal(state(gladys, F.ROLE), 'leader');
  assert.equal(state(gladys, F.CHANNEL), undefined);
  assert.equal(state(gladys, F.DATASET), undefined, 'unknown, not "none"');
  await ctx.wait(POLL);
  assert.equal(reads(otbr), 2, 'no pause from a secondary route');
});

test('never sooner than the interval: test button, same config saved, reconnection, scan', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const { gladys, otbr } = ctx;
  assert.equal(reads(otbr), 1);
  const message = await ctx.act('test_connection');
  assert.match(message.en, /Next reading in 5 min/);
  await gladys.fake.configUpdated({ host: HOST });
  await ctx.wait(0);
  await gladys.disconnect();
  await gladys.connect();
  await ctx.wait(0);
  await gladys.fake.scanRequest();
  await ctx.wait(0);
  assert.equal(reads(otbr), 1);
  assert.equal(gladys.fake.discoveredDevices[0].external_id, deviceId(), 'Discovery sent again');
  assert.equal(status(gladys).connected, true, 'status sent again');
  await ctx.wait(POLL - 2 * SECOND);
  assert.equal(reads(otbr), 1);
  await ctx.wait(3 * SECOND);
  assert.equal(reads(otbr), 2);
  // Due: the test button reads.
  await ctx.wait(POLL);
  assert.equal(reads(otbr), 3);
});

test('the test button reads when a reading is due', async (t) => {
  const ctx = await setup({ connect: false });
  t.after(() => ctx.app.stop());
  ctx.otbr.routes['GET /node'] = () => {
    throw new OtbrError(CODES.UNREACHABLE, 'ECONNREFUSED', { notSent: true });
  };
  await ctx.gladys.connect();
  await ctx.wait(0);
  assert.equal(status(ctx.gladys).connected, false);
  delete ctx.otbr.routes['GET /node'];
  ctx.app.lastReadAt -= POLL;
  const message = await ctx.act('test_connection');
  assert.match(message.en, /^Connected/);
  assert.equal(reads(ctx.otbr), 2);
});

test('a restart never reads sooner than the interval (attempt kept in /data before the reading)', async (t) => {
  const store = memoryStore();
  const first = await setup({ store });
  await first.app.stop();
  assert.equal(store.data.lastAttemptAt, T0);
  const second = await setup({ store, now: T0 + 2 * MINUTE });
  t.after(() => second.app.stop());
  assert.equal(reads(second.otbr), 0);
  await second.wait(3 * MINUTE - SECOND);
  assert.equal(reads(second.otbr), 0);
  await second.wait(2 * SECOND);
  assert.equal(reads(second.otbr), 1);
});

test('a date of /data in the future counts as now, never later', async (t) => {
  const store = memoryStore({ lastAttemptAt: T0 + 10 * HOUR, attemptKey: KEY });
  const ctx = await setup({ store });
  t.after(() => ctx.app.stop());
  assert.equal(reads(ctx.otbr), 0);
  await ctx.wait(POLL + SECOND);
  assert.equal(reads(ctx.otbr), 1);
});

test('a 503 with Retry-After pauses every request, kept in /data across a restart; actions refused', async (t) => {
  const store = memoryStore();
  const ctx = await setup({ store, config: ALLOW, connect: false });
  ctx.otbr.routes['GET /node'] = () => ({ status: 503, headers: { 'retry-after': '1800' } });
  await ctx.gladys.connect();
  await ctx.wait(0);
  assert.equal(status(ctx.gladys).connected, false);
  assert.match(status(ctx.gladys).message.en, /asked to wait \(HTTP 503\); next reading in 30 min/);
  assert.deepEqual(store.data.pause, { key: KEY, until: T0 + 30 * MINUTE, status: 503 });
  const refused = await ctx.act('disable_thread');
  assert.match(refused.en, /^Refused: the border router asked to wait.*Nothing sent/);
  assert.equal(puts(ctx.otbr), 0);
  assert.equal(reads(ctx.otbr), 1, 'the refusal read nothing');
  await ctx.app.stop();
  // A restart 10 minutes later keeps the pause.
  const again = await setup({ store, now: T0 + 10 * MINUTE });
  t.after(() => again.app.stop());
  await again.wait(20 * MINUTE - SECOND);
  assert.equal(reads(again.otbr), 0);
  await again.wait(2 * SECOND);
  assert.equal(reads(again.otbr), 1);
  assert.equal(store.data.pause, null, 'lifted by a reading that worked');
});

test('a 503 without Retry-After pauses 60 s at least, never less than the interval', async (t) => {
  const ctx = await setup({ connect: false, config: { poll_interval: '1' } });
  t.after(() => ctx.app.stop());
  let n = 0;
  ctx.otbr.routes['GET /node'] = () => ({ status: n++ < 1 ? 500 : 200, body: ctx.otbr.nodeBody() });
  await ctx.gladys.connect();
  await ctx.wait(0);
  await ctx.wait(59 * SECOND);
  assert.equal(reads(ctx.otbr), 1);
  await ctx.wait(2 * SECOND);
  assert.equal(reads(ctx.otbr), 2);
  assert.equal(status(ctx.gladys).connected, true);
});

test('a 403 or 404 on /node is a failure said as such (no login here), the next try at the interval', async (t) => {
  const ctx = await setup({ connect: false });
  t.after(() => ctx.app.stop());
  ctx.otbr.routes['GET /node'] = () => ({ status: 403 });
  await ctx.gladys.connect();
  await ctx.wait(0);
  assert.match(status(ctx.gladys).message.en, /HTTP error 403\); next try in 5 min/);
  // A reconnection says the failure again (not "connecting"), without reading sooner.
  await ctx.gladys.disconnect();
  await ctx.gladys.connect();
  await ctx.wait(0);
  assert.match(status(ctx.gladys).message.en, /HTTP error 403/);
  assert.equal(reads(ctx.otbr), 1);
  await ctx.wait(POLL);
  assert.equal(reads(ctx.otbr), 2);
});

test('something else answering (HTML, JSON without a role) is not a border router', async (t) => {
  const ctx = await setup({ connect: false });
  t.after(() => ctx.app.stop());
  ctx.otbr.routes['GET /node'] = () => ({ status: 200, body: '<html>router</html>', raw: true });
  await ctx.gladys.connect();
  await ctx.wait(0);
  assert.match(status(ctx.gladys).message.en, /not the REST API of a border router/);
  ctx.otbr.routes['GET /node'] = () => ({ status: 200, body: { hello: 'world' } });
  await ctx.wait(POLL);
  assert.match(status(ctx.gladys).message.en, /not the REST API of a border router/);
  assert.equal(ctx.gladys.fake.discoveredDevices.length, 0);
  assert.equal(state(ctx.gladys, F.ROLE), undefined);
});

test('no border agent id in /node: /node/ba-id; none at all: said, nothing published', async (t) => {
  const ctx = await setup({ connect: false });
  t.after(() => ctx.app.stop());
  const body = ctx.otbr.nodeBody.bind(ctx.otbr);
  ctx.otbr.nodeBody = () => {
    const node = body();
    delete node.baId;
    return node;
  };
  await ctx.gladys.connect();
  await ctx.wait(0);
  assert.equal(ctx.otbr.count('GET', '/node/ba-id'), 1);
  assert.equal(state(ctx.gladys, F.ROLE), 'leader', 'the id of /node/ba-id serves');
  ctx.otbr.baId = null;
  ctx.otbr.routes['GET /node/ba-id'] = () => ({ status: 404 });
  await ctx.wait(POLL);
  assert.match(status(ctx.gladys).message.en, /does not give its border agent ID/);
  ctx.otbr.routes['GET /node/ba-id'] = () => ({ status: 500 });
  await ctx.wait(POLL);
  assert.match(status(ctx.gladys).message.en, /HTTP error 500/, 'a failure, not "too old"');
});

test('another border router at the address: another device, the old one unreachable', async (t) => {
  const ctx = await setup({ created: [device(), device(OTHER_BA_ID)] });
  t.after(() => ctx.app.stop());
  ctx.otbr.baId = OTHER_BA_ID;
  ctx.otbr.routers = 5;
  await ctx.wait(POLL);
  const { gladys } = ctx;
  assert.equal(gladys.fake.discoveredDevices[0].external_id, deviceId(OTHER_BA_ID));
  assert.equal(badge(gladys, BA_ID).transport, 'unreachable');
  assert.equal(state(gladys, F.ROUTERS, OTHER_BA_ID), 5);
  assert.equal(state(gladys, F.ROUTERS, BA_ID), 3, 'the old device untouched');
});

test('the device created after the reading: its values dated, never as new; none past 2 h', async (t) => {
  const ctx = await setup({ created: [] });
  t.after(() => ctx.app.stop());
  const { gladys } = ctx;
  assert.equal(gladys.fake.states.length, 0);
  await ctx.wait(MINUTE);
  await gladys.fake.deviceCreated(device());
  await ctx.wait(0);
  const role = gladys.fake.states.find((s) => s.device_feature_external_id.endsWith(':role'));
  assert.equal(role.created_at, new Date(T0).toISOString());
  assert.equal(badge(gladys).transport, 'local');
  // Past 2 h without a reading: nothing published by a creation.
  const late = await setup({ created: [], connect: true });
  t.after(() => late.app.stop());
  late.otbr.routes['GET /node'] = () => ({ status: 404 });
  await late.wait(25 * POLL);
  const before = late.gladys.fake.states.length;
  await late.gladys.fake.deviceCreated(device());
  await late.wait(0);
  assert.equal(late.gladys.fake.states.length, before);
});

test('getConfig failing in "connected": asked again with a status, without end, then the reading', async (t) => {
  // By call: the SDK's own read at connect(), then the app's.
  const plan = ['ok', 'fail', 'fail', 'ok', 'ok', 'fail', 'ok'];
  let call = 0;
  const ctx = await setup({
    connect: false,
    getConfig: async () => {
      if (plan[call++] === 'fail') throw new Error('down');
      return { host: HOST };
    },
  });
  t.after(() => ctx.app.stop());
  await ctx.gladys.connect();
  await ctx.wait(0);
  assert.match(status(ctx.gladys).message.en, /could not be read from Gladys; asked again in 5 s/);
  assert.equal(reads(ctx.otbr), 0);
  await ctx.wait(5 * SECOND);
  assert.match(status(ctx.gladys).message.en, /asked again in 10 s/);
  await ctx.wait(10 * SECOND);
  await ctx.wait(0);
  assert.equal(reads(ctx.otbr), 1);
  assert.equal(status(ctx.gladys).connected, true);
  // A failure in a later "connected" (a reconnection): again, then back.
  await ctx.gladys.disconnect();
  await ctx.gladys.connect();
  await ctx.wait(0);
  assert.match(status(ctx.gladys).message.en, /asked again in 5 s/);
  await ctx.wait(5 * SECOND);
  await ctx.wait(0);
  assert.equal(status(ctx.gladys).connected, true);
  assert.equal(reads(ctx.otbr), 1, 'no reading sooner after the reconnection');
  assert.equal(call, plan.length);
});

test('an address missing or invalid: said, nothing read', async (t) => {
  for (const [host, re] of [
    ['', /Type the address/],
    ['https://192.168.1.30', /not valid/],
    ['255.255.255.255', /not valid/],
  ]) {
    const ctx = await setup({ config: { host } });
    t.after(() => ctx.app.stop());
    assert.match(status(ctx.gladys).message.en, re);
    await ctx.wait(POLL);
    assert.equal(ctx.otbr.sent.length, 0);
  }
});

test('a new address reads at once; the old router answers nothing more', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  await ctx.gladys.fake.configUpdated({ host: '192.168.1.31' });
  await ctx.wait(0);
  assert.equal(reads(ctx.otbr), 2);
});

// --- Thread actions --------------------------------------------------------------

test('actions off by default: refused, nothing sent, nothing read', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  for (const key of ['disable_thread', 'enable_thread']) {
    for (let i = 0; i < 2; i += 1) {
      const message = await ctx.act(key);
      assert.match(message.en, /^Refused: Thread actions are off.*Nothing sent/);
      assert.match(message.fr, /^Refusé/);
    }
  }
  assert.equal(puts(ctx.otbr), 0);
  assert.equal(reads(ctx.otbr), 1);
});

test('disable: first click says what it cuts, second click sends, the outcome read back and published', async (t) => {
  const store = memoryStore();
  const ctx = await setup({ config: ALLOW, store });
  t.after(() => ctx.app.stop());
  const { gladys, otbr } = ctx;
  const first = await ctx.act('disable_thread');
  assert.match(first.en, /ID …bdd13ea1, network “GladysNet”, role leader, 3 Thread router/);
  assert.match(first.en, /cuts every Thread device.*Click again within 2 minutes/);
  assert.equal(puts(otbr), 0);
  assert.equal(reads(otbr), 2, 'the first click read the router fresh');
  const second = await ctx.act('disable_thread');
  assert.equal(second.en, 'Thread disabled (confirmed).');
  assert.equal(puts(otbr), 1);
  assert.equal(otbr.sent.find((r) => r.method === 'PUT').body, '"disable"');
  assert.equal(otbr.role, 'disabled');
  assert.equal(state(gladys, F.LAST_ACTION), 'Thread disable: confirmed');
  assert.equal(store.data.lastAction.outcome, 'confirmed');
  // The reading brought forward publishes the new role.
  await ctx.wait(2 * SECOND);
  assert.equal(state(gladys, F.ROLE), 'disabled');
  assert.equal(state(gladys, F.ATTACHED), 0);
  // Already disabled: nothing sent.
  const again = await ctx.act('disable_thread');
  assert.match(again.en, /already disabled\. Nothing sent/);
  assert.equal(puts(otbr), 1);
});

test('enable: two clicks, confirmed once the role is no longer "disabled"', async (t) => {
  const ctx = await setup({ config: ALLOW, connect: false });
  t.after(() => ctx.app.stop());
  ctx.otbr.role = 'disabled';
  ctx.otbr.enabledRole = 'detached';
  await ctx.gladys.connect();
  await ctx.wait(0);
  const first = await ctx.act('enable_thread');
  assert.match(first.en, /Click again within 2 minutes to enable Thread/);
  const second = await ctx.act('enable_thread');
  assert.equal(second.en, 'Thread enabled (role: detached).');
  assert.equal(ctx.otbr.sent.find((r) => r.method === 'PUT').body, '"enable"');
  const already = await ctx.act('enable_thread');
  assert.match(already.en, /already enabled \(role: detached\)\. Nothing sent/);
});

test('the second click past 2 minutes, or of the other action, is a first click again', async (t) => {
  const ctx = await setup({ config: ALLOW });
  t.after(() => ctx.app.stop());
  await ctx.act('disable_thread');
  await ctx.wait(2 * MINUTE + SECOND);
  const late = await ctx.act('disable_thread');
  assert.match(late.en, /Click again within 2 minutes/);
  assert.equal(puts(ctx.otbr), 0);
  ctx.otbr.role = 'disabled';
  await ctx.act('enable_thread');
  ctx.otbr.role = 'leader';
  const other = await ctx.act('disable_thread');
  assert.match(other.en, /Click again/);
  assert.equal(puts(ctx.otbr), 0);
});

test('another border router between the two clicks: nothing sent, a first click for it', async (t) => {
  const ctx = await setup({ config: ALLOW });
  t.after(() => ctx.app.stop());
  await ctx.act('disable_thread');
  ctx.otbr.baId = OTHER_BA_ID;
  const second = await ctx.act('disable_thread');
  assert.match(second.en, /^Another border router answers at this address now \(ID …33221100\)/);
  assert.equal(puts(ctx.otbr), 0);
  const third = await ctx.act('disable_thread');
  assert.equal(third.en, 'Thread disabled (confirmed).', 'confirmed on the new one');
  assert.equal(state(ctx.gladys, F.LAST_ACTION), undefined, 'not on the device of the old one');
});

test('the option turned off between the clicks, or right before the first byte: nothing sent', async (t) => {
  const ctx = await setup({ config: ALLOW });
  t.after(() => ctx.app.stop());
  await ctx.act('disable_thread');
  await ctx.gladys.fake.configUpdated({ host: HOST, allow_thread_control: false });
  await ctx.wait(0);
  const refused = await ctx.act('disable_thread');
  assert.match(refused.en, /^Refused: Thread actions are off/);
  // On again: the first click before the option went off counts no more.
  await ctx.gladys.fake.configUpdated({ host: HOST, allow_thread_control: true });
  await ctx.wait(0);
  assert.match((await ctx.act('disable_thread')).en, /Click again/);
  assert.equal(puts(ctx.otbr), 0);
  await ctx.gladys.fake.configUpdated({ host: HOST, allow_thread_control: false });
  await ctx.wait(0);
  // Turned off while the second click reads the router: a first click again, nothing sent.
  await ctx.gladys.fake.configUpdated({ host: HOST, allow_thread_control: true });
  await ctx.wait(0);
  await ctx.act('disable_thread');
  ctx.otbr.latencyMs = 2 * SECOND;
  let pending = ctx.gladys.fake.action('disable_thread', {});
  await settle();
  await ctx.gladys.fake.configUpdated({ host: HOST, allow_thread_control: false });

  assert.match((await ctx.drive(pending)).data.message.en, /^Refused: Thread actions are off/);
  assert.equal(puts(ctx.otbr), 0);
  // Turned off while the PUT connects: checked again right before the first byte.
  await ctx.gladys.fake.configUpdated({ host: HOST, allow_thread_control: true });
  await ctx.wait(0);
  ctx.otbr.latencyMs = 0;
  await ctx.act('disable_thread');
  ctx.otbr.putConnectMs = 2 * SECOND;
  pending = ctx.gladys.fake.action('disable_thread', {});
  await ctx.wait(500);
  await ctx.gladys.fake.configUpdated({ host: HOST, allow_thread_control: false });

  const message = (await ctx.drive(pending)).data.message;
  assert.match(message.en, /Nothing sent: “Allow Thread actions” was turned off meanwhile/);
  assert.equal(puts(ctx.otbr), 0);
  assert.equal(ctx.otbr.role, 'leader');
});

test('the router read too slowly: the PUT never leaves past its deadline (20 s after the click)', async (t) => {
  const ctx = await setup({ config: ALLOW });
  t.after(() => ctx.app.stop());
  await ctx.act('disable_thread');
  ctx.otbr.latencyMs = 21 * SECOND;
  const message = await ctx.act('disable_thread');
  assert.match(message.en, /^Nothing sent: the border router was read too slowly/);
  assert.equal(puts(ctx.otbr), 0);
  assert.equal(ctx.otbr.role, 'leader');
  // At 19 s, it leaves.
  await ctx.act('disable_thread');
  ctx.otbr.latencyMs = 19 * SECOND;
  const sent = await ctx.act('disable_thread');
  assert.equal(puts(ctx.otbr), 1);
  assert.doesNotMatch(sent.en, /Nothing sent/);
});

test('the router refuses the PUT (409): "refused", kept as the last action', async (t) => {
  const ctx = await setup({ config: ALLOW });
  t.after(() => ctx.app.stop());
  ctx.otbr.routes['PUT /node/state'] = () => ({ status: 409 });
  await ctx.act('disable_thread');
  const message = await ctx.act('disable_thread');
  assert.equal(message.en, 'Refused by the border router (HTTP 409).');
  assert.equal(state(ctx.gladys, F.LAST_ACTION), 'Thread disable: refused by the border router');
});

test('no answer to the PUT: "sent, without confirmation", read again 20 s later', async (t) => {
  const ctx = await setup({ config: ALLOW });
  t.after(() => ctx.app.stop());
  ctx.otbr.routes['PUT /node/state'] = 'hang';
  await ctx.act('disable_thread');
  const message = await ctx.act('disable_thread');
  assert.match(message.en, /^Sent, without confirmation/);
  assert.equal(state(ctx.gladys, F.LAST_ACTION), 'Thread disable: sent, no answer');
  const before = reads(ctx.otbr);
  await ctx.wait(21 * SECOND);
  assert.equal(reads(ctx.otbr), before + 1, 'the follow-up reading');
});

test('the role read back unchanged: "not applied yet", never confirmed', async (t) => {
  const ctx = await setup({ config: ALLOW });
  t.after(() => ctx.app.stop());
  ctx.otbr.apply = false;
  await ctx.act('disable_thread');
  const message = await ctx.act('disable_thread');
  assert.equal(message.en, 'Sent, not applied yet (role read: leader). Read again in 20 s.');
  assert.equal(state(ctx.gladys, F.LAST_ACTION), 'Thread disable: sent, not applied yet');
  assert.equal(ctx.otbr.count('GET', '/node/state'), 3, 'three checks');
});

test('the router unreachable at the second click: nothing sent', async (t) => {
  const ctx = await setup({ config: ALLOW });
  t.after(() => ctx.app.stop());
  await ctx.act('disable_thread');
  ctx.otbr.routes['GET /node'] = () => {
    throw new OtbrError(CODES.UNREACHABLE, 'EHOSTUNREACH', { notSent: true });
  };
  const message = await ctx.act('disable_thread');
  assert.equal(message.en, 'The border router could not be read (no connection). Nothing sent.');
  assert.equal(puts(ctx.otbr), 0);
});

test('one action at a time; a reading in flight is cut by an action', async (t) => {
  const ctx = await setup({ config: ALLOW });
  t.after(() => ctx.app.stop());
  await ctx.act('disable_thread');
  ctx.otbr.latencyMs = 3 * SECOND;
  const first = ctx.gladys.fake.action('disable_thread', {});
  await settle();
  const second = ctx.gladys.fake.action('disable_thread', {});
  await settle();
  assert.match((await ctx.drive(second)).data.message.en, /another Thread action is running/);
  assert.equal((await ctx.drive(first)).data.message.en, 'Thread disabled (confirmed).');
  assert.equal(puts(ctx.otbr), 1);
  // A reading hanging when an action comes: cut at once, the action does not wait for it.
  ctx.otbr.latencyMs = 0;
  ctx.otbr.routes['GET /node'] = 'hang';
  await ctx.wait(1500);
  assert.ok(ctx.app.poll, 'a reading in flight');
  delete ctx.otbr.routes['GET /node'];
  const started = ctx.clock.now;
  const message = await ctx.act('enable_thread', 100);
  assert.match(message.en, /Click again/);
  assert.ok(ctx.clock.now - started < 1000, 'the reading was cut at once');
});

test('stop(): no timer and no request after it, even in the middle of an action', async (t) => {
  const ctx = await setup({ config: ALLOW });
  t.after(() => ctx.app.stop());
  await ctx.act('disable_thread');
  ctx.otbr.apply = false;
  const pending = ctx.gladys.fake.action('disable_thread', {});
  await ctx.wait(1500);
  await ctx.app.stop();
  await ctx.drive(pending);
  const sent = ctx.otbr.sent.length;
  assert.equal(ctx.pending.size, 0, 'no timer left');
  await ctx.wait(HOUR);
  assert.equal(ctx.otbr.sent.length, sent);
  const after = await ctx.gladys.fake.action('disable_thread', {});
  assert.match(after.data.message.en, /Nothing sent/);
});

test('/data unreadable: readings go on, nothing written; read again every 10 s, then merged', async (t) => {
  const store = memoryStore({ lastAttemptAt: T0 - HOUR, attemptKey: KEY }, { unreadable: true });
  const ctx = await setup({ store });
  t.after(() => ctx.app.stop());
  assert.equal(reads(ctx.otbr), 1);
  assert.equal(store.saves, 0);
  assert.ok(ctx.logs.some((l) => /cannot be read \(EACCES\)/.test(l)));
  const loads = store.loads;
  await ctx.wait(10 * SECOND);
  assert.equal(store.loads, loads + 1);
  store.unreadable = false;
  await ctx.wait(10 * SECOND);
  assert.equal(store.saves, 1, 'written once readable again');
  assert.equal(store.data.lastAttemptAt, T0 - HOUR, 'the attempt of this run kept (the later one)');
});

test('/data hanging: never a second read beside it, the reading not held', async (t) => {
  const store = memoryStore();
  store.hangLoad = true;
  const ctx = await setup({ store, connect: false });
  t.after(() => ctx.app.stop());
  await ctx.drive(ctx.gladys.connect(), 500);
  await ctx.wait(0);
  assert.equal(reads(ctx.otbr), 1, 'read after the bounded wait for /data');
  await ctx.wait(10 * SECOND);
  await ctx.wait(10 * SECOND);
  assert.equal(store.loads, 1, 'one read at a time');
  assert.equal(store.saves, 0, 'nothing written while it cannot be read');
});

test('/data not writable: the reading and the actions go on', async (t) => {
  const store = memoryStore(null, { failing: true });
  const ctx = await setup({ store, config: ALLOW });
  t.after(() => ctx.app.stop());
  assert.equal(status(ctx.gladys).connected, true);
  await ctx.act('disable_thread');
  const message = await ctx.act('disable_thread');
  assert.equal(message.en, 'Thread disabled (confirmed).');
  assert.equal(ctx.logs.filter((l) => /cannot be written/.test(l)).length, 1, 'warned once');
});

test('one status per state: the same reading does not send it again', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const count = ctx.gladys.fake.connectionStatuses.length;
  await ctx.wait(POLL);
  await ctx.wait(POLL);
  assert.equal(ctx.gladys.fake.connectionStatuses.length, count);
});

test('the scan publishes the known router, never a reading; nothing before the first one', async (t) => {
  const ctx = await setup({ connect: false });
  t.after(() => ctx.app.stop());
  ctx.otbr.routes['GET /node'] = () => ({ status: 404 });
  await ctx.gladys.connect();
  await ctx.wait(0);
  await ctx.gladys.fake.scanRequest();
  assert.deepEqual(ctx.gladys.fake.discoveredDevices, []);
  assert.equal(reads(ctx.otbr), 1);
});

test('a command on a feature is refused: every feature is read only', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const d = device();
  const ack = await ctx.gladys.fake.setValue(d, d.features[0], 1);
  assert.equal(ack.success, false);
  assert.equal(puts(ctx.otbr), 0);
  for (const feature of d.features) {
    assert.equal(feature.read_only, true);
    assert.notEqual(feature.category, 'switch');
    assert.notEqual(feature.category, 'button');
  }
});

test('a stop while the PUT connects: not a byte written', async (t) => {
  const ctx = await setup({ config: ALLOW });
  t.after(() => ctx.app.stop());
  await ctx.act('disable_thread');
  ctx.otbr.putConnectMs = 2 * SECOND;
  const pending = ctx.gladys.fake.action('disable_thread', {});
  await ctx.wait(500);
  const stopping = ctx.app.stop();
  await ctx.drive(stopping, 500);
  const message = (await ctx.drive(pending, 500)).data.message;
  assert.match(message.en, /Nothing sent/);
  assert.equal(puts(ctx.otbr), 0);
  assert.equal(ctx.otbr.role, 'leader');
});

test('the last action kept for another address is not shown on this one', async (t) => {
  const store = memoryStore({
    lastAction: {
      key: 'http://192.168.1.99:8081',
      kind: 'disable',
      outcome: 'confirmed',
      at: T0 - HOUR,
    },
  });
  const ctx = await setup({ store });
  t.after(() => ctx.app.stop());
  assert.equal(state(ctx.gladys, F.ROLE), 'leader');
  assert.equal(state(ctx.gladys, F.LAST_ACTION), undefined);
  const mine = memoryStore({
    lastAction: { key: KEY, kind: 'enable', outcome: 'no_answer', at: T0 - HOUR },
  });
  const other = await setup({ store: mine });
  t.after(() => other.app.stop());
  assert.equal(state(other.gladys, F.LAST_ACTION), 'Thread enable: sent, no answer');
});

test('the address changed while the PUT connects: nothing sent to the old router', async (t) => {
  const ctx = await setup({ config: ALLOW });
  t.after(() => ctx.app.stop());
  await ctx.act('disable_thread');
  ctx.otbr.putConnectMs = 2 * SECOND;
  const pending = ctx.gladys.fake.action('disable_thread', {});
  await ctx.wait(500);
  await ctx.gladys.fake.configUpdated({ host: '192.168.1.31', allow_thread_control: true });
  const message = (await ctx.drive(pending, 500)).data.message;
  assert.match(message.en, /Nothing sent/);
  assert.equal(puts(ctx.otbr), 0);
  assert.equal(ctx.otbr.role, 'leader');
});

test('a Retry-After shorter than 60 s still pauses 60 s', async (t) => {
  const store = memoryStore();
  const ctx = await setup({ store, connect: false, config: { poll_interval: '1' } });
  t.after(() => ctx.app.stop());
  let n = 0;
  ctx.otbr.routes['GET /node'] = () =>
    n++ < 1
      ? { status: 429, headers: { 'retry-after': '5' } }
      : { status: 200, body: ctx.otbr.nodeBody() };
  await ctx.gladys.connect();
  await ctx.wait(0);
  assert.equal(store.data.pause.until, T0 + MINUTE, 'kept as 60 s in /data');
  await ctx.wait(59 * SECOND);
  assert.equal(reads(ctx.otbr), 1);
  await ctx.wait(2 * SECOND);
  assert.equal(reads(ctx.otbr), 2);
});
