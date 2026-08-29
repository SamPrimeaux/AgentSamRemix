/**
 * Chat hydrate helpers — stub strip + optional recent-verbatim preference.
 *
 * Law: DO holds full canonical history. These helpers operate on working
 * copies for inference assembly. They are NOT universal ceilings on how much
 * conversation a model may receive.
 *
 * Prefer `assembleWorkingContextForInference` for pressure-aware reduction.
 * `windowChatMessagesForHydrate` is a post-pressure preference: keep the
 * latest 8–12 user turns verbatim after older context is summarized/dropped.
 */

/** Preferred recent user turns to keep verbatim after older context is reduced. */
export const RECENT_VERBATIM_USER_TURNS = 12;
export const RECENT_VERBATIM_USER_TURN_MIN = 8;

/** @deprecated use RECENT_VERBATIM_USER_TURNS — not a universal hydrate max */
export const CHAT_HYDRATE_USER_TURN_WINDOW = RECENT_VERBATIM_USER_TURNS;
/** @deprecated use RECENT_VERBATIM_USER_TURN_MIN */
export const CHAT_HYDRATE_USER_TURN_MIN = RECENT_VERBATIM_USER_TURN_MIN;
/**
 * @deprecated Not a universal ceiling. Assembler passes an explicit messageCap
 * only when reducing under pressure.
 */
export const CHAT_HYDRATE_MESSAGE_CAP = 500;
/**
 * @deprecated Not a universal ceiling. Assembler derives char budget from
 * model usable context.
 */
export const CHAT_HYDRATE_CHAR_BUDGET = 2_000_000;

function isHumanUserTurn(message) {
  if (String(message?.role || '').trim() !== 'user') return false;
  if (Array.isArray(message.content) && message.content.some((b) => b && b.type === 'tool_result')) {
    return false;
  }
  return typeof message.content === 'string' || Array.isArray(message.content);
}

function contentChars(content) {
  if (typeof content === 'string') return content.length;
  if (content == null) return 0;
  try {
    return JSON.stringify(content).length;
  } catch {
    return String(content).length;
  }
}

/** Approximate on-wire size of a conversation for budget cuts (not tokenizer-accurate). */
export function conversationMessageChars(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let n = 0;
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    n += contentChars(m.content);
    if (Array.isArray(m.gemini_model_parts)) n += contentChars(m.gemini_model_parts);
    if (typeof m.reasoning_content === 'string') n += m.reasoning_content.length;
  }
  return n;
}

function dropOldestHumanTurn(sliced) {
  let nextUser = -1;
  for (let i = 1; i < sliced.length; i++) {
    if (isHumanUserTurn(sliced[i])) {
      nextUser = i;
      break;
    }
  }
  if (nextUser > 0) return sliced.slice(nextUser);
  if (sliced.length <= 2) return sliced;
  const pinnedUser = [...sliced].reverse().find((m) => isHumanUserTurn(m));
  const rest = sliced.slice(1);
  if (pinnedUser && !rest.includes(pinnedUser)) {
    return [pinnedUser, ...rest];
  }
  return rest;
}

/**
 * Keep the last `userTurns` human user turns and everything after the oldest
 * kept turn (assistant/tool rows in that window stay). Tool-result user
 * messages do not count as turns — they are payload inside a turn.
 *
 * Default (no opts): stub-filter only — do not truncate history. Callers that
 * need a recent-verbatim preference after pressure must pass `userTurns` /
 * `messageCap` / `charBudget` explicitly.
 *
 * @param {unknown[]} messages
 * @param {{ userTurns?: number, messageCap?: number, charBudget?: number, applyRecentWindow?: boolean }} [opts]
 * @returns {{ messages: any[], dropped: number, userTurnsKept: number }}
 */
export function windowChatMessagesForHydrate(messages, opts = {}) {
  const list = (Array.isArray(messages) ? messages : []).filter((m) => {
    if (!m || typeof m !== 'object') return false;
    if (Array.isArray(m.content) && m.content.some((p) => p && p.type === 'tool_result')) {
      return true;
    }
    const role = String(m.role || '').trim();
    const status = String(m.status || '').trim().toLowerCase();
    const content =
      typeof m.content === 'string'
        ? m.content.trim()
        : Array.isArray(m.content)
          ? m.content
              .map((p) => (typeof p === 'string' ? p : p?.type === 'text' ? p.text : ''))
              .join('\n')
              .trim()
          : '';
    if (!content || content === '(empty)' || content === 'Loading conversation…') return false;
    if (role === 'assistant' && status === 'pending') return false;
    if (role === 'assistant' && /^Hi!\s*I'm Agent Sam\./i.test(content) && content.length < 280) {
      return false;
    }
    return true;
  });

  const applyWindow =
    opts.applyRecentWindow === true ||
    opts.userTurns != null ||
    opts.messageCap != null ||
    opts.charBudget != null;

  if (!list.length) {
    return { messages: [], dropped: 0, userTurnsKept: 0 };
  }

  if (!applyWindow) {
    let userTurnsKept = 0;
    for (const m of list) {
      if (isHumanUserTurn(m)) userTurnsKept += 1;
    }
    return { messages: list, dropped: 0, userTurnsKept };
  }

  const windowTurns = Math.max(
    RECENT_VERBATIM_USER_TURN_MIN,
    Math.min(
      RECENT_VERBATIM_USER_TURNS,
      Math.floor(Number(opts.userTurns) || RECENT_VERBATIM_USER_TURNS),
    ),
  );

  let userCount = 0;
  let cut = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (isHumanUserTurn(list[i])) {
      userCount += 1;
      if (userCount >= windowTurns) {
        cut = i;
        break;
      }
    }
  }
  let sliced = list.slice(cut);
  let dropped = list.length - sliced.length;
  const messageCap = Math.max(
    8,
    Math.min(2000, Math.floor(Number(opts.messageCap) || 500)),
  );

  while (sliced.length > messageCap) {
    let nextUser = -1;
    for (let i = 1; i < sliced.length; i++) {
      if (isHumanUserTurn(sliced[i])) {
        nextUser = i;
        break;
      }
    }
    if (nextUser > 0) {
      dropped += nextUser;
      sliced = sliced.slice(nextUser);
      continue;
    }

    const tail = sliced.slice(-messageCap);
    dropped += sliced.length - tail.length;
    const pinnedUser = [...sliced].reverse().find((m) => isHumanUserTurn(m));
    sliced =
      pinnedUser && !tail.includes(pinnedUser)
        ? [pinnedUser, ...tail.slice(-(messageCap - 1))]
        : tail;
    break;
  }

  const charBudget = Math.max(
    8_000,
    Math.min(
      8_000_000,
      Math.floor(Number(opts.charBudget) || CHAT_HYDRATE_CHAR_BUDGET),
    ),
  );
  while (sliced.length > 2 && conversationMessageChars(sliced) > charBudget) {
    const before = sliced.length;
    sliced = dropOldestHumanTurn(sliced);
    if (sliced.length >= before) break;
    dropped += before - sliced.length;
  }

  return {
    messages: sliced,
    dropped,
    userTurnsKept: userCount,
  };
}

/**
 * Prepend digest as a single user note so the model sees prior context without
 * replaying dropped turns. Does not invent a system role (Gemini/OpenAI hydrate
 * path treats these as conversation messages).
 *
 * @param {any[]} windowed
 * @param {string|null|undefined} digestText
 * @returns {any[]}
 */
export function prependChatDigest(windowed, digestText) {
  const digest = typeof digestText === 'string' ? digestText.trim() : '';
  const list = Array.isArray(windowed) ? windowed : [];
  if (!digest) return list;
  return [
    {
      role: 'user',
      content: `## Earlier conversation digest\n${digest.slice(0, 12_000)}`,
    },
    ...list,
  ];
}
