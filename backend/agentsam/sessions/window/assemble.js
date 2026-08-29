/**
 * Pre-inference turn assembler.
 *
 * Law:
 *   DO = immutable canonical history
 *   Working copy = model-specific context (tools/system/RAG/messages)
 *   Compaction = ephemeral transform of the working copy only
 *
 * Wire immediately before the provider call — after model, system, and tools
 * are resolved — so pressure reflects the next inference payload.
 */

import {
  resolveCompactionBudget,
  loadModelContextWindow,
  compactConversationMessagesIfNeeded,
  COMPACTION_RESERVED_TOKENS,
} from '../compaction/compact.js';
import {
  windowChatMessagesForHydrate,
  prependChatDigest,
  RECENT_VERBATIM_USER_TURNS,
} from './hydrate.js';
import { estimateTokensFromChars } from '../../../../src/core/openai-usage-tokens.js';

function systemPromptString(systemPrompt) {
  if (systemPrompt == null) return '';
  if (typeof systemPrompt === 'string') return systemPrompt;
  try {
    return JSON.stringify(systemPrompt);
  } catch {
    return '';
  }
}

/**
 * @param {unknown[]} messages
 * @returns {any[]}
 */
export function cloneMessagesForWorkingContext(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.map((m) => {
    if (!m || typeof m !== 'object') return m;
    try {
      return structuredClone(m);
    } catch {
      try {
        return JSON.parse(JSON.stringify(m));
      } catch {
        return { ...m };
      }
    }
  });
}

/**
 * Estimated next-call input tokens: messages + system + tool definitions.
 * @param {{ messages?: unknown[], systemPrompt?: unknown, tools?: unknown }} parts
 */
export function estimateAssembledPromptTokens(parts = {}) {
  const messagesJson = JSON.stringify(parts.messages || []);
  const toolsJson = JSON.stringify(parts.tools || []);
  const sysStr = systemPromptString(parts.systemPrompt);
  const messageTokens = estimateTokensFromChars(messagesJson);
  const toolTokens = estimateTokensFromChars(toolsJson);
  const systemTokens = estimateTokensFromChars(sysStr);
  return {
    estimated_message_tokens: messageTokens,
    estimated_tool_tokens: toolTokens,
    estimated_system_tokens: systemTokens,
    estimated_total_prompt_tokens: messageTokens + toolTokens + systemTokens,
  };
}

/**
 * Reduce a working message copy until assembled prompt pressure is under
 * ~85% of usable model context. Never mutates Durable Object history.
 *
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   messages: unknown[],
 *   systemPrompt?: unknown,
 *   tools?: unknown,
 *   modelKey?: string|null,
 *   contextWindowTokens?: number|null,
 *   maxOutputTokens?: number|null,
 *   conversationId?: string|null,
 *   userId?: string|null,
 *   workspaceId?: string|null,
 *   tenantId?: string|null,
 *   agentRunId?: string|null,
 *   digestText?: string|null,
 * }} params
 */
export async function assembleWorkingContextForInference(env, ctx, params) {
  let working = cloneMessagesForWorkingContext(params.messages);
  const systemPrompt = params.systemPrompt;
  const tools = params.tools;
  const modelKey = String(params.modelKey || '').trim() || null;

  let contextWindow =
    Number(params.contextWindowTokens) > 0
      ? Number(params.contextWindowTokens)
      : await loadModelContextWindow(env, modelKey);
  if (!(contextWindow > 0)) contextWindow = 200_000;

  const reserve =
    Number(params.maxOutputTokens) > 0
      ? Math.floor(Number(params.maxOutputTokens))
      : COMPACTION_RESERVED_TOKENS;
  const budget = resolveCompactionBudget(contextWindow, { reservedTokens: reserve });

  const measure = () =>
    estimateAssembledPromptTokens({ messages: working, systemPrompt, tools })
      .estimated_total_prompt_tokens;

  let estimated = measure();
  /** @type {string[]} */
  const steps = [];

  if (estimated < budget.compactAt) {
    return {
      messages: working,
      compacted: false,
      estimated,
      compactAt: budget.compactAt,
      usable: budget.usable,
      contextWindow: budget.contextWindow,
      steps,
    };
  }

  const { compactConsumedToolResultsInPlace, compactGeminiReplayPartsInPlace } = await import(
    '../../runtime/tool-loop/tool-result-compaction.js'
  );
  const tool = compactConsumedToolResultsInPlace(working, { protectLatestBatch: true });
  const gemini = compactGeminiReplayPartsInPlace(working);
  if (tool.compactedBlocks + gemini.droppedThoughts > 0) {
    steps.push('consumed_tool_trim');
  }
  estimated = measure();
  if (estimated < budget.compactAt) {
    return {
      messages: working,
      compacted: steps.length > 0,
      estimated,
      compactAt: budget.compactAt,
      usable: budget.usable,
      contextWindow: budget.contextWindow,
      steps,
    };
  }

  // Durable archive/embed must run on the full pre-window working copy before any
  // recent-verbatim discard — dropped ranges must be represented by digest/checkpoint.
  const userId = String(params.userId || '').trim();
  const workspaceId = String(params.workspaceId || '').trim();
  const conversationId = String(params.conversationId || '').trim();
  let digestText = params.digestText || null;
  if (userId && workspaceId && conversationId) {
    try {
      const out = await compactConversationMessagesIfNeeded(env, ctx, {
        messages: working,
        userId,
        workspaceId,
        tenantId: params.tenantId || null,
        conversationId,
        modelKey,
        contextWindowTokens: contextWindow,
        agentRunId: params.agentRunId || null,
        promptOverheadTokens:
          estimateAssembledPromptTokens({ messages: [], systemPrompt, tools })
            .estimated_total_prompt_tokens,
        force: false,
      });
      if (out?.compacted && Array.isArray(out.messages)) {
        working = cloneMessagesForWorkingContext(out.messages);
        steps.push('digest_summary');
        estimated = measure();
        if (estimated < budget.compactAt) {
          return {
            messages: working,
            compacted: true,
            estimated,
            compactAt: budget.compactAt,
            usable: budget.usable,
            contextWindow: budget.contextWindow,
            steps,
          };
        }
      }
    } catch (e) {
      console.warn('[turn-assembler] digest_summary', e?.message ?? e);
    }
  }

  // Prefer recent fidelity: keep last 8–12 user turns verbatim, drop older
  // active history from the working copy only. Char/message caps scale with
  // usable budget — not the old universal 48 / 80k ceilings.
  const charBudget = Math.max(32_000, Math.floor(budget.usable * 4 * 0.9));
  const windowed = windowChatMessagesForHydrate(working, {
    userTurns: RECENT_VERBATIM_USER_TURNS,
    messageCap: 500,
    charBudget,
  });
  if (windowed.dropped > 0) {
    working = prependChatDigest(windowed.messages, digestText);
    steps.push('recent_verbatim_window');
    estimated = measure();
  }

  return {
    messages: working,
    compacted: steps.length > 0,
    estimated,
    compactAt: budget.compactAt,
    usable: budget.usable,
    contextWindow: budget.contextWindow,
    steps,
  };
}
