// -----------------------------------------------------------------------------
// The real transport (node:http) against local servers: the deadline, the
// size cap, no redirect followed, the request written only after
// beforeSend(), "not sent" exact, the stop cutting the exchange.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { CODES } from '../src/otbr/errors.js';
import { otbrRequest } from '../src/otbr/http.js';
import { createClient } from '../src/otbr/client.js';

async function server(t, handler) {
  const requests = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections();
    return new Promise((resolve) => srv.close(resolve));
  });
  return { port: srv.address().port, requests };
}

const target = (port, method = 'GET', path = '/node') => ({
  host: '127.0.0.1',
  port,
  method,
  path,
});
const opts = { timeout: 2000, maxBytes: 1024 };

test('a GET: JSON asked, the module named, the body returned', async (t) => {
  const { port, requests } = await server(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"state":"leader"}');
  });
  const res = await otbrRequest(target(port), opts);
  assert.equal(res.status, 200);
  assert.equal(res.body.toString(), '{"state":"leader"}');
  assert.equal(requests[0].headers.accept, 'application/json');
  assert.match(
    requests[0].headers['user-agent'],
    /^gladys-otbr\/0\.1\.0 \(\+https:\/\/github\.com\/LM1LC3N7\/gladys-otbr\)$/,
  );
  assert.equal(requests[0].headers.connection, 'close', 'one request per connection');
});

test('the PUT of the client: "disable" as JSON, one request', async (t) => {
  const { port, requests } = await server(t, (req, res) => res.writeHead(200).end());
  const client = createClient(otbrRequest, { host: '127.0.0.1', port });
  await client.setThread(false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'PUT');
  assert.equal(requests[0].url, '/node/state');
  assert.equal(requests[0].body, '"disable"');
  assert.equal(requests[0].headers['content-type'], 'application/json');
});

test('beforeSend throwing: not a byte written, "not sent"', async (t) => {
  const { port, requests } = await server(t, (req, res) => res.writeHead(200).end());
  await assert.rejects(
    otbrRequest(target(port, 'PUT', '/node/state'), {
      ...opts,
      body: '"disable"',
      beforeSend: () => {
        throw new Error('off');
      },
    }),
    (err) => err.notSent === true && err.message === 'off',
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(requests.length, 0);
});

test('an answer above the cap is cut, declared or not', async (t) => {
  const { port } = await server(t, (req, res) => {
    if (req.url === '/declared') {
      res.writeHead(200, { 'content-length': '5000' });
      res.write('x'.repeat(100));
      return;
    }
    res.writeHead(200);
    res.write('x'.repeat(800));
    setTimeout(() => res.write('x'.repeat(800)), 20);
  });
  await assert.rejects(otbrRequest(target(port, 'GET', '/declared'), opts), {
    code: CODES.TOO_LARGE,
  });
  const started = performance.now();
  await assert.rejects(otbrRequest(target(port, 'GET', '/chunked'), opts), {
    code: CODES.TOO_LARGE,
  });
  assert.ok(performance.now() - started < 1000, 'cut at once, not at the deadline');
});

test('no answer: the deadline, sent; a refused port: not sent', async (t) => {
  const { port } = await server(t, () => {});
  const started = performance.now();
  await assert.rejects(otbrRequest(target(port), { ...opts, timeout: 300 }), (err) => {
    assert.equal(err.code, CODES.TIMEOUT);
    assert.equal(err.notSent, false);
    return true;
  });
  assert.ok(performance.now() - started < 1500);
  const closed = net.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const free = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  await assert.rejects(otbrRequest(target(free), opts), (err) => {
    assert.equal(err.code, CODES.UNREACHABLE);
    assert.equal(err.notSent, true);
    assert.equal(err.message, 'ECONNREFUSED', 'never the address');
    return true;
  });
});

test('a redirect is never followed; a status is returned as it is', async (t) => {
  const { port, requests } = await server(t, (req, res) => {
    res.writeHead(302, { location: 'http://example.invalid/' });
    res.end();
  });
  const client = createClient(otbrRequest, { host: '127.0.0.1', port });
  await assert.rejects(client.node(), { code: CODES.REDIRECT });
  assert.equal(requests.length, 1);
});

test('not HTTP on the port: "not the REST API", never a crash', async (t) => {
  const sockets = new Set();
  const srv = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.write('SSH-2.0-OpenSSH\r\n\r\n');
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    srv.close();
  });
  await assert.rejects(otbrRequest(target(srv.address().port), opts), {
    code: CODES.BAD_ANSWER,
  });
});

test('a stop cuts the exchange at once', async (t) => {
  const { port } = await server(t, () => {});
  const controller = new AbortController();
  const pending = otbrRequest(target(port), {
    ...opts,
    timeout: 10_000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, { code: CODES.LATE });
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    otbrRequest(target(port), { ...opts, signal: aborted.signal }),
    (err) => err.notSent === true,
  );
});

test('the client: 204 is no dataset; 404 on ba-id an HTTP error with its status', async (t) => {
  const { port } = await server(t, (req, res) => {
    if (req.url === '/node/dataset/active') return res.writeHead(204).end();
    if (req.url === '/node/ba-id') return res.writeHead(404).end();
    if (req.url === '/node/state') {
      res.writeHead(503, { 'retry-after': '30' });
      return res.end();
    }
    return res.writeHead(500).end();
  });
  const client = createClient(otbrRequest, { host: '127.0.0.1', port });
  assert.equal(await client.dataset(), null);
  await assert.rejects(client.baId(), (err) => err.code === CODES.HTTP && err.status === 404);
  await assert.rejects(
    client.state(),
    (err) => err.code === CODES.HTTP && err.status === 503 && err.retryAfterMs === 30_000,
  );
});
