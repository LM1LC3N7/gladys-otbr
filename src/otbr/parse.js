// -----------------------------------------------------------------------------
// The answers of the REST API of ot-br-posix, read strictly (pure).
//
// The API renamed its keys from PascalCase to camelCase in September 2025
// (ot-br-posix #2514; `NumOfRouter` became `routerCount`): both are read,
// as python-otbr-api does. The oldest servers give the role as a number
// (otDeviceRole), the newer ones as a word.
//
// The active dataset holds the Thread network key and the PSKc: only the
// fields listed in `parseDataset` are copied out of it (a whitelist), never
// the others; no message here ever quotes a byte of an answer.
// -----------------------------------------------------------------------------

import { LIMITS, ROLES } from '../constants.js';
import { CODES, OtbrError } from './errors.js';

const bad = (message) => new OtbrError(CODES.BAD_ANSWER, message);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The first own key of `names` present in `object`, else undefined. */
function pick(object, ...names) {
  for (const name of names) {
    if (Object.hasOwn(object, name)) return object[name];
  }
  return undefined;
}

/** JSON of a Buffer or a string; a BAD_ANSWER error otherwise. */
export function json(body) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '');
  try {
    return JSON.parse(text);
  } catch {
    throw bad('Answer not JSON');
  }
}

const hex = (value, bytes) =>
  typeof value === 'string' && new RegExp(`^[0-9A-Fa-f]{${bytes * 2}}$`).test(value)
    ? value.toLowerCase()
    : null;

/** A role word, from a word or an otDeviceRole number; null when neither. */
export function roleOf(value) {
  if (typeof value === 'string') {
    const word = value.trim().toLowerCase();
    return ROLES.includes(word) ? word : null;
  }
  if (Number.isInteger(value) && value >= 0 && value < ROLES.length) return ROLES[value];
  return null;
}

/** A count: an integer 0..max, null otherwise (never a text read as 0). */
const count = (value, max) =>
  Number.isInteger(value) && value >= 0 && value <= max ? value : null;

/**
 * A Thread network name: 1 to 16 bytes of UTF-8 (the Network Name TLV),
 * printable; null otherwise.
 */
export function networkNameOf(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (Buffer.byteLength(value, 'utf8') > 16) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) return null;
  return value.slice(0, LIMITS.TEXT_LENGTH);
}

/**
 * GET /node -> { baId, role, routers, networkName, extPanId }. The role is
 * required (the proof that the REST API of a border router answered); every
 * other field is null when missing or out of shape.
 */
export function parseNode(body) {
  const node = json(body);
  if (!isObject(node)) throw bad('Node not an object');
  const role = roleOf(pick(node, 'state', 'State', 'role', 'Role'));
  if (role === null) throw bad('No Thread role in the node');
  return {
    baId: hex(pick(node, 'baId', 'BaId'), 16),
    role,
    routers: count(pick(node, 'routerCount', 'numOfRouter', 'NumOfRouter'), LIMITS.ROUTERS),
    networkName: networkNameOf(pick(node, 'networkName', 'NetworkName')),
    extPanId: hex(pick(node, 'extPanId', 'ExtPanId'), 8),
  };
}

/** GET /node/ba-id -> the border agent id (32 hex digits, lower case). */
export function parseBaId(body) {
  const id = hex(json(body), 16);
  if (!id) throw bad('Border agent ID not 16 bytes of hex');
  return id;
}

/** GET /node/state -> the role word. */
export function parseState(body) {
  const role = roleOf(json(body));
  if (role === null) throw bad('Not a Thread role');
  return role;
}

/**
 * GET /node/dataset/active (JSON) -> { channel, panId, extPanId, networkName,
 * timestamp }, the public fields only (whitelist). Never the network key,
 * the PSKc, the mesh-local prefix nor the security policy.
 */
export function parseDataset(body) {
  const dataset = json(body);
  if (!isObject(dataset)) throw bad('Dataset not an object');
  const channel = pick(dataset, 'channel', 'Channel');
  const panId = pick(dataset, 'panId', 'PanId');
  const stamp = pick(dataset, 'activeTimestamp', 'ActiveTimestamp');
  const seconds = isObject(stamp) ? pick(stamp, 'seconds', 'Seconds') : undefined;
  return {
    // IEEE 802.15.4 channels of Thread at 2.4 GHz.
    channel: Number.isInteger(channel) && channel >= 11 && channel <= 26 ? channel : null,
    panId:
      Number.isInteger(panId) && panId >= 0 && panId <= 0xfffe
        ? `0x${panId.toString(16).padStart(4, '0')}`
        : null,
    extPanId: hex(pick(dataset, 'extPanId', 'ExtPanId'), 8),
    networkName: networkNameOf(pick(dataset, 'networkName', 'NetworkName')),
    timestamp: Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null,
  };
}
