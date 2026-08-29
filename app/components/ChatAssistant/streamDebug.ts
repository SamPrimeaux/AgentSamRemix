/**
 * Last Agent chat stream diagnostics for /dashboard/agent self-debug (browser tools read via page.eval).
 * Not a new page — window global only, devtools / automation safe read.
 */

export type IamAgentStreamDebug = {
  debug_id: string;
  sent_at: number | null;
  response_headers_at: number | null;
  http_status: number | null;
  first_sse_event_at: number | null;
  context_event_at: number | null;
  first_text_at: number | null;
  done_at: number | null;
  error_at: number | null;
  abort_at: number | null;
  context: Record<string, unknown> | null;
  /** Last workspace capability router decision (SSE capability_selected); not shown in chat bubble. */
  capability_decision: Record<string, unknown> | null;
  assistant_text_length: number;
  done_received: boolean;
  parser_error: string | null;
  last_tool_name: string | null;
  idle_timeout_at: number | null;
};

declare global {
  interface Window {
    __IAM_AGENT_LAST_STREAM_DEBUG?: IamAgentStreamDebug;
  }
}

function w(): Window & typeof globalThis {
  return typeof window !== 'undefined' ? window : ({} as Window & typeof globalThis);
}

export function initIamAgentStreamDebug(debugId: string): IamAgentStreamDebug {
  const next: IamAgentStreamDebug = {
    debug_id: debugId,
    sent_at: Date.now(),
    response_headers_at: null,
    http_status: null,
    first_sse_event_at: null,
    context_event_at: null,
    first_text_at: null,
    done_at: null,
    error_at: null,
    abort_at: null,
    context: null,
    capability_decision: null,
    assistant_text_length: 0,
    done_received: false,
    parser_error: null,
    last_tool_name: null,
    idle_timeout_at: null,
  };
  w().__IAM_AGENT_LAST_STREAM_DEBUG = next;
  try {
    console.debug('[iam:agent-stream]', 'start', debugId);
  } catch {
    /* ignore */
  }
  return next;
}

export function patchIamAgentStreamDebug(patch: Partial<IamAgentStreamDebug>): void {
  const cur = w().__IAM_AGENT_LAST_STREAM_DEBUG;
  if (!cur) return;
  Object.assign(cur, patch);
  try {
    console.debug('[iam:agent-stream]', patch);
  } catch {
    /* ignore */
  }
}

export function markStreamParserError(msg: string): void {
  patchIamAgentStreamDebug({ parser_error: String(msg || 'parse_error').slice(0, 2000) });
}
