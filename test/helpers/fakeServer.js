// -----------------------------------------------------------------------------
// A fake OpenThread Border Router behind the transport of the app (the
// `request(target, options)` of src/otbr/http.js), on the virtual clock of the
// tests: the routes of the REST API of ot-br-posix, as its openapi.yaml and a
// real ot-br-posix (simulated radio, 2026-11) answer them.
//
// `otbr.routes['GET /node'] = fn | 'hang'` overrides a route: `fn(req)`
// returns { status, headers?, body } (body: a value sent as JSON, or a
// string sent as is), or throws an OtbrError. 'hang' answers nothing: the
// request ends with the TIMEOUT of its deadline (or LATE when cut), like the
// real transport. `latencyMs` delays every answer on the virtual clock.
// PUT /node/state runs `beforeSend` first (as the transport does, right
// before the first byte), then applies the role.
// -----------------------------------------------------------------------------

import { CODES, OtbrError } from '../../src/otbr/errors.js';

export const BA_ID = '504d528ac69995de0a12c90dbdd13ea1';
export const OTHER_BA_ID = 'ffeeddccbbaa99887766554433221100';
/** The secrets of the dataset: never in a log, a status, /data nor a state. */
export const NETWORK_KEY = '8b2f3a64e1d97c05a4b6f0e2c9d8137a';
export const PSKC = '5c1e9a7f03b2d8e46a9c0f1b2e3d4c5a';

export function createFakeOtbr({ timers, pascal = false } = {}) {
  const otbr = {
    pascal,
    baId: BA_ID,
    /** The role word; `numericRole` sends it as an otDeviceRole number (old servers). */
    role: 'leader',
    numericRole: false,
    routers: 3,
    networkName: 'GladysNet',
    extPanId: 'a5988faff7b57610',
    /** The active dataset, null: none (204). */
    dataset: {
      activeTimestamp: { seconds: 1, ticks: 0, authoritative: false },
      networkKey: NETWORK_KEY,
      networkName: 'GladysNet',
      extPanId: 'a5988faff7b57610',
      meshLocalPrefix: 'fd38:f92e:fe09:fac3::/64',
      panId: 13485,
      channel: 15,
      pskc: PSKC,
      securityPolicy: { rotationTime: 672, obtainNetworkKey: true, routers: true },
      channelMask: 134215680,
    },
    /** PUT /node/state applies the role (false: answered 200, nothing changes). */
    apply: true,
    /** Role after "enable" (a real router goes through "detached" first). */
    enabledRole: 'leader',
    latencyMs: 0,
    /** Delay before the request is written (the TCP connection), on the virtual clock. */
    connectMs: 0,
    /** The same, for the PUT only. */
    putConnectMs: 0,
    routes: {},
    /** Every request: { method, path, body, at }. */
    sent: [],
    count(method, path) {
      return this.sent.filter((r) => r.method === method && r.path === path).length;
    },
    nodeBody() {
      const role = this.numericRole
        ? ['disabled', 'detached', 'child', 'router', 'leader'].indexOf(this.role)
        : this.role;
      if (this.pascal) {
        return {
          BaId: this.baId,
          State: role,
          NumOfRouter: this.routers,
          RlocAddress: 'fd38:f92e:fe09:fac3:0:ff:fe00:3c00',
          ExtAddress: '7a9857b5d4abf292',
          NetworkName: this.networkName,
          Rloc16: 15360,
          LeaderData: { PartitionId: 587030545, Weighting: 64, DataVersion: 11 },
          ExtPanId: this.extPanId,
        };
      }
      return {
        baId: this.baId,
        baState: '',
        state: role,
        routerCount: this.routers,
        rlocAddress: 'fd38:f92e:fe09:fac3:0:ff:fe00:3c00',
        extAddress: '7a9857b5d4abf292',
        networkName: this.networkName,
        rloc16: '0x3c00',
        routerId: 15,
        leaderData: { partitionId: 587030545, weighting: 65, dataVersion: 11 },
        extPanId: this.extPanId,
      };
    },
    datasetBody() {
      if (!this.pascal) return this.dataset;
      const d = this.dataset;
      return {
        ActiveTimestamp: { Seconds: d.activeTimestamp.seconds, Ticks: 0, Authoritative: false },
        NetworkKey: d.networkKey,
        NetworkName: d.networkName,
        ExtPanId: d.extPanId,
        MeshLocalPrefix: d.meshLocalPrefix,
        PanId: d.panId,
        Channel: d.channel,
        PSKc: d.pskc,
        ChannelMask: d.channelMask,
      };
    },
    handle(method, path, body) {
      const route = `${method} ${path}`;
      if (route === 'GET /node') return { status: 200, body: this.nodeBody() };
      if (route === 'GET /node/ba-id') {
        return this.baId ? { status: 200, body: this.baId.toUpperCase() } : { status: 404 };
      }
      if (route === 'GET /node/state') return { status: 200, body: this.role };
      if (route === 'GET /node/dataset/active') {
        return this.dataset ? { status: 200, body: this.datasetBody() } : { status: 204 };
      }
      if (route === 'PUT /node/state') {
        const word = JSON.parse(body);
        if (word !== 'enable' && word !== 'disable') return { status: 400 };
        if (this.apply) this.role = word === 'disable' ? 'disabled' : this.enabledRole;
        return { status: 200 };
      }
      return { status: 404 };
    },
    /** The transport of the app. */
    request: (target, options = {}) => {
      const { method, path } = target;
      const { signal, timeout, beforeSend, body } = options;
      return new Promise((resolve, reject) => {
        let done = false;
        let handle;
        const finish = (err, value) => {
          if (done) return;
          done = true;
          if (handle !== undefined) timers.clearTimeout(handle);
          signal?.removeEventListener('abort', onAbort);
          if (err) reject(err);
          else resolve(value);
        };
        let written = false;
        const onAbort = () =>
          finish(new OtbrError(CODES.LATE, 'Cut by a stop', { notSent: !written }));
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        const connectMs = method === 'PUT' ? otbr.putConnectMs || otbr.connectMs : otbr.connectMs;
        if (connectMs > 0) handle = timers.setTimeout(write, connectMs);
        else write();
        function write() {
          handle = undefined;
          if (done) return;
          try {
            beforeSend?.();
          } catch (err) {
            finish(Object.assign(err, { notSent: true }));
            return;
          }
          written = true;
          otbr.sent.push({ method, path, body, timeout });
          const override = otbr.routes[`${method} ${path}`];
          if (override === 'hang') {
            handle = timers.setTimeout(
              () => finish(new OtbrError(CODES.TIMEOUT, 'No answer', { notSent: false })),
              timeout,
            );
            return;
          }
          const answer = () => {
            let res;
            try {
              res = override ? override({ method, path, body }) : otbr.handle(method, path, body);
            } catch (err) {
              finish(err);
              return;
            }
            const payload =
              res.body === undefined
                ? Buffer.alloc(0)
                : Buffer.from(
                    typeof res.body === 'string' && res.raw ? res.body : JSON.stringify(res.body),
                  );
            finish(null, { status: res.status, headers: res.headers ?? {}, body: payload });
          };
          if (otbr.latencyMs > 0) handle = timers.setTimeout(answer, otbr.latencyMs);
          else answer();
        }
      });
    },
  };
  return otbr;
}
