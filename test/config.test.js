import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseHost, targetKey } from '../src/config.js';

test('addresses: IPv4, host name, IPv6, optional port and http://; 8081 by default', () => {
  assert.deepEqual(parseHost('192.168.1.30'), { host: '192.168.1.30', port: 8081 });
  assert.deepEqual(parseHost(' 192.168.1.30:18081 '), { host: '192.168.1.30', port: 18081 });
  assert.deepEqual(parseHost('http://OTBR.local:8081/node'), { host: 'otbr.local', port: 8081 });
  assert.deepEqual(parseHost('http://[fd00::1]:8081'), { host: 'fd00::1', port: 8081 });
  assert.deepEqual(parseHost('[FD00::2]:9000'), { host: 'fd00::2', port: 9000 });
  assert.deepEqual(parseHost('fd00::3'), { host: 'fd00::3', port: 8081 });
  // Port 80 typed is port 80, even though URL drops it as the default of http.
  assert.deepEqual(parseHost('http://192.168.1.30:80'), { host: '192.168.1.30', port: 80 });
  assert.deepEqual(parseHost('http://[fd00::1]:80/node'), { host: 'fd00::1', port: 80 });
  assert.deepEqual(parseHost('http://192.168.1.30/'), { host: '192.168.1.30', port: 8081 });
});

test('addresses refused: https, credentials, query, broadcast, multicast, any, control characters', () => {
  assert.deepEqual(parseHost(''), { error: 'missing' });
  assert.deepEqual(parseHost(undefined), { error: 'missing' });
  for (const bad of [
    'https://192.168.1.30',
    'http://user:pw@192.168.1.30',
    'http://192.168.1.30/?x=1',
    'http://192.168.1.30/#a',
    '255.255.255.255',
    '224.0.0.251',
    '0.0.0.0',
    '::',
    'ff02::1',
    '192.168.1.300',
    '192.168.1.30:0',
    '192.168.1.30:70000',
    'otbr\r\nX-Injected: 1',
    'otbr local',
    'a/b',
    'x'.repeat(301),
  ]) {
    assert.ok(parseHost(bad).error, bad);
  }
});

test('the configuration: defaults, the option true only for true', () => {
  const c = normalizeConfig({ host: '192.168.1.30' });
  assert.equal(c.pollMs, 5 * 60_000);
  assert.equal(c.allowThreadControl, false);
  assert.equal(
    normalizeConfig({ host: 'a', allow_thread_control: 'true' }).allowThreadControl,
    true,
  );
  assert.equal(normalizeConfig({ host: 'a', allow_thread_control: 1 }).allowThreadControl, false);
  assert.equal(normalizeConfig({ host: 'a', poll_interval: '1' }).pollMs, 60_000);
  assert.equal(normalizeConfig({ host: 'a', poll_interval: '2' }).pollMs, 5 * 60_000);
  assert.equal(normalizeConfig(null).hostError, 'missing');
  assert.equal(targetKey(normalizeConfig({ host: 'fd00::1' })), 'http://[fd00::1]:8081');
  assert.equal(targetKey(normalizeConfig({ host: '10.0.0.2:81' })), 'http://10.0.0.2:81');
});
