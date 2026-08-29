/**
 * Task-type / routing-mode contracts for resolveModel.
 * Modes live in EXECUTION_MODES (route-keys.js); never promote task_type into a mode.
 */

import { EXECUTION_MODES } from './route-keys.js';
import { ResolutionError } from '../../catalog/resolve-model-error.js';

/**
 * Invalid as control-plane task_type / intent labels.
 * Modes live in EXECUTION_MODES (route-keys.js); chat/auto are legacy non-categories.
 */
export const INVALID_TASK_TYPES = new Set([
  'ask',
  'chat',
  'auto',
  'agent',
  'plan',
  'debug',
  'multitask',
]);

/**
 * Intent labels allowed through normalizeCanonicalTaskType (tools, telemetry, workflows).
 * Fine strings stay for tool_profile_bindings.
 */
const PRESERVED_TASK_TYPES = [
  'code',
  'quick',
  'search_code',
  'refactor',
  'review',
  'github',
  'code_gen',
  'deploy',
  'browser',
  'r2_ops',
  'cf_ops',
  'd1_query',
  'd1_write',
  'sql_d1_generation',
  'workflow_orchestration',
  'terminal_execution',
  'vectorize',
  'web_search',
  'tool_use',
  'skill_use',
  'agent_spawn',
  'subagent_worker',
  'subagent_master',
  'project_question',
  'explain',
  'summary',
  'cheap_summary',
  'context_compaction',
  'greeting',
  'rag',
  'rag_query',
  'skill_invocation',
  'recall',
  'memory',
  'embeddings',
  'intent_classification',
  'image_generation',
  'image_generate',
  'video_generation',
  'plan',
  'vision',
];

/** Rename-only aliases (identity-preserving). Never map into execution modes. */
const TASK_TYPE_ALIASES = Object.freeze({
  question: 'project_question',
  rag_query: 'rag',
  embedding: 'embeddings',
  research: 'web_search',
  subagent_dispatch: 'workflow_orchestration',
  debug_live_page: 'browser',
  browser_ui_repair: 'browser',
  image_generate: 'image_generation',
});

/**
 * Arm-seed mode for system lanes that do not use composer mode as their D1 `mode` value.
 */
export const TASK_TYPE_ARM_MODE = Object.freeze({
  intent_classification: 'auto',
  rag: 'default',
  embeddings: 'embed',
});

const COMPOSER_MODES = new Set(EXECUTION_MODES);

/** @param {string} value */
export function isExecutionMode(value) {
  return EXECUTION_MODES.includes(String(value || '').trim().toLowerCase());
}

/**
 * Resolve the single D1 `mode` for arm lookup.
 * Explicit execution mode wins unless the task_type has a dedicated arm-seed mode.
 * Never promote a task_type string into a mode — modes come from the caller.
 * @param {string} task_type
 * @param {string} [mode] execution mode from the caller
 */
export function resolveRoutingMode(task_type, mode = 'agent') {
  const tt = String(task_type || '').trim().toLowerCase();
  const m = String(mode || '').trim().toLowerCase();
  if (TASK_TYPE_ARM_MODE[tt]) return TASK_TYPE_ARM_MODE[tt];
  if (COMPOSER_MODES.has(m)) return m;
  return 'agent';
}

/**
 * Single Thompson arm key — tool-shape only (via resolveThompsonArmTaskType).
 * @param {string} task_type
 * @param {string} [_mode] unused; kept for call-site compatibility
 * @returns {string[]} length-1 list of the resolved tool-shape arm key
 */
export function routingTaskTypeCandidates(task_type, _mode = '') {
  return [resolveThompsonArmTaskType(task_type)];
}

/**
 * Intent / telemetry / tool-profile task_type contract.
 * Execution modes (ask/agent/plan/debug/multitask) and chat/auto are INVALID_TASK_TYPES.
 * Does NOT choose the Thompson arm pool — see resolveThompsonArmTaskType.
 */
export function normalizeCanonicalTaskType(task_type) {
  const raw = String(task_type ?? '').trim().toLowerCase();
  if (!raw) {
    throw new ResolutionError(
      'TASK_TYPE_REQUIRED',
      'task_type is required (execution modes ask/agent/plan/debug/multitask are not task types)',
    );
  }
  if (INVALID_TASK_TYPES.has(raw)) {
    throw new ResolutionError(
      'TASK_TYPE_REJECTED',
      `task_type "${raw}" is an execution mode or legacy non-category — pass mode separately; use a real work intent`,
      { task_type: raw },
    );
  }
  const aliased = TASK_TYPE_ALIASES[raw] || raw;
  if (INVALID_TASK_TYPES.has(aliased)) {
    throw new ResolutionError(
      'TASK_TYPE_REJECTED',
      `task_type "${raw}" aliases to invalid "${aliased}" (modes are not task types)`,
      { task_type: raw, aliased },
    );
  }
  if (PRESERVED_TASK_TYPES.includes(aliased)) return aliased;
  if (aliased === 'designstudio_cad_script' || aliased === 'cad_generation') return aliased;
  // Unknown work labels stay as themselves for tools/telemetry; Thompson uses tool-shape map.
  return aliased;
}

/**
 * Tool-shape Thompson arm key for model pick only.
 * Fine intents stay intact for tool_profile_bindings.
 *
 * @param {string} task_type
 * @returns {string}
 */
export function resolveThompsonArmTaskType(task_type) {
  const raw = String(task_type ?? '').trim().toLowerCase();
  // Mode namespaces only — classifier/tool_shape map retired.
  if (raw === 'ask' || raw === 'plan' || raw === 'agent' || raw === 'debug' || raw === 'multitask') {
    return raw;
  }
  if (!raw || INVALID_TASK_TYPES.has(raw)) return 'agent';
  return 'agent';
}
