/**
 * Step 3 — active project context with 2000-char budget (constraints preserved first).
 */

import { pragmaTableInfo } from '../../backend/services/retention.js';

const CHAR_BUDGET = 2000;

/**
 * @param {any} env
 * @param {string} workspaceId
 */
export async function loadProjectContextSystemBlock(env, workspaceId) {
  const ws = String(workspaceId || '').trim();
  if (!env?.DB || !ws) return '';

  const cols = await pragmaTableInfo(env.DB, 'agentsam_project_context');
  if (!cols.size) return '';

  try {
    const row = await env.DB.prepare(
      `SELECT project_name, project_key, description, goals, constraints, current_blockers
       FROM agentsam_project_context
       WHERE workspace_id = ? AND status = 'active'
       ORDER BY COALESCE(priority, 0) DESC, COALESCE(updated_at, 0) DESC
       LIMIT 1`,
    )
      .bind(ws)
      .first();

    if (!row) return '';

    const constraints = String(row.constraints || '').trim();
    const goals = String(row.goals || '').trim();
    const description = String(row.description || '').trim();
    const blockers = String(row.current_blockers || '').trim();
    const header = row.project_name
      ? `Project: ${row.project_name}${row.project_key ? ` (${row.project_key})` : ''}`
      : String(row.project_key || 'Active project');

    const parts = [header];
    if (constraints) parts.push(`Constraints: ${constraints}`);
    if (goals) parts.push(`Goals: ${goals}`);
    if (description) parts.push(description);
    if (blockers) parts.push(`Blockers: ${blockers}`);

    let body = parts.join('\n');
    if (body.length <= CHAR_BUDGET) {
      return `## Project context\n${body}`;
    }

    const fixed = [header];
    if (constraints) fixed.push(`Constraints: ${constraints}`);
    let trimmed = fixed.join('\n');
    const room = CHAR_BUDGET - trimmed.length - 2;
    if (room > 80 && goals) {
      const g = goals.length > room ? `${goals.slice(0, room - 3)}...` : goals;
      trimmed += `\nGoals: ${g}`;
    }
    if (trimmed.length < CHAR_BUDGET - 40 && description) {
      const room2 = CHAR_BUDGET - trimmed.length - 1;
      const d = description.length > room2 ? `${description.slice(0, room2 - 3)}...` : description;
      trimmed += `\n${d}`;
    }
    return `## Project context\n${trimmed.slice(0, CHAR_BUDGET)}`;
  } catch (e) {
    console.warn('[project-context-budget]', e?.message ?? e);
    return '';
  }
}
