/**
 * Agent Sam composer mode contract — shared between dashboard types and Worker runtime.
 * Keep in sync with `app/components/ChatAssistant/types.ts` AgentMode / AGENT_MODES.
 *
 * Composer modes: ask | plan | agent | debug | multitask
 * NOT a mode: `auto` — that is Thompson model selection (`model=auto` / AUTO_MODEL_KEY).
 */

/** @typedef {'ask'|'plan'|'agent'|'debug'|'multitask'} AgentMode */

export const AGENT_MODES = Object.freeze([
  { id: 'agent', label: 'Agent', description: 'Execute and open surfaces' },
  { id: 'plan', label: 'Plan', description: 'Design technical plans' },
  { id: 'debug', label: 'Debug', description: 'Inspect, prove, and fix' },
  { id: 'multitask', label: 'Multitask', description: 'Coordinate workflows' },
  { id: 'ask', label: 'Ask', description: 'Talk and answer questions' },
]);

/** Composer mode contract — color, tool profile, role (Cursor-inspired). */
export const AGENT_MODE_CONTRACT = Object.freeze({
  ask: {
    color: 'green',
    tool_profile: 'readonly_context',
    role: 'answer / understand / explore',
  },
  plan: {
    color: 'blue',
    tool_profile: 'plan_artifact',
    role: 'design / decompose',
  },
  agent: {
    color: 'purple',
    tool_profile: 'execution',
    role: 'execute / build',
  },
  debug: {
    color: 'orange',
    tool_profile: 'execution',
    role: 'inspect / prove / fix',
  },
  multitask: {
    color: 'cyan',
    // D1: agentsam_tool_profile_bindings.task_type=multitask → composer_multitask
    // Cursor-aligned: the orchestrator composes child lanes from caller input.
    tool_profile: 'composer_multitask',
    role: 'coordinate / fan-out',
  },
});

const RUNTIME_MODE_SET = new Set(['agent', 'plan', 'debug', 'multitask', 'ask']);

/**
 * Soft normalize for non-chat callers. Unknown/empty → `agent`.
 * Rejects the string `auto` (that is a model key, not a composer mode) → `agent`.
 * Chat SSE must use {@link parseRequiredAgentRuntimeMode} — fail loud, no silent default.
 * @param {unknown} raw
 * @returns {AgentMode}
 */
export function normalizeAgentRuntimeMode(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (RUNTIME_MODE_SET.has(v)) return /** @type {AgentMode} */ (v);
  return 'agent';
}

/**
 * Strict parse for Agent Sam chat — missing/unknown/auto must fail loud.
 * No agent_mode / runtime_intent_mode / execution_mode aliases.
 * @param {unknown} raw
 * @returns {{ ok: true, mode: AgentMode } | { ok: false, error: 'mode_required' | 'mode_invalid', got: string }}
 */
export function parseRequiredAgentRuntimeMode(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { ok: false, error: 'mode_required', got: '' };
  }
  const v = String(raw).trim().toLowerCase();
  if (v === 'auto') {
    return { ok: false, error: 'mode_invalid', got: 'auto' };
  }
  if (!RUNTIME_MODE_SET.has(v)) {
    return { ok: false, error: 'mode_invalid', got: v };
  }
  return { ok: true, mode: /** @type {AgentMode} */ (v) };
}

/**
 * @param {unknown} raw
 * @returns {raw is AgentMode}
 */
export function isComposerAgentMode(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return RUNTIME_MODE_SET.has(v);
}

/**
 * API shape for GET /api/agent/modes — keep dashboard-free; Worker is SSOT for mode list.
 * Does not list `auto` — that is Thompson model selection, not a composer mode.
 */
export function listAgentModesForApi() {
  return AGENT_MODES.map((m) => ({
    slug: m.id,
    label: m.label,
    description: m.description,
    color: AGENT_MODE_CONTRACT[m.id]?.color ?? null,
    icon: null,
    // Ceilings live on agentsam_tool_profiles.runtime_policy_json — not invented here.
    temperature: null,
    auto_run: 0,
    max_tool_calls: null,
  }));
}
