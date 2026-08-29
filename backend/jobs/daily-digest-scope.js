/**
 * Per-recipient isolation for daily memory / focus emails.
 * Every digest is tenant + workspace scoped.
 */

import { resolveFirstMembershipWorkspaceId } from '../identity/index.js';

/**
 * @typedef {Object} DailyDigestScope
 * @property {string} userId
 * @property {string|null} email
 * @property {string|null} tenantId
 * @property {string[]} workspaceIds
 */

/**
 * Resolve digest boundaries for one recipient. Never infer cross-tenant access here.
 * @param {*} env
 * @param {{ userId?: string|null, email?: string|null }} owner
 * @returns {Promise<DailyDigestScope>}
 */
export async function resolveDailyDigestScope(env, owner) {
  const userId = String(owner?.userId || '').trim();
  if (!userId || !env?.DB) {
    return { userId: '', email: null, tenantId: null, workspaceIds: [] };
  }

  const userRow = await env.DB.prepare(
    `SELECT email,
            COALESCE(NULLIF(trim(active_tenant_id), ''), NULLIF(trim(tenant_id), '')) AS tenant_id
     FROM auth_users WHERE id = ? LIMIT 1`,
  ).bind(userId).first().catch(() => null);

  const tenantId = userRow?.tenant_id ? String(userRow.tenant_id).trim() : null;
  const email = userRow?.email ? String(userRow.email).trim().toLowerCase() : null;

  const { results: memberRows } = await env.DB.prepare(
    `SELECT workspace_id FROM memberships WHERE account_id = ? ORDER BY joined_at ASC`,
  ).bind(userId).all().catch(() => ({ results: [] }));

  const workspaceIds = [...new Set(
    (memberRows || []).map((r) => String(r.workspace_id || '').trim()).filter(Boolean),
  )];

  if (!workspaceIds.length) {
    const fallbackWs = await resolveFirstMembershipWorkspaceId(env, userId);
    if (fallbackWs) workspaceIds.push(fallbackWs);
  }

  if (!workspaceIds.length && tenantId) {
    const { results: wsRows } = await env.DB.prepare(
      `SELECT id FROM agentsam_workspace
       WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1
       ORDER BY updated_at DESC LIMIT 3`,
    ).bind(tenantId).all().catch(() => ({ results: [] }));
    for (const row of wsRows || []) {
      const wid = String(row.id || '').trim();
      if (wid) workspaceIds.push(wid);
    }
  }

  return { userId, email, tenantId, workspaceIds };
}

/**
 * @param {string[]} workspaceIds
 * @param {string} [column]
 */
export function workspaceIdInSql(workspaceIds, column = 'workspace_id') {
  const ids = (workspaceIds || []).map((x) => String(x || '').trim()).filter(Boolean);
  if (!ids.length) return { clause: '1=0', binds: [] };
  return { clause: `${column} IN (${ids.map(() => '?').join(',')})`, binds: ids };
}

const EMPTY_ALL = { results: [] };

/**
 * Context JSON fed to synthesis. Only tenant/workspace-scoped fields are exposed.
 * @param {object} ctxData
 * @param {DailyDigestScope} scope
 */
export function digestContextJson(ctxData, scope) {
  return JSON.stringify({
    digestMode: 'workspace',
    tenantId: scope?.tenantId || null,
    workspaceIds: scope?.workspaceIds || [],
    memory: ctxData.memoryRows?.results || [],
    workspaceProjects: ctxData.clientCtxRows?.results || [],
    activeBlockers: ctxData.activeBlockers || [],
    agentCompletion: ctxData.agentCompletion || {},
    escalationsRecent: ctxData.escalationsRecent?.results || [],
    planTasks: ctxData.planTasks?.results || [],
    openTodosByProject: ctxData.openTodosByProject?.results || [],
    chronicBlockers: ctxData.chronicBlockers?.results || [],
    calendarUpcoming: ctxData.calendarUpcoming?.results || [],
    taskActivityRecent: ctxData.taskActivityRecent?.results || [],
    trackedTimeToday: ctxData.trackedTimeToday || {},
    recentRuns: ctxData.recentRuns || {},
    mcpActivity: ctxData.mcpActivity?.results || [],
    usageToday: ctxData.usageToday || {},
    usage7d: ctxData.usage7d || {},
    dailyCodeActivity: ctxData.dailyCodeActivity || { available: false, reason: 'not_collected' },
  });
}

export { EMPTY_ALL };
