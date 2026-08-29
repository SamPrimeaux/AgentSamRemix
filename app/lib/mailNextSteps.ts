/** Parse phone-loop next-step chips embedded in outbound Agent Sam emails. */

export type MailNextStep = {
  action: string;
  label: string;
  instruction: string;
};

const NEXT_STEPS_HTML_RE = /<!--\s*agentsam:next_steps:([\s\S]*?)\s*-->/i;
const NEXT_STEPS_TEXT_RE = /\[agentsam:next_steps\]([\s\S]*?)\[\/agentsam:next_steps\]/i;
const REF_RE = /\[ref:as_([a-zA-Z0-9_-]+)\]/i;

export function parseMailNextSteps(body: string | null | undefined): {
  conversationId: string | null;
  steps: MailNextStep[];
} {
  const raw = String(body || '');
  const hit = raw.match(NEXT_STEPS_HTML_RE) || raw.match(NEXT_STEPS_TEXT_RE);
  if (!hit?.[1]) {
    const ref = raw.match(REF_RE);
    let conversationId = ref?.[1] ? String(ref[1]).trim() : null;
    if (conversationId?.startsWith('as_')) conversationId = conversationId.slice(3);
    return { conversationId, steps: [] };
  }
  try {
    const parsed = JSON.parse(hit[1].trim()) as {
      conversationId?: string;
      steps?: MailNextStep[];
    };
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

/** Hide machine payload from the human-readable body. */
export function stripMailNextStepsPayload(body: string | null | undefined): string {
  return String(body || '')
    .replace(NEXT_STEPS_HTML_RE, '')
    .replace(NEXT_STEPS_TEXT_RE, '')
    .trim();
}
