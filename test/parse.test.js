// -----------------------------------------------------------------------------
// The answers of ot-br-posix read strictly: camelCase (since September 2025)
// and PascalCase, the role as a word or a number, the dataset by whitelist.
// The bodies are the ones of a real ot-br-posix (simulated radio, 2026-11).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryAfterOf } from '../src/otbr/client.js';
import { CODES } from '../src/otbr/errors.js';
import {
  networkNameOf,
  parseBaId,
  parseDataset,
  parseNode,
  parseState,
  roleOf,
} from '../src/otbr/parse.js';
import { NETWORK_KEY, PSKC } from './helpers/fakeServer.js';

const NODE = `{
	"baId":	"504d528ac69995de0a12c90dbdd13ea1",
	"baState":	"",
	"state":	"leader",
	"routerCount":	1,
	"rlocAddress":	"fd38:f92e:fe09:fac3:0:ff:fe00:3c00",
	"extAddress":	"7a9857b5d4abf292",
	"networkName":	"GladysTest",
	"rloc16":	"0x3c00",
	"routerId":	15,
	"leaderData":	{ "partitionId": 587030545, "weighting": 65, "dataVersion": 11 },
	"extPanId":	"a5988faff7b57610"
}`;

const DATASET = `{
	"activeTimestamp":	{ "seconds": 1, "ticks": 0, "authoritative": false },
	"networkKey":	"${NETWORK_KEY}",
	"networkName":	"GladysTest",
	"extPanId":	"a5988faff7b57610",
	"meshLocalPrefix":	"fd38:f92e:fe09:fac3::/64",
	"panId":	13485,
	"channel":	15,
	"pskc":	"${PSKC}",
	"securityPolicy":	{ "rotationTime": 672, "obtainNetworkKey": true },
	"channelMask":	134215680
}`;

test('/node of a recent ot-br-posix', () => {
  assert.deepEqual(parseNode(Buffer.from(NODE)), {
    baId: '504d528ac69995de0a12c90dbdd13ea1',
    role: 'leader',
    routers: 1,
    networkName: 'GladysTest',
    extPanId: 'a5988faff7b57610',
  });
});

test('/node of an older one: PascalCase, NumOfRouter, numeric role', () => {
  const node = parseNode(
    JSON.stringify({
      BaId: '504D528AC69995DE0A12C90DBDD13EA1',
      State: 3,
      NumOfRouter: 4,
      NetworkName: 'Old',
      ExtPanId: 'A5988FAFF7B57610',
    }),
  );
  assert.deepEqual(node, {
    baId: '504d528ac69995de0a12c90dbdd13ea1',
    role: 'router',
    routers: 4,
    networkName: 'Old',
    extPanId: 'a5988faff7b57610',
  });
});

test('a role is required; out-of-shape fields are unknown, never 0', () => {
  assert.throws(() => parseNode('{"routerCount":1}'), { code: CODES.BAD_ANSWER });
  assert.throws(() => parseNode('{"state":"boss"}'), { code: CODES.BAD_ANSWER });
  assert.throws(() => parseNode('[]'), { code: CODES.BAD_ANSWER });
  assert.throws(() => parseNode('<html>'), { code: CODES.BAD_ANSWER });
  assert.throws(() => parseNode(''), { code: CODES.BAD_ANSWER });
  const node = parseNode(
    '{"state":"child","routerCount":"3","baId":"xyz","networkName":"","extPanId":12}',
  );
  assert.deepEqual(node, {
    baId: null,
    role: 'child',
    routers: null,
    networkName: null,
    extPanId: null,
  });
  assert.equal(parseNode('{"state":"router","routerCount":1.5}').routers, null);
  assert.equal(parseNode('{"state":"router","routerCount":-1}').routers, null);
  assert.equal(parseNode('{"state":"router","routerCount":65}').routers, null);
  assert.equal(parseNode('{"state":"router","routerCount":null}').routers, null);
  // An inherited key is never read.
  assert.equal(parseNode('{"__proto__":{"state":"leader"},"state":"router"}').role, 'router');
});

test('roles: the five words, the five numbers, nothing else', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(roleOf), [
    'disabled',
    'detached',
    'child',
    'router',
    'leader',
  ]);
  assert.equal(roleOf(' Leader '), 'leader');
  for (const bad of [5, -1, 1.5, '', 'disabledx', null, undefined, true, {}]) {
    assert.equal(roleOf(bad), null, String(bad));
  }
});

test('network names: 1 to 16 bytes of UTF-8, printable', () => {
  assert.equal(networkNameOf('OpenThread-e445'), 'OpenThread-e445');
  assert.equal(networkNameOf('é'.repeat(8)), 'é'.repeat(8));
  assert.equal(networkNameOf('é'.repeat(9)), null);
  assert.equal(networkNameOf('a\nb'), null);
  assert.equal(networkNameOf(''), null);
  assert.equal(networkNameOf(5), null);
});

test('the dataset: its public fields only, never the network key nor the PSKc', () => {
  const dataset = parseDataset(Buffer.from(DATASET));
  assert.deepEqual(dataset, {
    channel: 15,
    panId: '0x34ad',
    extPanId: 'a5988faff7b57610',
    networkName: 'GladysTest',
    timestamp: 1,
  });
  const text = JSON.stringify(dataset);
  assert.ok(!text.includes(NETWORK_KEY) && !text.includes(PSKC));
  const pascal = parseDataset(
    JSON.stringify({
      Channel: 26,
      PanId: 0,
      NetworkKey: NETWORK_KEY,
      PSKc: PSKC,
      ActiveTimestamp: { Seconds: 7 },
    }),
  );
  assert.deepEqual(pascal, {
    channel: 26,
    panId: '0x0000',
    extPanId: null,
    networkName: null,
    timestamp: 7,
  });
  const odd = parseDataset('{"channel":10,"panId":65535,"activeTimestamp":{"seconds":-1}}');
  assert.equal(odd.channel, null, 'not a 2.4 GHz Thread channel');
  assert.equal(odd.panId, null, '0xffff is the broadcast PAN ID');
  assert.equal(odd.timestamp, null);
});

test('an answer that is not JSON never quotes a byte of it in the error', () => {
  const body = `{"networkKey":"${NETWORK_KEY}", broken`;
  for (const parse of [parseDataset, parseNode, parseState, parseBaId]) {
    assert.throws(
      () => parse(body),
      (err) => err.code === CODES.BAD_ANSWER && !err.message.includes(NETWORK_KEY),
    );
  }
});

test('/node/ba-id and /node/state', () => {
  assert.equal(parseBaId('"AA897CA8A67F6E6DD6166133AD1562A5"'), 'aa897ca8a67f6e6dd6166133ad1562a5');
  assert.throws(() => parseBaId('"AA89"'), { code: CODES.BAD_ANSWER });
  assert.equal(parseState('"disabled"'), 'disabled');
  assert.equal(parseState('4'), 'leader');
  assert.throws(() => parseState('"on"'), { code: CODES.BAD_ANSWER });
});

test('Retry-After: seconds, or a date read against the Date of the router', () => {
  assert.equal(retryAfterOf({ 'retry-after': '120' }), 120_000);
  assert.equal(
    retryAfterOf({
      'retry-after': 'Wed, 11 Nov 2026 08:10:00 GMT',
      date: 'Wed, 11 Nov 2026 08:00:00 GMT',
    }),
    600_000,
  );
  assert.equal(retryAfterOf({ 'retry-after': 'Wed, 11 Nov 2026 08:10:00 GMT' }), null);
  assert.equal(retryAfterOf({ 'retry-after': 'soon' }), null);
  assert.equal(retryAfterOf({}), null);
});
