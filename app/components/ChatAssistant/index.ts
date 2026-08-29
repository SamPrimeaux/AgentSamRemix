export {
  ChatAssistant,
  IAM_AGENT_CHAT_CONVERSATION_CHANGE,
  IAM_AGENT_CHAT_NEW_THREAD,
} from './ChatAssistant';

export type {
  ChatAssistantProps,
  Message,
  MessageAttachmentPreview,
  ChatModelRow,
  ExecPanelState,
  WorkflowLedgerState,
} from './types';

export {
  IMAGE_GENERATION_SSE_TYPES,
  normalizeAssistantSseText,
  looksLikeRawProviderLeak,
  ssePayloadLooksReasoningOnly,
  isStreamErrorPayload,
  extractMonacoInvokesFromBuffer,
  hideIncompleteMonacoInvokeTail,
  looksLikeEmbeddedFileDumpStart,
  extractStandaloneHtmlDocument,
  collapseEmbeddedFileDumpsForChat,
  suggestHtmlArtifactFilename,
  formatHttpErrorMessage,
} from './streamParsing';

export {
  initIamAgentStreamDebug,
  patchIamAgentStreamDebug,
  markStreamParserError,
} from './streamDebug';

export type { IamAgentStreamDebug } from './streamDebug';

export { consumeAgentChatSseBody } from './hooks/useAgentChatStream';
