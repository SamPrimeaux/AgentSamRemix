/**
 * agentsam_tools — canonical discovery + row load for Agent Sam runtime.
 * Policy allowlists (mcp_workspace_tokens, agentsam_mcp_allowlist) intersect here; execution stays in dispatch-by-tool-code.
 */
import { brandedRowMatchesRouteCapability } from './agentsam-capability-aliases.js';
import { augmentWorkspaceFsInputSchema } from './fs-tool-input-schema.js';
import { listAgentsamMcpToolsForServerKeys } from './agentsam-mcp-tools.js';
import { parseHandlerConfig } from '../../backend/credentials/resolver.js';
import { agentsamMemorySearchInputSchema } from './mcp-memory-search-schema.js';
import { agentsamMemorySaveInputSchema } from './mcp-memory-save-schema.js';
import { agentsamMemoryVectorWriteInputSchema } from './mcp-memory-vector-write-schema.js';
import { agentsamGithubWriteInputSchema } from './mcp-github-write-schema.js';
import { agentsamGithubCommitTreeInputSchema } from './mcp-github-commit-tree-schema.js';
import {
  agentsamGithubReadInputSchema,
  agentsamGithubPrInputSchema,
  agentsamGithubIssueInputSchema,
} from './mcp-github-public-schema.js';
import {
  agentsamTerminalLocalInputSchema,
  agentsamTerminalRemoteInputSchema,
  agentsamTerminalSandboxInputSchema,
  agentsamContainerExecInputSchema,
} from './mcp-terminal-contract.js';
import {
  agentsamD1QueryInputSchema,
  CLOUDFLARE_D1_DATABASE_QUERY_DESCRIPTION,
  isAgentsamD1CfSqlFaceTool,
} from './d1-query-tool-contract.js';

/** Lightweight lane inference (avoids mcp-tools-branded → retention import chain in Node smoke). */
function inferLaneFromMessage(message, modeSlug) {
  const m = String(message || '').toLowerCase();
  const mode = String(modeSlug || '').toLowerCase();
  if (/\b(browser|playwright|screenshot|inspect dom|devtools)\b/i.test(m)) return 'inspect';
  if (/\b(cloud sandbox|my.container|container exec|batch exec)\b/i.test(m)) return 'terminal';
  if (/\b(sql|d1|database|github|terminal|wrangler|code|patch)\b/i.test(m)) return 'develop';
  if (/\b(remember|recall|rag|search docs|embedding|context)\b/i.test(m)) return 'research';
  if (mode === 'ask') return 'think';
  return 'develop';
}

export const CATALOG_ACTIVE_TOOL_COUNT = 76;
/** Default = full catalog ceiling — no hardcoded 8-tool starve. */
export const DEFAULT_AGENT_TOOL_LIST_LIMIT = 128;
export const MAX_AGENT_TOOL_LIST_LIMIT = 128;

// ─── Dynamic handler type resolution ──────────────────────────────────────────
// Never hardcode this list as the single source of truth. Load from D1, cache 5 min in KV.
// Adding a new handler_type to D1 should work without code changes.

/** Types that must NEVER execute regardless of D1 state. */
const HANDLER_TYPE_BLOCKLIST = new Set(['legacy', 'deprecated', 'stub', 'noop', 'disabled']);

const HANDLER_TYPES_CACHE_KEY = 'agentsam:handler_types:v1';
const HANDLER_TYPES_CACHE_TTL_SECONDS = 300; // 5 minutes

/** handler_type values with a catalog executor branch (fail closed otherwise). */
export const EXECUTABLE_HANDLER_TYPES = new Set([
  'd1',
  'hyperdrive',
  'supabase',
  'terminal',
  'r2',
  'ai',
  'http',
  'github',
  'mcp',
  'proxy',
  'workspace.reader',
  'filesystem',
  'mybrowser',
  'browser',
  'builtin',
  'websearch',
  'cf',
  'deploy',
  'git',
  'memory',
  'notify',
  'workflow',
  'agent',
  'media',
  'canvas',
  'integrations',
  'container',
  'workspace_argv',
]);

/**
 * Load executable handler types from D1 with KV cache.
 * Falls back to {@link EXECUTABLE_HANDLER_TYPES} if D1/KV unavailable.
 *
 * @param {any} env Worker env bindings
 * @returns {Promise<Set<string>>}
 */
export async function loadExecutableHandlerTypes(env) {
  // 1) KV cache fast-path
  if (env?.SESSION_CACHE) {
    try {
      const cached = await env.SESSION_CACHE.get(HANDLER_TYPES_CACHE_KEY, 'json');
      if (Array.isArray(cached) && cached.length > 0) {
        const arr = cached
          .map((t) => trim(t).toLowerCase())
          .filter((t) => t && !HANDLER_TYPE_BLOCKLIST.has(t));
        if (arr.length) return new Set(arr);
      }
    } catch (_) {}
  }

  // 2) D1 source of truth
  if (env?.DB) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT DISTINCT handler_type
         FROM agentsam_tools
         WHERE is_active = 1
           AND handler_type IS NOT NULL
           AND trim(handler_type) != ''
         ORDER BY handler_type ASC`,
      ).all();

      const types = (results || [])
        .map((r) => trim(r?.handler_type).toLowerCase())
        .filter((t) => t && !HANDLER_TYPE_BLOCKLIST.has(t));

      if (types.length > 0) {
        if (env?.SESSION_CACHE) {
          void env.SESSION_CACHE.put(HANDLER_TYPES_CACHE_KEY, JSON.stringify(types), {
            expirationTtl: HANDLER_TYPES_CACHE_TTL_SECONDS,
          }).catch(() => {});
        }
        return new Set(types);
      }
    } catch (_) {}
  }

  // 3) Fallback — known working types only
  return new Set([...EXECUTABLE_HANDLER_TYPES].map((t) => trim(t).toLowerCase()).filter(Boolean));
}

/** Route capability_lane → agentsam_tools.tool_category */
/** @param {unknown} raw JSON array on agentsam_prompt_routes.mcp_template */
export function parseMcpTemplateServerKeys(raw) {
  if (raw == null || raw === '') return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((k) => trim(k)).filter(Boolean))];
  } catch {
    return [];
  }
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string|null|undefined} routeKey
 * @param {string|null|undefined} [tenantId]
 */
export async function loadPromptRouteMcpServerKeys(db, routeKey, tenantId = null) {
  const rk = trim(routeKey).toLowerCase();
  if (!db || !rk) return [];
  const tid = trim(tenantId);
  try {
    const row = await db
      .prepare(
        `SELECT mcp_template FROM agentsam_prompt_routes
         WHERE is_active = 1 AND route_key = ?
           AND (tenant_id IS NULL OR tenant_id = ?)
         ORDER BY CASE WHEN tenant_id IS NOT NULL THEN 0 ELSE 1 END,
                  COALESCE(priority, 0) ASC
         LIMIT 1`,
      )
      .bind(rk, tid)
      .first();
    return parseMcpTemplateServerKeys(row?.mcp_template);
  } catch (e) {
    console.warn('[agentsam-tools-catalog] loadPromptRouteMcpServerKeys', e?.message ?? e);
    return [];
  }
}

const MCP_TEMPLATE_SCORE_BOOST = 500;

/**
 * @param {Record<string, unknown>} m
 * @param {string} [serverUrl]
 */
function mcpTemplateRowToCatalogRaw(m, serverUrl = '') {
  const sk = trim(m.server_key);
  const serviceUrl = trim(m.mcp_service_url) || trim(serverUrl);
  return {
    tool_key: trim(m.tool_key) || trim(m.tool_name),
    tool_name: trim(m.tool_name),
    description: m.description,
    input_schema: m.input_schema,
    tool_category: trim(m.tool_category) || 'cloudflare',
    capability_key: trim(m.capability_key) || sk,
    risk_level: trim(m.risk_level) || 'low',
    requires_approval: m.requires_approval,
    handler_type: 'mcp',
    mcp_service_url: serviceUrl,
    handler_config: JSON.stringify({
      auth_source: 'platform',
      server_key: sk,
      mcp_service_url: serviceUrl,
    }),
    workspace_scope: '["*"]',
    __mcp_template: 1,
  };
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{ userId?: string, tenantId?: string, workspaceId?: string, personUuid?: string }} runtimeCtx
 * @param {string[]} serverKeys
 * @param {number} [limit]
 */
async function loadCatalogRowsForMcpTemplate(db, runtimeCtx, serverKeys, limit = 48) {
  const mcpRows = await listAgentsamMcpToolsForServerKeys(db, runtimeCtx, serverKeys, limit);
  const out = [];
  const seen = new Set();
  for (const m of mcpRows) {
    const nm = trim(m.tool_name);
    if (!nm || seen.has(nm)) continue;
    seen.add(nm);
    if (m.agentsam_tools_id) {
      let linked = null;
      try {
        linked = await db
          .prepare(
            `SELECT id, tool_key, tool_code, tool_name, display_name, handler_type, handler_config, handler_key,
                    linked_mcp_tool_id, mcp_service_url, tool_category, input_schema, risk_level,
                    requires_approval, workspace_scope, modes_json, is_active, is_degraded
             FROM agentsam_tools
             WHERE id = ? AND COALESCE(is_active, 1) = 1 AND COALESCE(is_degraded, 0) = 0
             LIMIT 1`,
          )
          .bind(String(m.agentsam_tools_id))
          .first();
      } catch {
        linked = null;
      }
      if (linked) {
        out.push({
          ...linked,
          __mcp_template: 1,
          mcp_service_url: trim(m.mcp_service_url) || trim(m.server_url) || trim(linked.mcp_service_url),
        });
        continue;
      }
    }
    out.push(mcpTemplateRowToCatalogRaw(m, trim(m.server_url)));
  }
  return out;
}

/** Emptied — lane→category JS maps removed (were starving / mis-scoping the menu). */
export const LANE_TO_TOOL_CATEGORIES = {};

/** Emptied — lane→domain JS maps removed. Domains come from D1 route requirements only. */
export const LANE_TO_DOMAINS = {};

const LEGACY_CATEGORY_TO_DOMAIN = /** @type {Record<string, string>} */ ({});

function parseJsonStringArray(raw) {
  if (raw == null || raw === '') return [];
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(j) ? j.map((x) => trim(x).toLowerCase()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Resolve allowed domains from D1 route requirements only (no JS lane maps).
 * Empty → unrestricted at domain layer.
 * @param {{ allowed_domains?: string[], allowed_lanes?: string[] } | null | undefined} req
 */
export function toolDomainsFromRouteRequirements(req) {
  const explicit = parseJsonStringArray(req?.allowed_domains);
  return explicit.length ? [...new Set(explicit)] : [];
}

/**
 * SQL filter: tool_category is domain.capability; match any allowed domain prefix.
 * @param {string[]} domains
 */
export function buildToolDomainFilterClause(domains) {
  const doms = [...new Set((domains || []).map((d) => trim(d).toLowerCase()).filter(Boolean))];
  if (!doms.length) return null;

  const parts = [];
  const binds = [];
  for (const d of doms) {
    parts.push(`lower(tool_category) LIKE ?`);
    binds.push(`${d}.%`);
    parts.push(`lower(tool_category) = ?`);
    binds.push(d);
    const legacyCats = Object.entries(LEGACY_CATEGORY_TO_DOMAIN)
      .filter(([, dom]) => dom === d)
      .map(([cat]) => cat);
    for (const cat of legacyCats) {
      parts.push(`lower(tool_category) = ?`);
      binds.push(cat);
    }
  }
  return { clause: `(${parts.join(' OR ')})`, binds };
}

/** Lane category → dotted `tool_category` prefixes (canonical catalog rows). */
const CATEGORY_LIKE_PREFIXES = /** @type {Record<string, string[]>} */ ({
  d1: ['database.d1%'],
  supabase: ['database.supabase%', 'database.hyperdrive%'],
  terminal: ['terminal.%'],
  container: ['container.%'],
  filesystem: ['filesystem.%'],
  github: ['github.%'],
  memory: ['memory.%'],
  browser: ['browser.%'],
  ui: ['browser.%', 'ui.%'],
  knowledge: ['knowledge.%', 'research.%'],
  context: ['context.%'],
  ai: ['ai.%'],
  web: ['web.%'],
  deploy: ['deploy.%'],
  cloudflare: ['cloudflare.%', 'platform.%'],
  agent: ['agent.%'],
  storage: ['storage.%', 'r2.%'],
  integrations: ['integrations.%'],
  email: ['email.%'],
  workflow: ['workflow.%'],
  network: ['network.%'],
  media: ['media.%'],
  cms: ['cms.%', 'agent.cms%'],
});

/**
 * SQL fragment + binds for lane category filters (exact + dotted prefixes).
 * @param {string[]} categories lowercased lane categories
 * @returns {{ clause: string, binds: string[] } | null}
 */
export function buildToolCategoryFilterClause(categories) {
  const cats = [...new Set((categories || []).map((c) => trim(c).toLowerCase()).filter(Boolean))];
  if (!cats.length) return null;

  const parts = [`lower(tool_category) IN (${cats.map(() => '?').join(',')})`];
  const binds = [...cats];
  const likeSet = new Set();
  for (const cat of cats) {
    for (const p of CATEGORY_LIKE_PREFIXES[cat] || []) likeSet.add(p);
  }
  for (const p of likeSet) {
    parts.push('lower(tool_category) LIKE ?');
    binds.push(p);
  }
  return { clause: `(${parts.join(' OR ')})`, binds };
}

/**
 * JS mirror of {@link buildToolCategoryFilterClause} for tests / mocks.
 * @param {string} toolCategory
 * @param {string[]} categories
 */
export function toolRowMatchesCategoryFilter(toolCategory, categories) {
  const tc = trim(toolCategory).toLowerCase();
  const cats = [...new Set((categories || []).map((c) => trim(c).toLowerCase()).filter(Boolean))];
  if (!tc || !cats.length) return false;
  if (cats.includes(tc)) return true;
  for (const cat of cats) {
    for (const p of CATEGORY_LIKE_PREFIXES[cat] || []) {
      const prefix = p.endsWith('%') ? p.slice(0, -1) : p;
      if (tc.startsWith(prefix)) return true;
    }
  }
  return false;
}

const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };

function parseJsonSafe(raw, fallback = null) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function trim(v) {
  return v == null ? '' : String(v).trim();
}

// ─── Ambient credential filter ────────────────────────────────────────────────

/**
 * Load which OAuth providers are connected for the calling user.
 * Checks user_oauth_tokens for non-expired rows.
 *
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string|null} userId
 * @returns {Promise<Set<string>>} e.g. Set { 'github', 'google_drive' }
 */
async function loadConnectedProviders(db, userId) {
  if (!db || !userId) return new Set();
  try {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT provider
         FROM user_oauth_tokens
         WHERE user_id = ?
           AND COALESCE(is_active, 1) = 1
           AND revoked_at IS NULL
           AND (
             expires_at IS NULL
             OR expires_at > unixepoch()
             OR (refresh_token IS NOT NULL AND length(trim(refresh_token)) > 0)
             OR (refresh_token_encrypted IS NOT NULL AND length(trim(refresh_token_encrypted)) > 0)
             OR (vault_refresh_token_id IS NOT NULL AND length(trim(vault_refresh_token_id)) > 0)
           )
         LIMIT 20`,
      )
      .bind(userId)
      .all();
    return new Set((results || []).map((r) => trim(r.provider)).filter(Boolean));
  } catch (_) {
    return new Set();
  }
}

/** Removed hardcoded OAuth/provider gate map — handlers enforce auth at call time. */
const TOOL_OAUTH_REQUIREMENTS = {};

/** Removed hardcoded workspace_root gate — handlers/PTY enforce at call time. */
const TOOLS_REQUIRING_WORKSPACE_ROOT = new Set();

/**
 * @param {string[]} lanes
 * @returns {string[]}
 */
export function toolCategoriesFromLanes(lanes) {
  const out = new Set();
  for (const lane of lanes || []) {
    const key = trim(lane).toLowerCase();
    const cats = LANE_TO_TOOL_CATEGORIES[key];
    if (cats) for (const c of cats) out.add(c);
  }
  return [...out];
}

/**
 * @param {string} [lane]
 * @param {string} [message]
 * @param {string} [modeSlug]
 * @param {import('@cloudflare/workers-types').D1Database|null} [db]
 */
export async function inferToolCategoriesForContext(lane, message, modeSlug, db = null) {
  const laneTrim = trim(lane).toLowerCase();
  if (laneTrim && LANE_TO_TOOL_CATEGORIES[laneTrim]) {
    return toolCategoriesFromLanes([laneTrim]);
  }
  void db;
  return toolCategoriesFromLanes([inferLaneFromMessage(message, modeSlug)]);
}

/**
 * @param {Record<string, unknown>|null} row
 */
export function inputSchemaFromAgentsamToolRow(row) {
  const tk = trim(row?.tool_key || row?.tool_name).toLowerCase();
  const finalize = (schema) => augmentWorkspaceFsInputSchema(tk, schema);
  if (tk === 'agentsam_memory_search') return finalize(agentsamMemorySearchInputSchema());
  if (tk === 'agentsam_memory_save') return finalize(agentsamMemorySaveInputSchema());
  if (tk === 'agentsam_memory_write') return finalize(agentsamMemoryVectorWriteInputSchema());
  if (tk === 'agentsam_github_write') return finalize(agentsamGithubWriteInputSchema());
  if (tk === 'agentsam_github_commit_tree') return finalize(agentsamGithubCommitTreeInputSchema());
  if (tk === 'agentsam_github_read') return finalize(agentsamGithubReadInputSchema());
  if (tk === 'agentsam_github_pr') return finalize(agentsamGithubPrInputSchema());
  if (tk === 'agentsam_github_issue') return finalize(agentsamGithubIssueInputSchema());
  if (tk === 'agentsam_terminal_local') return finalize(agentsamTerminalLocalInputSchema());
  if (tk === 'agentsam_terminal_remote') return finalize(agentsamTerminalRemoteInputSchema());
  if (tk === 'agentsam_terminal_sandbox') return finalize(agentsamTerminalSandboxInputSchema());
  if (tk === 'agentsam_container_exec') return finalize(agentsamContainerExecInputSchema());
  if (isAgentsamD1CfSqlFaceTool(tk)) return finalize(agentsamD1QueryInputSchema());

  const parsed = parseJsonSafe(row?.input_schema, null);
  if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
    const o = { ...parsed };
    if (!o.type) o.type = 'object';
    if (Array.isArray(o.required) && o.required.includes('query') && tk.includes('memory_search')) {
      o.required = o.required.filter((f) => String(f).toLowerCase() !== 'query');
      if (!o.required.length) delete o.required;
    }
    return finalize(o);
  }
  const hc = parseHandlerConfig(row?.handler_config);
  if (hc.parameters && typeof hc.parameters === 'object') {
    const o = { ...hc.parameters };
    if (!o.type) o.type = 'object';
    return finalize(o);
  }
  if (hc.input_schema && typeof hc.input_schema === 'object') {
    const o = { ...hc.input_schema };
    if (!o.type) o.type = 'object';
    return finalize(o);
  }
  return finalize({ type: 'object', properties: {} });
}

/**
 * True when handler_config declares any known execution dispatch path.
 * @param {Record<string, unknown>} config
 */
function handlerConfigHasExecutionPath(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  return Boolean(
    trim(config.dispatch_target) ||
      trim(config.dispatcher) ||
      trim(config.binding) ||
      trim(config.env_key) ||
      trim(config.sql) ||
      trim(config.target_type) ||
      trim(config.executor) ||
      trim(config.module) ||
      trim(config.executor_module) ||
      trim(config.handler) ||
      trim(config.script) ||
      trim(config.command_id) ||
      trim(config.command_slug) ||
      trim(config.slug),
  );
}

function handlerConfigHasCommandFabric(config, row) {
  return Boolean(
    trim(config?.command_id) ||
      trim(config?.command_slug) ||
      trim(config?.slug) ||
      (trim(row?.handler_key) && String(row.handler_key).startsWith('cmd_')),
  );
}

/**
 * Browser / MYBROWSER tools dispatch by dispatcher name or legacy operation field.
 * @param {Record<string, unknown>} config
 */
function handlerConfigHasBrowserDispatch(config) {
  return Boolean(trim(config.dispatcher) || trim(config.operation) || handlerConfigHasExecutionPath(config));
}

/**
 * Fail closed before credential resolution / executor dispatch.
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} config
 * @param {Set<string>} [executableTypes]
 */
export function validateHandlerConfigForExecution(row, config, executableTypes = EXECUTABLE_HANDLER_TYPES) {
  const handlerType = trim(row?.handler_type).toLowerCase();
  const toolKey = trim(row?.tool_key || row?.tool_name);

  if (!executableTypes?.has(handlerType)) {
    return {
      ok: false,
      error: `unsupported agentsam_tools.handler_type=${handlerType || '(empty)'}`,
    };
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) || !Object.keys(config).length) {
    return { ok: false, error: `invalid handler_config for tool_key=${toolKey}` };
  }

  switch (handlerType) {
    case 'http':
      if (!trim(config.base_url) && !trim(config.endpoint) && !trim(config.path)) {
        return { ok: false, error: `handler_config requires base_url or endpoint for tool_key=${toolKey}` };
      }
      break;
    case 'workspace_argv':
      if (!trim(config.script) || !trim(config.dispatcher)) {
        return {
          ok: false,
          error: `handler_config requires dispatcher and script for tool_key=${toolKey}`,
        };
      }
      break;
    case 'hyperdrive':
    case 'supabase':
    case 'container':
    case 'terminal':
    case 'r2':
    case 'websearch':
      if (!handlerConfigHasExecutionPath(config)) {
        return {
          ok: false,
          error: `handler_config requires dispatch_target, binding, env_key, or dispatcher for tool_key=${toolKey}`,
        };
      }
      break;
    case 'ai':
      if (
        trim(config.execution_lane) === 'open_web_search' ||
        trim(config.execution_lane) === 'web_fetch' ||
        handlerConfigHasExecutionPath(config)
      ) {
        break;
      }
      if (!trim(config.auth_source)) {
        return { ok: false, error: `handler_config.auth_source required for tool_key=${toolKey}` };
      }
      break;
    case 'builtin':
      if (!trim(config.dispatcher)) {
        return { ok: false, error: `handler_config.dispatcher required for tool_key=${toolKey}` };
      }
      break;
    case 'github':
      if (!trim(config.auth_source)) {
        return { ok: false, error: `handler_config.auth_source required for tool_key=${toolKey}` };
      }
      break;
    case 'filesystem':
      if (
        !trim(config.auth_source) &&
        !trim(config.binding) &&
        !trim(config.env_key) &&
        !handlerConfigHasExecutionPath(config)
      ) {
        return {
          ok: false,
          error: `handler_config requires auth_source, binding, or env_key for tool_key=${toolKey}`,
        };
      }
      break;
    case 'mybrowser':
    case 'browser':
      if (!handlerConfigHasBrowserDispatch(config)) {
        return {
          ok: false,
          error: `handler_config requires dispatcher, operation, or execution path for tool_key=${toolKey}`,
        };
      }
      break;
    case 'deploy':
    case 'git':
    case 'command':
      if (!handlerConfigHasCommandFabric(config, row)) {
        return {
          ok: false,
          error: `handler_config requires command_id or command_slug (agentsam_commands) for tool_key=${toolKey}`,
        };
      }
      break;
    case 'd1':
    case 'cf':
    case 'memory':
    case 'notify':
    case 'workflow':
    case 'agent':
    case 'media':
    case 'canvas':
    case 'integrations': {
      const hasInProcessKey = Boolean(trim(row?.handler_key) || toolKey);
      const mediaLike = handlerType === 'media' || handlerType === 'canvas';
      const agentLike = handlerType === 'agent';
      if (
        !trim(config.auth_source) &&
        !trim(config.operation) &&
        !handlerConfigHasExecutionPath(config) &&
        !(mediaLike && hasInProcessKey) &&
        !(agentLike && (handlerConfigHasExecutionPath(config) || hasInProcessKey))
      ) {
        return {
          ok: false,
          error: `handler_config requires auth_source, operation, or execution path for tool_key=${toolKey}`,
        };
      }
      break;
    }
    case 'mcp':
    case 'proxy':
    case 'workspace.reader': {
      const op = trim(config.operation);
      const url = trim(row?.mcp_service_url) || trim(config.mcp_service_url);
      const mod = trim(config.module || config.executor_module);
      const handler = trim(config.handler);
      const internal = trim(config.binding).toLowerCase() === 'internal';
      if (!op && !url && !mod && !handler && !internal) {
        return {
          ok: false,
          error: `handler_config requires operation, mcp_service_url, module, or internal binding for tool_key=${toolKey}`,
        };
      }
      if (!trim(config.auth_source)) {
        return { ok: false, error: `handler_config.auth_source required for tool_key=${toolKey}` };
      }
      break;
    }
    default:
      break;
  }
  return { ok: true };
}

export function rowMatchesWorkspaceScope(row, workspaceId) {
  const ws = trim(workspaceId);
  const scope = parseJsonSafe(row?.workspace_scope, ['*']);
  const arr = Array.isArray(scope) ? scope : ['*'];
  if (arr.includes('*')) return true;
  if (!ws) return false;
  return arr.some((x) => trim(x) === ws);
}

export function rowMatchesMode(row, modeSlug) {
  const mode = trim(modeSlug).toLowerCase();
  if (!mode) return true;
  const modes = parseJsonSafe(row?.modes_json, []);
  if (!Array.isArray(modes) || !modes.length) return true;
  return modes.map((m) => trim(m).toLowerCase()).includes(mode);
}

export function rowWithinRiskCap(row, maxRisk) {
  const cap = trim(maxRisk).toLowerCase();
  if (!cap) return true;
  const capN = RISK_ORDER[cap];
  if (capN == null) return true;
  const rl = trim(row?.risk_level).toLowerCase() || 'low';
  const rowN = RISK_ORDER[rl] ?? 0;
  return rowN <= capN;
}

function rowPassesAllowlist(row, allowKeys) {
  if (!allowKeys || !allowKeys.size) return true;
  const keys = [
    trim(row.tool_key),
    trim(row.tool_name),
    trim(row.display_name),
  ].filter(Boolean);
  return keys.some((k) => allowKeys.has(k.toLowerCase()));
}

const AGENTSAM_TOOL_ROW_SELECT = `SELECT id, tool_key, tool_code, tool_name, display_name, handler_type, handler_config, handler_key,
            linked_mcp_tool_id, mcp_service_url, tool_category, input_schema, output_schema, cache_policy_json,
            result_policy_json, capability_key, risk_level,
            requires_approval, workspace_scope, modes_json, is_active, is_degraded, caller_policy, updated_at_unix
     FROM agentsam_tools
     WHERE COALESCE(is_active, 1) = 1
       AND COALESCE(is_degraded, 0) = 0`;

/**
 * Point lookup by one equality column (indexable). Prefer tool_key, then tool_name.
 * @param {any} env
 * @param {string} column
 * @param {string} value
 */
async function loadAgentsamToolRowByColumn(env, column, value) {
  return env.DB.prepare(`${AGENTSAM_TOOL_ROW_SELECT} AND ${column} = ? LIMIT 1`)
    .bind(value)
    .first();
}

/**
 * @param {any} env
 * @param {string} toolCodeOrKey
 */
export async function loadAgentsamToolRow(env, toolCodeOrKey) {
  const key = trim(toolCodeOrKey);
  if (!env?.DB || !key) return null;
  // Split OR-of-five into sequential equality lookups so D1 can use unique indexes
  // instead of scanning every alias column on every tool resolve.
  const byKey = await loadAgentsamToolRowByColumn(env, 'tool_key', key);
  if (byKey) return byKey;
  const byName = await loadAgentsamToolRowByColumn(env, 'tool_name', key);
  if (byName) return byName;
  const byCode = await loadAgentsamToolRowByColumn(env, 'tool_code', key);
  if (byCode) return byCode;
  const byDisplay = await loadAgentsamToolRowByColumn(env, 'display_name', key);
  if (byDisplay) return byDisplay;
  const byHandler = await loadAgentsamToolRowByColumn(env, 'handler_key', key);
  if (byHandler) return byHandler;
  const keyLc = key.toLowerCase();
  if (keyLc === key) return null;
  return loadAgentsamToolRowByColumn(env, 'handler_key', keyLc);
}

/**
 * MCP / OAuth catalog identity — resolves to agentsam_tools.tool_key (no capability_aliases remaps).
 * @returns {string}
 */
export async function resolveCatalogToolKeyFromPublicName(env, publicName) {
  const name = trim(publicName);
  if (!name) return '';
  const row = await loadAgentsamToolRow(env, name);
  return row?.tool_key ? trim(row.tool_key) : name;
}

/**
 * @param {any} env
 * @param {{
 *   workspaceId?: string|null,
 *   tenantId?: string|null,
 *   userId?: string|null,
 *   categories?: string[]|null,
 *   modeSlug?: string|null,
 *   limit?: number,
 *   allowlistKeys?: Set<string>|null,
 *   riskLevelMax?: string|null,
 *   requireValidHandlerConfig?: boolean,
 * }} opts
 */
export async function listAgentsamToolsForContext(env, opts = {}) {
  if (!env?.DB) return [];
  const domains = (opts.domains || [])
    .map((d) => trim(d).toLowerCase())
    .filter(Boolean);
  const categories = (opts.categories || [])
    .map((c) => trim(c).toLowerCase())
    .filter(Boolean);
  const lim = Math.max(
    1,
    Math.min(MAX_AGENT_TOOL_LIST_LIMIT, Number(opts.limit) || DEFAULT_AGENT_TOOL_LIST_LIMIT),
  );
  const ws = trim(opts.workspaceId);

  let results = [];
  try {
    const domainFilter = domains.length ? buildToolDomainFilterClause(domains) : null;
    const categoryFilter = !domainFilter && categories.length ? buildToolCategoryFilterClause(categories) : null;
    const filter = domainFilter || categoryFilter || { clause: '1 = 1', binds: [] };
    const { results: rows } = await env.DB.prepare(
      `SELECT tool_key, tool_name, display_name, tool_category, description,
              input_schema, handler_config, capability_key, risk_level, requires_approval,
              modes_json, workspace_scope, handler_type, is_degraded, mcp_service_url
       FROM agentsam_tools
       WHERE COALESCE(is_active, 1) = 1
         AND COALESCE(is_degraded, 0) = 0
         AND (dispatch_target IS NULL OR dispatch_target IN ('internal', 'both'))
         AND ${filter.clause}
       ORDER BY COALESCE(sort_priority, 50) ASC, tool_name ASC
       LIMIT ?`,
    )
      .bind(...filter.binds, Math.min(lim * 4, 120))
      .all();
    results = rows || [];
  } catch (e) {
    console.warn('[agentsam-tools-catalog] list', e?.message ?? e);
    return [];
  }

  const allow = opts.allowlistKeys;
  const requireCfg = opts.requireValidHandlerConfig !== false;
  const executableTypes = requireCfg ? await loadExecutableHandlerTypes(env) : null;
  const out = [];
  for (const row of results) {
    if (!rowMatchesWorkspaceScope(row, ws)) continue;
    if (!rowMatchesMode(row, opts.modeSlug)) continue;
    if (!rowWithinRiskCap(row, opts.riskLevelMax)) continue;
    if (!rowPassesAllowlist(row, allow)) continue;
    if (requireCfg) {
      const cfg = parseHandlerConfig(row.handler_config);
      const v = validateHandlerConfigForExecution(
        row,
        cfg,
        executableTypes || EXECUTABLE_HANDLER_TYPES,
      );
      if (!v.ok) {
        console.warn(
          '[agentsam-tools-catalog] skip_invalid_handler_config',
          trim(row.tool_name || row.tool_key),
          v.error,
        );
        continue;
      }
    }
    out.push(row);
    if (out.length >= lim) break;
  }
  return out;
}

/**
 * Chat-shaped rows for provider tool definitions.
 * @param {Record<string, unknown>[]} rows
 */
export function mapCatalogRowsToAgentTools(rows) {
  return (rows || []).map((r) => {
    const name = trim(r.tool_name || r.tool_key);
    return {
      name,
      description: isAgentsamD1CfSqlFaceTool(name)
        ? CLOUDFLARE_D1_DATABASE_QUERY_DESCRIPTION
        : String(r.description || r.tool_name || '').slice(0, 4000),
      input_schema: inputSchemaFromAgentsamToolRow(r),
      tool_category: trim(r.tool_category) || 'builtin',
      requires_approval: Number(r.requires_approval || 0) === 1,
      tool_key: trim(r.tool_key),
      capability_key: trim(r.capability_key),
    };
  });
}

/**
 * Deterministic agent-chat tool pick (agentsam_tools branded catalog).
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{ userId?: string, tenantId?: string, workspaceId?: string, personUuid?: string }} runtimeCtx
 * @param {{
 *   routeToolRequirements: import('./agentsam-route-tool-resolver.js').RouteToolRequirements,
 *   message?: string,
 *   taskType?: string,
 *   modeSlug?: string,
 *   catalogLimit?: number,
 *   outputLimit?: number,
 *   allowlistKeys?: Set<string>|null,
 *   riskLevelMax?: string|null,
 *   mcpServerKeys?: string[]|null,
 * }} opts
 */
export async function selectAgentsamToolsForAgentChat(db, runtimeCtx, opts) {
  const req = opts.routeToolRequirements;
  const outputLimit = Math.max(0, Math.min(MAX_AGENT_TOOL_LIST_LIMIT, Number(opts.outputLimit) || 20));
  if (!req || (req.max_tools != null && Number(req.max_tools) === 0) || outputLimit === 0) {
    return { rows: [], missingRequiredCapabilities: [], usedLegacyFallback: false };
  }

  const mcpServerKeys = [...new Set((opts.mcpServerKeys || []).map((k) => trim(k)).filter(Boolean))];

  // ─── Ambient credential filter context ────────────────────────────────────
  const userId = runtimeCtx?.userId != null ? String(runtimeCtx.userId).trim() : '';
  const workspaceId = runtimeCtx?.workspaceId != null ? String(runtimeCtx.workspaceId).trim() : '';
  let workspaceRoot = '';
  if (workspaceId) {
    try {
      const wsSettings = await db
        .prepare('SELECT settings_json FROM workspace_settings WHERE workspace_id = ? LIMIT 1')
        .bind(workspaceId)
        .first();
      if (wsSettings?.settings_json) {
        const parsed =
          typeof wsSettings.settings_json === 'string'
            ? JSON.parse(wsSettings.settings_json)
            : wsSettings.settings_json;
        workspaceRoot = trim(parsed?.workspace_root);
      }
    } catch (_) {
      workspaceRoot = '';
    }
  }
  const connectedProviders = await loadConnectedProviders(db, userId || null);

  let domains = toolDomainsFromRouteRequirements(req);
  const lanes = (req?.allowed_lanes || []).filter(Boolean);
  let categories = toolCategoriesFromLanes(lanes);
  if (!domains.length && !categories.length) {
    categories = await inferToolCategoriesForContext(
      '',
      opts.message,
      opts.modeSlug,
      db,
    );
  }
  if (mcpServerKeys.length) {
    for (const d of toolDomainsFromRouteRequirements({ allowed_lanes: ['operate', 'observe', 'admin', 'develop'] })) {
      domains.push(d);
    }
    const cfCats = toolCategoriesFromLanes(['operate', 'observe', 'admin', 'develop']);
    categories = [...new Set([...categories, 'cloudflare', ...cfCats])];
  }
  const uniqueDomains = [...new Set(domains.map((d) => trim(d).toLowerCase()).filter(Boolean))];
  if (!uniqueDomains.length && !categories.length) {
    return { rows: [], missingRequiredCapabilities: [], usedLegacyFallback: false, allowedDomains: [] };
  }

  const catalogLimit = Math.max(
    outputLimit,
    Math.min(120, Number(opts.catalogLimit) || outputLimit * 4),
  );

  const rawRows = await listAgentsamToolsForContext(
    { DB: db },
    {
      workspaceId: runtimeCtx?.workspaceId,
      tenantId: runtimeCtx?.tenantId,
      userId: runtimeCtx?.userId,
      domains: uniqueDomains,
      categories: uniqueDomains.length ? [] : categories,
      modeSlug: opts.modeSlug,
      limit: catalogLimit,
      allowlistKeys: opts.allowlistKeys ?? null,
      riskLevelMax: opts.riskLevelMax ?? null,
    },
  );

  // No JS OAuth/workspace_root pre-filters — handlers enforce at call time.
  void connectedProviders;
  void workspaceRoot;
  void TOOL_OAUTH_REQUIREMENTS;
  void TOOLS_REQUIRING_WORKSPACE_ROOT;
  const filteredRawRows = (rawRows || []).filter((row) => {
    const toolName = trim(row?.tool_name || row?.tool_key);
    return !!toolName;
  });

  const reqCaps = req.required_capabilities || [];
  const optCaps = req.optional_capabilities || [];
  const blocked = req.blocked_capabilities || [];

  const candidates = [];
  for (const raw of filteredRawRows) {
    let blockedRow = false;
    for (const b of blocked) {
      if (brandedRowMatchesRouteCapability(raw, b)) {
        blockedRow = true;
        break;
      }
    }
    if (blockedRow) continue;
    candidates.push({ raw, row: mapCatalogRowsToAgentTools([raw])[0] });
  }

  const missing = [];
  for (const cap of reqCaps) {
    if (!candidates.some(({ raw }) => brandedRowMatchesRouteCapability(raw, cap))) {
      missing.push(String(cap));
      console.warn('[selectAgentsamToolsForAgentChat] missing_required_capability', cap);
    }
  }

  if (mcpServerKeys.length) {
    const templateLimit = Math.max(outputLimit, Math.min(96, catalogLimit));
    const templateRows = await loadCatalogRowsForMcpTemplate(db, runtimeCtx, mcpServerKeys, templateLimit);
    const existingNames = new Set(candidates.map((c) => trim(c.raw.tool_name)).filter(Boolean));
    for (const raw of templateRows) {
      const nm = trim(raw.tool_name);
      if (!nm) continue;
      let blockedRow = false;
      for (const b of blocked) {
        if (brandedRowMatchesRouteCapability(raw, b)) {
          blockedRow = true;
          break;
        }
      }
      if (blockedRow) continue;
      if (!rowPassesAllowlist(raw, opts.allowlistKeys ?? null)) continue;
      if (!rowWithinRiskCap(raw, opts.riskLevelMax)) continue;
      if (existingNames.has(nm)) {
        const idx = candidates.findIndex((c) => trim(c.raw.tool_name) === nm);
        if (idx >= 0) candidates[idx] = { raw, row: mapCatalogRowsToAgentTools([raw])[0] };
        continue;
      }
      existingNames.add(nm);
      candidates.push({ raw, row: mapCatalogRowsToAgentTools([raw])[0] });
    }
  }

  const score = ({ raw }) => {
    let s = Number(raw?.__mcp_template) === 1 ? MCP_TEMPLATE_SCORE_BOOST : 0;
    for (const c of reqCaps) {
      if (brandedRowMatchesRouteCapability(raw, c)) s += 100;
    }
    for (const c of optCaps) {
      if (brandedRowMatchesRouteCapability(raw, c)) s += 10;
    }
    return s;
  };
  candidates.sort(
    (a, b) =>
      score(b) - score(a) || String(a.raw.tool_name).localeCompare(String(b.raw.tool_name)),
  );

  const routeMax =
    req.max_tools != null && Number(req.max_tools) > 0 ? Math.floor(Number(req.max_tools)) : outputLimit;
  const maxOut = Math.max(0, Math.min(outputLimit, routeMax));
  const rows = candidates.slice(0, maxOut).map((c) => c.row);
  return {
    rows,
    missingRequiredCapabilities: missing,
    usedLegacyFallback: false,
    allowedDomains: uniqueDomains,
    droppedUnknownLanes: lanes.filter((l) => {
      const key = trim(l).toLowerCase();
      return key && !LANE_TO_DOMAINS[key] && !LANE_TO_TOOL_CATEGORIES[key];
    }),
  };
}

/**
 * Non–agent-chat runtime list (lane inferred from message).
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{ workspaceId?: string, tenantId?: string, userId?: string }} runtimeCtx
 * @param {{
 *   lane?: string,
 *   message?: string,
 *   modeSlug?: string,
 *   outputLimit?: number,
 *   allowlistKeys?: Set<string>|null,
 *   riskLevelMax?: string|null,
 * }} opts
 */
export async function selectAgentsamToolsForChatRuntime(db, runtimeCtx, opts = {}) {
  const outputLimit = Math.max(1, Math.min(MAX_AGENT_TOOL_LIST_LIMIT, Number(opts.outputLimit) || 20));
  const categories = opts.lane
    ? toolCategoriesFromLanes([opts.lane])
    : await inferToolCategoriesForContext('', opts.message, opts.modeSlug, db);
  if (!categories.length) return [];

  const rawRows = await listAgentsamToolsForContext(
    { DB: db },
    {
      workspaceId: runtimeCtx?.workspaceId,
      tenantId: runtimeCtx?.tenantId,
      userId: runtimeCtx?.userId,
      categories,
      modeSlug: opts.modeSlug,
      limit: outputLimit,
      allowlistKeys: opts.allowlistKeys ?? null,
      riskLevelMax: opts.riskLevelMax ?? null,
    },
  );
  return mapCatalogRowsToAgentTools(rawRows);
}

/**
 * List only explicit tool_key rows (OAuth allowlist / token allowed_tools).
 * @param {any} env
 * @param {Set<string>} allowlistKeys lowercased tool_key / display_name / tool_name
 * @param {{ workspaceId?: string, limit?: number, riskLevelMax?: string|null }} opts
 */
export async function listAgentsamToolsByKeys(env, allowlistKeys, opts = {}) {
  if (!env?.DB || !allowlistKeys?.size) return [];
  const keys = [...allowlistKeys].map((k) => trim(k)).filter(Boolean);
  if (!keys.length) return [];
  const lim = Math.max(1, Math.min(MAX_AGENT_TOOL_LIST_LIMIT, Number(opts.limit) || keys.length));
  // D1 bind ceiling ~100. Each key is bound 3× (tool_key/tool_name/display_name) + LIMIT.
  const CHUNK = 30;
  const ws = trim(opts.workspaceId);
  const executableTypes = await loadExecutableHandlerTypes(env);
  /** @type {Map<string, any>} */
  const byId = new Map();
  try {
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = keys.slice(i, i + CHUNK);
      const placeholders = slice.map(() => '?').join(',');
      const lowers = slice.map((k) => k.toLowerCase());
      const { results } = await env.DB.prepare(
        `SELECT tool_key, tool_name, display_name, tool_category, description,
                input_schema, handler_config, capability_key, risk_level, requires_approval,
                modes_json, workspace_scope, handler_type, is_degraded, mcp_service_url
         FROM agentsam_tools
         WHERE COALESCE(is_active, 1) = 1
           AND COALESCE(is_degraded, 0) = 0
           AND (dispatch_target IS NULL OR dispatch_target IN ('internal', 'both'))
           AND (
             lower(tool_key) IN (${placeholders})
             OR lower(tool_name) IN (${placeholders})
             OR lower(display_name) IN (${placeholders})
           )
         ORDER BY COALESCE(sort_priority, 50) ASC, tool_name ASC
         LIMIT ?`,
      )
        .bind(...lowers, ...lowers, ...lowers, Math.min(lim * 2, slice.length * 3))
        .all();
      for (const row of results || []) {
        if (!rowMatchesWorkspaceScope(row, ws)) continue;
        if (!rowWithinRiskCap(row, opts.riskLevelMax)) continue;
        const cfg = parseHandlerConfig(row.handler_config);
        const v = validateHandlerConfigForExecution(
          row,
          cfg,
          executableTypes || EXECUTABLE_HANDLER_TYPES,
        );
        if (!v.ok) continue;
        const id = String(row.tool_name || row.tool_key || '')
          .trim()
          .toLowerCase();
        if (id) byId.set(id, row);
      }
    }
    const out = [];
    const seen = new Set();
    for (const key of keys) {
      const row = byId.get(key.toLowerCase());
      if (!row) continue;
      const id = String(row.tool_name || row.tool_key || '')
        .trim()
        .toLowerCase();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(row);
      if (out.length >= lim) break;
    }
    return out;
  } catch (e) {
    console.warn('[agentsam-tools-catalog] listByKeys', e?.message ?? e);
    return [];
  }
}
