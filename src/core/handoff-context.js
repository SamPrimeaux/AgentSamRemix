/**
 * Pure handoff digest builders (no D1 / provider imports).
 */

/**
 * @param {unknown} messages
 */
export function extractRemainingGoal(messages) {
  if (!Array.isArray(messages)) return '';
  for (const m of messages) {
    if (m && typeof m === 'object' && String(m.role || '').toLowerCase() === 'user') {
      const c = m.content;
      if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 4000);
      if (Array.isArray(c)) {
        const text = c
          .map((b) => (b && typeof b === 'object' && b.type === 'text' ? String(b.text || '') : ''))
          .join('')
          .trim();
        if (text) return text.slice(0, 4000);
      }
    }
  }
  return '';
}

/**
 * @param {{ goal?: string, messages?: unknown[], executedToolNames?: string[], summary?: string, triggeredBy?: string, parentModelKey?: string, childModelKey?: string, remainingGoal?: string }} p
 */
export function buildHandoffContextDigest(p = {}) {
  const goal = String(p.goal || p.remainingGoal || '').trim();
  const tools = Array.isArray(p.executedToolNames) ? p.executedToolNames.filter(Boolean) : [];
  const recent = [];
  for (const m of Array.isArray(p.messages) ? p.messages.slice(-8) : []) {
    if (!m || typeof m !== 'object') continue;
    const role = String(m.role || 'unknown');
    let text = '';
    if (typeof m.content === 'string') text = m.content;
    else if (Array.isArray(m.content)) {
      text = m.content
        .map((b) => {
          if (!b || typeof b !== 'object') return '';
          if (b.type === 'text') return String(b.text || '');
          if (b.type === 'tool_use') return `[tool:${b.name || 'tool'}]`;
          return '';
        })
        .filter(Boolean)
        .join(' ');
    }
    text = text.replace(/\s+/g, ' ').trim().slice(0, 420);
    if (text) recent.push(`- [${role}] ${text}`);
  }

  const lines = [
    '# Agent handoff digest',
    p.triggeredBy ? `trigger: ${p.triggeredBy}` : '',
    p.parentModelKey ? `from_model: ${p.parentModelKey}` : '',
    p.childModelKey ? `to_model: ${p.childModelKey}` : '',
    goal ? `remaining_goal: ${goal}` : '',
    p.summary ? `progress_summary: ${String(p.summary).slice(0, 1200)}` : '',
    tools.length ? `tools_used: ${tools.join(', ')}` : 'tools_used: (none yet)',
    'recent_turns:',
    recent.length ? recent.join('\n') : '(no transcript)',
  ].filter(Boolean);

  return lines.join('\n').slice(0, 12000);
}

/**
 * @param {{ contextDigest?: string, remainingGoal?: string } | null | undefined} handoff
 */
export function buildHandoffPrimingUserMessage(handoff) {
  if (!handoff) return '';
  const digest = String(handoff.contextDigest || '').trim();
  const goal = String(handoff.remainingGoal || '').trim();
  const parts = [
    'Continue the in-progress task from a compressed handoff digest. Do not restart from scratch.',
    goal ? `Original goal:\n${goal}` : '',
    digest ? `Handoff digest:\n${digest}` : '',
  ].filter(Boolean);
  return parts.join('\n\n').slice(0, 24000);
}
