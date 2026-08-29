/**
 * In-isolate knowledge use attribution per agent_run_id.
 * Persisted to experience at finalize; also flushed to agentsam_agent_run when column exists.
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** @type {Map<string, { refs: Map<string, Record<string, unknown>>, bootstrap_id?: string }>} */
const runAttribution = new Map();

/**
 * @param {string} agentRunId
 * @param {Array<Record<string, unknown>>} refs
 * @param {{ bootstrap_id?: string }} [meta]
 */
export function recordKnowledgeUseForRun(agentRunId, refs, meta = {}) {
  const runId = trim(agentRunId);
  if (!runId || !Array.isArray(refs) || !refs.length) return;
  let bucket = runAttribution.get(runId);
  if (!bucket) {
    bucket = { refs: new Map(), bootstrap_id: meta.bootstrap_id || null };
    runAttribution.set(runId, bucket);
  }
  if (meta.bootstrap_id) bucket.bootstrap_id = meta.bootstrap_id;
  for (const ref of refs) {
    const id = trim(ref?.id || ref?.memory_id);
    const key = trim(ref?.key || ref?.memory_key);
    const dedup = id || key;
    if (!dedup) continue;
    bucket.refs.set(dedup, {
      id: id || null,
      key: key || null,
      type: ref?.type || ref?.memory_type || 'fact',
      relevance: Number(ref?.relevance) || 0.5,
    });
  }
}

/**
 * @param {string} agentRunId
 * @returns {{ refs: Array<Record<string, unknown>>, bootstrap_id: string|null, hit_count: number }}
 */
export function getKnowledgeUseForRun(agentRunId) {
  const runId = trim(agentRunId);
  const bucket = runId ? runAttribution.get(runId) : null;
  if (!bucket) return { refs: [], bootstrap_id: null, hit_count: 0 };
  const refs = [...bucket.refs.values()].slice(0, 32);
  return {
    refs,
    bootstrap_id: bucket.bootstrap_id || null,
    hit_count: refs.length,
  };
}

/** @param {string} agentRunId */
export function clearKnowledgeUseForRun(agentRunId) {
  const runId = trim(agentRunId);
  if (runId) runAttribution.delete(runId);
}

/**
 * @param {any} env
 * @param {string} agentRunId
 */
export async function persistKnowledgeRefsOnRun(env, agentRunId) {
  const runId = trim(agentRunId);
  if (!env?.DB || !runId) return;
  const { refs, bootstrap_id } = getKnowledgeUseForRun(runId);
  if (!refs.length && !bootstrap_id) return;
  const { pragmaTableInfo } = await import('../retention.js');
  const cols = await pragmaTableInfo(env.DB, 'agentsam_agent_run');
  if (!cols.size) return;
  const sets = [];
  const binds = [];
  if (cols.has('knowledge_refs_json') && refs.length) {
    sets.push('knowledge_refs_json = ?');
    binds.push(JSON.stringify(refs.slice(0, 32)));
  }
  if (cols.has('knowledge_bootstrap_id') && bootstrap_id) {
    sets.push('knowledge_bootstrap_id = ?');
    binds.push(bootstrap_id);
  }
  if (!sets.length) return;
  binds.push(runId);
  await env.DB.prepare(
    `UPDATE agentsam_agent_run SET ${sets.join(', ')} WHERE id = ?`,
  )
    .bind(...binds)
    .run()
    .catch(() => {});
}
