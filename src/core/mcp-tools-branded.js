/**
 * Branded MCP catalog + lane inference for Agent Sam chat and GET /api/mcp/tools/catalog.
 *
 * Inline branded SELECT from agentsam_tools (oauth_visible for OAuth MCP discovery).
 * Deterministic agent-chat path: route lanes + capability policy + mcp_workspace_tokens entitlements.
 */

import {
  brandedRowMatchesRouteCapability,
  expandWorkspaceTokenCapabilityAllowlist,
} from './agentsam-capability-aliases.js';
import {
  AGENTSAM_TOOLS_WORKSPACE_SCOPE_SQL,
  selectAgentsamMcpToolsList,
} from './agentsam-mcp-tools.js';
import { pragmaTableInfo } from '../../backend/services/retention.js';

/** @typedef {{ userId?: string|null, tenantId?: string|null, workspaceId?: string|null, personUuid?: string|null }} McpRuntimeScope */

/**
 * @typedef {{
 *   route_key: string,
 *   task_type: string,
 *   allowed_lanes: string[],
 *   required_capabilities: string[],
 *   optional_capabilities: string[],
 *   blocked_capabilities: string[],
 *   max_tools: number | null,
 *   approval_policy: Record<string, unknown> | null,
 *   source: string,
 * }} RouteToolRequirements
 */

const LANES = new Set([
  'design',
  'develop',
  'inspect',
  'research',
  'think',
  'integrate',
  'operate',
  'admin',
  'observe',
  'general',
  'memory',
  'data',
  'terminal',
]);

function parseJsonStringArray(raw) {
  if (raw == null || raw === '') return [];
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(j) ? j.map((x) => String(x || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * @param {Set<string>[]} sets
 * @returns {Set<string>|null}
 */
function intersectSets(sets) {
  if (!sets.length) return null;
  let acc = new Set(sets[0]);
  for (let i = 1; i < sets.length; i++) {
    const next = new Set();
    for (const x of acc) {
      if (sets[i].has(x)) next.add(x);
    }
    acc = next;
  }
  return acc;
}

/**
 * Active workspace token rows → intersected entitlement sets (null = no restriction on that axis).
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} workspaceId
 * @param {string} tenantId
 */
export async function loadWorkspaceTokenEntitlements(db, workspaceId, tenantId) {
  const ws = String(workspaceId || '').trim();
  const tn = String(tenantId || '').trim();
  if (!db || !ws || !tn) {
    return {
      allowedToolNames: null,
      allowedCapabilityKeys: null,
      allowedLanes: null,
      allowedRiskLevels: null,
    };
  }
  const cols = await pragmaTableInfo(db, 'mcp_workspace_tokens');
  const selectParts = ['allowed_tools'];
  if (cols.has('allowed_capability_keys_json')) selectParts.push('allowed_capability_keys_json');
  if (cols.has('allowed_lanes_json')) selectParts.push('allowed_lanes_json');
  if (cols.has('allowed_risk_levels_json')) selectParts.push('allowed_risk_levels_json');
  const revokedClause = cols.has('revoked_at') ? 'AND revoked_at IS NULL' : '';
  const sql = `SELECT ${selectParts.join(', ')} FROM mcp_workspace_tokens
     WHERE workspace_id = ? AND tenant_id = ? AND COALESCE(is_active, 0) = 1
       ${revokedClause}
     LIMIT 40`;
  let results = [];
  try {
    const r = await db.prepare(sql).bind(ws, tn).all();
    results = r.results || [];
  } catch (e) {
    console.warn('[mcp-tools-branded] loadWorkspaceTokenEntitlements', e?.message ?? e);
    return {
      allowedToolNames: null,
      allowedCapabilityKeys: null,
      allowedLanes: null,
      allowedRiskLevels: null,
    };
  }

  const toolSets = [];
  const capSets = [];
  const laneSets = [];
  const riskSets = [];

  for (const row of results || []) {
    const rawTools = row?.allowed_tools;
    if (rawTools != null && String(rawTools).trim() !== '') {
      const arr = parseJsonStringArray(rawTools);
      if (arr.length) toolSets.push(new Set(arr.map((x) => x.toLowerCase())));
    }
    if (cols.has('allowed_capability_keys_json')) {
      const raw = row?.allowed_capability_keys_json;
      if (raw != null && String(raw).trim() !== '') {
        const arr = parseJsonStringArray(raw);
        if (arr.length) capSets.push(new Set(arr.map((x) => x.toLowerCase())));
      }
    }
    if (cols.has('allowed_lanes_json')) {
      const raw = row?.allowed_lanes_json;
      if (raw != null && String(raw).trim() !== '') {
        const arr = parseJsonStringArray(raw);
        const norm = arr.map((x) => x.toLowerCase()).filter((x) => LANES.has(x));
        if (norm.length) laneSets.push(new Set(norm));
      }
    }
    if (cols.has('allowed_risk_levels_json')) {
      const raw = row?.allowed_risk_levels_json;
      if (raw != null && String(raw).trim() !== '') {
        const arr = parseJsonStringArray(raw);
        if (arr.length) riskSets.push(new Set(arr.map((x) => x.toLowerCase())));
      }
    }
  }

  const allowedToolNames = toolSets.length ? intersectSets(toolSets) : null;
  const allowedCapabilityKeys = capSets.length ? intersectSets(capSets) : null;
  const allowedLanes = laneSets.length ? intersectSets(laneSets) : null;
  const allowedRiskLevels = riskSets.length ? intersectSets(riskSets) : null;

  return {
    allowedToolNames: allowedToolNames && allowedToolNames.size ? allowedToolNames : null,
    allowedCapabilityKeys: allowedCapabilityKeys && allowedCapabilityKeys.size ? allowedCapabilityKeys : null,
    allowedLanes: allowedLanes && allowedLanes.size ? allowedLanes : null,
    allowedRiskLevels: allowedRiskLevels && allowedRiskLevels.size ? allowedRiskLevels : null,
  };
}

/** abstract_capability → lane when capability_lane column is unset. */
const ABSTRACT_CAPABILITY_TO_LANE = {
  'code.search': 'develop',
  'file.read': 'develop',
  'file.write': 'develop',
  'd1.read': 'develop',
  'd1.write': 'develop',
  'd1.batch_write': 'develop',
  'database.query': 'develop',
  'database.write': 'develop',
  'schema.inspect': 'develop',
  'terminal.execute': 'develop',
  'worker.preview': 'develop',
  'worker.deploy': 'operate',
  'logs.read': 'observe',
  'mcp.catalog.read': 'operate',
  'mcp.tool.inspect': 'operate',
  'browser.inspect': 'inspect',
  'context.search': 'research',
  'memory.read': 'research',
  'memory.search': 'memory',
  'memory.write': 'memory',
  'rag.search': 'research',
  'rag.ingest': 'research',
  'rag.status': 'research',
  'rag.embed': 'research',
  'drive.read': 'integrate',
  'drive.list': 'integrate',
  'wrangler.d1.query': 'data',
  'wrangler.d1.schema': 'data',
  'wrangler.d1.write': 'data',
  'wrangler.d1.migrate': 'data',
  'wrangler.cli': 'terminal',
  'github.read': 'develop',
  'github.write': 'develop',
  'r2.read': 'develop',
  'r2.write': 'develop',
  'workflow.run': 'operate',
  'agent.run': 'operate',
  'cms.template.read': 'develop',
  'cms.schema.read': 'develop',
};

/**
 * @param {Record<string, unknown>} row
 * @returns {string|null}
 */
function laneFromCapabilityAliasRow(row) {
  const lane = String(row.capability_lane || '').trim().toLowerCase();
  if (LANES.has(lane)) return lane;
  if (String(row.match_kind || '').trim().toLowerCase() === 'capability_lane') {
    const mv = String(row.match_value || '').trim().toLowerCase();
    if (LANES.has(mv)) return mv;
  }
  const cap = String(row.abstract_capability || '').trim().toLowerCase();
  const hinted = ABSTRACT_CAPABILITY_TO_LANE[cap];
  if (hinted && LANES.has(hinted)) return hinted;
  return null;
}

/**
 * D1 agentsam_capability_aliases match (higher priority than regex heuristics).
 * @param {import('@cloudflare/workers-types').D1Database|null} db
 * @param {string} message
 * @returns {Promise<string|null>}
 */
async function inferLaneFromCapabilityAliases(db, message) {
  const m = String(message || '').toLowerCase();
  if (!db || !m.trim()) return null;
  try {
    const { results } = await db
      .prepare(
        `SELECT abstract_capability, capability_lane, match_kind, match_value, priority, rationale
         FROM agentsam_capability_aliases
         WHERE is_active = 1
           AND (
             instr(?, lower(abstract_capability)) > 0
             OR instr(?, lower(replace(abstract_capability, '.', ' '))) > 0
             OR instr(?, lower(match_value)) > 0
             OR instr(?, lower(replace(match_value, '_', ' '))) > 0
           )
         ORDER BY priority ASC
         LIMIT 5`,
      )
      .bind(m, m, m, m)
      .all();

    for (const row of results || []) {
      const lane = laneFromCapabilityAliasRow(row);
      if (lane) return lane;
    }

    const words = m.split(/\W+/).filter((w) => w.length >= 4);
    if (!words.length) return null;

    const { results: broad } = await db
      .prepare(
        `SELECT abstract_capability, capability_lane, match_kind, match_value, priority, rationale
         FROM agentsam_capability_aliases
         WHERE is_active = 1
         ORDER BY priority ASC
         LIMIT 40`,
      )
      .all();

    for (const row of broad || []) {
      const hay = [
        row.abstract_capability,
        row.match_value,
        row.rationale,
        String(row.abstract_capability || '').replace(/\./g, ' '),
        String(row.match_value || '').replace(/_/g, ' '),
      ]
        .join(' ')
        .toLowerCase();
      if (words.some((w) => hay.includes(w))) {
        const lane = laneFromCapabilityAliasRow(row);
        if (lane) return lane;
      }
    }
  } catch {
    /* fall through to regex */
  }
  return null;
}

/**
 * Keyword regex lane inference (unchanged fallback).
 * @param {string} [message]
 * @param {string} [intentSlug]
 * @param {string} [taskType]
 * @param {string} [modeSlug]
 */
function inferMcpCapabilityLaneFromRegex(message, intentSlug, taskType, modeSlug) {
  const m = String(message || '').toLowerCase();
  const intent = String(intentSlug || '').toLowerCase();
  const tt = String(taskType || '').toLowerCase();
  const mode = String(modeSlug || '').toLowerCase();

  if (/\b(bill|invoice|subscription|stripe|tenant admin|workspace admin)\b/i.test(m)) return 'admin';
  if (/\b(metric|log|trace|datadog|sentry|telemetry|health)\b/i.test(m)) return 'observe';
  if (/\b(workflow|orchestrat|cron|queue|deploy prod|promote)\b/i.test(m)) return 'operate';
  if (/\b(webhook|integration|slack|zapier|api key|oauth)\b/i.test(m)) return 'integrate';
  if (/\b(figma|cms|theme|layout|brand|draw|excalidraw|design)\b/i.test(m) || tt === 'cms_edit') return 'design';
  if (
    /\b(browser|playwright|screenshot|inspect dom|devtools|lighthouse)\b/i.test(m) ||
    tt === 'debug' ||
    intent === 'debug'
  ) {
    return 'inspect';
  }
  if (/\b(remember|recall|rag|search docs|embedding|context)\b/i.test(m) || tt === 'summary') return 'research';
  if (
    /\b(sql|d1|database|github|terminal|wrangler|npm|code|diff|patch|refactor)\b/i.test(m) ||
    ['code', 'sql_d1_generation', 'terminal_execution', 'deploy', 'tool_use'].includes(tt)
  ) {
    return 'develop';
  }
  if (mode === 'ask' || tt === 'chat' || tt === 'plan') return 'think';
  return 'develop';
}

/**
 * Map user message + routing hints to a single capability_lane for catalog filtering.
 * @param {string} [message]
 * @param {string} [intentSlug]
 * @param {string} [taskType]
 * @param {string} [modeSlug]
 * @param {import('@cloudflare/workers-types').D1Database|null} [db]
 */
export async function inferMcpCapabilityLane(message, intentSlug, taskType, modeSlug, db = null) {
  if (db) {
    const fromAliases = await inferLaneFromCapabilityAliases(db, message);
    if (fromAliases) return fromAliases;
  }
  return inferMcpCapabilityLaneFromRegex(message, intentSlug, taskType, modeSlug);
}

/**
 * @deprecated Caps come from agentsam_tool_profiles.max_tools via effectiveAgentChatToolCap.
 * Kept as a no-op export so stale imports fail closed (null = ignore) instead of inventing 128.
 * @param {string} [_taskType]
 * @param {string} [_modeSlug]
 * @returns {null}
 */
export function maxModelToolsForAgentTask(_taskType, _modeSlug) {
  return null;
}

const BRANDED_FROM_TOOLS = `
FROM agentsam_tools t
WHERE COALESCE(t.is_active, 1) = 1 AND COALESCE(t.is_degraded, 0) = 0`;

const BRANDED_CAPABILITY_LANE = `
  CASE
    WHEN lower(COALESCE(t.tool_category, '')) IN ('terminal', 'shell', 'deploy') THEN 'develop'
    WHEN lower(COALESCE(t.tool_category, '')) IN ('db_query', 'd1', 'database') THEN 'develop'
    WHEN lower(COALESCE(t.tool_category, '')) IN ('browser', 'devtools', 'a11y', 'inspect') THEN 'inspect'
    WHEN lower(COALESCE(t.tool_category, '')) IN ('mcp_tool', 'http', 'web_fetch', 'fetch') THEN 'research'
    WHEN lower(COALESCE(t.tool_category, '')) IN ('operate', 'cron', 'queue') THEN 'operate'
    WHEN lower(COALESCE(t.tool_category, '')) IN ('observe', 'metrics', 'logs') THEN 'observe'
    WHEN lower(COALESCE(t.tool_category, '')) IN ('admin', 'billing') THEN 'admin'
    ELSE 'general'
  END`;

const BRANDED_SELECT_FULL = `
SELECT * FROM (
SELECT
  t.id,
  COALESCE(t.tool_name, t.tool_key) AS tool_name,
  COALESCE(NULLIF(trim(t.tool_key), ''), NULLIF(trim(t.tool_name), '')) AS tool_key,
  COALESCE(
    NULLIF(lower(trim(t.tool_key)), ''),
    NULLIF(lower(trim(t.tool_name)), ''),
    lower(replace(trim(COALESCE(t.tool_category, 'mcp')), ' ', '_'))
      || ':'
      || lower(replace(trim(COALESCE(COALESCE(t.tool_name, t.tool_key), '')), ' ', '_'))
  ) AS capability_key,
  t.tool_category,
  t.handler_type,
  COALESCE(
    NULLIF(trim(json_extract(t.handler_config, '$.server_key')), ''),
    NULLIF(trim(t.handler_type), ''),
    'workspace'
  ) AS handler_brand,
  ${BRANDED_CAPABILITY_LANE} AS capability_lane,
  CASE WHEN COALESCE(t.requires_approval, 0) = 1 THEN 'approval_required' ELSE 'standard' END AS safety_badge,
  t.description,
  __SCHEMA_COL__
  COALESCE(NULLIF(trim(t.risk_level), ''), 'low') AS risk_level,
  t.requires_approval,
  COALESCE(t.is_active, 1) AS enabled,
  COALESCE(t.sort_priority, 50) AS sort_priority,
  t.schema_hint,
  t.avg_latency_ms,
  t.failure_rate,
  t.caller_policy,
  json_extract(t.handler_config, '$.server_key') AS server_key,
  t.mcp_service_url
${BRANDED_FROM_TOOLS}
) branded
WHERE 1=1
  __LANE_PRED__
ORDER BY capability_lane, handler_brand, requires_approval ASC, sort_priority ASC, tool_name ASC
LIMIT ?`;

const BRANDED_SELECT_MIN = `
SELECT * FROM (
SELECT
  t.id,
  COALESCE(t.tool_name, t.tool_key) AS tool_name,
  t.tool_category,
  t.handler_type,
  COALESCE(
    NULLIF(trim(json_extract(t.handler_config, '$.server_key')), ''),
    NULLIF(trim(t.handler_type), ''),
    'workspace'
  ) AS handler_brand,
  ${BRANDED_CAPABILITY_LANE} AS capability_lane,
  CASE WHEN COALESCE(t.requires_approval, 0) = 1 THEN 'approval_required' ELSE 'standard' END AS safety_badge,
  t.description,
  __SCHEMA_COL__
  COALESCE(NULLIF(trim(t.risk_level), ''), 'low') AS risk_level,
  t.requires_approval,
  COALESCE(t.is_active, 1) AS enabled,
  COALESCE(t.sort_priority, 50) AS sort_priority,
  t.schema_hint,
  t.avg_latency_ms,
  t.failure_rate,
  t.caller_policy
${BRANDED_FROM_TOOLS}
) branded
WHERE 1=1
  __LANE_PRED__
ORDER BY capability_lane, handler_brand, requires_approval ASC, sort_priority ASC, tool_name ASC
LIMIT ?`;

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{ lane?: string|null, lanes?: string[]|null, limit?: number, includeSchema?: boolean }} opts
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function queryBrandedMcpCatalog(db, opts = {}) {
  if (!db) return [];
  const lim = Math.max(1, Math.min(200, Number(opts.limit) || 48));
  const includeSchema = opts.includeSchema !== false;
  const schemaCol = includeSchema ? 'input_schema,' : '';

  const lanesArr = Array.isArray(opts.lanes)
    ? opts.lanes.map((l) => String(l || '').trim().toLowerCase()).filter((l) => LANES.has(l))
    : [];
  const laneRaw = opts.lane != null ? String(opts.lane).trim().toLowerCase() : '';
  const laneSingle = LANES.has(laneRaw) ? laneRaw : '';

  let lanePred = '';
  let bind = [];
  if (lanesArr.length) {
    lanePred = 'AND EXISTS (SELECT 1 FROM json_each(?) je WHERE je.value = capability_lane)';
    bind = [JSON.stringify(lanesArr), lim];
  } else {
    lanePred = "AND (? = '' OR capability_lane = ?)";
    bind = [laneSingle, laneSingle, lim];
  }

  async function run(selectTpl) {
    const sql = selectTpl.replace('__SCHEMA_COL__', schemaCol).replace('__LANE_PRED__', lanePred);
    return db.prepare(sql).bind(...bind).all();
  }

  for (const tpl of [BRANDED_SELECT_FULL, BRANDED_SELECT_MIN]) {
    try {
      const { results } = await run(tpl);
      return Array.isArray(results) ? results : [];
    } catch (e) {
      if (tpl === BRANDED_SELECT_MIN) {
        console.warn('[mcp-tools-branded] agentsam_tools branded query', e?.message ?? e);
      }
    }
  }
  return [];
}

function toolRowMatchesCapability(row, capKey) {
  return brandedRowMatchesRouteCapability(row, capKey);
}

function toolRowBlocked(row, blockedList) {
  for (const b of blockedList || []) {
    if (brandedRowMatchesRouteCapability(row, b)) return true;
  }
  return false;
}

/**
 * Deterministic tool rows for agent chat (route + token + scoped ∩ branded view).
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {McpRuntimeScope} runtimeCtx
 * @param {{
 *   routeToolRequirements: RouteToolRequirements,
 *   message?: string,
 *   intentSlug?: string,
 *   taskType?: string,
 *   modeSlug?: string,
 *   catalogLimit?: number,
 *   outputLimit?: number,
 *   allowLegacyFallback?: boolean,
 * }} opts
 * @returns {Promise<{ rows: Record<string, unknown>[], missingRequiredCapabilities: string[], usedLegacyFallback: boolean }>}
 */
export async function selectMcpToolsForDeterministicAgentChat(db, runtimeCtx, opts) {
  const req = opts.routeToolRequirements;
  const outputLimit = Math.max(0, Math.min(200, Number(opts.outputLimit) || 20));
  const catalogLimit = Math.max(
    1,
    Math.max(outputLimit, Math.min(200, Number(opts.catalogLimit) || 96)),
  );
  const modeSlug = String(opts.modeSlug || '').toLowerCase();
  const taskType = String(opts.taskType || '').toLowerCase();
  /** Legacy flat MCP list — opt-in only (smoke / emergency); not default agent-chat policy. */
  const allowLegacy = opts.allowLegacyFallback === true;

  if (!req || (req.max_tools != null && Number(req.max_tools) === 0)) {
    return { rows: [], missingRequiredCapabilities: [], usedLegacyFallback: false };
  }
  if (outputLimit === 0) {
    return { rows: [], missingRequiredCapabilities: [], usedLegacyFallback: false };
  }

  const lanes = (req?.allowed_lanes || []).filter((l) => LANES.has(String(l).toLowerCase()));
  const routeKey = String(req?.route_key || '').toLowerCase();
  let effectiveLanes = lanes.length ? lanes : ['general'];
  if (routeKey === 'browser' || taskType === 'browser') {
    effectiveLanes = lanes.length ? lanes : ['inspect', 'develop', 'research'];
  }

  let branded = await queryBrandedMcpCatalog(db, {
    lanes: effectiveLanes,
    limit: catalogLimit * 2,
    includeSchema: true,
  });
  if (!branded.length && allowLegacy) {
    const fallbackLane = await inferMcpCapabilityLane(
      opts.message,
      opts.intentSlug,
      opts.taskType,
      opts.modeSlug,
      db,
    );
    branded = await queryBrandedMcpCatalog(db, {
      lane: fallbackLane,
      limit: catalogLimit * 2,
      includeSchema: true,
    });
  }

  const scopedNames = await selectScopedMcpToolNames(db, runtimeCtx, 800);
  const scoped = new Set(scopedNames);
  const ws = runtimeCtx?.workspaceId != null ? String(runtimeCtx.workspaceId).trim() : '';
  const tn = runtimeCtx?.tenantId != null ? String(runtimeCtx.tenantId).trim() : '';
  const tokenNames = await loadWorkspaceTokenAllowedToolNames(db, ws, tn);
  const ent = await loadWorkspaceTokenEntitlements(db, ws, tn);
  const allowedCapExpanded =
    ent.allowedCapabilityKeys && ent.allowedCapabilityKeys.size
      ? expandWorkspaceTokenCapabilityAllowlist(ent.allowedCapabilityKeys)
      : null;

  const routeLaneSet = new Set(effectiveLanes.map((x) => String(x).toLowerCase()));
  let laneFilter = routeLaneSet;
  if (ent.allowedLanes && ent.allowedLanes.size) {
    laneFilter = new Set([...routeLaneSet].filter((l) => ent.allowedLanes.has(l)));
    if (!laneFilter.size && routeLaneSet.size) {
      console.warn('[mcp-tools-branded] token_lane_route_intersection_empty', {
        route_lanes: [...routeLaneSet],
        token_lanes: [...ent.allowedLanes],
      });
      laneFilter = routeLaneSet;
    }
  }

  const toRow = (r) => ({
    tool_name: String(r.tool_name || '').trim(),
    description: String(r.description || ''),
    input_schema: r.input_schema,
    tool_category: String(r.tool_category || 'mcp'),
    requires_approval: Number(r.requires_approval || 0) === 1 ? 1 : 0,
  });

  let candidates = [];
  for (const r of branded) {
    const name = String(r.tool_name || '').trim();
    if (!name) continue;
    const lane = String(r.capability_lane || '').trim().toLowerCase();
    if (laneFilter.size && !laneFilter.has(lane)) continue;
    if (scoped.size && !scoped.has(name)) continue;
    if (tokenNames) {
      if (tokenNames.size === 0) continue;
      if (!tokenNames.has(name.toLowerCase())) continue;
    }
    if (ent.allowedToolNames) {
      if (ent.allowedToolNames.size === 0) continue;
      if (!ent.allowedToolNames.has(name.toLowerCase())) continue;
    }
    if (allowedCapExpanded) {
      const keys = [r.capability_key, r.tool_key, r.tool_name]
        .filter((x) => x != null && String(x).trim() !== '')
        .map((x) => String(x).trim().toLowerCase());
      if (!keys.some((k) => allowedCapExpanded.has(k))) continue;
    }
    if (ent.allowedRiskLevels) {
      const rl = String(r.risk_level || 'low').trim().toLowerCase();
      if (!ent.allowedRiskLevels.has(rl)) continue;
    }
    if (toolRowBlocked(r, req.blocked_capabilities)) continue;
    candidates.push({ raw: r, row: toRow(r) });
  }

  const opt = req.optional_capabilities || [];
  const reqCaps = req.required_capabilities || [];

  const missing = [];
  for (const cap of reqCaps) {
    if (!candidates.some(({ raw }) => toolRowMatchesCapability(raw, cap))) {
      missing.push(String(cap));
    }
  }
  if (missing.length) {
    return { rows: [], missingRequiredCapabilities: missing, usedLegacyFallback: false };
  }

  const routeMax =
    req.max_tools != null && Number.isFinite(Number(req.max_tools))
      ? Math.floor(Number(req.max_tools))
      : null;
  if (routeMax === 0) {
    return { rows: [], missingRequiredCapabilities: [], usedLegacyFallback: false };
  }
  const maxOut =
    routeMax != null && routeMax > 0
      ? Math.max(0, Math.min(outputLimit, routeMax))
      : Math.max(0, outputLimit);
  if (maxOut <= 0) {
    return { rows: [], missingRequiredCapabilities: [], usedLegacyFallback: false };
  }

  const score = ({ raw }) => {
    let s = 0;
    for (const c of reqCaps) {
      if (toolRowMatchesCapability(raw, c)) s += 100;
    }
    for (const c of opt) {
      if (toolRowMatchesCapability(raw, c)) s += 10;
    }
    return s;
  };
  candidates.sort((a, b) => score(b) - score(a) || String(a.raw.tool_name).localeCompare(String(b.raw.tool_name)));

  let rows = candidates.slice(0, maxOut).map((c) => c.row);
  let usedLegacyFallback = false;

  if (!rows.length && allowLegacy) {
    console.warn('[mcp-tools-branded] deterministic_empty_legacy_fallback', {
      route_key: req.route_key,
      task_type: req.task_type,
    });
    rows = await selectAgentsamMcpToolsList(db, runtimeCtx, Math.min(maxOut, 12));
    usedLegacyFallback = true;
  }

  return { rows, missingRequiredCapabilities: [], usedLegacyFallback };
}

/**
 * Scoped tool names enabled for this workspace (for intersecting branded catalog).
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {McpRuntimeScope} runtimeCtx
 * @param {number} [limit]
 */
export async function selectScopedMcpToolNames(db, runtimeCtx, limit = 500) {
  if (!db) return [];
  const lim = Math.max(1, Math.min(800, Number(limit) || 500));
  const workspaceId = runtimeCtx?.workspaceId != null ? String(runtimeCtx.workspaceId).trim() : '';

  const sql = `
SELECT DISTINCT COALESCE(tool_name, tool_key) AS tool_name
FROM agentsam_tools
WHERE COALESCE(is_active, 1) = 1
  AND COALESCE(is_degraded, 0) = 0
  AND ${AGENTSAM_TOOLS_WORKSPACE_SCOPE_SQL}
ORDER BY tool_name ASC
LIMIT ?`;

  try {
    const { results } = await db
      .prepare(sql)
      .bind(workspaceId, workspaceId, lim)
      .all();
    const names = (results || []).map((r) => String(r.tool_name || '').trim()).filter(Boolean);
    return names;
  } catch (e) {
    console.warn('[mcp-tools-branded] selectScopedMcpToolNames', e?.message ?? e);
    return [];
  }
}

/**
 * Optional union of allowed tool names from active mcp_workspace_tokens rows.
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} workspaceId
 * @param {string} tenantId
 * @returns {Promise<Set<string>|null>} null = no restriction
 */
export async function loadWorkspaceTokenAllowedToolNames(db, workspaceId, tenantId) {
  const ws = String(workspaceId || '').trim();
  const tn = String(tenantId || '').trim();
  if (!db || !ws || !tn) return null;
  const cols = await pragmaTableInfo(db, 'mcp_workspace_tokens');
  const revokedClause = cols.has('revoked_at') ? 'AND revoked_at IS NULL' : '';
  try {
    const { results } = await db
      .prepare(
        `SELECT allowed_tools FROM mcp_workspace_tokens
         WHERE workspace_id = ? AND tenant_id = ? AND COALESCE(is_active, 0) = 1
           ${revokedClause}
           AND allowed_tools IS NOT NULL AND trim(allowed_tools) != ''
         LIMIT 40`,
      )
      .bind(ws, tn)
      .all();
    const sets = [];
    for (const r of results || []) {
      const raw = r?.allowed_tools;
      if (raw == null || raw === '') continue;
      const arr = parseJsonStringArray(raw);
      if (arr.length) sets.push(new Set(arr.map((x) => x.toLowerCase())));
    }
    if (!sets.length) return null;
    const merged = intersectSets(sets);
    return merged;
  } catch (e) {
    console.warn('[mcp-tools-branded] workspace token allowed_tools', e?.message ?? e);
    return null;
  }
}

/**
 * Merge branded view rows + workspace scope + token policy into chat tool rows
 * (same shape as selectAgentsamMcpToolsList). Non–agent-chat paths.
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {McpRuntimeScope} runtimeCtx
 * @param {{ lane?: string, catalogLimit?: number, outputLimit?: number, message?: string, intentSlug?: string, taskType?: string, modeSlug?: string }} opts
 */
export async function selectMcpToolsForChatRuntime(db, runtimeCtx, opts = {}) {
  const outputLimit = Math.max(1, Math.min(200, Number(opts.outputLimit) || 20));
  const catalogLimit = Math.max(outputLimit, Math.min(200, Number(opts.catalogLimit) || 48));
  const lane =
    opts.lane ||
    (await inferMcpCapabilityLane(opts.message, opts.intentSlug, opts.taskType, opts.modeSlug, db));

  const branded = await queryBrandedMcpCatalog(db, {
    lane,
    limit: catalogLimit,
    includeSchema: true,
  });

  const scopedNames = await selectScopedMcpToolNames(db, runtimeCtx, 600);
  const scoped = new Set(scopedNames);
  const ws = runtimeCtx?.workspaceId != null ? String(runtimeCtx.workspaceId).trim() : '';
  const tn = runtimeCtx?.tenantId != null ? String(runtimeCtx.tenantId).trim() : '';
  const tokenAllow = await loadWorkspaceTokenAllowedToolNames(db, ws, tn);

  const toRow = (r) => ({
    tool_name: String(r.tool_name || '').trim(),
    description: String(r.description || ''),
    input_schema: r.input_schema,
    tool_category: String(r.tool_category || 'mcp'),
    requires_approval: Number(r.requires_approval || 0) === 1 ? 1 : 0,
  });

  let candidates = [];
  if (branded.length) {
    for (const r of branded) {
      const name = String(r.tool_name || '').trim();
      if (!name) continue;
      if (scoped.size && !scoped.has(name)) continue;
      if (tokenAllow) {
        if (tokenAllow.size === 0) continue;
        if (!tokenAllow.has(name.toLowerCase())) continue;
      }
      candidates.push(toRow(r));
    }
  }

  if (!candidates.length) {
    return selectAgentsamMcpToolsList(db, runtimeCtx, outputLimit);
  }

  candidates = candidates.slice(0, outputLimit);
  return candidates;
}
