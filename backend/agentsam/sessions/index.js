/**
 * Agent Sam chat sessions — public surface for **external** callers only.
 *
 * Outside `backend/agentsam/sessions/`: import from here.
 * Inside the domain: import sibling modules directly (no barrel cycles).
 *
 * Law: backend/agentsam/sessions/INTEGRATION.md
 *
 * @module backend/agentsam/sessions
 */

export {
  ensureChatSessionRow,
  scheduleChatSessionTitleInsert,
  getUserChatSession,
  listUserChatSessions,
  patchUserChatSession,
  deleteChatSessionRow,
  getChatSessionArchiveKeys,
} from './metadata-repository.js';

export { deriveChatSessionTitle, isPlaceholderChatSessionTitle } from './title.js';

export {
  parseSessionProjectIdFromChatBody,
  resolveConversationProjectRef,
  resolveChatProjectId,
  lookupChatProjectId,
  resolveProjectsTableId,
  expandChatProjectRefs,
  resolveExplicitSessionProjectId,
  resolveSessionPatchProjectId,
} from './project-bind.js';

export {
  beginChatTurn,
  appendChatMessage,
  markChatTurnStatus,
  getChatMessages,
  wipeChatSessionDo,
  persistCompactedChatMessages,
  messagesFromDoBootstrap,
} from './chat-do-client.js';

export { getAgentSessionStub, withDoFetchTimeout } from './do-stub.js';

export {
  mapSseTypeToOutboxEventType,
  appendTurnOutboxEvent,
  appendTurnOutboxBatch,
  createTurnOutboxBatcher,
  fetchTurnOutboxEvents,
  wrapEmitWithTurnOutbox,
  wrapEmitWithTurnOutboxBatcher,
  ingestSseChunkToTurnOutbox,
} from './turn-outbox-client.js';

export {
  initChatSessionR2,
  getChatDigestText,
  getChatMessagesFromR2,
} from './compaction/archive.js';

export {
  bootstrapAgentSession,
  loadOrBootstrapSessionContext,
  getAgentSessionStub as getSessionStubFromContext,
  doFulfillFsaRequest,
  doWaitForFsaFulfill,
  loadOauthVisibleToolsForSession,
  resolveSessionProfileTaskType,
  isDesignModeActiveFromBody,
  isDesignModeBrowserContext,
} from './session-context.js';

export {
  assembleWorkingContextForInference,
  cloneMessagesForWorkingContext,
} from './window/assemble.js';

export {
  resolveCompactionBudget,
  loadModelContextWindow,
  compactConversationMessagesIfNeeded,
  COMPACTION_RESERVED_TOKENS,
} from './compaction/compact.js';

export {
  parseThreadSlashCommand,
  loadConversationMessages,
  runThreadActionOnDemand,
  dispatchInAppThreadCommand,
  summarizeThreadOnDemand,
} from './thread-on-demand.js';

export {
  windowChatMessagesForHydrate,
  prependChatDigest,
  RECENT_VERBATIM_USER_TURNS,
} from './window/hydrate.js';

export {
  deleteUserChatSession,
  purgeArchivedChatSessions,
  PURGE_ARCHIVED_CHAT_CONFIRM,
} from './purge.js';

export { scheduleChatSessionR2Init } from './lifecycle.js';

export { bumpChatSessionArtifactCount } from './artifact-count.js';

export {
  AGENT_INFERENCE_BOOTSTRAP_HISTORY_LIMIT,
  resolveInferenceBootstrapHistoryLimit,
  bootstrapAgentChatTurn,
} from './do/bootstrap.js';
