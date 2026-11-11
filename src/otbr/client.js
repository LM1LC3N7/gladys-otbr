// -----------------------------------------------------------------------------
// The routes of the REST API of ot-br-posix this integration uses (after
// python-otbr-api, MIT, and the openapi.yaml of ot-br-posix, BSD-3-Clause):
//
//   GET /node                 the node: border agent id, role, routers, name
//   GET /node/ba-id           the border agent id (servers whose /node lacks it)
//   GET /node/state           the role alone (the check after a change)
//   GET /node/dataset/active  the active dataset (200), none (204)
//   PUT /node/state           "enable" / "disable" (the two actions)
//
// No login (the API has none). Every answer is bounded in size and time;
// an answer of the dataset is never logged, quoted nor kept as it is.
// -----------------------------------------------------------------------------

import { INTERVALS, LIMITS } from '../constants.js';
import { CODES, OtbrError } from './errors.js';
import { parseBaId, parseDataset, parseNode, parseState } from './parse.js';

/** Retry-After in ms: seconds, or an HTTP date read against the server's Date. */
export function retryAfterOf(headers) {
  const raw = headers?.['retry-after'];
  if (typeof raw !== 'string') return null;
  if (/^\d{1,9}$/.test(raw.trim())) return Number(raw.trim()) * 1000;
  const at = Date.parse(raw);
  const date = Date.parse(headers?.date ?? '');
  // Without a readable Date of the server, a date cannot be compared: ignored.
  if (!Number.isFinite(at) || !Number.isFinite(date)) return null;
  return Math.max(0, at - date);
}

function statusError(res) {
  if (res.status >= 300 && res.status < 400) {
    return new OtbrError(CODES.REDIRECT, `Redirection (HTTP ${res.status}), not followed`, {
      status: res.status,
    });
  }
  return new OtbrError(CODES.HTTP, `HTTP ${res.status}`, {
    status: res.status,
    retryAfterMs: retryAfterOf(res.headers),
  });
}

/**
 * @param {(target: object, options: object) => Promise<{status:number, headers:object, body:Buffer}>} request
 * @param {{ host: string, port: number }} config
 */
export function createClient(request, { host, port }) {
  const call = (method, path, options = {}) =>
    request(
      { host, port, method, path },
      {
        timeout: INTERVALS.READ_TIMEOUT_MS,
        maxBytes: LIMITS.BODY_BYTES,
        ...options,
      },
    );
  const get = async (path, signal) => {
    const res = await call('GET', path, { signal });
    if (res.status !== 200) throw statusError(res);
    return res.body;
  };
  return {
    async node(signal) {
      return parseNode(await get('/node', signal));
    },
    async baId(signal) {
      return parseBaId(await get('/node/ba-id', signal));
    },
    async state(signal) {
      return parseState(await get('/node/state', signal));
    },
    /** The public fields of the active dataset; null when the router has none (204). */
    async dataset(signal) {
      const res = await call('GET', '/node/dataset/active', { signal });
      if (res.status === 204) return null;
      if (res.status !== 200) throw statusError(res);
      return parseDataset(res.body);
    },
    /**
     * PUT /node/state: "enable" or "disable". `beforeSend` runs right before
     * the first byte; resolves when the router answered 200.
     */
    async setThread(enable, { beforeSend, signal } = {}) {
      const res = await call('PUT', '/node/state', {
        body: JSON.stringify(enable ? 'enable' : 'disable'),
        timeout: INTERVALS.WRITE_TIMEOUT_MS,
        beforeSend,
        signal,
      });
      if (res.status !== 200) throw statusError(res);
    },
  };
}
