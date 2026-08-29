/**
 * Dashboard project session context — memory + instructions + client execution bindings.
 */
import { readProjectDashboardMemory } from './project-dashboard-memory.js';
import {
  parseWorkspaceMetadata,
  resolveWorkspaceBindings,
} from '../../backend/identity/workspace/agentsam-workspace.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Normalize GitHub owner/repo from URL or owner/name.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeGithubOwnerRepo(raw) {
  const s = trim(raw);
  if (!s) return '';
  const fromUrl = s.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i);
  if (fromUrl) {
    return `${fromUrl[1]}/${fromUrl[2].replace(/\.git$/i, '')}`;
  }
  const bare = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (/^[^/\s]+\/[^/\s]+$/.test(bare)) {
    return bare.replace(/\.git$/i, '');
  }
  return '';
}

/**
 * Prefer agentsam_workspace.github_repo; fall back to client_apps.github_repository (infra SSOT).
 * @param {any} env
 * @param {string} projectRef
 * @param {ReturnType<typeof normalizeWorkspaceBindingsLike>|null} bindings
 */
async function enrichBindingsGithubFromClientApps(env, projectRef, bindings) {
  if (!env?.DB || !bindings) return bindings;
  if (normalizeGithubOwnerRepo(bindings.githubRepo)) {
    return {
      ...bindings,
      githubRepo: normalizeGithubOwnerRepo(bindings.githubRepo),
    };
  }
  const ref = trim(projectRef);
  if (!ref) return bindings;
  try {
    const row = await env.DB.prepare(
      `SELECT github_repository
       FROM client_apps
       WHERE COALESCE(status, 'active') = 'active'
         AND (
           project_id = ?
           OR id = ?
           OR app_key = ?
         )
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
      .bind(ref, ref, ref)
      .first();
    const gh = normalizeGithubOwnerRepo(row?.github_repository);
    if (gh) return { ...bindings, githubRepo: gh, githubRepoSource: 'client_apps' };
  } catch (e) {
    console.warn('[project-session-context] client_apps_github', e?.message ?? e);
  }
  return bindings;
}

/** @typedef {{ workspaceId?: string|null, slug?: string|null, name?: string|null, projectId?: string|null, d1DatabaseId?: string|null, d1Binding?: string|null, workerName?: string|null, r2Bucket?: string|null, r2Prefix?: string|null, kvNamespaceId?: string|null, githubRepo?: string|null, rootPath?: string|null, deployUrl?: string|null, githubRepoSource?: string|null }} normalizeWorkspaceBindingsLike */

/**
 * @param {any} env
 * @param {string|null|undefined} projectRef
 * @param {string|null|undefined} [workspaceId]
 */
export async function resolveProjectExecutionBindings(env, projectRef, workspaceId = null) {
  const ref = trim(projectRef);
  if (!env?.DB || !ref) return null;

  let lookupRef = ref;
  try {
    const { resolveChatProjectId } = await import('../../backend/agentsam/sessions/index.js');
    const linked = await resolveChatProjectId(env, ref, workspaceId);
    if (linked) lookupRef = linked;
  } catch {
    /* use ref */
  }

  let row = await resolveWorkspaceBindings(env, lookupRef);
  if (!row && lookupRef !== ref) {
    row = await resolveWorkspaceBindings(env, ref);
  }
  const enriched = await enrichBindingsGithubFromClientApps(env, ref, row);
  if (!enriched) return null;

  // Prefer projects.metadata_json.github_repo over shared agentsam_workspace.github_repo
  // so multi-project workspaces do not leak the org/IAM repo into tool runContext.
  try {
    const { readProjectGithubRepoFromRow } = await import(
      '../../backend/agentsam/codebase/project-github-repo.js'
    );
    const projectRow = await env.DB.prepare(
      `SELECT metadata_json FROM projects WHERE id = ? LIMIT 1`,
    )
      .bind(lookupRef)
      .first()
      .catch(() => null);
    const fromProject = normalizeGithubOwnerRepo(readProjectGithubRepoFromRow(projectRow));
    if (fromProject) {
      return {
        ...enriched,
        githubRepo: fromProject,
        githubRepoSource: 'projects.metadata_json',
        projectId: enriched.projectId || lookupRef,
      };
    }
  } catch {
    /* keep enriched */
  }

  return {
    ...enriched,
    projectId: enriched.projectId || lookupRef,
  };
}

/**
 * Full execution row + parsed metadata for project-scoped chat.
 * @param {any} env
 * @param {string|null|undefined} projectRef
 * @param {string|null|undefined} [workspaceId]
 */
export async function resolveProjectExecutionContext(env, projectRef, workspaceId = null) {
  const ref = trim(projectRef);
  if (!env?.DB || !ref) return { bindings: null, metadata: {} };

  let lookupRef = ref;
  try {
    const { resolveChatProjectId } = await import('../../backend/agentsam/sessions/index.js');
    const linked = await resolveChatProjectId(env, ref, workspaceId);
    if (linked) lookupRef = linked;
  } catch {
    /* use ref */
  }

  const bindings = await resolveWorkspaceBindings(env, lookupRef);
  const enriched = await enrichBindingsGithubFromClientApps(env, ref, bindings);
  if (!enriched?.workspaceId) return { bindings: enriched, metadata: {} };

  let metadata = {};
  try {
    const wsRow = await env.DB.prepare(
      `SELECT metadata_json FROM agentsam_workspace WHERE id = ? LIMIT 1`,
    )
      .bind(enriched.workspaceId)
      .first();
    metadata = parseWorkspaceMetadata(wsRow?.metadata_json);
  } catch {
    /* optional */
  }

  return { bindings: enriched, metadata, lookupRef };
}

/**
 * Execution bindings for the active project (from agentsam_workspace via project_id).
 * @param {Awaited<ReturnType<typeof resolveWorkspaceBindings>>} bindings
 * @param {Record<string, unknown>} [metadata]
 */
export function formatProjectClientBindingsBlock(bindings, metadata = {}) {
  if (!bindings) return '';
  const isPlatformProject =
    bindings.workerName === 'inneranimalmedia' || bindings.slug === 'inneranimalmedia';

  const heading = isPlatformProject
    ? '## IAM platform Worker bindings (this project)'
    : '## Client Worker bindings (this project)';

  const d1Line =
    bindings.d1Binding && bindings.d1DatabaseId
      ? isPlatformProject
        ? `D1 **${bindings.d1Binding}**: \`inneranimalmedia-business\` (\`${bindings.d1DatabaseId}\`)`
        : `D1 **${bindings.d1Binding}**: database id \`${bindings.d1DatabaseId}\` (client D1 — not inneranimalmedia-business)`
      : bindings.d1DatabaseId
        ? `D1: \`${bindings.d1DatabaseId}\``
        : null;

  const lines = [
    heading,
    bindings.workerName
      ? `Worker: **${bindings.workerName}**${bindings.deployUrl ? ` → ${bindings.deployUrl}` : ''}`
      : null,
    bindings.workspaceId ? `execution_workspace_id: ${bindings.workspaceId}` : null,
    bindings.slug ? `workspace_slug: ${bindings.slug}` : null,
    d1Line,
    bindings.r2Bucket
      ? isPlatformProject
        ? `R2 **ASSETS**: \`${bindings.r2Bucket}\` (+ AUTORAG_BUCKET, ARTIFACTS per wrangler.production.toml)`
        : `R2 **WEBSITE_ASSETS**: \`${bindings.r2Bucket}\``
      : null,
    bindings.kvNamespaceId
      ? isPlatformProject
        ? `KV **SESSION_CACHE**: \`${bindings.kvNamespaceId}\``
        : `KV **CMS_CACHE**: \`${bindings.kvNamespaceId}\``
      : null,
    bindings.githubRepo
      ? `github_repo: ${bindings.githubRepo} — use this owner/name for GitHub tools; do not ask the user for a repo URL or claim the repo is unknown`
      : null,
    bindings.rootPath ? `root_path: ${bindings.rootPath}` : null,
  ].filter((line) => line !== null);

  if (isPlatformProject) {
    lines.push(
      '',
      'Full platform surface includes Vectorize lanes, HYPERDRIVE, Durable Objects, and worker services — cite wrangler.production.toml / docs/platform/worker-env-production when the user asks for complete IAM bindings.',
    );
  } else {
    lines.push(
      '',
      'Workers AI binding name in client wrangler: **AGENTSAM_WAI**.',
      'Do NOT substitute inneranimalmedia platform bindings (inneranimalmedia-business, AUTORAG_BUCKET, IAM Vectorize indexes) for this client project unless the user explicitly asks about the IAM platform worker.',
    );
  }

  return lines.join('\n');
}

/**
 * @param {any} env
 * @param {string|null|undefined} projectRef projects.id or workspace_projects.id
 * @param {string|null|undefined} [workspaceId]
 */
export async function loadSessionProjectContextSystemBlock(env, projectRef, workspaceId = null) {
  const ref = trim(projectRef);
  if (!env?.DB || !ref) return '';

  let projectId = ref;
  try {
    const { resolveChatProjectId } = await import('../../backend/agentsam/sessions/index.js');
    const linked = await resolveChatProjectId(env, ref, workspaceId);
    if (linked) projectId = linked;
  } catch {
    /* use ref as-is */
  }

  let memory = '';
  let instructions = '';
  try {
    const row = await readProjectDashboardMemory(env.DB, ref);
    memory = trim(row?.memory);
    instructions = trim(row?.instructions);
  } catch (e) {
    console.warn('[project-session-context] read_dashboard_memory', e?.message ?? e);
  }

  if (!memory && !instructions && projectId !== ref) {
    try {
      const row = await readProjectDashboardMemory(env.DB, projectId);
      memory = trim(row?.memory) || memory;
      instructions = trim(row?.instructions) || instructions;
    } catch {
      /* optional */
    }
  }

  let bindingsBlock = '';
  try {
    const bindings = await resolveProjectExecutionBindings(env, ref, workspaceId);
    bindingsBlock = formatProjectClientBindingsBlock(bindings);
  } catch (e) {
    console.warn('[project-session-context] execution_bindings', e?.message ?? e);
  }

  let skipInstructions = false;
  try {
    const { fetchProjectRuntimeContractRule } = await import('./project-runtime-contract.js');
    const rule = await fetchProjectRuntimeContractRule(env, { projectRef: ref, workspaceId });
    skipInstructions = Boolean(rule?.body_markdown);
  } catch {
    /* optional */
  }

  if (!memory && !instructions && !bindingsBlock) return '';

  const parts = [`Project session: ${ref}`];
  if (bindingsBlock) parts.push(bindingsBlock);
  if (memory) parts.push(`Project memory:\n${memory}`);
  if (instructions && !skipInstructions) {
    parts.push(`Project instructions:\n${instructions}`);
  }
  return `## Project session context\n${parts.join('\n\n')}`;
}
