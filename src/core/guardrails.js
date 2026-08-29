/**
 * Runtime evaluation of D1 `agentsam_guardrails` + audit rows in `agentsam_guardrail_events`.
 */

import { scheduleAgentsamErrorLog } from './agentsam-ops-ledger.js';

function isGuardrailAuditDebug(env) {
  const v = env?.MCP_TELEMETRY_DEBUG ?? env?.DEBUG_GUARDRAIL_AUDIT;
  return v === '1' || String(v).toLowerCase() === 'true';
}

function reportGuardrailAuditWriteFailure(env, workerCtx, err, opts) {
  const msg = err != null && typeof err === 'object' && 'message' in err ? String(err.message) : String(err || 'unknown');
  if (isGuardrailAuditDebug(env)) {
    console.error('[GUARDRAIL-AUDIT-FAIL]', msg);
    return;
  }
  const tid = opts.tenant_id != null ? String(opts.tenant_id).trim() : '';
  const wid = opts.workspace_id != null ? String(opts.workspace_id).trim() : '';
  if (env?.DB && tid && workerCtx?.waitUntil) {
    scheduleAgentsamErrorLog(env, workerCtx, {
      workspaceId: wid || tid,
      tenantId: tid,
      sessionId: opts.session_id != null ? String(opts.session_id).slice(0, 200) : null,
      errorCode: 'guardrail_audit_insert_failed',
      errorType: 'agentsam_guardrail_events',
      errorMessage: msg.slice(0, 8000),
      source: 'scheduleGuardrailEvent',
      contextJson: JSON.stringify({
        tool_name: opts.tool_name ?? null,
        applies_to: opts.applies_to ?? null,
      }),
    });
    return;
  }
  console.warn('[GUARDRAIL-AUDIT-FAIL]', msg);
}

/**
 * @typedef {Object} GuardrailEvaluateOpts
 * @property {'mcp_tool'|'model'|'route'|'agent'|'rag'|'browser'|'terminal'|'deploy'|'email'|'storage'|'integration'|'all'} applies_to
 * @property {string|null} [tenant_id]
 * @property {string|null} [workspace_id]
 * @property {string|null} [user_id]
 * @property {string|null} [session_id]
 * @property {string|null} [conversation_id]
 * @property {string|null} [request_id]
 * @property {string|null} [run_group_id]
 * @property {string|null} [tool_name]
 * @property {unknown} [tool_input]
 * @property {string|null} [model_key]
 * @property {string|null} [route_path]
 * @property {string|null} [project_id]
 * @property {string|null} [resource]
 * @property {string|null} [integration]
 */

function guardrailCtxHasField(ctx, key) {
  const k = String(key);
  if (k === 'tenant_id') return !!(ctx.tenant_id != null && String(ctx.tenant_id).trim() !== '');
  if (k === 'workspace_id') return !!(ctx.workspace_id != null && String(ctx.workspace_id).trim() !== '');
  if (k === 'user_id') return !!(ctx.user_id != null && String(ctx.user_id).trim() !== '');
  if (k === 'project_id') return !!(ctx.project_id != null && String(ctx.project_id).trim() !== '');
  return false;
}

/**
 * Production seed matchers: tenant/workspace pins + `requires` (unscoped detection).
 * @param {Record<string, unknown>} m
 * @param {GuardrailEvaluateOpts} ctx
 */
function matchWorkspaceGuardrailPolicy(m, ctx) {
  if (m.tenant_id != null && String(m.tenant_id).trim() !== '') {
    const got = ctx.tenant_id != null ? String(ctx.tenant_id).trim() : '';
    if (got !== String(m.tenant_id).trim()) return false;
  }
  if (m.workspace_id != null && String(m.workspace_id).trim() !== '') {
    const got = ctx.workspace_id != null ? String(ctx.workspace_id).trim() : '';
    if (got !== String(m.workspace_id).trim()) return false;
  }

  const requiredKeys = Array.isArray(m.requires) ? m.requires.map((x) => String(x)) : [];
  if (requiredKeys.length) {
    const missing = requiredKeys.filter((k) => !guardrailCtxHasField(ctx, k));
    if (missing.length) return true;
  }

  if (m.deny_if_mismatch === true) {
    const pinTid = m.tenant_id != null ? String(m.tenant_id).trim() : '';
    const pinWs = m.workspace_id != null ? String(m.workspace_id).trim() : '';
    if (pinTid || pinWs) {
      const gotTid = ctx.tenant_id != null ? String(ctx.tenant_id).trim() : '';
      const gotWs = ctx.workspace_id != null ? String(ctx.workspace_id).trim() : '';
      if (pinTid && gotTid !== pinTid) return true;
      if (pinWs && gotWs !== pinWs) return true;
    }
    // Scoped cross-tenant checks need explicit pins; never block solely because ctx has ids.
    return false;
  }

  if (m.membership_required === true) {
    return false;
  }

  if (m.project_id != null && String(m.project_id).trim() !== '') {
    const got = ctx.project_id != null ? String(ctx.project_id).trim() : '';
    const want = String(m.project_id).trim();
    if (!got) return requiredKeys.includes('project_id');
    if (got !== want) return true;
  }

  if (m.resource != null && ctx.resource != null) {
    return String(m.resource) === String(ctx.resource);
  }
  if (Array.isArray(m.integrations) && ctx.integration != null) {
    return m.integrations.map(String).includes(String(ctx.integration));
  }

  return false;
}

/**
 * Returns true when the row's scope matches the request context.
 * @param {Record<string, unknown>} g
 * @param {GuardrailEvaluateOpts} ctx
 */
export function scopeMatchesGuardrail(g, ctx) {
  const scope = String(g.scope || '');
  const tid = ctx.tenant_id != null ? String(ctx.tenant_id).trim() : '';
  const ws = ctx.workspace_id != null ? String(ctx.workspace_id).trim() : '';
  const uid = ctx.user_id != null ? String(ctx.user_id).trim() : '';

  const gtid = g.tenant_id != null ? String(g.tenant_id).trim() : '';
  const gws = g.workspace_id != null ? String(g.workspace_id).trim() : '';
  const guid = g.user_id != null ? String(g.user_id).trim() : '';

  switch (scope) {
    case 'global':
      return true;
    case 'tenant':
      return !!tid && gtid === tid;
    case 'workspace':
      return !!tid && !!ws && gtid === tid && gws === ws;
    case 'user':
      return !!tid && !!ws && !!uid && gtid === tid && gws === ws && guid === uid;
    case 'session':
      return !!tid && !!ws && gtid === tid && gws === ws;
    default:
      return false;
  }
}

/**
 * Matcher JSON (examples):
 * - `{ "match_all": true }`
 * - `{ "tool_names": ["x"], "tool_name_match": "substring"|"exact" }`
 * - `{ "tool_name_regex": "^mcp_" }`
 * - `{ "model_keys": ["gpt-4o-mini"], "model_match": "exact"|"substring" }`
 * - `{ "model_key_prefix": "claude" }`
 *
 * @param {Record<string, unknown>} g — agentsam_guardrails row
 * @param {GuardrailEvaluateOpts} ctx
 * @returns {boolean}
 */
export function matchGuardrail(g, ctx) {
  const applies = String(g.applies_to || '');
  const want = String(ctx.applies_to || '');
  if (applies !== 'all' && applies !== want) return false;

  let m = {};
  try {
    m = JSON.parse(String(g.matcher_json || '{}')) || {};
  } catch {
    m = {};
  }

  if (m.match_all === true) return true;

  const hasWorkspacePolicy =
    m.tenant_id != null ||
    m.workspace_id != null ||
    m.project_id != null ||
    Array.isArray(m.requires) ||
    m.deny_if_mismatch === true ||
    m.membership_required === true ||
    m.resource != null ||
    Array.isArray(m.integrations);

  if (hasWorkspacePolicy) {
    return matchWorkspaceGuardrailPolicy(m, ctx);
  }

  if (want === 'mcp_tool') {
    const tn = ctx.tool_name != null ? String(ctx.tool_name) : '';
    if (!tn) return false;
    if (Array.isArray(m.tool_names) && m.tool_names.length) {
      const mode = String(m.tool_name_match || 'substring').toLowerCase();
      return m.tool_names.some((x) => {
        const s = String(x);
        if (mode === 'exact') return tn === s;
        return tn.includes(s);
      });
    }
    if (typeof m.tool_name_regex === 'string' && m.tool_name_regex.trim()) {
      try {
        return new RegExp(m.tool_name_regex, 'i').test(tn);
      } catch {
        return false;
      }
    }
    return false;
  }

  if (want === 'model') {
    const mk = ctx.model_key != null ? String(ctx.model_key) : '';
    if (!mk) return false;
    if (Array.isArray(m.model_keys) && m.model_keys.length) {
      const mode = String(m.model_match || 'substring').toLowerCase();
      return m.model_keys.some((x) => {
        const s = String(x);
        if (mode === 'exact') return mk === s;
        return mk.includes(s);
      });
    }
    if (typeof m.model_key_prefix === 'string' && m.model_key_prefix && mk.startsWith(m.model_key_prefix)) {
      return true;
    }
    if (typeof m.model_key_regex === 'string' && m.model_key_regex.trim()) {
      try {
        return new RegExp(m.model_key_regex, 'i').test(mk);
      } catch {
        return false;
      }
    }
    return false;
  }

  if (want === 'route' && typeof m.route_path_regex === 'string' && m.route_path_regex.trim() && ctx.route_path) {
    try {
      return new RegExp(m.route_path_regex, 'i').test(String(ctx.route_path));
    } catch {
      return false;
    }
  }

  return false;
}

function decisionFromAction(action) {
  const a = String(action || 'warn').toLowerCase();
  if (a === 'block') return 'blocked';
  if (a === 'require_approval') return 'approval_required';
  if (a === 'warn') return 'warned';
  if (a === 'log_only') return 'logged';
  if (a === 'allow') return 'allowed';
  return 'allowed';
}

function eventScopeFromRow(g) {
  const s = String(g.scope || 'global');
  if (s === 'global') return 'global';
  if (s === 'tenant') return 'tenant';
  if (s === 'workspace') return 'workspace';
  if (s === 'user') return 'user';
  return 'session';
}

function scheduleGuardrailEvent(env, workerCtx, row, opts, decisionLabel, reasonText) {
  if (!env?.DB) return;
  const id = `gre_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const tenant_id = opts.tenant_id != null ? String(opts.tenant_id).trim() : null;
  const workspace_id = opts.workspace_id != null ? String(opts.workspace_id).trim() : null;
  const user_id = opts.user_id != null ? String(opts.user_id).trim() : null;
  const session_id = opts.session_id != null ? String(opts.session_id).trim() : null;
  const conversation_id =
    opts.conversation_id != null ? String(opts.conversation_id).trim() : session_id;
  const request_id = opts.request_id != null ? String(opts.request_id).trim() : null;

  const tool_name = opts.tool_name != null ? String(opts.tool_name).slice(0, 500) : null;
  const model_key = opts.model_key != null ? String(opts.model_key).slice(0, 500) : null;
  let input_preview = '';
  try {
    input_preview = JSON.stringify(opts.tool_input ?? {}).slice(0, 2000);
  } catch {
    input_preview = '';
  }

  const meta = {
    applies_to: opts.applies_to,
    guardrail_id: row.id,
    evaluated_at: new Date().toISOString(),
    ...(opts.run_group_id != null && String(opts.run_group_id).trim() !== ''
      ? { run_group_id: String(opts.run_group_id).trim() }
      : {}),
  };

  const run = async () => {
    await env.DB.prepare(
      `INSERT INTO agentsam_guardrail_events (
        id, event_scope, tenant_id, workspace_id, user_id,
        session_id, conversation_id, request_id,
        guardrail_id, guardrail_key,
        category, severity, action,
        target_type, target_name, route_path, tool_name, model_key,
        decision, reason, input_preview, metadata_json, created_at
      ) VALUES (
        ?,?,?,?,?,?,?,?,
        ?,?,
        ?,?,?,
        ?,?,?,?,?,
        ?,?,?,?,datetime('now')
      )`,
    ).bind(
      id,
      eventScopeFromRow(row),
      tenant_id,
      workspace_id,
      user_id,
      session_id,
      conversation_id,
      request_id,
      row.id != null ? String(row.id) : null,
      String(row.guardrail_key || 'unknown'),
      String(row.category || 'general'),
      String(row.severity || 'medium'),
      String(row.action || 'warn'),
      String(opts.applies_to || 'agent'),
      String(row.title || '').slice(0, 500),
      opts.route_path != null ? String(opts.route_path).slice(0, 500) : null,
      tool_name,
      model_key,
      decisionLabel,
      reasonText != null ? String(reasonText).slice(0, 8000) : null,
      input_preview || null,
      JSON.stringify(meta),
    ).run();
  };

  if (workerCtx?.waitUntil) {
    workerCtx.waitUntil(run().catch((e) => reportGuardrailAuditWriteFailure(env, workerCtx, e, opts)));
  } else {
    run().catch((e) => reportGuardrailAuditWriteFailure(env, workerCtx, e, opts));
  }
}

/**
 * Loads enabled guardrails for applies_to, filters scope + matcher, fires audit events, returns decision.
 *
 * @param {any} env
 * @param {ExecutionContext | { waitUntil?: (p: Promise<unknown>) => void } | null} workerCtx
 * @param {GuardrailEvaluateOpts} opts
 * @returns {Promise<{ decision: { action: string, guardrail_key?: string, reason?: string } | null, events: Array<{ guardrail_key: string, decision: string }>, blocked: boolean }>}
 */
export async function evaluateGuardrails(env, workerCtx, opts) {
  const empty = { decision: null, events: [], blocked: false };
  if (!env?.DB || !opts?.applies_to) return empty;

  let rows = [];
  try {
    const applies = String(opts.applies_to);
    const r = await env.DB.prepare(
      `SELECT id, scope, tenant_id, workspace_id, user_id,
              guardrail_key, title, description, category, severity, action,
              applies_to, matcher_json, policy_json, priority
       FROM agentsam_guardrails
       WHERE is_enabled = 1
         AND (applies_to = ? OR applies_to = 'all')
       ORDER BY priority DESC`,
    )
      .bind(applies)
      .all();
    rows = r.results || [];
  } catch {
    return empty;
  }

  // Active rulesets bundle guardrail keys via guardrail_keys_json (no members join table in D1).
  try {
    const tenantId = opts.tenant_id != null ? String(opts.tenant_id).trim() : '';
    const workspaceId = opts.workspace_id != null ? String(opts.workspace_id).trim() : '';
    const applies = String(opts.applies_to);
    const rulesets = await env.DB.prepare(
      `SELECT gr.id, gr.ruleset_key, gr.guardrail_keys_json
       FROM agentsam_guardrail_rulesets gr
       WHERE gr.is_enabled = 1
         AND gr.status = 'active'
         AND (gr.tenant_id IS NULL OR gr.tenant_id = ?)
         AND (gr.workspace_id IS NULL OR gr.workspace_id = ?)
       ORDER BY gr.priority DESC
       LIMIT 10`,
    )
      .bind(tenantId, workspaceId)
      .all();

    for (const rs of rulesets.results ?? []) {
      let keys = [];
      try {
        const parsed = JSON.parse(String(rs.guardrail_keys_json || '[]'));
        if (Array.isArray(parsed)) {
          keys = parsed.map((k) => String(k || '').trim()).filter(Boolean);
        }
      } catch {
        keys = [];
      }
      if (!keys.length) continue;

      const placeholders = keys.map(() => '?').join(',');
      const rsGuardrails = await env.DB.prepare(
        `SELECT id, scope, tenant_id, workspace_id, user_id,
                guardrail_key, title, description, category,
                severity, action, applies_to, matcher_json,
                policy_json, priority
         FROM agentsam_guardrails
         WHERE is_enabled = 1
           AND guardrail_key IN (${placeholders})
           AND (applies_to = ? OR applies_to = 'all')
         ORDER BY priority DESC`,
      )
        .bind(...keys, applies)
        .all();
      rows = [...rows, ...(rsGuardrails.results ?? [])];
    }
  } catch {
    /* non-fatal — individual guardrails still evaluated */
  }

  const seenKeys = new Set();
  rows = rows.filter((row) => {
    const key = String(row.guardrail_key || '').trim();
    if (!key || seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  const events = [];
  let blocked = false;
  let decision = null;

  for (const raw of rows) {
    const g = raw;
    if (!scopeMatchesGuardrail(g, opts)) continue;
    if (!matchGuardrail(g, opts)) continue;

    const act = String(g.action || 'warn').toLowerCase();
    const decLabel = decisionFromAction(act);
    const reason =
      String(g.description || g.title || g.guardrail_key || '').slice(0, 2000) ||
      `Guardrail ${g.guardrail_key || ''}`;

    events.push({ guardrail_key: String(g.guardrail_key || ''), decision: decLabel });
    scheduleGuardrailEvent(env, workerCtx, g, opts, decLabel, reason);

    if (act === 'block' || act === 'require_approval') {
      blocked = true;
      decision = {
        action: act,
        guardrail_key: String(g.guardrail_key || ''),
        reason,
      };
      break;
    }
    if (act === 'warn') {
      decision = { action: 'warn', guardrail_key: String(g.guardrail_key || ''), reason };
    }
  }

  return { decision, events, blocked };
}
