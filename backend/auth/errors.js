/** Unified auth failure for handlers that require identity. */
export class AuthError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string }} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'AuthError';
    this.status = opts.status ?? 401;
    this.code = opts.code ?? 'UNAUTHORIZED';
  }
}
