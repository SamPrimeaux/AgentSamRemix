export const TERMINAL_JOB_RESUME_POLICIES = Object.freeze(['none', 'terminal', 'success', 'failure']);

export function normalizeResumePolicy(value, linked = false) {
  const v = String(value || '').trim().toLowerCase();
  return TERMINAL_JOB_RESUME_POLICIES.includes(v) ? v : (linked ? 'terminal' : 'none');
}

export function shouldResumeJob(job) {
  const p = normalizeResumePolicy(job?.resume_policy, false);
  if (p === 'none') return false;
  if (p === 'terminal') return true;
  if (p === 'success') return job?.status === 'succeeded';
  return p === 'failure' && ['failed', 'timed_out', 'cancelled'].includes(job?.status);
}

export function normalizeRetryPolicy(input = {}) {
  const maxRaw = Number(input.max_attempts);
  const delayRaw = Number(input.base_delay_ms);
  return {
    max_attempts: Math.max(1, Math.min(5, Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 1)),
    base_delay_ms: Math.max(0, Math.min(30000, Number.isFinite(delayRaw) && delayRaw >= 0 ? delayRaw : 500)),
    transport_only: input.transport_only !== false,
  };
}
