import { hydrateSkillsFromR2 } from './agentsam-skill-r2.js';
import { parseJsonSafe } from './agent-prompt-builder.js';

export function parseRuleTriggerCondition(raw) {
  const obj = parseJsonSafe(raw, {}) || {};
  const keywords = Array.isArray(obj.keywords)
    ? obj.keywords.map((k) => String(k).trim()).filter(Boolean)
    : [];
  const minMatches = Math.max(1, Number(obj.min_matches ?? obj.minMatches ?? 1) || 1);
  return { keywords, minMatches };
}

export function countKeywordsInMessage(message, keywords) {
  const hay = String(message || '').toLowerCase();
  if (!hay || !keywords.length) return 0;
  let hits = 0;
  for (const kw of keywords) {
    const needle = String(kw).toLowerCase();
    if (needle && hay.includes(needle)) hits += 1;
  }
  return hits;
}

export function ruleMatchesKeywordTrigger(message, triggerConditionJson) {
  const { keywords, minMatches } = parseRuleTriggerCondition(triggerConditionJson);
  if (!keywords.length) return false;
  return countKeywordsInMessage(message, keywords) >= minMatches;
}

/**
 * Loads agentsam_rules_document rows for system prompt injection:
 * apply_mode=always, and either:
 *   - trigger_type=keyword (message match), or
 *   - any other trigger_type (system / always / manual / …) treated as unconditional.
 *
 * Historical footgun (2026-07-23): column DEFAULT trigger_type='manual' + SQL filter
 * `trigger_type IN ('system','keyword')` silently dropped LOCKED apply_mode=always rules.
 * apply_mode=always is now authoritative; keyword is the only conditional opt-in.
 * See AGENTSAM.md · rule_platform_lockdown_engineering_law.
 */
export async function fetchTriggeredRulesForSystemPrompt(env, opts = {}) {
  if (!env?.DB) return [];
  const ws = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  const uid = opts.userId != null ? String(opts.userId).trim() : '';
  if (!ws) return [];
  const message = String(opts.message ?? '');
  const projectRef = trim(opts.projectRef || opts.projectId);

  let projectRuleKey = '';
  if (projectRef) {
    try {
      const { resolveProjectRuntimeContractRuleKey } = await import('./project-runtime-contract.js');
      projectRuleKey = await resolveProjectRuntimeContractRuleKey(env, projectRef, ws);
    } catch (e) {
      console.warn('[agent] project rule key', e?.message ?? e);
    }
  }

  let rows = [];
  try {
    const rRes = await env.DB.prepare(
      `SELECT id, title, body_markdown, trigger_type, trigger_condition_json, sort_order
       FROM agentsam_rules_document
       WHERE is_active = 1
         AND apply_mode = 'always'
         AND (workspace_id = ? OR workspace_id IS NULL OR TRIM(COALESCE(workspace_id, '')) = '')
         AND (user_id = ? OR user_id IS NULL OR TRIM(COALESCE(user_id, '')) = '')
       ORDER BY COALESCE(sort_order, 0) ASC, updated_at_epoch DESC`,
    )
      .bind(ws, uid || '')
      .all();
    rows = rRes.results || [];
  } catch (e) {
    console.warn('[agent] triggered rules query', e?.message ?? e);
    return [];
  }

  if (projectRuleKey) {
    try {
      const pRes = await env.DB.prepare(
        `SELECT id, title, body_markdown, trigger_type, trigger_condition_json, sort_order, rule_key, project_id
         FROM agentsam_rules_document
         WHERE is_active = 1
           AND apply_mode = 'always'
           AND (id = ? OR rule_key = ? OR project_id = ?)
         ORDER BY COALESCE(sort_order, 0) ASC, updated_at_epoch DESC`,
      )
        .bind(projectRuleKey, projectRuleKey, projectRef)
        .all();
      const projectRows = pRes.results || [];
      const seen = new Set(rows.map((r) => String(r.id)));
      for (const pr of projectRows) {
        if (!seen.has(String(pr.id))) {
          rows.push(pr);
          seen.add(String(pr.id));
        }
      }
    } catch (e) {
      console.warn('[agent] project rules query', e?.message ?? e);
    }
  }

  return rows.filter((r) => {
    const tt = String(r.trigger_type || '').toLowerCase();
    if (tt === 'keyword') return ruleMatchesKeywordTrigger(message, r.trigger_condition_json);
    // system | always | manual | wireframe | empty | anything else → unconditional
    return true;
  });
}

function trim(v) {
  return v == null ? '' : String(v).trim();
}

export async function appendTriggeredRulesToSystemPrompt(env, systemPrompt, opts = {}) {
  const rules = await fetchTriggeredRulesForSystemPrompt(env, opts);
  if (!rules.length) return systemPrompt;
  const blocks = rules.map((r) => {
    const title = String(r.title || r.id || 'Rule');
    const body = String(r.body_markdown || '');
    return `### ${title}\n${body}`;
  });
  return `${systemPrompt}\n\n## Workspace Rules\n${blocks.join('\n\n')}\n`;
}

export function skillTokenEstimate(row) {
  const te = Number(row?.token_estimate);
  if (Number.isFinite(te) && te > 0) return Math.floor(te);
  const body = String(row?.content_markdown || '');
  return body ? Math.max(1, Math.ceil(body.length / 4)) : 0;
}

export function normalizeBlendedTaskTypes(taskTypes, taskType) {
  const out = new Set();
  if (Array.isArray(taskTypes)) {
    for (const t of taskTypes) {
      const s = String(t ?? '').trim();
      if (s) out.add(s);
    }
  }
  const single = String(taskType ?? '').trim();
  if (single) out.add(single);
  return [...out];
}

/**
 * Tier 1 (always_apply + token budget) + Tier 2/3 (json_each task/route match + budget).
 * Single loader for agent chat — replaces loadSkillsForTaskType + appendSkills duplicate queries.
 */
export async function loadBlendedSkillsForRequest(env, opts = {}) {
  if (!env?.DB) return { skills: [], tier1Tokens: 0, tier23Tokens: 0 };
  const {
    userId,
    workspaceId,
    routeKey = null,
    taskTypes = [],
    taskType = null,
    tier1Budget = 800,
    tier23Budget = 2000,
    maxSkills = 6,
  } = opts;
  const uid = userId != null ? String(userId).trim() : '';
  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  if (!ws) return { skills: [], tier1Tokens: 0, tier23Tokens: 0 };

  const types = normalizeBlendedTaskTypes(taskTypes, taskType);
  const rk = String(routeKey ?? '').trim();
  const selected = [];
  const seen = new Set();
  let tier1Tokens = 0;
  let tier23Tokens = 0;

  const pushRow = (row, tier) => {
    const id = String(row?.id ?? '');
    if (!id || seen.has(id) || selected.length >= maxSkills) return false;
    const cost = skillTokenEstimate(row);
    if (tier === 1) {
      if (tier1Tokens + cost > tier1Budget) return false;
      tier1Tokens += cost;
    } else {
      if (tier23Tokens + cost > tier23Budget) return false;
      tier23Tokens += cost;
    }
    seen.add(id);
    selected.push({ ...row, _blended_tier: tier });
    return true;
  };

  try {
    const tier1Res = await env.DB.prepare(
      `SELECT id, name, content_markdown, always_apply, token_estimate,
              retrieval_strategy, file_path, sort_order
       FROM agentsam_skill
       WHERE is_active = 1
         AND always_apply = 1
         AND (workspace_id = ? OR workspace_id IS NULL OR TRIM(COALESCE(workspace_id, '')) = '')
       ORDER BY sort_order ASC`,
    )
      .bind(ws)
      .all();
    for (const row of tier1Res.results || []) {
      if (selected.length >= maxSkills) break;
      pushRow(row, 1);
    }
  } catch (e) {
    console.warn('[agent] blended_skills tier1', e?.message ?? e);
  }

  if (selected.length >= maxSkills) {
    return { skills: selected, tier1Tokens, tier23Tokens };
  }

  const matchParts = [];
  const binds = [ws];
  if (uid) {
    matchParts.push(`(user_id = ? AND TRIM(COALESCE(user_id, '')) != '')`);
    binds.push(uid);
  }
  if (rk) {
    matchParts.push(
      `EXISTS (
         SELECT 1 FROM json_each(COALESCE(NULLIF(TRIM(route_keys_json), ''), '[]')) je
         WHERE je.value = ?
       )`,
    );
    binds.push(rk);
  }
  if (types.length) {
    const ph = types.map(() => '?').join(', ');
    matchParts.push(
      `EXISTS (
         SELECT 1 FROM json_each(COALESCE(NULLIF(TRIM(task_types_json), ''), '[]')) je
         WHERE je.value IN (${ph})
       )`,
    );
    binds.push(...types);
  }
  if (!matchParts.length) {
    return { skills: selected, tier1Tokens, tier23Tokens };
  }

  try {
    const tier23Res = await env.DB.prepare(
      `SELECT id, name, content_markdown, always_apply, token_estimate,
              retrieval_strategy, file_path, sort_order, user_id
       FROM agentsam_skill
       WHERE is_active = 1
         AND always_apply = 0
         AND (workspace_id = ? OR workspace_id IS NULL OR TRIM(COALESCE(workspace_id, '')) = '')
         AND (${matchParts.join(' OR ')})
       ORDER BY sort_order ASC`,
    )
      .bind(...binds)
      .all();
    for (const row of tier23Res.results || []) {
      if (selected.length >= maxSkills) break;
      pushRow(row, 23);
    }
  } catch (e) {
    console.warn('[agent] blended_skills tier23', e?.message ?? e);
  }

  return { skills: selected, tier1Tokens, tier23Tokens };
}

export function formatBlendedSkillsPromptBlock(skillRows) {
  if (!skillRows?.length) return '';
  const blocks = skillRows.map((r) => {
    const title = String(r.name || r.id || 'skill');
    const body = String(r.content_markdown || '').trim();
    if (!body) return `### ${title}\n(skill content loaded via ${String(r.retrieval_strategy || 'db')})\n`;
    return `### ${title}\n${body}`;
  });
  return `\n## Skills\n${blocks.join('\n\n')}\n`;
}

export async function recordBlendedSkillInvocations(env, ctx, skillRows, opts) {
  if (!skillRows?.length || !env?.DB) return;
  const {
    userId, tenantId, workspaceId, conversationId,
  } = opts;
  const uid = String(userId ?? '').trim();
  const ws = String(workspaceId ?? '').trim();
  if (!uid || !ws) return;
  const ids = skillRows.map((r) => r.id);
  env.DB.prepare(
    `UPDATE agentsam_skill
     SET invocation_count = invocation_count + 1,
         last_invoked_at = datetime('now')
     WHERE id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .run()
    .catch(() => {});
  if (!ctx?.waitUntil) return;
  const conv = conversationId != null ? String(conversationId) : null;
  ctx.waitUntil(
    Promise.all(
      skillRows.map((row) =>
        env.DB.prepare(
          `INSERT INTO agentsam_skill_invocation
           (skill_id, user_id, workspace_id, conversation_id, trigger_method, success, tenant_id)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
        )
          .bind(
            String(row.id),
            uid,
            ws,
            conv,
            row._trigger_method ||
              (row._blended_tier === 1 ? 'always_apply' : 'auto'),
            tenantId ?? null,
          )
          .run()
          .catch((e) => console.warn('[agentsam_skill_invocation]', e?.message ?? e)),
      ),
    ).catch(() => {}),
  );
}

/**
 * Appends blended skills to the system prompt; records invocations (waitUntil).
 * Rules are injected in buildSystemPrompt via appendTriggeredRulesToSystemPrompt (D1 triggers).
 */
export async function appendSkillsAndRulesToSystemPrompt(env, ctx, systemPrompt, opts) {
  const {
    userId,
    tenantId,
    workspaceId,
    conversationId,
    taskType,
    routeKey = null,
    taskTypes = null,
    tier1Budget = 800,
    tier23Budget = 2000,
    maxSkills = 6,
    preloadedSkills = null,
  } = opts;
  if (!env?.DB) return systemPrompt;
  const uid = userId != null ? String(userId).trim() : '';
  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  if (!uid || !ws) return systemPrompt;

  let skillRows = preloadedSkills;
  if (!skillRows) {
    try {
      const blended = await loadBlendedSkillsForRequest(env, {
        userId: uid,
        workspaceId: ws,
        routeKey,
        taskTypes: taskTypes ?? (taskType ? [taskType] : []),
        taskType,
        tier1Budget,
        tier23Budget,
        maxSkills,
      });
      skillRows = blended.skills;
    } catch (e) {
      console.warn('[agent] blended_skills prompt', e?.message ?? e);
      return systemPrompt;
    }
  }
  if (!skillRows?.length) return systemPrompt;

  try {
    skillRows = await hydrateSkillsFromR2(env, skillRows);
  } catch (e) {
    console.warn('[agent] hydrate skills r2', e?.message ?? e);
  }

  try {
    await recordBlendedSkillInvocations(env, ctx, skillRows, {
      userId: uid,
      tenantId,
      workspaceId: ws,
      conversationId,
    });
  } catch (e) {
    console.warn('[agent] blended_skills invocation', e?.message ?? e);
  }

  const extra = formatBlendedSkillsPromptBlock(skillRows);
  return extra ? `${systemPrompt}${extra}` : systemPrompt;
}

