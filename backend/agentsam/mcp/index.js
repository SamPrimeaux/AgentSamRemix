/**
 * Agent Sam MCP panel + zone domain — public surface.
 *
 * External callers: import from this index.
 * Inside the domain: import sibling modules directly.
 */

export {
  MCP_ZONE_SLUGS,
  normalizeMcpZoneSlug,
  normalizeSandboxContainerSlug,
  resolveMcpZoneWorkspaceId,
  resolveMcpZoneConversationId,
  parseMcpZoneStateJson,
  mapZoneStateToSession,
  isMcpZoneSlug,
} from './zone-contract.js';

export {
  ensureMcpZoneWorkspace,
  loadMcpZoneSession,
  patchMcpZoneWorkspaceState,
  startMcpZoneSession,
  finalizeMcpZoneChat,
  resetMcpZoneSession,
  resetAllMcpZoneSessions,
} from './zone-session.js';

export {
  resolveSandboxContainerSlug,
  recordMcpZonePatchSession,
  createMcpZoneHandoff,
} from './zone-operations.js';

export { runMcpZoneSandboxCommand } from './sandbox-exec.js';

export {
  mcpPanelToolMatchesGlob,
  filterToolsForMcpPanelGlobs,
  parseMcpPanelToolGlobs,
} from './panel-tool-policy.js';

export {
  MCP_PANEL_HISTORY_CAP,
  buildMcpPanelHistoryMessages,
  completeMcpPanelSession,
  scheduleMcpPanelSessionComplete,
} from './panel-session.js';

export {
  MCP_PANEL_RUN_TIMEOUT_MS,
  validateMcpPanelChatInput,
  prepareMcpPanelChatRuntime,
  executeMcpPanelChat,
  runMcpPanelChat,
} from './panel-chat-runtime.js';
