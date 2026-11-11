// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, the fake border router and a virtual
// clock, through the exact wiring of the container (src/handlers.js).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { OtbrApp } from '../../src/app.js';
import { buildDevice } from '../../src/devices.js';
import { registerHandlers } from '../../src/handlers.js';
import { memoryStore } from '../../src/store.js';
import { createFakeClock } from './fakeClock.js';
import { BA_ID, NETWORK_KEY, PSKC, createFakeOtbr } from './fakeServer.js';

export const SELECTOR = 'otbr';
export const T0 = Date.parse('2026-11-11T08:00:00Z');
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const POLL = 5 * MINUTE;
export const HOST = '192.168.1.30';
export const KEY = `http://${HOST}:8081`;
export const BASE_CONFIG = { host: HOST };

const ids = createFakeGladys({ selector: SELECTOR });
export const device = (baId = BA_ID) => buildDevice(ids, baId);
export const deviceId = (baId = BA_ID) => ids.externalIds('otbr', baId).device;
export const fid = (key, baId = BA_ID) => ids.externalIds('otbr', baId).feature(key);
export const state = (gladys, key, baId) => gladys.fake.lastState(fid(key, baId));
export const badge = (gladys, baId = BA_ID) =>
  gladys.fake.transports.filter((t) => t.device_external_id === deviceId(baId)).at(-1);
export const status = (gladys) => gladys.fake.connectionStatus;

const tick = () => new Promise((resolve) => setImmediate(resolve));
export const settle = async () => {
  for (let i = 0; i < 20; i += 1) await tick();
};

export async function setup({
  config = {},
  created = [device()],
  otbr,
  store = memoryStore(),
  now = T0,
  connect = true,
  getConfig,
  pascal = false,
} = {}) {
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { ...BASE_CONFIG, ...config },
    devices: created,
  });
  if (getConfig) gladys.getConfig = getConfig;
  const { clock, timers, advance, pending } = createFakeClock(now);
  otbr ??= createFakeOtbr({ timers, pascal });
  let drift = 0;
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.stack ?? String(a)).join(' ')}`),
    ]),
  );
  const app = new OtbrApp({
    gladys,
    logger,
    request: otbr.request,
    now: () => clock.now,
    // A real monotonic clock moves between two reads of it: 1 µs per call here.
    monotonic: () => clock.now + (drift += 0.001),
    timers,
    store,
  });
  registerHandlers(gladys, app, logger);
  if (connect) {
    await gladys.connect();
    await advance(0);
    await settle();
  }
  const wait = async (ms) => {
    await advance(ms);
    await settle();
  };
  /** Awaits `promise` while the virtual clock moves by `step` (bounded: fails, never hangs). */
  const drive = async (promise, step = SECOND, max = 120) => {
    let result;
    let error;
    let finished = false;
    promise
      .then((r) => (result = r))
      .catch((e) => (error = e))
      .finally(() => (finished = true));
    await settle();
    for (let i = 0; i < max && !finished; i += 1) await wait(step);
    if (!finished) throw new Error('did not end');
    if (error) throw error;
    return result;
  };
  /** Runs a manifest action while the virtual clock moves (its checks wait on it). */
  const act = async (key, step = SECOND, max = 60) => {
    const result = await drive(gladys.fake.action(key, {}), step, max);
    // The message shown under the button ({ en, fr }), or the failed ack.
    return result?.data?.message ?? result;
  };
  return { app, gladys, otbr, clock, timers, pending, advance, wait, drive, act, logs, store };
}

/** Everything the app ever said or wrote, for the secret checks. */
export function everything({ gladys, logs, store }) {
  return JSON.stringify({
    logs,
    store: store.data,
    statuses: gladys.fake.connectionStatuses,
    states: gladys.fake.states,
    devices: gladys.fake.discoveredDevices,
    transports: gladys.fake.transports,
    requests: gladys.fake.requests,
    ws: gladys.fake.wsMessages,
  });
}

export const SECRETS = [NETWORK_KEY, PSKC, NETWORK_KEY.toUpperCase(), PSKC.toUpperCase()];
