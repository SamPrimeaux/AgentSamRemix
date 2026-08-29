/**
 * Workspace chat scope — Cursor-style session anchor.
 * Binds agent context to the workspace the user selected (github_repo, r2_prefix, root_path),
 * with explicit precedence for per-turn overrides (open file, context envelope, client repo pick).
 */

import {
  getWorkspaceGithubRepo,
  resolveWorkspaceBindings,
} from '../../backend/identity/workspace/agentsam-workspace.js';
import { resolveWorkspaceR2Prefix } from '../../backend/agentsam/sandbox/r2-fuse-env.js';

function trim(v) {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * Full CF binding block — on-demand only (deploy/CF jobs). Not ambient.
 * @param {ReturnType<typeof normalizeWorkspaceBindings>} bindings
 */
export function formatWorkspaceBindingBlock(bindings) {
  if (!bindings) return '';
  return [
    `## Active build: ${bindings.name || bindings.slug || bindings.workspaceId}`,
    `workspace_id: ${bindings.workspaceId}`,
    bindings.workerName
      ? `worker: ${bindings.workerName} → ${bindings.deployUrl || '(no deploy_url)'}`
      : null,
    bindings.d1DatabaseId ? `d1_database_id: ${bindings.d1DatabaseId}` : null,
    bindings.r2Bucket
      ? `r2_bucket: ${bindings.r2Bucket}${bindings.r2Prefix ? ` (prefix: ${bindings.r2Prefix})` : ''}`
      : null,
    bindings.kvNamespaceId ? `kv_namespace_id: ${bindings.kvNamespaceId}` : null,
    bindings.githubRepo ? `github_repo: ${bindings.githubRepo}` : null,
    bindings.rootPath ? `root_path: ${bindings.rootPath}` : null,
    bindings.accountId ? `cf_account_id: ${bindings.accountId}` : null,
    '',
    'Use these IDs with CF API tools. Never guess or hardcode.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Ambient append: workspace_id only (tenancy). Full CF/repo dump is opt-in via opts.includeBindings.
 * @param {string} systemPrompt
 * @param {ReturnType<typeof normalizeWorkspaceBindings>} bindings
 * @param {{ includeBindings?: boolean }} [opts]
 */
export function appendWorkspaceBindingBlockToPrompt(systemPrompt, bindings, opts = {}) {
  const out = String(systemPrompt || '');
  if (!bindings?.workspaceId) return out;
  if (opts.includeBindings === true) {
    const block = formatWorkspaceBindingBlock(bindings);
    if (!block) return out;
    if (out.includes('## Active build:')) return out;
    return `${out}\n\n${block}`;
  }
  // Identity-only ambient — no github/root/r2/worker dump.
  if (out.includes('workspace_id:')) return out;
  return `${out}\n\n## Session\nworkspace_id: ${bindings.workspaceId}`;
}

/**
 * @param {{ github_repo?: string|null, r2_prefix?: string|null, root_path?: string|null, workspace_type?: string|null }} row
 * @returns {'github'|'r2'|'local'|'mixed'|'general'}
 */
export function inferWorkspaceSourceLane(row) {
  const gh = trim(row?.github_repo).includes('/');
  const r2 = !!trim(row?.r2_prefix);
  const local = !!trim(row?.root_path);
  const type = trim(row?.workspace_type).toLowerCase();
  if (type === 'github' || type === 'git') return gh ? 'github' : 'general';
  if (type === 'r2' || type === 'storage') return r2 ? 'r2' : 'general';
  if (gh && r2) return 'mixed';
  if (gh) return 'github';
  if (r2) return 'r2';
  if (local) return 'local';
  return 'general';
}

/**
 * @param {any} env
 * @param {string} workspaceId
 * @returns {Promise<{
 *   workspace_id: string,
 *   github_repo: string|null,
 *   r2_prefix: string|null,
 *   r2_bucket: string|null,
 *   root_path: string|null,
 *   workspace_type: string|null,
 *   source_lane: ReturnType<typeof inferWorkspaceSourceLane>,
 * }|null>}
 */
export async function fetchWorkspaceChatBinding(env, workspaceId) {
  const wid = trim(workspaceId);
  if (!env?.DB || !wid) return null;

  let row = await env.DB.prepare(
    `SELECT aw.id, aw.root_path, aw.r2_prefix AS aw_r2_prefix, aw.r2_bucket AS aw_r2_bucket,
            aw.github_repo AS aw_github,
            COALESCE(NULLIF(TRIM(w.github_repo), ''), aw.github_repo) AS github_repo,
            COALESCE(NULLIF(TRIM(w.r2_prefix), ''), aw.r2_prefix) AS r2_prefix,
            COALESCE(w.workspace_type, w.category) AS workspace_type
       FROM agentsam_workspace aw
       LEFT JOIN workspaces w ON w.id = aw.id
      WHERE aw.id = ?
      LIMIT 1`,
  )
    .bind(wid)
    .first()
    .catch(() => null);

  if (!row) {
    row = await env.DB.prepare(
      `SELECT id, root_path, r2_prefix, r2_bucket, github_repo,
              COALESCE(workspace_type, category) AS workspace_type
         FROM workspaces
        WHERE id = ?
        LIMIT 1`,
    )
      .bind(wid)
      .first()
      .catch(() => null);
  }

  if (!row) {
    const github_repo = (await getWorkspaceGithubRepo(env, wid)) || null;
    const r2_prefix = (await resolveWorkspaceR2Prefix(env, wid)) || null;
    const cf_bindings = await resolveWorkspaceBindings(env, wid);
    if (!github_repo && !r2_prefix && !cf_bindings) return null;
    return {
      workspace_id: wid,
      github_repo: github_repo && github_repo.includes('/') ? github_repo : null,
      r2_prefix: r2_prefix || null,
      r2_bucket: cf_bindings?.r2Bucket || null,
      root_path: cf_bindings?.rootPath || null,
      workspace_type: null,
      source_lane: inferWorkspaceSourceLane({ github_repo, r2_prefix }),
      cf_bindings,
    };
  }

  const github_repo = trim(row.github_repo);
  const r2_prefix = trim(row.r2_prefix || row.aw_r2_prefix);
  const root_path = trim(row.root_path);
  const r2_bucket = trim(row.r2_bucket || row.aw_r2_bucket) || null;
  const workspace_type = trim(row.workspace_type) || null;
  const cf_bindings = await resolveWorkspaceBindings(env, wid);

  return {
    workspace_id: wid,
    github_repo: github_repo.includes('/') ? github_repo : null,
    r2_prefix: r2_prefix || null,
    r2_bucket,
    root_path: root_path || null,
    workspace_type,
    source_lane: inferWorkspaceSourceLane({
      github_repo,
      r2_prefix,
      root_path,
      workspace_type,
    }),
    cf_bindings,
  };
}

/**
 * @param {ReturnType<typeof fetchWorkspaceChatBinding> extends Promise<infer T> ? T : never} binding
 * @param {{ explicitGithubRepo?: string|null, activeFileRepo?: string|null, activeFileR2Key?: string|null }} [opts]
 * @returns {string|null}
 */
export function formatWorkspaceBindingForAgent(binding, opts = {}) {
  if (!binding || typeof binding !== 'object') return null;

  const explicitGh = trim(opts.explicitGithubRepo);
  const activeGh = trim(opts.activeFileRepo);
  const activeR2 = trim(opts.activeFileR2Key);
  const lines = [
    '[Workspace binding — session anchor (like Cursor opened-folder scope). Default read/write/search root for this chat unless a stronger per-turn context overrides.]',
    `workspace_id: ${binding.workspace_id}`,
    `source_lane: ${binding.source_lane || 'general'}`,
    `primary_github_repo: ${binding.github_repo || '(none)'}`,
    `r2_prefix: ${binding.r2_prefix || '(none)'}`,
    `r2_bucket: ${binding.r2_bucket || '(none)'}`,
    `root_path: ${binding.root_path || '(none)'}`,
    `workspace_type: ${binding.workspace_type || '(none)'}`,
    '',
    'Precedence (strongest first):',
    '1. Active file envelope / context envelope (open editor file, attached path)',
    '2. Client github_repo_context or Context Hub repo pick this turn',
    '3. Workspace binding above (D1 — what the user selected when opening this workspace)',
    '4. If still ambiguous — ask or use agentsam_github_repo_list / r2_list with explicit paths',
  ];

  if (activeGh && activeGh !== binding.github_repo) {
    lines.push(`active_file_github_repo (override): ${activeGh}`);
  }
  if (explicitGh && explicitGh !== binding.github_repo && explicitGh !== activeGh) {
    lines.push(`client_github_repo_context (override): ${explicitGh}`);
  }
  if (activeR2) {
    lines.push(`active_file_r2_key (override): ${activeR2}`);
  }

  if (binding.source_lane === 'github' || binding.github_repo) {
    lines.push(
      '',
      `GitHub tools: default repo="${binding.github_repo || explicitGh || activeGh || '(resolve via precedence)'}" unless user path says otherwise.`,
    );
  }
  if (binding.source_lane === 'r2' || binding.r2_prefix) {
    lines.push(
      '',
      `R2 tools: default prefix="${binding.r2_prefix}/" under workspace bucket unless an explicit key/path is provided.`,
    );
  }
  if (binding.source_lane === 'local' || binding.root_path) {
    lines.push(
      '',
      `Local/PTY: prefer terminal_execute and fs_* under root_path="${binding.root_path || '(terminal_connections)'}" when mounted.`,
    );
  }

  return lines.join('\n');
}

/**
 * Ambient: workspace_id only. Full github/r2/root/CF binding dump requires opts.includeBindings.
 * @param {string} systemPrompt
 * @param {Awaited<ReturnType<typeof fetchWorkspaceChatBinding>>} binding
 * @param {{ explicitGithubRepo?: string|null, activeFileRepo?: string|null, activeFileR2Key?: string|null, cfBindings?: unknown, includeBindings?: boolean }} [opts]
 */
export function appendWorkspaceBindingToPrompt(systemPrompt, binding, opts = {}) {
  const includeBindings = opts.includeBindings === true;
  const cfBindings = opts.cfBindings ?? binding?.cf_bindings ?? null;
  let out = String(systemPrompt || '');
  if (includeBindings && cfBindings) {
    out = appendWorkspaceBindingBlockToPrompt(out, cfBindings, { includeBindings: true });
  }
  if (!includeBindings) {
    const wid = binding?.workspace_id != null ? String(binding.workspace_id).trim() : '';
    if (!wid) return out;
    if (out.includes('workspace_id:')) return out;
    return `${out}\n\n## Session\nworkspace_id: ${wid}`;
  }
  const block = formatWorkspaceBindingForAgent(binding, opts);
  if (!block) return out;
  if (out.includes('[Workspace binding')) return out;
  return `${out}\n\n## Workspace binding\n${block}`;
}
