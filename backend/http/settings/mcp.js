/**
 * MCP settings surface: server status, ping, tool refresh/list/toggle, per-tool config.
 * - GET    /api/settings/mcp/status
 * - POST   /api/settings/mcp/servers/:id/ping
 * - POST   /api/settings/mcp/servers/:id/tools/refresh
 * - GET    /api/settings/mcp/servers/:id/tools
 * - GET/PATCH/DELETE /api/settings/mcp/servers/:id
 * - GET    /api/settings/mcp
 * - POST   /api/settings/mcp/tools/:id/toggle
 * - PATCH  /api/settings/mcp/tools/:id
 * Deconstructed from src/api/settings.js (Lane D peel D6, no behavior change).
 */
import { jsonResponse } from '../agentsam/shared.js';
import { fetchAuthUserTenantId } from '../../identity/users/tenant.js';

// No runtime hardcoded workspace IDs. If the DB is unavailable, settings endpoints should return empty lists.
const CORE_WORKSPACES_DATA = [];

async function resolveAuthTenantId(env, authUser) {
  if (authUser.tenant_id != null && String(authUser.tenant_id).trim() !== '') {
    return String(authUser.tenant_id).trim();
  }
  let tid = await fetchAuthUserTenantId(env, authUser.id);
  if (tid) return tid;
  if (authUser.email) {
    tid = await fetchAuthUserTenantId(env, authUser.email);
    if (tid) return tid;
  }
  return null;
}

async function resolveRequestWorkspaceId(env, authUser, url) {
  const fromQuery = url.searchParams.get('workspace_id');
  if (fromQuery != null && String(fromQuery).trim() !== '') return String(fromQuery).trim();
  if (!env?.DB) return '';
  const uid = String(authUser?.id || '').trim();
  try {
    const row = await env.DB.prepare(
      `SELECT default_workspace_id FROM user_settings WHERE user_id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
    if (row?.default_workspace_id != null && String(row.default_workspace_id).trim() !== '') {
      return String(row.default_workspace_id).trim();
    }
  } catch (_) {
    /* legacy schema */
  }
  try {
    const row = await env.DB.prepare(
      `SELECT active_workspace_id FROM auth_users WHERE id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
    if (row?.active_workspace_id != null && String(row.active_workspace_id).trim() !== '') {
      return String(row.active_workspace_id).trim();
    }
  } catch (_) {
    /* ignore */
  }
  return '';
}

function parseJsonSafe(str, fallback = {}) {
  if (str == null || str === '') return { ...fallback };
  try {
    const o = typeof str === 'string' ? JSON.parse(str) : str;
    return typeof o === 'object' && o !== null ? o : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function mcpLastCheckIso(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (n < 1e12) return new Date(n * 1000).toISOString();
  return new Date(n).toISOString();
}

function mcpDashboardConfigFromRow(row) {
  const meta = parseJsonSafe(row?.metadata, {});
  const saved = meta.dashboard_mcp_config;
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved;
  const url = row?.endpoint_url != null ? String(row.endpoint_url).trim() : '';
  return {
    url,
    headers: meta.suggested_headers && typeof meta.suggested_headers === 'object' ? meta.suggested_headers : {},
  };
}

async function resolveWorkspaceDisplayName(env, workspaceId) {
  const wsId = workspaceId != null && workspaceId !== '' ? String(workspaceId).trim() : '';
  if (!wsId) return { id: '', name: '' };
  const core = CORE_WORKSPACES_DATA.find((w) => String(w.id) === wsId);
  if (core) return { id: wsId, name: String(core.name || wsId) };
  if (!env?.DB) return { id: wsId, name: wsId };
  try {
    const row = await env.DB.prepare('SELECT id, name FROM workspaces WHERE id = ? LIMIT 1').bind(wsId).first();
    return { id: wsId, name: row?.name != null && String(row.name).trim() ? String(row.name).trim() : wsId };
  } catch {
    return { id: wsId, name: wsId };
  }
}

async function mcpFetchJsonRpcPing(env, endpointUrl, headersObj) {
  const t0 = Date.now();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(headersObj && typeof headersObj === 'object' ? headersObj : {}),
  };
  const token = env.MCP_AUTH_TOKEN ? String(env.MCP_AUTH_TOKEN) : '';
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(String(endpointUrl).trim(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }),
    signal: AbortSignal.timeout(5000),
  });
  const latency_ms = Date.now() - t0;
  return { res, latency_ms };
}

export async function handleSettingsMcpRoutes(request, env, ctx, authContext) {
  void ctx;
  const { authUser, url, pathLower, method, sessionUserId } = authContext || {};
  if (!authUser) return null;

  const isMcpPath = pathLower === '/api/settings/mcp' || pathLower.startsWith('/api/settings/mcp/');
  if (!isMcpPath) return null;

  // ── MCP settings surface ──────────────────────────────────────────────────
  if (pathLower === '/api/settings/mcp/status' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    try {
      const workspaceId = await resolveRequestWorkspaceId(env, authUser, url);
      const tenantId = await resolveAuthTenantId(env, authUser);
      let results = [];
      try {
        if (workspaceId || tenantId) {
          const r = await env.DB.prepare(
            `SELECT id, health_status, last_health_check, metadata
             FROM mcp_services
             WHERE (workspace_id = ? OR tenant_id = ?)
             ORDER BY service_name`,
          )
            .bind(workspaceId || null, tenantId || null)
            .all();
          results = r.results || [];
        } else {
          const r = await env.DB.prepare(
            `SELECT id, health_status, last_health_check, metadata
             FROM mcp_services
             WHERE workspace_id IS NULL
             ORDER BY service_name`,
          ).all();
          results = r.results || [];
        }
      } catch {
        const r = await env.DB.prepare(
          `SELECT id, health_status, last_health_check, metadata FROM mcp_services ORDER BY service_name`,
        ).all();
        results = r.results || [];
      }
      const servers = (results || []).map((row) => {
        const meta = parseJsonSafe(row.metadata, {});
        const lat = meta.last_latency_ms;
        return {
          id: String(row.id),
          health_status: row.health_status != null ? String(row.health_status) : 'unknown',
          last_check_at: mcpLastCheckIso(row.last_health_check),
          latency_ms: lat != null && Number.isFinite(Number(lat)) ? Number(lat) : null,
        };
      });
      return jsonResponse({ servers });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  {
    const m = pathLower.match(/^\/api\/settings\/mcp\/servers\/([^/]+)\/ping$/);
    if (m && method === 'POST') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const id = decodeURIComponent(m[1] || '').trim();
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      try {
        const row = await env.DB.prepare(`SELECT id, endpoint_url, metadata FROM mcp_services WHERE id = ?`).bind(id).first();
        if (!row?.endpoint_url || !String(row.endpoint_url).trim().startsWith('http')) {
          return jsonResponse({ status: 'unreachable', latency_ms: null });
        }
        const cfg = mcpDashboardConfigFromRow(row);
        const hdrs = cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {};
        let status = 'unreachable';
        let latency_ms = null;
        try {
          const { res, latency_ms: ms } = await mcpFetchJsonRpcPing(
            env,
            cfg.url && String(cfg.url).trim().startsWith('http') ? String(cfg.url).trim() : String(row.endpoint_url).trim(),
            hdrs,
          );
          latency_ms = ms;
          status = res.ok ? 'healthy' : 'unreachable';
        } catch {
          status = 'unreachable';
        }
        const health_status = status === 'healthy' ? 'healthy' : 'unreachable';
        try {
          const meta = parseJsonSafe(row.metadata, {});
          meta.last_latency_ms = latency_ms;
          await env.DB.prepare(
            `UPDATE mcp_services SET health_status = ?, last_health_check = unixepoch(),
             metadata = json_set(COALESCE(metadata, '{}'), '$.last_latency_ms', ?),
             updated_at = unixepoch() WHERE id = ?`,
          )
            .bind(health_status, latency_ms ?? null, id)
            .run();
        } catch {
          /* ignore */
        }
        return jsonResponse({ status, latency_ms });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }
  }

  {
    const m = pathLower.match(/^\/api\/settings\/mcp\/servers\/([^/]+)\/tools\/refresh$/);
    if (m && method === 'POST') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const id = decodeURIComponent(m[1] || '').trim();
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      try {
        const row = await env.DB.prepare(`SELECT id, endpoint_url, metadata FROM mcp_services WHERE id = ?`).bind(id).first();
        if (!row?.endpoint_url) return jsonResponse({ error: 'Server not found' }, 404);
        const cfg = mcpDashboardConfigFromRow(row);
        const url =
          cfg.url && String(cfg.url).trim().startsWith('http')
            ? String(cfg.url).trim()
            : String(row.endpoint_url).trim();
        const hdrs = cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {};
        const headers = {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...hdrs,
        };
        const token = env.MCP_AUTH_TOKEN ? String(env.MCP_AUTH_TOKEN) : '';
        if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
          signal: AbortSignal.timeout(8000),
        });
        const text = await resp.text();
        let tools = [];
        try {
          const line = text.split('\n').find((l) => {
            const t = l.trim();
            return t.startsWith('data:') || t.startsWith('{');
          });
          const raw = line
            ? line.trim().startsWith('data:')
              ? line.trim().slice(5).trim()
              : line.trim()
            : '{}';
          const json = JSON.parse(raw || '{}');
          const rawTools = json?.result?.tools;
          tools = Array.isArray(rawTools)
            ? rawTools.map((t) => ({
                name: String(t?.name || ''),
                description: t?.description != null ? String(t.description) : '',
                inputSchema: t?.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : null,
              }))
            : [];
        } catch {
          tools = [];
        }
        return jsonResponse({ tools, source: 'live', ok: resp.ok });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e), tools: [], source: 'live' }, 502);
      }
    }
  }

  {
    const m = pathLower.match(/^\/api\/settings\/mcp\/servers\/([^/]+)\/tools$/);
    if (m && method === 'GET') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const id = decodeURIComponent(m[1] || '').trim();
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      try {
        const row = await env.DB.prepare(`SELECT endpoint_url FROM mcp_services WHERE id = ?`).bind(id).first();
        if (!row?.endpoint_url) return jsonResponse({ error: 'Server not found' }, 404);
        const ep = String(row.endpoint_url).trim();
        const { results } = await env.DB.prepare(
          `SELECT COALESCE(tool_name, tool_key) AS tool_name, description, input_schema, COALESCE(is_active, 1) AS enabled
           FROM agentsam_tools WHERE mcp_service_url = ? ORDER BY COALESCE(tool_name, tool_key)`,
        )
          .bind(ep)
          .all();
        const tools = (results || []).map((t) => {
          let inputSchema = null;
          if (t.input_schema != null && String(t.input_schema).trim() !== '') {
            try {
              inputSchema = JSON.parse(String(t.input_schema));
            } catch {
              inputSchema = { raw: String(t.input_schema) };
            }
          }
          return {
            name: String(t.tool_name || ''),
            description: t.description != null ? String(t.description) : '',
            inputSchema,
            enabled: Number(t.enabled ?? 0) === 1,
          };
        });
        return jsonResponse({ tools, source: 'registry' });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }
  }

  {
    const m = pathLower.match(/^\/api\/settings\/mcp\/servers\/([^/]+)$/);
    if (m && method === 'PATCH') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const id = decodeURIComponent(m[1] || '').trim();
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const body = await request.json().catch(() => ({}));
      try {
        const row = await env.DB.prepare(`SELECT id, metadata, endpoint_url FROM mcp_services WHERE id = ?`).bind(id).first();
        if (!row) return jsonResponse({ error: 'Server not found' }, 404);
        if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
          const on = body.enabled === true || body.enabled === 1 || body.enabled === '1';
          await env.DB.prepare(`UPDATE mcp_services SET is_active = ?, updated_at = unixepoch() WHERE id = ?`)
            .bind(on ? 1 : 0, id)
            .run();
        }
        if (Object.prototype.hasOwnProperty.call(body, 'config') && body.config && typeof body.config === 'object') {
          const cfgJson = JSON.stringify(body.config);
          const newUrl =
            typeof body.config.url === 'string' && body.config.url.trim().startsWith('http')
              ? body.config.url.trim()
              : null;
          await env.DB.prepare(
            `UPDATE mcp_services SET
               metadata = json_set(COALESCE(metadata, '{}'), '$.dashboard_mcp_config', json(?)),
               endpoint_url = COALESCE(?, endpoint_url),
               updated_at = unixepoch()
             WHERE id = ?`,
          )
            .bind(cfgJson, newUrl, id)
            .run();
        }
        return jsonResponse({ ok: true });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }
    if (m && method === 'DELETE') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const id = decodeURIComponent(m[1] || '').trim();
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      try {
        await env.DB.prepare(`UPDATE mcp_services SET is_active = 0, updated_at = unixepoch() WHERE id = ?`)
          .bind(id)
          .run();
        return jsonResponse({ ok: true });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }
  }

  if (pathLower === '/api/settings/mcp' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    try {
      const workspaceId = await resolveRequestWorkspaceId(env, authUser, url);
      const tenantId = await resolveAuthTenantId(env, authUser);
      const wsDisplay = await resolveWorkspaceDisplayName(env, workspaceId);

      // New schema (Sprint 1): workspace-scoped MCP servers + tool registry.
      try {
        const serverRow = await (async () => {
          if (workspaceId) {
            const r = await env.DB.prepare(
              `SELECT url
               FROM agentsam_mcp_servers
               WHERE is_active = 1 AND workspace_id = ?
               ORDER BY updated_at DESC
               LIMIT 1`,
            )
              .bind(workspaceId)
              .first()
              .catch(() => null);
            if (r?.url) return r;
          }
          if (tenantId) {
            const r = await env.DB.prepare(
              `SELECT url
               FROM agentsam_mcp_servers
               WHERE is_active = 1 AND tenant_id = ?
               ORDER BY updated_at DESC
               LIMIT 1`,
            )
              .bind(tenantId)
              .first()
              .catch(() => null);
            if (r?.url) return r;
          }
          const r = await env.DB.prepare(
            `SELECT url
             FROM agentsam_mcp_servers
             WHERE is_active = 1 AND workspace_id IS NULL
             ORDER BY updated_at DESC
             LIMIT 1`,
          )
            .first()
            .catch(() => null);
          return r;
        })();

        // Workspace scoping: tools visible when workspace_scope is global or contains ws.
        let toolRows = [];
        try {
          const wsArg = workspaceId ? String(workspaceId) : '';
          const { results } = await env.DB.prepare(
            `SELECT
               tool_key,
               handler_type,
               description,
               input_schema,
               modes_json,
               risk_level,
               handler_config,
               is_active
             FROM agentsam_tools
             WHERE COALESCE(is_active, 1) = 1
               AND COALESCE(is_degraded, 0) = 0
               AND (
                 COALESCE(is_global, 1) = 1
                 OR workspace_scope IS NULL OR trim(workspace_scope) IN ('', '[]')
                 OR workspace_scope LIKE '%"*"%'
                 OR (? != '' AND instr(COALESCE(workspace_scope, ''), ?) > 0)
               )
             ORDER BY COALESCE(sort_priority, 9999), tool_key ASC`,
          )
            .bind(wsArg, wsArg)
            .all();
          toolRows = results || [];
        } catch {
          toolRows = [];
        }

        return jsonResponse({
          workspace: { id: wsDisplay.id, name: wsDisplay.name },
          connected: {
            url: serverRow?.url != null ? String(serverRow.url) : '',
          },
          tools: toolRows || [],
        });
      } catch {
        // Fall through to legacy surface below.
      }

      // Legacy surface (older dashboard): mcp_services + agentsam_tools.
      const [servers, tools, stats] = await Promise.all([
        env.DB.prepare(
          `SELECT s.*, COUNT(t.id) AS tool_count
           FROM mcp_services s
           LEFT JOIN agentsam_tools t ON t.mcp_service_url = s.endpoint_url
           GROUP BY s.id
           ORDER BY s.service_name`,
        )
          .all()
          .catch(() => ({ results: [] })),
        env.DB.prepare(
          `SELECT t.*, COALESCE(t.is_active, 1) AS enabled
           FROM agentsam_tools t
           ORDER BY COALESCE(t.tool_category, 'other'), COALESCE(t.sort_priority, 9999), COALESCE(t.tool_name, t.tool_key)`,
        )
          .all()
          .catch(() => ({ results: [] })),
        env.DB.prepare(
          `SELECT tool_key, source_client, cost_basis,
                  SUM(call_count) AS call_count,
                  SUM(error_count) AS error_count,
                  SUM(attributed_model_cost_usd) AS attributed_model_cost_usd,
                  SUM(duration_sum_ms) AS duration_sum_ms
           FROM agentsam_tool_stats_compacted
           WHERE metric_date = date('now')
           GROUP BY tool_key, source_client, cost_basis`,
        )
          .all()
          .catch(() => ({ results: [] })),
      ]);
      const statsMap = Object.fromEntries((stats.results || []).map((s) => [String(s.tool_key), s]));
      const toolsWithStats = (tools.results || []).map((t) => ({
        ...t,
        stats: statsMap[String(t.tool_key ?? t.tool_name)] || null,
      }));

      return jsonResponse({
        servers: servers.results || [],
        tools: toolsWithStats,
        commandPerformance: [],
      });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  {
    const m = pathLower.match(/^\/api\/settings\/tools\/([^/]+)$/);
    if (m && method === 'PATCH') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const toolKey = decodeURIComponent(m[1] || '').trim();
      if (!toolKey) return jsonResponse({ error: 'tool_key required' }, 400);
      const body = await request.json().catch(() => ({}));
      if (!body || typeof body !== 'object') return jsonResponse({ error: 'JSON body required' }, 400);

      // Only allow the requested editable fields.
      const allowed = [
        'handler_type',
        'description',
        'input_schema',
        'modes_json',
        'risk_level',
        'handler_config',
        'tool_key',
      ];
      const keys = allowed.filter((k) => Object.prototype.hasOwnProperty.call(body, k));
      if (!keys.length) return jsonResponse({ error: 'No allowed fields to update' }, 400);

      // Normalize JSON-ish fields (accept object/array or string).
      const normalizeJsonField = (val, fallback) => {
        if (val == null) return fallback;
        if (typeof val === 'string') return val;
        try {
          return JSON.stringify(val);
        } catch {
          return fallback;
        }
      };

      const sets = [];
      const binds = [];
      for (const k of keys) {
        if (k === 'input_schema') {
          sets.push('input_schema = ?');
          binds.push(normalizeJsonField(body.input_schema, '{}'));
          continue;
        }
        if (k === 'modes_json') {
          sets.push('modes_json = ?');
          binds.push(normalizeJsonField(body.modes_json, '[]'));
          continue;
        }
        if (k === 'handler_config') {
          sets.push('handler_config = ?');
          binds.push(normalizeJsonField(body.handler_config, '{}'));
          continue;
        }
        if (k === 'tool_key') {
          // tool_key is editable only for rename-like operations; keep it strict.
          const next = String(body.tool_key || '').trim();
          if (!next) return jsonResponse({ error: 'tool_key cannot be empty' }, 400);
          sets.push('tool_key = ?');
          binds.push(next);
          continue;
        }
        sets.push(`${k} = ?`);
        binds.push(body[k]);
      }
      sets.push('updated_at = unixepoch()');

      // Scope: update only within the caller's workspace visibility.
      const workspaceId = await resolveRequestWorkspaceId(env, authUser, url);
      const ws = workspaceId ? String(workspaceId) : '';

      try {
        const res = await env.DB.prepare(
          `UPDATE agentsam_tools
           SET ${sets.join(', ')}
           WHERE tool_key = ?
             AND COALESCE(is_active, 1) = 1
             AND (
               COALESCE(is_global, 1) = 1
               OR workspace_scope IS NULL OR trim(workspace_scope) IN ('', '[]')
               OR workspace_scope LIKE '%"*"%'
               OR (? != '' AND instr(COALESCE(workspace_scope, ''), ?) > 0)
             )`,
        )
          .bind(...binds, toolKey, ws, ws)
          .run();
        if (!res?.meta?.changes) return jsonResponse({ error: 'Tool not found' }, 404);
        const updated = await env.DB.prepare(
          `SELECT tool_key, handler_type, description, input_schema, modes_json, risk_level, handler_config, is_active
           FROM agentsam_tools
           WHERE tool_key = ?
           LIMIT 1`,
        )
          .bind(body.tool_key ? String(body.tool_key).trim() : toolKey)
          .first()
          .catch(() => null);
        return jsonResponse({ ok: true, tool: updated });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }
  }

  {
    const m = pathLower.match(/^\/api\/settings\/mcp\/tools\/([^/]+)\/toggle$/);
    if (m && method === 'PATCH') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const id = decodeURIComponent(m[1] || '').trim();
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const body = await request.json().catch(() => ({}));
      const enabled = body.enabled === true || body.enabled === 1 || body.enabled === '1';
      await env.DB.prepare(
        `UPDATE agentsam_tools
         SET is_active = ?, updated_at = unixepoch()
         WHERE id = ? OR tool_name = ? OR tool_key = ?`,
      )
        .bind(enabled ? 1 : 0, id, id, id)
        .run();
      return jsonResponse({ ok: true });
    }
  }

  {
    const m = pathLower.match(/^\/api\/settings\/mcp\/tools\/([^/]+)$/);
    if (m && method === 'PATCH') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const id = decodeURIComponent(m[1] || '').trim();
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const body = await request.json().catch(() => ({}));
      const allowed = [
        'tool_name',
        'tool_category',
        'description',
        'enabled',
        'requires_approval',
        'handler_type',
        'handler_config',
        'risk_level',
        'sort_priority',
        'intent_tags',
        'modes_json',
        'cost_per_call_usd',
        'input_schema',
        'mcp_service_url',
      ];
      const keys = allowed.filter((k) => body && Object.prototype.hasOwnProperty.call(body, k));
      if (!keys.length) return jsonResponse({ error: 'No fields to update' }, 400);
      const sets = keys.map((k) => (k === 'enabled' ? 'is_active = ?' : `${k} = ?`)).join(', ');
      const vals = keys.map((k) => {
        if (k === 'enabled') {
          const on = body.enabled === true || body.enabled === 1 || body.enabled === '1';
          return on ? 1 : 0;
        }
        return body[k];
      });
      await env.DB.prepare(
        `UPDATE agentsam_tools
         SET ${sets}, updated_at = unixepoch()
         WHERE id = ? OR tool_name = ? OR tool_key = ?`,
      )
        .bind(...vals, id, id, id)
        .run();
      return jsonResponse({ ok: true });
    }
  }

  return null;
}
