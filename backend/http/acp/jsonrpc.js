/**
 * ACP JSON-RPC helpers (no custom framing — plain JSON-RPC 2.0 objects).
 * Transport choice (Streamable HTTP NDJSON vs WS) is decided by the handler;
 * message shapes stay protocol-native.
 */

/**
 * @param {string|number|null|undefined} id
 * @param {unknown} result
 * @param {{ code: number, message: string, data?: unknown } | null} [error]
 */
export function jsonRpcResult(id, result, error = null) {
  if (error) {
    return { jsonrpc: '2.0', id: id ?? null, error };
  }
  return { jsonrpc: '2.0', id: id ?? null, result: result ?? {} };
}

/**
 * @param {string} method
 * @param {Record<string, unknown>} params
 */
export function jsonRpcNotification(method, params) {
  return { jsonrpc: '2.0', method, params };
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, id: unknown, method: string, params: Record<string, unknown> } | { ok: false, response: object }}
 */
export function parseJsonRpcRequest(body) {
  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      response: jsonRpcResult(null, null, { code: -32700, message: 'Parse error' }),
    };
  }
  const method = String(/** @type {any} */ (body).method || '').trim();
  if (!method) {
    return {
      ok: false,
      response: jsonRpcResult(/** @type {any} */ (body).id ?? null, null, {
        code: -32600,
        message: 'Invalid Request',
      }),
    };
  }
  const params =
    /** @type {any} */ (body).params != null && typeof /** @type {any} */ (body).params === 'object'
      ? /** @type {Record<string, unknown>} */ (/** @type {any} */ (body).params)
      : {};
  return { ok: true, id: /** @type {any} */ (body).id ?? null, method, params };
}

/**
 * ACP protocol version we advertise (v1 stable).
 * Keep aligned with @agentclientprotocol/sdk PROTOCOL_VERSION when bundling allows.
 */
export const ACP_PROTOCOL_VERSION = 1;
