// -----------------------------------------------------------------------------
// Fixed values of the integration: limits, delays, feature keys.
// -----------------------------------------------------------------------------

export const VERSION = '0.1.0';
export const USER_AGENT = `gladys-otbr/${VERSION} (+https://github.com/LM1LC3N7/gladys-otbr)`;

/** The REST API of ot-br-posix listens on 8081 (`--rest-listen-port`). */
export const DEFAULT_PORT = 8081;

/** The refresh choices of the manifest, in minutes. */
export const POLL_INTERVALS = ['1', '5', '15', '30'];

/** The type of the device in its external id: `ext:<selector>:otbr:<border agent id>`. */
export const DEVICE_TYPE = 'otbr';

export const STORE_FILE = '/data/otbr-state.json';

export const LIMITS = Object.freeze({
  /** Bytes of one answer (a /node or a dataset is under 1 KB). */
  BODY_BYTES: 64 * 1024,
  /** Bytes of the state file. */
  STORE_BYTES: 16 * 1024,
  /** Characters of a text state (a network name is 16 bytes at most). */
  TEXT_LENGTH: 64,
  /** Thread allows 32 routers in a partition; the feature max leaves room. */
  ROUTERS: 64,
  /** The states Gladys takes per minute (all publications together). */
  STATES_PER_MINUTE: 300,
});

export const INTERVALS = Object.freeze({
  /** An unchanged state is sent again this old (publishChangedStates). */
  HEARTBEAT_MS: 30 * 60_000,
  /** Deadline of one GET (the whole exchange). */
  READ_TIMEOUT_MS: 5_000,
  /** Deadline of the PUT of the Thread state (the stack answers at once). */
  WRITE_TIMEOUT_MS: 10_000,
  /** getConfig() failing: the next try after this, doubled up to the max. */
  CONFIG_RETRY_MS: 5_000,
  CONFIG_RETRY_MAX_MS: 5 * 60_000,
  /** A border router that asks to wait (429, 5xx): at least this, at most the max. */
  PAUSE_MIN_MS: 60_000,
  PAUSE_MAX_MS: 6 * 60 * 60_000,
  /** The second click of a Thread action must come within this delay. */
  CONFIRM_WINDOW_MS: 2 * 60_000,
  /** Reads of the state after a PUT: delays from the answer, in the action's budget. */
  CHECKS_MS: [1_000, 2_000, 4_000],
  /** The background reading after an action not yet confirmed. */
  FOLLOW_UP_MS: 20_000,
  /** /data read again on this timer while it cannot be read. */
  STORE_RETRY_MS: 10_000,
  /** Deadline of one read or write of /data. */
  STORE_TIMEOUT_MS: 3_000,
});

/** Roles of a Thread device (otDeviceRole: the numbers of the oldest REST API). */
export const ROLES = ['disabled', 'detached', 'child', 'router', 'leader'];
/** The roles of a border router attached to a Thread network. */
export const ATTACHED = new Set(['child', 'router', 'leader']);

export const FEATURES = Object.freeze({
  ROLE: 'role',
  ATTACHED: 'attached',
  ROUTERS: 'routers',
  NETWORK_NAME: 'network_name',
  CHANNEL: 'channel',
  PAN_ID: 'pan_id',
  EXT_PAN_ID: 'ext_pan_id',
  DATASET: 'dataset',
  LAST_ACTION: 'last_action',
});

/** The manifest actions. */
export const ACTIONS = Object.freeze({
  TEST: 'test_connection',
  DISABLE: 'disable_thread',
  ENABLE: 'enable_thread',
});
