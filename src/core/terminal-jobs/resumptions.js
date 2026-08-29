import { shouldResumeJob } from './policies.js';

function resumeMessage(job) {
  const output = String(job.stdout_tail || '').slice(-8000);
  const stderr = String(job.stderr_tail || '').slice(-4000);
  const artifacts = Array.isArray(job.artifact_refs) ? job.artifact_refs.slice(0, 20) : [];
  return [
    `Background terminal job ${job.job_id} finished with status: ${job.status}.`,
    job.tool_call_id ? `Original tool call: ${job.tool_call_id}.` : '',
    job.error ? `Error: ${job.error}` : '',
    output ? `STDOUT:\n${output}` : '',
    stderr ? `STDERR:\n${stderr}` : '',
    artifacts.length ? `Artifacts:\n${JSON.stringify(artifacts)}` : '',
    'Continue the pending task from the prior conversation turn. Use this result as completed tool evidence; do not rerun the same background job unless the result requires a new attempt.',
  ].filter(Boolean).join('\n\n');
}

async function drainResponse(response) {
  if (!response?.body) return;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

async function runAgentContinuation(session, job) {
  const { executeAgentChatSpine } = await import('../../api/agent-chat-spine.js');
  const message = resumeMessage(job);
  const body = {
    message,
    conversationId: job.conversation_id,
    conversation_id: job.conversation_id,
    sessionId: job.conversation_id,
    mode: 'agent',
    trigger: 'terminal_job_resume',
    source: 'terminal_job',
    stream: true,
    terminal_job_resume: {
      job_id: job.job_id,
      prior_turn_id: job.turn_id,
      tool_call_id: job.tool_call_id || null,
      agent_id: job.agent_id || null,
      status: job.status,
      artifact_refs: job.artifact_refs || [],
    },
  };
  const request = new Request('https://inneranimalmedia.com/api/agent/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-AgentSam-Trigger': 'terminal_job_resume',
    },
    body: JSON.stringify(body),
  });
  const response = await executeAgentChatSpine(session.env, request, session.ctx, {
    body,
    message,
    requestedMode: 'agent',
    tenantId: job.tenant_id,
    userId: job.user_id,
    workspaceId: job.workspace_id,
    sessionId: job.conversation_id,
    authUser: { id: job.user_id, tenant_id: job.tenant_id, workspace_id: job.workspace_id },
  });
  await drainResponse(response);
  return response?.ok !== false;
}

export async function emitTerminalJobResume(session, job) {
  if (!job || job.resumed_at || !shouldResumeJob(job) || !job.conversation_id || !job.turn_id || !session.env?.AGENT_SESSION) {
    return { ok: false, reason: 'resume_not_applicable' };
  }

  const stub = session.env.AGENT_SESSION.get(session.env.AGENT_SESSION.idFromName(String(job.conversation_id)));
  const payload = {
    type: 'terminal_job_resume', job_id: job.job_id, status: job.status,
    agent_id: job.agent_id || null, tool_call_id: job.tool_call_id || null,
    output: job.stdout_tail || '', stderr: job.stderr_tail || '', exit_code: job.exit_code,
    error: job.error, artifact_refs: job.artifact_refs || [],
    target_type: job.target_type, target_lane: job.target_lane, transport: job.transport,
  };
  const notify = await stub.fetch(new Request('https://do/outbox', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ turn_id: job.turn_id, event_type: 'status', payload }),
  })).catch(() => null);

  const canAutoResume = !!(job.user_id && job.workspace_id && job.tenant_id);
  if (!canAutoResume) return { ok: notify?.ok === true, notified: notify?.ok === true, auto_resume: false };

  // DO serialization + this claim makes terminal resumption exactly-once for a job.
  const claimed = [...session.sql.exec(
    `UPDATE terminal_jobs SET resumed_at = unixepoch(), updated_at = unixepoch()
     WHERE id = ? AND resumed_at IS NULL
     RETURNING resumed_at`,
    job.job_id,
  )][0];
  if (!claimed?.resumed_at) return { ok: notify?.ok === true, notified: notify?.ok === true, auto_resume: false };

  const continuation = typeof session.runAgentContinuationForJob === 'function'
    ? session.runAgentContinuationForJob.bind(session)
    : (nextJob) => runAgentContinuation(session, nextJob);
  session.ctx.waitUntil(
    Promise.resolve(continuation({ ...job, resumed_at: claimed.resumed_at })).catch((e) => {
      session.sql.exec(
        `INSERT INTO terminal_job_events (job_id, event_type, payload) VALUES (?, 'resume_failed', ?)`,
        job.job_id,
        JSON.stringify({ error: String(e?.message || e).slice(0, 1000) }),
      );
    }),
  );
  return { ok: true, notified: notify?.ok === true, auto_resume: true, resumed_at: claimed.resumed_at };
}
