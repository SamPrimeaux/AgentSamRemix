import { normalizeArtifactReceipt, normalizeArtifactReceipts } from './artifacts.js';
import { isValidTerminalJobStatus } from './state.js';
import { normalizeResumePolicy, normalizeRetryPolicy } from './policies.js';
import { setTerminalJobDependencies, getTerminalJobDependencies } from './dependencies.js';

function parseJson(raw, fallback) {
  try { return raw ? JSON.parse(String(raw)) : fallback; } catch { return fallback; }
}

export function terminalJobFromRow(row) {
  if (!row) return null;
  return {
    job_id: String(row.id),
    status: String(row.status),
    protocol: String(row.protocol || 'batch_exec'),
    command: String(row.command || ''),
    cwd: row.cwd ?? null,
    target_id: row.target_id ?? null,
    target_type: row.target_type ?? null,
    target_lane: row.target_lane ?? null,
    transport: row.transport ?? null,
    progress: Number(row.progress) || 0,
    timeout_ms: row.timeout_ms != null ? Number(row.timeout_ms) : null,
    stdout_tail: row.stdout_tail ?? '',
    stderr_tail: row.stderr_tail ?? '',
    exit_code: row.exit_code != null ? Number(row.exit_code) : null,
    error: row.error ?? null,
    artifact_refs: parseJson(row.artifact_refs_json, []),
    cleanup: parseJson(row.cleanup_json, null),
    instance_name: row.instance_name ?? null,
    created_at: row.created_at ?? null,
    started_at: row.started_at ?? null,
    finished_at: row.finished_at ?? null,
    cancel_requested_at: row.cancel_requested_at ?? null,
    cancel_reason: row.cancel_reason ?? null,
    conversation_id: row.conversation_id ?? null,
    turn_id: row.turn_id ?? null,
    user_id: row.user_id ?? null,
    workspace_id: row.workspace_id ?? null,
    tenant_id: row.tenant_id ?? null,
    agent_id: row.agent_id ?? null,
    tool_call_id: row.tool_call_id ?? null,
    idempotency_key: row.idempotency_key ?? null,
    resume_policy: row.resume_policy ?? 'none',
    retry_policy: parseJson(row.retry_policy_json, {}),
    attempt: Number(row.attempt) || 0,
    max_attempts: Number(row.max_attempts) || 1,
    resumed_at: row.resumed_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export function createTerminalJob(session, input = {}) {
  const command = String(input.command || '').trim();
  if (!command) throw new Error('command_required');
  const idempotencyKey = String(input.idempotency_key || '').trim() || null;
  if (idempotencyKey) {
    const existing = [...session.sql.exec(`SELECT * FROM terminal_jobs WHERE idempotency_key = ? LIMIT 1`, idempotencyKey)][0];
    if (existing) return { ...terminalJobFromRow(existing), dependencies: getTerminalJobDependencies(session, existing.id), deduped: true };
  }
  const id = String(input.job_id || `tjob_${crypto.randomUUID().replace(/-/g, '')}`).trim();
  const timeoutMs = input.timeout_ms != null && Number.isFinite(Number(input.timeout_ms))
    ? Math.max(1000, Math.min(60 * 60 * 1000, Number(input.timeout_ms)))
    : 10 * 60 * 1000;
  const artifacts = normalizeArtifactReceipts(input.artifact_refs);
  const linked = !!(String(input.conversation_id || '').trim() && String(input.turn_id || '').trim());
  const resumePolicy = normalizeResumePolicy(input.resume_policy, linked);
  const retryPolicy = normalizeRetryPolicy(input.retry_policy || { max_attempts: input.max_attempts });
  session.sql.exec(
    `INSERT INTO terminal_jobs
      (id, status, protocol, command, cwd, target_id, target_type, progress, timeout_ms, artifact_refs_json,
       conversation_id, turn_id, user_id, workspace_id, tenant_id, agent_id, tool_call_id, idempotency_key, resume_policy, retry_policy_json,
       attempt, max_attempts, created_at, updated_at)
     VALUES (?, 'queued', 'batch_exec', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, unixepoch(), unixepoch())`,
    id, command,
    input.cwd ? String(input.cwd) : null,
    input.target_id ? String(input.target_id) : null,
    input.target_type ? String(input.target_type) : null,
    timeoutMs, JSON.stringify(artifacts),
    input.conversation_id ? String(input.conversation_id) : null,
    input.turn_id ? String(input.turn_id) : null,
    input.user_id ? String(input.user_id) : null,
    input.workspace_id ? String(input.workspace_id) : null,
    input.tenant_id ? String(input.tenant_id) : null,
    input.agent_id ? String(input.agent_id) : null,
    input.tool_call_id ? String(input.tool_call_id) : null,
    idempotencyKey, resumePolicy, JSON.stringify(retryPolicy), retryPolicy.max_attempts,
  );
  try {
    setTerminalJobDependencies(session, id, input.depends_on || input.dependencies || []);
  } catch (e) {
    session.sql.exec(`DELETE FROM terminal_job_dependencies WHERE job_id = ?`, id);
    session.sql.exec(`DELETE FROM terminal_jobs WHERE id = ?`, id);
    throw e;
  }
  const created = getTerminalJob(session, id);
  return { ...created, dependencies: getTerminalJobDependencies(session, id), deduped: false };
}

export function getTerminalJob(session, jobId) {
  const id = String(jobId || '').trim();
  if (!id) return null;
  const row = [...session.sql.exec(`SELECT * FROM terminal_jobs WHERE id = ? LIMIT 1`, id)][0];
  const job = terminalJobFromRow(row);
  return job ? { ...job, dependencies: getTerminalJobDependencies(session, id) } : null;
}

export function updateTerminalJob(session, jobId, patch = {}) {
  const id = String(jobId || '').trim();
  const current = getTerminalJob(session, id);
  if (!current) return null;
  const status = patch.status != null ? String(patch.status) : current.status;
  if (!isValidTerminalJobStatus(status)) throw new Error(`invalid_terminal_job_status:${status}`);
  const artifacts = patch.artifact_refs != null
    ? normalizeArtifactReceipts(patch.artifact_refs)
    : current.artifact_refs;
  const progress = patch.progress != null
    ? Math.max(0, Math.min(100, Number(patch.progress) || 0))
    : current.progress;
  session.sql.exec(
    `UPDATE terminal_jobs SET
       status = ?, target_id = ?, target_type = ?, target_lane = ?, transport = ?, progress = ?,
       stdout_tail = ?, stderr_tail = ?, exit_code = ?, error = ?, artifact_refs_json = ?, cleanup_json = ?,
       instance_name = ?, started_at = ?, finished_at = ?, cancel_requested_at = ?, cancel_reason = ?,
       attempt = ?, resumed_at = ?, updated_at = unixepoch()
     WHERE id = ?`,
    status,
    patch.target_id !== undefined ? patch.target_id : current.target_id,
    patch.target_type !== undefined ? patch.target_type : current.target_type,
    patch.target_lane !== undefined ? patch.target_lane : current.target_lane,
    patch.transport !== undefined ? patch.transport : current.transport,
    progress,
    patch.stdout_tail !== undefined ? String(patch.stdout_tail || '').slice(-12000) : current.stdout_tail,
    patch.stderr_tail !== undefined ? String(patch.stderr_tail || '').slice(-12000) : current.stderr_tail,
    patch.exit_code !== undefined ? patch.exit_code : current.exit_code,
    patch.error !== undefined ? patch.error : current.error,
    JSON.stringify(artifacts),
    patch.cleanup !== undefined ? JSON.stringify(patch.cleanup) : current.cleanup ? JSON.stringify(current.cleanup) : null,
    patch.instance_name !== undefined ? patch.instance_name : current.instance_name,
    patch.started_at !== undefined ? patch.started_at : current.started_at,
    patch.finished_at !== undefined ? patch.finished_at : current.finished_at,
    patch.cancel_requested_at !== undefined ? patch.cancel_requested_at : current.cancel_requested_at,
    patch.cancel_reason !== undefined ? patch.cancel_reason : current.cancel_reason,
    patch.attempt !== undefined ? patch.attempt : current.attempt,
    patch.resumed_at !== undefined ? patch.resumed_at : current.resumed_at,
    id,
  );
  return getTerminalJob(session, id);
}

export function appendTerminalJobArtifact(session, jobId, artifact) {
  const current = getTerminalJob(session, jobId);
  if (!current) return null;
  const receipt = normalizeArtifactReceipt(artifact);
  if (!receipt) return null;
  const next = normalizeArtifactReceipts([...(current.artifact_refs || []), receipt]);
  return updateTerminalJob(session, jobId, { artifact_refs: next });
}
