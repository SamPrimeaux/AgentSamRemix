/**
 * Legacy routing_decisions writer (D1). Chat now persists `routing_arm_id` on `agentsam_agent_run`
 * and telemetry on `agentsam_usage_events` — avoid new callers; table is read-only / deprecated.
 */

import { pragmaTableInfo } from '../../backend/services/retention.js';

const RULE_SOURCE = 'agentsam_routing_arms';

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   workspaceId: string,
 *   tenantId: string,
 *   sessionId?: string | null,
 *   routingArmId?: string | null,
 *   armTaskType: string,
 *   modelKey: string,
 *   provider?: string | null,
 *   taskTypeColumn?: string,
 * }} o
 * @returns {string | null} decision id (generated); null if skipped
 */
export function scheduleInsertRoutingDecision(env, ctx, o) {
  if (!env?.DB || !ctx?.waitUntil) return null;
  const ws = o.workspaceId != null ? String(o.workspaceId).trim() : '';
  const tid = o.tenantId != null ? String(o.tenantId).trim() : '';
  const mk = o.modelKey != null ? String(o.modelKey).trim() : '';
  const armTask = o.armTaskType != null ? String(o.armTaskType).trim() : '';
  if (!ws || !tid || !mk || !armTask) return null;

  const id = `rd_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  ctx.waitUntil(
    (async () => {
      const cols = await pragmaTableInfo(env.DB, 'routing_decisions');
      if (!cols.size) return;
      const parts = [];
      const binds = [];
      const add = (name, val) => {
        if (!cols.has(name)) return;
        parts.push(name);
        binds.push(val);
      };

      add('id', id);
      add('workspace_id', ws);
      add('tenant_id', tid);
      add('session_id', o.sessionId != null ? String(o.sessionId).slice(0, 200) : null);
      add('routing_arm_id', o.routingArmId != null ? String(o.routingArmId).slice(0, 120) : null);
      add('arm_task_type', armTask);
      if (cols.has('rule_source')) add('rule_source', RULE_SOURCE);
      const ttCol = cols.has('task_type') ? 'task_type' : cols.has('intent_slug') ? 'intent_slug' : null;
      if (ttCol) {
        parts.push(ttCol);
        binds.push(armTask);
      }
      if (cols.has('model_key')) add('model_key', mk);
      if (cols.has('model_selected')) add('model_selected', mk);
      if (cols.has('provider')) add('provider', o.provider != null ? String(o.provider).slice(0, 80) : null);
      if (cols.has('had_error')) add('had_error', 0);
      if (cols.has('completed')) add('completed', 0);
      if (cols.has('created_at')) {
        parts.push('created_at');
        binds.push(Math.floor(Date.now() / 1000));
      }

      if (parts.length < 3) return;
      try {
        await env.DB.prepare(
          `INSERT INTO routing_decisions (${parts.join(', ')}) VALUES (${parts.map(() => '?').join(', ')})`,
        )
          .bind(...binds)
          .run();
      } catch (e) {
        console.warn('[routing_decisions] insert', e?.message ?? e);
      }
    })(),
  );

  return id;
}
