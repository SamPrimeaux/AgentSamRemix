/**
 * Per-project runtime contracts — D1 agentsam_rules_document rows aligned with .cursorrules / AGENTSAM.md.
 * Convention: rule_key = rule_{project_id}_runtimecontract (e.g. rule_proj_agentsam_sdk_runtimecontract).
 * Workspace-level seeds (rule_inneranimalmedia_runtimecontract) stay separate — never keyed by workspace slug alone.
 * Global platform law stays in workspace_id=NULL rows; project paths/deploy live here (not in rule_agent_delivery_workflow).
 */
import {
  parseWorkspaceMetadata,
  resolveWorkspaceBindings,
} from '../../backend/identity/workspace/agentsam-workspace.js';
import {
  resolveWorkspaceShipProfile,
  buildDeliveryPolicyPromptBlock,
} from './agent-delivery-policy.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** @param {string} slug */
export function sanitizeProjectSlugForRuleKey(slug) {
  return trim(slug)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

/** @param {string} projectSlug @deprecated prefer projectRuntimeContractRuleKeyFromProjectId */
export function projectRuntimeContractRuleKey(projectSlug) {
  const slug = sanitizeProjectSlugForRuleKey(projectSlug);
  return slug ? `rule_${slug}_runtimecontract` : '';
}

/** @param {string} projectId projects.id e.g. proj_agentsam_sdk */
export function sanitizeProjectIdForRuleKey(projectId) {
  return trim(projectId)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

/** @param {string} projectId */
export function projectRuntimeContractRuleKeyFromProjectId(projectId) {
  const id = sanitizeProjectIdForRuleKey(projectId);
  return id ? `rule_${id}_runtimecontract` : '';
}

/**
 * Resolve canonical projects.id for rule key (chat link + D1 lookup).
 * @param {any} env
 * @param {string|null|undefined} projectRef
 * @param {string|null|undefined} [workspaceId]
 */
export async function resolveProjectIdForRuntimeContract(env, projectRef, workspaceId = null) {
  const ref = trim(projectRef);
  if (!ref) return '';
  let lookupRef = ref;
  try {
    const { resolveChatProjectId } = await import('../../backend/agentsam/sessions/index.js');
    const linked = await resolveChatProjectId(env, ref, workspaceId);
    if (linked) lookupRef = linked;
  } catch {
    /* use ref */
  }
  if (lookupRef.startsWith('proj_')) return lookupRef;
  try {
    const row = await env.DB.prepare(`SELECT id FROM projects WHERE id = ? LIMIT 1`).bind(lookupRef).first();
    if (row?.id) return String(row.id).trim();
  } catch {
    /* optional */
  }
  return lookupRef;
}

/**
 * Per-project rule key — scoped by projects.id, not workspace slug.
 * @param {any} env
 * @param {string|null|undefined} projectRef
 * @param {string|null|undefined} [workspaceId]
 */
export async function resolveProjectRuntimeContractRuleKey(env, projectRef, workspaceId = null) {
  const projectId = await resolveProjectIdForRuntimeContract(env, projectRef, workspaceId);
  return projectRuntimeContractRuleKeyFromProjectId(projectId);
}

/** @param {string} ruleKey */
export function projectSlugFromRuntimeContractRuleKey(ruleKey) {
  const m = String(ruleKey || '').match(/^rule_(.+)_runtimecontract$/);
  return m ? m[1] : '';
}

/**
 * @param {any} env
 * @param {string|null|undefined} projectRef
 * @param {string|null|undefined} [workspaceId]
 */
export async function resolveProjectSlugForRuntimeContract(env, projectRef, workspaceId = null) {
  const ref = trim(projectRef);
  if (!ref) return '';

  let lookupRef = ref;
  try {
    const { resolveChatProjectId } = await import('../../backend/agentsam/sessions/index.js');
    const linked = await resolveChatProjectId(env, ref, workspaceId);
    if (linked) lookupRef = linked;
  } catch {
    /* use ref */
  }

  const bindings = await resolveWorkspaceBindings(env, lookupRef);
  if (bindings?.slug) return sanitizeProjectSlugForRuleKey(bindings.slug);
  if (bindings?.workspaceId) {
    return sanitizeProjectSlugForRuleKey(String(bindings.workspaceId).replace(/^ws_/, ''));
  }
  return sanitizeProjectSlugForRuleKey(ref.replace(/^proj_/, ''));
}

/**
 * @param {any} env
 * @param {{ projectRef?: string|null, projectId?: string|null, workspaceId?: string|null, ruleKey?: string|null }} opts
 */
export async function fetchProjectRuntimeContractRule(env, opts = {}) {
  if (!env?.DB) return null;
  const projectRef = trim(opts.projectRef || opts.projectId);
  const ws = trim(opts.workspaceId);
  const explicitKey = trim(opts.ruleKey);

  let ruleKey = explicitKey;
  if (!ruleKey && projectRef) {
    ruleKey = await resolveProjectRuntimeContractRuleKey(env, projectRef, ws);
  }
  if (!ruleKey) return null;

  try {
    const row = await env.DB.prepare(
      `SELECT id, rule_key, project_id, workspace_id, title, body_markdown, source_stored, sort_order
       FROM agentsam_rules_document
       WHERE is_active = 1
         AND apply_mode = 'always'
         AND (
           project_id = ?
           OR id = ?
           OR rule_key = ?
         )
       ORDER BY
         CASE WHEN project_id = ? THEN 0 WHEN rule_key = ? THEN 1 ELSE 2 END,
         COALESCE(sort_order, 0) ASC
       LIMIT 1`,
    )
      .bind(projectRef, ruleKey, ruleKey, projectRef, ruleKey)
      .first();
    return row || null;
  } catch (e) {
    console.warn('[project-runtime-contract] fetch', e?.message ?? e);
    return null;
  }
}

/**
 * Dynamic fallback when no D1 row exists yet — built from agentsam_workspace (no hardcoded Mac paths in SQL seeds).
 * @param {any} env
 * @param {string|null|undefined} projectRef
 * @param {string|null|undefined} [workspaceId]
 */
export async function buildProjectRuntimeContractMarkdown(env, projectRef, workspaceId = null) {
  const ref = trim(projectRef);
  if (!env?.DB || !ref) return '';

  let lookupRef = ref;
  try {
    const { resolveChatProjectId } = await import('../../backend/agentsam/sessions/index.js');
    const linked = await resolveChatProjectId(env, ref, workspaceId);
    if (linked) lookupRef = linked;
  } catch {
    /* use ref */
  }

  const bindings = await resolveWorkspaceBindings(env, lookupRef);
  if (!bindings?.workspaceId) return '';

  let wsRow = null;
  let metadata = {};
  try {
    wsRow = await env.DB.prepare(
      `SELECT id, workspace_slug, github_repo, root_path, worker_name, deploy_url, metadata_json
       FROM agentsam_workspace WHERE id = ? LIMIT 1`,
    )
      .bind(bindings.workspaceId)
      .first();
    metadata = parseWorkspaceMetadata(wsRow?.metadata_json);
  } catch {
    /* optional */
  }

  const profile = resolveWorkspaceShipProfile(wsRow);
  const slug = sanitizeProjectSlugForRuleKey(bindings.slug || wsRow?.workspace_slug || lookupRef);
  const deliveryBlock = buildDeliveryPolicyPromptBlock(profile, { mode: 'agent' });

  const meta = { ...metadata, ...parseWorkspaceMetadata(wsRow?.metadata_json) };
  const r2Prefix = trim(meta.r2_prefix || bindings.r2Prefix);
  const sandboxAssetPath = r2Prefix
    ? `/mnt/r2/${r2Prefix}/{zone_slug}/assets/`
    : '/mnt/r2/{workspace_r2_prefix}/{zone_slug}/assets/';

  const lines = [
    `## Project runtime contract: ${slug || lookupRef}`,
    '',
    'This block is the SSOT for **this project only** — repo root, deploy, terminal lanes, and R2 asset paths.',
    'Platform-wide identity/MCP law remains in global agentsam_rules_document rows.',
    '',
    deliveryBlock || '',
    '',
    '### Terminal lanes (ExecOS)',
    '- **local** (`agentsam_terminal_local`): `localpty.inneranimalmedia.com` → **samsmac** tunnel — Mac awake at desk only.',
    '- **remote** (`agentsam_terminal_remote`): `terminal.inneranimalmedia.com` → GCP iam-tunnel (Mac asleep / phone).',
    '- **sandbox** (`agentsam_terminal_sandbox`): CF Container pool — cwd + durable assets under R2 FUSE.',
    '',
    '### Sandbox R2 FUSE (default)',
    `- Writable zone cwd: \`/mnt/r2/{workspace_r2_prefix}/{zone_slug}/\` — persist builds/assets to R2, not ephemeral container disk.`,
    `- Recommended asset drop: \`${sandboxAssetPath}\``,
    r2Prefix ? `- Workspace R2 prefix: \`${r2Prefix}\`` : null,
    bindings.r2Bucket ? `- R2 bucket: \`${bindings.r2Bucket}\`` : null,
  ].filter(Boolean);

  return lines.join('\n');
}

/**
 * @param {any} env
 * @param {string|null|undefined} projectRef
 * @param {string|null|undefined} [workspaceId]
 */
export async function loadProjectRuntimeContractSystemBlock(env, projectRef, workspaceId = null) {
  const ref = trim(projectRef);
  if (!ref) return '';

  const row = await fetchProjectRuntimeContractRule(env, { projectRef: ref, workspaceId });
  if (row?.body_markdown) {
    const title = trim(row.title) || trim(row.rule_key) || trim(row.id);
    return `## ${title}\n${String(row.body_markdown).trim()}\n`;
  }

  const generated = await buildProjectRuntimeContractMarkdown(env, ref, workspaceId);
  return generated ? `${generated}\n` : '';
}
