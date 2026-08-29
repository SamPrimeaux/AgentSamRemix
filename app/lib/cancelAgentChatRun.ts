/**
 * Clean cancel for in-flight Agent Sam chat runs.
 * Stop button, force-hydrate leave, and tab switch should all use this —
 * orphan sweeper is a safety net, not the primary path.
 *
 * Always prefer conversation-scoped cancel when a conversation id is known.
 * Per-run cancel alone is insufficient: the UI often holds a stale run id
 * (prior turn / command_run approval id), and Stop would 404 that id then
 * return without ever cancelling the live conversation's running row.
 */

/** App / ChatAssistant: abort the live SSE fetch after (or with) D1 cancel. */
export const IAM_AGENT_ABORT_LIVE_STREAM = 'iam-agent-abort-live-stream';

/** Spine agent_run ids only — never command_run / approval ids. */
export function isAgentsamAgentRunId(runId: string | null | undefined): boolean {
  const id = String(runId || '').trim();
  return /^arun_[a-zA-Z0-9]+$/i.test(id);
}

export type CancelAgentChatRunOptions = {
  /** Chat conversation / session id — used when runId is unknown or as belt-and-suspenders. */
  conversationId?: string | null;
};

/**
 * POST cancel (by run id and/or conversation), then abort the fetch.
 * Fire-and-forget; never throws.
 */
export function cancelAgentChatRun(
  runId: string | null | undefined,
  opts: CancelAgentChatRunOptions = {},
): void {
  const rawId = String(runId || '').trim();
  const id = isAgentsamAgentRunId(rawId) ? rawId : '';
  const conversationId = String(opts.conversationId || '').trim();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(IAM_AGENT_ABORT_LIVE_STREAM, {
        detail: { runId: id || null, conversationId: conversationId || null },
      }),
    );
  }

  // Conversation cancel first — covers missing/stale runId. Retry briefly so a
  // Stop that races the D1 agent_run INSERT still lands after the row appears.
  if (conversationId) {
    const body = JSON.stringify({
      force_terminal: true,
      reason: 'agent_run_cancelled_stop',
    });
    const postConvCancel = () =>
      fetch(`/api/agent/conversation/${encodeURIComponent(conversationId)}/cancel-runs`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch(() => {});
    postConvCancel();
    if (typeof window !== 'undefined') {
      window.setTimeout(postConvCancel, 400);
      window.setTimeout(postConvCancel, 1200);
    }
  }

  if (id) {
    void fetch(`/api/agent/run/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        force_terminal: true,
        reason: 'agent_run_cancelled_stop',
      }),
    }).catch(() => {});
    return;
  }

  if (!conversationId) {
    console.warn('[cancelAgentChatRun] no arun_ runId or conversationId — UI abort only', {
      ignored_run_id: rawId || null,
    });
  }
}
