import { compactExecutionStepJson } from '../../telemetry/execution-journal-compact.js';

function usageFromNodeOutput(nodeOutput) {
  const o = nodeOutput?.output;
  if (!o || typeof o !== 'object') return { tin: 0, tout: 0, cost: 0 };
  const u = o.usage && typeof o.usage === 'object' ? o.usage : o;
  return {
    tin: Number(u.input_tokens ?? u.prompt_tokens ?? o.tokens_in ?? 0) || 0,
    tout: Number(u.output_tokens ?? u.completion_tokens ?? o.tokens_out ?? 0) || 0,
    cost: Number(o.cost_usd ?? u.cost_usd ?? 0) || 0,
  };
}

export async function loadExecutionStepColumns(db) {
  if (!db) return new Set();
  const schema = await db
    .prepare('PRAGMA table_info(agentsam_execution_steps)')
    .all()
    .catch(() => ({ results: [] }));
  return new Set(
    (schema?.results || [])
      .map((column) => String(column?.name || '').trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function insertExecutionStep(db, cols, { stepId, executionId, workflowRunId, node, input }) {
  if (!db || !cols?.has('id')) return;
  if (cols.has('execution_id') && !executionId) return;
  let inputJson = '{}';
  try { inputJson = await compactExecutionStepJson(input ?? {}, 'input_json'); }
  catch { inputJson = JSON.stringify(input ?? {}).slice(0, 8192); }
  const values = {
    id: stepId,
    execution_id: executionId,
    workflow_run_id: workflowRunId,
    node_key: String(node?.node_key ?? '').slice(0, 500),
    node_type: String(node?.node_type ?? '').slice(0, 120),
    status: 'running',
    input_json: inputJson,
    attempt: 1,
    started_at: Math.floor(Date.now() / 1000),
  };
  const fields = Object.keys(values).filter((key) => cols.has(key) && values[key] !== undefined);
  if (!fields.length) return;
  await db.prepare(
    `INSERT INTO agentsam_execution_steps (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
  ).bind(...fields.map((key) => values[key])).run().catch((e) => console.warn('[workflow] execution step insert', e?.message ?? e));
}

export async function completeExecutionStep(db, cols, { stepId, startedAt, nodeOutput }) {
  if (!db || !cols?.has('id') || !stepId) return;
  const ok = !!nodeOutput?.ok;
  const { tin, tout, cost } = usageFromNodeOutput(nodeOutput);
  let outputJson = '{}';
  try { outputJson = await compactExecutionStepJson(nodeOutput ?? {}, 'output_json'); }
  catch { outputJson = JSON.stringify(nodeOutput ?? {}).slice(0, 8192); }
  const patch = {
    status: ok ? 'success' : 'failed',
    output_json: outputJson,
    error_json: ok ? '{}' : JSON.stringify({ message: String(nodeOutput?.error ?? 'failed') }).slice(0, 8000),
    completed_at: Math.floor(Date.now() / 1000),
    latency_ms: Math.max(0, Date.now() - startedAt),
    tokens_in: tin,
    tokens_out: tout,
    cost_usd: cost,
  };
  const fields = Object.keys(patch).filter((key) => cols.has(key));
  if (!fields.length) return;
  await db.prepare(
    `UPDATE agentsam_execution_steps SET ${fields.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`,
  ).bind(...fields.map((key) => patch[key]), stepId).run().catch((e) => console.warn('[workflow] execution step complete', e?.message ?? e));
}

export async function recordExecutionStepEdge(db, cols, stepId, edge) {
  if (!db || !cols?.has('edge_taken') || !stepId || !edge) return;
  const label = String(edge.edge_key ?? edge.id ?? `${edge.from_node_key}->${edge.to_node_key}`).slice(0, 500);
  await db.prepare(`UPDATE agentsam_execution_steps SET edge_taken = ? WHERE id = ?`).bind(label, stepId).run().catch(() => null);
}
