/**
 * Structured error for resolveModelForTask / catalog load failures.
 */

export class ResolutionError extends Error {
  /**
   * @param {string} code   - machine-readable code
   * @param {string} detail - human-readable detail
   * @param {object} [meta] - extra context
   */
  constructor(code, detail, meta = {}) {
    super(`[resolveModel:${code}] ${detail}`);
    this.name = 'ResolutionError';
    this.code = code;
    this.meta = meta;
  }
}
