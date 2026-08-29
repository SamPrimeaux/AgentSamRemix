/**
 * MCP panel session finalization — one path for success and error.
 */
import { finalizeMcpZoneChat } from './zone-session.js';

export const MCP_PANEL_HISTORY_CAP = 40;

/**
 * @param {{ role?: string, content?: string }[]} priorMessages
 * @param {string} [assistantText]
 * @returns {{ role: string, content: string }[]}
 */
export function buildMcpPanelHistoryMessages(priorMessages, assistantText) {
  const next = [
    ...(Array.isArray(priorMessages) ? priorMessages : []).map((m) => ({
      role: String(m?.role || ''),
      content: String(m?.content || ''),
    })),
    ...(assistantText ? [{ role: 'assistant', content: String(assistantText) }] : []),
  ].filter((m) => m.content && (m.role === 'user' || m.role === 'assistant'));
  return next.slice(-MCP_PANEL_HISTORY_CAP);
}

/**
 * Canonical zone idle/complete write after a panel chat turn.
 * @param {any} env
 * @param {{
 *   zoneSlug: string,
 *   tenantId: string,
 *   messages?: { role: string, content: string }[] | null,
 *   toolCallsUsed?: number,
 *   status?: string,
 * }} p
 */
export async function completeMcpPanelSession(env, p) {
  return finalizeMcpZoneChat(env, {
    zoneSlug: p.zoneSlug,
    tenantId: p.tenantId,
    messages: Array.isArray(p.messages) ? p.messages : undefined,
    toolCallsUsed: Number(p.toolCallsUsed) || 0,
    status: p.status || 'idle',
  });
}

/**
 * Schedule finalize via waitUntil when available; otherwise fire-and-forget.
 * @param {any} env
 * @param {any} ctx
 * @param {Parameters<typeof completeMcpPanelSession>[1]} p
 */
export function scheduleMcpPanelSessionComplete(env, ctx, p) {
  const run = () =>
    completeMcpPanelSession(env, p).catch((e) => {
      console.warn('[mcp_panel_chat] session update failed:', e?.message ?? e);
    });
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(run());
  } else {
    void run();
  }
}
