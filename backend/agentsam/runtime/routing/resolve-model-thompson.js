/**
 * Thompson arm selector (Path C) + global policy arm query (Path D).
 */

import { betaSample } from './resolve-model-beta.js';
import {
  THOMPSON_CANDIDATE_LIMIT,
  diversifyArmsForThompsonDraw,
  preferGlobalArmPerModelKey,
  applyForcedExplorationFloor,
} from './resolve-model-arms.js';
import {
  filterCandidatesByModelHealth,
  loadModelHealthMap,
} from './model-health.js';

/**
 * @param {D1Database} db
 * @param {{ task_type: string, mode: string, workspace_id?: string|null, require_tools?: boolean, require_vision?: boolean }} q
 */
export async function selectThompsonArm(db, {
  task_type,
  mode,
  workspace_id,
  require_tools,
  require_vision = false,
}) {
  const wsId = workspace_id ?? '';
  const tt = String(task_type || '').trim().toLowerCase();
  const md = String(mode || '').trim().toLowerCase();
  if (!tt || !md) return null;
  return _selectThompsonArmOnce(db, {
    task_type: tt,
    mode: md,
    workspace_id: wsId,
    require_tools,
    require_vision,
  });
}

async function _selectThompsonArmOnce(db, {
  task_type,
  mode,
  workspace_id,
  require_tools,
  require_vision = false,
}) {
  const fetchLimit = Math.max(THOMPSON_CANDIDATE_LIMIT * 4, 24);
  // Workspace is NOT a bandit/eligibility dimension — but model_health uses it
  // for BYOK/quota circuit-breaking before the Thompson draw.
  const { results: arms } = await db
    .prepare(
      `
    SELECT
      ra.id,
      ra.model_key,
      ra.reasoning_effort,
      ra.success_alpha,
      ra.success_beta,
      ra.decayed_score,
      ra.priority,
      ra.workspace_id,
      mc.provider
    FROM agentsam_routing_arms ra
    INNER JOIN agentsam_model_catalog mc
      ON mc.model_key = ra.model_key
     AND mc.is_active = 1
     AND mc.is_degraded = 0
     AND mc.budget_exhausted = 0
    WHERE ra.task_type = ?
      AND ra.mode      = ?
      AND COALESCE(TRIM(ra.workspace_id), '') = ''
      AND ra.is_active  = 1
      AND ra.is_eligible = 1
      AND ra.is_paused   = 0
      AND ra.budget_exhausted = 0
      ${require_tools ? 'AND mc.supports_tools = 1' : ''}
      ${require_vision ? 'AND mc.supports_vision = 1' : ''}
    ORDER BY
      ra.priority DESC,
      ra.decayed_score DESC
    LIMIT ${fetchLimit}
  `,
    )
    .bind(task_type, mode)
    .all()
    .catch(() => ({ results: [] }));

  if (!arms || arms.length === 0) return null;

  const healthMap = await loadModelHealthMap(db, workspace_id);
  const healthyArms = filterCandidatesByModelHealth(arms, healthMap, workspace_id);
  if (!healthyArms.length) return null;

  const globalFirst = preferGlobalArmPerModelKey(healthyArms);
  const pool = diversifyArmsForThompsonDraw(globalFirst, THOMPSON_CANDIDATE_LIMIT);

  let ranked = pool
    .map((arm) => ({
      ...arm,
      draw: betaSample(Number(arm.success_alpha) || 1, Number(arm.success_beta) || 1),
    }))
    .sort((a, b) => b.draw - a.draw);

  ranked = applyForcedExplorationFloor(ranked);
  return ranked;
}

/**
 * Global policy query (Path D) — workspace-agnostic arms, data-driven only.
 * Skips models currently unavailable in agentsam_model_health.
 */
export async function queryGlobalPolicyArm(db, { task_type, mode, require_tools, workspace_id = null }) {
  const tt = String(task_type || '').trim().toLowerCase();
  const md = String(mode || '').trim().toLowerCase();
  if (!tt || !md) return null;

  const fetchLimit = 12;
  const { results: arms } = await db
    .prepare(
      `
        SELECT ra.id, ra.model_key
        FROM agentsam_routing_arms ra
        INNER JOIN agentsam_model_catalog mc
          ON mc.model_key = ra.model_key
         AND mc.is_active = 1
         AND mc.is_degraded = 0
        WHERE ra.task_type = ?
          AND ra.mode = ?
          AND COALESCE(TRIM(ra.workspace_id), '') = ''
          AND ra.is_active = 1
          AND ra.is_eligible = 1
          AND ra.is_paused = 0
          AND ra.budget_exhausted = 0
          ${require_tools ? 'AND mc.supports_tools = 1' : ''}
        ORDER BY
          ra.priority DESC,
          ra.decayed_score DESC
        LIMIT ${fetchLimit}
      `,
    )
    .bind(tt, md)
    .all()
    .catch(() => ({ results: [] }));

  if (!arms?.length) return null;

  const healthMap = await loadModelHealthMap(db, workspace_id);
  const healthy = filterCandidatesByModelHealth(arms, healthMap, workspace_id);
  return healthy[0] ?? null;
}
