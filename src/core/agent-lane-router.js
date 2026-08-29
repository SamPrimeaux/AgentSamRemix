/**
 * Agent Sam execution lanes — message classifiers removed (pre-LLM nuke 2026-08).
 * Mode menu + model tool_call own discovery.
 * Multi-agent spawn is tools only: agentsam_multitask_* / agentsam_spawn_* / agentsam_create_subagent.
 */

import { resolveOpenWebSearchBackend } from './tavily-open-web-search.js';

export { resolveOpenWebSearchBackend };

/** @typedef {'none'} ExecutionLane */

const LANE_LOG_PREFIX = '[agent] execution_lane_selected';

/**
 * No message → lane classify. Mode menu owns tool discovery.
 */
export function classifyAgentExecutionLane(_message, opts = {}) {
  const requestedMode = String(opts.requestedMode || 'agent').toLowerCase();
  return {
    primary_lane: /** @type {ExecutionLane} */ ('none'),
    reason: 'mode_only_no_message_lane',
    requested_mode: requestedMode,
    open_web_allowed: false,
    url: null,
    log_line: LANE_LOG_PREFIX,
  };
}

/** @deprecated Always false — no JS tool-name family sets. */
export function isWorkspaceGrepToolName(_name) {
  return false;
}

/** @deprecated Always false — no JS tool-name family sets. */
export function isOpenWebSearchToolName(_name) {
  return false;
}

/** @deprecated Always false — no JS tool-name family sets. */
export function isWebFetchToolName(_name) {
  return false;
}

/** @deprecated Always false — no prefix/name guessing for browser tools. */
export function isBrowserInspectToolName(_name) {
  return false;
}

/** Return tools unchanged (mode menu owns set). */
export function filterToolsForExecutionLane(tools, _laneResult, _opts = {}) {
  return Array.isArray(tools) ? tools : [];
}

export function formatExecutionLaneLogPayload(laneResult, backend = { available: false }) {
  return {
    primary_lane: laneResult?.primary_lane ?? 'none',
    reason: laneResult?.reason ?? 'mode_only',
    open_web_backend: backend?.available ? backend : null,
  };
}
