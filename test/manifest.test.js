// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. The published
// device follows the rules of the core (units, supported_options).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DEVICE_FEATURE_UNITS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULTS } from '../src/config.js';
import { ACTIONS, POLL_INTERVALS } from '../src/constants.js';
import { buildDevice } from '../src/devices.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const handlers = read('src/handlers.js');
const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');

// The core's own validator of supported_options, when a Gladys clone is at hand
// (not on GitHub CI): the rules below are its schema, this is the proof.
const CORE_NORMALIZE = '/home/claude/code/Gladys/server/utils/normalizeSupportedOptions.js';
const normalizeSupportedOptions = existsSync(CORE_NORMALIZE)
  ? createRequire(import.meta.url)(CORE_NORMALIZE).normalizeSupportedOptions
  : undefined;

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* texts(item, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

const keys = (list) => (list ?? []).map((item) => item.key);
const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));

test('the store basics; the version set by hand everywhere, never frozen here', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.equal(manifest.keywords, undefined, 'keywords need gladys_version >= 5.3.0 (TODO.md)');
  assert.equal(manifest.countries, undefined);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-otbr:${manifest.version}`);
  assert.equal(pkg.name, 'gladys-otbr');
  assert.equal(lock.name, 'gladys-otbr');
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['network']);
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(fields.intro.description.en, /Unofficial integration, not affiliated/);
  assert.match(fields.intro.description.fr, /non officielle, sans lien/);
  assert.match(read('docs/en.md'), /never been tested with a real border router/i);
  assert.match(read('docs/fr.md'), /jamais été testée avec un vrai routeur de bordure/i);
});

test('the license and the notices ship in the image; no person named in LICENSE; scripts stay out', () => {
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/, 'the standard text');
  assert.match(read('THIRD_PARTY_NOTICES.md'), /python-otbr-api[\s\S]*MIT License/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /ot-br-posix[\s\S]*BSD-3-Clause/);
  assert.match(dockerfile, /COPY[^\n]*LICENSE[^\n]*THIRD_PARTY_NOTICES\.md/);
  assert.doesNotMatch(dockerfile, /COPY (scripts|test)/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code; the Thread actions off by default; no secret', () => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  assert.deepEqual(keys(manifest.config_schema), [
    'intro',
    'host',
    'poll_interval',
    'actions_section',
    'allow_thread_control',
  ]);
  assert.deepEqual(
    fields.poll_interval.options.map((o) => o.value),
    POLL_INTERVALS,
  );
  for (const option of fields.poll_interval.options) {
    assert.equal(typeof option.label.en, 'string');
  }
  assert.equal(fields.allow_thread_control.type, 'boolean');
  assert.equal(fields.allow_thread_control.default, false);
  assert.equal(fields.host.default, undefined, 'no address guessed');
  assert.equal(fields.host.required, true);
  assert.ok(
    manifest.config_schema.filter((f) => f.type === 'secret').every((f) => !('default' in f)),
  );
  assert.ok(
    !manifest.config_schema.some((f) => f.key.toLowerCase().startsWith('gladys_')),
    'GLADYS_* is the core',
  );
  assert.doesNotMatch(JSON.stringify(manifest), /chiffré|encrypted/i);
  assert.match(fields.actions_section.description.en, /never a switch/);
});

test('sections store nothing', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, section.key);
    assert.equal(section.default, undefined, section.key);
    assert.ok(!(section.key in DEFAULTS), section.key);
    for (const link of section.links ?? []) assert.match(link.url, /^https:\/\//);
  }
});

test('the keys of the manifest are the keys of the code, all registered', () => {
  assert.deepEqual(keys(manifest.actions).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), name);
  }
  assert.ok(manifest.actions.every((a) => a.timeout_seconds >= 5 && a.timeout_seconds <= 120));
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.widgets, undefined);
  for (const handler of ['onScanRequest(', 'onSetValue(', 'onConfigUpdated(']) {
    assert.ok(handlers.includes(handler), handler);
  }
  assert.match(dockerignore, /^node_modules$/m);
});

const device = () =>
  buildDevice(createFakeGladys({ selector: 'otbr' }), '504d528ac69995de0a12c90dbdd13ea1');

test('units: none (counts and texts); never a switch nor a button', () => {
  for (const feature of device().features) {
    assert.equal(feature.unit, undefined, feature.name);
    assert.ok(
      ['unknown', 'text'].includes(feature.category),
      `${feature.name}: ${feature.category}`,
    );
    assert.equal(feature.read_only, true, feature.name);
  }
  assert.ok(Object.values(DEVICE_FEATURE_UNITS).length > 0);
});

test('supported_options of every published feature follow the rules of the core (none here)', () => {
  const features = device().features;
  assert.equal(features.length, 9);
  const ids = new Set();
  for (const feature of features) {
    assert.ok(!ids.has(feature.external_id), `unique: ${feature.external_id}`);
    ids.add(feature.external_id);
    assert.ok(typeof feature.name === 'string' && feature.name.trim() === feature.name);
    if (feature.supported_options === undefined) continue;
    const options = feature.supported_options;
    assert.ok(Array.isArray(options) && options.length > 0, feature.name);
    const values = new Set();
    for (const option of options) {
      assert.deepEqual(Object.keys(option).sort(), ['label', 'value'], feature.name);
      assert.equal(typeof option.label, 'string');
      assert.ok(option.label.length > 0 && option.label.trim() === option.label, option.label);
      assert.ok(
        Number.isInteger(option.value) || typeof option.value === 'string',
        `${feature.name}: ${option.value}`,
      );
      assert.ok(!values.has(option.value), 'unique values');
      values.add(option.value);
    }
    if (normalizeSupportedOptions) {
      assert.doesNotThrow(() => normalizeSupportedOptions(options, { allowStringValues: true }));
    }
  }
  assert.ok(
    features.every((f) => f.supported_options === undefined),
    'no select feature',
  );
});

test('the published device passes the checks of the fake Gladys (external ids, categories)', async () => {
  const gladys = createFakeGladys({ selector: 'otbr' });
  await gladys.connect();
  await gladys.publishDiscoveredDevices([buildDevice(gladys, '504d528ac69995de0a12c90dbdd13ea1')]);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  await gladys.disconnect();
});
