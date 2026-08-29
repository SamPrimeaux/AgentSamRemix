/**
 * One DO bootstrap: history + session context + optional codemode prepare.
 */
import { handleGetHistory } from './messages.js';
import { getSessionContext } from './context.js';
import { pruneTurnOutbox } from './turn-outbox.js';

/** Routine model-turn hot history cap (public/history API may still request up to 500). */
export const AGENT_INFERENCE_BOOTSTRAP_HISTORY_LIMIT = 120;

/** @param {unknown} raw */
export function resolveInferenceBootstrapHistoryLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return AGENT_INFERENCE_BOOTSTRAP_HISTORY_LIMIT;
  // agent-controller-prepare still passes legacy 500 — cap routine inference bootstrap only.
  if (n >= 500) return AGENT_INFERENCE_BOOTSTRAP_HISTORY_LIMIT;
  return Math.min(Math.max(n, 1), 500);
}

/**
 * @param {import('../../../../src/do/AgentChat.js').AgentChatSqlV1} session
 * @param {{
 *   historyLimit?: number,
 *   prepareCodemode?: boolean,
 *   runContext?: Record<string, unknown>,
 *   codemodeOpts?: { toolKeys?: string[], allowlistKeys?: string[] },
 * }} [opts]
 */
export async function bootstrapAgentChatTurn(session, opts = {}) {
  const pruned = pruneTurnOutbox(session.sql);
  const historyLimit = resolveInferenceBootstrapHistoryLimit(opts.historyLimit);
  const url = new URL('https://do/history');
  url.searchParams.set('limit', String(historyLimit));
  const historyResp = await handleGetHistory(session, url);
  const historyJson = await historyResp.json().catch(() => ({}));
  const messages = Array.isArray(historyJson?.messages) ? historyJson.messages : [];
  const sessionContext = await getSessionContext(session);
  let codemode = null;
  if (opts.prepareCodemode === true && typeof session.prepareCodemodeRuntime === 'function') {
    try {
      codemode = await session.prepareCodemodeRuntime(opts.runContext || {}, opts.codemodeOpts || {});
    } catch (e) {
      console.warn('[bootstrap] prepareCodemode', e?.message ?? e);
      codemode = null;
    }
  }
  return {
    messages,
    sessionContext: sessionContext || null,
    codemode,
    outbox_pruned: pruned,
  };
}
