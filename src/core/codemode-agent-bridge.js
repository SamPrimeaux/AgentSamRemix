/**
 * Agent chat bridge — durable createCodemodeRuntime (via AGENT_SESSION DO) → IAM tool loop.
 */
import {
  CODEMODE_TOOL_CONNECTOR,
  CODEMODE_CATALOG_CONNECTOR,
  CODEMODE_RUNTIME_MODE,
  CODEMODE_TOOL_NAME,
  shouldUseCodemodeForRequest,
  shouldUseCodemodeTooling,
} from './codemode-constants.js';
import { getAgentSessionStub } from '../../backend/agentsam/sessions/session-context.js';

export {
  CODEMODE_TOOL_CONNECTOR,
  CODEMODE_CATALOG_CONNECTOR,
  CODEMODE_RUNTIME_MODE,
  CODEMODE_TOOL_NAME,
  shouldUseCodemodeForRequest,
  shouldUseCodemodeTooling,
};

const CODEMODE_CODE_HINT =
  'ES module sandbox only — no require(), import, Node builtins, child_process, or fs. ' +
  'codemode.search/describe discover CONNECTOR METHODS (not repo files). ' +
  'Repo/file work must call authorized tools after discovery, e.g. tools.fs_search_files / tools.fs_read_file. ' +
  'Write one async arrow function. Example: async () => { ' +
  'const m = await codemode.search("fs_search_files grep"); ' +
  'await codemode.describe(m.results[0].path); ' +
  `return await ${CODEMODE_TOOL_CONNECTOR}.fs_search_files({ query: "createCodemodeRuntime", mode: "grep" }); }`;

const CODEMODE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    code: {
      type: 'string',
      description: CODEMODE_CODE_HINT,
    },
  },
  required: ['code'],
};

/**
 * @param {string} code
 * @returns {string|null}
 */
export function validateCodemodeSource(code) {
  const s = String(code || '');
  if (/\brequire\s*\(/.test(s)) {
    return (
      'CommonJS require() is not available in the codemode sandbox. ' +
      `Discover tools via codemode.search/describe, then call await ${CODEMODE_TOOL_CONNECTOR}.<tool_key>({...}).`
    );
  }
  if (/\bmodule\.exports\b/.test(s) || /\bexports\.\w+/.test(s)) {
    return 'CommonJS exports are not available in codemode. Return a value from async () => { ... }.';
  }
  if (/\bimport\s+[\w*{]/.test(s) || /\bimport\s*\(/.test(s)) {
    return (
      'Dynamic/static import is not available in codemode. ' +
      `Use await ${CODEMODE_TOOL_CONNECTOR}.<tool_key>({...}) after codemode.search/describe.`
    );
  }
  return null;
}

/**
 * @param {{ description?: unknown }|null|undefined} codemodeTool
 */
export function codemodeToolToAgentDefinition(codemodeTool) {
  const base =
    codemodeTool?.description != null
      ? String(codemodeTool.description).slice(0, 11_000)
      : 'Execute JavaScript that discovers IAM catalog tools via codemode.search/describe, ' +
        `then calls ${CODEMODE_TOOL_CONNECTOR}.*`;
  const preferNative =
    ' Prefer calling native tools from this turn\'s tool list when you already know the tool ' +
    `(e.g. fs_search_files, agentsam_d1_query). Use ${CODEMODE_TOOL_NAME} for multi-step ` +
    'discovery/scripting — not as a required wrapper for every call.';
  const description = `${base}${preferNative}`.slice(0, 12_000);
  return {
    name: CODEMODE_TOOL_NAME,
    description,
    input_schema: { ...CODEMODE_INPUT_SCHEMA },
    requires_approval: false,
    tool_category: 'agent',
  };
}

/**
 * @param {{ tools?: Array<Record<string, unknown>> }} [opts]
 */
function serializeCodemodeOpts(opts = {}) {
  const out = {};
  if (Array.isArray(opts.tools) && opts.tools.length) {
    out.tools = opts.tools.map((t) => {
      const name = String(t?.name || t?.tool_name || t?.tool_key || '').trim();
      const rawSchema = t?.input_schema || t?.inputSchema || t?.parameters;
      const input_schema =
        rawSchema && typeof rawSchema === 'object'
          ? rawSchema
          : { type: 'object', properties: {} };
      return {
        name,
        description: String(t?.description || name).slice(0, 4000),
        input_schema: Object.assign({ type: 'object', properties: {} }, input_schema, {
          type: 'object',
        }),
      };
    }).filter((t) => t.name);
  }
  return out;
}

/**
 * @param {Record<string, unknown>} runContext
 */
function sessionIdFromRunContext(runContext = {}) {
  return String(
    runContext.sessionId ?? runContext.session_id ?? runContext.conversationId ?? runContext.conversation_id ?? '',
  ).trim();
}

/**
 * Host durable Code Mode on AGENT_SESSION (AgentChatSqlV1) so createCodemodeRuntime
 * can use Durable Object facets + SQLite execution log.
 *
 * @param {any} env
 * @param {Record<string, unknown>} runContext
 * @param {{ tools?: Array<Record<string, unknown>> }} [opts]
 */
export async function getOrBuildCodemodeRuntime(env, runContext = {}, opts = {}) {
  const sessionId = sessionIdFromRunContext(runContext);
  const stub = getAgentSessionStub(env, sessionId);
  if (!stub || typeof stub.prepareCodemodeRuntime !== 'function') {
    throw new Error(
      'getOrBuildCodemodeRuntime: AGENT_SESSION stub with prepareCodemodeRuntime is required ' +
        '(durable createCodemodeRuntime needs DurableObjectState facets)',
    );
  }

  const rpcOpts = serializeCodemodeOpts(opts);
  // Fail closed: Codemode must receive the already-authorized menu (never rebuild a catalog).
  if (!Array.isArray(rpcOpts.tools) || !rpcOpts.tools.length) {
    throw new Error(
      'getOrBuildCodemodeRuntime: opts.tools (authorized Agent Sam menu) is required',
    );
  }
  const prepared = await stub.prepareCodemodeRuntime(runContext, rpcOpts);
  return wrapPreparedCodemodeRuntime(stub, prepared, runContext, rpcOpts);
}

/**
 * Build the in-process codemode handle from a bootstrap/prepare RPC receipt.
 * @param {any} stub
 * @param {Record<string, unknown>} prepared
 * @param {Record<string, unknown>} runContext
 * @param {{ tools?: Array<Record<string, unknown>> }} rpcOpts
 */
export function wrapPreparedCodemodeRuntime(stub, prepared, runContext = {}, rpcOpts = {}) {
  const toolCount = Number(prepared?.toolCount || 0);
  if (!toolCount) {
    throw new Error('getOrBuildCodemodeRuntime: DO returned zero authorized tools');
  }

  const connectorName = String(prepared?.connectorName || '').trim();
  if (!connectorName) {
    throw new Error('getOrBuildCodemodeRuntime: DO omitted connectorName');
  }
  const mode = String(prepared?.mode || '').trim() || CODEMODE_RUNTIME_MODE;

  const codemodeTool = {
    description:
      prepared?.description != null
        ? String(prepared.description)
        : undefined,
    execute: async (input, dispatchExtra = {}) =>
      stub.executeCodemode(input, { ...runContext, ...dispatchExtra }, rpcOpts),
  };

  return {
    codemodeTool,
    toolCount,
    connectorName,
    mode,
    execute: async (input, dispatchExtra = {}) =>
      executeCodemodeAgentTool(codemodeTool, input, dispatchExtra),
    approve: async (executionId) => stub.approveCodemode({ executionId }, runContext, rpcOpts),
    reject: async (executionId, seq) =>
      stub.rejectCodemode({ executionId, seq }, runContext, rpcOpts),
    pending: async (executionId) => stub.pendingCodemode(executionId, runContext, rpcOpts),
  };
}

/**
 * @param {{ execute?: Function }|null|undefined} codemodeTool
 * @param {Record<string, unknown>} input
 * @param {Record<string, unknown>} [dispatchExtra]
 */
export async function executeCodemodeAgentTool(codemodeTool, input, dispatchExtra = {}) {
  const code = input?.code != null ? String(input.code) : '';
  if (!code.trim()) {
    return { error: 'codemode_code_required', ok: false };
  }
  const sourceErr = validateCodemodeSource(code);
  if (sourceErr) {
    return { ok: false, error: sourceErr };
  }
  if (!codemodeTool || typeof codemodeTool.execute !== 'function') {
    return { error: 'codemode_tool_unavailable', ok: false };
  }
  try {
    const out = await codemodeTool.execute({ code }, dispatchExtra);
    if (out && typeof out === 'object' && out.status === 'error') {
      return {
        ok: false,
        status: 'error',
        error: out.error != null ? String(out.error) : 'codemode_execution_failed',
        execution_id: out.executionId != null ? String(out.executionId) : null,
        logs: Array.isArray(out.logs) ? out.logs : [],
      };
    }
    if (out && typeof out === 'object' && out.status === 'paused') {
      const pending = normalizePendingActions(out.pending, out.executionId);
      return {
        ok: true,
        status: 'paused',
        execution_id: out.executionId != null ? String(out.executionId) : null,
        result: out,
        logs: [],
        pending_actions: pending,
      };
    }
    const pending = extractPendingActions(out);
    return {
      ok: true,
      status: out?.status != null ? String(out.status) : 'completed',
      execution_id: out?.executionId != null ? String(out.executionId) : null,
      result: out?.result ?? out,
      logs: out?.logs ?? [],
      pending_actions: pending,
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message != null ? String(e.message) : String(e),
    };
  }
}

/**
 * @param {unknown} pending
 * @param {unknown} executionId
 * @returns {Array<Record<string, unknown>>}
 */
function normalizePendingActions(pending, executionId) {
  if (!Array.isArray(pending)) return [];
  return pending
    .filter((x) => x && typeof x === 'object')
    .map((item) => {
      const row = /** @type {Record<string, unknown>} */ (item);
      return {
        ...row,
        tool_name:
          row.tool_name ??
          row.tool ??
          (row.connector && row.method ? `${row.connector}.${row.method}` : undefined),
        execution_id: row.executionId ?? row.execution_id ?? executionId,
        args: row.args ?? row.input,
      };
    });
}

/**
 * @param {unknown} out
 * @returns {Array<Record<string, unknown>>}
 */
export function extractPendingActions(out) {
  if (!out || typeof out !== 'object') return [];
  const root = /** @type {Record<string, unknown>} */ (out);
  if (root.status === 'paused') {
    return normalizePendingActions(root.pending, root.executionId);
  }
  const result = root.result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const pa = /** @type {Record<string, unknown>} */ (result).pending_actions;
    if (Array.isArray(pa)) return normalizePendingActions(pa, root.executionId);
    if (/** @type {Record<string, unknown>} */ (result).status === 'paused') {
      return normalizePendingActions(
        /** @type {Record<string, unknown>} */ (result).pending,
        /** @type {Record<string, unknown>} */ (result).executionId ?? root.executionId,
      );
    }
  }
  const direct = root.pending_actions;
  if (Array.isArray(direct)) return normalizePendingActions(direct, root.executionId);
  return [];
}

/**
 * Additive hybrid: keep the mode/profile tool list, mount codemode alongside it.
 * Do NOT replace catalog tools with codemode-only — that forced every call through
 * the sandbox and broke direct tool use / "do not use codemode" prompts.
 *
 * @param {Array<Record<string, unknown>>} tools
 * @param {{ codemodeTool: { description?: unknown } }} runtime
 * @param {{ browserDispatchToolsActive?: boolean, imageCapabilityIntent?: boolean, videoCapabilityIntent?: boolean }} [_opts]
 */
export function buildHybridCodemodeManifest(tools, runtime, _opts = {}) {
  void _opts;
  const native = [];
  const seen = new Set([CODEMODE_TOOL_NAME]);
  for (const t of tools || []) {
    const name = String(t?.name || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    native.push(t);
  }
  return [codemodeToolToAgentDefinition(runtime.codemodeTool), ...native];
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} opts
 * @param {Array<Record<string, unknown>>} pendingActions
 */
export async function enqueueCodemodePendingActions(env, ctx, opts, pendingActions) {
  if (!env?.DB || !Array.isArray(pendingActions) || !pendingActions.length) return [];
  const ids = [];
  const workspaceId = String(opts.workspaceId ?? opts.workspace_id ?? '').trim();
  const tenantId = String(opts.tenantId ?? opts.tenant_id ?? '').trim();
  const userId = String(opts.userId ?? opts.user_id ?? '').trim();
  const sessionId = opts.sessionId != null ? String(opts.sessionId) : null;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 3600;

  for (const item of pendingActions) {
    const toolName = String(item.tool_name ?? item.tool ?? 'unknown').trim() || 'unknown';
    const args = item.args ?? item.args_json ?? item.input ?? {};
    const reason = String(item.reason ?? item.action_summary ?? `Codemode pending: ${toolName}`).slice(0, 2000);
    const proposalId = `prop_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const argsStr = typeof args === 'string' ? args : JSON.stringify(args);
    const inputJson = JSON.stringify({
      command_text: `${toolName}(${argsStr.slice(0, 500)})`,
      filled_template: argsStr,
      command_source: 'codemode_sandbox',
      tool: toolName,
      execution_id: item.execution_id ?? item.executionId ?? null,
      seq: item.seq ?? null,
    });
    try {
      await env.DB.prepare(
        `INSERT INTO agentsam_approval_queue
         (id, tenant_id, workspace_id, user_id, session_id, tool_name, action_summary,
          risk_level, input_json, expires_at, status, approval_type, created_at,
          agent_run_id, conversation_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          proposalId,
          tenantId,
          workspaceId,
          userId || 'iam_agent',
          sessionId,
          toolName,
          reason,
          String(item.risk_level ?? 'medium'),
          inputJson,
          expiresAt,
          'pending',
          'tool',
          now,
          opts.agent_run_id ?? opts.agentRunId ?? null,
          opts.conversation_id ?? opts.conversationId ?? sessionId,
        )
        .run();
      ids.push(proposalId);
    } catch (e) {
      console.warn('[codemode] approval_queue_insert', e?.message ?? e);
    }
  }
  return ids;
}
