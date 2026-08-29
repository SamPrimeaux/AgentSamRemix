/**
 * DO/R2 history hydrate for agent chat — normalized user-turn dedup.
 */

/**
 * @param {unknown} content
 * @returns {string}
 */
export function normalizeUserTurnContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string') {
          return p.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function isHydrateStubMessage(message) {
  if (Array.isArray(message?.content) && message.content.some((p) => p && p.type === 'tool_result')) {
    return false;
  }
  const role = String(message?.role || '').trim();
  const status = String(message?.status || '').trim().toLowerCase();
  const content = normalizeUserTurnContent(message?.content);
  if (!content || content === '(empty)' || content === 'Loading conversation…') return true;
  if (role === 'assistant' && status === 'pending') return true;
  if (
    role === 'assistant' &&
    /^Hi!\s*I'm Agent Sam\./i.test(content) &&
    content.length < 280
  ) {
    return true;
  }
  return false;
}

/**
 * Drop pending/empty assistant rows and greeting stubs before model hydrate.
 * beginChatTurn writes the current user + an empty pending assistant; those
 * must not be replayed as extra turns.
 * @param {unknown[]} messages
 * @returns {any[]}
 */
export function stripHydrateStubMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.filter((m) => m && typeof m === 'object' && !isHydrateStubMessage(m));
}

/**
 * @param {any[]} prior
 * @param {string} message
 * @param {string|null|undefined} turnNonce — optional client idempotency key
 * @returns {{ chatMessages: any[], priorCount: number, deduped: boolean, dedupReason: string|null }}
 */
export function mergeHydratedHistory(prior, message, turnNonce = null) {
  const list = stripHydrateStubMessages(prior);
  if (!list.length) {
    return {
      chatMessages: [{ role: 'user', content: message }],
      priorCount: 0,
      deduped: false,
      dedupReason: null,
    };
  }

  const nonce = turnNonce != null ? String(turnNonce).trim() : '';
  if (nonce) {
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m?.role !== 'user') continue;
      const meta = m.metadata && typeof m.metadata === 'object' ? m.metadata : null;
      const id =
        (meta && (meta.turn_nonce || meta.turnNonce || meta.client_turn_id)) ||
        m.turn_nonce ||
        m.client_turn_id ||
        null;
      if (id != null && String(id).trim() === nonce) {
        return {
          chatMessages: [...list],
          priorCount: list.length,
          deduped: true,
          dedupReason: 'turn_nonce',
        };
      }
    }
  }

  const msgNorm = normalizeUserTurnContent(message);
  // Tip-only: client may have already persisted this user turn before hydrate.
  // Do not scan earlier turns — re-asking the same text is a valid new message.
  const tip = list[list.length - 1];
  if (tip?.role === 'user') {
    const priorNorm = normalizeUserTurnContent(tip.content);
    if (priorNorm && msgNorm && priorNorm === msgNorm) {
      return {
        chatMessages: [...list],
        priorCount: list.length,
        deduped: true,
        dedupReason: 'content_match',
      };
    }
  }

  return {
    chatMessages: [...list, { role: 'user', content: message }],
    priorCount: list.length,
    deduped: false,
    dedupReason: null,
  };
}

/**
 * @param {any} env
 * @param {string} sessionId
 * @param {unknown[]} messages
 * @param {string|null|undefined} digestText
 */
async function prepareWorkingHistory(messages, digestText) {
  const { windowChatMessagesForHydrate, prependChatDigest } = await import(
    '../../sessions/window/hydrate.js'
  );
  const { cloneMessagesForWorkingContext } = await import('../../sessions/window/assemble.js');
  // Stub-strip only. Tool trim / pressure reduction run pre-inference on a
  // working copy — never patch DO message rows from hydrate.
  const windowed = windowChatMessagesForHydrate(stripHydrateStubMessages(messages));
  const working = cloneMessagesForWorkingContext(windowed.messages);
  return {
    messages: prependChatDigest(working, digestText || null),
    priorCount: Array.isArray(messages) ? messages.length : 0,
    dropped: windowed.dropped,
  };
}

/**
 * @param {any} env
 * @param {string} sessionId
 * @param {unknown[]} messages
 * @param {string|null|undefined} digestText
 */
async function boundAndCompactHistory(_env, _sessionId, messages, digestText) {
  return prepareWorkingHistory(messages, digestText);
}

/**
 * @param {any} env
 * @param {{
 *   sessionId: string|null|undefined,
 *   message: string,
 *   bodyMessages: unknown,
 *   turnNonce?: string|null,
 * }} opts
 * @returns {Promise<{ chatMessages: any[], hydrated: boolean, priorCount: number, deduped: boolean }>}
 */
export async function hydrateAgentChatHistory(env, opts) {
  const message = String(opts.message || '').trim();
  const bodyMessages = opts.bodyMessages;
  const hasBody = Array.isArray(bodyMessages) && bodyMessages.length;
  const sessionId = opts.sessionId != null ? String(opts.sessionId).trim() : '';

  if (hasBody) {
    const bounded = await boundAndCompactHistory(env, sessionId, bodyMessages, opts.digestText);
    console.info('[agent-controller] history_hydrate', {
      conversation_id: sessionId || null,
      prior_count: bounded.priorCount,
      outgoing_count: bounded.messages.length,
      dropped: bounded.dropped,
      source: 'body_messages',
      deduped: false,
    });
    return {
      chatMessages: bounded.messages,
      hydrated: true,
      priorCount: bounded.priorCount,
      deduped: false,
    };
  }

  let chatMessages = [{ role: 'user', content: message }];
  if (!sessionId) {
    return { chatMessages, hydrated: false, priorCount: 0, deduped: false };
  }

  let prior = Array.isArray(opts.preloadedMessages) ? opts.preloadedMessages : null;
  if (!prior) {
    const { getChatMessages } = await import('../../sessions/chat-do-client.js');
    prior = await getChatMessages(env, sessionId, { hydrate: true });
  } else if (opts.hydratePreloaded !== false) {
    const bounded = await boundAndCompactHistory(env, sessionId, prior, opts.digestText);
    prior = bounded.messages;
  }
  if (!Array.isArray(prior) || !prior.length) {
    return { chatMessages, hydrated: false, priorCount: 0, deduped: false };
  }

  const merged = mergeHydratedHistory(prior, message, opts.turnNonce);
  console.info('[agent-controller] history_hydrate', {
    conversation_id: sessionId,
    prior_count: merged.priorCount,
    outgoing_count: merged.chatMessages.length,
    deduped: merged.deduped,
    dedup_reason: merged.dedupReason,
  });
  return {
    chatMessages: merged.chatMessages,
    hydrated: true,
    priorCount: merged.priorCount,
    deduped: merged.deduped,
  };
}
