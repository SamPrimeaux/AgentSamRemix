import { flattenWorkflowInput, getByPath, workflowHandlerContext } from './common.js';
import { auditWorkflowTables } from './eval.js';

async function d1All(env, sql, binds = []) {
  if (!env?.DB) return { ok: false, error: 'DB not available', rows: [] };
  try {
    const stmt = env.DB.prepare(sql);
    const { results } = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
    return { ok: true, rows: results || [] };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e), rows: [] };
  }
}

const DB_QUERY_HANDLERS = {
  async 'db.audit_workflow_tables'(env, _input, ctx) {
    return { ok: true, output: { audit: await auditWorkflowTables(env), workspace_id: ctx.workspaceId } };
  },
  async 'db.collect_agent_usage_events'(env, _input, ctx) {
    let sql = `SELECT status, COUNT(*) AS c, SUM(COALESCE(cost_usd,0)) AS cost_usd,
      SUM(COALESCE(input_tokens,0)) AS input_tokens, SUM(COALESCE(output_tokens,0)) AS output_tokens
      FROM agentsam_workflow_runs WHERE 1=1`;
    const binds = [];
    if (ctx.tenantId) { sql += ` AND tenant_id = ?`; binds.push(ctx.tenantId); }
    if (ctx.workspaceId) { sql += ` AND workspace_id = ?`; binds.push(ctx.workspaceId); }
    sql += ` GROUP BY status ORDER BY c DESC`;
    const byStatus = await d1All(env, sql, binds);
    let recentSql = `SELECT id, workflow_key, status, cost_usd, input_tokens, output_tokens, steps_completed, steps_total, started_at, completed_at FROM agentsam_workflow_runs WHERE 1=1`;
    const recentBinds = [];
    if (ctx.tenantId) { recentSql += ` AND tenant_id = ?`; recentBinds.push(ctx.tenantId); }
    if (ctx.workspaceId) { recentSql += ` AND workspace_id = ?`; recentBinds.push(ctx.workspaceId); }
    recentSql += ` ORDER BY started_at DESC LIMIT 50`;
    const recent = await d1All(env, recentSql, recentBinds);
    return { ok: true, output: { by_status: byStatus.rows, recent_runs: recent.rows, collected_at: new Date().toISOString() } };
  },
  async 'db.persist_analytics_rollup'(env, input, ctx) {
    const flat = flattenWorkflowInput(input);
    const rollup = flat.datasets ?? flat.rollup ?? flat;
    const key = `workflow_rollup:${ctx.workspaceId || 'global'}:${Date.now().toString(36)}`;
    if (env?.KV?.put) await env.KV.put(key, JSON.stringify({ rollup, saved_at: Date.now() }), { expirationTtl: 60 * 60 * 24 * 14 });
    return { ok: true, output: { kv_key: key, persisted: true, rollup_preview: rollup } };
  },
  async 'db.upsert_agentsam_artifact'(env, input, ctx) {
    // R2 bytes are written by the preceding catalog tool. This step only registers metadata.
    const flat = flattenWorkflowInput(input);
    const userId = String(ctx.userId || flat.user_id || '').trim();
    const workspaceId = String(ctx.workspaceId || flat.workspace_id || '').trim();
    const tenantId = String(ctx.tenantId || flat.tenant_id || '').trim();
    const r2Key = String(flat.r2_key || flat.key || '').trim();
    if (!userId || !workspaceId || !tenantId) return { ok: false, error: 'identity_required' };
    if (!r2Key) return { ok: false, error: 'r2_key_required' };
    const artifactId = String(flat.artifact_id || flat.id || `artifact_${crypto.randomUUID().replace(/-/g,'').slice(0,16)}`);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO agentsam_artifacts
       (id, user_id, tenant_id, workspace_id, name, artifact_type, r2_key, source, source_run_id, source_workflow_id, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'workflow_graph', ?, ?, ?, unixepoch())`,
    ).bind(
      artifactId, userId, tenantId, workspaceId,
      String(flat.name || flat.title || 'workflow artifact').slice(0,500),
      String(flat.artifact_type || 'json').slice(0,64), r2Key,
      ctx.runId || null, ctx.workflowKey || null,
      JSON.stringify({ workflow_run_id: ctx.runId || null, node: ctx.nodeKey || null }),
    ).run();
    return { ok: true, output: { ...flat, artifact_id: artifactId, r2_key: r2Key, registered: true } };
  },
};

export async function executeWorkflowDbQuery(env, handlerKey, input, runContext, node, config = {}) {
  if (runContext?.smoke) return { ok: true, output: { smoke: true, skipped: true, handler_key: handlerKey } };
  const ctx = workflowHandlerContext(runContext, node);
  const hk = String(handlerKey || '').trim();
  if (DB_QUERY_HANDLERS[hk]) return DB_QUERY_HANDLERS[hk](env, input, ctx);
  const flat = flattenWorkflowInput(input);
  const sql = String(config.sql || flat.sql || '').trim();
  if (!sql) return { ok: false, error: `db_query: no handler or sql for ${hk || node?.node_key || 'unknown'}` };
  if (!/^\s*select\b/i.test(sql)) return { ok: false, error: 'db_query: only SELECT allowed inline' };
  const params = Array.isArray(config.params)
    ? config.params.map((value) => typeof value === 'string' && value.startsWith('$.') ? getByPath(flat, value) : value)
    : [];
  const r = await d1All(env, sql, params);
  return r.ok ? { ok: true, output: { rows: r.rows, row_count: r.rows.length, sql: sql.slice(0,500) } } : { ok: false, error: r.error };
}
