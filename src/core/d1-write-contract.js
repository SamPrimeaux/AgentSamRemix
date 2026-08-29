/**
 * Runtime single-writer contracts for ad-hoc D1 mutation tools.
 *
 * agentsam_d1_write / d1_write must not mutate terminal SoR columns that have
 * gated writers (ticket proof close, applyRewardEvent). Scripts and
 * in-process writers (assert:ticket-shippable, reward-events.js) use env.DB
 * directly and are unaffected.
 *
 * Call sites (all required — dispatch_target=both uses mcp_first):
 *   - catalog-tool-executor executeCatalogCfD1 (BEFORE MCP proxy)
 *   - workspace-d1-execution / core d1_write / tools/db.js
 *   - MCP twin: inneranimalmedia-mcp-server/src/mcp-d1-write-contract.js
 *
 * Override: allow_d1_contract_bypass=true or -- ALLOW_D1_CONTRACT_BYPASS
 * Structured log: agentsam_guardrail_events WHERE guardrail_key='d1_write_contract_bypass'
 *   (decision='logged', metadata_json.contract + bypass_source + sql_preview)
 */

import { stripSqlComments } from './d1-read-validator.js';

const BANDIT_COLS = /\b(success_alpha|success_beta|cost_mean|cost_n|cost_m2)\s*=/i;

export const D1_WRITE_CONTRACT_GUARDRAIL_ID = 'gr_d1_write_contract_bypass';
export const D1_WRITE_CONTRACT_GUARDRAIL_KEY = 'd1_write_contract_bypass';

/**
 * @param {string} sql
 * @returns {boolean}
 */
export function sqlAllowsD1ContractBypass(sql) {
  return /ALLOW_D1_CONTRACT_BYPASS/i.test(String(sql || ''));
}

/**
 * @param {string} sql
 * @param {{ allow_d1_contract_bypass?: boolean|string|number }} [opts]
 * @returns {'param'|'sql_comment'|null}
 */
export function resolveD1ContractBypassSource(sql, opts = {}) {
  if (
    opts.allow_d1_contract_bypass === true ||
    opts.allow_d1_contract_bypass === 1 ||
    opts.allow_d1_contract_bypass === '1'
  ) {
    return 'param';
  }
  if (sqlAllowsD1ContractBypass(sql)) return 'sql_comment';
  return null;
}

/**
 * Scrub columns that contain "status" as a prefix so `\bstatus\s*=` is safe.
 * @param {string} sql
 */
function scrubStatusLookalikes(sql) {
  return String(sql || '')
    .replace(/\bstatus_reason\b/gi, '__status_reason__')
    .replace(/\bstatus_change\b/gi, '__status_change__')
    .replace(/\bfrom_status\b/gi, '__from_status__')
    .replace(/\bto_status\b/gi, '__to_status__');
}

/**
 * @param {string} sql
 * @returns {{ ok: true } | { ok: false, error: string, contract: string }}
 */
export function assertD1WriteContracts(sql) {
  const raw = String(sql || '');
  if (!raw.trim()) return { ok: true };

  const stripped = scrubStatusLookalikes(stripSqlComments(raw));
  const upperTable = (name) => new RegExp(`\\b${name}\\b`, 'i');

  if (upperTable('agentsam_tickets').test(stripped) && /\bUPDATE\b/i.test(stripped)) {
    if (/\bstatus\s*=/i.test(stripped)) {
      return {
        ok: false,
        contract: 'agentsam_tickets.status',
        error:
          'd1_write_contract: cannot UPDATE agentsam_tickets.status via raw SQL. ' +
          'Use agentsam_ticket (operation=set_status) /api/tickets/:id/status, or for shipped: ' +
          'npm run assert:ticket-shippable -- --ticket=… --set-shipped. ' +
          'Override (audited): allow_d1_contract_bypass=true or -- ALLOW_D1_CONTRACT_BYPASS',
      };
    }
  }

  if (upperTable('agentsam_routing_arms').test(stripped) && /\bUPDATE\b/i.test(stripped)) {
    if (BANDIT_COLS.test(stripped)) {
      return {
        ok: false,
        contract: 'agentsam_routing_arms.bandit',
        error:
          'd1_write_contract: cannot UPDATE agentsam_routing_arms success_alpha/beta or ' +
          'cost_mean/n/m2 via raw SQL. Use applyRewardEvent (reward-events.js). ' +
          'Override (audited): allow_d1_contract_bypass=true or -- ALLOW_D1_CONTRACT_BYPASS',
      };
    }
  }

  return { ok: true };
}

/**
 * Persist a queryable bypass audit row (agentsam_guardrail_events).
 * @param {any} env
 * @param {any} [workerCtx]
 * @param {{
 *   contract: string,
 *   sql: string,
 *   bypass_source: 'param'|'sql_comment',
 *   surface?: string,
 *   tool_name?: string|null,
 *   tenant_id?: string|null,
 *   workspace_id?: string|null,
 *   user_id?: string|null,
 *   session_id?: string|null,
 *   conversation_id?: string|null,
 * }} details
 * @returns {string|null} event id
 */
export function scheduleD1WriteContractBypassEvent(env, workerCtx, details) {
  if (!env?.DB) return null;
  const id = `gre_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const tenant_id =
    details.tenant_id != null && String(details.tenant_id).trim()
      ? String(details.tenant_id).trim()
      : null;
  const workspace_id =
    details.workspace_id != null && String(details.workspace_id).trim()
      ? String(details.workspace_id).trim()
      : null;
  const user_id =
    details.user_id != null && String(details.user_id).trim()
      ? String(details.user_id).trim()
      : null;
  const session_id =
    details.session_id != null && String(details.session_id).trim()
      ? String(details.session_id).trim()
      : null;
  const conversation_id =
    details.conversation_id != null && String(details.conversation_id).trim()
      ? String(details.conversation_id).trim()
      : session_id;

  const event_scope =
    tenant_id && workspace_id ? 'workspace' : tenant_id ? 'tenant' : 'global';

  const sqlPreview = String(details.sql || '').slice(0, 1500);
  const meta = {
    contract: details.contract,
    bypass_source: details.bypass_source,
    surface: details.surface || 'unknown',
    sql_preview: sqlPreview.slice(0, 500),
    evaluated_at_unix: Math.floor(Date.now() / 1000),
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
    )
      .bind(
        id,
        event_scope,
        tenant_id,
        workspace_id,
        user_id,
        session_id,
        conversation_id,
        session_id,
        D1_WRITE_CONTRACT_GUARDRAIL_ID,
        D1_WRITE_CONTRACT_GUARDRAIL_KEY,
        'tool_permission',
        'high',
        'log_only',
        'mcp_tool',
        'D1 write single-writer contract override',
        null,
        details.tool_name != null ? String(details.tool_name).slice(0, 500) : 'agentsam_d1_write',
        null,
        'logged',
        `OVERRIDE: ${details.contract} via ${details.bypass_source} (${details.surface || 'unknown'})`,
        JSON.stringify({ sql: sqlPreview }).slice(0, 2000),
        JSON.stringify(meta),
      )
      .run();
  };

  if (workerCtx?.waitUntil) {
    workerCtx.waitUntil(run().catch((e) => console.warn('[d1-write-contract] audit insert failed', e?.message || e)));
  } else {
    run().catch((e) => console.warn('[d1-write-contract] audit insert failed', e?.message || e));
  }
  return id;
}

/**
 * Gate used by d1_write tool paths.
 * @param {string} sql
 * @param {{
 *   allow_d1_contract_bypass?: boolean|string|number,
 *   log?: (msg: string, meta?: object) => void,
 *   env?: any,
 *   workerCtx?: any,
 *   audit?: {
 *     surface?: string,
 *     tool_name?: string|null,
 *     tenant_id?: string|null,
 *     workspace_id?: string|null,
 *     user_id?: string|null,
 *     session_id?: string|null,
 *     conversation_id?: string|null,
 *   },
 * }} [opts]
 */
export function gateD1WriteContracts(sql, opts = {}) {
  const bypassSource = resolveD1ContractBypassSource(sql, opts);
  const gate = assertD1WriteContracts(sql);
  if (gate.ok) return { ok: true, bypass: false };

  if (bypassSource) {
    const log = opts.log || ((msg, meta) => console.warn(msg, meta || ''));
    let eventId = null;
    if (opts.env?.DB) {
      eventId = scheduleD1WriteContractBypassEvent(opts.env, opts.workerCtx, {
        contract: gate.contract,
        sql: String(sql || ''),
        bypass_source: bypassSource,
        ...(opts.audit || {}),
      });
    }
    log('[d1-write-contract] ALLOW_D1_CONTRACT_BYPASS', {
      contract: gate.contract,
      bypass_source: bypassSource,
      guardrail_event_id: eventId,
      sql_preview: String(sql || '').slice(0, 240),
    });
    return {
      ok: true,
      bypass: true,
      contract: gate.contract,
      bypass_source: bypassSource,
      guardrail_event_id: eventId,
    };
  }

  return gate;
}

/**
 * Flags to merge into tool output_json so dashboards can filter without grepping SQL.
 * @param {{ bypass?: boolean, contract?: string, bypass_source?: string, guardrail_event_id?: string|null }} gate
 */
export function d1WriteContractBypassResponseFields(gate) {
  if (!gate?.bypass) return {};
  return {
    contract_bypassed: true,
    contract: gate.contract ?? null,
    bypass_source: gate.bypass_source ?? null,
    guardrail_event_id: gate.guardrail_event_id ?? null,
    guardrail_key: D1_WRITE_CONTRACT_GUARDRAIL_KEY,
  };
}
