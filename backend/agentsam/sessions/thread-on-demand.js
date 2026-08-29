/**
 * On-demand thread /compact and /summarize — chat slash commands + in-app dispatch.
 * /compact → conversation compaction (R2 digest, D1 agentsam_chat_sessions, docs lane).
 * /summarize → Worker session summarize into MemoryService; non-blocking, never throws.
 *
 * Message SSOT is not a D1 `agent_messages` table. Transcript lives in the
 * AgentChat DO, with R2 fallback keyed by `agentsam_chat_sessions.r2_messages_key`.
 */

const THREAD_SLASH_RE = /^\/(compact|summarize)\s*$/i;

const SUMMARY_SYSTEM = `You are Agent Sam session historian. Summarize this chat for long-term memory.
Preserve: decisions, file/paths, migrations, errors+fixes, user constraints, open follow-ups, workspace/project names.
Output plain prose under 900 tokens. No markdown headers. No bullet lists.`;

function normalizeMessagesForCompaction(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      role: String(m.role || 'user'),
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    }));
}

function formatTranscriptForSummary(messages, maxMessages = 60) {
  const arr = Array.isArray(messages) ? messages : [];
  const sliced = arr.length > maxMessages ? arr.slice(-maxMessages) : arr;
  return sliced
    .map((m) => {
      const role = String(m?.role || 'user').trim() || 'user';
      const content = String(m?.content ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2000);
      return content ? `${role}: ${content}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * @param {string} message
 * @returns {'compact'|'summarize'|null}
 */
export function parseThreadSlashCommand(message) {
  const m = String(message || '').trim().match(THREAD_SLASH_RE);
  if (!m) return null;
  return m[1].toLowerCase() === 'summarize' ? 'summarize' : 'compact';
}

/**
 * Prefer durable session history (DO, then R2 via agentsam_chat_sessions).
 * Client payload is fallback only when the store is empty.
 *
 * @param {any} env
 * @param {string} conversationId
 * @param {unknown[]} [fallbackMessages]
 */
export async function loadConversationMessages(env, conversationId, fallbackMessages) {
  const cid = String(conversationId || '').trim();
  if (cid) {
    const { getChatMessages } = await import('./chat-do-client.js');
    const stored = normalizeMessagesForCompaction(await getChatMessages(env, cid));
    if (stored.length) return stored;
  }
  return normalizeMessagesForCompaction(fallbackMessages);
}

/**
 * On-demand /summarize — Worker memory write (never throws).
 * @param {any} env
 * @param {{
 *   sessionId: string,
 *   workspaceId: string,
 *   tenantId?: string|null,
 *   userId?: string|null,
 *   messages?: unknown[],
 * }} opts
 */
export async function summarizeThreadOnDemand(env, opts) {
  const sessionId = String(opts?.sessionId || '').trim();
  const workspaceId = String(opts?.workspaceId || '').trim();
  const tenantId = String(opts?.tenantId || '').trim() || null;
  const userId = String(opts?.userId || '').trim() || null;
  const messages = normalizeMessagesForCompaction(opts?.messages);

  if (!sessionId) return { invoked: false, reason: 'missing_session_id' };
  if (!workspaceId) return { invoked: false, reason: 'missing_workspace_id' };

  const transcript = formatTranscriptForSummary(messages);
  if (!transcript) return { invoked: false, reason: 'empty_transcript' };

  try {
    const { dispatchComplete } = await import('../runtime/provider-dispatch.js');
    let summaryText = '';
    try {
      const result = await dispatchComplete(env, {
        modelKey: 'auto',
        systemPrompt: SUMMARY_SYSTEM,
        messages: [{ role: 'user', content: transcript }],
        tools: [],
        userId: userId || undefined,
        options: { reasoningEffort: 'none', verbosity: 'low', maxOutputTokens: 1400 },
      });
      summaryText =
        (typeof result?.text === 'string' && result.text) ||
        result?.choices?.[0]?.message?.content ||
        result?.output_text ||
        '';
      summaryText = String(summaryText).trim();
    } catch (e) {
      console.warn('[thread-on-demand] summarize model', sessionId, e?.message ?? e);
      summaryText = transcript.slice(0, 2800);
    }
    if (!summaryText) return { invoked: true, ok: false, error: 'empty_summary' };

    const { createMemoryServiceFromEnv } = await import('../../../services/memory/index.js');
    const memory = await createMemoryServiceFromEnv(env, { userId });
    const saved = await memory.remember({
      workspaceId,
      tenantId,
      subjectId: userId,
      content: summaryText,
      memoryType: 'decision',
      sourceType: 'conversation_summary',
      sourceId: sessionId,
      importance: 0.7,
      metadata: {
        memory_key: `conversation_summary:${sessionId}`,
        message_count: messages.length,
      },
    });
    return {
      invoked: true,
      ok: true,
      result: {
        ok: true,
        memory_id: saved?.id ?? null,
        memory_key: `conversation_summary:${sessionId}`,
        message_count: messages.length,
        summary_chars: summaryText.length,
      },
    };
  } catch (e) {
    console.warn('[thread-on-demand] on_demand', sessionId, e?.message ?? e);
    return { invoked: false, reason: 'error', error: String(e?.message || e) };
  }
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   action: 'compact'|'summarize',
 *   userId: string,
 *   workspaceId: string,
 *   tenantId?: string|null,
 *   conversationId: string,
 *   agentRunId?: string|null,
 *   messages?: unknown[],
 *   systemPromptCacheHash?: string|null,
 * }} opts
 */
export async function runThreadActionOnDemand(env, ctx, opts) {
  const action = opts.action === 'summarize' ? 'summarize' : 'compact';
  const userId = String(opts.userId || '').trim();
  const workspaceId = String(opts.workspaceId || '').trim();
  const conversationId = String(opts.conversationId || '').trim();

  if (!userId || !workspaceId || !conversationId) {
    return {
      ok: false,
      action,
      error: 'missing_identity_or_conversation',
      user_message: 'Could not run thread action: workspace or conversation context is missing.',
    };
  }

  const messages = await loadConversationMessages(env, conversationId, opts.messages);
  if (!messages.length) {
    return {
      ok: false,
      action,
      error: 'no_messages',
      user_message:
        'No messages found for this thread. Send at least one message in chat, then try again.',
    };
  }

  if (action === 'compact') {
    try {
      const { forceCompactConversationMessages } = await import('./compaction/compact.js');
      const out = await forceCompactConversationMessages(env, ctx, {
        messages,
        userId,
        workspaceId,
        tenantId: opts.tenantId ?? null,
        conversationId,
        modelKey: opts.modelKey ?? null,
        contextWindowTokens: opts.contextWindowTokens ?? opts.contextWindow ?? null,
        agentRunId: opts.agentRunId ?? null,
        systemPromptCacheHash: opts.systemPromptCacheHash ?? null,
        activeTools: [],
      });

      if (!out.compacted) {
        const reason =
          messages.length < 2
            ? 'Need at least 2 messages to compact.'
            : 'Compaction produced no summary (try again after more conversation).';
        return {
          ok: false,
          action,
          error: 'compaction_skipped',
          reason: out.reason,
          user_message: reason,
          message_count: messages.length,
          estimated_tokens: out.estimated,
        };
      }

      const preview = out.summaryPreview || '';
      return {
        ok: true,
        action,
        compacted: true,
        r2_key: out.r2Key ?? null,
        tokens_before: out.estimated,
        tokens_after: out.tokensAfter,
        message_count: messages.length,
        user_message: `Thread compacted. ~${out.estimated ?? 0} → ~${out.tokensAfter ?? 0} tokens. Last ${out.retained ?? 6} turns kept.${preview ? `\n\n${preview}` : ''}`,
        messages: out.messages,
      };
    } catch (e) {
      console.warn('[thread-on-demand] compact', e?.message ?? e);
      return {
        ok: false,
        action,
        error: String(e?.message || e),
        user_message: `Compaction failed: ${String(e?.message || e).slice(0, 200)}`,
      };
    }
  }

  try {
    const sum = await summarizeThreadOnDemand(env, {
      sessionId: conversationId,
      tenantId: opts.tenantId ?? null,
      workspaceId,
      userId,
      messages,
    });

    if (!sum.invoked) {
      return {
        ok: false,
        action,
        error: sum.reason || 'summarize_skipped',
        user_message:
          sum.reason === 'missing_workspace_id'
            ? 'Thread summarize needs workspace context. Compaction (/compact) still works on-platform.'
            : `Summarize skipped: ${sum.reason || 'unknown'}.`,
      };
    }

    return {
      ok: sum.ok !== false,
      action,
      invoked: true,
      summarize: sum,
      message_count: messages.length,
      user_message: sum.ok
        ? `Thread summary saved (${messages.length} messages) to managed memory + memory lane.`
        : `Summarize request failed: ${String(sum.result?.error || sum.error || 'summarize_error').slice(0, 200)}`,
    };
  } catch (e) {
    console.warn('[thread-on-demand] summarize', e?.message ?? e);
    return {
      ok: false,
      action,
      error: String(e?.message || e),
      user_message: `Summarize failed: ${String(e?.message || e).slice(0, 200)}`,
    };
  }
}

/**
 * in_app command dispatch entry (agentsam_commands.tool_key).
 * @param {any} env
 * @param {any} ctx
 * @param {string} toolKey
 * @param {Record<string, unknown>} args
 * @param {Record<string, unknown>} runContext
 */
export async function dispatchInAppThreadCommand(env, ctx, toolKey, args, runContext) {
  const key = String(toolKey || '').trim().toLowerCase();
  const action = key === 'thread.summarize' || key.endsWith('.summarize') ? 'summarize' : 'compact';
  return runThreadActionOnDemand(env, ctx, {
    action,
    userId: String(runContext?.userId ?? runContext?.user_id ?? '').trim(),
    workspaceId: String(runContext?.workspaceId ?? runContext?.workspace_id ?? '').trim(),
    tenantId: runContext?.tenantId ?? runContext?.tenant_id ?? null,
    conversationId: String(
      runContext?.conversationId ??
        runContext?.sessionId ??
        runContext?.session_id ??
        args?.conversation_id ??
        args?.session_id ??
        '',
    ).trim(),
    agentRunId: runContext?.agentRunId ?? runContext?.agent_run_id ?? args?.agent_run_id ?? null,
    messages: Array.isArray(args?.messages) ? args.messages : undefined,
    systemPromptCacheHash: args?.system_prompt_cache_hash ?? null,
  });
}
