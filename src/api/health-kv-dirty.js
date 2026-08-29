/**
 * GET /api/internal/health-kv-dirty — read overview bundle KV dirty flags and ages.
 * Auth: AGENTSAM_BRIDGE_KEY (Bearer or X-Internal-Secret), same as summarize-backfill.
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import {
  OVERVIEW_DIRTY_SECTIONS,
  readOverviewBundleDirtyFlag,
} from '../../packages/shared/overview/dirty-flags.js';

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleHealthKvDirty(request, env) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  if (!verifyBridgeKey(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const tenantId =
    url.searchParams.get('tenant_id')?.trim() ||
    url.searchParams.get('tenantId')?.trim() ||
    'system'; // system-scoped: internal path with no authenticated user context
  if (!tenantId) {
    return jsonResponse({ error: 'tenant_required', detail: 'pass ?tenant_id=' }, 400);
  }

  /** @type {Record<string, { set: boolean, age_seconds?: number }>} */
  const dirty_flags = {};

  for (const section of OVERVIEW_DIRTY_SECTIONS) {
    dirty_flags[section] = await readOverviewBundleDirtyFlag(env, section, tenantId);
  }

  return jsonResponse({
    ok: true,
    tenant_id: tenantId,
    dirty_flags,
  });
}
