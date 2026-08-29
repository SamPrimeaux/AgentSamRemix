/**
 * Explicit slash-triggered skill invoke — playbook + tools for that turn only.
 * No route/task auto-injection; no multitask skill spawn.
 */

import { hydrateSkillRowFromR2 } from './agentsam-skill-r2.js';
import { formatBlendedSkillsPromptBlock, recordBlendedSkillInvocations } from './agent-skills-rules.js';
import { toolsManifestFromCompiledRows } from './runtime-profile.js';

/**
 * @param {string} message
 * @returns {{ trigger: string, rest: string } | null}
 */
export function parseLeadingSkillSlash(message) {
  const raw = String(message || '').trim();
  if (!raw) return null;
  // Require leading slash so normal prose ("Hello…") never hits D1.
  // D1 slash_trigger is stored without the slash (launch, deck, …).
  const m = raw.match(/^\/([a-zA-Z][\w-]{1,63})\b([\s\S]*)$/);
  if (!m) return null;
  const trigger = String(m[1] || '')
    .trim()
    .toLowerCase();
  if (!trigger) return null;
  return { trigger, rest: String(m[2] || '').trim() };
}

/**
 * @param {any} env
 * @param {string} trigger
 * @param {{ workspaceId?: string|null }} [opts]
 */
export async function lookupSkillBySlashTrigger(env, trigger, opts = {}) {
  if (!env?.DB) return null;
  const t = String(trigger || '')
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '');
  if (!t) return null;
  const ws = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  try {
    const row = await env.DB.prepare(
      `SELECT id, name, content_markdown, always_apply, token_estimate,
              retrieval_strategy, file_path, sort_order, metadata_json, slash_trigger
       FROM agentsam_skill
       WHERE is_active = 1
         AND (
           LOWER(TRIM(COALESCE(slash_trigger, ''))) = ?
           OR LOWER(TRIM(COALESCE(slash_trigger, ''))) = ?
         )
         AND (
           workspace_id IS NULL
           OR TRIM(COALESCE(workspace_id, '')) = ''
           OR workspace_id = ?
         )
       ORDER BY
         CASE WHEN workspace_id = ? THEN 0 ELSE 1 END,
         sort_order ASC
       LIMIT 1`,
    )
      .bind(t, `/${t}`, ws || '', ws || '')
      .first();
    return row?.id ? row : null;
  } catch (e) {
    console.warn('[skill-slash] lookup_failed', e?.message ?? e);
    return null;
  }
}

/**
 * @param {unknown} metadataJson
 * @returns {string[]}
 */
export function pipelineSlugsFromSkillMetadata(metadataJson) {
  let meta = metadataJson;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      meta = {};
    }
  }
  if (!meta || typeof meta !== 'object') return [];
  const pipe = Array.isArray(meta.pipeline) ? meta.pipeline : [];
  return pipe.map((s) => String(s || '').trim()).filter(Boolean);
}

/**
 * Union tool manifests from subagent profiles named in skill metadata.pipeline.
 * Fail-soft: missing profiles / empty compiles → skip.
 *
 * @param {any} env
 * @param {string[]} slugs
 * @param {{ tenantId?: string|null, workspaceId?: string|null, userId?: string|null }} scope
 * @returns {Promise<any[]>}
 */
export async function compileToolsForSkillPipelineSlugs(env, slugs, scope = {}) {
  const list = Array.isArray(slugs) ? slugs : [];
  if (!list.length || !env?.DB) return [];
  const { compileD1ToolProfileRows } = await import('./d1-tool-profile.js');
  const byName = new Map();
  for (const slug of list) {
    try {
      const profile = await env.DB.prepare(
        `SELECT id, slug, tool_profile_key, tenant_id, workspace_id, user_id
         FROM agentsam_subagent_profile
         WHERE slug = ? AND COALESCE(is_active, 1) = 1
         LIMIT 1`,
      )
        .bind(slug)
        .first();
      const pk = profile?.tool_profile_key != null ? String(profile.tool_profile_key).trim() : '';
      if (!pk) continue;
      const compiled = await compileD1ToolProfileRows(
        env,
        {
          tenantId: scope.tenantId ?? profile.tenant_id ?? null,
          workspaceId: scope.workspaceId ?? profile.workspace_id ?? null,
          userId: scope.userId ?? profile.user_id ?? null,
        },
        { profileKey: pk },
      );
      const rows = Array.isArray(compiled?.rows) ? compiled.rows : [];
      const manifest = toolsManifestFromCompiledRows(rows);
      for (const t of manifest) {
        const n = String(t?.name || t?.tool_name || '').trim();
        if (n && !byName.has(n)) byName.set(n, t);
      }
    } catch (e) {
      console.warn('[skill-slash] pipeline_tools', slug, e?.message ?? e);
    }
  }
  return [...byName.values()];
}

/**
 * @param {any[]} baseTools
 * @param {any[]} extraTools
 */
export function unionToolManifests(baseTools, extraTools) {
  const byName = new Map();
  for (const t of [...(baseTools || []), ...(extraTools || [])]) {
    const n = String(t?.name || t?.tool_name || '').trim();
    if (n && !byName.has(n)) byName.set(n, t);
  }
  return [...byName.values()];
}

/**
 * Resolve explicit slash skill for this user turn only.
 *
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   message: string,
 *   workspaceId?: string|null,
 *   userId?: string|null,
 *   tenantId?: string|null,
 *   conversationId?: string|null,
 *   baseTools?: any[],
 * }} opts
 * @returns {Promise<{
 *   matched: boolean,
 *   trigger: string|null,
 *   skillId: string|null,
 *   promptBlock: string,
 *   tools: any[]|null,
 *   skillRow: any|null,
 * }>}
 */
export async function resolveSlashSkillInvoke(env, ctx, opts) {
  const parsed = parseLeadingSkillSlash(opts.message);
  if (!parsed) {
    return {
      matched: false,
      trigger: null,
      skillId: null,
      promptBlock: '',
      tools: null,
      skillRow: null,
    };
  }

  const row = await lookupSkillBySlashTrigger(env, parsed.trigger, {
    workspaceId: opts.workspaceId,
  });
  if (!row) {
    return {
      matched: false,
      trigger: parsed.trigger,
      skillId: null,
      promptBlock: '',
      tools: null,
      skillRow: null,
    };
  }

  let skillRow = row;
  try {
    skillRow = await hydrateSkillRowFromR2(env, row);
  } catch (e) {
    console.warn('[skill-slash] hydrate_r2', e?.message ?? e);
  }

  const skillRows = [{ ...skillRow, _blended_tier: 23, _trigger_method: 'slash' }];
  try {
    await recordBlendedSkillInvocations(env, ctx, skillRows, {
      userId: opts.userId,
      tenantId: opts.tenantId,
      workspaceId: opts.workspaceId,
      conversationId: opts.conversationId,
    });
  } catch {
    /* non-fatal */
  }

  const promptBlock = formatBlendedSkillsPromptBlock(skillRows);
  const slugs = pipelineSlugsFromSkillMetadata(skillRow.metadata_json);
  let tools = null;
  if (slugs.length) {
    const extra = await compileToolsForSkillPipelineSlugs(env, slugs, {
      tenantId: opts.tenantId,
      workspaceId: opts.workspaceId,
      userId: opts.userId,
    });
    if (extra.length) {
      tools = unionToolManifests(opts.baseTools || [], extra);
    }
  }

  return {
    matched: true,
    trigger: parsed.trigger,
    skillId: String(skillRow.id),
    promptBlock,
    tools,
    skillRow,
  };
}
