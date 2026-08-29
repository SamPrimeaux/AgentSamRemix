/**
 * Non-mutating probes + persistence to agentsam.mcp_health_checks
 */
import { supabasePostJson, supabaseRestBase, supabaseServiceKey } from './supabaseRest.js';

const DEFAULT_TOOLS = ['supabase_rest', 'worker_json', 'mcp_registry'];

/**
 * @param {any} env
 * @param {string} toolName
 * @param {Request} request
 */
export async function probeOneTool(env, toolName, request) {
  const t0 = Date.now();
  let status = 'unknown';
  let last_error = null;
  let latency_ms = 0;

  try {
    if (toolName === 'supabase_rest') {
      const base = supabaseRestBase(env);
      const key = supabaseServiceKey(env);
      if (!base || !key) {
        status = 'skipped';
        last_error = 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing';
      } else {
        const u = `${base}/rest/v1/agentsam_tool_call_events?select=id&limit=1`;
        const res = await fetch(u, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        latency_ms = Date.now() - t0;
        status = res.ok ? 'ok' : `http_${res.status}`;
        if (!res.ok) last_error = await res.text().then((x) => x.slice(0, 500)).catch(() => '');
      }
    } else if (toolName === 'worker_json') {
      const url = new URL(request.url);
      const u = `${url.origin}/api/health`;
      const res = await fetch(u, { headers: { Accept: 'application/json' } });
      latency_ms = Date.now() - t0;
      status = res.ok ? 'ok' : `http_${res.status}`;
      if (!res.ok) last_error = await res.text().then((x) => x.slice(0, 500)).catch(() => '');
    } else if (toolName === 'mcp_registry') {
      if (!env?.DB) {
        status = 'skipped';
        last_error = 'D1 not configured';
      } else {
        await env.DB.prepare(`SELECT 1 AS ok`).first();
        latency_ms = Date.now() - t0;
        status = 'ok';
      }
    } else {
      status = 'noop';
      latency_ms = Date.now() - t0;
    }
  } catch (e) {
    latency_ms = Date.now() - t0;
    status = 'error';
    last_error = String(e?.message || e);
  }

  const row = {
    id: crypto.randomUUID(),
    tool_name: toolName,
    status,
    latency_ms,
    checked_at: new Date().toISOString(),
    success_rate: status === 'ok' ? 100 : 0,
    last_error,
  };

  const ins = await supabasePostJson(env, '/rest/v1/mcp_health_checks', row, 'agentsam');
  if (!ins.ok) {
    row.persist_error = `HTTP ${ins.status}`;
  }

  return row;
}

/**
 * @param {any} env
 * @param {Request} request
 * @param {{ tool_name?: string, run_all?: boolean }} body
 */
export async function runMcpProbes(env, request, body) {
  const runAll = body?.run_all === true;
  const single = String(body?.tool_name || '').trim();
  const names = runAll ? DEFAULT_TOOLS : single ? [single] : DEFAULT_TOOLS;
  const results = [];
  for (const n of names) {
    results.push(await probeOneTool(env, n, request));
  }
  return { results };
}
