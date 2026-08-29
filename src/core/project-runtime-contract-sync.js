/**
 * Sync AGENTSAM.md + dashboard instructions → agentsam_rules_document (rule_{project_id}_runtimecontract).
 * Called on project instructions save and POST /api/projects/:id/runtime-contract/sync.
 */
import { parseJsonSafe } from './agent-prompt-builder.js';
import { parseWorkspaceMetadata, resolveWorkspaceBindings } from '../../backend/identity/workspace/agentsam-workspace.js';
import { readProjectDashboardMemory } from './project-dashboard-memory.js';
import { pragmaTableInfo } from '../../backend/services/retention.js';
import {
  fetchProjectRuntimeContractRule,
  projectRuntimeContractRuleKeyFromProjectId,
  resolveProjectIdForRuntimeContract,
  resolveProjectRuntimeContractRuleKey,
} from './project-runtime-contract.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** @param {string} body */
export function runtimeContractContentHash(body) {
  const s = String(body || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a_${(h >>> 0).toString(16)}`;
}

/**
 * Optional YAML frontmatter at top of AGENTSAM.md
 * @param {string} markdown
 */
export function parseAgentsamFrontmatter(markdown) {
  const s = String(markdown || '').replace(/\r\n/g, '\n');
  if (!s.startsWith('---\n')) {
    return { meta: {}, body: s };
  }
  const end = s.indexOf('\n---\n', 4);
  if (end === -1) return { meta: {}, body: s };
  /** @type {Record<string, string>} */
  const meta = {};
  for (const line of s.slice(4, end).split('\n')) {
    const m = line.match(/^([a-z0-9_]+):\s*(.*)$/i);
    if (m) meta[m[1].toLowerCase()] = m[2].trim();
  }
  return { meta, body: s.slice(end + 5) };
}

/**
 * @param {any} env
 * @param {string} projectRef
 * @param {string|null|undefined} [workspaceId]
 */
export async function resolveProjectAgentsamMdPath(env, projectRef, workspaceId = null) {
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

  try {
    const proj = await env.DB.prepare(
      `SELECT id, metadata_json FROM projects WHERE id = ? LIMIT 1`,
    )
      .bind(ref)
      .first();
    if (proj?.metadata_json) {
      const meta = parseJsonSafe(proj.metadata_json, {}) || {};
      const fromMeta = trim(meta.agentsam_md || meta.agentsamMd);
      if (fromMeta) return fromMeta;
    }
  } catch {
    /* optional */
  }

  const bindings = await resolveWorkspaceBindings(env, lookupRef);
  const slug = sanitizeProjectSlugForRuleKey(bindings?.slug || '');

  if (bindings?.workspaceId) {
    try {
      const wsRow = await env.DB.prepare(
        `SELECT metadata_json FROM agentsam_workspace WHERE id = ? LIMIT 1`,
      )
        .bind(bindings.workspaceId)
        .first();
      const wsMeta = parseWorkspaceMetadata(wsRow?.metadata_json);
      const fromWs = trim(wsMeta.agentsam_md || wsMeta.agentsamMd);
      if (fromWs) return fromWs;
    } catch {
      /* optional */
    }
  }

  if (slug) {
    try {
      const ctx = await env.DB.prepare(
        `SELECT notes FROM agentsam_project_context
         WHERE status = 'active'
           AND (project_key = ? OR id LIKE ? OR workspace_id = ?)
         ORDER BY COALESCE(priority, 0) DESC, COALESCE(updated_at, 0) DESC
         LIMIT 3`,
      )
        .bind(slug, `%${slug}%`, bindings?.workspaceId || '')
        .all();
      for (const row of ctx?.results || []) {
        const notes = parseJsonSafe(row?.notes, null);
        if (notes && typeof notes === 'object') {
          const p = trim(notes.agentsam_md || notes.agentsamMd);
          if (p) return p;
        }
        const text = String(row?.notes || '');
        const m = text.match(/agentsam_md["']?\s*:\s*["']([^"']+\/AGENTSAM\.md)["']/i);
        if (m) return m[1];
      }
    } catch {
      /* optional */
    }

    if (slug !== 'inneranimalmedia') {
      return `docs/clients/${slug}/AGENTSAM.md`;
    }
  }

  return slug === 'inneranimalmedia' ? 'AGENTSAM.md' : '';
}

function stripDashboardInstructionsSection(body) {
  const text = trim(body);
  if (!text) return '';
  const idx = text.indexOf('### Dashboard instructions');
  return idx >= 0 ? text.slice(0, idx).trim() : text;
}

/**
 * @param {{
 *   projectId: string,
 *   projectName?: string|null,
 *   ruleKey?: string|null,
 *   workspaceSlug?: string|null,
 *   agentsamMarkdown?: string|null,
 *   dashboardInstructions?: string|null,
 *   agentsamMdPath?: string|null,
 *   existingBody?: string|null,
 *   workspaceBindingsBlock?: string|null,
 * }} opts
 */
export function composeProjectRuntimeContractBody(opts) {
  const projectId = trim(opts.projectId) || 'project';
  const projectName = trim(opts.projectName) || projectId;
  const ruleKey = trim(opts.ruleKey) || projectRuntimeContractRuleKeyFromProjectId(projectId);
  const workspaceSlug = trim(opts.workspaceSlug);
  const agentsamMd = trim(opts.agentsamMarkdown);
  const instructions = trim(opts.dashboardInstructions);
  const sourcePath = trim(opts.agentsamMdPath);
  const existing = trim(opts.existingBody);
  const bindingsBlock = trim(opts.workspaceBindingsBlock);

  /** @type {string[]} */
  const parts = [
    `## Project runtime contract: ${projectName}`,
    '',
    `**project_id:** \`${projectId}\` · **rule_key:** \`${ruleKey}\``,
    workspaceSlug ? `**execution workspace:** \`${workspaceSlug}\` (shared bindings — see Connections)` : '',
    sourcePath ? `**Human SSOT:** \`${sourcePath}\` (wins over DB when in conflict)` : '',
    '',
    'Agent Sam loads this row on every **project-scoped** turn (project selected in chat).',
    'Dashboard Instructions save here auto-syncs. Full AGENTSAM.md: POST /runtime-contract/sync or npm run sync:project-runtime-contract.',
    '',
  ].filter(Boolean);

  if (bindingsBlock) {
    parts.push('### Workspace bindings (shared execution lane)', '', bindingsBlock, '', '---', '');
  }

  if (instructions) {
    parts.push(
      '### Dashboard instructions (additive — honored every turn)',
      '',
      instructions,
      '',
      '---',
      '',
    );
  }

  if (agentsamMd) {
    const { meta, body } = parseAgentsamFrontmatter(agentsamMd);
    if (meta.project_id || meta.workspace_id || meta.project_slug) {
      parts.push(
        '<!-- AGENTSAM frontmatter -->',
        `\`project_id\`: ${meta.project_id || projectId} · \`workspace_id\`: ${meta.workspace_id || '—'} · \`project_slug\`: ${meta.project_slug || workspaceSlug || '—'}`,
        '',
      );
    }
    parts.push(body || agentsamMd);
  } else if (existing) {
    const base = stripDashboardInstructionsSection(existing);
    if (base && !base.includes('run sync after editing')) {
      parts.push(base);
    } else if (sourcePath) {
      parts.push(
        `Full AGENTSAM.md not embedded in this sync pass. Path: \`${sourcePath}\`.`,
        'Run: `npm run sync:project-runtime-contract -- --project ' +
          projectId +
          ' --file ' +
          sourcePath +
          '` after editing.',
      );
    }
  } else if (sourcePath) {
    parts.push(
      `Full AGENTSAM.md not embedded in this sync pass. Path: \`${sourcePath}\`.`,
      'Run: `npm run sync:project-runtime-contract -- --project ' +
        projectId +
        ' --file ' +
        sourcePath +
        '` after editing.',
    );
  }

  return parts.join('\n').trim();
}

function formatWorkspaceBindingsBlock(bindings) {
  if (!bindings) return '';
  const lines = [];
  if (bindings.workerName) lines.push(`- Worker: \`${bindings.workerName}\``);
  if (bindings.r2Bucket) {
    lines.push(
      `- R2: \`${bindings.r2Bucket}\`${bindings.r2Prefix ? ` · prefix \`${bindings.r2Prefix}\`` : ''}`,
    );
  }
  if (bindings.d1DatabaseId) {
    lines.push(`- D1: \`${bindings.d1DatabaseId}\`${bindings.d1Binding ? ` (binding ${bindings.d1Binding})` : ''}`);
  }
  if (bindings.githubRepo) lines.push(`- GitHub: \`${bindings.githubRepo}\``);
  if (bindings.deployUrl) lines.push(`- Deploy URL: ${bindings.deployUrl}`);
  return lines.join('\n');
}

/**
 * @param {any} env
 * @param {{
 *   projectRef: string,
 *   workspaceId?: string|null,
 *   tenantId?: string|null,
 *   agentsamMarkdown?: string|null,
 *   userId?: string|null,
 *   force?: boolean,
 * }} opts
 */
export async function syncProjectRuntimeContract(env, opts = {}) {
  const projectRef = trim(opts.projectRef);
  if (!env?.DB || !projectRef) {
    return { ok: false, error: 'missing_project_ref' };
  }

  const cols = await pragmaTableInfo(env.DB, 'agentsam_rules_document');
  if (!cols.has('rule_key')) {
    return { ok: false, error: 'migration_800_required', hint: 'Apply migrations/800_project_runtime_contract_rules.sql' };
  }

  const ws = trim(opts.workspaceId);
  const projectId = await resolveProjectIdForRuntimeContract(env, projectRef, ws);
  const ruleKey = await resolveProjectRuntimeContractRuleKey(env, projectRef, ws);
  if (!ruleKey) return { ok: false, error: 'rule_key_unresolved' };

  const bindings = await resolveWorkspaceBindings(env, projectRef);
  const dashboard = await readProjectDashboardMemory(env.DB, projectRef);
  const agentsamMdPath = await resolveProjectAgentsamMdPath(env, projectRef, ws);
  const existing = await fetchProjectRuntimeContractRule(env, { projectRef: projectId, workspaceId: ws });

  let projectName = projectId;
  try {
    const projRow = await env.DB.prepare(`SELECT name FROM projects WHERE id = ? LIMIT 1`)
      .bind(projectId)
      .first();
    if (projRow?.name) projectName = String(projRow.name).trim();
  } catch {
    /* optional */
  }

  const body = composeProjectRuntimeContractBody({
    projectId,
    projectName,
    ruleKey,
    workspaceSlug: bindings?.slug || null,
    agentsamMarkdown: opts.agentsamMarkdown,
    dashboardInstructions: dashboard.instructions,
    agentsamMdPath: agentsamMdPath,
    existingBody: existing?.body_markdown,
    workspaceBindingsBlock: formatWorkspaceBindingsBlock(bindings),
  });

  if (!body || body.length < 40) {
    return { ok: false, error: 'empty_contract_body' };
  }

  const contentHash = runtimeContractContentHash(body);
  if (
    !opts.force &&
    existing?.body_markdown &&
    runtimeContractContentHash(existing.body_markdown) === contentHash
  ) {
    return {
      ok: true,
      unchanged: true,
      rule_key: ruleKey,
      project_id: projectRef,
      content_hash: contentHash,
    };
  }

  const ruleId = ruleKey;
  const title = `Project runtime contract: ${projectName}`;
  const workspaceId = trim(bindings?.workspaceId) || ws || '';
  const sourceStored = agentsamMdPath
    ? `repo:${agentsamMdPath}`
    : `d1:agentsam_rules_document:${ruleId}`;
  const notes = JSON.stringify({
    content_hash: contentHash,
    synced_at: new Date().toISOString(),
    agentsam_md: agentsamMdPath || null,
    project_id: projectRef,
  });

  /** @type {string[]} */
  const insertCols = ['id', 'user_id', 'title', 'body_markdown', 'version', 'is_active', 'apply_mode', 'sort_order'];
  /** @type {unknown[]} */
  const insertVals = [ruleId, '', title, body, 1, 1, 'always', 2];
  const updateSets = [
    'title = excluded.title',
    'body_markdown = excluded.body_markdown',
    'is_active = 1',
    'apply_mode = excluded.apply_mode',
    'sort_order = excluded.sort_order',
  ];

  if (cols.has('workspace_id')) {
    insertCols.push('workspace_id');
    insertVals.push(workspaceId);
    updateSets.push('workspace_id = excluded.workspace_id');
  }
  if (cols.has('rule_key')) {
    insertCols.push('rule_key');
    insertVals.push(ruleKey);
    updateSets.push('rule_key = excluded.rule_key');
  }
  if (cols.has('project_id')) {
    insertCols.push('project_id');
    insertVals.push(projectId);
    updateSets.push('project_id = excluded.project_id');
  }
  if (cols.has('rule_type')) {
    insertCols.push('rule_type');
    insertVals.push('runtime_contract');
    updateSets.push('rule_type = excluded.rule_type');
  }
  if (cols.has('trigger_type')) {
    insertCols.push('trigger_type');
    insertVals.push('system');
    updateSets.push('trigger_type = excluded.trigger_type');
  }
  if (cols.has('source_stored')) {
    insertCols.push('source_stored');
    insertVals.push(sourceStored);
    updateSets.push('source_stored = excluded.source_stored');
  }
  if (cols.has('source')) {
    insertCols.push('source');
    insertVals.push('project_runtime_contract_sync');
    updateSets.push('source = excluded.source');
  }
  if (cols.has('notes')) {
    insertCols.push('notes');
    insertVals.push(notes);
    updateSets.push('notes = excluded.notes');
  }
  if (cols.has('created_at_epoch')) {
    insertCols.push('created_at_epoch');
    insertVals.push(Math.floor(Date.now() / 1000));
  }
  if (cols.has('updated_at_epoch')) {
    insertCols.push('updated_at_epoch');
    insertVals.push(Math.floor(Date.now() / 1000));
    updateSets.push('updated_at_epoch = unixepoch()');
  }

  const placeholders = insertCols.map(() => '?').join(', ');

  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_rules_document (${insertCols.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${updateSets.join(', ')}`,
    )
      .bind(...insertVals)
      .run();
  } catch (e) {
    return { ok: false, error: e?.message ? String(e.message) : 'upsert_failed' };
  }

  return {
    ok: true,
    unchanged: false,
    rule_key: ruleKey,
    rule_id: ruleId,
    project_id: projectRef,
    workspace_id: workspaceId || null,
    content_hash: contentHash,
    agentsam_md: agentsamMdPath || null,
    body_chars: body.length,
  };
}
