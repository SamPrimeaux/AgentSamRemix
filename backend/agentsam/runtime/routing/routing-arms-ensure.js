/**
 * Ensure a global observed-model routing arm exists for learning.
 * Picker / Path B / failures must not bypass Thompson just because no arm was pre-seeded.
 */

import { resolveThompsonArmTaskType } from './resolve-model-task-types.js';
const ARMS = 'agentsam_routing_arms';
/** Optimistic prior — new observed arms are not dead on arrival. */
const NEUTRAL_ALPHA = 2.0;
const NEUTRAL_BETA = 1.0;

/**
 * Find-or-create global arm: empty workspace_id + empty agent_slug + (model_key, task_type, mode).
 * Does not clone per-workspace. Safe to call on every reward / Path B resolve.
 *
 * @param {any} env
 * @param {{
 *   modelKey: string,
 *   taskType?: string|null,
 *   mode?: string|null,
 *   provider?: string|null,
 * }} opts
 * @returns {Promise<{ ok: boolean, armId: string|null, created: boolean, reason?: string }>}
 */
export async function ensureObservedModelRoutingArm(env, opts = {}) {
  const db = env?.DB;
  const modelKey = opts.modelKey != null ? String(opts.modelKey).trim() : '';
  if (!db || !modelKey) {
    return { ok: false, armId: null, created: false, reason: 'model_key_required' };
  }

  const taskType = resolveThompsonArmTaskType(
    opts.taskType != null && String(opts.taskType).trim() !== ''
      ? String(opts.taskType).trim()
      : 'agent',
  );
  const mode =
    opts.mode != null && String(opts.mode).trim() !== ''
      ? String(opts.mode).trim()
      : 'agent';

  const schema = await db
    .prepare(`PRAGMA table_info(${ARMS})`)
    .all()
    .catch(() => ({ results: [] }));
  const cols = new Set(
    (schema?.results || [])
      .map((column) => String(column?.name || '').trim().toLowerCase())
      .filter(Boolean),
  );
  if (!cols.has('model_key') || !cols.has('task_type') || !cols.has('mode')) {
    return { ok: false, armId: null, created: false, reason: 'arms_schema_incomplete' };
  }

  const hasAgentSlug = cols.has('agent_slug');
  const existingSql = hasAgentSlug
    ? `SELECT id FROM ${ARMS}
        WHERE model_key = ?
          AND task_type = ?
          AND mode = ?
          AND COALESCE(TRIM(workspace_id), '') = ''
          AND COALESCE(agent_slug, '') = ''
        ORDER BY is_active DESC, is_eligible DESC, updated_at DESC
        LIMIT 1`
    : `SELECT id FROM ${ARMS}
        WHERE model_key = ?
          AND task_type = ?
          AND mode = ?
          AND COALESCE(TRIM(workspace_id), '') = ''
        ORDER BY is_active DESC, is_eligible DESC, updated_at DESC
        LIMIT 1`;

  const existing = await db
    .prepare(existingSql)
    .bind(modelKey, taskType, mode)
    .first()
    .catch(() => null);
  if (existing?.id) {
    return { ok: true, armId: String(existing.id).trim(), created: false };
  }

  let provider =
    opts.provider != null && String(opts.provider).trim() !== ''
      ? String(opts.provider).trim().slice(0, 80)
      : '';
  if (!provider) {
    try {
      const cat = await db
        .prepare(
          `SELECT provider FROM agentsam_model_catalog WHERE model_key = ? AND is_active = 1 LIMIT 1`,
        )
        .bind(modelKey)
        .first();
      if (cat?.provider) provider = String(cat.provider).trim();
    } catch {
      /* keep empty */
    }
  }
  if (!provider) provider = 'unknown';

  const armId = `ra_obs_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  try {
    if (hasAgentSlug) {
      await db
        .prepare(
          `INSERT INTO ${ARMS} (
            id, workspace_id, task_type, mode, model_key, provider, agent_slug,
            success_alpha, success_beta, is_active, is_eligible, is_paused,
            decayed_score, priority, total_executions, updated_at
          ) VALUES (?, '', ?, ?, ?, ?, '', ?, ?, 1, 1, 0, 0.5, 55, 0, unixepoch())`,
        )
        .bind(armId, taskType, mode, modelKey, provider, NEUTRAL_ALPHA, NEUTRAL_BETA)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO ${ARMS} (
            id, workspace_id, task_type, mode, model_key, provider,
            success_alpha, success_beta, is_active, is_eligible, is_paused,
            decayed_score, priority, total_executions, updated_at
          ) VALUES (?, '', ?, ?, ?, ?, ?, ?, 1, 1, 0, 0.5, 55, 0, unixepoch())`,
        )
        .bind(armId, taskType, mode, modelKey, provider, NEUTRAL_ALPHA, NEUTRAL_BETA)
        .run();
    }
  } catch (e) {
    // Race: another isolate inserted first — re-select.
    const raced = await db
      .prepare(existingSql)
      .bind(modelKey, taskType, mode)
      .first()
      .catch(() => null);
    if (raced?.id) {
      return { ok: true, armId: String(raced.id).trim(), created: false };
    }
    console.warn('[routing-arms-ensure] insert_failed', {
      modelKey,
      taskType,
      mode,
      error: e?.message ?? e,
    });
    return { ok: false, armId: null, created: false, reason: 'insert_failed' };
  }

  console.info('[routing-arms-ensure] created_observed_arm', {
    armId,
    modelKey,
    taskType,
    mode,
    provider,
  });
  return { ok: true, armId, created: true };
}
