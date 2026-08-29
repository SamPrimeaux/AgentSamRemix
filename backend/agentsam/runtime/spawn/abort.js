// guard-dup-allow: backend spawn peel; unrelated legacy abort callers remain in src/core.
/** Abort classification for asynchronous multitask lane failures. */

export function isAgentRunAbortError(error) {
  if (!error) return false;
  if (error.name === 'AbortError') return true;
  const code = String(error.code || '').trim();
  return code === 'agent_run_cancelled' || code === 'spend_cap_exceeded';
}
