/**
 * Workspace project context + rules injection helpers for buildSystemPrompt.
 */
import { pragmaTableInfo } from '../../services/retention.js';

function estimateTokens(text) {
  const s = String(text || '');
  return s ? Math.max(1, Math.ceil(s.length / 4)) : 0;
}

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Load curated context for one explicitly identified project.
 *
 * Project scope is not prompt material. Callers must provide projectRef/projectKey;
 * this helper never derives a workspace-primary or dashboard-active fallback.
 *
 * @param {any} env
 * @param {{
 *   workspaceId?: string | null,
 *   tenantId?: string | null,
 *   limit?: number,
 *   projectId?: string | null,
 *   projectRef?: string | null,
 *   projectKey?: string | null,
 * }} opts
 */
export async function fetchActiveProjectContextBlocks(env, opts = {}) {
  if (!env?.DB) return [];
  const ws = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  if (!ws) return [];
  const limit = Math.min(Math.max(1, Number(opts.limit) || 3), 5);
  const projectRef = trim(opts.projectId || opts.projectRef || opts.project_id || '');
  const projectKeyOpt = trim(opts.projectKey || opts.project_key || '');
  if (!projectRef && !projectKeyOpt) return [];

  try {
    const cols = await pragmaTableInfo(env.DB, 'agentsam_project_context');
    const orderBy = cols.has('updated_at')
      ? 'COALESCE(priority, 0) DESC, updated_at DESC'
      : cols.has('created_at')
        ? 'COALESCE(priority, 0) DESC, created_at DESC'
        : 'COALESCE(priority, 0) DESC';

    const where = [
      `status = 'active'`,
      `workspace_id = ?`,
      `COALESCE(project_type, '') NOT IN ('bootstrap_cache')`,
      `COALESCE(project_key, '') NOT IN ('agent_bootstrap')`,
      // Federated launcher hubs — never ambient in chat without an explicit project.
      `id NOT LIKE 'ctx_cms_hub_%'`,
    ];
    const binds = [ws];

    if (projectRef || projectKeyOpt) {
      const keys = [];
      if (projectRef) keys.push(projectRef);
      if (projectKeyOpt) keys.push(projectKeyOpt);
      const uniq = [...new Set(keys)];
      where.push(
        `(${uniq.map(() => 'project_key = ? OR id = ?').join(' OR ')})`,
      );
      for (const k of uniq) {
        binds.push(k, k);
      }
    } else if (primaryKey) {
      // Fresh chat / no project selected: only the workspace's own spine.
      where.push(`(project_key = ? OR id = ?)`);
      binds.push(primaryKey, `ctx_${primaryKey}`);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, project_name, project_key, description, goals, constraints,
              current_blockers, priority, status
       FROM agentsam_project_context
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ${limit}`,
    )
      .bind(...binds)
      .all();
    return (results || []).map((r) => {
      const parts = [
        r.project_name ? `**${r.project_name}** (${r.project_key || r.id})` : r.project_key,
        r.description,
        r.goals ? `Goals: ${r.goals}` : null,
        r.constraints ? `Constraints: ${r.constraints}` : null,
        r.current_blockers ? `Blockers: ${r.current_blockers}` : null,
      ].filter(Boolean);
      return {
        id: String(r.id),
        text: parts.join('\n'),
        tokenEstimate: estimateTokens(parts.join('\n')),
      };
    });
  } catch (e) {
    console.warn('[agent-prompt-context] project_context', e?.message ?? e);
    return [];
  }
}

/**
 * @param {any} env
 * @param {Array<{ id: string, tokenEstimate: number }>} blocks
 */
export async function bumpProjectContextTokensUsed(env, blocks) {
  if (!env?.DB || !blocks?.length) return;
  const cols = await pragmaTableInfo(env.DB, 'agentsam_project_context');
  const touchCol = cols.has('updated_at')
    ? 'updated_at = unixepoch()'
    : cols.has('updated_at_unix')
      ? 'updated_at_unix = unixepoch()'
      : null;
  for (const b of blocks) {
    const delta = Math.max(0, Math.floor(Number(b.tokenEstimate) || 0));
    if (!delta || !b.id) continue;
    const sets = [`tokens_used = MIN(COALESCE(tokens_used, 0) + ?, 1000000)`];
    if (touchCol) sets.push(touchCol);
    await env.DB.prepare(
      `UPDATE agentsam_project_context SET ${sets.join(', ')} WHERE id = ?`,
    )
      .bind(delta, b.id)
      .run()
      .catch(() => {});
  }
}

/**
 * @param {any} env
 * @param {string} systemPrompt
 * @param {{ workspaceId?: string | null, tenantId?: string | null, projectId?: string | null, projectRef?: string | null, projectKey?: string | null }} opts
 */
export async function appendActiveProjectsToSystemPrompt(env, systemPrompt, opts = {}) {
  const blocks = await fetchActiveProjectContextBlocks(env, opts);
  if (!blocks.length) return systemPrompt;
  const body = blocks.map((b) => b.text).join('\n\n');
  if (body.trim()) {
    void bumpProjectContextTokensUsed(env, blocks);
  }
  return `${systemPrompt}\n\n## Active Projects\n${body}\n`;
}
