import { isTerminalTransportFailure } from '../../../backend/agentsam/terminal/execution-result.js';
import { getTerminalJob, updateTerminalJob } from './store.js';
import { publishTerminalJobEvent } from './events.js';
import { isTerminalJobTerminal } from './state.js';
import { normalizeRetryPolicy } from './policies.js';

function nowSec() { return Math.floor(Date.now() / 1000); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function executeJobCommand(session, command, opts) {
  if (typeof session.executeBatchCommandForJob === 'function') {
    return session.executeBatchCommandForJob(command, opts);
  }
  const { executeBatchCommand } = await import('../../../backend/agentsam/terminal/batch-exec.js');
  return executeBatchCommand(session, command, opts);
}

function controllers(session) {
  if (!session._terminalJobControllers) session._terminalJobControllers = new Map();
  return session._terminalJobControllers;
}

export function isTerminalJobCancellationRequested(session, jobId) {
  const job = getTerminalJob(session, jobId);
  return !!job?.cancel_requested_at || job?.status === 'cancelled';
}

async function finishJob(session, id, patch, eventType) {
  const final = updateTerminalJob(session, id, { ...patch, progress: 100, finished_at: patch.finished_at ?? nowSec() });
  publishTerminalJobEvent(session, id, eventType, final);
  const { finalizeTerminalJobOrchestration } = await import('./orchestration.js');
  await finalizeTerminalJobOrchestration(session, final).catch(() => {});
  return final;
}

export async function runTerminalJob(session, jobId, input = {}) {
  const id = String(jobId || '').trim();
  const initial = getTerminalJob(session, id);
  if (!initial) throw new Error('terminal_job_not_found');
  if (initial.status !== 'queued') return initial;
  if (initial.user_id) session.ptSessionUserId = String(initial.user_id);
  if (initial.workspace_id) session.workspaceId = String(initial.workspace_id);
  if (initial.tenant_id) session.ptSessionTenantId = String(initial.tenant_id);
  if (initial.target_type) session.requestedTargetType = String(initial.target_type);
  if (initial.target_id) session.requestedConnectionId = String(initial.target_id);
  if (isTerminalJobCancellationRequested(session, id)) return initial;

  const controller = new AbortController();
  controllers(session).set(id, controller);
  const startedAt = nowSec();
  updateTerminalJob(session, id, { status: 'running', progress: 5, started_at: startedAt });
  publishTerminalJobEvent(session, id, 'running', { progress: 5, started_at: startedAt });

  const timeoutMs = Math.max(1000, Number(initial.timeout_ms) || 10 * 60 * 1000);
  let timeoutFired = false;
  const timeout = setTimeout(() => {
    timeoutFired = true;
    try { controller.abort(new Error('terminal_job_timeout')); } catch {}
  }, timeoutMs);

  const retry = normalizeRetryPolicy(initial.retry_policy || { max_attempts: initial.max_attempts });
  const maxAttempts = Math.max(1, Number(initial.max_attempts) || retry.max_attempts || 1);

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (controller.signal.aborted || isTerminalJobCancellationRequested(session, id)) break;
      updateTerminalJob(session, id, { progress: attempt === 1 ? 15 : 20, attempt });
      publishTerminalJobEvent(session, id, 'progress', {
        progress: attempt === 1 ? 15 : 20,
        phase: attempt === 1 ? 'resolving_execution_plan' : 'retrying_transport',
        attempt,
        max_attempts: maxAttempts,
      });

      let result;
      try {
        const { runMcpZoneSandboxCommand } = await import(
          '../../../backend/agentsam/mcp/sandbox-exec.js'
        );
        result = await executeJobCommand(session, initial.command, {
          ...input,
          target_id: initial.target_id || input.target_id,
          target_type: initial.target_type || input.target_type,
          cwd: initial.cwd || input.cwd,
          timeout_ms: timeoutMs,
          signal: controller.signal,
          job_id: id,
          runMcpZoneSandboxCommand,
        });
      } catch (e) {
        result = { error: String(e?.message || e), exit_code: null };
      }

      const cancelled = isTerminalJobCancellationRequested(session, id) || controller.signal.aborted;
      if (cancelled) {
        const status = timeoutFired ? 'timed_out' : 'cancelled';
        return finishJob(session, id, {
          status,
          stdout_tail: result?.stdout ?? result?.output ?? '',
          stderr_tail: result?.stderr ?? '',
          exit_code: result?.exit_code ?? null,
          error: timeoutFired ? 'terminal_job_timeout' : 'terminal_job_cancelled',
          cleanup: result?.cleanup ?? null,
          instance_name: result?.instance_name ?? null,
          target_id: result?.target_id ?? initial.target_id,
          target_type: result?.target_type ?? initial.target_type,
          target_lane: result?.target_lane ?? null,
          transport: result?.transport ?? null,
          artifact_refs: result?.artifact_refs ?? initial.artifact_refs,
          attempt,
        }, status);
      }

      const failed = !!result?.error || (result?.exit_code != null && Number(result.exit_code) !== 0);
      if (!failed) {
        return finishJob(session, id, {
          status: 'succeeded',
          stdout_tail: result?.stdout ?? result?.output ?? '',
          stderr_tail: result?.stderr ?? '',
          exit_code: result?.exit_code ?? 0,
          error: null,
          cleanup: result?.cleanup ?? null,
          instance_name: result?.instance_name ?? null,
          target_id: result?.target_id ?? initial.target_id,
          target_type: result?.target_type ?? initial.target_type,
          target_lane: result?.target_lane ?? null,
          transport: result?.transport ?? null,
          artifact_refs: result?.artifact_refs ?? initial.artifact_refs,
          attempt,
        }, 'succeeded');
      }

      const mayRetry = attempt < maxAttempts && (!retry.transport_only || isTerminalTransportFailure(result));
      if (mayRetry) {
        const delayMs = Math.min(30000, retry.base_delay_ms * Math.max(1, 2 ** (attempt - 1)));
        publishTerminalJobEvent(session, id, 'retry_scheduled', {
          job_id: id, attempt, next_attempt: attempt + 1, delay_ms: delayMs,
          error: result?.error ?? result?.stderr ?? null,
        });
        if (delayMs > 0) await sleep(delayMs);
        continue;
      }

      return finishJob(session, id, {
        status: 'failed',
        stdout_tail: result?.stdout ?? result?.output ?? '',
        stderr_tail: result?.stderr ?? '',
        exit_code: result?.exit_code ?? null,
        error: result?.error ?? (result?.exit_code != null ? `exit_code_${result.exit_code}` : 'terminal_job_failed'),
        cleanup: result?.cleanup ?? null,
        instance_name: result?.instance_name ?? null,
        target_id: result?.target_id ?? initial.target_id,
        target_type: result?.target_type ?? initial.target_type,
        target_lane: result?.target_lane ?? null,
        transport: result?.transport ?? null,
        artifact_refs: result?.artifact_refs ?? initial.artifact_refs,
        attempt,
      }, 'failed');
    }

    const status = timeoutFired ? 'timed_out' : 'cancelled';
    return finishJob(session, id, {
      status,
      error: timeoutFired ? 'terminal_job_timeout' : 'terminal_job_cancelled',
      attempt: getTerminalJob(session, id)?.attempt || 0,
    }, status);
  } finally {
    clearTimeout(timeout);
    controllers(session).delete(id);
  }
}

export function cancelTerminalJob(session, jobId, reason = 'cancelled_by_user') {
  const id = String(jobId || '').trim();
  const job = getTerminalJob(session, id);
  if (!job) return null;
  if (isTerminalJobTerminal(job.status)) return job;
  const at = nowSec();
  const updated = updateTerminalJob(session, id, {
    status: job.status === 'queued' ? 'cancelled' : job.status,
    cancel_requested_at: at,
    cancel_reason: String(reason || 'cancelled_by_user').slice(0, 500),
    ...(job.status === 'queued' ? { progress: 100, error: reason, finished_at: at } : {}),
  });
  const controller = controllers(session).get(id);
  if (controller) {
    try { controller.abort(new Error(reason)); } catch {}
  }
  publishTerminalJobEvent(session, id, job.status === 'queued' ? 'cancelled' : 'cancel_requested', {
    job_id: id, reason, cancel_requested_at: at,
  });
  if (job.status === 'queued') {
    void import('./orchestration.js').then(({ finalizeTerminalJobOrchestration }) => finalizeTerminalJobOrchestration(session, updated)).catch(() => {});
  }
  return updated;
}

export function updateTerminalJobProgress(session, jobId, progress, payload = {}) {
  const id = String(jobId || '').trim();
  const current = getTerminalJob(session, id);
  if (!current) return null;
  if (isTerminalJobTerminal(current.status)) return current;
  const pct = Math.max(0, Math.min(99, Number(progress) || 0));
  const job = updateTerminalJob(session, id, {
    progress: pct,
    stdout_tail: payload.stdout_tail !== undefined ? payload.stdout_tail : current.stdout_tail,
    stderr_tail: payload.stderr_tail !== undefined ? payload.stderr_tail : current.stderr_tail,
  });
  publishTerminalJobEvent(session, id, 'progress', {
    job_id: id, progress: pct,
    message: payload.message != null ? String(payload.message).slice(0, 1000) : null,
    phase: payload.phase != null ? String(payload.phase).slice(0, 160) : null,
  });
  return job;
}
