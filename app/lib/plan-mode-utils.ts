import type { AgentMode } from '../components/ChatAssistant/types';
import { AGENT_MODES } from '../components/ChatAssistant/types';

const PLAN_PREFIX_RE = /^\/plan\b\s*/i;

export function suggestPlanMode(text: string): boolean {
  const m = String(text || '').trim();
  if (!m || m.length < 40) return false;
  if (PLAN_PREFIX_RE.test(m)) return false;
  // Casual chat / capability questions are not plan prompts.
  if (/^(hey|hi|hello|yo|sup)\b/i.test(m) && m.length < 80) return false;
  if (/\b(help me|how can you|what can you|best way you can)\b/i.test(m) && m.length < 100) {
    return false;
  }
  const words = m.split(/\s+/).filter(Boolean);
  if (/\b(refactor|architect|migration|multi-?file|across|sprint|roadmap|strategy|redesign)\b/i.test(m)) {
    return true;
  }
  if (/\b(api|dashboard|worker|supabase|d1|schema|workflow)\b.*\b(and|plus|with)\b/i.test(m)) {
    return true;
  }
  // Long, concrete work briefs only — never short greetings.
  if (words.length >= 18) return true;
  return false;
}

export function nextAgentMode(current: AgentMode): AgentMode {
  const ids = AGENT_MODES.map((m) => m.id);
  const idx = ids.indexOf(current);
  const next = idx < 0 ? 0 : (idx + 1) % ids.length;
  return ids[next] || 'agent';
}

export function isPlanSlashMessage(text: string): boolean {
  return PLAN_PREFIX_RE.test(String(text || '').trim());
}
