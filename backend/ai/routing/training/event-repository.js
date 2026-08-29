/**
 * Read-side repository for routing-training evidence and attribution.
 *
 * The existing reward gateway remains the write authority during this slice.
 * These narrow reads give future event producers a stable training-domain
 * seam without pulling the legacy memory module into runtime routing.
 */

const REWARD_EVENTS_TABLE = 'agentsam_reward_events';
const ROUTING_ARMS_TABLE = 'agentsam_routing_arms';

function text(value) {
  return value == null ? '' : String(value).trim();
}

export async function findTrainingEventByDedupKey(db, dedupKey) {
  const key = text(dedupKey);
  if (!db || !key) return null;
  return db
    .prepare(
      `SELECT id, routing_arm_id, model_key, signal_type, signal_value,
              cost_usd, latency_ms, created_at_unix
         FROM ${REWARD_EVENTS_TABLE}
        WHERE dedup_key = ?
        LIMIT 1`,
    )
    .bind(key)
    .first()
    .catch(() => null);
}

export async function findRoutingArm(db, armId) {
  const id = text(armId);
  if (!db || !id) return null;
  return db
    .prepare(
      `SELECT id, workspace_id, task_type, mode, model_key, provider,
              success_alpha, success_beta, cost_n, cost_mean, cost_m2,
              latency_n, latency_mean, latency_m2
         FROM ${ROUTING_ARMS_TABLE}
        WHERE id = ?
        LIMIT 1`,
    )
    .bind(id)
    .first()
    .catch(() => null);
}

export async function findGlobalRoutingArm(db, input = {}) {
  const modelKey = text(input.modelKey);
  const taskType = text(input.taskType);
  const mode = text(input.mode);
  if (!db || !modelKey || !taskType) return null;

  const modeClause = mode ? ' AND mode = ?' : '';
  const binds = mode ? [modelKey, taskType, mode] : [modelKey, taskType];
  return db
    .prepare(
      `SELECT id, workspace_id, task_type, mode, model_key, provider,
              success_alpha, success_beta, cost_n, cost_mean, cost_m2,
              latency_n, latency_mean, latency_m2
         FROM ${ROUTING_ARMS_TABLE}
        WHERE model_key = ?
          AND COALESCE(TRIM(workspace_id), '') = ''
          AND task_type = ?${modeClause}
          AND is_paused = 0
        ORDER BY is_active DESC, is_eligible DESC, updated_at DESC
        LIMIT 1`,
    )
    .bind(...binds)
    .first()
    .catch(() => null);
}
