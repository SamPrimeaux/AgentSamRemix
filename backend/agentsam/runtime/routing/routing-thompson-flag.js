/**
 * Single place for “use Thompson/Beta draw vs first sorted routing arm”.
 * D1 seeds `thompson_routing_enabled`; provider historically checked `thompson_sampling` (never seeded).
 */
import { isFeatureEnabled } from '../../../platform/feature-flags.js';

/**
 * @param {any} env
 * @param {{ userId?: string | null, tenantId?: string | null }} [ctx]
 */
export async function isThompsonRoutingSamplingEnabled(env, ctx = {}) {
  if (String(env?.AGENTSAM_DETERMINISTIC_ROUTING ?? '').trim() === '1') return false;
  if (String(env?.AGENTSAM_THOMPSON_SAMPLING ?? '').trim() === '0') return false;
  const userId = ctx.userId != null ? String(ctx.userId).trim() : '';
  const tenantId = ctx.tenantId != null ? String(ctx.tenantId).trim() : '';
  const a = await isFeatureEnabled(env, 'thompson_routing_enabled', { userId, tenantId });
  const b = await isFeatureEnabled(env, 'thompson_sampling', { userId, tenantId });
  return !!(a || b);
}
