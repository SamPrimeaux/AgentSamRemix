import { parseJsonSafe } from './agent-prompt-builder.js';
import { augmentWorkspaceFsInputSchema } from './fs-tool-input-schema.js';
import { agentsamD1QueryInputSchema, CLOUDFLARE_D1_DATABASE_QUERY_DESCRIPTION, isAgentsamD1CfSqlFaceTool } from './d1-query-tool-contract.js';
import {
  selectAgentsamToolsForAgentChat,
  selectAgentsamToolsForChatRuntime,
  parseMcpTemplateServerKeys,
  loadPromptRouteMcpServerKeys,
} from './agentsam-tools-catalog.js';
import { selectOAuthMcpParityToolsForAgentChat } from './in-app-mcp-oauth-parity.js';
import { resolveUseOAuthParity } from './d1-tool-profile.js';
import {
  resolveAgentChatRouteToolRequirements,
  effectiveAgentChatToolCap,
} from './agentsam-route-tool-resolver.js';

/**
 * Catalog tool_category is D1 SSOT (prefer domain.capability).
 * Never invent 'builtin' / family labels in JS.
 * @param {Record<string, unknown>|null|undefined} row
 * @returns {string|null}
 */
export function toolCategoryFromRow(row) {
  const c = row?.tool_category != null ? String(row.tool_category).trim() : '';
  return c || null;
}

export function normalizeModeToolPolicy(raw) {
  const policy = parseJsonSafe(raw, {}) || {};
  const allowTools = policy.allow_tools || policy.allowlist || policy.allowed_tools || [];
  const denyTools = policy.deny_tools || policy.blocklist || policy.blocked_tools || [];
  const requireApprovalTools = policy.require_approval_tools || policy.confirmation_required_tools || [];
  return {
    allowTools: Array.isArray(allowTools) ? allowTools.map((v) => String(v)) : [],
    denyTools: Array.isArray(denyTools) ? denyTools.map((v) => String(v)) : [],
    requireApprovalTools: Array.isArray(requireApprovalTools) ? requireApprovalTools.map((v) => String(v)) : [],
  };
}

export async function loadModeToolPolicy(env, modeSlug, opts = {}) {
  const { loadModeToolPolicy: loadPolicy } = await import('../core/agent-mode-tool-policy.js');
  return loadPolicy(env, modeSlug, opts);
}

export function agentToolDebugEnabled(env) {
  return String(env?.AGENTSAM_TOOL_DEBUG || env?.AGENT_TOOL_DEBUG || '').trim() === '1';
}

export function agentToolNameOf(t) {
  return String(t?.name || t?.tool_name || '').trim();
}

export function agentToolCategoryOf(t) {
  return String(t?.tool_category || t?.category || '').trim().toLowerCase();
}

export const TOOL_OUTPUT_SSE_MAX = 12000;

export function inputSchemaFromAgentsamToolRow(row) {
  const toolName = row?.tool_key || row?.tool_name;
  const finalize = (schema) => augmentWorkspaceFsInputSchema(toolName, schema);
  if (isAgentsamD1CfSqlFaceTool(toolName)) return finalize(agentsamD1QueryInputSchema());
  const parsed = parseJsonSafe(row?.input_schema, null);
  if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
    const o = { ...parsed };
    if (!o.type) o.type = 'object';
    return finalize(o);
  }
  const hc = parseJsonSafe(row?.handler_config, null);
  if (hc && typeof hc === 'object') {
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
  }
  return finalize({ type: 'object', properties: {} });
}

export async function fetchAgentsamToolRowsByName(env, names) {
  if (!env?.DB || !names.length) return [];
  const placeholders = names.map(() => '?').join(',');
  try {
    const { results } = await env.DB.prepare(
      `SELECT tool_name, description, input_schema, output_schema, handler_config, tool_category,
              requires_approval, caller_policy
       FROM agentsam_tools
       WHERE COALESCE(is_active, 1) = 1 AND tool_name IN (${placeholders})`,
    )
      .bind(...names)
      .all();
    return results || [];
  } catch (e) {
    console.warn('[agent] fetchAgentsamToolRowsByName', e?.message ?? e);
    return [];
  }
}

export function chatModeUsesToolLoop(mode) {
  const m = String(mode || '').toLowerCase();
  return m === 'agent' || m === 'debug' || m === 'multitask' || m === 'ask';
}

export function shouldOpenChatToolSessionLedger({ chatAgentRunId, mode, tools, chatToolLedger }) {
  if (!chatAgentRunId || chatToolLedger) return false;
  const m = String(mode || '').toLowerCase();
  if (m === 'plan') return false;
  if (!chatModeUsesToolLoop(mode)) return false;
  return Array.isArray(tools) && tools.length > 0;
}

/**
 * Enrich schemas for tools already selected by D1 profiles/routes.
 * Does not inject tools from message heuristics or JS name bars.
 */
export async function enrichToolsFromAgentsamCatalog(env, tools, mode, _effectiveMaxTools, _opts = {}) {
  if (!chatModeUsesToolLoop(mode) || !env?.DB) return tools;
  if (!Array.isArray(tools) || !tools.length) return tools;
  const nameSet = [...new Set(tools.map((t) => String(t.name || '').trim()).filter(Boolean))];
  const rows = await fetchAgentsamToolRowsByName(env, nameSet);
  const byName = Object.fromEntries(rows.map((r) => [String(r.tool_name), r]));

  return tools.map((t) => {
    const row = byName[t.name];
    if (!row) return t;
    const cat = toolCategoryFromRow(row);
    const tk = String(t.name || '').trim();
    return {
      ...t,
      description: isAgentsamD1CfSqlFaceTool(tk)
        ? CLOUDFLARE_D1_DATABASE_QUERY_DESCRIPTION
        : String(row.description || t.description || t.name).slice(0, 4000),
      input_schema: inputSchemaFromAgentsamToolRow(row),
      ...(cat ? { tool_category: cat } : {}),
      requires_approval: Number(row.requires_approval || 0) === 1,
    };
  });
}

/** @deprecated No-op — D1 mode profiles own the menu. */
export async function ensureActiveFileCapabilityTools(_env, tools, _effectiveMaxTools, _envelope) {
  return Array.isArray(tools) ? tools : [];
}

export function isAgentDashboardSurfaceRoute(dashboardRoute) {
  const r = dashboardRoute != null ? String(dashboardRoute).trim() : '';
  return r === '/dashboard/agent' || r.startsWith('/dashboard/agent/');
}

export async function loadAgentsamMcpToolsWorkspaceLibrary(env, workspaceId, limit = 200) {
  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  if (!env?.DB || !ws) return [];
  const lim = Math.max(1, Math.min(500, Number(limit) || 200));
  try {
    const { results } = await env.DB.prepare(
      `SELECT COALESCE(tool_name, tool_key) AS tool_name, description, input_schema, tool_category,
              requires_approval, workspace_scope
       FROM agentsam_tools
       WHERE COALESCE(is_active, 1) = 1
         AND COALESCE(is_degraded, 0) = 0
         AND (
           COALESCE(is_global, 1) = 1
           OR workspace_scope IS NULL OR trim(workspace_scope) IN ('', '[]')
           OR workspace_scope LIKE '%"*"%'
           OR instr(COALESCE(workspace_scope, ''), ?) > 0
         )
       ORDER BY COALESCE(tool_name, tool_key) ASC
       LIMIT ?`,
    )
      .bind(ws, lim * 4)
      .all();
    const rows = results || [];
    const byName = new Map();
    const isGlobalScope = (scopeRaw) => {
      const s = scopeRaw != null ? String(scopeRaw).trim() : '';
      return !s || s === '[]' || s.includes('"*"');
    };
    for (const r of rows) {
      const key = String(r.tool_name || '').trim();
      if (!key) continue;
      if (isGlobalScope(r.workspace_scope)) {
        if (!byName.has(key)) byName.set(key, r);
      }
    }
    for (const r of rows) {
      const key = String(r.tool_name || '').trim();
      if (!key) continue;
      const scope = r.workspace_scope != null ? String(r.workspace_scope) : '';
      if (scope && scope.includes(ws) && !isGlobalScope(scope)) {
        byName.set(key, r);
      }
    }
    return [...byName.values()].slice(0, lim);
  } catch (e) {
    console.warn('[agent] loadAgentsamMcpToolsWorkspaceLibrary', e?.message ?? e);
    return [];
  }
}

/**
 * Catalog tool load for non-spine surfaces (MCP panel, etc.).
 * Prefer resolveRuntimeProfile when session scope is present —
 * chat spine bootstraps the same public entry and caches on the session DO.
 */
export async function loadToolsForRequest(env, modeSlug, _intent, opts = {}) {
  // Non-profile paths only: explicit caller limit. Profile path uses agentsam_tool_profiles.max_tools.
  const callerLimitRaw = opts.limit != null ? Number(opts.limit) : null;
  const callerLimit =
    callerLimitRaw != null && Number.isFinite(callerLimitRaw)
      ? Math.max(0, Math.floor(callerLimitRaw))
      : null;
  if (!env.DB) return { tools: [], toolRoutingError: null, routeToolRequirements: null };

  if (
    opts.agentChat &&
    opts.userId &&
    opts.workspaceId &&
    opts.compileViaRuntimeProfile !== false
  ) {
    try {
      const { resolveRuntimeProfile, toolsManifestFromCompiledRows } = await import(
        './runtime-profile.js'
      );
      const { applySubagentToolPolicy } = await import('./subagent-profile-resolve.js');
      const profile = await resolveRuntimeProfile(env, {
        mode: modeSlug || 'agent',
        message: opts.message || '',
        session: {
          userId: opts.userId,
          workspaceId: opts.workspaceId,
          tenantId: opts.tenantId,
          isPlatformOperator: opts.isSuperadmin === true,
        },
        overrides: {
          route_key: opts.routeKey || null,
          task_type: opts.taskType || null,
          subagent_slug: opts.subagentSlug || null,
        },
        compile_lane: 'live',
        mcpOAuthParity: opts.mcpOAuthParity,
      });
      let tools = toolsManifestFromCompiledRows(profile._compiled_tool_rows || []);
      if (opts.subagentProfileRow) {
        tools = await applySubagentToolPolicy(env, tools, opts.subagentProfileRow);
      }
      const profileCap = Number(profile.max_tools);
      const cap =
        Number.isFinite(profileCap) && profileCap >= 0
          ? profileCap
          : callerLimit != null
            ? callerLimit
            : tools.length;
      const capped = cap === 0 ? [] : tools.slice(0, cap);
      return {
        tools: capped.map((t) => ({
          name: t.name,
          description: t.description || t.name,
          input_schema: t.input_schema || { type: 'object', properties: {} },
        })),
        toolRoutingError: null,
        routeToolRequirements: {
          max_tools: Number.isFinite(profileCap) ? profileCap : capped.length,
          source: 'runtime_profile_compile',
        },
      };
    } catch (e) {
      console.warn(
        '[agent] loadToolsForRequest runtime_profile_compile_fallback',
        e?.message ?? e,
      );
    }
  }
  const policy = await loadModeToolPolicy(env, modeSlug, {
    routeKey: opts.routeKey,
    taskType: opts.taskType,
  });
  const mcpScope = {
    userId: opts.userId,
    tenantId: opts.tenantId,
    workspaceId: opts.workspaceId,
    personUuid: opts.personUuid,
  };
  const catalogLimit =
    callerLimit != null && callerLimit > 0
      ? callerLimit
      : Number(opts.catalogLimit) > 0
        ? Math.floor(Number(opts.catalogLimit))
        : 0;
  const useBranded = opts.useBrandedCatalog !== false;
  /** @type {any} */
  let routeToolRequirements = null;
  /** @type {{ code: string, message: string, missing: string[] }|null} */
  let toolRoutingError = null;
  let rows = [];

  let allowlistKeys = null;
  const uid = opts.userId != null ? String(opts.userId).trim() : '';
  const wsId = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  const tid = opts.tenantId != null ? String(opts.tenantId).trim() : '';
  const pid = opts.personUuid != null ? String(opts.personUuid).trim() : '';
  if (opts.allowlistKeySet instanceof Set && opts.allowlistKeySet.size) {
    allowlistKeys = opts.allowlistKeySet;
  } else if (wsId && (uid || tid || pid)) {
    try {
      const { resolveSessionAllowlistKeys } = await import('./session-envelope.js');
      allowlistKeys = await resolveSessionAllowlistKeys(
        env,
        { userId: uid, workspaceId: wsId, tenantId: tid, personUuid: pid },
        opts.sessionRoots,
      );
    } catch (e) {
      console.warn('[agent] mcp allowlist preload', e?.message ?? e);
    }
  }

  let mcpServerKeys = parseMcpTemplateServerKeys(opts.mcpTemplate);
  if (!mcpServerKeys.length && opts.routeKey) {
    mcpServerKeys = await loadPromptRouteMcpServerKeys(env.DB, opts.routeKey, opts.tenantId);
  }

  if (opts.agentChat && useBranded) {
    routeToolRequirements = await resolveAgentChatRouteToolRequirements(env, {
      routeKey: opts.routeKey,
      taskType: opts.taskType,
      modeSlug,
    });
    const useOAuthParity = resolveUseOAuthParity({
      mcpOAuthParity: opts.mcpOAuthParity,
      taskSpec: opts.taskSpec,
      routeKey: opts.routeKey,
    });
    // Boring law: profile / prompt-route max_tools + route_requirements only.
    // No JS invent (256 / 128) and no oauth special-case dump size.
    const prMax =
      opts.promptRouteMaxTools != null && Number.isFinite(Number(opts.promptRouteMaxTools))
        ? Number(opts.promptRouteMaxTools)
        : null;
    const mergedMax = effectiveAgentChatToolCap({
      profileMax: prMax,
      routeReqMax: routeToolRequirements?.max_tools,
    });
    routeToolRequirements = {
      ...routeToolRequirements,
      max_tools: mergedMax,
      source: useOAuthParity ? 'oauth_mcp_parity' : routeToolRequirements?.source,
    };
    if (mergedMax === 0) {
      return { tools: [], toolRoutingError: null, routeToolRequirements };
    }

    if (useOAuthParity && wsId) {
      const det = await selectOAuthMcpParityToolsForAgentChat(env.DB, mcpScope, {
        outputLimit: mergedMax,
        modeSlug,
        isPlatformOperator: opts.isSuperadmin === true,
      });
      rows = det.rows || [];
    } else {
      const det = await selectAgentsamToolsForAgentChat(env.DB, mcpScope, {
        routeToolRequirements,
        message: opts.message,
        taskType: opts.taskType,
        modeSlug,
        catalogLimit,
        outputLimit: mergedMax,
        allowlistKeys,
        mcpServerKeys,
      });
      if (det.missingRequiredCapabilities?.length) {
        const miss = det.missingRequiredCapabilities;
        console.error(
          '[agent] tool_routing_missing_required',
          JSON.stringify({
            missing: miss,
            route_key: routeToolRequirements.route_key,
            task_type: routeToolRequirements.task_type,
          }),
        );
        toolRoutingError = {
          code: 'MISSING_REQUIRED_CAPABILITY',
          message: `Missing required tool capabilities for this route: ${miss.join(', ')}`,
          missing: miss,
        };
        rows = [];
      } else {
        rows = det.rows;
      }
    }
  } else if (useBranded) {
    const outLim = callerLimit != null ? callerLimit : 0;
    rows =
      outLim > 0
        ? await selectAgentsamToolsForChatRuntime(env.DB, mcpScope, {
            outputLimit: outLim,
            message: opts.message,
            modeSlug,
            allowlistKeys,
          })
        : [];
  } else {
    const outLim = callerLimit != null ? callerLimit : 0;
    rows =
      outLim > 0
        ? await selectAgentsamToolsForChatRuntime(env.DB, mcpScope, {
            outputLimit: outLim,
            message: opts.message,
            modeSlug,
            allowlistKeys,
          })
        : [];
  }

  if (!toolRoutingError && opts.agentChat && opts.taskType && routeToolRequirements?.max_tools != null) {
    const effCap = Math.max(0, Math.floor(Number(routeToolRequirements.max_tools)));
    if (effCap === 0) {
      rows = [];
    } else if (rows.length > effCap) {
      rows = rows.slice(0, effCap);
    }
  }
  if (allowlistKeys?.size) {
    rows = rows.filter((r) => {
      const name = String(r.tool_name || r.name || '').trim();
      const key = String(r.tool_key || name).trim();
      return allowlistKeys.has(name) || allowlistKeys.has(key);
    });
  }
  if (policy.allowTools.length) {
    const allow = new Set(policy.allowTools);
    rows = rows.filter((r) => allow.has(String(r.tool_name || r.name || '')));
  }
  if (policy.denyTools.length) {
    const deny = new Set(policy.denyTools);
    rows = rows.filter((r) => !deny.has(String(r.tool_name || r.name || '')));
  }
  const preferredKeys = Array.isArray(opts.preferredToolKeys)
    ? opts.preferredToolKeys.map((k) => String(k || '').trim()).filter(Boolean)
    : [];
  if (preferredKeys.length && rows.length) {
    const prefSet = new Set(preferredKeys);
    const preferred = [];
    const rest = [];
    for (const r of rows) {
      const name = String(r.tool_name || r.name || '').trim();
      if (prefSet.has(name)) preferred.push(r);
      else rest.push(r);
    }
    rows = [...preferred, ...rest];
  }
  const tools = rows.map((r) => {
    const cat = toolCategoryFromRow(r);
    return {
      name: String(r.name || r.tool_key || r.tool_name || ''),
      description: String(r.description || ''),
      input_schema: parseJsonSafe(r.input_schema, { type: 'object', properties: {} }),
      ...(cat ? { tool_category: cat } : {}),
      requires_approval: Number(r.requires_approval || 0) === 1,
      caller_policy: r.caller_policy != null ? r.caller_policy : null,
    };
  });
  return { tools, toolRoutingError, routeToolRequirements };
}

