/**
 * Prompt route resolution for runtime-profile compile.
 */
import { messageHasBrowserUrlNavigation } from '../../backend/http/agentsam/routes/classify-intent.js';

/** No JS tool-name presets. Tool menus come from bound D1 profiles. */
const AUGMENTATION_EXEMPT_ROUTES = new Set();

/**
 * Mode owns tooling — no message regex classifiers.
 * @param {string} mode
 * @param {string} _message
 */
export function agentLikeTooling(mode, _message) {
  return (
    mode === 'ask' ||
    mode === 'agent' ||
    mode === 'debug' ||
    mode === 'multitask' ||
    mode === 'plan'
  );
}

/**
 * @param {string} mode
 */
function executionModeLocksRouteKey(mode) {
  return (
    mode === 'agent' || mode === 'multitask' || mode === 'debug' || mode === 'plan'
  );
}

/**
 * Context policy from agentsam_prompt_routes only — no JS invent-true defaults.
 * Missing row / null columns → fail closed (all false).
 * @param {any} promptRouteRow
 */
export function contextPolicyFromPromptRoute(promptRouteRow) {
  if (!promptRouteRow || typeof promptRouteRow !== 'object') {
    return {
      include_rag: false,
      include_memory: false,
      include_workspace: false,
      fresh_thread_recommended: false,
    };
  }
  return {
    include_rag:
      promptRouteRow.include_rag == null ? false : Number(promptRouteRow.include_rag) !== 0,
    include_memory:
      promptRouteRow.include_recent_memory == null
        ? false
        : Number(promptRouteRow.include_recent_memory) !== 0,
    include_workspace:
      promptRouteRow.include_workspace_ctx == null
        ? false
        : Number(promptRouteRow.include_workspace_ctx) !== 0,
    fresh_thread_recommended:
      promptRouteRow.fresh_thread_recommended == null
        ? false
        : Number(promptRouteRow.fresh_thread_recommended) !== 0,
  };
}

/**
 * @param {any} env
 * @param {{ tenantId?: string|null, mode: string, taskType: string }} q
 */
async function resolvePromptRouteRow(env, q) {
  if (!env?.DB) return null;
  const tid = q.tenantId != null ? String(q.tenantId).trim() : '';
  const mode = String(q.mode || '').trim();
  const taskType = String(q.taskType || '').trim();
  const routeByKeySql = `
      SELECT r.*
      FROM agentsam_prompt_routes r
      WHERE r.route_key = ?
        AND r.is_active = 1
        AND (r.tenant_id IS NULL OR r.tenant_id = ?)
      ORDER BY CASE WHEN r.tenant_id IS NOT NULL THEN 0 ELSE 1 END,
               COALESCE(r.priority, 0) ASC
      LIMIT 1
    `;
  try {
    if (mode) {
      const modeRoute = await env.DB.prepare(routeByKeySql).bind(mode, tid).first();
      if (modeRoute) return modeRoute;
    }
    if (taskType && taskType !== mode) {
      const taskRoute = await env.DB.prepare(routeByKeySql).bind(taskType, tid).first();
      if (taskRoute) return taskRoute;
    }
    return null;
  } catch (e) {
    console.warn('[runtime-profile] prompt_route', e?.message ?? e);
    return null;
  }
}

/**
 * Runtime profile routing_task_type — mode profile only (not classifier labels).
 * Model pick + tool bindings key off execution mode, not predetermined work intents.
 * @param {string} composerMode
 * @param {string} [_classifiedTaskType] retained for call-site compatibility
 * @param {boolean} [_hasExplicitTaskTypeOverride] ignored — mode profile wins
 */
export function resolveComposerRoutingTaskType(
  composerMode,
  _classifiedTaskType,
  _hasExplicitTaskTypeOverride = false,
) {
  return String(composerMode || 'agent').trim().toLowerCase();
}

/**
 * @param {any} env
 * @param {string|null|undefined} tenantId
 * @param {string} routeKey
 */
async function loadPromptRouteRowByKey(env, tenantId, routeKey) {
  if (!env?.DB || !routeKey) return null;
  try {
    return await env.DB.prepare(
      `SELECT * FROM agentsam_prompt_routes
       WHERE route_key = ?
         AND is_active = 1
         AND (tenant_id = ? OR tenant_id IS NULL)
       ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END, priority ASC
       LIMIT 1`,
    )
      .bind(routeKey, tenantId, tenantId)
      .first();
  } catch (_) {
    return null;
  }
}

/**
 * @param {any} env
 * @param {{ tenantId?: string|null, mode: string, taskType: string, message: string, routeKeyPin?: string|null }} q
 */
export async function resolvePromptRouteForCompile(env, q) {
  const mode = String(q.mode || 'agent').toLowerCase();
  const message = String(q.message || '');
  const taskType = String(q.taskType || '').trim().toLowerCase();
  let refinedRouteKey = null;
  const routePin = q.routeKeyPin != null ? String(q.routeKeyPin).trim() : '';

  // Quickstart cards and API route_key pins must win over mode-locked agent/multitask routes.
  if (routePin) {
    const exemptPin = AUGMENTATION_EXEMPT_ROUTES.has(routePin) || AUGMENTATION_EXEMPT_ROUTES.has(taskType);
    if (exemptPin) {
      const pinnedRow = env?.DB ? await loadPromptRouteRowByKey(env, q.tenantId, routePin) : null;
      return { row: pinnedRow, refinedRouteKey: routePin };
    }
    const pinnedRow = env?.DB ? await loadPromptRouteRowByKey(env, q.tenantId, routePin) : null;
    if (pinnedRow) {
      return { row: pinnedRow, refinedRouteKey: String(pinnedRow.route_key || routePin) };
    }
  }

  if (executionModeLocksRouteKey(mode)) {
    if (taskType && taskType !== mode) {
      const taskRow = await loadPromptRouteRowByKey(env, q.tenantId, taskType);
      if (taskRow) return { row: taskRow, refinedRouteKey: taskType };
    }
    const row = await loadPromptRouteRowByKey(env, q.tenantId, mode);
    return { row, refinedRouteKey: mode };
  }

  if (q.routeKeyPin && env?.DB) {
    try {
      const pinned = await env.DB.prepare(
        `SELECT * FROM agentsam_prompt_routes
         WHERE route_key = ?
           AND is_active = 1
           AND (tenant_id = ? OR tenant_id IS NULL)
         ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END, priority ASC
         LIMIT 1`,
      )
        .bind(String(q.routeKeyPin).trim(), q.tenantId, q.tenantId)
        .first();
      if (pinned) return { row: pinned, refinedRouteKey: String(pinned.route_key || q.routeKeyPin) };
    } catch (_) {
      /* non-fatal */
    }
  }

  let row = await resolvePromptRouteRow(env, {
    tenantId: q.tenantId,
    mode,
    taskType: q.taskType,
  });

  const needsBrowserRoute = messageHasBrowserUrlNavigation(message);
  if (needsBrowserRoute && row?.route_key !== 'browser' && env?.DB) {
    try {
      const browserRow = await env.DB.prepare(
        `SELECT r.*
         FROM agentsam_prompt_routes r
         WHERE r.route_key = 'browser'
           AND r.is_active = 1
           AND (r.tenant_id IS NULL OR r.tenant_id = ?)
         ORDER BY CASE WHEN r.tenant_id IS NOT NULL THEN 0 ELSE 1 END,
                  COALESCE(r.priority, 0) ASC
         LIMIT 1`,
      )
        .bind(q.tenantId != null ? String(q.tenantId).trim() : '')
        .first();
      if (browserRow) {
        row = browserRow;
        refinedRouteKey = 'browser';
      }
    } catch (_) {
      /* non-fatal */
    }
  }

  const tooling = agentLikeTooling(mode, message);

  if (!refinedRouteKey && row?.route_key) refinedRouteKey = String(row.route_key);
  if (!refinedRouteKey && q.routeKeyPin) refinedRouteKey = String(q.routeKeyPin).trim();
  return { row, refinedRouteKey };
}
