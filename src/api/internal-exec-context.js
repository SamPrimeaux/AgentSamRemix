/**
 * Internal exec context tier — R2 snapshots for ExecOS PTY sessions.
 *
 * POST /api/internal/exec/context/snapshot — write memory.json + meta.json
 * GET  /api/internal/exec/context/snapshot — read memory (query params)
 *
 * Auth: AGENTSAM_BRIDGE_KEY (Bearer or X-Internal-Secret) bearer.
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import {
  CHAT_KV_TTL_SEC,
  execSessionR2Prefix,
  writeR2Text,
  readR2Text,
} from '../../backend/agentsam/runtime/exec-context-tier.js';

function isAuthorized(request, env) {
  if (verifyBridgeKey(request, env)) return true;
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const bridge = env?.AGENTSAM_BRIDGE_KEY != null ? String(env.AGENTSAM_BRIDGE_KEY).trim() : '';
  return !!(bridge && bearer === bridge);
}

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleInternalExecContext(request, env) {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const url = new URL(request.url);

  if (request.method === 'GET') {
    const tenantId = trim(url.searchParams.get('tenant_id'));
    const userId = trim(url.searchParams.get('user_id'));
    const sessionId = trim(url.searchParams.get('session_id'));
    if (!tenantId || !userId || !sessionId) {
      return jsonResponse({ ok: false, error: 'tenant_id_user_id_session_id_required' }, 400);
    }
    const prefix = execSessionR2Prefix({ tenantId, userId, sessionId });
    const memoryKey = `${prefix}/memory.json`;
    const raw = await readR2Text(env, memoryKey);
    if (!raw) {
      return jsonResponse({ ok: false, error: 'not_found', memory_key: memoryKey }, 404);
    }
    let memory = null;
    try {
      memory = JSON.parse(raw);
    } catch {
      return jsonResponse({ ok: false, error: 'invalid_memory_json' }, 500);
    }
    return jsonResponse({
      ok: true,
      tenant_id: tenantId,
      user_id: userId,
      session_id: sessionId,
      memory_key: memoryKey,
      memory,
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  const tenantId = trim(body.tenant_id);
  const userId = trim(body.user_id);
  const sessionId = trim(body.session_id);
  const memory = body.memory;
  const terminalState = body.terminal_state ?? body.terminalState ?? null;
  const source = trim(body.source) || 'execos';

  if (!tenantId || !userId || !sessionId || !memory || typeof memory !== 'object') {
    return jsonResponse(
      { ok: false, error: 'tenant_id_user_id_session_id_memory_required' },
      400,
    );
  }

  const prefix = execSessionR2Prefix({ tenantId, userId, sessionId });
  const memoryKey = `${prefix}/memory.json`;
  const metaKey = `${prefix}/meta.json`;
  const now = new Date().toISOString();

  const meta = {
    tenant_id: tenantId,
    user_id: userId,
    session_id: sessionId,
    source,
    memory_key: memoryKey,
    updated_at: now,
    terminal_state: terminalState,
  };

  const memoryPayload = {
    session_id: sessionId,
    tenant_id: tenantId,
    user_id: userId,
    memory,
    terminal_state: terminalState,
    saved_at: now,
    source,
  };

  const [metaOk, memOk] = await Promise.all([
    writeR2Text(env, metaKey, JSON.stringify(meta)),
    writeR2Text(env, memoryKey, JSON.stringify(memoryPayload)),
  ]);

  if (!metaOk && !memOk) {
    return jsonResponse({ ok: false, error: 'r2_write_failed' }, 502);
  }

  // Hot tier: cache terminal snapshot for MCP tool calls (best-effort)
  if (env.SESSION_CACHE) {
    const kvKey = `exec:ctx:${tenantId}:${userId}:${sessionId}`;
    const hot = {
      cwd: terminalState?.cwd ?? memory?.terminalState?.cwd ?? null,
      unresolved_error:
        memory?.unresolvedError ?? terminalState?.unresolved_error ?? null,
      git_branch: terminalState?.gitBranch ?? memory?.terminalState?.gitBranch ?? null,
      updated_at: now,
    };
    env.SESSION_CACHE.put(kvKey, JSON.stringify(hot), { expirationTtl: CHAT_KV_TTL_SEC }).catch(
      (e) => console.warn('[internal-exec-context] KV hot cache failed', e?.message ?? e),
    );
  }

  return jsonResponse({
    ok: true,
    meta_key: metaKey,
    memory_key: memoryKey,
    tenant_id: tenantId,
    user_id: userId,
    session_id: sessionId,
  });
}
