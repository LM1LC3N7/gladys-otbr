// -----------------------------------------------------------------------------
// The only network access of the integration: one HTTP request to the REST
// API of the border router, on node:http. A deadline for the whole exchange,
// a size cap on the body (the declared length checked first, then counted
// while it arrives, the connection cut beyond it), no redirect followed, no
// connection reused (`agent: false`: one request per connection, never a
// pipeline).
//
// The request is written only once the TCP connection is up, right after
// `beforeSend()` (the very last check of an action: what it throws is
// rethrown marked `notSent`). `signal` (an AbortSignal) cuts the exchange (a
// stop of the integration).
//
// Resolves { status, headers, body (Buffer) } for any status; rejects an
// OtbrError for the transport failures, whose message never holds the
// address (Node's messages do) nor a byte of the answer.
// -----------------------------------------------------------------------------

import http from 'node:http';
import { USER_AGENT } from '../constants.js';
import { CODES, OtbrError } from './errors.js';

function transportError(err, sent) {
  const code = String(err?.code ?? '');
  // Something answered, but not in HTTP (a wrong port, TLS).
  if (code.startsWith('HPE_')) {
    return new OtbrError(CODES.BAD_ANSWER, `Not HTTP (${code})`, { notSent: !sent });
  }
  return new OtbrError(
    CODES.UNREACHABLE,
    /^[A-Z0-9_]{1,40}$/.test(code) ? code : 'Connection failed',
    { notSent: !sent },
  );
}

/**
 * @param {{ host: string, port: number, method: string, path: string }} target
 * @param {object} options
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.body]
 * @param {number} options.timeout ms for the whole exchange
 * @param {number} options.maxBytes body size cap
 * @param {() => void} [options.beforeSend]
 * @param {AbortSignal} [options.signal]
 */
export function otbrRequest(
  { host, port, method, path },
  { headers = {}, body, timeout, maxBytes, beforeSend, signal } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sent = false;
    let req = null;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) {
        req?.destroy();
        reject(error);
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(
      () =>
        finish(
          new OtbrError(CODES.TIMEOUT, `No answer within ${Math.round(timeout / 1000)} s`, {
            notSent: !sent,
          }),
        ),
      timeout,
    );
    const onAbort = () => finish(new OtbrError(CODES.LATE, 'Cut by a stop', { notSent: !sent }));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    const ready = () => {
      if (settled) return;
      try {
        beforeSend?.();
      } catch (err) {
        finish(Object.assign(err, { notSent: true }));
        return;
      }
      sent = true;
      req.end(body);
    };

    try {
      const bare = host.replace(/^\[(.*)\]$/, '$1');
      req = http.request(
        {
          method,
          host: bare,
          port,
          path,
          agent: false,
          headers: {
            accept: 'application/json',
            'user-agent': USER_AGENT,
            ...(body !== undefined
              ? {
                  'content-type': 'application/json',
                  'content-length': String(Buffer.byteLength(body)),
                }
              : {}),
            ...headers,
          },
        },
        (res) => {
          // An answer before the request was written: never accepted.
          if (!sent) {
            finish(new OtbrError(CODES.BAD_ANSWER, 'Answer before the request', { notSent: true }));
            return;
          }
          const declared = Number(res.headers['content-length']);
          if (Number.isFinite(declared) && declared > maxBytes) {
            finish(new OtbrError(CODES.TOO_LARGE, `Answer above ${maxBytes} bytes`));
            return;
          }
          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
              finish(new OtbrError(CODES.TOO_LARGE, `Answer above ${maxBytes} bytes`));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            finish(null, {
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
          res.on('aborted', () => finish(new OtbrError(CODES.BAD_ANSWER, 'Answer cut')));
          res.on('error', (err) => finish(transportError(err, sent)));
        },
      );
      req.on('socket', (socket) => {
        if (socket.connecting) socket.once('connect', ready);
        else ready();
      });
      req.on('error', (err) => finish(transportError(err, sent)));
    } catch (err) {
      // request() throws synchronously on a value it refuses: a failure, never a crash.
      finish(transportError(err, false));
    }
  });
}
