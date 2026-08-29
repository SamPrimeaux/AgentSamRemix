/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mechanical peel from ChatAssistant.tsx — behavior-identical move.
 * Logic module (not a React hook) — category ceiling ≤1000.
 */

import { appendChatSendFormFields } from './buildChatSendFormData';
import { executeChatSendStream } from './executeChatSendStream';
import {
  getDatabaseSurfaceContext,
} from '../../../src/lib/databaseStudioEvents';
import { LS_AGENT_CHAT_CONVERSATION_ID, IAM_AGENT_CHAT_CONVERSATION_CHANGE } from '../../../agentChatConstants';
import { replaceAgentConversationUrl } from '../../../lib/agentRoutes';
import { liveConversationIdForSend } from '../../../lib/agentConversationBind';
import { deriveAgentChatTitleFromMessage, buildOptimisticAgentSessionRow, prependOptimisticAgentSession } from '../../../agentSessionsCatalog';
import { readExecutionWorkspaceId } from '../../../src/lib/activateProjectWorkContext';
import { preserveLiveCadTraceRows } from '../../../lib/cadToolTrace';
import { attachCompletedToolTracesToLastAssistant } from '../../../lib/persistAssistantToolTraces';
import { buildMentionContext, getEditorLightweightPath } from '../mentionContext';
import { buildGithubContextEnvelope } from '../../../types/contextEnvelope';
import { syncComposerTextareaHeight } from '../composerLayout';
import {
  AUTO_MODEL_KEY,
  isAutoModelSelection,
  COMPOSER_TEXTAREA_MAX_PX_NARROW,
  COMPOSER_TEXTAREA_MAX_PX_WIDE,
  CHAT_ATTACH_MAX_TOTAL_BYTES,
  type AgentMode,
  type Message,
  type MessageAttachmentPreview,
} from '../types';
import { isPlanSlashMessage } from '../../../lib/plan-mode-utils';
import { IAM_FILES_SOURCE_CONTEXT_REQUEST_EVENT } from '../../../src/lib/agentSamFilesystemTypes';

/** Create handleSend bound to ChatAssistant closure bag `d` (peel A2). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createChatSendHandler(d: any) {
  const {
    abortControllerRef,
    activeFile,
    activeFileContent,
    activeFileName,
    activePlanIdRef,
    activeProject,
    activeWorkbenchTab,
    agentsamPolicy,
    attachments,
    browserElementContext,
    browserSurfaceRef,
    browserUrlProp,
    chatGithubBranch,
    chatGithubContentSha,
    chatGithubContentTruncated,
    chatGithubFileContent,
    chatGithubFilePath,
    chatModels,
    clearAttachments,
    cmsContext,
    composerActionRef,
    composerSources,
    conversationId,
    conversationIdRef,
    dashboardRouteKey,
    dashboardRouteLabel,
    dashboardTaskType,
    databaseSurfaceRef,
    defaultSubagentSlug,
    designModeContextRef,
    designStudioBlueprintId,
    designStudioCadJobId,
    designStudioSceneId,
    designStudioSurfaceRef,
    editorCursorColumn,
    editorCursorLine,
    execLane,
    explorerActiveRepo,
    explorerActiveSource,
    explorerActiveSourceRef,
    filesSourceContextRef,
    focusedPane,
    fsChangeScopeRef,
    githubRepoContext,
    githubContextActive,
    handlePythonDraftOpened,
    handleSendRef,
    handleStreamModel,
    handleSubagentEvent,
    handleThinkingEvent,
    hostWorkspaceContext,
    input,
    isLoading,
    isNarrow,
    loadSessions,
    setSessions,
    location,
    mailSurfaceRef,
    messageQueue,
    messages,
    messagesRef,
    mode,
    onAgentRunContext,
    onBrowserNavigate,
    onFileSelect,
    onGlbFileSelect,
    onR2FileUpdated,
    onVoiceResponse,
    openFilePaths,
    pendingSubagentSlugRef,
    pickedElementRef,
    resolvedActivePlanId,
    selectedModelKey,
    selectedModelKeyRef,
    setBrowserElementContext,
    setComposerToast,
    setConversationId,
    setInput,
    setIsLoading,
    setLoadingStartedAt,
    setMentionOpen,
    setMessageQueue,
    setMessages,
    setMode,
    setPendingToolApproval,
    setPlanSuggestDismissed,
    setPresenceState,
    setPythonDraftHint,
    setSelectedModelKey,
    setSlashOpen,
    setSplitChildMessages,
    setStreamModelKey,
    setThinkingState,
    setToolTraceRows,
    toolTraceRows,
    setWorkflowLedger,
    splitChild,
    streamFinalizedRef,
    streamReaderRef,
    stripEmptyAssistantTail,
    textareaRef,
    totalStagedBytes,
    workflowLedger,
    workspaceId,
    refreshWorkspaces,
    workspaceLoadError,
  } = d;

  async function handleSend(overrideMessage?: string, sendOpts?: ChatRoutingSendOpts) {
    if (pendingSubagentSlugRef.current && !sendOpts?.subagent_slug?.trim()) {
      sendOpts = { ...(sendOpts ?? {}), subagent_slug: pendingSubagentSlugRef.current };
      pendingSubagentSlugRef.current = null;
    }
    const rawText = overrideMessage ?? input;
    let text = rawText;
    let sendMode: AgentMode = mode;
    if (sendOpts?.force_plan_mode) {
      sendMode = 'plan';
      setMode('plan');
      setPlanSuggestDismissed(true);
    }
    if (isPlanSlashMessage(rawText)) {
      sendMode = 'plan';
      setMode('plan');
      setPlanSuggestDismissed(true);
      text = rawText.replace(/^\/plan\b\s*/i, '').trim();
      if (!text && !overrideMessage) {
        setInput('');
        return;
      }
    }
    const rawModelKey = (
      sendOpts?.modelKey?.trim() ||
      selectedModelKeyRef.current ||
      selectedModelKey ||
      AUTO_MODEL_KEY
    ).trim();
    const useAutoRouting = isAutoModelSelection(rawModelKey);
    const effectiveModelKey = useAutoRouting
      ? AUTO_MODEL_KEY
      : rawModelKey || chatModels[0]?.model_key || AUTO_MODEL_KEY;
    if ((!text && attachments.length === 0) || (isLoading && !overrideMessage)) return;
    const stagedAttachments = [...attachments];
    onAgentRunContext?.(null);
    if (!useAutoRouting && !effectiveModelKey) {
      if (overrideMessage?.trim()) {
        setMessageQueue((prev) => (prev.includes(overrideMessage) ? prev : [...prev, overrideMessage]));
      }
      return;
    }
    const nextStoredKey = useAutoRouting ? AUTO_MODEL_KEY : effectiveModelKey;
    if (sendOpts?.modelKey?.trim()) {
      const picked = isAutoModelSelection(sendOpts.modelKey) ? AUTO_MODEL_KEY : sendOpts.modelKey.trim();
      if (picked !== selectedModelKey) setSelectedModelKey(picked);
    } else if (nextStoredKey !== selectedModelKey) {
      setSelectedModelKey(nextStoredKey);
    }

    if (totalStagedBytes > CHAT_ATTACH_MAX_TOTAL_BYTES) {
      setComposerToast('Attachments exceed 90 MB — remove files before sending.');
      return;
    }

    const userMessage = text || '(attachment)';
    const terminalTurn =
      /\b(git|npm|wrangler|shell|status|deploy|command|whoami)\b/i.test(userMessage) ||
      execLane === 'remote' ||
      execLane === 'sandbox';
    setThinkingState({
      steps: [],
      thinkingText: terminalTurn ? 'Running command…' : 'Thinking…',
      status: terminalTurn ? 'working' : 'thinking',
      startedAt: Date.now(),
      surface: terminalTurn ? 'terminal' : null,
    });
    setPresenceState(terminalTurn ? 'terminal' : 'thinking');
    setLoadingStartedAt(Date.now());

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    streamFinalizedRef.current = false;
    const signal = abortControllerRef.current.signal;

    const sendWorkspaceId = (() => {
      const fromQuickstart = sendOpts?.workspace_id?.trim();
      if (fromQuickstart && fromQuickstart !== 'global') return fromQuickstart;
      // Project activate stores execution workspace separately from the launcher
      // global workspace (IAM). Prefer it whenever set — even after fresh-chat wipes
      // session project — otherwise companions chat silently posts as ws_inneranimalmedia.
      const execWs = readExecutionWorkspaceId();
      if (execWs && execWs !== 'global') return execWs;
      const fromProp = workspaceId != null ? String(workspaceId).trim() : '';
      if (fromProp && fromProp !== 'global') return fromProp;
      if (typeof window === 'undefined') return '';
      const w = String((window as unknown as { __IAM_WORKSPACE_ID__?: string }).__IAM_WORKSPACE_ID__ || '').trim();
      return w && w !== 'global' ? w : '';
    })();

    // Flaky mobile: bootstrap may have failed silently → empty workspace. Force one
    // /api/settings/workspaces refresh before painting the bubble / locking Stop.
    let resolvedSendWorkspaceId = sendWorkspaceId;
    if (!resolvedSendWorkspaceId && typeof refreshWorkspaces === 'function') {
      try {
        const recovered = await refreshWorkspaces({ force: true });
        const recoveredId = recovered != null ? String(recovered).trim() : '';
        if (recoveredId && recoveredId !== 'global') {
          resolvedSendWorkspaceId = recoveredId;
        }
      } catch {
        /* fall through — toast below */
      }
    }
    if (!resolvedSendWorkspaceId) {
      const hint =
        typeof workspaceLoadError === 'string' && workspaceLoadError.trim()
          ? workspaceLoadError.trim()
          : 'No workspace selected — check your connection, then Retry in Settings → Workspace (or force-reload).';
      setComposerToast(hint);
      return;
    }

    setPendingToolApproval(null);
    setWorkflowLedger({
      runId: null,
      stepsTotal: null,
      stepsCompleted: 0,
      currentNodeKey: null,
      runCost: null,
      runTokensIn: null,
      runTokensOut: null,
      lastError: null,
      status: 'idle',
    });
    setInput('');
    requestAnimationFrame(() => {
      syncComposerTextareaHeight(
        textareaRef.current,
        isNarrow ? COMPOSER_TEXTAREA_MAX_PX_NARROW : COMPOSER_TEXTAREA_MAX_PX_WIDE,
      );
    });
    const attachmentPreviews: MessageAttachmentPreview[] = stagedAttachments.map((a) => ({
      previewUrl: a.previewUrl,
      type: a.type,
      name: a.file.name,
    }));
    const userBubble: Message = {
      role: 'user',
      content: userMessage,
      ...(attachmentPreviews.length ? { attachmentPreviews } : {}),
    };
    const sendToSplitChild =
      focusedPane === 'child' && !!splitChild?.conversationId && !sendOpts?.conversationIdOverride?.trim();
    // Pre-seed the assistant bubble before SSE starts — eliminates the empty-flash
    // race where the UI clears input, renders nothing, then re-renders on first SSE chunk.
    // Snapshot the prior turn's live traces onto that assistant so a retry cannot wipe them.
    const seedNextTurn = (prev: Message[]) => [
      ...attachCompletedToolTracesToLastAssistant(prev, toolTraceRows),
      userBubble,
      { role: 'assistant' as const, content: '' },
    ];
    if (sendToSplitChild) {
      setSplitChildMessages(seedNextTurn);
    } else {
      setMessages(seedNextTurn);
    }
    setIsLoading(true);
    setStreamModelKey(null);
    setMentionOpen(false);
    setSlashOpen(false);
    setToolTraceRows((prev) => preserveLiveCadTraceRows(prev));
    setPythonDraftHint(null);

    for (const a of stagedAttachments) {
      if (a.type !== 'file') continue;
      if (a.file.name.toLowerCase().endsWith('.glb')) onGlbFileSelect?.(a.file);
    }

    const skipMentionContext =
      userMessage.startsWith('/run ') || userMessage.startsWith('/claude ');
    let messageForApi = skipMentionContext
      ? userMessage
      : await buildMentionContext(userMessage, {
          activeFileName,
          activeFileContent: activeFileContent ?? null,
          activeFile: activeFile ?? null,
          editorCursorLine,
          editorCursorColumn,
          browserElementContext:
            browserElementContext && typeof browserElementContext === 'object'
              ? browserElementContext
              : null,
          contextEnvelope: githubContextActive
            ? buildGithubContextEnvelope({
                conversationId: conversationId.trim() || null,
                workspaceId: resolvedSendWorkspaceId || null,
                repo: githubRepoContext?.trim() || '',
                path: chatGithubFilePath,
                branch: chatGithubBranch,
                content: chatGithubFileContent,
                contentSha: chatGithubContentSha,
                contentTruncated: chatGithubContentTruncated,
              })
            : null,
        });
    // Repo / browser / open-file payloads are on-demand (@file, @browser, attachments) — not ambient.

    // Immutable per-turn Studio snapshot — capture BEFORE conversation URL sync so a
    // first-send navigate cannot clear the singleton before browserContext is built.
    const turnDatabaseSurface: Record<string, unknown> | null = (() => {
      const fromRef =
        databaseSurfaceRef.current && typeof databaseSurfaceRef.current === 'object'
          ? ({ ...databaseSurfaceRef.current } as Record<string, unknown>)
          : null;
      if (fromRef) return fromRef;
      if (typeof window === 'undefined' || !window.location.pathname.startsWith('/dashboard/database')) {
        return null;
      }
      const snap = getDatabaseSurfaceContext();
      if (!snap || typeof snap !== 'object') return null;
      return { ...(snap as Record<string, unknown>) };
    })();
    if (turnDatabaseSurface) {
      databaseSurfaceRef.current = turnDatabaseSurface;
    }

    const splitChildConv =
      !sendOpts?.conversationIdOverride?.trim() &&
      focusedPane === 'child' &&
      splitChild?.conversationId
        ? String(splitChild.conversationId).trim()
        : '';
    const rawLiveId =
      (conversationIdRef?.current != null ? String(conversationIdRef.current) : '') ||
      String(conversationId || '');
    const liveConversationId =
      typeof window !== 'undefined'
        ? liveConversationIdForSend(window.location.pathname, window.location.search, rawLiveId)
        : String(rawLiveId || '').trim();
    const effectiveConvId =
      sendOpts?.conversationIdOverride?.trim() ||
      splitChildConv ||
      liveConversationId.trim() ||
      (() => {
        const id = crypto.randomUUID();
        setConversationId(id);
        if (conversationIdRef) conversationIdRef.current = id;
        // Optimistic mint — matches Worker deriveChatSessionTitle; avoid sticky "Chat".
        const mintedTitle = deriveAgentChatTitleFromMessage(String(messageForApi || ''));
        d.setThreadTitle?.(mintedTitle);
        replaceAgentConversationUrl(id);
        try {
          localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, id);
        } catch (_) {}
        if (typeof setSessions === 'function') {
          const optimistic = buildOptimisticAgentSessionRow({
            conversationId: id,
            title: mintedTitle,
            workspaceId: resolvedSendWorkspaceId,
          });
          setSessions((prev: unknown[]) =>
            prependOptimisticAgentSession(Array.isArray(prev) ? (prev as import('../../../agentSessionsCatalog').AgentSessionRow[]) : [], optimistic),
          );
        }
        window.dispatchEvent(
          new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, {
            detail: { id, title: mintedTitle, force: false },
          }),
        );
        return id;
      })();
    // Existing URL-bound thread still stuck on "Chat" — mint from this message.
    {
      const optimistic = deriveAgentChatTitleFromMessage(String(messageForApi || ''));
      if (optimistic && optimistic !== 'New Chat') {
        d.setThreadTitle?.((prev: string) => {
          const cur = String(prev || '').trim();
          if (!cur || cur.toLowerCase() === 'chat' || cur.toLowerCase() === 'new chat') {
            return optimistic;
          }
          return prev;
        });
        window.dispatchEvent(
          new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, {
            detail: { id: effectiveConvId, title: optimistic, force: false },
          }),
        );
      }
    }
    // Handoff may remount conversation; split-child sends keep parent conversationId intact.
    if (
      !splitChildConv &&
      sendOpts?.conversationIdOverride?.trim() &&
      sendOpts.conversationIdOverride.trim() !== liveConversationId.trim()
    ) {
      setConversationId(sendOpts.conversationIdOverride.trim());
    }
    // Refresh synchronously from the mounted Files rail before stamping this turn.
    // The rail owns source/folder truth; chat must not rely on an earlier render event.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(IAM_FILES_SOURCE_CONTEXT_REQUEST_EVENT));
    }
    const form = new FormData();
    try {
      await appendChatSendFormFields(form, {
        ...d,
        messageForApi,
        sendMode,
        effectiveModelKey,
        useAutoRouting,
        effectiveConvId,
        sendWorkspaceId: resolvedSendWorkspaceId,
        sendOpts,
        stagedAttachments,
        userMessage,
        turnDatabaseSurface,
      });
    } catch (formErr) {
      // Pre-dispatch failure (e.g. workspace_id_required). Never let this reach here
      // uncaught: setIsLoading(true) already fired above, and executeChatSendStream —
      // which owns the matching setIsLoading(false)/cleanup — was never called. Without
      // this catch the composer sticks on "Thinking…" with nothing to Stop and zero
      // agentsam_chat_sessions / agentsam_agent_run rows ever written (2026-08-13 regression).
      const rawMsg = formErr instanceof Error ? formErr.message : String(formErr);
      const userMsg =
        rawMsg === 'workspace_id_required'
          ? 'No workspace selected — check your connection, then Retry in Settings → Workspace (or force-reload).'
          : `Could not send: ${rawMsg}`;
      setComposerToast(userMsg);
      const applyToTarget = sendToSplitChild ? setSplitChildMessages : setMessages;
      applyToTarget((prev: Message[]) => stripEmptyAssistantTail(prev));
      setIsLoading(false);
      setPresenceState('idle');
      abortControllerRef.current = null;
      return;
    }

    await executeChatSendStream({
      form, signal, sendWorkspaceId: resolvedSendWorkspaceId, sendToSplitChild,
      setSplitChildMessages, setMessages, setIsLoading, setWorkflowLedger, setToolTraceRows,
      handlePythonDraftOpened, setConversationId, stripEmptyAssistantTail, loadSessions,
      onBrowserNavigate, onR2FileUpdated, handleThinkingEvent, handleSubagentEvent,
      onAgentRunContext, handleStreamModel, onFileSelect, setPendingToolApproval,
      onVoiceResponse: sendOpts?.voiceTurn ? onVoiceResponse : undefined,
      streamFinalizedRef, abortControllerRef, streamReaderRef, handleSendRef,
      setPresenceState, setThinkingState, clearAttachments, setBrowserElementContext, messagesRef,
      databaseSurfaceRef, agentsamPolicy, messageQueue, setMessageQueue,
    });
  }
  return handleSend;
}
