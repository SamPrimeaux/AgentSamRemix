/**
 * Public types + assistant-tail helper for Agent Sam SSE consume.
 */
import type React from 'react';
import type {
  Message,
  ToolApprovalPayload,
  WorkflowLedgerState,
  ExecutionPlanState,
} from '../../types';
import type { ActiveFile } from '../../../../types';
import type { AgentToolTraceRow } from '../../execution/types';

export type AgentHandoffPayload = {
  next_session_id: string;
  fallback_model_key?: string;
  reason?: string;
};

export type ConsumeAgentChatSseContext = {
  signal: AbortSignal;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  streamFinalizedRef: React.MutableRefObject<boolean>;
  streamReaderRef: React.MutableRefObject<ReadableStreamDefaultReader<Uint8Array> | null>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setWorkflowLedger: React.Dispatch<React.SetStateAction<WorkflowLedgerState>>;
  /** Optional: Agent Sam tool / terminal trace rows (replaces legacy single exec panel). */
  setToolTraceRows?: React.Dispatch<React.SetStateAction<AgentToolTraceRow[]>>;
  /** When a streamed monaco invoke opens a `.py` draft in the editor. */
  onPythonDraftOpened?: (fileName: string) => void;
  /** Budget handoff — child session + cheaper model tier. */
  onAgentHandoff?: (payload: AgentHandoffPayload) => void;
  setConversationId: React.Dispatch<React.SetStateAction<string>>;
  stripEmptyAssistantTail: (prev: Message[]) => Message[];
  loadSessions: () => void;
  onThinkingEvent?: (event: { type: string; tool_name?: string; text?: string; ok?: boolean; output_preview?: string; command_run_id?: string; approval_id?: string; plan_id?: string }) => void;
  /** Multitask/subagent structured events (fanout start, run progress, merge/result, action required). */
  onSubagentEvent?: (event: {
    type: string;
    fanout_id?: string;
    subagent_slug?: string;
    subagent_run_id?: string;
    status?: string;
    conversation_id?: string;
    task_title?: string;
  }) => void;
  /** First SSE context payload — lifts `agentsam_agent_run.id` to host (BrowserView playwright metadata). */
  onAgentRunContext?: (agentRunId: string | null) => void;
  /** Resolved model key from SSE context / runtime_context (for run chip). */
  onStreamModel?: (modelKey: string | null) => void;
  onBrowserNavigate?: (event: {
    type: 'browser_navigate';
    url: string;
    automation?: boolean;
    agent_live?: boolean;
    screenshot_url?: string;
    page_text?: string;
    title?: string;
  }) => void;
  onR2FileUpdated?: (event: { type: 'r2_file_updated'; bucket: string; key: string }) => void;
  onFileSelect?: (file: {
    name: string;
    content: string;
    originalContent?: string;
    workspacePath?: string;
    source_type?: ActiveFile['source_type'];
  }) => void;
  /** Full tool-approval side effects (state + queue drain), matching prior ChatAssistant inline behavior. */
  onToolApprovalRequest: (tool: ToolApprovalPayload) => void;
  /** When true, merge streamed text into the existing last assistant bubble (e.g. plan-task resume after Allow). */
  mergeIntoLastAssistant?: boolean;
  /** Required when mergeIntoLastAssistant — starting text of the last assistant message. */
  initialAssistantBuffer?: string;
};

/** Create or patch the trailing assistant bubble (deferred until first SSE payload). */
export function upsertAssistantTail(
  prev: Message[],
  patch: Partial<Message> & { content?: string },
): Message[] {
  const next = [...prev];
  const idx = next.length - 1;
  if (idx >= 0 && next[idx].role === 'assistant') {
    next[idx] = { ...next[idx], ...patch, role: 'assistant' };
    return next;
  }
  return [...next, { ...patch, role: 'assistant', content: patch.content ?? '' }];
}

/** Mutable bag shared across stream handler modules (mechanical peel of closed-over lets). */
export type SseSession = {
  ctx: ConsumeAgentChatSseContext;
  decoder: TextDecoder;
  assistantContent: string;
  assistantStreamBuf: string;
  sseCarry: string;
  fileEchoSuppress: boolean;
  pendingConversationUrlSync: string | null;
  streamStartedAt: number;
  readCount: number;
  emptyRun: number;
  lastSseByteAt: number;
  idleTimedOut: boolean;
  MAX_STREAM_MS: number;
  MAX_IDLE_MS: number;
  MAX_READS: number;
  MAX_EMPTY_RUN: number;
  CODE_ARTIFACT_CHAR_LIMIT: number;
  CODE_ARTIFACT_RE: RegExp;
  activeToolTraceId: string | null;
  pendingBrowserToolUrl: string | null;
  pendingBrowserToolAutomation: boolean;
  lastBrowserToolOutputChunk: string | null;
  activeBrowserNavTool: boolean;
  lastBrowserScreenshotOutputChunk: string | null;
  lastActiveToolOutputChunk: string | null;
  activeBrowserScreenshotTool: boolean;
  activeAgentRunId: string | null;
  executionPlan: ExecutionPlanState | null;
  doneReceived: boolean;
  activeTurnId: string;
  activeConversationId: string;
  idleTimer: number | null;
  isCodeArtifactStream: () => boolean;
  stopStreamForSafety: (reason: 'max_ms' | 'max_reads' | 'max_empty_run') => void;
  applySsePayloadToAssistant: (data: unknown) => void;
  clearIdleTimer: () => void;
  pushExecutionPlan: (next: ExecutionPlanState | null) => void;
  upsertAssistantTail: typeof upsertAssistantTail;
};

/** Handler result for one SSE JSON payload. */
export type SseDispatchResult = 'continue' | 'break_loop' | 'fallthrough';
