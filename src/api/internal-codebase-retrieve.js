/**
 * POST /api/internal/codebase/retrieve
 * Private signed endpoint — MCP OAuth connectors call AST Graph RAG on main.
 * Auth: AGENTSAM_BRIDGE_KEY (Bearer or X-Internal-Secret) (Bearer / X-Internal-Secret).
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { resolveCronWorkspaceId } from '../../backend/jobs/cron-tenant.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function isInternalAuthorized(request, env) {
  if (verifyBridgeKey(request, env)) return true;
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const bridge = env?.AGENTSAM_BRIDGE_KEY != null ? String(env.AGENTSAM_BRIDGE_KEY).trim() : '';
  if (bridge && bearer === bridge) return true;
  const header = (request.headers.get('X-Internal-Secret') || '').trim();
  if (bridge && header === bridge) return true;
  return false;
}

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleInternalCodebaseRetrieve(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }
  if (!isInternalAuthorized(request, env)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const authIn = body.auth && typeof body.auth === 'object' ? body.auth : {};
  const args = body.args && typeof body.args === 'object' ? body.args : body;

  const workspaceId =
    trim(authIn.workspace_id) ||
    trim(body.workspace_id) ||
    trim(args.workspace_id) ||
    (await resolveCronWorkspaceId(env)) ||
    '';

  if (!workspaceId) {
    return jsonResponse({ ok: false, error: 'workspace_id_required' }, 400);
  }

  const query = trim(args.query || args.q || body.query || '');
  if (!query) {
    return jsonResponse({ ok: false, error: 'query_required' }, 400);
  }

  const { retrieveCodebaseAstContext } = await import('../core/codebase-ast-retrieve.js');
  // Forward full agentsam_codebase_retrieve input_schema — dropping graph_direction /
  // edge_types / mode made MCP callers see edge_count:0 on structural name lookups
  // (expand only runs when direction/intent is present).
  const out = await retrieveCodebaseAstContext(env, query, {
    topK: Math.min(Math.max(Number(args.top_k ?? args.topK ?? args.limit) || 8, 1), 32),
    repo: args.repo ? String(args.repo) : null,
    expand: args.expand !== false && args.expand !== 'false',
    hydrate: args.hydrate !== false && args.hydrate !== 'false',
    hydrateNeighbors:
      args.hydrate_neighbors === true ||
      args.hydrateNeighbors === true ||
      args.hydrate_neighbors === 'true' ||
      args.hydrateNeighbors === 'true',
    workspaceId,
    userId: trim(authIn.user_id) || trim(body.user_id) || null,
    tenantId: trim(authIn.tenant_id) || trim(body.tenant_id) || null,
    direction: args.graph_direction ?? args.direction ?? args.graphDirection,
    graphDirection: args.graph_direction ?? args.graphDirection ?? args.direction,
    edgeTypes: args.edge_types ?? args.edgeTypes,
    mode: args.mode ?? args.route ?? args.intent,
    escalate: args.escalate !== false && args.escalate !== 'false',
  });

  return jsonResponse(out);
}
