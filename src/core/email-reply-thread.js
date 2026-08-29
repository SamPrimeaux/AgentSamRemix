/**
 * Parse inbound email replies for the phone-IDE loop.
 * Extracts [ref:as_<conversationId>] / <!-- agentsam:thread:… --> and strips quoted chains.
 */

const REF_RE = /\[ref:as_([a-zA-Z0-9_-]+)\]/i;
const HTML_THREAD_RE = /<!--\s*agentsam:thread:([a-zA-Z0-9_-]+)\s*-->/i;
const BARE_AS_RE = /\bas_([a-zA-Z0-9_-]{8,})\b/i;

/**
 * @param {string} raw
 * @returns {string}
 */
export function stripQuotedReply(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  if (!text.trim()) return '';

  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    const t = line.trimEnd();
    if (/^On .+wrote:\s*$/i.test(t)) break;
    if (/^-{2,}\s*$/.test(t) || /^_{2,}\s*$/.test(t)) break;
    if (/^From:\s+/i.test(t) && out.length > 0) break;
    if (/^>{1}/.test(t)) continue;
    if (/^│/.test(t)) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

/**
 * @param {{ text?: string|null, html?: string|null, subject?: string|null, inReplyTo?: string|null }} input
 * @returns {{ conversationId: string|null, instruction: string, inReplyTo: string|null }}
 */
export function parseEmailReplyThread(input = {}) {
  const text = String(input.text || '');
  const html = String(input.html || '');
  const subject = String(input.subject || '');
  const combined = `${subject}\n${text}\n${html}`;

  let conversationId = null;
  const refHit = combined.match(REF_RE);
  if (refHit?.[1]) conversationId = String(refHit[1]).trim();
  if (!conversationId) {
    const htmlHit = combined.match(HTML_THREAD_RE);
    if (htmlHit?.[1]) conversationId = String(htmlHit[1]).trim();
  }
  if (!conversationId) {
    const bare = combined.match(BARE_AS_RE);
    if (bare?.[1]) conversationId = String(bare[1]).trim();
  }
  if (conversationId?.startsWith('as_')) {
    conversationId = conversationId.slice(3);
  }

  const instruction = stripQuotedReply(text || html.replace(/<[^>]+>/g, ' ')).slice(0, 8000);
  const inReplyTo =
    input.inReplyTo != null && String(input.inReplyTo).trim()
      ? String(input.inReplyTo).trim()
      : null;

  return { conversationId, instruction, inReplyTo };
}

/**
 * Build email footer + HTML comment for outbound phone-loop messages.
 * @param {string} conversationId
 */
export function buildThreadEmbeds(conversationId) {
  const id = String(conversationId || '').trim();
  const token = id ? `[ref:as_${id}]` : '';
  const htmlComment = id ? `<!-- agentsam:thread:${id} -->` : '';
  return { token, htmlComment, footerText: token ? `\n\n---\nReply with your next instruction.\n${token}\n` : '' };
}

const NEXT_STEPS_HTML_RE = /<!--\s*agentsam:next_steps:([\s\S]*?)\s*-->/i;
const NEXT_STEPS_TEXT_RE = /\[agentsam:next_steps\]([\s\S]*?)\[\/agentsam:next_steps\]/i;

/**
 * @param {{ action: string, label: string, instruction: string }[]} steps
 * @param {string} conversationId
 */
export function buildNextStepsEmbeds(steps, conversationId) {
  const list = Array.isArray(steps)
    ? steps
        .filter((s) => s && s.action && s.label && s.instruction)
        .slice(0, 5)
        .map((s) => ({
          action: String(s.action).slice(0, 32),
          label: String(s.label).slice(0, 80),
          instruction: String(s.instruction).slice(0, 4000),
        }))
    : [];
  if (!list.length) {
    return { footerText: '', htmlComment: '', steps: [] };
  }
  const lines = list.map((s, i) => `${i + 1}. ${s.label}\n   → ${s.instruction.slice(0, 180)}`);
  const payload = {
    conversationId: String(conversationId || '').trim() || null,
    steps: list,
  };
  const json = JSON.stringify(payload);
  const footerText = `\n\n## Next steps (open in Mail to tap, or reply by email)\n${lines.join('\n')}\n\n[agentsam:next_steps]${json}[/agentsam:next_steps]\n`;
  const htmlComment = `<!-- agentsam:next_steps:${json} -->`;
  return { footerText, htmlComment, steps: list };
}

/**
 * Parse next-step chips from an email body (phone-loop outbound).
 * @param {string} body
 * @returns {{ conversationId: string|null, steps: { action: string, label: string, instruction: string }[] }}
 */
export function parseNextStepsFromBody(body) {
  const raw = String(body || '');
  const hit = raw.match(NEXT_STEPS_HTML_RE) || raw.match(NEXT_STEPS_TEXT_RE);
  if (!hit?.[1]) {
    const ref = raw.match(REF_RE);
    let conversationId = ref?.[1] ? String(ref[1]).trim() : null;
    if (conversationId?.startsWith('as_')) conversationId = conversationId.slice(3);
    return { conversationId, steps: [] };
  }
  try {
    const parsed = JSON.parse(hit[1].trim());
    const conversationId =
      parsed?.conversationId != null ? String(parsed.conversationId).trim() : null;
    const steps = Array.isArray(parsed?.steps)
      ? parsed.steps
          .filter((s) => s && s.action && s.label && s.instruction)
          .map((s) => ({
            action: String(s.action).slice(0, 32),
            label: String(s.label).slice(0, 80),
            instruction: String(s.instruction).slice(0, 4000),
          }))
      : [];
    return { conversationId, steps };
  } catch {
    return { conversationId: null, steps: [] };
  }
}
