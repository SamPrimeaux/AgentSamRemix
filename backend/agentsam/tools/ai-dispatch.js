/**
 * Legacy tool entrypoint. Execution SSOT is dispatchByToolCode → agentsam_tools.
 * No hardcoded tool-name maps — exact catalog tool_key only.
 */

/**
 * Trim only.
 * @param {string} toolName
 * @returns {string}
 */
export function normalizeToolName(toolName) {
  return String(toolName || '').trim();
}

/**
 * Legacy name kept for older imports. Always catalog-gated — never prefix-dispatch
 * into tools/db.js or other builtin handler maps.
 *
 * @param {any} env
 * @param {string} toolName
 * @param {Record<string, unknown>} [params]
 * @param {Record<string, unknown>} [runContext]
 */
export async function runBuiltinTool(env, toolName, params = {}, runContext = {}) {
  const { resolveCatalogDispatchToolKey } = await import('../../../src/core/catalog-tool-key-resolve.js');
  const { dispatchByToolCode } = await import('../../http/agentsam/routes/dispatch-by-tool-code.js');

  const catalogKey = resolveCatalogDispatchToolKey(normalizeToolName(toolName));
  if (!catalogKey) {
    return { ok: false, error: 'tool_name_required' };
  }

  const p = params && typeof params === 'object' ? params : {};
  const session = p.session && typeof p.session === 'object' ? p.session : {};
  const ctx = {
    userId:
      runContext.userId ??
      runContext.user_id ??
      p.user_id ??
      session.user_id ??
      null,
    workspaceId:
      runContext.workspaceId ??
      runContext.workspace_id ??
      p.workspace_id ??
      session.workspace_id ??
      null,
    tenantId:
      runContext.tenantId ??
      runContext.tenant_id ??
      p.tenant_id ??
      session.tenant_id ??
      null,
    sessionId:
      runContext.sessionId ??
      runContext.session_id ??
      p.session_id ??
      session.session_id ??
      null,
    conversationId:
      runContext.conversationId ??
      runContext.conversation_id ??
      p.conversation_id ??
      null,
    agent_run_id: runContext.agent_run_id ?? runContext.agentRunId ?? p.agent_run_id ?? null,
    authUser: runContext.authUser ?? runContext.user ?? null,
    request: runContext.request ?? p.request ?? null,
    ctx: runContext.ctx ?? runContext.executionCtx ?? null,
  };

  const out = await dispatchByToolCode(env, catalogKey, p, ctx);
  if (out?.ok === false) {
    return {
      ok: false,
      error: out.error || `agentsam_tools not found: ${catalogKey}`,
      tool_key: out.tool_key || catalogKey,
    };
  }
  return out?.result ?? out;
}
