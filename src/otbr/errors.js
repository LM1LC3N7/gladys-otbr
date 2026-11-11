// -----------------------------------------------------------------------------
// The errors of the border router. An OtbrError message never holds the
// address nor a byte of an answer (an answer of the dataset holds the Thread
// network key): it may be logged and shown.
// -----------------------------------------------------------------------------

export const CODES = Object.freeze({
  /** No TCP connection (refused, no route, DNS). */
  UNREACHABLE: 'unreachable',
  /** No complete answer within the deadline. */
  TIMEOUT: 'timeout',
  /** Cut by a stop of the integration, or the last check before writing refused. */
  LATE: 'late',
  /** An answer above the size cap. */
  TOO_LARGE: 'too_large',
  /** Something answered, but not the REST API of a border router. */
  BAD_ANSWER: 'bad_answer',
  /** An HTTP status this code does not expect (`status`, `retryAfterMs`). */
  HTTP: 'http',
  /** A redirection: never followed. */
  REDIRECT: 'redirect',
});

export class OtbrError extends Error {
  /**
   * @param {string} code one of CODES
   * @param {string} message safe to log
   * @param {{ notSent?: boolean, status?: number, retryAfterMs?: number }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'OtbrError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/** The border router asking to wait (429, 5xx): a pause of every request. */
export const isPause = (err) =>
  err?.code === CODES.HTTP && (err.status === 429 || err.status >= 500);
