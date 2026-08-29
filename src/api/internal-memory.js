/**
 * POST /api/internal/memory/commit|search|save
 * Private signed endpoint — MCP and automation adapters into main-owned memory core.
 * Auth: AGENTSAM_BRIDGE_KEY (Bearer or X-Internal-Secret) (Bearer / X-Internal-Secret).
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function isMemoryInternalAuthorized(request, env) {
  if (verifyBridgeKey(request, env)) return true;
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const bridge = env?.AGENTSAM_BRIDGE_KEY != null ? String(env.AGENTSAM_BRIDGE_KEY).trim() : '';
  if (bridge && bearer === bridge) return true;
  const header = (request.headers.get('X-Internal-Secret') || '').trim();
  if (bridge && header === bridge) return true;
  return false;
}

function parseTextPayload(mcpStyle) {
  const text = mcpStyle?.content?.[0]?.text;
  if (typeof text !== 'string') return mcpStyle;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: 'unparseable_memory_response', raw: text };
  }
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {'commit'|'save'|'search'} mode
 */
export async function handleInternalMemory(request, env, mode) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }
  if (!isMemoryInternalAuthorized(request, env)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }
  if (!env?.DB) {
    return jsonResponse({ ok: false, error: 'db_not_configured' }, 503);
  }

  const body = await request.json().catch(() => ({}));
  const authIn = body.auth && typeof body.auth === 'object' ? body.auth : {};
  const args = body.args && typeof body.args === 'object' ? body.args : body;
  const workspace = {
    tenant_id: trim(authIn.tenant_id) || trim(body.tenant_id),
    user_id: trim(authIn.user_id) || trim(body.user_id),
    workspace_id: trim(authIn.workspace_id) || trim(body.workspace_id),
    _,
    external_client_key: trim(authIn.external_client_key || body.external_client_key),
    token_id: trim(authIn.token_id || body.token_id),
    authorized_workspaces: Array.isArray(authIn.authorized_workspaces)
      ? authIn.authorized_workspaces
      : undefined,
  };

  if (!workspace.tenant_id || !workspace.user_id) {
    return jsonResponse({ ok: false, error: 'auth_scope_required' }, 400);
  }

  // Strip agent identity spoof fields from args; auth is authoritative.
  const cleanArgs = { ...args };
  delete cleanArgs.auth;
  delete cleanArgs.user_id;
  delete cleanArgs.tenant_id;

  if (mode === 'search') {
    const { executeAgentsamMemoryHybridSearch } = await import(
      '../core/agentsam-memory-hybrid-search.js'
    );
    const out = await executeAgentsamMemoryHybridSearch(env, env.DB, workspace, cleanArgs);
    return jsonResponse(parseTextPayload(out));
  }

  const { executeAgentsamMemoryCommit, executeAgentsamMemorySaveViaCommit } = await import(
    '../core/agentsam-memory-commit.js'
  );
  const out =
    mode === 'save'
      ? await executeAgentsamMemorySaveViaCommit(env, env.DB, workspace, cleanArgs)
      : await executeAgentsamMemoryCommit(env, env.DB, workspace, cleanArgs, {
          eager: cleanArgs.eager !== false,
        });
  return jsonResponse(parseTextPayload(out));
}
