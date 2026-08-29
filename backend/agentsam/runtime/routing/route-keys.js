/**
 * Mode-first routing contracts — execution mode owns toolbox + Thompson namespace.
 *
 * Law: User picks MODE (power + toolbox). Explicit UI route_key pin is optional
 * (CMS/dashboard surfaces only). Bandit picks MODEL on mode. Never message/classifier
 * taskType → tool_shape.
 */

export const EXECUTION_MODES = Object.freeze([
  'ask',
  'plan',
  'agent',
  'debug',
  'multitask',
]);

/** Statistical / prompt route lanes — surface pins only, not classifier output. */
export const ROUTE_KEYS = Object.freeze([
  'general',
  'quick',
  'code',
  'code_debug',
  'planning',
  'research',
  'summary',
  'vision',
  'image_generation',
  'tool_orchestration',
  'intent_classification',
  'rag',
  'embeddings',
]);

const EXECUTION_MODE_SET = new Set(EXECUTION_MODES);
const ROUTE_KEY_SET = new Set(ROUTE_KEYS);

/** Mode → default route_key when caller does not pin one. */
export const MODE_DEFAULT_ROUTE_KEY = Object.freeze({
  ask: 'general',
  plan: 'planning',
  agent: 'general',
  debug: 'code_debug',
  multitask: 'tool_orchestration',
});

/**
 * @deprecated Inert — classifier→tool_shape law reversed. Kept empty so accidental
 * imports fail closed to mode arms via {@link armTaskTypeForRouteKey}.
 */
export const ROUTE_KEY_TO_TOOL_SHAPE_ARM = Object.freeze({});

export class RouteKeyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RouteKeyError';
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {unknown} value
 * @returns {'ask'|'plan'|'agent'|'debug'|'multitask'}
 */
export function normalizeMode(value) {
  const mode = String(value || 'agent').trim().toLowerCase();
  if (mode === 'auto') return 'agent';
  if (!EXECUTION_MODE_SET.has(mode)) {
    throw new RouteKeyError('MODE_INVALID', `Unsupported execution mode "${mode}"`, { mode });
  }
  return mode;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeRouteKey(value) {
  const routeKey = String(value || '').trim().toLowerCase();
  if (!routeKey) return 'general';
  if (!ROUTE_KEY_SET.has(routeKey)) return 'general';
  return routeKey;
}

/**
 * @param {unknown} mode
 * @returns {string}
 */
export function modeToDefaultRouteKey(mode) {
  let m;
  try {
    m = normalizeMode(mode);
  } catch {
    m = 'agent';
  }
  return MODE_DEFAULT_ROUTE_KEY[m] || 'general';
}

/**
 * @deprecated Classifier task_type must not become a route_key. Always null.
 * @param {unknown} _taskType
 * @returns {null}
 */
export function taskTypeAsRouteKeyIfValid(_taskType) {
  return null;
}

/**
 * Resolve route_key: explicit UI pin → else mode default.
 * Ignores body task_type / classifier labels.
 * @param {{ route_key?: unknown, routeKey?: unknown, task_type?: unknown, taskType?: unknown, mode?: unknown }} opts
 */
export function resolveRouteKeyFromOpts(opts = {}) {
  const explicit =
    opts.route_key != null && String(opts.route_key).trim() !== ''
      ? opts.route_key
      : opts.routeKey != null && String(opts.routeKey).trim() !== ''
        ? opts.routeKey
        : null;
  if (explicit != null) return normalizeRouteKey(explicit);
  return modeToDefaultRouteKey(opts.mode);
}

/**
 * Thompson / routing_arms task_type namespace = execution mode (not tool_shape map).
 * @param {string} routeKey
 * @param {{ mode?: unknown }} [opts]
 */
export function armTaskTypeForRouteKey(routeKey, opts = {}) {
  try {
    if (opts.mode != null && String(opts.mode).trim() !== '') {
      return normalizeMode(opts.mode);
    }
  } catch {
    /* fall through */
  }
  // Legacy callers that only pass routeKey: map mode-default reverse when possible.
  const rk = normalizeRouteKey(routeKey);
  if (rk === 'planning') return 'plan';
  if (rk === 'code_debug') return 'debug';
  if (rk === 'tool_orchestration') return 'multitask';
  return 'agent';
}

/**
 * D1 agentsam_routing_arms (task_type, mode) lookup for resolveModelForTask.
 * Composer / runtime-profile paths: mode profile owns both dimensions.
 * System lanes (compaction, rag, workflows): explicit fine task_type + arm mode.
 *
 * @param {object} opts
 * @param {unknown} [opts.mode]
 * @param {unknown} [opts.task_type]
 * @param {unknown} [opts.taskType]
 * @param {boolean} [opts.prefer_mode_profile] composer/runtime-profile — ignore fine task_type
 * @param {boolean} [opts.preferModeProfile]
 * @param {{
 *   isExecutionMode: (v: string) => boolean,
 *   normalizeCanonicalTaskType: (v: string) => string,
 *   resolveRoutingMode: (taskType: string, mode?: string) => string,
 * }} contracts
 */
export function resolveArmLookupFromOpts(opts = {}, contracts) {
  const preferModeProfile =
    opts.prefer_mode_profile === true || opts.preferModeProfile === true;

  const rawTask =
    opts.task_type != null && String(opts.task_type).trim() !== ''
      ? String(opts.task_type).trim().toLowerCase()
      : opts.taskType != null && String(opts.taskType).trim() !== ''
        ? String(opts.taskType).trim().toLowerCase()
        : '';

  let modeProfile = 'agent';
  try {
    modeProfile = normalizeMode(opts.mode != null ? opts.mode : 'agent');
  } catch {
    modeProfile = 'agent';
  }

  const isModeLabel = rawTask && contracts.isExecutionMode(rawTask);
  const hasSystemLane = rawTask && !isModeLabel && !preferModeProfile;

  if (preferModeProfile || !hasSystemLane) {
    return {
      mode_profile: modeProfile,
      arm_task_type: modeProfile,
      arm_mode: modeProfile,
      lookup_source: 'mode_profile',
    };
  }

  if (hasSystemLane) {
    let armTaskType = rawTask;
    try {
      armTaskType = contracts.normalizeCanonicalTaskType(rawTask);
    } catch {
      armTaskType = rawTask;
    }
    const armMode = contracts.resolveRoutingMode(armTaskType, modeProfile);
    return {
      mode_profile: modeProfile,
      arm_task_type: armTaskType,
      arm_mode: armMode,
      lookup_source: 'system_lane',
    };
  }

  return {
    mode_profile: modeProfile,
    arm_task_type: modeProfile,
    arm_mode: modeProfile,
    lookup_source: 'mode_profile',
  };
}
