/**
 * Project context audit — list projects with workspace bindings, memory, and runtime contract rows.
 * For /dashboard/projects admin view (cleanup + per-project alignment).
 */
import { normalizeWorkspaceBindings, resolveWorkspaceBindings } from '../../backend/identity/workspace/agentsam-workspace.js';
import { readProjectDashboardMemory } from './project-dashboard-memory.js';
import {
  fetchProjectRuntimeContractRule,
  projectRuntimeContractRuleKeyFromProjectId,
  resolveProjectRuntimeContractRuleKey,
} from './project-runtime-contract.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} projectRow
 */
async function auditOneProject(env, projectRow) {
  const id = trim(projectRow.id);
  if (!id) return null;

  const workspaceId = trim(projectRow.workspace_id);
  const ruleKey = projectRuntimeContractRuleKeyFromProjectId(id);
  const expectedRuleKey = await resolveProjectRuntimeContractRuleKey(env, id, workspaceId || null);

  const [bindingsRaw, memory, ruleRow, ctxRow] = await Promise.all([
    resolveWorkspaceBindings(env, id).catch(() => null),
    readProjectDashboardMemory(env.DB, id).catch(() => ({
      memory: '',
      instructions: '',
      updated_at: null,
    })),
    fetchProjectRuntimeContractRule(env, { projectRef: id, workspaceId: workspaceId || null }).catch(
      () => null,
    ),
    env.DB.prepare(
      `SELECT id, project_key, status FROM agentsam_project_context
       WHERE project_key = ? OR workspace_id = ?
       ORDER BY COALESCE(updated_at, 0) DESC LIMIT 1`,
    )
      .bind(id, workspaceId || '')
      .first()
      .catch(() => null),
  ]);

  const bindings = normalizeWorkspaceBindings(bindingsRaw, env);

  return {
    id,
    name: trim(projectRow.name) || id,
    status: trim(projectRow.status) || null,
    project_type: trim(projectRow.project_type) || null,
    workspace_id: workspaceId || null,
    client_id: trim(projectRow.client_id) || null,
    worker_id: trim(projectRow.worker_id) || null,
    domain: trim(projectRow.domain) || null,
    rule_key: expectedRuleKey || ruleKey,
    rule_synced: Boolean(ruleRow?.body_markdown),
    rule_project_id: ruleRow?.project_id ? String(ruleRow.project_id) : null,
    rule_body_chars: ruleRow?.body_markdown ? String(ruleRow.body_markdown).length : 0,
    memory_chars: memory.memory ? memory.memory.length : 0,
    instructions_chars: memory.instructions ? memory.instructions.length : 0,
    memory_updated_at: memory.updated_at ?? null,
    agentsam_context_id: ctxRow?.id ? String(ctxRow.id) : null,
    agentsam_context_key: ctxRow?.project_key ? String(ctxRow.project_key) : null,
    bindings: bindings
      ? {
          workspace_slug: bindings.slug,
          worker_name: bindings.workerName,
          r2_bucket: bindings.r2Bucket,
          r2_prefix: bindings.r2Prefix,
          d1_database_id: bindings.d1DatabaseId,
          github_repo: bindings.githubRepo,
          deploy_url: bindings.deployUrl,
        }
      : null,
  };
}

/**
 * @param {any} env
 * @param {{ projectRows: Record<string, unknown>[] }} opts
 */
export async function buildProjectContextAudit(env, opts) {
  const rows = Array.isArray(opts.projectRows) ? opts.projectRows : [];
  const out = [];
  for (const row of rows) {
    const audited = await auditOneProject(env, row);
    if (audited) out.push(audited);
  }
  return out;
}
