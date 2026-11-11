// -----------------------------------------------------------------------------
// The integration: one OpenThread Border Router read through its REST API,
// and the two Thread actions of the configuration screen.
//
// Reading: every `pollMs` (monotonic clock), GET /node (role, routers, border
// agent id), then GET /node/dataset/active (secondary: its failure leaves the
// dataset fields unknown, never stops the reading). The time of each attempt
// is written to /data before it, so a restart never reads sooner than the
// interval; neither does the test button, a save of an unchanged address, a
// reconnection to Gladys nor a scan. A border router asking to wait (429,
// 5xx on /node) pauses every request (Retry-After, 60 s to 6 h), kept in
// /data.
//
// The active dataset holds the Thread network key: only its public fields
// are copied out of the answer (src/otbr/parse.js); the answer is never
// logged, kept, shown nor published.
//
// Actions (disable / enable Thread on the router): refused unless "Allow
// Thread actions" is on, never a feature of the device (no switch: a "turn
// everything off" never reaches them). Two clicks: the first reads the router
// fresh and says what it is (network, role, routers) and what the action
// does; the second, within 2 minutes, reads it fresh again and sends only if
// it is the same border router (border agent id) and the role is not already
// the one asked. The option is checked again right before the first byte of
// the PUT. The outcome is read back: "confirmed" only when the role read
// after it shows the change; "sent, not applied yet" when it still shows the
// role before; "sent, without confirmation" when the router did not answer;
// "nothing sent" when the request never left. One action at a time; a
// reading in flight is cut by an action (it is only a reading).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, targetKey } from './config.js';
import { FEATURES, INTERVALS } from './constants.js';
import { buildDevice, createdDevice, deviceIds, statesOf } from './devices.js';
import { T } from './i18n.js';
import { createClient } from './otbr/client.js';
import { CODES, isPause } from './otbr/errors.js';
import { otbrRequest } from './otbr/http.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory, serializeMemory } from './store.js';

const defaultTimers = { setTimeout, clearTimeout };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
/** A reading older than this is never published (not even dated). */
const MAX_STALE_MS = 2 * 60 * 60_000;
/** How long a stop waits for a reading or an action to end. */
const STOP_WAIT_MS = 3_000;
/** The PUT of an action never leaves later than this after the second click. */
const SEND_BY_MS = 20_000;
/** The checks after an action end by this, after the second click (the button waits 45 s). */
const ACTION_BUDGET_MS = 38_000;

export class OtbrApp {
  /**
   * @param {object} options
   * @param {object} options.gladys the SDK instance
   * @param {object} [options.logger]
   * @param {Function} [options.request] the transport (tests inject a fake server)
   * @param {() => number} [options.now] wall clock (ms), for /data only
   * @param {() => number} [options.monotonic] monotonic clock (ms), for every decision
   * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
   * @param {{ load: Function, save: Function }} [options.store] /data
   */
  constructor({
    gladys,
    logger = createLogger({ name: 'otbr' }),
    request = otbrRequest,
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.request = request;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.store = store;
    this.publisher = new StatePublisher({ gladys, logger, monotonic });
    this.config = normalizeConfig();
    /** The target read (`http://host:port`), null before a valid address. */
    this.key = null;
    this.client = null;
    /** Bumped when the target changes and at stop: an older run's results are dropped. */
    this.gen = 0;
    this.running = false;
    this.stopped = false;
    this.timer = undefined;
    this.configTimer = undefined;
    this.storeTimer = undefined;
    this.lifecycle = Promise.resolve();
    this.loopRun = Promise.resolve();
    /** What /data keeps (src/store.js); loaded at the first start. */
    this.memory = undefined;
    this.dataUnreadable = false;
    this.loading = undefined;
    this.loadWarned = false;
    this.saveWarned = false;
    /** The reading in flight: { controller, done }. */
    this.poll = undefined;
    /** The action in flight: { controller, done }. */
    this.action = undefined;
    this.lastStatus = null;
    this.resetTarget();
  }

  /** What belongs to one address: forgotten when it changes. */
  resetTarget() {
    /** Monotonic instants (undefined: none). */
    this.lastReadAt = undefined;
    this.pauseDue = undefined;
    this.followUpDue = undefined;
    /** The border agent id of the last reading, and the reading. */
    this.baId = null;
    this.reading = null;
    this.readMono = undefined;
    this.readWall = undefined;
    /** The first click of an action: { kind, baId, at } (monotonic). */
    this.confirm = null;
    this.transport = null;
    this.readStatus = null;
  }

  // --- Lifecycle ---------------------------------------------------------------

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  /** (Re)start with a configuration. Calls are serialized. */
  start(rawConfig) {
    return this.serialize(() => this.doStart(rawConfig));
  }

  /**
   * The configuration read from Gladys, then start. When Gladys does not give
   * it, asked again 5 s, 10 s, 20 s... 5 min at most, without end, the status
   * saying so. One chain at a time (cleared by pause()).
   */
  async startFromGladys(attempt = 0) {
    this.clearTimer('configTimer');
    if (this.stopped) return;
    let config;
    try {
      config = await this.gladys.getConfig();
    } catch (err) {
      if (this.stopped) return;
      const delay = clamp(
        INTERVALS.CONFIG_RETRY_MS * 2 ** attempt,
        INTERVALS.CONFIG_RETRY_MS,
        INTERVALS.CONFIG_RETRY_MAX_MS,
      );
      this.logger.warn(`Configuration not read (${err?.name ?? 'Error'}): asked again`);
      this.pause();
      await this.setStatus(false, T.status.configNotRead(delay));
      this.clearTimer('configTimer');
      this.configTimer = this.timers.setTimeout(() => {
        this.configTimer = undefined;
        this.startFromGladys(attempt + 1).catch((e) =>
          this.logger.error(`Start failed (${e?.name ?? 'Error'})`),
        );
      }, delay);
      return;
    }
    // A new connection: Gladys may have lost what it was sent.
    this.lastStatus = null;
    this.transport = null;
    try {
      this.gladys.forgetPublishedStates?.();
    } catch {
      // nothing remembered
    }
    await this.start(config);
  }

  clearTimer(name) {
    if (this[name] !== undefined) {
      this.timers.clearTimeout(this[name]);
      this[name] = undefined;
    }
  }

  /** Gladys went away: the loop stops; the target, the pace and the pause stay. */
  pause() {
    this.running = false;
    this.clearTimer('timer');
    this.clearTimer('configTimer');
    this.clearTimer('storeTimer');
  }

  /** No timer and no request after it; /data written (bounded). */
  stop() {
    this.stopped = true;
    this.gen += 1;
    this.pause();
    this.poll?.controller.abort();
    this.action?.controller.abort();
    return this.serialize(async () => {
      this.pause();
      const running = [this.poll?.done, this.action?.done].filter(Boolean);
      if (running.length > 0) {
        await this.within(Promise.allSettled(running), STOP_WAIT_MS).catch(() => {});
      }
      if (this.memory) await this.save();
    });
  }

  /** Resolves once every queued start/stop, the reading and an action are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.loopRun;
    await this.poll?.done?.catch(() => {});
    await this.action?.done?.catch(() => {});
  }

  /** `promise`, or a rejection after `ms` (the promise is left to itself). */
  within(promise, ms) {
    let handle;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        handle = this.timers.setTimeout(
          () => reject(Object.assign(new Error('Too slow'), { code: 'ETIMEDOUT' })),
          ms,
        );
      }),
    ]).finally(() => this.timers.clearTimeout(handle));
  }

  async doStart(rawConfig) {
    if (this.stopped) return;
    const config = normalizeConfig(rawConfig);
    const key = config.host ? targetKey(config) : null;
    const same = key !== null && key === this.key;
    this.config = config;
    this.running = true;
    // The option off cancels a first click waiting for its second.
    if (!config.allowThreadControl) this.confirm = null;
    if (!same) {
      // Another border router (or none): what belonged to the old one goes.
      this.gen += 1;
      this.poll?.controller.abort();
      this.key = key;
      this.client = key ? createClient(this.request, config) : null;
      this.resetTarget();
    }
    await this.loadMemory();
    if (this.stopped || !this.running) return;
    this.applyMemory();
    if (!key) {
      this.clearTimer('timer');
      await this.setStatus(
        false,
        config.hostError === 'missing' ? T.status.missingHost : T.status.invalidHost,
      );
      return;
    }
    // Same border router: the known device and the status of its last
    // reading again, no reading sooner.
    if (same && this.reading) await this.publishDiscovery();
    if (this.readStatus) await this.republishStatus();
    else await this.setStatus(false, T.status.waiting);
    this.arm();
  }

  // --- /data -------------------------------------------------------------------

  /**
   * /data, read once (bounded); while it cannot be read, read again on a
   * timer of its own, one read at a time; nothing is written there meanwhile.
   */
  async loadMemory() {
    if (this.memory && !this.dataUnreadable) return;
    if (this.loading) {
      this.memory ??= normalizeMemory(null, this.now());
      this.dataUnreadable = true;
      this.armStoreRetry();
      return;
    }
    const run = Promise.resolve().then(() => this.store.load());
    this.loading = run;
    run
      .finally(() => {
        if (this.loading === run) this.loading = undefined;
      })
      .catch(() => {});
    let raw;
    try {
      raw = await this.within(run, INTERVALS.STORE_TIMEOUT_MS);
    } catch (err) {
      if (!this.loadWarned) {
        this.loadWarned = true;
        this.logger.warn(
          `The storage /data cannot be read (${err?.code ?? 'error'}): nothing written there; read again every 10 s`,
        );
      }
      this.dataUnreadable = true;
      this.memory ??= normalizeMemory(null, this.now());
      this.armStoreRetry();
      return;
    }
    const disk = normalizeMemory(raw, this.now());
    const ram = this.dataUnreadable ? this.memory : null;
    if (ram) {
      if (ram.pause && (!disk.pause || ram.pause.until > disk.pause.until)) disk.pause = ram.pause;
      if (ram.lastAction && (!disk.lastAction || ram.lastAction.at > disk.lastAction.at)) {
        disk.lastAction = ram.lastAction;
      }
      if (ram.lastAttemptAt > disk.lastAttemptAt) {
        disk.lastAttemptAt = ram.lastAttemptAt;
        disk.attemptKey = ram.attemptKey;
      }
    }
    this.memory = disk;
    const wasUnreadable = this.dataUnreadable;
    this.dataUnreadable = false;
    this.loadWarned = false;
    this.clearTimer('storeTimer');
    if (wasUnreadable) {
      this.logger.info('The storage /data can be read again');
      await this.save();
    }
  }

  armStoreRetry() {
    if (this.storeTimer !== undefined || this.stopped) return;
    this.storeTimer = this.timers.setTimeout(() => {
      this.storeTimer = undefined;
      this.serialize(async () => {
        if (this.stopped || !this.running) return;
        await this.loadMemory();
        if (!this.dataUnreadable) {
          this.applyMemory();
          this.arm();
        }
      }).catch((err) => this.logger.error(`Storage read failed (${err?.name ?? 'Error'})`));
    }, INTERVALS.STORE_RETRY_MS);
  }

  /** What /data holds, onto the monotonic clock: never a reading sooner, a pause kept. */
  applyMemory() {
    if (!this.memory || !this.key) return;
    const now = this.now();
    const mono = this.monotonic();
    if (this.memory.lastAttemptAt > 0 && this.memory.attemptKey === this.key) {
      const at = mono - Math.max(0, now - this.memory.lastAttemptAt);
      if (this.lastReadAt === undefined || at > this.lastReadAt) this.lastReadAt = at;
    }
    const p = this.memory.pause;
    if (p && p.key === this.key && p.until > now) {
      const due = mono + (p.until - now);
      if (this.pauseDue === undefined || due > this.pauseDue) {
        this.pauseDue = due;
        this.pauseStatus = p.status;
      }
    }
  }

  /** Writes /data (bounded); false when it could not. Never while it cannot be read. */
  async save() {
    if (!this.memory || this.dataUnreadable) return false;
    try {
      await this.within(this.store.save(serializeMemory(this.memory)), INTERVALS.STORE_TIMEOUT_MS);
      this.saveWarned = false;
      return true;
    } catch (err) {
      if (!this.saveWarned) {
        this.saveWarned = true;
        this.logger.warn(`The storage /data cannot be written (${err?.code ?? 'error'})`);
      }
      return false;
    }
  }

  // --- Gladys ------------------------------------------------------------------

  /** One status per state: the same one is not sent again. */
  async setStatus(connected, message) {
    const text = JSON.stringify([connected, message]);
    if (text === this.lastStatus) return;
    this.lastStatus = text;
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      this.lastStatus = null;
      this.logger.warn(`Status not sent (${err?.name ?? 'Error'})`);
    }
  }

  /** The status of a reading, kept to be said again (a reconnection, a save). */
  async setReadStatus(connected, message) {
    this.readStatus = [connected, message];
    await this.setStatus(connected, message);
  }

  async republishStatus() {
    if (!this.readStatus) return;
    this.lastStatus = null;
    await this.setStatus(...this.readStatus);
  }

  /** The device of the border router read, when one was read (never a reading). */
  async publishDiscovery() {
    const devices = this.baId ? [buildDevice(this.gladys, this.baId)] : [];
    try {
      await this.gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      this.logger.warn(`Discovery not published (${err?.name ?? 'Error'})`);
    }
  }

  async setTransport(transport) {
    if (!this.baId || !createdDevice(this.gladys, this.baId)) return;
    if (this.transport === transport) return;
    try {
      await this.gladys.publishTransports([
        { external_id: deviceIds(this.gladys, this.baId).device, transport },
      ]);
      this.transport = transport;
    } catch (err) {
      this.logger.warn(`Badge not published (${err?.name ?? 'Error'})`);
    }
  }

  /** The device was created: the last reading, dated, if it is recent (never as new). */
  async deviceCreated(device) {
    if (!this.baId || device?.external_id !== deviceIds(this.gladys, this.baId).device) return;
    this.transport = null;
    if (!this.reading || this.monotonic() - this.readMono > MAX_STALE_MS) return;
    const created_at = new Date(this.readWall).toISOString();
    const states = statesOf(this.gladys, this.baId, this.reading).map((s) => ({
      ...s,
      created_at,
    }));
    if (states.length === 0) return;
    try {
      await this.gladys.publishStates(states);
    } catch (err) {
      this.logger.warn(`States not published (${err?.name ?? 'Error'})`);
    }
    await this.setTransport('local');
  }

  // --- Reading -----------------------------------------------------------------

  /** Delay before the next reading (monotonic), never sooner than the interval nor in a pause. */
  dueIn(mono) {
    let due = this.lastReadAt === undefined ? mono : this.lastReadAt + this.config.pollMs;
    if (this.followUpDue !== undefined) due = Math.min(due, this.followUpDue);
    if (this.pauseDue !== undefined) due = Math.max(due, this.pauseDue);
    return Math.max(0, due - mono);
  }

  arm() {
    this.clearTimer('timer');
    if (!this.running || this.stopped || !this.client) return;
    const delay = this.dueIn(this.monotonic());
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.loopRun = this.tick().catch((err) =>
        this.logger.error(`Reading failed (${err?.name ?? 'Error'})`),
      );
    }, delay);
  }

  async tick() {
    if (!this.running || this.stopped) return;
    // An action running reads the router itself; the loop is armed again at its end.
    if (this.action) return;
    if (this.dueIn(this.monotonic()) > 0) {
      this.arm();
      return;
    }
    await this.readOnce();
    this.arm();
  }

  async readOnce() {
    const gen = this.gen;
    this.lastReadAt = this.monotonic();
    this.followUpDue = undefined;
    // The time of the attempt in /data first: a restart never reads sooner.
    if (this.memory && !this.dataUnreadable) {
      this.memory.lastAttemptAt = this.now();
      this.memory.attemptKey = this.key;
      await this.save();
    }
    if (gen !== this.gen || this.stopped || !this.running || this.action) return;
    const controller = new AbortController();
    const done = this.doRead(gen, controller.signal);
    this.poll = { controller, done };
    try {
      await done;
    } finally {
      if (this.poll?.done === done) this.poll = undefined;
    }
  }

  /** The node, with its border agent id from /node or /node/ba-id. Throws an OtbrError. */
  async readNode(signal) {
    const node = await this.client.node(signal);
    if (node.baId) return node;
    let baId = null;
    try {
      baId = await this.client.baId(signal);
    } catch (err) {
      // 404: a router too old to have the route; anything else: a failure.
      // A secondary route: its 5xx is a failure of this reading, never a pause.
      if (!(err?.code === CODES.HTTP && err.status === 404))
        throw Object.assign(err, { secondary: true });
    }
    return { ...node, baId };
  }

  async doRead(gen, signal) {
    let node;
    try {
      node = await this.readNode(signal);
    } catch (err) {
      if (gen !== this.gen || signal.aborted) return;
      await this.readFailed(err);
      return;
    }
    if (gen !== this.gen || signal.aborted) return;
    if (!node.baId) {
      await this.setTransport('unreachable');
      await this.setReadStatus(false, T.status.noBaId(this.config.pollMs));
      return;
    }
    let dataset;
    try {
      dataset = await this.client.dataset(signal);
    } catch (err) {
      // Secondary: the dataset fields stay unknown, the reading goes on.
      dataset = undefined;
      this.logger.debug(`Active dataset not read (${err?.code ?? 'error'})`);
    }
    if (gen !== this.gen || signal.aborted) return;
    await this.accept(node, dataset);
  }

  /** A reading that worked: the pause lifted, the device and its states published. */
  async accept(node, dataset) {
    const gen = this.gen;
    if (this.pauseDue !== undefined || this.memory?.pause) {
      this.pauseDue = undefined;
      if (this.memory) {
        this.memory.pause = null;
        await this.save();
      }
    }
    const changed = node.baId !== this.baId;
    if (changed && this.baId) {
      this.logger.info('Another border router answers at the address: another device');
      await this.setTransport('unreachable');
      this.transport = null;
    }
    this.baId = node.baId;
    this.reading = { node, dataset, lastAction: this.lastActionHere() };
    this.readMono = this.monotonic();
    this.readWall = this.now();
    if (changed) await this.publishDiscovery();
    if (gen !== this.gen) return;
    await this.publisher.publish(statesOf(this.gladys, this.baId, this.reading));
    if (gen !== this.gen) return;
    await this.setTransport('local');
    await this.setReadStatus(true, T.status.connected(node));
  }

  async readFailed(err) {
    this.logger.warn(`Border router not read (${err?.code ?? 'error'}: ${err?.message})`);
    await this.setTransport('unreachable');
    if (isPause(err) && !err.secondary) {
      const wait = clamp(
        err.retryAfterMs ?? INTERVALS.PAUSE_MIN_MS,
        INTERVALS.PAUSE_MIN_MS,
        INTERVALS.PAUSE_MAX_MS,
      );
      this.pauseDue = this.monotonic() + wait;
      this.pauseStatus = err.status;
      if (this.memory) {
        this.memory.pause = { key: this.key, until: this.now() + wait, status: err.status };
        await this.save();
      }
      await this.setReadStatus(
        false,
        T.status.paused(err.status, Math.max(wait, this.config.pollMs)),
      );
      return;
    }
    await this.setReadStatus(false, T.status.failed(err, this.config.pollMs));
  }

  // --- Configuration screen buttons --------------------------------------------

  /** Reads the router when a reading is due (never sooner), then gives the status. */
  async testConnection() {
    if (!this.client) {
      return this.config.hostError === 'missing' ? T.status.missingHost : T.status.invalidHost;
    }
    const wait = this.dueIn(this.monotonic());
    if (wait > 0 || this.action || this.poll || !this.running) {
      const status = this.readStatus?.[1] ?? T.status.waiting;
      return T.test.notDue(status, Math.max(wait, 0));
    }
    this.clearTimer('timer');
    await this.readOnce();
    this.arm();
    return this.readStatus?.[1] ?? T.status.waiting;
  }

  /** "Disable Thread" / "Enable Thread": see the head of this file. */
  async threadAction(kind) {
    if (this.stopped) return T.action.notSent({ code: CODES.LATE });
    if (!this.config.allowThreadControl) {
      this.confirm = null;
      return T.action.notAllowed;
    }
    if (!this.client) return T.action.invalidHost;
    if (this.action) return T.action.busy;
    const mono = this.monotonic();
    if (this.pauseDue !== undefined && this.pauseDue > mono) {
      return T.action.paused(this.pauseStatus, this.pauseDue - mono);
    }
    const controller = new AbortController();
    const done = this.runAction(kind, mono, controller.signal);
    this.action = { controller, done };
    // A reading in flight is cut: the action reads the router itself.
    this.poll?.controller.abort();
    try {
      return await done;
    } finally {
      if (this.action?.done === done) this.action = undefined;
      this.arm();
    }
  }

  async runAction(kind, start, signal) {
    const gen = this.gen;
    await this.poll?.done?.catch(() => {});
    let node;
    try {
      node = await this.readNode(signal);
    } catch (err) {
      return T.action.notRead(err);
    }
    if (gen !== this.gen || this.stopped) return T.action.notSent({ code: CODES.LATE });
    // Turned off while the router was read: refused, the first click forgotten.
    if (!this.config.allowThreadControl) {
      this.confirm = null;
      return T.action.notAllowed;
    }
    if (!node.baId) return T.action.noBaId;
    const target = kind === 'disable' ? 'disabled' : 'enabled';
    const isDone = (role) => (target === 'disabled' ? role === 'disabled' : role !== 'disabled');
    if (isDone(node.role)) {
      this.confirm = null;
      return T.action.already(kind, node.role);
    }
    const mono = this.monotonic();
    const pending = this.confirm;
    const valid =
      pending &&
      pending.kind === kind &&
      pending.baId === node.baId &&
      mono - pending.at <= INTERVALS.CONFIRM_WINDOW_MS;
    if (!valid) {
      const other = Boolean(pending && pending.kind === kind && pending.baId !== node.baId);
      this.confirm = { kind, baId: node.baId, at: mono };
      return T.action.confirm(kind, node, other);
    }
    this.confirm = null;
    const sendBy = start + SEND_BY_MS;
    try {
      await this.client.setThread(kind === 'enable', {
        signal,
        beforeSend: () => {
          // The very last checks, right before the first byte.
          if (!this.config.allowThreadControl) throw Object.assign(new Error('off'), { off: true });
          if (gen !== this.gen || this.stopped || signal.aborted) {
            throw Object.assign(new Error('stopped'), { code: CODES.LATE });
          }
          if (this.monotonic() > sendBy) throw Object.assign(new Error('late'), { late: true });
        },
      });
    } catch (err) {
      if (err?.notSent) {
        if (err.off) return T.action.optionOff;
        if (err.late) return T.action.tooLate;
        return T.action.notSent(err);
      }
      if (err?.code === CODES.HTTP || err?.code === CODES.REDIRECT) {
        await this.recordAction(node.baId, kind, 'refused');
        return T.action.refused(err.status);
      }
      // Sent, no answer (timeout, connection cut): maybe applied.
      await this.recordAction(node.baId, kind, 'no_answer');
      this.followUp(INTERVALS.FOLLOW_UP_MS);
      return T.action.noAnswer;
    }
    // Read back: confirmed only when the role shows the change.
    let role = null;
    for (const delay of INTERVALS.CHECKS_MS) {
      if (this.monotonic() + delay > start + ACTION_BUDGET_MS) break;
      await this.sleep(delay, signal);
      if (gen !== this.gen || this.stopped || signal.aborted) break;
      try {
        role = await this.client.state(signal);
      } catch {
        role = null;
      }
      if (role !== null && isDone(role)) break;
    }
    if (role !== null && isDone(role)) {
      await this.recordAction(node.baId, kind, 'confirmed');
      this.followUp(INTERVALS.CHECKS_MS[0]);
      return T.action.confirmed(kind, role);
    }
    await this.recordAction(node.baId, kind, 'unconfirmed');
    this.followUp(INTERVALS.FOLLOW_UP_MS);
    return T.action.unconfirmed(role);
  }

  /** The last action kept in /data, when it was sent to this address. */
  lastActionHere() {
    const action = this.memory?.lastAction;
    return action && action.key === this.key ? action : null;
  }

  /** Waits `ms`, or less when `signal` aborts (no timer left behind). */
  sleep(ms, signal) {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const onAbort = () => {
        this.timers.clearTimeout(handle);
        resolve();
      };
      const handle = this.timers.setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** A reading brought forward after an action (still never in a pause). */
  followUp(ms) {
    const due = this.monotonic() + ms;
    if (this.followUpDue === undefined || due < this.followUpDue) this.followUpDue = due;
  }

  /** The outcome kept in /data and published as "Last action" at once. */
  async recordAction(baId, kind, outcome) {
    const action = { key: this.key, kind, outcome, at: this.now() };
    if (this.memory) {
      this.memory.lastAction = action;
      await this.save();
    }
    // Published on the device of the router acted on only (the one read last).
    if (this.reading && this.baId === baId) {
      this.reading = { ...this.reading, lastAction: action };
      await this.publisher.publish(
        statesOf(this.gladys, this.baId, this.reading, { only: [FEATURES.LAST_ACTION] }),
      );
    }
  }
}
