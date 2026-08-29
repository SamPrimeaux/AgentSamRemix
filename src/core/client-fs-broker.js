/**
 * Protocol-neutral client filesystem broker.
 *
 * ACP plane: Agent → Client fs/read_text_file | fs/write_text_file (editor-owned files).
 * IAM execution plane (separate): fs-transport.js client_fs / GitHub — do not route here.
 */

/**
 * @typedef {{
 *   readTextFile: (params: { path: string, line?: number|null, limit?: number|null }) => Promise<{ content: string }>,
 *   writeTextFile: (params: { path: string, content: string }) => Promise<Record<string, unknown>>,
 * }} ClientFsAdapter
 */

/**
 * @param {ClientFsAdapter|null|undefined} adapter
 * @param {{ path: string, line?: number|null, limit?: number|null }} params
 */
export async function clientFsReadTextFile(adapter, params) {
  if (!adapter || typeof adapter.readTextFile !== 'function') {
    const err = new Error('acp_client_fs_unavailable');
    /** @type {any} */ (err).code = -32000;
    throw err;
  }
  const path = String(params.path || '').trim();
  if (!path) {
    const err = new Error('path required');
    /** @type {any} */ (err).code = -32602;
    throw err;
  }
  if (!path.startsWith('/')) {
    const err = new Error('ACP file paths must be absolute');
    /** @type {any} */ (err).code = -32602;
    throw err;
  }
  return adapter.readTextFile(params);
}

/**
 * @param {ClientFsAdapter|null|undefined} adapter
 * @param {{ path: string, content: string }} params
 */
export async function clientFsWriteTextFile(adapter, params) {
  if (!adapter || typeof adapter.writeTextFile !== 'function') {
    const err = new Error('acp_client_fs_unavailable');
    /** @type {any} */ (err).code = -32000;
    throw err;
  }
  const path = String(params.path || '').trim();
  if (!path.startsWith('/')) {
    const err = new Error('ACP file paths must be absolute');
    /** @type {any} */ (err).code = -32602;
    throw err;
  }
  return adapter.writeTextFile(params);
}

/**
 * Build adapter that forwards to ACP Client methods on an active connection/notify hook.
 * @param {{
 *   callClient: (method: string, params: Record<string, unknown>) => Promise<any>,
 * }} hooks
 * @returns {ClientFsAdapter}
 */
export function createAcpClientFsAdapter(hooks) {
  return {
    async readTextFile(params) {
      // Official ACP method name (snake_case on the wire)
      return hooks.callClient('fs/read_text_file', params);
    },
    async writeTextFile(params) {
      return hooks.callClient('fs/write_text_file', params);
    },
  };
}
