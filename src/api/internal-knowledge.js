/**
 * Internal knowledge + experience API (bridge auth like internal-memory.js).
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js'; import { getAuthUser } from '../../backend/identity/index.js';
import {
  buildKnowledgeBootstrap,
  retrieveKnowledge,
  compileAgentExperience,
  compileAgentExperienceFromMcpSpine,
} from '../core/knowledge-protocol-bridge.js';
import { executeAgentsamMemoryCommit } from '../core/agentsam-memory-commit.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function isAuthorized(request, env) {
  if (verifyBridgeKey(request, env)) return true;
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const bridge = env?.AGENTSAM_BRIDGE_KEY != null ? String(env.AGENTSAM_BRIDGE_KEY).trim() : '';
  if (bridge && bearer === bridge) return true;
  const header = (request.headers.get('X-Internal-Secret') || '').trim();
  return Boolean(bridge && header === bridge);
}

function parseTextPayload(mcpStyle) {
  const text = mcpStyle?.content?.[0]?.text;
  if (typeof text !== 'string') return mcpStyle;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: 'unparseable_response', raw: text };
  }
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {'bootstrap'|'search'|'commit'|'experience/finalize'|'experience/get'} mode
 */
export async function handleInternalKnowledge(request, env, mode) {
  if (request.method !== 'POST' && mode !== 'experience/get') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }
  if (!isAuthorized(request, env)) {
    const user = await getAuthUser(request, env).catch(() => null);
    if (!user) return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }
  if (!env?.DB) return jsonResponse({ ok: false, error: 'db_not_configured' }, 503);

  const body = await request.json().catch(() => ({}));
  const authIn = body.auth && typeof body.auth === 'object' ? body.auth : {};
  const args = body.args && typeof body.args === 'object' ? body.args : body;

  const tenantId = trim(authIn.tenant_id) || trim(body.tenant_id) || trim(args.tenant_id);
  const workspaceId = trim(authIn.workspace_id) || trim(body.workspace_id) || trim(args.workspace_id);
  const userId = trim(authIn.user_id) || trim(body.user_id) || trim(args.user_id);

  if (mode === 'bootstrap') {
    if (!tenantId || !workspaceId || !userId) {
      return jsonResponse({ ok: false, error: 'auth_scope_required' }, 400);
    }
    const packet = await buildKnowledgeBootstrap(env, {
      tenantId,
      workspaceId,
      userId,
      projectId: trim(args.project_id || args.projectId),
      task: trim(args.task || args.query),
      tokenBudget: Number(args.token_budget || args.tokenBudget) || 4000,
      agentRunId: trim(args.agent_run_id || args.agentRunId),
    });
    return jsonResponse(packet);
  }

  if (mode === 'search') {
    if (!tenantId || !workspaceId || !userId) {
      return jsonResponse({ ok: false, error: 'auth_scope_required' }, 400);
    }
    const out = await retrieveKnowledge(env, env.DB, {
      query: trim(args.query || args.q),
      tenantId,
      workspaceId,
      userId,
      projectId: trim(args.project_id),
      knowledgeTypes: Array.isArray(args.knowledge_types) ? args.knowledge_types : undefined,
      maxItems: Number(args.max_items || args.limit) || 12,
      includeRecentExperience: args.include_recent_experience !== false,
    });
    return jsonResponse(out);
  }

  if (mode === 'commit') {
    const workspace = {
      tenant_id: tenantId,
      user_id: userId,
      workspace_id: workspaceId,
      _,
    };
    const out = await executeAgentsamMemoryCommit(env, env.DB, workspace, args, { eager: true });
    return jsonResponse(parseTextPayload(out));
  }

  if (mode === 'experience/finalize') {
    const agentRunId = trim(args.agent_run_id || args.agentRunId);
    const compileFrom = trim(args.compile_from);
    if (!agentRunId && !args.mcp_spine) {
      return jsonResponse({ ok: false, error: 'agent_run_id_or_mcp_spine_required' }, 400);
    }
    const out = args.mcp_spine
      ? await compileAgentExperienceFromMcpSpine(env, {
          ...args.mcp_spine,
          tenant_id: tenantId || trim(args.mcp_spine.tenant_id),
          workspace_id: workspaceId || trim(args.mcp_spine.workspace_id),
        })
      : await compileAgentExperience(env, agentRunId, {
          compile_from: compileFrom || undefined,
          finalization_state: trim(args.finalization_state) || 'final',
          finalize_reason: trim(args.finalize_reason) || 'internal_finalize',
        });
    return jsonResponse(out);
  }

  if (mode === 'experience/get') {
    const runId = trim(args.agent_run_id || new URL(request.url).searchParams.get('agent_run_id'));
    if (!runId) return jsonResponse({ ok: false, error: 'agent_run_id_required' }, 400);
    const row = await env.DB.prepare(
      `SELECT * FROM agentsam_agent_experience WHERE agent_run_id = ? LIMIT 1`,
    )
      .bind(runId)
      .first()
      .catch(() => null);
    return jsonResponse({ ok: Boolean(row), experience: row || null });
  }

  return jsonResponse({ ok: false, error: 'unknown_mode' }, 400);
}
