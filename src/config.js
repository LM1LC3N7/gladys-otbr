// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// No key starts with `gladys_` (the core keeps GLADYS_* for itself). No
// secret in it: the REST API of the border router has no login.
// -----------------------------------------------------------------------------

import { DEFAULT_PORT, POLL_INTERVALS } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = Object.freeze({
  poll_interval: '5',
  allow_thread_control: false,
});

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const HOSTNAME =
  /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;
const IPV6 = /^[0-9A-Fa-f:.]{2,45}$/;

/** The port: an integer 1-65535, or null. */
export function parsePort(value) {
  if (!/^\d{1,5}$/.test(value ?? '')) return null;
  const n = Number(value);
  return n > 0 && n < 65536 ? n : null;
}

/** An IPv4 address that is never one border router: any, broadcast, multicast. */
function forbiddenV4(host) {
  const [a, b, c, d] = host.split('.').map(Number);
  if (a === 0) return true;
  if (a >= 224) return true;
  return a === 255 && b === 255 && c === 255 && d === 255;
}

/**
 * The border router: an IPv4 address, a host name or an IPv6 address
 * (brackets allowed), with an optional port (8081 by default) and an optional
 * `http://`. The REST API of ot-br-posix is plain HTTP: `https://` is refused.
 * An address pasted from a browser (`http://otbr.local:8081/node`) is read as
 * its host and port. Credentials, a query, a fragment are refused.
 *   -> { host, port } or { error: 'missing' | 'invalid' }
 */
export function parseHost(value) {
  let raw = text(value);
  if (!raw) return { error: 'missing' };
  if (raw.length > 300) return { error: 'invalid' };
  let port = null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return { error: 'invalid' };
    }
    if (url.protocol !== 'http:') return { error: 'invalid' };
    if (url.username || url.password || url.search || url.hash) return { error: 'invalid' };
    // URL drops a port equal to the default of the scheme (80): read it as typed.
    const typed = /^[a-z][a-z0-9+.-]*:\/\/(?:\[[^\]]*\]|[^/:?#@]*):(\d{1,5})(?:[/?#]|$)/i.exec(raw);
    port = url.port ? Number(url.port) : typed ? parsePort(typed[1]) : null;
    raw = url.hostname;
  } else {
    const match = /^([^:[\]/]+):(\d{1,5})$/.exec(raw) ?? /^\[([^\]]+)\]:(\d{1,5})$/.exec(raw);
    if (match) {
      raw = match[1];
      port = parsePort(match[2]);
      if (port === null) return { error: 'invalid' };
    } else if (raw.includes('/')) {
      return { error: 'invalid' };
    }
  }
  const host = raw.replace(/^\[(.*)\]$/, '$1');
  const out = (h) => ({ host: h, port: port ?? DEFAULT_PORT });
  if (IPV4.test(host)) {
    if (!host.split('.').every((n) => Number(n) <= 255)) return { error: 'invalid' };
    if (forbiddenV4(host)) return { error: 'invalid' };
    return out(host);
  }
  if (host.includes(':')) {
    if (!IPV6.test(host)) return { error: 'invalid' };
    const lower = host.toLowerCase();
    // The unspecified address and multicast are never one border router.
    if (/^(::|0*:)+0*$/.test(lower) || /^ff/.test(lower)) return { error: 'invalid' };
    return out(lower);
  }
  return HOSTNAME.test(host) ? out(host.toLowerCase().replace(/\.$/, '')) : { error: 'invalid' };
}

/** A boolean of the configuration: true only for true (or "true"). */
const flag = (value) => value === true || value === 'true';

export function normalizeConfig(raw = {}) {
  raw = raw ?? {};
  const target = parseHost(raw.host);
  const poll = POLL_INTERVALS.includes(String(raw.poll_interval))
    ? String(raw.poll_interval)
    : DEFAULTS.poll_interval;
  return {
    host: target.error ? null : target.host,
    hostError: target.error ?? null,
    port: target.error ? DEFAULT_PORT : target.port,
    pollMs: Number(poll) * 60_000,
    allowThreadControl: flag(raw.allow_thread_control),
  };
}

/** `http://host:port`: the border router read; the key of the pause in /data. */
export const targetKey = (config) =>
  `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`;
