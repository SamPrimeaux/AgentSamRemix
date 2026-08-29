function parseObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function readWorkflowContinuation(run) {
  if (!run || typeof run !== 'object') return null;
  if (run.continuation_json != null && String(run.continuation_json).trim() !== '') {
    const direct = parseObject(run.continuation_json);
    return Object.keys(direct).length ? direct : null;
  }
  const meta = parseObject(run.metadata_json);
  const continuation = meta.workflow_continuation;
  return continuation && typeof continuation === 'object' && !Array.isArray(continuation)
    ? continuation
    : null;
}

export async function writeWorkflowContinuation(db, runId, continuation) {
  const serialized = JSON.stringify(continuation ?? {});
  if (serialized.length > 50_000) {
    throw new Error(`WORKFLOW_CONTINUATION_TOO_LARGE:${serialized.length}`);
  }
  const row = await db.prepare(`SELECT metadata_json FROM agentsam_workflow_runs WHERE id = ? LIMIT 1`).bind(runId).first();
  const meta = parseObject(row?.metadata_json);
  meta.workflow_continuation = continuation ?? null;
  await db.prepare(
    `UPDATE agentsam_workflow_runs SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(JSON.stringify(meta), runId).run();
}

export async function clearWorkflowContinuation(db, runId) {
  const row = await db.prepare(`SELECT metadata_json FROM agentsam_workflow_runs WHERE id = ? LIMIT 1`).bind(runId).first().catch(() => null);
  if (!row) return;
  const meta = parseObject(row.metadata_json);
  delete meta.workflow_continuation;
  await db.prepare(
    `UPDATE agentsam_workflow_runs SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(JSON.stringify(meta), runId).run().catch(() => null);
}
