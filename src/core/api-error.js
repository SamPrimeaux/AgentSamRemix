import { jsonResponse } from './responses.js';

/** HTTP API error with stable `code` for clients and logs. */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  toJsonResponse() {
    return jsonResponse({ error: this.code, message: this.message }, this.status);
  }
}

/**
 * @param {unknown} err
 * @returns {Response|null}
 */
export function apiErrorResponse(err) {
  if (err instanceof ApiError) return err.toJsonResponse();
  return null;
}
