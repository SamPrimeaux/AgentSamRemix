/**
 * Re-save plan markdown (+ optional map) to ARTIFACTS R2 — Cursor "Save to workspace".
 * Keys: user/{user_id}/plan/{artifact_id}.md via writeWorkspaceArtifact.
 *
 * SECURITY (isolation contract — do not weaken):
 * - This is a durable R2 (+ agentsam_artifacts D1) write scoped to the caller's own
 *   userId/tenantId/workspaceId. It NEVER git-commits, never writes via PTY or a
 *   bound `workspace_root` to a repo checkout on disk, and never touches Cursor's
 *   `plans/active/` files. "Save to workspace" means R2 ARTIFACTS, not "commit to repo".
 * - userId/tenantId/workspaceId here MUST be resolved server-side from the
 *   authenticated session (resolveRequestContext / authUserFromRequest in
 *   src/api/agent.js) — never pass values read from the request body. The route
 *   also re-verifies the plan row's tenant_id/workspace_id against session identity
 *   before calling this function; loadPlanAndTasksForArtifact (called via
 *   createPlanMarkdownArtifact/createPlanExcalidrawArtifact) re-checks it again here
 *   as defense in depth, and fails closed (throws) on any mismatch or missing ids —
 *   there is no cross-user / cross-workspace fallback path.
 */

import { createPlanMarkdownArtifact, createPlanExcalidrawArtifact } from './agentsam-plan-excalidraw-artifact.js';
import { planLocalRelPath } from './agentsam-plan-local-path.js';

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   planId: string,
 *   userId: string,
 *   tenantId: string,
 *   workspaceId: string,
 *   includeMap?: boolean,
 *   authUser?: Record<string, unknown>|null,
 *   sourceSessionId?: string|null,
 * }} opts
 */
export async function savePlanToWorkspaceArtifacts(env, ctx, opts) {
  const planId = String(opts?.planId || '').trim();
  const userId = String(opts?.userId || '').trim();
  const tenantId = String(opts?.tenantId || '').trim();
  const workspaceId = String(opts?.workspaceId || '').trim();
  if (!planId) throw new Error('plan_id required');
  if (!userId) throw new Error('user_id required');
  if (!tenantId) throw new Error('tenant_id required');
  if (!workspaceId) throw new Error('workspace_id required');

  const md = await createPlanMarkdownArtifact(
    env,
    {
      planId,
      userId,
      tenantId,
      workspaceId,
      sourceSessionId: opts.sourceSessionId ?? null,
      authUser: opts.authUser ?? null,
    },
    ctx,
  );

  let map = null;
  if (opts.includeMap !== false) {
    try {
      map = await createPlanExcalidrawArtifact(
        env,
        {
          planId,
          userId,
          tenantId,
          workspaceId,
          sourceSessionId: opts.sourceSessionId ?? null,
          authUser: opts.authUser ?? null,
        },
        ctx,
      );
    } catch (e) {
      console.warn('[plan-save-workspace] map_optional_failed', e?.message ?? e);
    }
  }

  return {
    ok: true,
    plan_id: planId,
    markdown: {
      artifact_id: md?.artifact_id ?? null,
      r2_key: md?.r2_key ?? null,
      public_url: md?.public_url ?? null,
      skipped_r2: Boolean(md?.skipped_r2),
      // Local FSA mirror path (jailed under .agentsam/ — see agentsam-plan-local-path.js).
      // Informational only: the client re-derives this from plan_id rather than
      // trusting this string for filesystem writes.
      path: planLocalRelPath(planId),
      content: md?.content ?? null,
    },
    plan_map: map
      ? {
          artifact_id: map.artifact_id ?? null,
          r2_key: map.r2_key ?? null,
          public_url: map.public_url ?? null,
          skipped_r2: Boolean(map.skipped_r2),
        }
      : null,
    bucket: 'artifacts',
    message: 'Plan saved to workspace ARTIFACTS (user/{user_id}/plan/…).',
  };
}
