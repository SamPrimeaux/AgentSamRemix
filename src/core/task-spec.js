/**
 * TaskSpec — inert mode telemetry only (pre-LLM nuke follow-up).
 * Does NOT invent domain/operation/toolProfile from the message or from mode→code fiction.
 * Mode menus + write_policy own tools; this object is for logs/compat only.
 */

/** @typedef {'chat'|'code'|'data'|'media'|'mail'|'ops'|'cms'|'design'|'unknown'} TaskDomain */
/** @typedef {'ask'|'inspect'|'search'|'plan'|'mutate'|'generate'|'revise'|'triage'|'deploy'|'verify'} TaskOperation */
/** @typedef {'none'|'read'|'external_read'|'workspace_write'|'external_write'} TaskSideEffect */
/** @typedef {'read'|'mutate'|'approve_mutate'} TaskAuthority */
/** @typedef {'inspect'|'code_develop'|'image'|'ask'|'mail'|'oauth_parity'|'exempt'|'greeting'|'mode'} ToolProfileHint */
/** @typedef {'L0'|'L1'|'L2'|'L3'|'L4'|'L5'|'L6'|'L7'} ConceptualLane */

/**
 * @typedef {object} TaskSpec
 * @property {string} version
 * @property {TaskDomain} domain
 * @property {TaskOperation} operation
 * @property {string|null} target
 * @property {TaskAuthority} authority
 * @property {TaskSideEffect} sideEffect
 * @property {ToolProfileHint} toolProfile
 * @property {ConceptualLane} conceptualLane
 * @property {string|null} taskType  deprecated — prefer modeHint; null on free-text turns
 * @property {string|null} modeHint
 * @property {number|null} confidence
 * @property {string|null} matchedBy
 * @property {boolean} imageFastPath
 */

/**
 * @deprecated Always false — message inspect regex removed.
 * @param {string} _message
 */
export function isRepoInspectMessage(_message) {
  return false;
}

/**
 * Neutral axes — never project "code.mutate.code_develop" from mode=agent.
 * Explicit composer image pin is the only special case.
 * @param {string} _taskType
 * @param {{ imageFastPath?: boolean, message?: string|null, mode?: string|null }} [ctx]
 */
export function mapTaskTypeToSpecAxes(_taskType, ctx = {}) {
  if (ctx.imageFastPath === true) {
    return {
      domain: /** @type {TaskDomain} */ ('media'),
      operation: /** @type {TaskOperation} */ ('generate'),
      target: 'image',
      authority: /** @type {TaskAuthority} */ ('mutate'),
      sideEffect: /** @type {TaskSideEffect} */ ('external_write'),
      toolProfile: /** @type {ToolProfileHint} */ ('image'),
      conceptualLane: /** @type {ConceptualLane} */ ('L6'),
    };
  }

  // Free-text / mode turns: unknown axes. Mode menu owns tools.
  return {
    domain: /** @type {TaskDomain} */ ('unknown'),
    operation: /** @type {TaskOperation} */ ('ask'),
    target: null,
    authority: /** @type {TaskAuthority} */ ('read'),
    sideEffect: /** @type {TaskSideEffect} */ ('none'),
    toolProfile: /** @type {ToolProfileHint} */ ('mode'),
    conceptualLane: /** @type {ConceptualLane} */ ('L0'),
  };
}

/**
 * @param {{
 *   taskType?: string|null,
 *   imageFastPath?: boolean,
 *   message?: string|null,
 *   mode?: string|null,
 *   confidence?: number|null,
 *   matchedBy?: string|null,
 * }} input
 * @returns {TaskSpec}
 */
export function buildTaskSpec(input) {
  const mode = input.mode != null ? String(input.mode).trim().toLowerCase() || null : null;
  const imageFastPath = input.imageFastPath === true;
  // Free-text: no taskType. Composer image pin keeps a pin label for telemetry only.
  const taskType = imageFastPath
    ? 'image_generation'
    : input.taskType != null && String(input.taskType).trim() !== ''
      ? String(input.taskType).trim().toLowerCase()
      : null;
  const axes = mapTaskTypeToSpecAxes(taskType || '', {
    imageFastPath,
    message: null,
    mode,
  });
  return {
    version: 'mode-telemetry-2',
    ...axes,
    taskType,
    modeHint: mode,
    confidence: input.confidence != null ? Number(input.confidence) : null,
    matchedBy: input.matchedBy != null ? String(input.matchedBy) : null,
    imageFastPath,
  };
}

/**
 * @param {TaskSpec|null|undefined} spec
 */
export function taskSpecKey(spec) {
  if (!spec) return 'mode.unknown';
  const mode = spec.modeHint != null ? String(spec.modeHint).trim().toLowerCase() : '';
  if (spec.imageFastPath) return 'pin.image_generation';
  if (mode) return `mode.${mode}`;
  return 'mode.unknown';
}
