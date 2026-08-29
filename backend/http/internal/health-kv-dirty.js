import { verifyBridgeKey } from '../../auth/bridge-key-auth.js';
import { OVERVIEW_DIRTY_SECTIONS, readOverviewBundleDirtyFlag } from '../../../packages/shared/overview/dirty-flags.js';
import { httpJsonResponse as jsonResponse } from '../responses.js';

export async function handleInternalHealthKvDirty(request, env) {
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!verifyBridgeKey(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id')?.trim() || url.searchParams.get('tenantId')?.trim() || 'system';
  if (!tenantId) return jsonResponse({ error: 'tenant_required', detail: 'pass ?tenant_id=' }, 400);
  const dirty_flags = {};
  for (const section of OVERVIEW_DIRTY_SECTIONS) {
    dirty_flags[section] = await readOverviewBundleDirtyFlag(env, section, tenantId);
  }
  return jsonResponse({ ok: true, tenant_id: tenantId, dirty_flags });
}
