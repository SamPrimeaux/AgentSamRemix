/**
 * backend/workflows/repository/handlers.js
 * Resolves handler_key → { executor_kind, config } from D1.
 * KV-cached per isolate (TTL 300s). Falls back gracefully on miss.
 * Zero throws — null return means "no registry row, use legacy switch."
 *
 * executor_kinds:
 *   d1_sql | d1_write | agent_llm | mcp_tool | agent_step | script | catalog_tool
 *   http | ui_emit | eval | terminal | approval | passthrough
 *   (builtin_tool removed in migration 384 — legacy executor kind accepted only at the runtime boundary until D1 migration is applied)
 */

const _cache = new Map(); // per-isolate in-memory cache
const KV_TTL = 300;       // seconds

export async function resolveHandler(env, handlerKey) {
  if (!handlerKey) return null;
  if (_cache.has(handlerKey)) return _cache.get(handlerKey);

  // KV cache
  const kvKey = `wh:${handlerKey}`;
  try {
    const hit = await env.IAM_KV?.get(kvKey, 'json');
    if (hit) { _cache.set(handlerKey, hit); return hit; }
  } catch {}

  // D1
  try {
    const row = await env.DB.prepare(`
      SELECT handler_key, node_type, executor_kind,
             handler_config_json, input_schema_json, quality_gate_json,
             risk_level, requires_approval
      FROM agentsam_workflow_handlers
      WHERE handler_key = ? AND is_active = 1
      LIMIT 1
    `).bind(handlerKey).first();

    if (!row) return null;

    const resolved = {
      handler_key:       row.handler_key,
      node_type:         row.node_type,
      executor_kind:     row.executor_kind,
      config:            _json(row.handler_config_json),
      input_schema:      _json(row.input_schema_json),
      quality_gate:      _json(row.quality_gate_json),
      risk_level:        row.risk_level,
      requires_approval: !!row.requires_approval,
    };

    env.IAM_KV?.put(kvKey, JSON.stringify(resolved), { expirationTtl: KV_TTL }).catch(() => {});
    _cache.set(handlerKey, resolved);
    return resolved;
  } catch (e) {
    console.warn(`[handler-registry] miss for "${handlerKey}":`, e?.message);
    return null;
  }
}

export async function listHandlers(env, { node_type, executor_kind, active = true } = {}) {
  const binds = [];
  let sql = `
    SELECT handler_key, node_type, executor_kind, title, description,
           risk_level, requires_approval, handler_config_json, input_schema_json
    FROM agentsam_workflow_handlers WHERE 1=1
  `;
  if (active)        { sql += ' AND is_active = 1'; }
  if (node_type)     { sql += ' AND node_type = ?';     binds.push(node_type); }
  if (executor_kind) { sql += ' AND executor_kind = ?';  binds.push(executor_kind); }
  sql += ' ORDER BY node_type, handler_key';

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return results.map(r => ({
    ...r,
    handler_config: _json(r.handler_config_json),
    input_schema:   _json(r.input_schema_json),
  }));
}

export async function isAllowedNodeType(env, node_type) {
  const CORE = new Set([
    'agent','db_query','eval','webhook','terminal','branch',
    'script','mcp_tool','approval_gate','join','trigger','process','output'
  ]);
  if (CORE.has(node_type)) return true;
  try {
    const row = await env.DB.prepare(
      `SELECT 1 FROM agentsam_workflow_handlers WHERE node_type = ? AND is_active = 1 LIMIT 1`
    ).bind(node_type).first();
    return !!row;
  } catch { return false; }
}

function _json(str) {
  try { return JSON.parse(str || '{}'); } catch { return {}; }
}
