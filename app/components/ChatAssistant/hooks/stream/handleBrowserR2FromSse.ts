/**
 * r2_file_updated / client_fs_request / browser_* SSE events.
 */
import { LS_AGENT_CHAT_CONVERSATION_ID } from '../../../../agentChatConstants';
import { sanitizeBrowserNavigateUrl } from '../../../../lib/sanitizeBrowserUrl';
import { fulfillClientFsRequest } from '../../../../src/lib/library/clientFsFulfill';
import { resolveToolTraceRowId } from './sseHelpersToolParse';
import type { SseSession, SseDispatchResult } from './sseTypes';

export function handleBrowserR2FromSse(s: SseSession, data: unknown, evType: string | undefined): SseDispatchResult {
if (
  data &&
  typeof data === 'object' &&
  (data as { type?: string }).type === 'r2_file_updated' &&
  typeof (data as { bucket?: string }).bucket === 'string' &&
  typeof (data as { key?: string }).key === 'string'
) {
  const r2evt = data as { type: 'r2_file_updated'; bucket: string; key: string };
  s.ctx.onR2FileUpdated?.(r2evt);
  s.fileEchoSuppress = false;
  return 'continue';
}
if (
  data &&
  typeof data === 'object' &&
  (data as { type?: string }).type === 'client_fs_request'
) {
  const fsEvt = data as {
    call_id?: string;
    callId?: string;
    path?: string;
    operation?: string;
    content?: string | null;
    conversation_id?: string;
  };
  const lsConv =
    typeof localStorage !== 'undefined'
      ? String(localStorage.getItem(LS_AGENT_CHAT_CONVERSATION_ID) || '').trim()
      : '';
  void fulfillClientFsRequest(fsEvt, {
    conversationId:
      fsEvt.conversation_id ||
      s.activeConversationId ||
      lsConv ||
      s.pendingConversationUrlSync ||
      null,
  });
  return 'continue';
}
if (
  data &&
  typeof data === 'object' &&
  (data as { type?: string }).type === 'browser_trust_required'
) {
  const d = data as { origin?: string; url?: string; tool_name?: string };
  const origin = typeof d.origin === 'string' ? d.origin : '';
  const url =
    origin ||
    (typeof d.url === 'string' && d.url.trim() ? d.url.trim() : '');
  if (url && typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('iam-browser-trust-required', {
        detail: { origin: url, url, tool_name: d.tool_name },
      }),
    );
  }
  return 'continue';
}
if (
  data &&
  typeof data === 'object' &&
  (data as { type?: string }).type === 'browser_live_view_ready'
) {
  const d = data as {
    type: 'browser_live_view_ready';
    url?: string;
    live_view_url?: string;
    session_id?: string;
    target_id?: string;
    title?: string;
  };
  s.ctx.onThinkingEvent?.({
    type: 'browser_live_view_ready',
    url: d.url,
    live_view_url: d.live_view_url,
    title: d.title,
  });
  if (typeof window !== 'undefined' && (d.live_view_url || d.session_id)) {
    window.dispatchEvent(
      new CustomEvent('iam-browser-agent-live', {
        detail: {
          url: d.url || 'about:blank',
          live_view_url: d.live_view_url,
          session_id: d.session_id,
          agent_run_id: d.agent_run_id,
        },
      }),
    );
  }
  if (d.url && s.ctx.onBrowserNavigate) {
    const navUrl = sanitizeBrowserNavigateUrl(String(d.url));
    if (navUrl && !/\/api\/r2\/file\b/i.test(navUrl)) {
      s.ctx.onBrowserNavigate({
        type: 'browser_navigate',
        url: navUrl,
        automation: true,
        agent_live: true,
        live_view_url: d.live_view_url,
        session_id: d.session_id,
      });
    }
  }
  return 'continue';
}
if (
  data &&
  typeof data === 'object' &&
  (data as { type?: string }).type === 'browser_human_input_required'
) {
  const d = data as {
    type: 'browser_human_input_required';
    reason?: string;
    live_view_url?: string;
    url?: string;
    resume_when?: string;
    session_id?: string;
  };
  s.ctx.onThinkingEvent?.({
    type: 'browser_human_input_required',
    reason: d.reason,
    live_view_url: d.live_view_url,
    url: d.url,
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('iam-browser-human-input-required', {
        detail: {
          reason: d.reason,
          live_view_url: d.live_view_url,
          url: d.url,
          resume_when: d.resume_when,
          session_id: d.session_id,
        },
      }),
    );
  }
  return 'continue';
}
if (
  data &&
  typeof data === 'object' &&
  (data as { type?: string }).type === 'browser_human_input_resumed'
) {
  s.ctx.onThinkingEvent?.({ type: 'browser_human_input_resumed' });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('iam-browser-human-input-resumed'));
  }
  return 'continue';
}
if (
  data &&
  typeof data === 'object' &&
  [
    'browser_session_starting',
    'browser_session_ready',
    'browser_action_started',
    'browser_action_done',
    'browser_live_view_refresh',
    'browser_session_closed',
    'browser_human_input_cancelled',
    'browser_navigated',
    'browser_scrolled',
  ].includes(String((data as { type?: string }).type || ''))
) {
  const d = data as {
    type: string;
    tool_name?: string;
    url?: string;
    title?: string;
    live_view_url?: string;
    direction?: string;
    ok?: boolean;
    reason?: string;
  };
  s.ctx.onThinkingEvent?.({
    type: d.type,
    tool_name: d.tool_name,
    url: d.url,
    title: d.title,
    live_view_url: d.live_view_url,
    ok: d.ok,
    reason: d.reason,
  });
  return 'continue';
}
if (
  data &&
  typeof data === 'object' &&
  (data as { type?: string }).type === 'browser_verification_failed'
) {
  const d = data as {
    type: 'browser_verification_failed';
    tool_name?: string;
    tool_call_id?: string;
    requested_url?: string;
    url?: string;
    error?: string;
  };
  s.ctx.onThinkingEvent?.({
    type: 'browser_verification_failed',
    tool_name: d.tool_name || 'browser_navigate',
    message: d.error || 'Navigation was requested but not verified.',
  });
  const failMsg = String(d.error || 'Navigation was requested but not verified.').slice(0, 4000);
  const toolLabel = String(d.tool_name || 'browser_navigate');
  s.ctx.setToolTraceRows?.((prev) => {
    const closedRowId = resolveToolTraceRowId(
      prev,
      d.tool_call_id,
      s.activeToolTraceId,
      toolLabel,
    );
    if (closedRowId && prev.some((r) => r.id === closedRowId)) {
      return prev.map((r) =>
        r.id === closedRowId
          ? {
              ...r,
              status: 'error' as const,
              lines: [...r.lines, failMsg],
            }
          : r,
      );
    }
    return prev;
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('iam-browser-url-verification-failed', {
        detail: {
          requested_url: d.requested_url,
          url: d.url,
          tool_call_id: d.tool_call_id ?? null,
        },
      }),
    );
  }
  return 'continue';
}
if (
  data &&
  typeof data === 'object' &&
  (data as { type?: string }).type === 'browser_url_committed'
) {
  const d = data as {
    type: 'browser_url_committed';
    url?: string;
    title?: string;
    verified?: boolean;
    session_id?: string;
    live_view_url?: string;
    agent_run_id?: string;
    smoke_debug?: Record<string, unknown> | null;
  };
  const navUrl = sanitizeBrowserNavigateUrl(String(d.url || ''));
  s.ctx.onThinkingEvent?.({
    type: 'browser_url_committed',
    tool_name: 'browser_navigate',
    url: navUrl || d.url,
    title: d.title,
    ok: d.verified === true,
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('iam-browser-url-committed', {
        detail: {
          url: navUrl || d.url,
          title: d.title,
          verified: d.verified !== false,
          session_id: d.session_id,
          live_view_url: d.live_view_url,
          agent_run_id: d.agent_run_id,
          smoke_debug: d.smoke_debug ?? null,
        },
      }),
    );
  }
  if (navUrl && d.verified === true && !/\/api\/r2\/file\b/i.test(navUrl)) {
    s.ctx.onBrowserNavigate?.({
      type: 'browser_navigate',
      url: navUrl,
      automation: true,
      agent_live: true,
      live_view_url: d.live_view_url,
      session_id: d.session_id,
      title: d.title,
      verified: true,
    } as Parameters<NonNullable<typeof s.ctx.onBrowserNavigate>>[0] & { verified?: boolean });
  }
  return 'continue';
}
if (
  data &&
  typeof data === 'object' &&
  (data as { type?: string }).type === 'browser_navigate' &&
  typeof (data as { url?: string }).url === 'string'
) {
  const d = data as {
    url: string;
    screenshot_url?: string;
    page_text?: string;
    title?: string;
  };
  const navUrl = sanitizeBrowserNavigateUrl(String(d.url));
  if (navUrl && !/\/api\/r2\/file\b/i.test(navUrl)) {
    s.ctx.onBrowserNavigate?.({
      type: 'browser_navigate',
      url: navUrl,
      agent_live: Boolean(s.activeAgentRunId),
      automation: Boolean(s.activeAgentRunId),
      page_text: typeof d.page_text === 'string' ? d.page_text : undefined,
      title: typeof d.title === 'string' ? d.title : undefined,
    } as Parameters<NonNullable<typeof s.ctx.onBrowserNavigate>>[0] & {
      agent_live?: boolean;
    });
  }
  return 'continue';
}
return 'fallthrough';
}
