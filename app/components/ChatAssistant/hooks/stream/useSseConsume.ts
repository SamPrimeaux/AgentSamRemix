/**
 * SSE reader loop: decode, abort, idle/safety limits, dispatch to handler modules.
 */
import { replaceAgentConversationUrl } from '../../../../lib/agentRoutes';
import {
  applyTurnOutboxEvents,
  fetchTurnOutboxReplay,
  readTurnOutboxCursor,
} from '../../../../lib/chatTurnOutbox';
import { preserveLiveCadTraceRows } from '../../../../lib/cadToolTrace';
import { attachCompletedToolTracesToLastAssistant } from '../../../../lib/persistAssistantToolTraces';
import {
  extractMonacoInvokesFromBuffer,
  hideIncompleteMonacoInvokeTail,
  looksLikeEmbeddedFileDumpStart,
  normalizeAssistantSseText,
  ssePayloadLooksReasoningOnly,
} from '../../streamParsing';
import { markStreamParserError, patchIamAgentStreamDebug } from '../../streamDebug';
import { prepareAssistantChatText } from './sseHelpers';
import { isAgentRuntimeDumpText } from '../../../../shared/agent-runtime/user-visible-agent-error.js';
import type { ConsumeAgentChatSseContext, SseDispatchResult, SseSession } from './sseTypes';
import { upsertAssistantTail } from './sseTypes';
import { handleTurnMetaFromSse, handleTurnStateFromSse } from './useTurnStateFromSse';
import { handleHandoffFromSse, handleConversationIdFromSse } from './useSessionSyncFromSse';
import {
  handleToolApprovalRequestFromSse,
  handleApprovalFromSse,
  handleWorkflowTerminalFromSse,
} from './useApprovalFromSse';
import {
  handleToolErrorThinkingFromSse,
  handleToolTraceFromSse,
} from './useToolTraceFromSse';
import { handleToolDoneFromSse } from './handleToolDoneFromSse';
import { handleSubagentFromSse } from './handleSubagentFromSse';
import { handleThinkingImageEmailFromSse } from './handleThinkingImageEmailFromSse';
import { handleSurfaceMonacoFromSse } from './handleSurfaceMonacoFromSse';
import { handlePlanFromSse } from './handlePlanFromSse';
import { handleWorkflowFromSse } from './handleWorkflowFromSse';
import { handleBrowserR2FromSse } from './handleBrowserR2FromSse';
import { handleTextDeltaFromSse } from './handleTextDeltaFromSse';
import { finalizeSseConsume } from './finalizeSseConsume';
import type { ExecutionPlanState } from '../../types';

function createSseSession(ctx: ConsumeAgentChatSseContext): SseSession {
  const s = {
    ctx,
    decoder: new TextDecoder(),
    assistantContent: '',
    assistantStreamBuf: ctx.mergeIntoLastAssistant ? String(ctx.initialAssistantBuffer || '') : '',
    sseCarry: '',
    fileEchoSuppress: false,
    pendingConversationUrlSync: null as string | null,
    streamStartedAt: Date.now(),
    readCount: 0,
    emptyRun: 0,
    lastSseByteAt: Date.now(),
    idleTimedOut: false,
    MAX_STREAM_MS: 900000,
    MAX_IDLE_MS: 90000,
    MAX_READS: 12000,
    MAX_EMPTY_RUN: 200,
    CODE_ARTIFACT_CHAR_LIMIT: 48000,
    CODE_ARTIFACT_RE: /<!doctype|<!DOCTYPE|\bfunction\s|\bconst\s|export default|\bclass\s/,
    activeToolTraceId: null as string | null,
    pendingBrowserToolUrl: null as string | null,
    pendingBrowserToolAutomation: false,
    lastBrowserToolOutputChunk: null as string | null,
    activeBrowserNavTool: false,
    lastBrowserScreenshotOutputChunk: null as string | null,
    lastActiveToolOutputChunk: null as string | null,
    activeBrowserScreenshotTool: false,
    activeAgentRunId: null as string | null,
    executionPlan: null as ExecutionPlanState | null,
    doneReceived: false,
    activeTurnId: '',
    activeConversationId: '',
    idleTimer: null as number | null,
    upsertAssistantTail,
  } as SseSession;

  s.isCodeArtifactStream = () => s.CODE_ARTIFACT_RE.test(s.assistantStreamBuf);

  s.stopStreamForSafety = (reason: 'max_ms' | 'max_reads' | 'max_empty_run') => {
    console.error('[stream-limit] triggered:', {
      reason,
      outputLength: s.assistantStreamBuf.length,
      sessionType: s.isCodeArtifactStream() ? 'code_artifact' : 'default',
      model: 'client_sse',
      readCount: s.readCount,
      emptyRun: s.emptyRun,
    });
    console.warn('[useAgentChatStream] safety_stop', {
      reason,
      readCount: s.readCount,
      emptyRun: s.emptyRun,
      fileEchoSuppress: s.fileEchoSuppress,
      elapsedMs: Date.now() - s.streamStartedAt,
      bufLen: s.assistantStreamBuf.length,
    });
    if (typeof window !== 'undefined') {
      patchIamAgentStreamDebug({
        safety_stop_reason: reason,
        safety_stop_at: Date.now(),
        read_count: s.readCount,
        empty_run: s.emptyRun,
        file_echo_suppress: s.fileEchoSuppress,
      });
    }
    const suffix =
      reason === 'max_empty_run'
        ? '\n\n[Stream stopped: too many non-text chunks.]'
        : reason === 'max_ms' || reason === 'max_reads'
          ? '\n\n[Generation paused — reply to continue]'
          : `\n\n[Stream stopped: exceeded safety limits (${reason}).]`;
    s.assistantStreamBuf += suffix;
    s.assistantContent = s.assistantStreamBuf;
    s.ctx.setMessages((prev) => upsertAssistantTail(prev, { content: s.assistantContent }));
  };

  s.applySsePayloadToAssistant = (data: unknown) => {
    const delta = normalizeAssistantSseText(data);
    if (delta && isAgentRuntimeDumpText(delta)) return;
    if (!delta && ssePayloadLooksReasoningOnly(data)) {
      if (!s.fileEchoSuppress) {
        s.emptyRun += 1;
      }
      return;
    }
    if (delta) {
      s.emptyRun = 0;
      if (typeof window !== 'undefined') {
        const dbg = window.__IAM_AGENT_LAST_STREAM_DEBUG;
        if (dbg && dbg.first_text_at == null) {
          patchIamAgentStreamDebug({ first_text_at: Date.now() });
        }
      }
    }
    const sseText = normalizeAssistantSseText(data);
    const trialBuf = s.assistantStreamBuf + sseText;
    const extracted = extractMonacoInvokesFromBuffer(trialBuf);
    const nextBuf = extracted.text;
    const nextVisible = hideIncompleteMonacoInvokeTail(nextBuf);

    if (!s.fileEchoSuppress && looksLikeEmbeddedFileDumpStart(nextVisible)) {
      s.fileEchoSuppress = true;
      if (typeof window !== 'undefined') {
        patchIamAgentStreamDebug({ artifact_echo_suppress: true, artifact_echo_at: Date.now() });
      }
    }

    s.assistantStreamBuf = nextBuf;
    s.assistantContent = prepareAssistantChatText(nextVisible, 200);
    s.ctx.setMessages((prev) =>
      upsertAssistantTail(prev, { content: s.assistantContent, executionPlan: s.executionPlan }),
    );
  };

  s.clearIdleTimer = () => {
    if (s.idleTimer != null) window.clearInterval(s.idleTimer);
  };

  s.pushExecutionPlan = (next: ExecutionPlanState | null) => {
    s.executionPlan = next;
    s.ctx.setMessages((prev) =>
      upsertAssistantTail(prev, { content: s.assistantContent, executionPlan: next }),
    );
  };

  return s;
}

function dispatchSsePayload(s: SseSession, data: unknown): SseDispatchResult {
  const evType = (data as { type?: string }).type;

  const markFirstSse = () => {
    if (typeof window === 'undefined') return;
    const cur = window.__IAM_AGENT_LAST_STREAM_DEBUG;
    if (!cur || cur.first_sse_event_at != null) return;
    patchIamAgentStreamDebug({ first_sse_event_at: Date.now() });
  };
  markFirstSse();

  // Preserve original handler order (pre-peel useAgentChatStream.ts).
  const steps: Array<() => SseDispatchResult> = [
    () => handleTurnMetaFromSse(s, data, evType),
    () => handleSubagentFromSse(s, data, evType),
    () => handleHandoffFromSse(s, data, evType),
    () => handleTurnStateFromSse(s, data, evType),
    () => handleToolApprovalRequestFromSse(s, data, evType),
    () => handleThinkingImageEmailFromSse(s, data, evType),
    () => handleToolErrorThinkingFromSse(s, data, evType),
    () => handleApprovalFromSse(s, data, evType),
    () => handleSurfaceMonacoFromSse(s, data, evType),
    () => handlePlanFromSse(s, data, evType),
    () => handleWorkflowFromSse(s, data, evType),
    () => handleWorkflowTerminalFromSse(s, data, evType),
    () => handleBrowserR2FromSse(s, data, evType),
    () => handleToolTraceFromSse(s, data, evType),
    () => handleToolDoneFromSse(s, data, evType),
    () => handleConversationIdFromSse(s, data),
    () => handleTextDeltaFromSse(s, data),
  ];

  for (const step of steps) {
    const r = step();
    if (r === 'continue' || r === 'break_loop') return r;
  }
  return 'fallthrough';
}

/**
 * Read NDJSON/SSE chunks from the chat response body until done or error.
 * Mutates assistant bubble via setMessages; throws on fatal stream errors for outer catch.
 */
export async function runSseConsumeLoop(ctx: ConsumeAgentChatSseContext): Promise<void> {
  const s = createSseSession(ctx);
  const { signal, reader, setToolTraceRows, mergeIntoLastAssistant = false } = ctx;

  s.idleTimer =
    typeof window !== 'undefined'
      ? window.setInterval(() => {
          if (signal.aborted || s.idleTimedOut) return;
          if (Date.now() - s.lastSseByteAt > s.MAX_IDLE_MS) {
            s.idleTimedOut = true;
            patchIamAgentStreamDebug({ idle_timeout_at: Date.now() });
            void reader.cancel().catch(() => {});
          }
        }, 2000)
      : null;

  if (!mergeIntoLastAssistant) {
    s.activeToolTraceId = null;
    setToolTraceRows?.((prev) => preserveLiveCadTraceRows(prev));
  }
  s.assistantContent = s.assistantStreamBuf;

  try {
    sseLoop: while (true) {
      if (signal.aborted || ctx.streamFinalizedRef?.current) break sseLoop;
      if (s.idleTimedOut) {
        if (s.activeTurnId && s.activeConversationId) {
          try {
            const sinceSeq = readTurnOutboxCursor(s.activeTurnId);
            const replay = await fetchTurnOutboxReplay(
              s.activeConversationId,
              s.activeTurnId,
              sinceSeq,
            );
            const { terminal } = applyTurnOutboxEvents(replay.events, (payload) => {
              s.applySsePayloadToAssistant(payload);
            });
            if (terminal === 'done') {
              s.doneReceived = true;
              break sseLoop;
            }
            if (terminal === 'error') {
              break sseLoop;
            }
            if (replay.latest_seq > sinceSeq && s.assistantStreamBuf.trim()) {
              patchIamAgentStreamDebug({
                outbox_resume_at: Date.now(),
                outbox_resume_seq: replay.latest_seq,
              });
              break sseLoop;
            }
          } catch {
            /* fall through to idle error */
          }
        }
        throw new Error(
          'No response from Agent Sam (stream idle timeout). Try again or switch to Ask mode for quick questions.',
        );
      }
      const overMs = Date.now() - s.streamStartedAt > s.MAX_STREAM_MS;
      const artifact = s.isCodeArtifactStream();
      const readCap =
        artifact && s.assistantStreamBuf.length < s.CODE_ARTIFACT_CHAR_LIMIT
          ? s.MAX_READS * 2
          : s.MAX_READS;
      const overReads = !s.fileEchoSuppress && s.readCount >= readCap;
      const overEmpty = !s.fileEchoSuppress && s.emptyRun >= s.MAX_EMPTY_RUN;
      if (overMs || overReads || overEmpty) {
        s.stopStreamForSafety(overMs ? 'max_ms' : overReads ? 'max_reads' : 'max_empty_run');
        break sseLoop;
      }

      const { done, value } = await reader.read();
      s.readCount += 1;
      if (value?.byteLength) s.lastSseByteAt = Date.now();
      if (done) break;

      s.sseCarry += s.decoder.decode(value, { stream: true });
      const parts = s.sseCarry.split('\n\n');
      s.sseCarry = parts.pop() || '';

      for (const block of parts) {
        for (const rawLine of block.split('\n')) {
          const line = rawLine.trim();
          if (!line) continue;
          if (!/^data:/i.test(line)) continue;
          const dataStr = line.replace(/^data:\s*/i, '').trim();
          if (dataStr === '[DONE]') break sseLoop;
          let data: unknown;
          try {
            data = JSON.parse(dataStr);
          } catch (e) {
            markStreamParserError(e instanceof Error ? e.message : String(e));
            continue;
          }
          if (signal.aborted || ctx.streamFinalizedRef?.current) break sseLoop;

          const result = dispatchSsePayload(s, data);
          if (result === 'break_loop') break sseLoop;
          if (result === 'continue') continue;
        }
      }
    }
  } finally {
    s.clearIdleTimer();
    if (s.pendingConversationUrlSync && !signal.aborted) {
      replaceAgentConversationUrl(s.pendingConversationUrlSync);
    }
  }

  finalizeSseConsume(s);

  // Persist this turn's tool rows onto the assistant bubble before the next send
  // clears live rows — otherwise evidence vanishes after completion / layout churn.
  if (setToolTraceRows) {
    setToolTraceRows((prev) => {
      if (prev.length) {
        s.ctx.setMessages((msgs) => attachCompletedToolTracesToLastAssistant(msgs, prev));
      }
      return prev;
    });
  }
  return s.assistantContent;
}
