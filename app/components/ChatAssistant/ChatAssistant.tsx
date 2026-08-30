/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import './chat-composer-glass.css';
import './chat-startup-center.css';
import React, { useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { PHONE_MQ } from '../../lib/breakpoints';
import { setChatActivityBusy } from '../../src/pwa/chatActivityGate';
import { preserveLiveCadTraceRows } from '../../lib/cadToolTrace';
import { useEditor } from '../../src/EditorContext';
import { createPortal } from 'react-dom';
import {
  ArrowUp,
  Loader2,
  ChevronRight,
  Paperclip,
  Infinity,
  ListTodo,
  MessageCircle,
  RefreshCw,
  Image as ImageIconLucide,
  AtSign,
  Slash,
  FileText,
  X,
  ChevronDown,
  ChevronLeft,
  MoreHorizontal,
  GitBranch,
  LayoutDashboard,
  Zap,
  Plus,
  ExternalLink,
  FolderGit2,
  Bug,
  Target,
  Sparkles,
  Layers,
  ShieldCheck,
  Play,
  MousePointer2,
} from 'lucide-react';
import { ProjectType } from '../../types';
import type { ActiveFile } from '../../types';
import {
  synthesizeUserVisibleAgentFailure,
} from '../../shared/agent-runtime/user-visible-agent-error.js';
import { SetiFileIcon } from '../../src/components/SetiFileIcon';
import {
  IAM_AGENT_CHAT_CONVERSATION_CHANGE,
  IAM_AGENT_CHAT_NEW_THREAD,
  IAM_AGENT_CHAT_COMPOSE,
  IAM_AGENT_CHAT_READY,
  IAM_AGENT_MOBILE_CODE_FOCUS,
  IAM_AGENT_RUN_CONTEXT,
  LS_AGENT_CHAT_CONVERSATION_ID,
  type AgentChatComposeDetail,
  type QuickstartThreadDetail,
} from '../../agentChatConstants';
import {
  LS_AGENT_CHAT_MODE,
  LS_AGENT_CHAT_MODEL_KEY,
} from '../../src/lib/sessionStorageKeys';
import {
  buildChatProjectContext,
  CHAT_RUNTIME_LANE_FULL_COMPILE,
} from '../../lib/chatProjectContext';
import { notifyAgentChatSessionsRefresh } from '../../lib/openAgentConversation';
import { cancelAgentChatRun, IAM_AGENT_ABORT_LIVE_STREAM } from '../../lib/cancelAgentChatRun';
import { replaceAgentConversationUrl, isAgentCenterChatHome } from '../../lib/agentRoutes';
import { initialAgentConversationIdFromStorage } from '../../lib/agentConversationBind';
import { takeProjectChatFiles } from '../../lib/projectChatHandoff';
import type { AgentSessionRow } from '../../agentSessionsCatalog';
import { sessionDisplayTitle } from '../../agentSessionsCatalog';
import type {
  ActiveSubagentRow,
  AgentGeneratedFile,
  ChatAssistantProps,
  ChatModelRow,
  Message,
  MessageAttachmentPreview,
  PickerItem,
  PlanQuestionsBatchPayload,
  SlashCmd,
  StagedAttachment,
  ToolApprovalPayload,
  WorkflowLedgerState,
} from './types';
import { stageFileForAgentTools } from './types';
import type { AgentToolTraceRow } from './execution/types';
import { ExecutionTimeline, ScriptDraftPanel, shellSingleQuote } from './execution';
import { useWorkspace } from '../../src/context/WorkspaceContext';
import { useAgentModels, useAgentDefaultModel } from '../../src/hooks/useAgentModels';
import {
  IAM_FILES_SOURCE_CONTEXT_EVENT,
  IAM_FILES_SOURCE_CONTEXT_REQUEST_EVENT,
  type AgentSamFsSourceContext,
} from '../../src/lib/agentSamFilesystemTypes';
import {
  githubRepoContextStorageKey,
  chatGithubContextStorageKey,
  readChatGithubContext,
  writeChatGithubContext,
  CHAT_ATTACH_MAX_TOTAL_BYTES,
  CHAT_REQUEST_MAX_BYTES,
  resolveComposerImageHandlingMode,
  resolveAttachmentFileForUpload,
  isImageAttachmentFile,
  MOBILE_CHAT_COMPOSER_BOTTOM_PAD,
  COMPOSER_TEXTAREA_MAX_PX_NARROW,
  COMPOSER_TEXTAREA_MAX_PX_WIDE,
  AgentMode,
  AGENT_MODES,
  AUTO_MODEL_KEY,
  isAutoModelSelection,
} from './types';
import {
  buildMentionContext,
  browserElementMentionToken,
  isChatTextCodeFile,
  readFileAsText,
  getEditorLightweightPath,
} from './mentionContext';
import {
  measureAboveAnchor,
  measureBelowComposerAnchor,
  syncComposerTextareaHeight,
  formatFileSize,
  isAgentSamEmptyThreadGreeting,
} from './composerLayout';
import { RepoPickerBottomSheet } from './RepoPickerBottomSheet';
import { ContextHubDrawer, type ContextHubLane } from './ContextHubDrawer';
import {
  buildGithubContextEnvelope,
  fetchGithubFileContent,
} from '../../types/contextEnvelope';
import { loadPersistedLocalDirectoryHandle } from '../../src/lib/library/localHandleStore';
import { mirrorPlanMarkdownToLocal } from '../../src/lib/library/planLocalMirror';
import { dashboardComposerBottomPad } from '../../config/shellChrome';
import { formatHttpErrorMessage } from './streamParsing';
import { consumeAgentChatSseBody, type AgentHandoffPayload } from './hooks/useAgentChatStream';
import { initIamAgentStreamDebug, patchIamAgentStreamDebug } from './streamDebug';
import { AgentMessageList } from './components/AgentMessageList';
import { PlanStartOverBar } from './components/PlanStartOverBar';
import { suggestPlanMode, nextAgentMode, isPlanSlashMessage } from '../../lib/plan-mode-utils';
import { agentModeAccentCssVar } from '../../features/mode-presence/AgentModePresenceIcon';
import { AgentMobileHomePanel } from './components/AgentMobileHomePanel';
import { AgentChatThreadHeader, findSessionRow } from './components/AgentChatThreadHeader';
import { AgentMobileContextPanel } from './components/AgentMobileContextPanel';
import { AgentChatFilesPanel } from './components/AgentChatFilesPanel';
import type { AgentChatProjectOption } from '../../hooks/useAgentChatSessions';
import { AgentComposerSourceChips } from './composer/AgentComposerSourceChips';
import { ComposerConnectorSheet } from './components/ComposerConnectorSheet';
import {
  ComposerStartupChips,
  ComposerStartupGreeting,
} from './components/ComposerStartupChips';
import type { ComposerAvailableConnector } from '../../src/hooks/useAvailableConnectors';
import { AgentComposerMicButton } from './composer/AgentComposerMicButton';
import {
  composerSourcesStorageKey,
  readComposerSources,
  writeComposerSources,
} from './composer/composerSourcesStorage';
import type { ChatComposerSource } from './composer/types';
import { WEB_SEARCH_SOURCE, WEB_SEARCH_SOURCE_ID, SANDBOX_AGENT_SOURCE, SANDBOX_AGENT_SOURCE_ID } from './composer/types';
import type { ThinkingCardState } from '../../src/components/ThinkingCard';
import { deriveHeroThinkingState } from './components/deriveHeroThinking';
import { ChatSplitLayout } from './components/ChatSplitLayout';
import { ChatConversationPane } from './components/ChatConversationPane';
import { asChatMessages, fetchAgentSessionMessages } from '../../lib/mapAgentSessionMessages';
import { ToolApprovalModal } from '../../src/components/ToolApprovalModal';
import { useChatSurfaceContext } from './hooks/useChatSurfaceContext';
import { useChatGithubRuntime } from './hooks/useChatGithubRuntime';
import { useChatSessionProject } from './hooks/useChatSessionProject';
import { useChatDesignModeBridge } from './hooks/useChatDesignModeBridge';
import { useChatComposerPickers } from './hooks/useChatComposerPickers';
import { useChatAttachments } from './hooks/useChatAttachments';
import { useChatComposerSources } from './hooks/useChatComposerSources';
import { useChatDraftActions } from './hooks/useChatDraftActions';
import { useChatComposerMenus } from './hooks/useChatComposerMenus';
import { useChatVoiceThread } from './hooks/useChatVoiceThread';
import { createChatComposerKeyDown } from './hooks/createChatComposerKeyDown';
import { useChatThreadChrome } from './hooks/useChatThreadChrome';
import { useChatModeChrome } from './hooks/useChatModeChrome';
import { useChatThreadDisplay } from './hooks/useChatThreadDisplay';
import { deriveChatLayoutFlags } from './hooks/deriveChatLayoutFlags';
import { useChatModelPickerControls } from './hooks/useChatModelPickerControls';
import { useChatModelSelection } from './hooks/useChatModelSelection';
import { useChatComposerInput } from './hooks/useChatComposerInput';
import { useChatPresenceDerived } from './hooks/useChatPresenceDerived';
import { createChatImagePreviewHandler } from './hooks/createChatImagePreviewHandler';
import { mapSubagentRowToPresenceState } from '../../features/agent-presence/mapSubagentRowToPresenceState';
import { routingSendOptsFromDetail, type ChatRoutingSendOpts } from './lib/chatRoutingSendOpts';
import { useChatThinkingEvents } from './hooks/useChatThinkingEvents';
import { useSubagentSplitPane } from './hooks/useSubagentSplitPane';
import { useChatWindowBridge } from './hooks/useChatWindowBridge';
import { useToolApprovalActions } from './hooks/useToolApprovalActions';
import { usePlanRunActions } from './hooks/usePlanRunActions';
import { createChatSendHandler } from './hooks/useChatSendPipeline';
import { useThinkAgentSamChat } from './hooks/useThinkAgentSamChat';
import { ChatAssistantView } from './ChatAssistantView';
import {
  getDatabaseSurfaceContext,
  parseAndDispatchDatabaseStudioActions,
  tryDispatchDbApplyFromAssistantMessage,
} from '../../src/lib/databaseStudioEvents';
import '../../features/agent-presence/presenceMotion.css';
import '../../features/agent-presence/presenceIcons.css';
import { useAgentPresence, AgentPresenceStatus } from '../../features/agent-presence';
import type { AgentPresenceState } from '../../features/agent-presence/presenceTypes';
import { derivePresenceState } from '../../features/agent-presence/iamDerivePresenceState';
import {
  formatThinkingStepName,
  simplifyToolName,
  formatBrowserLiveSseStepName,
  upsertThinkingStep,
} from '../../features/agent-chat/formatThinkingStepName';
import {
  pickAgentPresenceColorway,
  agentPresenceColorwayStyle,
} from '../../features/agent-presence/presenceColorways';
export { IAM_AGENT_CHAT_CONVERSATION_CHANGE, IAM_AGENT_CHAT_NEW_THREAD } from '../../agentChatConstants';
export const ChatAssistant: React.FC<ChatAssistantProps> = ({
  activeProject,
  designStudioSceneId,
  designStudioBlueprintId,
  designStudioCadJobId,
  activeFileContent,
  defaultSubagentSlug,
  activeFileName,
  activeFile,
  editorCursorLine,
  editorCursorColumn,
  messages,
  setMessages,
  onFileSelect,
  onRunInTerminal,
  onR2FileUpdated,
  onBrowserNavigate,
  onGlbFileSelect,
  onOpenGitHubIntegration,
  onMobileOpenDashboard,
  onOpenCodeTab,
  onLoadingChange,
  onApprovalRequired,
  agentRunId = null,
  onAgentRunContext,
  onOpenChatHistory,
  onDeleteActiveChat,
  onOpenQuickstart,
  agentsamPolicy = null,
  workspaceId = null,
  syncedHostConversationId,
  agentChatShellTabs,
  activeAgentChatShellTabId,
  onAgentChatShellTabSelect,
  onAgentChatShellTabClose,
  onAgentChatShellNewTab,
  showAgentWorkbenchTabs = true,
  activeWorkbenchTab,
  browserUrl: browserUrlProp,
  openFilePaths,
  activePlanId,
  onActivePlanChange,
  cmsContext = null,
  hostWorkspaceContext = null,
  dashboardRouteKey = null,
  dashboardTaskType = null,
  dashboardRouteLabel = null,
  routeQuickActions = [],
  atmosphericHomeMode = false,
  composerPortalTarget = null,
  messagesPortalTarget = null,
  composerPlaceholder: composerPlaceholderOverride,
  onToggleScratchpad,
  scratchpadOpen: scratchpadOpenProp = false,
  scratchpadFileCount = 0,
  availableConnectors = [],
  availableConnectorsLoading = false,
  onOpenEditor,
}) => {
  const { sessionUserId, workspaceId: ctxWorkspaceId, workspaces, refreshWorkspaces, loadError: workspaceLoadError } =
    useWorkspace();
  const location = useLocation();
  const effectiveWsId = (workspaceId || ctxWorkspaceId || '').trim() || null;
  const agentL2Enabled = Boolean(sessionUserId);
  const {
    models: chatModels,
    loading: chatModelsLoading,
    error: chatModelsError,
    reload: reloadChatModels,
  } = useAgentModels(true);
  const { defaultModelKey } = useAgentDefaultModel(agentL2Enabled);
  const agentsamPolicyRef = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    agentsamPolicyRef.current = agentsamPolicy;
  }, [agentsamPolicy]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamModelKey, setStreamModelKey] = useState<string | null>(null);
  useEffect(() => { onLoadingChange?.(isLoading); }, [isLoading, onLoadingChange]);
  useEffect(() => {
    setChatActivityBusy(isLoading);
    return () => setChatActivityBusy(false);
  }, [isLoading]);
  const [thinkingState, setThinkingState] =
    useState<ThinkingCardState | null>(null);
  const [loadingStartedAt, setLoadingStartedAt] = useState<number | null>(null);
  const [presenceState, setPresenceState] = useState<string>('idle');
  useEffect(() => {
    const browserLane = [
      'browser_live',
      'browser_debug',
      'browser_human_input',
      'browser_capture',
      'browser',
    ].includes(presenceState);
    window.dispatchEvent(
      new CustomEvent('iam-agent-browser-presence', {
        detail: { active: browserLane, state: presenceState },
      }),
    );
  }, [presenceState]);
  const thinkingStartRef = useRef<number>(0);
  const presenceColorwayRef = useRef(pickAgentPresenceColorway());
  const presenceColorwayStyle = useMemo(
    () => agentPresenceColorwayStyle(presenceColorwayRef.current),
    [],
  );
  const readIsDarkTheme = () => document.documentElement.getAttribute('data-theme') !== 'light';
  const [isDarkTheme, setIsDarkTheme] = useState(() =>
    typeof document !== 'undefined' ? readIsDarkTheme() : true,
  );
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setIsDarkTheme(readIsDarkTheme());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  const [input, setInput] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  /** After SSE `done`, ignore duplicate terminal events for this request. */
  const streamFinalizedRef = useRef(false);
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  /** Spine `agentsam_agent_run.id` from SSE context (not command_run approval id). */
  const streamAgentRunIdRef = useRef<string | null>(null);
  const isLoadingRef = useRef(isLoading);
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);
  const [messageQueue, setMessageQueue] = useState<string[]>([]);
  const messageQueueRef = useRef<string[]>([]);
  useEffect(() => {
    messageQueueRef.current = messageQueue;
  }, [messageQueue]);
  const handleSendRef = useRef<
    (override?: string, sendOpts?: ChatRoutingSendOpts) => Promise<void>
  >(async () => {});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerGlassRef = useRef<HTMLDivElement>(null);
  const pendingSubagentSlugRef = useRef<string | null>(null);
  /** Set by "Create an image" chip — next send forces image fast path (skips chat Thompson). */
  const composerActionRef = useRef<string | null>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const modeButtonRef = useRef<HTMLButtonElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const childScrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [localScratchpadOpen, setLocalScratchpadOpen] = useState(false);
  const scratchpadOpen = onToggleScratchpad ? scratchpadOpenProp : localScratchpadOpen;
  const handleToggleScratchpad = useCallback(() => {
    if (onToggleScratchpad) onToggleScratchpad();
    else setLocalScratchpadOpen((v) => !v);
  }, [onToggleScratchpad]);
  const [attachMenuStyle, setAttachMenuStyle] = useState<React.CSSProperties | null>(null);
  const [composerSources, setComposerSources] = useState<ChatComposerSource[]>([]);
  const composerSourcesKey = composerSourcesStorageKey(sessionUserId, effectiveWsId);
  const [modeMenuStyle, setModeMenuStyle] = useState<React.CSSProperties | null>(null);
  const [modelPickerStyle, setModelPickerStyle] = useState<React.CSSProperties | null>(null);
  const [modes] = useState(AGENT_MODES);
  const [mode, setMode] = useState<AgentMode>(() => {
    if (typeof localStorage === 'undefined') return 'agent';
    try {
      const stored = localStorage.getItem(LS_AGENT_CHAT_MODE);
      if (stored && AGENT_MODES.some((m) => m.id === stored)) return stored as AgentMode;
    } catch {
      /* ignore */
    }
    return 'agent';
  });
  const [localActivePlanId, setLocalActivePlanId] = useState<string | null>(null);
  const [isModeOpen, setIsModeOpen] = useState(false);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [composerToast, setComposerToast] = useState<string | null>(null);
  /** Structured BrowserView selection — appended to next Agent Sam message as JSON context. */
  const [browserElementContext, setBrowserElementContext] = useState<Record<string, unknown> | null>(null);
  /** Latest DOM pick — silent attach for Agent Sam (no composer tokens). */
  const pickedElementRef = useRef<Record<string, unknown> | null>(null);
  const designModeContextRef = useRef<{
    design_mode: {
      active: boolean;
      selected_elements: Record<string, unknown>[];
      annotation?: unknown;
    };
    selected_elements: Record<string, unknown>[];
    design_mode_active: boolean;
  } | null>(null);
  const [designModeActiveUi, setDesignModeActiveUi] = useState(false);
  const [designModeChips, setDesignModeChips] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  /** Optional workflow run stream (`agent_universal_autonomous_run` / graph SSE). */
  const [workflowLedger, setWorkflowLedger] = useState<{
    runId: string | null;
    stepsTotal: number | null;
    stepsCompleted: number;
    currentNodeKey: string | null;
    runCost: number | null;
    runTokensIn: number | null;
    runTokensOut: number | null;
    lastError: string | null;
    status?: 'idle' | 'running' | 'completed' | 'failed' | null;
  }>({
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
  const activePlanIdRef = useRef<string | null>(activePlanId?.trim() || null);
  const totalStagedBytes = useMemo(
    () => attachments.reduce((sum, a) => sum + (a.file.size || 0), 0),
    [attachments]
  );
  useEffect(() => {
    if (!composerToast) return;
    const t = window.setTimeout(() => setComposerToast(null), 4500);
    return () => clearTimeout(t);
  }, [composerToast]);
  const [composerDragging, setComposerDragging] = useState(false);
  const composerDragDepthRef = useRef(0);
  const [conversationId, setConversationId] = useState<string>(() =>
    typeof window !== 'undefined'
      ? initialAgentConversationIdFromStorage(
          localStorage.getItem(LS_AGENT_CHAT_CONVERSATION_ID),
          window.location.pathname,
          window.location.search,
        )
      : '',
  );
  const conversationIdRef = useRef(conversationId);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const thinkAgentSam = useThinkAgentSamChat({
    conversationId,
    setConversationId,
    setMessages,
  });
  useEffect(() => {
    setIsLoading(thinkAgentSam.isBusy);
  }, [thinkAgentSam.isBusy]);
  useEffect(() => {
    if (!thinkAgentSam.connectionError) return;
    setComposerToast(
      thinkAgentSam.connectionError.message || 'Agent Sam connection failed.',
    );
  }, [thinkAgentSam.connectionError]);

  const {
    browserSurfaceRef,
    databaseSurfaceRef,
    designStudioSurfaceRef,
    mailSurfaceRef,
    fsChangeScopeRef,
  } = useChatSurfaceContext(conversationId);
  const [threadTitle, setThreadTitle] = useState<string>('');
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(PHONE_MQ).matches
  );
  const resolvedActivePlanId = useMemo(
    () =>
      activePlanId?.trim() ||
      localActivePlanId?.trim() ||
      activePlanIdRef.current?.trim() ||
      null,
    [activePlanId, localActivePlanId],
  );
  useEffect(() => {
    activePlanIdRef.current = resolvedActivePlanId;
  }, [resolvedActivePlanId]);
  const [planSuggestDismissed, setPlanSuggestDismissed] = useState(false);
  const [activePlanTitle, setActivePlanTitle] = useState<string | null>(null);
  const [mobileHubTab, setMobileHubTab] = useState<'agents' | 'automations' | 'dashboard'>('agents');
  const [mobileThreadTab, setMobileThreadTab] = useState<'chat' | 'context'>('chat');
  const [mobileContextFocusId, setMobileContextFocusId] = useState<string | null>(null);
  useEffect(() => {
    setMobileThreadTab('chat');
    setMobileContextFocusId(null);
  }, [conversationId]);
  const [pythonDraftHint, setPythonDraftHint] = useState<string | null>(null);
  const {
    repoDrawerOpen,
    setRepoDrawerOpen,
    contextHubOpen,
    setContextHubOpen,
    contextHubInitialLane,
    setContextHubInitialLane,
    execLane,
    setExecLane,
    githubRepoContext,
    githubContextActive,
    setGithubRepoContext,
    explorerActiveRepo,
    filesSourceContextRef,
    explorerActiveSource,
    explorerActiveSourceRef,
    chatGithubFilePath,
    chatGithubBranch,
    chatGithubFileContent,
    chatGithubContentTruncated,
    chatGithubContentSha,
    runtimeChecks,
    runtimeChecksLoading,
    refreshRuntimeChecks,
    saveGithubRepoSelection,
    openContextHub,
    openRepoPicker,
    handleExecLaneChange,
    clearGithubState,
  } = useChatGithubRuntime({
    sessionUserId,
    effectiveWsId,
    conversationId,
    agentsamPolicy,
    isNarrow,
    workspaces,
    setAttachMenuOpen,
    setIsModeOpen,
    setIsModelPickerOpen,
  });
  const { setQuestionsIntake } = useEditor();
  const lastQuestionsBatchIdRef = useRef<string | null>(null);
  const { clearBrowserElementContext } = useChatDesignModeBridge({
    isNarrow, setBrowserElementContext, setInput, textareaRef, pickedElementRef,
    designModeContextRef, setDesignModeActiveUi, setDesignModeChips, fsChangeScopeRef,
  });
  useEffect(() => {
    if (!agentsamPolicy) return;
    const ar = String(agentsamPolicy.auto_run_mode || '').toLowerCase();
    if (ar === 'disabled' || ar === 'manual') setMode('ask');
    else if (ar === 'allowlist' || ar === 'auto') setMode('agent');
  }, [agentsamPolicy]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(PHONE_MQ);
    const u = () => setIsNarrow(mq.matches);
    mq.addEventListener('change', u);
    return () => mq.removeEventListener('change', u);
  }, []);
  useEffect(() => {
    console.log('[ChatAssistant] canonical mounted agent-app-sse-v1');
  }, []);
  useEffect(() => {
    syncComposerTextareaHeight(
      textareaRef.current,
      isNarrow ? COMPOSER_TEXTAREA_MAX_PX_NARROW : COMPOSER_TEXTAREA_MAX_PX_WIDE,
    );
  }, [isNarrow]);
  const {
    chatProjects,
    sessions,
    sessionsLoading,
    loadSessions,
    setSessions,
    resetFreshChatContext,
    handleNewChat,
  } = useChatSessionProject({
    conversationId,
    setConversationId,
    sessionUserId,
    effectiveWsId,
    composerSourcesKey,
    onAgentChatShellNewTab,
    syncedHostConversationId,
    clearGithubState,
    setAttachments,
    setComposerSources,
    setExecLane,
    setMobileThreadTab,
    setThreadTitle,
    setPythonDraftHint,
  });
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(IAM_AGENT_CHAT_READY));
    return () => {
      window.dispatchEvent(new CustomEvent('iam-agent-chat-unmount'));
    };
  }, []);
  useChatWindowBridge({
    abortControllerRef,
    streamReaderRef,
    setIsLoading,
    setThinkingState,
    setPresenceState,
    streamAgentRunIdRef,
    onAgentRunContext,
    isLoadingRef,
    setMobileThreadTab,
    setThreadTitle,
    setConversationId,
    resetFreshChatContext,
    conversationIdRef,
    onOpenCodeTab,
    handleSendRef,
    setAttachments,
    setPythonDraftHint,
    setInput,
    textareaRef,
    isNarrow,
  });
  const {
    policyWebSearch, activeComposerSourceIds, toggleComposerSource, sourceFromConnector,
    startWebSearchLane, startImageGenerationPrompt, startDeepResearchPrompt, removeComposerSource,
  } = useChatComposerSources({
    composerSourcesKey, composerSources, setComposerSources, agentsamPolicy,
    mode, setMode, setInput, textareaRef, composerActionRef,
  });
  const scrollToPendingApproval = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, []);
  const [toolTraceRows, setToolTraceRows] = useState<AgentToolTraceRow[]>([]);
  const {
    draftSyntaxBusy, draftRunBusy, handlePythonDraftOpened,
    handleDraftSyntaxCheck, handleDraftRunScript,
  } = useChatDraftActions({
    activeFile, activeFileName, setToolTraceRows, setPythonDraftHint,
  });
  const activePlanRunningCount = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'assistant' || !m.executionPlan?.tasks?.length) continue;
      return m.executionPlan.tasks.filter((t) => t.status === 'running').length;
    }
    return 0;
  }, [messages]);
  const stripEmptyAssistantTail = useCallback((prev: Message[]) => {
    const next = [...prev];
    const last = next[next.length - 1];
    if (last?.role === 'assistant' && last.content === '') next.pop();
    return next;
  }, []);
  const handleStreamModel = useCallback((modelKey: string | null) => {
    setStreamModelKey(modelKey?.trim() || null);
  }, []);
  const {
    activeSubagents,
    setActiveSubagents,
    splitChild,
    setSplitChild,
    splitChildMessages,
    setSplitChildMessages,
    focusedPane,
    setFocusedPane,
    splitRatio,
    setSplitRatio,
    openBeside,
    handleSubagentEvent,
    handleStopSubagent,
  } = useSubagentSplitPane({
    conversationId,
    isNarrow,
    isLoading,
    abortControllerRef,
    streamReaderRef,
    setIsLoading,
  });
  const { handleThinkingEvent } = useChatThinkingEvents({
    setPresenceState,
    setThinkingState,
    activePlanIdRef,
    setLocalActivePlanId,
    setActivePlanTitle,
    onActivePlanChange,
    onApprovalRequired,
  });
  const {
    pendingToolApproval,
    setPendingToolApproval,
    approvalBusy,
    handleApprovePendingTool,
    handleDenyPendingTool,
  } = useToolApprovalActions({
    conversationId,
    messages,
    setMessages,
    setIsLoading,
    setPresenceState,
    setWorkflowLedger,
    setToolTraceRows,
    setConversationId,
    setMessageQueue,
    abortControllerRef,
    streamFinalizedRef,
    streamReaderRef,
    messageQueueRef,
    handleSendRef,
    stripEmptyAssistantTail,
    loadSessions,
    handlePythonDraftOpened,
    handleThinkingEvent,
    handleSubagentEvent,
    handleStreamModel,
    onBrowserNavigate,
    onR2FileUpdated,
    onFileSelect,
    onAgentRunContext,
    agentRunId,
  });
  const {
    runPlanBusy,
    savePlanBusy,
    planIntakeBusy,
    handlePlanIntakeSubmit,
    handleRunPlan,
    handleSavePlanWorkspace,
  } = usePlanRunActions({
    conversationId,
    messages,
    setMessages,
    setIsLoading,
    setPresenceState,
    setThinkingState,
    setWorkflowLedger,
    setToolTraceRows,
    setConversationId,
    setPendingToolApproval,
    setLocalActivePlanId,
    activePlanIdRef,
    abortControllerRef,
    streamFinalizedRef,
    streamReaderRef,
    lastQuestionsBatchIdRef,
    stripEmptyAssistantTail,
    loadSessions,
    handlePythonDraftOpened,
    handleThinkingEvent,
    handleSubagentEvent,
    handleStreamModel,
    setQuestionsIntake,
    onFileSelect,
    onBrowserNavigate,
    onR2FileUpdated,
    onAgentRunContext,
    onActivePlanChange,
  });
  const { presence } = useAgentPresence({
    isLoading,
    mode,
    thinkingState,
    pendingToolApproval,
    approvalBusy,
    toolTraceRows,
    workflowLedger,
    draftSyntaxBusy,
    draftRunBusy,
    subagentWork: activeSubagents[0]
      ? {
          state: mapSubagentRowToPresenceState(activeSubagents[0].state),
          detail: activeSubagents[0].label,
        }
      : null,
    activePlanRunningCount,
  });
  const { runningToolName, heroThinking } = useChatPresenceDerived({
    isLoading, toolTraceRows, presence, setLoadingStartedAt, setWorkflowLedger,
    thinkingState, loadingStartedAt, pendingToolApproval,
  });
  const {
    selectedModelKey, setSelectedModelKey, selectedModelKeyRef, userPinnedModelRef,
    displayRunModel, composerTurnSummary,
  } = useChatModelSelection({
    chatModels, isLoading, messageQueueRef, setMessageQueue, handleSendRef, toolTraceRows, streamModelKey,
  });
  // Keep last resolved Auto model for the run chip afterglow (do not clear on stream end).
  const {
    mentionOpen, setMentionOpen, mentionItems, mentionIndex, setMentionIndex, mentionStyle, mentionMenuRef,
    slashOpen, setSlashOpen, slashItems, slashIndex, setSlashIndex, slashStyle, slashMenuRef,
    syncPickers, applyMention, applySlash, insertAtCursor,
  } = useChatComposerPickers({
    input, setInput, textareaRef, isNarrow, agentsamPolicyRef, conversationId,
    agentRunId, workspaceId, messages, setMessages, setMode, setPlanSuggestDismissed,
    onApprovalRequired,
  });
  useChatComposerMenus({
    attachMenuOpen, setAttachMenuOpen, setAttachMenuStyle,
    isModeOpen, setIsModeOpen, setModeMenuStyle,
    isModelPickerOpen, setIsModelPickerOpen, setModelPickerStyle,
    composerGlassRef, modeButtonRef, modeMenuRef, modelButtonRef, modelPickerRef,
    attachButtonRef, attachMenuRef,
  });
  const { modeLabel, modelPickerLabel, modeIcon } = useChatModeChrome({
    mode, modes, selectedModelKey, chatModels,
  });
  const {
    displayMessages, effectiveThinking, showInlinePresence, showHeaderPresence,
    showEmptyThreadPlaceholder, mobileAgentHomeMode, activeSessionRow, showThreadHeader,
  } = useChatThreadDisplay({
    messages, thinkingState, heroThinking, isLoading, pendingToolApproval, isNarrow,
    presence, mobileHubTab, mobileThreadTab, conversationId, sessions,
  });
  const {
    openAgentGeneratedFile, renderThreadHeader, shellTabsVisible, renderShellTabStrip,
  } = useChatThreadChrome({
    onFileSelect, showThreadHeader, conversationId, threadTitle, activeSessionRow, chatProjects,
    setThreadTitle, loadSessions, onDeleteActiveChat, handleNewChat, handleToggleScratchpad,
    scratchpadOpen, scratchpadFileCount, isNarrow, onOpenCodeTab, setAttachMenuOpen, textareaRef,
    displayMessages, attachments, showAgentWorkbenchTabs, onAgentChatShellNewTab, agentChatShellTabs,
    activeAgentChatShellTabId, onAgentChatShellTabSelect, onAgentChatShellTabClose,
  });
  const { handleInputChange } = useChatComposerInput({
    conversationId, sessions, setThreadTitle, scrollRef, displayMessages,
    setInput, isNarrow, syncPickers,
  });
  const { handleComposerPaste, addFilesFromList, removeAttachment, clearAttachments } = useChatAttachments({
    input, setAttachments, insertAtCursor, setComposerToast,
  });
  const {
    appendSpeechToInput, appendVoiceUserToThread, appendVoiceAssistantToThread, onVoiceToolResult,
    speakAssistantText,
  } = useChatVoiceThread({ setInput, setMessages, textareaRef, isNarrow });
  const handleChatImagePreview = createChatImagePreviewHandler({ onFileSelect, onOpenCodeTab });
  const handleSend = useCallback(
    async (overrideMessage?: string, sendOpts?: ChatRoutingSendOpts) => {
      if (isLoading && !overrideMessage) return;
      const rawText = String(overrideMessage ?? input).trim();
      const files = attachments.map((attachment) => attachment.file);
      if (!rawText && !files.length) return;

      let text = rawText;
      const explicitPlan = sendOpts?.force_plan_mode === true || isPlanSlashMessage(rawText);
      if (explicitPlan) {
        const request = rawText.replace(/^\/plan\b\s*/i, '').trim();
        text = `Plan this request first. Do not make code or production changes unless I explicitly ask you to proceed.\n\n${request}`.trim();
      } else if (mode === 'ask') {
        text = `Answer or investigate this without making changes unless I explicitly ask you to act.\n\n${rawText}`.trim();
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
      setMentionOpen(false);
      setSlashOpen(false);
      setLoadingStartedAt(Date.now());
      setThinkingState({
        steps: [],
        thinkingText: thinkAgentSam.isRecovering ? 'Recovering…' : 'Thinking…',
        status: 'thinking',
        startedAt: Date.now(),
        surface: null,
      });
      setPresenceState('thinking');
      setIsLoading(true);
      requestAnimationFrame(() => {
        syncComposerTextareaHeight(
          textareaRef.current,
          isNarrow ? COMPOSER_TEXTAREA_MAX_PX_NARROW : COMPOSER_TEXTAREA_MAX_PX_WIDE,
        );
      });

      try {
        await thinkAgentSam.send(text || '(attachment)', files);
        clearAttachments();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'Agent Sam send failed.');
        setComposerToast(message);
        setIsLoading(false);
        setThinkingState(null);
        setPresenceState('idle');
      }
    },
    [
      attachments,
      clearAttachments,
      input,
      isLoading,
      isNarrow,
      mode,
      setPendingToolApproval,
      setPresenceState,
      setThinkingState,
      thinkAgentSam,
    ],
  );
  const handleVoiceTurn = useCallback(
    (text: string) => handleSend(text, { voiceTurn: true }),
    [handleSend],
  );
  handleSendRef.current = handleSend;
  const canSend =
    (input.trim().length > 0 || attachments.length > 0) &&
    !isLoading &&
    totalStagedBytes <= 15 * 1024 * 1024;
  const onKeyDown = createChatComposerKeyDown({
    mentionOpen, mentionItems, mentionIndex, setMentionIndex, applyMention, setMentionOpen,
    slashOpen, slashItems, slashIndex, setSlashIndex, applySlash, setSlashOpen,
    setMode, setIsModeOpen, agentsamPolicyRef, isLoading, setMessageQueue, input, setInput, handleSend,
  });
  const {
    mobileAgentsThread, mobileActiveAgentThread, showMobileHubNav, messagesVisible,
    contextTabVisible, composerVisible, composerPortaled, centerChatComposerColumn,
    desktopStartupCenterMode, designStudioPortalStartup, entryPortalStartup,
    hideOverlayMessagesForPortalStartup, composerFlexOrder, showMobileRepoConnector,
    mobileRepoConnectorLabel, messagesPortaled, composerPlaceholder,
  } = deriveChatLayoutFlags({
    isNarrow, mobileHubTab, mobileThreadTab, conversationId, mobileAgentHomeMode,
    showEmptyThreadPlaceholder, atmosphericHomeMode, composerPortalTarget, messagesPortalTarget,
    locationPathname: location.pathname, locationSearch: location.search, mode,
    composerPlaceholderOverride, githubRepoContext, githubContextActive, chatGithubFilePath,
  });
  const {
    modelPickerGroups, modelPickerByokHint, pickModelKey, composerPillClass, renderModelPickerList,
  } = useChatModelPickerControls({
    chatModels, selectedModelKey, setSelectedModelKey, selectedModelKeyRef, userPinnedModelRef,
    setIsModelPickerOpen, setAttachMenuOpen, defaultModelKey, chatModelsLoading, chatModelsError,
    reloadChatModels,
  });
  const chatAssistantViewModel = {
    abortControllerRef, activeComposerSourceIds, activeFile, activePlanTitle, activeSubagents, addFilesFromList, agentRunId, appendSpeechToInput,
    appendVoiceAssistantToThread, appendVoiceUserToThread, applyMention, applySlash, approvalBusy, atmosphericHomeMode, attachButtonRef, attachMenuOpen,
    attachMenuRef, attachMenuStyle, attachments, availableConnectors, availableConnectorsLoading, browserElementContext, canSend,
    centerChatComposerColumn, chatGithubFilePath, childScrollRef, clearBrowserElementContext, composerDragDepthRef, composerDragging, composerFlexOrder, composerGlassRef,
    composerPillClass, composerPlaceholder, composerPortalTarget, composerPortaled, composerSources, composerToast, composerTurnSummary, composerVisible,
    contextHubInitialLane, contextHubOpen, contextTabVisible, conversationId, designModeActiveUi, designModeChips,
    desktopStartupCenterMode, displayMessages, displayRunModel, draftRunBusy, draftSyntaxBusy, effectiveThinking, effectiveWsId, entryPortalStartup,
    execLane, fileInputRef, focusedPane, githubRepoContext, githubContextActive, clearGithubState, handleApprovePendingTool, handleChatImagePreview,
    handleComposerPaste, handleDenyPendingTool, handleDraftRunScript, handleDraftSyntaxCheck, handleExecLaneChange, handleInputChange, handlePlanIntakeSubmit, handleRunPlan,
    handleSavePlanWorkspace, handleSend, handleSendRef, handleStopSubagent, handleToggleScratchpad, hideOverlayMessagesForPortalStartup, imageInputRef, input,
    isDarkTheme, isLoading, isModeOpen, isModelPickerOpen, isNarrow, location,
    mentionIndex, mentionItems, mentionMenuRef, mentionOpen, mentionStyle, messageQueue, messages, messagesPortalTarget, messagesPortaled,
    messagesVisible, mobileAgentHomeMode, mobileAgentsThread, mobileContextFocusId, mobileHubTab, mobileRepoConnectorLabel, mobileThreadTab, mode,
    modeButtonRef, modeIcon, modeLabel, modeMenuRef, modeMenuStyle, modelButtonRef, modelPickerLabel, modelPickerRef, modelPickerStyle, modes,
    onAgentRunContext, onFileSelect, onKeyDown, onOpenCodeTab, onOpenEditor, onOpenGitHubIntegration, onOpenQuickstart, onRunInTerminal,
    onVoiceTurn: handleVoiceTurn, onVoiceToolResult, openAgentGeneratedFile, openBeside, openContextHub, openRepoPicker, pendingToolApproval, pickModelKey, planIntakeBusy,
    planSuggestDismissed, policyWebSearch, presence, presenceColorwayStyle, pythonDraftHint, refreshRuntimeChecks, removeAttachment,
    removeComposerSource, renderModelPickerList, renderShellTabStrip, renderThreadHeader, repoDrawerOpen, resolvedActivePlanId,
    runPlanBusy, runtimeChecks, runtimeChecksLoading, saveGithubRepoSelection, savePlanBusy, scratchpadOpen, scrollRef, selectedModelKey,
    sessions, sessionsLoading, setAttachMenuOpen, setComposerDragging, setContextHubOpen, setFocusedPane, setInput, setIsLoading,
    setIsModeOpen, setIsModelPickerOpen, setMentionIndex, setMessages, setMobileContextFocusId, setMobileHubTab, setMobileThreadTab, setMode,
    setPlanSuggestDismissed, setPresenceState, setRepoDrawerOpen, setSlashIndex, setSplitChild, setSplitChildMessages, setSplitRatio, setThinkingState, setToolTraceRows, setWorkflowLedger, shellTabsVisible,
    showEmptyThreadPlaceholder, showHeaderPresence, showInlinePresence, showMobileHubNav, showMobileRepoConnector, showThreadHeader, slashIndex, slashItems,
    slashMenuRef, slashOpen, slashStyle, sourceFromConnector, splitChild, splitChildMessages, splitRatio,
    startDeepResearchPrompt, startImageGenerationPrompt, startWebSearchLane, streamAgentRunIdRef, streamFinalizedRef, streamReaderRef, syncPickers,
    textareaRef, thinkingState, toggleComposerSource, toolTraceRows, totalStagedBytes, workflowLedger, workspaceId,
    workspaces,
  };
  return <ChatAssistantView v={chatAssistantViewModel} />;
};
export {
  normalizeAssistantSseText, looksLikeRawProviderLeak, ssePayloadLooksReasoningOnly,
  isStreamErrorPayload, extractMonacoInvokesFromBuffer, hideIncompleteMonacoInvokeTail,
  looksLikeEmbeddedFileDumpStart, formatHttpErrorMessage,
} from './streamParsing';
