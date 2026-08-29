/**
 * Persist plan artifacts (Excalidraw JSON, Markdown) in ARTIFACTS bucket + agentsam_artifacts (D1).
 * Keys: user/{user_id}/plan/{artifact_id}.{ext}
 */

import { writeWorkspaceArtifact, ARTIFACT_WRITE_USER_ERROR } from './artifact-r2-store.js';

/**
 * Ownership gate for plan artifact writes (Save to Workspace / plan markdown export).
 * Fail closed: caller-supplied tenantId/workspaceId must be non-empty and match the
 * plan row exactly — never trust a client-supplied workspace_id to retarget another
 * tenant/workspace's plan. This must be the identity resolved server-side from the
 * session (see resolveRequestContext in src/core/auth.js), never from the request body.
 *
 * @param {any} env
 * @param {{ tenantId: string, workspaceId: string, userId: string, planId: string }} p
 */
async function loadPlanAndTasksForArtifact(env, p) {
  const tenantId = String(p.tenantId || '').trim();
  const workspaceId = String(p.workspaceId || '').trim();
  const planId = String(p.planId || '').trim();
  if (!tenantId || !workspaceId) throw new Error('tenant_id/workspace_id required');
  const plan = await env.DB.prepare(`SELECT * FROM agentsam_plans WHERE id = ? LIMIT 1`).bind(planId).first();
  if (!plan?.id) throw new Error('plan not found');
  if (String(plan.tenant_id || '').trim() !== tenantId) throw new Error('plan tenant mismatch');
  const planWs = String(plan.workspace_id || '').trim();
  if (!planWs || planWs !== workspaceId) throw new Error('plan workspace mismatch');
  const { results: taskRows } = await env.DB
    .prepare(`SELECT * FROM agentsam_plan_tasks WHERE plan_id = ? ORDER BY order_index ASC, id ASC`)
    .bind(planId)
    .all();
  const tasks = taskRows || [];
  return { plan, tasks };
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   userId: string,
 *   tenantId: string,
 *   workspaceId: string,
 *   planId: string,
 *   planTitle: string,
 *   body: string,
 *   artifactType: string,
 *   name: string,
 *   description: string,
 *   tags: string[],
 *   metadataKind: string,
 *   sourceRunId?: string|null,
 *   sourceSessionId?: string|null,
 *   authUser?: Record<string, unknown>|null,
 * }} row
 */
async function putR2AndInsertPlanArtifact(env, ctx, row) {
  const out = await writeWorkspaceArtifact(env, ctx, {
    userId: row.userId,
    tenantId: row.tenantId,
    workspaceId: row.workspaceId,
    content: row.body,
    artifactType: row.artifactType,
    name: row.name,
    description: row.description,
    source: 'agentsam_plan',
    kind: 'plan',
    scope: 'user',
    sourceRunId: row.sourceRunId ?? null,
    sourceSessionId: row.sourceSessionId ?? null,
    tags: row.tags,
    metadata: { plan_id: row.planId, kind: row.metadataKind },
    origin: env?.IAM_ORIGIN ?? null,
    authUser: row.authUser ?? null,
  });
  if (out.skipped_r2) {
    return {
      skipped_r2: true,
      content_base64: out.content_base64,
      content: row.body,
      plan_id: row.planId,
      user_message: out.user_message,
    };
  }
  if (!out.ok) {
    throw new Error(out.user_message || ARTIFACT_WRITE_USER_ERROR);
  }

  // Keep agentsam_plans.plan_md_url / plan_map_url in sync (daily pipeline already sets these;
  // chat createPlan historically wrote ARTIFACTS only — metrics looked like "no md").
  try {
    const url = String(out.public_url || out.open_url || '').trim();
    const key = String(out.r2_key || '').trim();
    const prefix = key.includes('/') ? key.slice(0, key.lastIndexOf('/') + 1) : null;
    if (url && row.metadataKind === 'plan_markdown') {
      await env.DB.prepare(
        `UPDATE agentsam_plans
         SET plan_md_url = ?, r2_prefix = COALESCE(?, r2_prefix), updated_at = unixepoch()
         WHERE id = ?`,
      )
        .bind(url, prefix, row.planId)
        .run();
    } else if (url && row.metadataKind === 'plan_map') {
      await env.DB.prepare(
        `UPDATE agentsam_plans
         SET plan_map_url = ?, r2_prefix = COALESCE(?, r2_prefix), updated_at = unixepoch()
         WHERE id = ?`,
      )
        .bind(url, prefix, row.planId)
        .run();
    }
  } catch (e) {
    console.warn('[plan-artifact] plan_url_sync_failed', e?.message ?? e);
  }

  return {
    artifact_id: out.artifact_id,
    r2_key: out.r2_key,
    public_url: out.public_url,
    open_url: out.open_url,
    plan_id: row.planId,
    content: row.body,
  };
}

/**
 * @param {any} env
 * @param {{ tenantId: string, workspaceId: string, userId: string, planId: string, sourceRunId?: string|null, sourceSessionId?: string|null, authUser?: Record<string, unknown>|null }} p
 * @param {any} [ctx]
 */
export async function createPlanExcalidrawArtifact(env, p, ctx = null) {
  if (!env?.DB) throw new Error('DB not available');
  const tenantId = String(p.tenantId || '').trim();
  const workspaceId = String(p.workspaceId || '').trim();
  const userId = String(p.userId || '').trim();
  const planId = String(p.planId || '').trim();
  if (!tenantId) throw new Error('tenant_id required');
  if (!workspaceId) throw new Error('workspace_id required');
  if (!userId) throw new Error('user_id required');
  if (!planId) throw new Error('plan_id required');

  const { buildExcalidrawPlanScene } = await import('./agentsam-excalidraw-plan.js');
  const { plan, tasks } = await loadPlanAndTasksForArtifact(env, p);
  const scene = buildExcalidrawPlanScene({ plan, tasks });
  const json = JSON.stringify(scene);
  const planTitle = String(plan.title || 'Plan').slice(0, 400);

  const out = await putR2AndInsertPlanArtifact(env, ctx, {
    userId,
    tenantId,
    workspaceId,
    planId,
    planTitle,
    body: json,
    artifactType: 'excalidraw',
    name: `${planTitle} - Plan Map`,
    description: `Excalidraw plan map for ${planId}`,
    tags: ['plan', 'excalidraw', 'agentsam'],
    metadataKind: 'plan_map',
    sourceRunId: p.sourceRunId ?? null,
    sourceSessionId: p.sourceSessionId ?? null,
    authUser: p.authUser ?? null,
  });
  if (out.skipped_r2) return { ...out, elements: Array.isArray(scene.elements) ? scene.elements : [] };
  return { ...out, elements: Array.isArray(scene.elements) ? scene.elements : [] };
}

/**
 * @param {any} env
 * @param {{ tenantId: string, workspaceId: string, userId: string, planId: string, sourceRunId?: string|null, sourceSessionId?: string|null, authUser?: Record<string, unknown>|null }} p
 * @param {any} [ctx]
 */
export async function createPlanMarkdownArtifact(env, p, ctx = null) {
  if (!env?.DB) throw new Error('DB not available');
  const tenantId = String(p.tenantId || '').trim();
  const workspaceId = String(p.workspaceId || '').trim();
  const userId = String(p.userId || '').trim();
  const planId = String(p.planId || '').trim();
  if (!tenantId) throw new Error('tenant_id required');
  if (!workspaceId) throw new Error('workspace_id required');
  if (!userId) throw new Error('user_id required');
  if (!planId) throw new Error('plan_id required');

  const { buildPlanMarkdown } = await import('./agentsam-plan-markdown.js');
  const { plan, tasks } = await loadPlanAndTasksForArtifact(env, p);
  const md = buildPlanMarkdown({ plan, tasks });
  const planTitle = String(plan.title || 'Plan').slice(0, 400);

  return putR2AndInsertPlanArtifact(env, ctx, {
    userId,
    tenantId,
    workspaceId,
    planId,
    planTitle,
    body: md,
    artifactType: 'markdown',
    name: `${planTitle} - Plan.md`,
    description: `Markdown plan export for ${planId}`,
    tags: ['plan', 'markdown', 'agentsam'],
    metadataKind: 'plan_markdown',
    sourceRunId: p.sourceRunId ?? null,
    sourceSessionId: p.sourceSessionId ?? null,
    authUser: p.authUser ?? null,
  });
}
