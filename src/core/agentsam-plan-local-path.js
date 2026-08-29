/**
 * Local FSA relative path convention for Agent Sam plan markdown.
 *
 * Analogous to Cursor's `.cursor/` local plan fallback: plan markdown mirrors
 * to `.agentsam/plans/plan-{id}.md` under the user's connected Local folder
 * by default (safe local fallback, no durable write required). "Save to
 * workspace" persists the durable copy to R2 (see plan-save-workspace.js)
 * and the client mirrors the same relative path into the Local folder when
 * connected — both paths must agree so Monaco Save and the SSE auto-write
 * land on the same file.
 *
 * @param {string} planId
 * @returns {string}
 */
export function planLocalRelPath(planId) {
  const id = String(planId || '').trim();
  if (!id) throw new Error('plan_id required');
  return `.agentsam/plans/plan-${id}.md`;
}
