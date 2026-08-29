/**
 * POST|GET /api/internal/code-index/pg-smoke
 * Connect → SELECT 1 → end. No crawl, no embed.
 * Auth: AGENTSAM_BRIDGE_KEY (Bearer or X-Internal-Secret).
 *
 * Query/body:
 *   via=session|hyperdrive|direct|auto|compare  (default compare)
 *   attempts=1..5
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import {
  smokeCodeIndexPgConnect,
  smokeCodeIndexPgConnectCompare,
} from '../../backend/agentsam/codebase/code-index-write-pipe.js';

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleInternalCodeIndexPgSmoke(request, env) {
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }
  if (!verifyBridgeKey(request, env)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  let attempts = 3;
  let via = 'compare';
  if (method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (body?.attempts != null) attempts = Number(body.attempts) || 3;
    if (body?.via != null) via = String(body.via).trim().toLowerCase() || 'compare';
  } else {
    try {
      const u = new URL(request.url);
      const n = Number(u.searchParams.get('attempts'));
      if (Number.isFinite(n) && n > 0) attempts = n;
      if (u.searchParams.get('via')) via = String(u.searchParams.get('via')).trim().toLowerCase();
    } catch {
      /* ignore */
    }
  }

  if (via === 'compare' || via === 'all') {
    const result = await smokeCodeIndexPgConnectCompare(env, { attempts });
    return jsonResponse(
      {
        ...result,
        note:
          'Compare paths from the Worker. Direct db.*.supabase.co is often IPv6-unreachable. Prefer Hyperdrive for Worker writes when green.',
      },
      result.ok ? 200 : 503,
    );
  }

  const result = await smokeCodeIndexPgConnect(env, { attempts, via });
  return jsonResponse(
    {
      ...result,
      smoke: `code_index_pg_${result.via || via}_select_1`,
      note:
        'Isolated connect smoke — not a full index. Production writes prefer Hyperdrive when bound; SUPABASE_DB_URL is session-pooler fallback.',
    },
    result.ok ? 200 : 503,
  );
}
