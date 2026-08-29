/**
 * Protocol-neutral client terminal broker.
 *
 * ACP plane: Agent → Client terminal/create|output|wait_for_exit|kill|release
 *            (client/editor-owned terminal — ACP v1 Client methods).
 * IAM execution plane (separate): agentsam_terminal_local/remote/sandbox → terminal_exec.
 * Do not silently proxy ACP terminal/* into Local/VM/Sandbox.
 */

/**
 * @typedef {{
 *   create: (params: Record<string, unknown>) => Promise<{ terminalId: string }>,
 *   output: (params: { terminalId: string }) => Promise<Record<string, unknown>>,
 *   waitForExit: (params: { terminalId: string }) => Promise<Record<string, unknown>>,
 *   kill: (params: { terminalId: string }) => Promise<Record<string, unknown>>,
 *   release: (params: { terminalId: string }) => Promise<Record<string, unknown>>,
 * }} ClientTerminalAdapter
 */

/**
 * @param {ClientTerminalAdapter|null|undefined} adapter
 */
function requireAdapter(adapter) {
  if (!adapter) {
    const err = new Error('acp_client_terminal_unavailable');
    /** @type {any} */ (err).code = -32000;
    throw err;
  }
  return adapter;
}

/** @param {ClientTerminalAdapter|null|undefined} adapter @param {Record<string, unknown>} params */
export async function clientTerminalCreate(adapter, params) {
  return requireAdapter(adapter).create(params || {});
}

/** @param {ClientTerminalAdapter|null|undefined} adapter @param {{ terminalId: string }} params */
export async function clientTerminalOutput(adapter, params) {
  const terminalId = String(params?.terminalId || '').trim();
  if (!terminalId) {
    const err = new Error('terminalId required');
    /** @type {any} */ (err).code = -32602;
    throw err;
  }
  return requireAdapter(adapter).output({ terminalId });
}

/** @param {ClientTerminalAdapter|null|undefined} adapter @param {{ terminalId: string }} params */
export async function clientTerminalWaitForExit(adapter, params) {
  const terminalId = String(params?.terminalId || '').trim();
  if (!terminalId) {
    const err = new Error('terminalId required');
    /** @type {any} */ (err).code = -32602;
    throw err;
  }
  return requireAdapter(adapter).waitForExit({ terminalId });
}

/** @param {ClientTerminalAdapter|null|undefined} adapter @param {{ terminalId: string }} params */
export async function clientTerminalKill(adapter, params) {
  const terminalId = String(params?.terminalId || '').trim();
  if (!terminalId) {
    const err = new Error('terminalId required');
    /** @type {any} */ (err).code = -32602;
    throw err;
  }
  return requireAdapter(adapter).kill({ terminalId });
}

/** @param {ClientTerminalAdapter|null|undefined} adapter @param {{ terminalId: string }} params */
export async function clientTerminalRelease(adapter, params) {
  const terminalId = String(params?.terminalId || '').trim();
  if (!terminalId) {
    const err = new Error('terminalId required');
    /** @type {any} */ (err).code = -32602;
    throw err;
  }
  return requireAdapter(adapter).release({ terminalId });
}

/**
 * @param {{ callClient: (method: string, params: Record<string, unknown>) => Promise<any> }} hooks
 * @returns {ClientTerminalAdapter}
 */
export function createAcpClientTerminalAdapter(hooks) {
  return {
    create: (params) => hooks.callClient('terminal/create', params),
    output: (params) => hooks.callClient('terminal/output', params),
    waitForExit: (params) => hooks.callClient('terminal/wait_for_exit', params),
    kill: (params) => hooks.callClient('terminal/kill', params),
    release: (params) => hooks.callClient('terminal/release', params),
  };
}
