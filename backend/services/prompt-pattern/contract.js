/**
 * Prompt pattern economics — contract constants and volatile/stable boundary law.
 */

export const PROMPT_PATTERN_CONTRACT_VERSION = 1;

/** Never included in pattern_hash — dynamic context after the cacheable prefix. */
export const VOLATILE_PROMPT_LAYER_KEYS = new Set([
  'recent_memory',
  'rag',
  'rag_context',
  'workspace_ctx',
  'workspace_context',
  'active_plan',
  'knowledge',
  'knowledge_bootstrap',
  'user_message',
  'triggered_rules',
  'cms_context',
  'skill_command',
  'terminal_dock',
  'lane_context',
  'project_context',
  'session_identity',
]);
