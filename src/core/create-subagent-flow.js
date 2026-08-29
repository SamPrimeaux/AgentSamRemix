/**
 * Two-turn /create-subagent flow (Cursor-like intake, D1 write via agentsam_create_subagent).
 */

export const CREATE_SUBAGENT_TOOL_NAME = 'agentsam_create_subagent';

export const CREATE_SUBAGENT_KICKOFF_QUESTION = 'What do you want this subagent to do?';

/**
 * @param {any[]} tools
 * @returns {any[]}
 */
export function pickCreateSubagentTools(tools) {
  const fromManifest = (Array.isArray(tools) ? tools : []).filter(
    (t) => String(t?.name || '') === CREATE_SUBAGENT_TOOL_NAME,
  );
  return fromManifest.length ? fromManifest : [{ name: CREATE_SUBAGENT_TOOL_NAME }];
}

const CREATE_SUBAGENT_SLASH_RE = /\/create-subagent\b/i;

/**
 * @param {unknown} messages
 * @returns {{ role: string, content: string }[]}
 */
export function normalizeCreateSubagentMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((m) => {
      if (!m || typeof m !== 'object') return null;
      const role = String(m.role || '').toLowerCase();
      if (role !== 'user' && role !== 'assistant') return null;
      const content =
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .map((p) => (p && typeof p === 'object' && p.text != null ? String(p.text) : ''))
                .join('')
            : m.content != null
              ? String(m.content)
              : '';
      return { role, content };
    })
    .filter(Boolean);
}

/**
 * @param {unknown} messages
 * @returns {boolean}
 */
export function messageStartsCreateSubagentFlow(message) {
  return CREATE_SUBAGENT_SLASH_RE.test(String(message || ''));
}

/**
 * @param {unknown} messages
 * @returns {{ active: boolean, phase: 'kickoff' | 'execute' | null }}
 */
export function resolveCreateSubagentFlow(messages) {
  const msgs = normalizeCreateSubagentMessages(messages);
  if (!msgs.length) return { active: false, phase: null };

  let kickoffIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i].role === 'user' && CREATE_SUBAGENT_SLASH_RE.test(msgs[i].content)) {
      kickoffIdx = i;
      break;
    }
  }
  if (kickoffIdx < 0) return { active: false, phase: null };

  const afterKickoff = msgs.slice(kickoffIdx + 1);
  const questionIdx = afterKickoff.findIndex((m) => m.role === 'assistant');
  const last = msgs[msgs.length - 1];

  if (last.role === 'user' && CREATE_SUBAGENT_SLASH_RE.test(last.content) && questionIdx < 0) {
    return { active: true, phase: 'kickoff' };
  }

  if (questionIdx >= 0 && last.role === 'user' && !CREATE_SUBAGENT_SLASH_RE.test(last.content)) {
    const afterQuestion = afterKickoff.slice(questionIdx + 1);
    const intentReplies = afterQuestion.filter((m) => m.role === 'user');
    if (intentReplies.length === 1 && intentReplies[0] === last) {
      return { active: true, phase: 'execute' };
    }
  }

  return { active: false, phase: null };
}

/**
 * @param {'kickoff' | 'execute'} phase
 */
export function buildCreateSubagentFlowSystemPromptLine(phase) {
  if (phase === 'kickoff') {
    return (
      'Create subagent (step 1 of 2): The user typed /create-subagent. ' +
      `Reply with exactly one clarifying question — "${CREATE_SUBAGENT_KICKOFF_QUESTION}" — and stop. ` +
      'Do NOT call tools on this turn. Do NOT list existing subagents, probe GitHub/repos, or run d1_query.'
    );
  }
  return (
    'Create subagent (step 2 of 2): The user answered your clarifying question. ' +
    `Call \`${CREATE_SUBAGENT_TOOL_NAME}\` once with display_name, slug, description, and instructions_markdown from their answer. ` +
    'Do NOT list or get existing subagents first. If the tool returns slug_already_exists, retry once with a different slug. ' +
    'Do NOT use github_*, terminal, d1_query, or any tool other than agentsam_create_subagent.'
  );
}
