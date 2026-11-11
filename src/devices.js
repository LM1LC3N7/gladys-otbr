// -----------------------------------------------------------------------------
// The Gladys device of the border router (pure):
// `ext:<selector>:otbr:<border agent id>`.
//
// The id is the border agent id of the router (16 bytes, kept by ot-br-posix
// in its settings, the same across restarts, changed by a factory reset):
// another border router answering at the address is another device, never
// a continuation of this one.
//
// Every feature is read only. Disabling or enabling Thread is NEVER a
// feature (no switch, no button of the device: a "turn everything off" of a
// scene, a voice assistant or MCP must never reach it); it is an action of
// the configuration screen, refused unless allowed (src/app.js).
//
// Nothing secret is ever a feature: of the active dataset, only the network
// name, the channel, the PAN ID and the extended PAN ID (all sent in clear
// by every Thread router in its beacons) are published.
//
// A device published again never loses a feature: the features of the device
// created in Gladys (`gladys.devices`, kept up to date by the SDK) are added
// back when the blueprint lacks them.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { ATTACHED, DEVICE_TYPE, FEATURES as F, LIMITS } from './constants.js';

export const deviceIds = (gladys, baId) => gladys.externalIds(DEVICE_TYPE, baId);

const reading = (extra) => ({ read_only: true, has_feedback: false, keep_history: true, ...extra });
const textual = () =>
  reading({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false });
// No "count" category in the core: a plain number, the unit in the name.
const plain = (min, max) => reading({ category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, min, max });
const binary = () => reading({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 });

const cut = (v) => (typeof v === 'string' && v ? v.slice(0, LIMITS.TEXT_LENGTH) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The words of the last action, as the device shows it (English, like the feature names). */
const ACTION_TEXT = {
  disable: 'Thread disable',
  enable: 'Thread enable',
};
const OUTCOME_TEXT = {
  confirmed: 'confirmed',
  unconfirmed: 'sent, not applied yet',
  no_answer: 'sent, no answer',
  refused: 'refused by the border router',
};
export const lastActionText = (action) =>
  action ? `${ACTION_TEXT[action.kind]}: ${OUTCOME_TEXT[action.outcome]}` : null;

/**
 * A reading: `{ node, dataset, lastAction }`; `dataset` is an object, null
 * (the router has no active dataset) or undefined (not read: unknown).
 * The network name and the extended PAN ID of /node are the ones of the
 * network the router is attached to; detached or disabled, /node holds
 * leftovers (the default "OpenThread"), so the dataset's are taken.
 */
const attached = (r) => ATTACHED.has(r.node?.role);
const networkName = (r) =>
  attached(r) && r.node.networkName ? r.node.networkName : (r.dataset?.networkName ?? null);
const extPanId = (r) =>
  attached(r) && r.node.extPanId ? r.node.extPanId : (r.dataset?.extPanId ?? null);

/** The features: [key, name, definition, value of a reading]. Units of the core only. */
export const FEATURE_LIST = [
  [F.ROLE, 'Thread role', textual(), (r) => cut(r.node?.role)],
  [F.ATTACHED, 'Thread network up', binary(), (r) => (r.node ? (attached(r) ? 1 : 0) : null)],
  // Detached or disabled, the count of /node is a leftover of the last partition: unknown.
  [
    F.ROUTERS,
    'Thread routers',
    plain(0, LIMITS.ROUTERS),
    (r) => (attached(r) ? num(r.node.routers) : null),
  ],
  [F.NETWORK_NAME, 'Thread network name', textual(), (r) => cut(networkName(r))],
  [F.CHANNEL, 'Thread channel', plain(11, 26), (r) => num(r.dataset?.channel)],
  [F.PAN_ID, 'Thread PAN ID', textual(), (r) => cut(r.dataset?.panId)],
  [F.EXT_PAN_ID, 'Thread extended PAN ID', textual(), (r) => cut(extPanId(r))],
  [
    F.DATASET,
    'Active dataset present',
    binary(),
    (r) => (r.dataset === undefined ? null : r.dataset === null ? 0 : 1),
  ],
  [F.LAST_ACTION, 'Last action', textual(), (r) => cut(lastActionText(r.lastAction))],
];

/** The features of the created device the blueprint lacks, appended (never fewer). */
export function withCreatedFeatures(device, devices) {
  const created = (devices ?? []).find((d) => d?.external_id === device.external_id);
  if (!created) return device;
  const known = new Set(device.features.map((f) => f.external_id));
  const extra = (created.features ?? []).filter(
    (f) => f && typeof f.external_id === 'string' && !known.has(f.external_id),
  );
  if (extra.length === 0) return device;
  return { ...device, features: [...device.features, ...extra] };
}

/** The device of the border router `baId`. */
export function buildDevice(gladys, baId) {
  const ids = deviceIds(gladys, baId);
  return withCreatedFeatures(
    {
      name: 'Thread border router',
      external_id: ids.device,
      model: 'OpenThread Border Router',
      should_poll: false,
      features: FEATURE_LIST.map(([key, name, definition]) => ({
        name,
        external_id: ids.feature(key),
        ...definition,
      })),
    },
    gladys.devices,
  );
}

/** The created device of `baId`, or null. */
export const createdDevice = (gladys, baId) =>
  (gladys.devices ?? []).find((d) => d?.external_id === deviceIds(gladys, baId).device) ?? null;

/**
 * The states of a reading for the created device: numbers and texts, never
 * null nor NaN (an unknown value is not published). `only` limits to keys.
 */
export function statesOf(gladys, baId, reading, { only } = {}) {
  const created = createdDevice(gladys, baId);
  if (!created || !reading) return [];
  const ids = deviceIds(gladys, baId);
  const have = new Set((created.features ?? []).map((f) => f?.external_id));
  const states = [];
  for (const [key, , definition, valueOf] of FEATURE_LIST) {
    if (only && !only.includes(key)) continue;
    const id = ids.feature(key);
    if (!have.has(id)) continue;
    const value = valueOf(reading);
    if (definition.category === C.TEXT) {
      if (typeof value === 'string' && value) {
        states.push({ device_feature_external_id: id, text: value });
      }
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      states.push({ device_feature_external_id: id, state: value });
    }
  }
  return states;
}
