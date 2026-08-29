/**
 * DesignStudio: D1 agentsam_workflow_runs → Supabase analytics (public.*).
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. No-op when disabled is NOT supported
 * for syncRunToSupabase callers — callers must catch if env is incomplete.
 */

import { AGENTSAM_WORKFLOW_RUNS_TABLE } from '../../../backend/workflows/index.js';

const RUNS_TABLE = 'designstudio_runs_analytics';
const ASSET_TABLE = 'designstudio_asset_metrics';
const STEP_TABLE = 'designstudio_step_metrics';

function supabaseRestBase(env) {
  const raw = env?.SUPABASE_URL;
  if (!raw || !String(raw).trim()) throw new Error('SUPABASE_URL is not configured');
  return String(raw).replace(/\/$/, '');
}

function supabaseServiceRole(env) {
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !String(key).trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return String(key).trim();
}

/** PostgREST to public schema (not agentsam). */
function supabasePublicHeaders(env, extra = {}) {
  const key = supabaseServiceRole(env);
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extra,
  };
}

function unixToIso(sec) {
  if (sec == null || sec === '') return null;
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

/**
 * @param {string} tenantId
 * @param {string} workspaceId
 * @param {string} workflowRunId
 */
export function buildCadCreationsPrefix(tenantId, workspaceId, workflowRunId) {
  const t = String(tenantId || 'system').replace(/\/+/g, '');
  const wRaw = String(workspaceId || '').replace(/\/+/g, '');
  if (!wRaw) {
    throw new Error('WORKSPACE_CONTEXT_MISSING');
  }
  const w = wRaw;
  const r = String(workflowRunId || '').replace(/\/+/g, '');
  return `cad/creations/${t}/${w}/${r}/`;
}

/**
 * Scan workflow step result blobs for r2_key / keys ending in .glb|.stl|.scad|.png
 * @param {unknown[]} stepResults
 * @returns {{ asset_type: string, r2_key: string, size_bytes?: number }[]}
 */
export function extractAssetsFromStepResults(stepResults) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(stepResults)) return out;
  for (const row of stepResults) {
    const tool = row && typeof row === 'object' ? String(row.tool_name || row.tool || '') : '';
    let text = '';
    if (row && typeof row === 'object' && row.output != null) text = String(row.output);
    else if (row && typeof row === 'object' && row.result_json != null) text = String(row.result_json);
    if (!text || text === '(no output)') continue;
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const keys = ['r2_key', 'stl_r2_key', 'glb_r2_key', 'preview_r2_key', 'scad_r2_key', 'key'];
    for (const k of keys) {
      const v = parsed[k];
      if (typeof v !== 'string' || !v.trim()) continue;
      const rk = v.trim();
      if (seen.has(rk)) continue;
      seen.add(rk);
      const lower = rk.toLowerCase();
      let assetType = 'file';
      if (lower.endsWith('.glb')) assetType = 'glb';
      else if (lower.endsWith('.stl')) assetType = 'stl';
      else if (lower.endsWith('.scad')) assetType = 'scad';
      else if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) assetType = 'preview';
      const sizeBytes =
        parsed.size_bytes != null && Number.isFinite(Number(parsed.size_bytes))
          ? Number(parsed.size_bytes)
          : undefined;
      out.push({ asset_type: assetType, r2_key: rk, size_bytes: sizeBytes, tool_name: tool || null });
    }
  }
  return out;
}

async function supabaseDeleteByRunId(env, table, runId) {
  const base = supabaseRestBase(env);
  const url = `${base}/rest/v1/${table}?workflow_run_id=eq.${encodeURIComponent(runId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: supabasePublicHeaders(env, { Prefer: 'return=minimal' }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase DELETE ${table} HTTP ${res.status}: ${t.slice(0, 2000)}`);
  }
}

async function supabaseUpsertRun(env, row) {
  const base = supabaseRestBase(env);
  const url = `${base}/rest/v1/${RUNS_TABLE}?on_conflict=workflow_run_id`;
  const res = await fetch(url, {
    method: 'POST',
    headers: supabasePublicHeaders(env, {
      Prefer: 'return=representation,resolution=merge-duplicates',
    }),
    body: JSON.stringify(row),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${RUNS_TABLE} upsert HTTP ${res.status}: ${text.slice(0, 4000)}`);
  }
  let json;
  try {
    json = text ? JSON.parse(text) : [];
  } catch (e) {
    throw new Error(`Supabase upsert invalid JSON: ${String(e?.message || e)}`);
  }
  const out = Array.isArray(json) ? json[0] : json;
  if (!out || String(out.workflow_run_id || '') !== String(row.workflow_run_id)) {
    throw new Error('Supabase upsert returned unexpected row');
  }
  return out;
}

async function supabaseInsertAssets(env, rows) {
  if (!rows.length) return [];
  const base = supabaseRestBase(env);
  const res = await fetch(`${base}/rest/v1/${ASSET_TABLE}`, {
    method: 'POST',
    headers: supabasePublicHeaders(env, { Prefer: 'return=representation' }),
    body: JSON.stringify(rows),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${ASSET_TABLE} insert HTTP ${res.status}: ${text.slice(0, 4000)}`);
  }
  return text ? JSON.parse(text) : [];
}

async function supabaseInsertSteps(env, rows) {
  if (!rows.length) return [];
  const base = supabaseRestBase(env);
  const res = await fetch(`${base}/rest/v1/${STEP_TABLE}`, {
    method: 'POST',
    headers: supabasePublicHeaders(env, { Prefer: 'return=representation' }),
    body: JSON.stringify(rows),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${STEP_TABLE} insert HTTP ${res.status}: ${text.slice(0, 4000)}`);
  }
  return text ? JSON.parse(text) : [];
}

/**
 * GET verify: row exists for workflow_run_id.
 * @param {any} env
 * @param {string} workflowRunId
 */
export async function verifySupabaseRunRow(env, workflowRunId) {
  const base = supabaseRestBase(env);
  const url = `${base}/rest/v1/${RUNS_TABLE}?workflow_run_id=eq.${encodeURIComponent(workflowRunId)}&select=workflow_run_id,status,success,cost_usd,duration_ms,r2_prefix`;
  const res = await fetch(url, { headers: supabasePublicHeaders(env, { Prefer: 'return=representation' }) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase verify GET HTTP ${res.status}: ${text.slice(0, 2000)}`);
  }
  const json = text ? JSON.parse(text) : [];
  if (!Array.isArray(json) || json.length < 1) {
    throw new Error('verifySupabaseRunRow: no row returned after upsert');
  }
  return json[0];
}

/**
 * Emit envelope to AGENT_SESSION DO outbox (for SSE / future replay).
 * @param {any} env
 * @param {string|null|undefined} sessionId
 * @param {Record<string, unknown>} envelope
 */
export async function emitAgentSessionDesignStudioEvent(env, sessionId, envelope) {
  const sid = sessionId != null ? String(sessionId).trim() : '';
  if (!sid || !env?.AGENT_SESSION) {
    return { skipped: true, reason: !sid ? 'no_session_id' : 'no_AGENT_SESSION' };
  }
  const id = env.AGENT_SESSION.idFromName(sid);
  const stub = env.AGENT_SESSION.get(id);
  const res = await stub.fetch(
    new Request('https://internal/designstudio/stream-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envelope }),
    }),
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DO stream-event HTTP ${res.status}: ${text.slice(0, 2000)}`);
  }
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    json = {};
  }
  return json;
}

/**
 * Fetch workflow run from D1 (Cloudflare).
 * @param {any} env
 * @param {string} runId
 */
export async function fetchD1WorkflowRun(env, runId) {
  const db = env?.DB;
  if (!db) throw new Error('fetchD1WorkflowRun: DB not configured');
  const row = await db
    .prepare(`SELECT * FROM ${AGENTSAM_WORKFLOW_RUNS_TABLE} WHERE id = ? LIMIT 1`)
    .bind(runId)
    .first();
  return row || null;
}

/**
 * Sync one completed (or failed) workflow run into Supabase analytics tables.
 *
 * @param {any} env
 * @param {string} runId D1 agentsam_workflow_runs.id
 * @param {{
 *   sessionId?: string | null,
 *   r2Prefix?: string | null,
 *   assets?: { asset_type: string, r2_key: string, size_bytes?: number }[],
 *   workspaceId?: string,
 *   skipDesignStudioKeyCheck?: boolean,
 * }} [options]
 * @returns {Promise<{ verified: boolean, workflow_run_id: string, assets_written: number, steps_written: number }>}
 */
export async function syncRunToSupabase(env, runId, options = {}) {
  const rid = String(runId || '').trim();
  if (!rid) throw new Error('syncRunToSupabase: runId required');

  const row = await fetchD1WorkflowRun(env, rid);
  if (!row) throw new Error(`syncRunToSupabase: run not found in D1: ${rid}`);

  const wfKey = String(row.workflow_key ?? '').toLowerCase();
  if (!options.skipDesignStudioKeyCheck && !wfKey.startsWith('designstudio')) {
    throw new Error(`syncRunToSupabase: workflow_key must start with designstudio (got: ${row.workflow_key || ''})`);
  }

  let stepResults = [];
  try {
    stepResults = row.step_results_json ? JSON.parse(String(row.step_results_json)) : [];
  } catch (_) {
    stepResults = [];
  }
  if (!Array.isArray(stepResults)) stepResults = [];

  const tenantId = String(row.tenant_id || 'system');
  const workspaceIdRaw =
    (options.workspaceId != null && String(options.workspaceId).trim()) ||
    (row.workspace_id != null && String(row.workspace_id).trim()) ||
    '';
  if (!workspaceIdRaw) throw new Error('WORKSPACE_CONTEXT_MISSING');
  const workspaceId = String(workspaceIdRaw);
  const d1Status = String(row.status || '').toLowerCase();
  const success = d1Status === 'success' || d1Status === 'completed';
  const analyticsStatus = success ? 'completed' : d1Status === 'failed' ? 'failed' : d1Status || 'unknown';

  const r2Prefix =
    (options.r2Prefix != null && String(options.r2Prefix).trim()) ||
    buildCadCreationsPrefix(tenantId, workspaceId, rid);

  const costUsd = row.cost_usd != null && Number.isFinite(Number(row.cost_usd)) ? Number(row.cost_usd) : 0;
  const durationMs = row.duration_ms != null && Number.isFinite(Number(row.duration_ms)) ? Number(row.duration_ms) : null;
  const completedAt = unixToIso(row.completed_at) || new Date().toISOString();

  const runsPayload = {
    workflow_run_id: rid,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    status: analyticsStatus,
    success,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: costUsd,
    duration_ms: durationMs,
    r2_prefix: r2Prefix,
    completed_at: completedAt,
  };

  await supabaseDeleteByRunId(env, ASSET_TABLE, rid);
  await supabaseDeleteByRunId(env, STEP_TABLE, rid);

  await supabaseUpsertRun(env, runsPayload);

  const mergedAssets = [];
  const fromSteps = extractAssetsFromStepResults(stepResults);
  const explicit = Array.isArray(options.assets) ? options.assets : [];
  const seenKeys = new Set();
  for (const a of [...explicit, ...fromSteps]) {
    const rk = String(a.r2_key || '').trim();
    if (!rk || seenKeys.has(rk)) continue;
    seenKeys.add(rk);
    mergedAssets.push({
      workflow_run_id: rid,
      asset_type: String(a.asset_type || 'file'),
      r2_key: rk,
      size_bytes: a.size_bytes != null && Number.isFinite(Number(a.size_bytes)) ? Number(a.size_bytes) : null,
    });
  }
  if (mergedAssets.length) {
    await supabaseInsertAssets(env, mergedAssets);
  }

  const stepRows = stepResults.map((s, idx) => ({
    workflow_run_id: rid,
    step_key: s && typeof s === 'object' ? String(s.step_key || s.step || s.name || `step_${idx + 1}`) : `step_${idx + 1}`,
    tool_name: s && typeof s === 'object' ? String(s.tool_name || s.tool || '') || null : null,
    duration_ms:
      s && typeof s === 'object' && s.duration_ms != null && Number.isFinite(Number(s.duration_ms))
        ? Number(s.duration_ms)
        : null,
  }));
  if (stepRows.length) {
    await supabaseInsertSteps(env, stepRows);
  }

  const verified = await verifySupabaseRunRow(env, rid);

  const sessionForEvent = options.sessionId != null ? String(options.sessionId).trim() : String(row.session_id || '').trim();
  const syncStatus = success ? 'success' : 'failed';
  const envelope = {
    type: 'designstudio.event',
    event: 'supabase.sync.completed',
    session_id: sessionForEvent || null,
    workflow_run_id: rid,
    blueprint_id: null,
    message_id: `evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    parent_message_id: null,
    sequence: Math.floor(Date.now() / 1000),
    ts: Math.floor(Date.now() / 1000),
    source: 'system',
    status: syncStatus,
    payload: {
      workflow_run_id: rid,
      status: syncStatus,
      supabase_table: RUNS_TABLE,
      verified: !!verified?.workflow_run_id,
    },
    metrics: {
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: durationMs || 0,
      cost_usd: costUsd,
    },
  };

  try {
    if (sessionForEvent) {
      await emitAgentSessionDesignStudioEvent(env, sessionForEvent, envelope);
    }
  } catch (doErr) {
    console.warn('[designstudio sync] DO emit failed (non-fatal):', doErr?.message ?? doErr);
  }

  return {
    verified: true,
    workflow_run_id: rid,
    assets_written: mergedAssets.length,
    steps_written: stepRows.length,
    supabase_row: verified,
  };
}
