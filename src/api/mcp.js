/**
 * API Service: Model Context Protocol (MCP) Manager
 * Handles agent session tracking, tool registration listings, and intent-based routing.
 */
import { getAuthUser, jsonResponse, fetchAuthUserTenantId, resolveRequestContext } from '../core/auth.js';
import { resolveIamActorContext, resolveIdentity } from '../core/identity.js';
import { inferMcpCapabilityLane } from '../core/mcp-tools-branded.js';
import {
  listAgentsamToolsForContext,
  loadAgentsamToolRow,
  mapCatalogRowsToAgentTools,
  toolCategoriesFromLanes,
  DEFAULT_AGENT_TOOL_LIST_LIMIT,
} from '../core/agentsam-tools-catalog.js';
import { MCP_CANONICAL_CLIENT_ID } from './mcp-oauth-shared.js';
import {
  AGENTSAM_WORKFLOW_RUNS_TABLE,
  listWorkflowsForSubagentSlug,
  maxAgentsamWorkflowTimeoutSeconds,
} from '../../backend/workflows/index.js';
import { scheduleRecordMcpToolExecution } from '../core/mcp-tool-execution.js';
import { scheduleToolCallLog } from '../core/agentsam-ops-ledger.js';
import { resolveActorContext } from '../core/actor-context.js';
import { authorizeMcpTool } from '../core/mcp-authorization.js';
import { dispatchByToolCode } from '../../backend/http/agentsam/routes/dispatch-by-tool-code.js';
import { resolveCanonicalUserId } from './auth.js';
import { mcpPanelAgentChatSse } from '../../backend/http/agentsam/mcp-panel-chat.js';
import {
  ensureMcpZoneWorkspace,
  loadMcpZoneSession,
  mapZoneStateToSession,
  parseMcpZoneStateJson,
  resetAllMcpZoneSessions,
  patchMcpZoneWorkspaceState,
  resetMcpZoneSession,
  resolveMcpZoneConversationId,
  resolveMcpZoneWorkspaceId,
  startMcpZoneSession,
} from '../../backend/agentsam/mcp/index.js';

const MCP_CARD_AGENT_IDS = [
  'mcp_agent_architect',
  'mcp_agent_builder',
  'mcp_agent_inspector',
  'mcp_agent_operator',
];

function normalizeMcpAgentId(agentId) {
  const s = String(agentId || '').trim();
  if (s === 'mcp_agent_tester') return 'mcp_agent_inspector';
  return s;
}

/** @deprecated Use resolveMcpZoneConversationId — kept for session_id validation alias. */
function deterministicMcpPanelSessionId(slug, tenantId) {
  return resolveMcpZoneConversationId(slug, tenantId);
}

/**
 * Resolve dispatch row from agentsam_model_catalog — no hardcoded model keys.
 * @param {string|null|undefined} tenantId Reserved for future tenant-scoped catalog filtering.
 */
async function resolveAgentModel(env, preferredModelKey, tenantId) {
  void tenantId;
  const pref =
    preferredModelKey != null && String(preferredModelKey).trim() !== ''
      ? String(preferredModelKey).trim()
      : '';

  if (pref) {
    const row = await env.DB.prepare(
      `SELECT model_key, provider, api_platform, display_name AS name
       FROM agentsam_model_catalog
       WHERE (model_key = ? OR id = ?) AND COALESCE(is_active, 1) = 1
       LIMIT 1`,
    )
      .bind(pref, pref)
      .first()
      .catch(() => null);
    if (row) return row;
  }

  const fallback = await env.DB.prepare(
    `SELECT model_key, provider, api_platform, display_name AS name
     FROM agentsam_model_catalog
     WHERE COALESCE(is_active, 1) = 1
       AND COALESCE(supports_tools, 0) = 1
     ORDER BY COALESCE(cost_per_1k_in, 9999) ASC, display_name ASC
     LIMIT 1`,
  )
    .first()
    .catch(() => null);

  return fallback || null;
}

/** Fixed MCP dashboard experiment zones — sole cards on /dashboard/mcp */
const MCP_PANEL_ZONE_SLUGS = ['engineer', 'architect', 'cms', 'specialist'];

function normalizeMcpPanelZoneSlug(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  if (MCP_PANEL_ZONE_SLUGS.includes(s)) return s;
  const legacy = {
    builder: 'engineer',
    mcp_agent_builder: 'engineer',
    mcp_agent_architect: 'architect',
    mcp_agent_inspector: 'specialist',
    mcp_agent_operator: 'engineer',
    analyst: 'specialist',
    devops: 'engineer',
    operator: 'engineer',
    inspector: 'specialist',
  };
  return legacy[s] ?? null;
}

const MCP_PANEL_SLUG_DENYLIST = [
  'recall',
  'toolbox',
  'tester',
  'codex-default',
  'codex-worker',
  'codex-explorer',
  'pr-explorer',
  'batch-processor',
  'course_users',
  'code-check',
  'ollama-boilerplate',
  'ollama-analyst',
  'ollama-agent',
  'cadcreator',
  'cadvalidator',
  'assetpublisher',
  'excalidrawplanner',
  'meauxcad-operator',
  'wai-tier1-agentic',
  'wai-tier2-limited',
  'wai-tier3-textonly',
];

const MCP_PANEL_AGENT_TYPES = [
  'custom',
  'builtin_orchestrator',
  'builtin_worker',
  'builtin_explorer',
  'orchestrator',
  'deploy',
];

/** Non-blocking agentsam_tool_call_log row for MCP dispatch — only when a real run exists. */
function scheduleDispatchToolCallLog(
  env,
  ctx,
  { tenantId, sessionId, userId, workspaceId, agentRunId },
) {
  const runId =
    agentRunId != null && String(agentRunId).trim() !== '' ? String(agentRunId).trim() : '';
  if (!runId) return;
  scheduleToolCallLog(env, ctx, {
    tenantId,
    workspaceId,
    sessionId,
    userId,
    agentRunId: runId,
    conversationId: sessionId ?? null,
    toolName: 'mcp_dispatch',
    toolKey: 'mcp_dispatch',
    status: 'pending',
    durationMs: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    toolCategory: 'mcp',
    sourceTool: 'mcp_dispatch',
  });
}

function resolveMcpTenantId(authUser, _env) {
  if (authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== '') {
    return String(authUser.tenant_id).trim();
  }
  return null;
}

async function resolveWorkflowTimeoutSeconds(env, tenantId) {
  const fallback = 120;
  if (!env.DB) return fallback;
  try {
    return await maxAgentsamWorkflowTimeoutSeconds(env.DB, fallback, tenantId);
  } catch (_) {
    return fallback;
  }
}

async function filterToolRowsByPanel(requestAgentId, rows, env, workspaceId, tenantId) {
  if (!requestAgentId) return rows;
  if (!env?.DB) {
    // DB unavailable — fall back to original hardcoded behaviour
    const agent = String(requestAgentId).toLowerCase();
    if (agent === 'mcp_agent_architect') return rows.filter((r) => ['github_repos','github_get_file','mcp_status'].includes(r.tool_name));
    if (agent === 'mcp_agent_tester' || agent === 'mcp_agent_inspector') return rows.filter((r) => ['playwright_run','cicd_status','mcp_status'].includes(r.tool_name));
    return rows;
  }
  try {
    const ws = workspaceId ?? '';
    const tid = tenantId ?? '';
    const { results } = await env.DB.prepare(`
      SELECT DISTINCT tool_key FROM agentsam_mcp_allowlist
      WHERE is_allowed = 1
        AND agent_id = ?
        AND (workspace_id = ? OR workspace_id = '' OR workspace_id IS NULL)
        AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')
    `).bind(String(requestAgentId), ws, tid).all();
    if (!results?.length) return rows;
    const allowed = new Set(results.map((r) => r.tool_key));
    return rows.filter((r) => allowed.has(r.tool_name) || allowed.has(r.tool_key));
  } catch (e) {
    console.warn('[filterToolRowsByPanel] DB lookup failed, falling back:', e?.message ?? e);
    return rows;
  }
}

function parseLogsJson(raw) {
  if (raw == null || raw === '') return [];
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(j)) return j.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
    return [];
  } catch (_) {
    return [];
  }
}

function isSessionStale(row, timeoutSec) {
  const st = String(row?.status || '').toLowerCase();
  if (st !== 'running' && st !== 'active') return false;
  const la = row?.last_activity;
  const noActivity = la == null || String(la).trim() === '';
  const updatedAt = Number(row?.updated_at) || 0;
  const age = Math.floor(Date.now() / 1000) - updatedAt;
  const timedOut = updatedAt > 0 && age > timeoutSec;
  return noActivity || timedOut;
}

async function resolveAgentIdFromIntent(env, prompt) {
  let agentId = 'mcp_agent_builder';
  let routedBy = 'default';
  try {
    let patterns = { results: [] };
    try {
      patterns = await env.DB.prepare(
        `SELECT mapped_command AS agent_id, pattern AS triggers_json
         FROM agentsam_command_pattern WHERE is_active = 1`,
      ).all();
      if (!(patterns.results || []).length) throw new Error('no_agentsam_patterns');
    } catch (_) {
      try {
        patterns = await env.DB.prepare(
          'SELECT workflow_agent AS agent_id, triggers_json FROM agent_intent_patterns WHERE is_active=1',
        ).all();
      } catch (_e2) {
        patterns = await env.DB.prepare(
          'SELECT agent_id, triggers_json FROM agent_intent_patterns WHERE is_active=1',
        ).all();
      }
    }
    const low = String(prompt || '').toLowerCase();
    outer: for (const p of patterns.results || []) {
      let triggers = [];
      try {
        triggers = JSON.parse(p.triggers_json || '[]');
      } catch (_) {
        triggers = p.triggers_json ? [String(p.triggers_json)] : [];
      }
      if (!Array.isArray(triggers)) triggers = triggers != null ? [String(triggers)] : [];
      for (const t of triggers) {
        if (low.includes(String(t).toLowerCase())) {
          const rawAid = String(p.agent_id || '').trim();
          agentId = normalizeMcpAgentId(rawAid);
          if (!MCP_CARD_AGENT_IDS.includes(agentId)) agentId = 'mcp_agent_builder';
          routedBy = 'intent_pattern';
          break outer;
        }
      }
    }
  } catch (_) {}
  return { agentId, routedBy };
}

function mcpJsonRpcResponse(id, result, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mcpJsonRpcError(id, message, code = -32000, status = 400) {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Load mcp_workspace_tokens row for JSON-RPC /mcp (tools/list OAuth path only). */
async function loadMcpWorkspaceTokenRow(env, bearer, mcpIdentity) {
  if (!env?.DB || !mcpIdentity) return null;
  try {
    if (mcpIdentity.tokenId) {
      return await env.DB.prepare(
        `SELECT id, workspace_id, tenant_id, user_id, allowed_tools, token_type
           FROM mcp_workspace_tokens
          WHERE id = ? AND COALESCE(is_active, 0) = 1
          LIMIT 1`,
      )
        .bind(mcpIdentity.tokenId)
        .first();
    }
    if (!bearer || bearer.includes('.')) return null;
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearer));
    const hexHash = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return await env.DB.prepare(
      `SELECT id, workspace_id, tenant_id, user_id, allowed_tools, token_type
         FROM mcp_workspace_tokens
        WHERE token_hash = ? AND COALESCE(is_active, 0) = 1
        LIMIT 1`,
    )
      .bind(hexHash)
      .first();
  } catch (e) {
    console.warn('[mcp] loadMcpWorkspaceTokenRow', e?.message ?? e);
    return null;
  }
}

/**
 * Main dispatcher for MCP-related API routes (/api/mcp/*).
 */
export async function handleMcpApi(request, url, env, ctx) {
  const pathLower = url.pathname.replace(/\/$/, '').toLowerCase();
  const method = (request.method || 'GET').toUpperCase();

  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  try {
    // JSON-RPC MCP endpoint (Bearer: HMAC user token, legacy hash, or master env token).
    // Validated here, then proxied to dedicated MCP worker with the same Authorization header.
    if (pathLower === '/mcp' && method === 'POST') {
      const reqCtx = await resolveRequestContext(request, env);
      if (reqCtx.error || reqCtx.authType !== 'bearer') {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const bodyText = await request.text();
      let rpc = null;
      try {
        rpc = JSON.parse(bodyText || '{}');
      } catch {
        return mcpJsonRpcError(null, 'Invalid JSON-RPC body', -32700, 400);
      }

      const rpcMethod = String(rpc?.method || '').trim();
      const rpcId = rpc?.id ?? null;

      // tools/list: always proxy to MCP worker (canonical schemas live there).
      // OAuth shortcut via buildOAuthToolsList was serving stale agentsam_tools input_schema.

      const upstream = String(env.MCP_SERVICE_URL || 'https://mcp.inneranimalmedia.com/mcp').trim();
      const res = await fetch(upstream, {
        method: 'POST',
        headers: request.headers,
        body: bodyText,
        redirect: 'manual',
      });
      return res;
    }

    if (pathLower === '/api/mcp/status' && method === 'GET') {
      return jsonResponse({ ok: true, service: 'mcp', status: 'connected' }, 200);
    }

    // ── Public-ish list of MCP servers (auth required, per sprint spec) ──────
    if (pathLower === '/api/mcp/servers' && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      try {
        const { results } = await env.DB.prepare(
          `SELECT id, service_name AS name, service_url AS url,
                  COALESCE(health_status, status, 'unknown') AS status,
                  COALESCE(tool_count, 0) AS tool_count
           FROM mcp_services
           ORDER BY COALESCE(updated_at, created_at) DESC
           LIMIT 200`,
        ).all().catch(() => ({ results: [] }));
        return jsonResponse({ servers: results || [] });
      } catch (_) {
        return jsonResponse({ servers: [] });
      }
    }

    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const actorCtx = await resolveIamActorContext(request, env).catch(() => null);
    const tenantId = actorCtx?.tenantId || resolveMcpTenantId(authUser, env);
    if (!tenantId) {
      return jsonResponse({ error: 'TENANT_CONTEXT_MISSING', code: 'TENANT_CONTEXT_MISSING' }, 400);
    }

    // ── MCP dashboard panel: session start, chat (SSE), session row, per-slug workflows ──
    if (pathLower === '/api/mcp/agent/session/start' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const slug = String(body.slug || '').trim();
      if (!slug) return jsonResponse({ error: 'slug required' }, 400);
      const reqCtx = await resolveRequestContext(request, env);
      if (reqCtx.error || !reqCtx.workspaceId) {
        return jsonResponse({ error: 'no_workspace', redirect: '/onboarding' }, 403);
      }
      let profile = null;
      try {
        profile = await env.DB.prepare(
          `SELECT * FROM agentsam_subagent_profile WHERE slug = ? AND is_active = 1 LIMIT 1`,
        )
          .bind(slug)
          .first();
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 500);
      }
      if (!profile) return jsonResponse({ error: 'agent not found' }, 404);
      const zoneSlug = normalizeMcpPanelZoneSlug(slug);
      if (!zoneSlug) return jsonResponse({ error: 'invalid mcp zone slug' }, 400);

      const started = await startMcpZoneSession(env, ctx, {
        zoneSlug,
        tenantId,
        userId: String(authUser.id),
        callerWorkspaceId: reqCtx.workspaceId,
      });
      if (!started.ok) {
        return jsonResponse({ error: 'zone session start failed', detail: started.error }, 503);
      }
      return jsonResponse({
        session_id: started.conversationId,
        workspace_id: started.workspaceId,
        slug: zoneSlug,
        status: 'idle',
        display_name: profile.display_name || zoneSlug,
        spawn_job_id: started.spawnJobId,
        master_run_id: started.masterRunId,
      });
    }

    const mcpAgentChatMatch = pathLower.match(/^\/api\/mcp\/agent\/([^/]+)\/chat$/);
    if (mcpAgentChatMatch && method === 'POST') {
      const slug = decodeURIComponent(String(mcpAgentChatMatch[1] || '').trim());
      const body = await request.json().catch(() => ({}));
      const message = String(body.message || '').trim();
      if (!slug || !message) return jsonResponse({ error: 'slug and message required' }, 400);

      const identity = await resolveIdentity(env, request);
      if (!identity?.workspaceId) {
        return jsonResponse({ error: 'no_workspace', redirect: '/onboarding' }, 403);
      }
      const callerWorkspaceId = String(identity.workspaceId).trim();
      const zoneSlug = normalizeMcpPanelZoneSlug(slug);
      if (!zoneSlug) return jsonResponse({ error: 'invalid mcp zone slug' }, 400);

      const zoneBoot = await ensureMcpZoneWorkspace(env, {
        zoneSlug,
        tenantId,
        userId: String(authUser.id),
        callerWorkspaceId,
      });
      if (!zoneBoot.ok) {
        return jsonResponse({ error: 'zone workspace missing', detail: zoneBoot.error }, 503);
      }
      const workspaceId = zoneBoot.workspaceId;

      let profile = null;
      try {
        profile = await env.DB.prepare(
          `SELECT * FROM agentsam_subagent_profile WHERE slug = ? AND is_active = 1 LIMIT 1`,
        )
          .bind(slug)
          .first();
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 500);
      }
      if (!profile) return jsonResponse({ error: 'agent not found' }, 404);

      const expectedSession = resolveMcpZoneConversationId(zoneSlug, tenantId);
      const sessionPk = String(body.session_id || '').trim() || expectedSession;
      if (String(body.session_id || '').trim() && sessionPk !== expectedSession) {
        return jsonResponse({ error: 'invalid session_id' }, 400);
      }

      const modelRow = await resolveAgentModel(env, profile.default_model_id, tenantId);
      if (!modelRow) {
        return jsonResponse(
          { error: 'No active model available. Add a model to agentsam_model_catalog.' },
          503,
        );
      }

      const wsStateRow = await env.DB.prepare(
        `SELECT state_json FROM agentsam_workspace_state WHERE workspace_id = ? LIMIT 1`,
      )
        .bind(workspaceId)
        .first()
        .catch(() => null);
      const zoneState = parseMcpZoneStateJson(wsStateRow?.state_json);
      const prior = Array.isArray(zoneState.messages) ? zoneState.messages : [];

      await startMcpZoneSession(env, ctx, {
        zoneSlug,
        tenantId,
        userId: String(authUser.id),
        callerWorkspaceId,
        task: message,
        createSpawnJob: false,
      }).catch(() => null);
      const recent = prior
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
        .map((m) => ({ role: m.role, content: String(m.content || '') }))
        .slice(-20);
      const messages = [...recent, { role: 'user', content: message }];

      const personUuid =
        actorCtx?.personUuid != null && String(actorCtx.personUuid).trim() !== ''
          ? String(actorCtx.personUuid).trim()
          : null;

      return mcpPanelAgentChatSse(env, request, ctx, {
        tenantId,
        userId: String(authUser.id),
        workspaceId,
        personUuid,
        sessionPkId: sessionPk,
        slug,
        profile,
        modelKey: modelRow.model_key,
        messages,
        authUser,
      });
    }

    const mcpAgentSessionGet = pathLower.match(/^\/api\/mcp\/agent\/([^/]+)\/session$/);
    if (mcpAgentSessionGet && method === 'GET') {
      const slug = decodeURIComponent(String(mcpAgentSessionGet[1] || '').trim());
      if (!slug) return jsonResponse({ error: 'slug required' }, 400);
      const zoneSlug = normalizeMcpPanelZoneSlug(slug);
      if (!zoneSlug) return jsonResponse({ error: 'invalid mcp zone slug' }, 400);
      const workspaceId = resolveMcpZoneWorkspaceId(zoneSlug, tenantId);
      const wsRow = await env.DB.prepare(
        `SELECT id, workspace_id, conversation_id, state_json, updated_at, workspace_type
           FROM agentsam_workspace_state WHERE workspace_id = ? LIMIT 1`,
      )
        .bind(workspaceId)
        .first()
        .catch(() => null);
      if (!wsRow) return jsonResponse({ error: 'session not found' }, 404);
      const session = mapZoneStateToSession(wsRow, zoneSlug);
      return jsonResponse({
        session: {
          ...session,
          workspace_id: workspaceId,
          spine: 'agentsam_workspace_state',
        },
      });
    }

    const mcpAgentWfMatch = pathLower.match(/^\/api\/mcp\/agent\/([^/]+)\/workflows$/);
    if (mcpAgentWfMatch && method === 'GET') {
      const slug = decodeURIComponent(String(mcpAgentWfMatch[1] || '').trim());
      if (!slug) return jsonResponse({ error: 'slug required' }, 400);
      const workflows = await listWorkflowsForSubagentSlug(env.DB, slug, 50).catch(() => []);
      return jsonResponse({ workflows });
    }

    // ── POST /api/mcp/catalog-invoke — in-app catalog dispatch (same path as agent chat tools)
    if (pathLower === '/api/mcp/catalog-invoke' && method === 'POST') {
      const { handleCatalogInvokeApi } = await import('../../backend/http/agentsam/routes/catalog-invoke-handler.js');
      return handleCatalogInvokeApi(request, env, ctx);
    }

    if (pathLower === '/api/mcp/server-allowlist' && method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM agentsam_mcp_allowlist ORDER BY server_name ASC LIMIT 500'
      ).all();
      return jsonResponse({ allowlist: results || [] });
    }

    if (pathLower === '/api/mcp/credentials' && method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM mcp_service_credentials ORDER BY service_name ASC LIMIT 200'
      ).all();
      return jsonResponse({ credentials: results || [] });
    }

    if (pathLower === '/api/mcp/audit' && method === 'GET') {
      const lim = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '200', 10) || 200));
      const { results } = await env.DB.prepare(
        'SELECT * FROM agentsam_mcp_tool_execution ORDER BY created_at DESC LIMIT ?'
      ).bind(lim).all();
      return jsonResponse({ audit: results || [] });
    }

    if (pathLower === '/api/mcp/stats' && method === 'GET') {
      const lim = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '200', 10) || 200));
      const { results } = await env.DB.prepare(
        `SELECT * FROM agentsam_tool_stats_compacted
         WHERE metric_date >= date('now', '-7 days')
         ORDER BY computed_at DESC, call_count DESC LIMIT ?`
      ).bind(lim).all();
      return jsonResponse({ stats: results || [] });
    }

    // ── D1-driven agent status (latest row per agent_id for tenant) ─────────
    if (pathLower === '/api/mcp/agents/status' && method === 'GET') {
      const timeoutSec = await resolveWorkflowTimeoutSeconds(env, tenantId);
      const agents = [];
      for (const zoneSlug of MCP_PANEL_ZONE_SLUGS) {
        const sess = await loadMcpZoneSession(env, { zoneSlug, tenantId });
        if (!sess) {
          agents.push({
            agent_id: zoneSlug,
            session_id: null,
            workspace_id: resolveMcpZoneWorkspaceId(zoneSlug, tenantId),
            status: 'idle',
            current_task: null,
            progress_pct: 0,
            stage: null,
            cost_usd: 0,
            tool_calls_count: 0,
            last_activity: null,
            updated_at: null,
            logs_json: [],
            is_stale: false,
          });
          continue;
        }
        const isStale = isSessionStale(sess, timeoutSec);
        agents.push({
          agent_id: zoneSlug,
          session_id: sess.id,
          workspace_id: sess.workspace_id,
          status: sess.status ?? 'idle',
          current_task: sess.current_task ?? null,
          progress_pct: Number(sess.progress_pct) || 0,
          stage: null,
          cost_usd: Number(sess.cost_usd) || 0,
          tool_calls_count: Number(sess.tool_calls_count) || 0,
          last_activity: sess.last_activity ?? null,
          updated_at: sess.updated_at != null ? Number(sess.updated_at) : null,
          logs_json: [],
          is_stale: isStale,
        });
      }
      return jsonResponse({ agents, timeout_seconds: timeoutSec, spine: 'agentsam_workspace_state' });
    }

    if (pathLower === '/api/mcp/agents/reset' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const zoneFromBody = normalizeMcpPanelZoneSlug(body.zone_slug || body.agent_id || body.slug);
      const sessionId = String(body.id || body.session_id || '').trim();
      let zoneSlug = zoneFromBody;
      if (!zoneSlug && sessionId) {
        for (const z of MCP_PANEL_ZONE_SLUGS) {
          if (sessionId === resolveMcpZoneConversationId(z, tenantId)) {
            zoneSlug = z;
            break;
          }
        }
      }
      if (!zoneSlug) return jsonResponse({ error: 'zone_slug or known session_id required' }, 400);
      try {
        const res = await resetMcpZoneSession(env, { zoneSlug, tenantId });
        return jsonResponse({ ok: res.ok === true, updated: res.ok === true, zone_slug: zoneSlug });
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 500);
      }
    }

    if (pathLower === '/api/mcp/agents/reset-all' && method === 'POST') {
      try {
        await resetAllMcpZoneSessions(env, tenantId);
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 500);
      }
      try {
        await env.DB.prepare(
          `UPDATE ${AGENTSAM_WORKFLOW_RUNS_TABLE}
              SET status = 'cancelled', completed_at = unixepoch()
            WHERE tenant_id = ? AND status = 'running'`
        ).bind(tenantId).run();
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 500);
      }
      return jsonResponse({ ok: true });
    }

    if (pathLower === '/api/mcp/agents/dispatch' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const task = String(body.task || body.prompt || '').trim();
      if (!task) return jsonResponse({ error: 'task required' }, 400);
      let agentId = normalizeMcpAgentId(body.agent_id);
      if (!agentId || !MCP_CARD_AGENT_IDS.includes(agentId)) {
        const r = await resolveAgentIdFromIntent(env, task);
        agentId = r.agentId;
      }
      const zoneSlug =
        normalizeMcpPanelZoneSlug(body.zone_slug || body.agent_slug || agentId) || 'engineer';

      const actorCtxAd = await resolveIamActorContext(request, env).catch(() => null);
      const wsAd =
        actorCtxAd?.workspaceId != null && String(actorCtxAd.workspaceId).trim() !== ''
          ? String(actorCtxAd.workspaceId).trim()
          : null;
      const uidAd =
        actorCtxAd?.userId != null && String(actorCtxAd.userId).trim() !== ''
          ? String(actorCtxAd.userId).trim()
          : authUser?.id != null
            ? String(authUser.id).trim()
            : null;
      if (!wsAd) {
        return jsonResponse({ error: 'WORKSPACE_CONTEXT_MISSING' }, 400);
      }
      if (!uidAd) {
        return jsonResponse({ error: 'USER_CONTEXT_MISSING' }, 400);
      }

      const zoneStarted = await startMcpZoneSession(env, ctx, {
        zoneSlug,
        tenantId,
        userId: uidAd,
        callerWorkspaceId: wsAd,
        task,
        createSpawnJob: true,
      });
      if (!zoneStarted.ok) {
        return jsonResponse(
          { error: 'mcp zone session start failed', detail: zoneStarted.error },
          503,
        );
      }
      const sessionId = zoneStarted.conversationId;
      const toolCallId = crypto.randomUUID();
      const zoneWs = zoneStarted.workspaceId;

      await patchMcpZoneWorkspaceState(env, {
        zoneSlug,
        tenantId,
        patch: {
          status: 'running',
          current_task: task.slice(0, 500),
          messages: [{ role: 'user', content: task }],
        },
      }).catch(() => null);

      scheduleRecordMcpToolExecution(env, ctx, {
        id: toolCallId,
        tenant_id: tenantId,
        workspace_id: zoneWs,
        user_id: uidAd,
        person_uuid: actorCtxAd?.personUuid ?? null,
        session_id: sessionId,
        conversation_id: sessionId,
        agent_run_id: zoneStarted.masterRunId ?? null,
        tool_name: 'mcp_dispatch',
        input_json: '{}',
        output_json: '',
        // Finding #3: in-flight dispatch — do not pass success:false (would mirror as error).
        status: 'pending',
        invoked_by: uidAd || 'dashboard',
        // Phase B: scheduleDispatchToolCallLog owns tool_call_log when a run exists.
        skip_tool_call_log: true,
      });
      scheduleDispatchToolCallLog(env, ctx, {
        tenantId,
        sessionId,
        userId: uidAd,
        workspaceId: zoneWs,
        agentRunId: zoneStarted.masterRunId ?? null,
        inputSummary: JSON.stringify({ route: 'agents/dispatch', task: task.slice(0, 120) }),
      });

      return jsonResponse({
        ok: true,
        session_id: sessionId,
        workspace_id: zoneWs,
        spawn_job_id: zoneStarted.spawnJobId,
        master_run_id: zoneStarted.masterRunId,
        tool_call_id: toolCallId,
        agent_id: zoneSlug,
        zone_slug: zoneSlug,
        spine: 'agentsam_workspace_state',
      });
    }

    if (pathLower === '/api/mcp/agents' && method === 'GET') {
      const zonePlace = MCP_PANEL_ZONE_SLUGS.map(() => '?').join(', ');
      const sql = `
        SELECT id, slug, display_name, agent_type, default_model_id,
               instructions_markdown, allowed_tool_globs,
               COALESCE(description, '') AS description,
               COALESCE(icon, '') AS icon,
               COALESCE(sort_order, 0) AS sort_order,
               COALESCE(can_spawn_subagents, 0) AS can_spawn_subagents
          FROM agentsam_subagent_profile
         WHERE is_active = 1
           AND slug IN (${zonePlace})
           AND (
                 COALESCE(is_platform_global, 0) = 1
              OR COALESCE(tenant_id, '') = ''
              OR tenant_id = ?
           )
         ORDER BY COALESCE(sort_order, 0) ASC, display_name ASC`;
      const bindList = [...MCP_PANEL_ZONE_SLUGS, tenantId];
      let profiles = [];
      try {
        const q = await env.DB.prepare(sql).bind(...bindList).all();
        profiles = q.results || [];
      } catch (e) {
        return jsonResponse({ error: 'agents query failed', detail: String(e?.message || e) }, 500);
      }

      const agents = [];
      for (const p of profiles) {
        const slug = String(p.slug || '').trim();
        let session = null;
        if (slug) {
          session = await loadMcpZoneSession(env, { zoneSlug: slug, tenantId });
        }
        agents.push({
          ...p,
          session: session || null,
          workspace_id: slug ? resolveMcpZoneWorkspaceId(slug, tenantId) : null,
        });
      }
      return jsonResponse({ agents });
    }

    if (pathLower === '/api/mcp/tools/catalog' && method === 'GET') {
      const laneParam = url.searchParams.get('lane');
      const mode = url.searchParams.get('mode') || '';
      const message = url.searchParams.get('q') || '';
      const rawLimit = Number(url.searchParams.get('limit') || '24');
      const limit = Math.min(120, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 24));
      const includeSchema = url.searchParams.get('include_schema') === 'true';
      const lane =
        laneParam != null && String(laneParam).trim() !== ''
          ? String(laneParam).trim()
          : await inferMcpCapabilityLane(message, '', '', mode || 'agent', env.DB);
      let tools = [];
      try {
        const actorCtx = await resolveIamActorContext(request, env).catch(() => null);
        const categories = toolCategoriesFromLanes([lane]);
        if (!categories.length) {
          return jsonResponse({ ok: true, lane, mode, limit, include_schema: includeSchema, source: 'agentsam_tools', tools: [] });
        }
        const rows = await listAgentsamToolsForContext(env, {
          workspaceId: actorCtx?.workspaceId,
          tenantId: actorCtx?.tenantId,
          userId: actorCtx?.userId,
          categories,
          modeSlug: mode || null,
          limit,
        });
        const mapped = mapCatalogRowsToAgentTools(rows);
        tools = mapped.map((t) => ({
          tool_name: t.name,
          tool_key: t.tool_key,
          description: t.description,
          tool_category: t.tool_category,
          ...(includeSchema ? { input_schema: t.input_schema } : {}),
        }));
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e), tools: [] }, 500);
      }
      return jsonResponse({
        ok: true,
        lane,
        mode,
        limit,
        include_schema: includeSchema,
        source: 'agentsam_tools',
        tools,
      });
    }

    if (pathLower === '/api/mcp/tools' && method === 'GET') {
      const panelAgent = url.searchParams.get('agent_id');
      let tools = [];
      try {
        const actorCtx = await resolveIamActorContext(request, env).catch(() => null);
        const categories = toolCategoriesFromLanes(['develop']);
        const rows = categories.length
          ? await listAgentsamToolsForContext(env, {
              workspaceId: actorCtx?.workspaceId,
              tenantId: actorCtx?.tenantId,
              userId: actorCtx?.userId,
              categories,
              limit: DEFAULT_AGENT_TOOL_LIST_LIMIT,
            })
          : [];
        const filtered = await filterToolRowsByPanel(
          panelAgent,
          rows,
          env,
          actorCtx?.workspaceId,
          actorCtx?.tenantId,
        );
        tools = filtered.map((t) => ({
          tool_name: t.tool_name || t.tool_key,
          tool_key: t.tool_key,
          description: t.description || '',
          category: t.tool_category || 'execute',
        }));
      } catch (e) {
        console.warn('[GET /api/mcp/tools]', e?.message ?? e);
      }
      return jsonResponse({ tools, source: 'agentsam_tools' });
    }

    const toolDetailMatch = pathLower.match(/^\/api\/mcp\/tools\/([^/]+)$/);
    if (toolDetailMatch && method === 'GET') {
      const toolName = decodeURIComponent(toolDetailMatch[1] || '').trim();
      if (!toolName) return jsonResponse({ error: 'tool_name required' }, 400);
      let row = null;
      try {
        const actorCtx = await resolveIamActorContext(request, env).catch(() => null);
        row = await loadAgentsamToolRow(env, toolName);
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 500);
      }
      if (!row) return jsonResponse({ error: 'Tool not found' }, 404);
      return jsonResponse(row);
    }

    const toolConfigMatch = pathLower.match(/^\/api\/mcp\/tools\/([^/]+)\/config$/);
    if (toolConfigMatch && method === 'POST') {
      let tid = authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
        ? String(authUser.tenant_id).trim()
        : null;
      if (!tid) tid = await fetchAuthUserTenantId(env, authUser.id);
      if (!tid) return jsonResponse({ error: 'Tenant required' }, 403);

      const toolName = decodeURIComponent(toolConfigMatch[1] || '').trim();
      if (!toolName) return jsonResponse({ error: 'tool_name required' }, 400);
      const body = await request.json().catch(() => ({}));
      if (!body || typeof body !== 'object') return jsonResponse({ error: 'JSON body required' }, 400);

      const { patchAgentsamToolCatalogAndMirror } = await import('../core/agentsam-mcp-registry-sync.js');
      const patch = {};
      if (body.tool_category != null) patch.tool_category = String(body.tool_category);
      if (body.mcp_service_url != null) patch.mcp_service_url = String(body.mcp_service_url);
      if (body.description != null) patch.description = String(body.description);
      if (body.input_schema != null) patch.input_schema = body.input_schema;
      if (body.requires_approval != null) patch.requires_approval = body.requires_approval;
      if (body.enabled != null) patch.is_active = body.enabled;
      if (body.handler_config != null) patch.handler_config = body.handler_config;
      if (body.handler_type != null) patch.handler_type = String(body.handler_type);
      if (body.risk_level != null) patch.risk_level = String(body.risk_level);
      if (body.modes_json != null) patch.modes_json = body.modes_json;

      const result = await patchAgentsamToolCatalogAndMirror(env, toolName, patch);
      if (!result.ok) {
        const status = result.error === 'Tool not found in agentsam_tools' ? 404 : 400;
        return jsonResponse({ error: result.error }, status);
      }
      return jsonResponse({ ok: true, tool: result.tool, source: 'agentsam_tools' });
    }

    if (pathLower === '/api/mcp/commands' && method === 'GET') {
      let rows = [];
      try {
        const { listAgentsamSlashCommands } = await import('../../backend/agentsam/catalog/commands.js');
        const catalog = await listAgentsamSlashCommands(env.DB, { limit: 200 });
        rows = (catalog || []).map((r) => ({
          id: r.id,
          slug: r.slug,
          label: r.display_name || r.name,
          description: r.description,
          routed_to_agent: r.handler_ref || r.mapped_command || null,
          sort_order: r.sort_order ?? 50,
          is_pinned: 0,
        }));
      } catch (_) {}
      if (!rows.length) {
        try {
          const legacy = await env.DB.prepare(
            'SELECT * FROM mcp_command_suggestions ORDER BY is_pinned DESC, sort_order ASC',
          ).all();
          rows = legacy.results || [];
        } catch (_) {}
      }
      return jsonResponse({ suggestions: rows });
    }

    if (pathLower === '/api/mcp/dispatch' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const prompt = String(body.prompt || body.message || '').trim();
      if (!prompt) return jsonResponse({ error: 'prompt required' }, 400);

      let zoneSlug = normalizeMcpPanelZoneSlug(body.agent || body.agent_slug || body.agent_id);
      let routedBy = zoneSlug ? 'explicit_zone' : 'default';
      if (!zoneSlug) {
        const { agentId: resolvedId, routedBy: intentRoute } = await resolveAgentIdFromIntent(env, prompt);
        zoneSlug = normalizeMcpPanelZoneSlug(resolvedId) || 'engineer';
        routedBy = intentRoute;
      }
      const agentId = zoneSlug;
      const names = {
        engineer: 'Engineer',
        architect: 'Architect',
        cms: 'CMS',
        specialist: 'Specialist',
      };
      const agentName = names[zoneSlug] || zoneSlug;

      const workspaceParam =
        body.workspace_id != null && String(body.workspace_id).trim() !== ''
          ? String(body.workspace_id).trim()
          : '';

      const actorRes = await resolveActorContext(request, env, {
        workspaceIdParam: workspaceParam || null,
        actorSource: 'mcp_dispatch',
        agentId,
      });
      if (!actorRes.ok) {
        const st = actorRes.code === 'WORKSPACE_ACCESS_DENIED' ? 403 : 400;
        return jsonResponse({ error: actorRes.message, code: actorRes.code }, st);
      }

      const authDispatch = await authorizeMcpTool(env, {
        actor: actorRes,
        toolKey: 'mcp_dispatch',
        actionType: 'read',
        resourceType: 'cms',
        resourceId: null,
        riskLevel: 'low',
        inputJson: { prompt: prompt.slice(0, 500) },
      });
      if (!authDispatch.decision.allowed) {
        return jsonResponse(
          {
            error: authDispatch.decision.denialCode,
            code: authDispatch.decision.denialCode,
            decision: authDispatch.decision,
          },
          403,
        );
      }

      const dispatchTenantId = actorRes.tenantId;

      const zoneStarted = await startMcpZoneSession(env, ctx, {
        zoneSlug,
        tenantId: dispatchTenantId,
        userId: actorRes.userId,
        callerWorkspaceId: actorRes.workspaceId,
        task: prompt,
        createSpawnJob: true,
      });
      if (!zoneStarted.ok) {
        return jsonResponse(
          { error: 'mcp zone session start failed', detail: zoneStarted.error },
          503,
        );
      }
      const sessionId = zoneStarted.conversationId;
      const toolCallId = crypto.randomUUID();
      await patchMcpZoneWorkspaceState(env, {
        zoneSlug,
        tenantId: dispatchTenantId,
        patch: {
          status: 'running',
          current_task: prompt.slice(0, 500),
          messages: [{ role: 'user', content: prompt }],
        },
      }).catch(() => null);

      const mcpRow = authDispatch.mcpRow || {};
      const toolRowId = mcpRow.id != null ? String(mcpRow.id).trim() : '';

      scheduleRecordMcpToolExecution(env, ctx, {
        id: toolCallId,
        tenant_id: actorRes.tenantId,
        workspace_id: zoneStarted.workspaceId,
        user_id: actorRes.userId,
        person_uuid: actorRes.personUuid,
        session_id: sessionId,
        conversation_id: sessionId,
        agent_run_id: zoneStarted.masterRunId ?? null,
        agent_id: agentId,
        tool_id: toolRowId || null,
        agentsam_tools_id: toolRowId || null,
        tool_key: 'mcp_dispatch',
        tool_name: 'mcp_dispatch',
        action_type: 'read',
        resource_type: 'cms',
        actor_type: actorRes.actorType,
        actor_source: actorRes.actorSource,
        policy_decision_json: JSON.stringify(authDispatch.decision),
        denial_code: authDispatch.decision.denialCode,
        requires_approval: authDispatch.decision.requiresApproval ? 1 : 0,
        timeout_ms: authDispatch.decision.maxTimeoutMs,
        input_json: JSON.stringify({ prompt: prompt.slice(0, 500) }),
        output_json: '{}',
        // Finding #3: in-flight dispatch — status pending, never success:false.
        status: 'pending',
        // Phase B: scheduleDispatchToolCallLog owns tool_call_log when a run exists.
        skip_tool_call_log: true,
      });
      scheduleDispatchToolCallLog(env, ctx, {
        tenantId: actorRes.tenantId,
        sessionId,
        userId: actorRes.userId,
        workspaceId: zoneStarted.workspaceId,
        agentRunId: zoneStarted.masterRunId ?? null,
        inputSummary: JSON.stringify({ route: 'mcp/dispatch', prompt: prompt.slice(0, 120) }),
      });
      return jsonResponse({
        ok: true,
        session_id: sessionId,
        workspace_id: zoneStarted.workspaceId,
        spawn_job_id: zoneStarted.spawnJobId,
        master_run_id: zoneStarted.masterRunId,
        agent_id: agentId,
        agent_name: agentName,
        routed_by: routedBy,
        spine: 'agentsam_workspace_state',
      });
    }

    return jsonResponse({ error: 'MCP route not found' }, 404);
  } catch (e) {
    return jsonResponse({ error: String(e.message || e) }, 500);
  }
}
