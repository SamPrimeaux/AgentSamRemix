/**
 * Tool payload parsers for Agent Sam SSE consume.
 */
import type { AgentToolTraceRow } from '../../execution/types';

export function parseScreenshotUrlFromToolPayload(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const candidates = [
      parsed.screenshot_url,
      parsed.result_url,
      parsed.screenshotUrl,
      parsed.image_url,
      parsed.public_url,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) {
        const v = c.trim();
        if (/^https?:/i.test(v) || v.startsWith('data:')) return v;
      }
    }
    if (typeof parsed.data_url === 'string' && parsed.data_url.trim()) {
      return parsed.data_url.trim();
    }
    const nested = parsed.result;
    if (nested && typeof nested === 'object') {
      const r = nested as Record<string, unknown>;
      for (const c of [r.screenshot_url, r.result_url, r.url]) {
        if (typeof c === 'string' && c.trim() && /^https?:/i.test(c.trim())) return c.trim();
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function parseBrowserNavigatePreview(raw: string | null | undefined): {
  screenshot_url?: string;
  page_text?: string;
  title?: string;
} {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const shot =
      parseScreenshotUrlFromToolPayload(raw) ||
      (typeof parsed.screenshot_url === 'string' ? parsed.screenshot_url : null);
    const page_text =
      (typeof parsed.page_text === 'string' && parsed.page_text) ||
      (typeof parsed.text === 'string' && parsed.text) ||
      undefined;
    const title = typeof parsed.title === 'string' ? parsed.title : undefined;
    return {
      ...(shot ? { screenshot_url: shot } : {}),
      ...(page_text ? { page_text } : {}),
      ...(title ? { title } : {}),
    };
  } catch {
    return {};
  }
}

export function parseBrowserLiveSessionFromToolPayload(raw: string | null | undefined): {
  live_view_url?: string;
  session_id?: string;
  url?: string;
} | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const body =
      parsed.body && typeof parsed.body === 'object'
        ? (parsed.body as Record<string, unknown>)
        : parsed;
    const live =
      body.live_session && typeof body.live_session === 'object'
        ? (body.live_session as Record<string, unknown>)
        : body;
    const liveViewUrl =
      (typeof live.devtools_frontend_url === 'string' && live.devtools_frontend_url) ||
      (typeof body.devtools_frontend_url === 'string' && body.devtools_frontend_url) ||
      undefined;
    const sessionId =
      (typeof live.session_id === 'string' && live.session_id) ||
      (typeof body.session_id === 'string' && body.session_id) ||
      undefined;
    const url = typeof live.url === 'string' ? live.url : typeof body.url === 'string' ? body.url : undefined;
    if (!liveViewUrl && !sessionId) return null;
    return { live_view_url: liveViewUrl, session_id: sessionId, url };
  } catch {
    return null;
  }
}

export function resolveToolTraceRowId(
  prev: AgentToolTraceRow[],
  toolCallId: string | null | undefined,
  activeId: string | null,
  toolName: string,
): string | null {
  const cid = toolCallId?.trim();
  if (cid) {
    const hit = prev.find((r) => r.id === cid || r.toolCallId === cid);
    if (hit) return hit.id;
  }
  if (activeId && prev.some((r) => r.id === activeId)) return activeId;
  const oldest = prev.find((r) => r.status === 'running' && r.toolName === toolName);
  return oldest?.id ?? activeId;
}

