/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import type { ActiveFile, ProjectType } from '../../types';
import type { AgentWorkspaceContextPacket } from '../../src/ideWorkspace';
import {
  LS_AGENT_CHAT_MODEL_KEY,
  LS_AGENT_CHAT_MODE,
  LS_GH_REPO,
} from '../../src/lib/sessionStorageKeys';

export {
  LS_AGENT_CHAT_MODEL_KEY,
  LS_AGENT_CHAT_MODE,
  LS_GH_REPO,
} from '../../src/lib/sessionStorageKeys';

export type MessageAttachmentPreview = {
  previewUrl: string | null;
  type: 'image' | 'file';
  name: string;
};

/** Excalidraw plan map artifact from planner or POST /api/agentsam/plans. */
export type ImplementationPlanVisualMap = {
  artifact_id: string;
  r2_key?: string;
  public_url: string;
};

/** Canonical Markdown plan export (R2 + agentsam_artifacts). */
export type ImplementationPlanMarkdown = {
  artifact_id: string;
  r2_key?: string;
  public_url: string;
};

export type ImplementationPlanChip = {
  plan_id: string;
  plan_title?: string;
  visual_map?: ImplementationPlanVisualMap | null;
  plan_markdown?: ImplementationPlanMarkdown | null;
};

export type ExecutionPlanTaskStatus = 'todo' | 'running' | 'done' | 'failed' | 'skipped' | 'blocked';

export type ExecutionPlanTask = {
  id: string;
  title: string;
  order_index: number;
  status: ExecutionPlanTaskStatus;
  parent_task_id?: string | null;
  handler_type?: string | null;
  /** Collapsed-by-default task output or error snippet. */
  detail?: string;
  trace?: {
    execution_step_id?: string | null;
    command_run_id?: string | null;
    workflow_run_id?: string | null;
    capability_type?: string | null;
    handler_key?: string | null;
    files_involved?: string[];
  };
};

export type ExecutionPlanState = {
  plan_id: string;
  plan_title: string;
  status: 'planning' | 'ready' | 'running' | 'complete' | 'partial' | 'failed';
  tasks: ExecutionPlanTask[];
  workflow_run_id?: string | null;
  tasks_completed?: number;
  tasks_failed?: number;
  tasks_skipped?: number;
};

/** Future: Worker SSE `artifact_preview` payloads merged into the assistant bubble (images, query results). */
export type AgentPreviewArtifactKind = 'sql' | 'diff' | 'code' | 'image' | 'table';

export type AgentPreviewArtifact = {
  id: string;
  kind: AgentPreviewArtifactKind;
  title?: string;
  /** Code / SQL / diff — for diffs this is the "after" content */
  content?: string;
  language?: string;
  /** Image URL (https or data:) */
  imageUrl?: string;
  /** Monaco diff viewer — original file content (SSE `code_diff.before`) */
  before?: string;
  /** Repo-relative or virtual path (SSE `code_diff.path`) */
  path?: string;
};

export type ImageGenerationPhase =
  | 'idle'
  | 'initializing'
  | 'generating'
  | 'refining'
  | 'completed'
  | 'failed';

export type ImageGenerationPreviewFrame = {
  frameIndex: number;
  /** Empty while the slot is still initializing / progressing. */
  previewUrl?: string;
  /** Per-variation draft id when fan-out emits distinct generation_ids. */
  generationId?: string;
  phase?: ImageGenerationPhase;
  progress?: number;
  message?: string;
  failed?: boolean;
};

/** Progressive image generation card state (SSE `image_generation_*`). */
export type ImageGenerationState = {
  generationId: string;
  phase: ImageGenerationPhase;
  provider?: string;
  model?: string;
  prompt?: string;
  width?: number;
  height?: number;
  progress: number;
  stage?: string;
  message: string;
  previewFrames: ImageGenerationPreviewFrame[];
  activeFrameIndex: number;
  /** When >1, UI reserves this many progressive slots immediately. */
  variationCount?: number;
  imageUrl?: string;
  previewUrl?: string;
  /** draft | saved — API-enforced lifecycle */
  status?: 'draft' | 'saved' | 'discarded';
  expiresAt?: string;
  persist?: boolean;
  committedUrl?: string;
  r2Key?: string;
  artifactId?: string;
  failed?: boolean;
  /** Learning key: draft_mockup | standard_render | presentation_quality */
  contentTier?: string;
  costUsd?: number;
  userRating?: 1 | -1 | null;
};

/** Progressive Veo video generation card (poll `/api/moviemode/veo-jobs/:id`). */
export type VideoGenerationPhase = 'queued' | 'generating' | 'completed' | 'failed';

export type VideoGenerationState = {
  jobId: string;
  phase: VideoGenerationPhase;
  progress: number;
  message: string;
  prompt?: string;
  model?: string;
  destination?: 'local' | 'stream';
  /** Local artifact URL (default delivery). */
  publicUrl?: string;
  playableUrl?: string;
  watchUrl?: string;
  hls?: string;
  streamUid?: string;
  artifactId?: string;
  assetId?: string;
  status?: 'draft' | 'saved';
  failed?: boolean;
};

export interface EmailArtifact {
  subject: string;
  body: string;
  to?: string;
  from?: string;
}

/** Inline agent question in thread (SSE needs_input / agent_question). */
export type AgentQuestionPayload = {
  question: string;
  options?: string[];
  questionId?: string;
};

export type PlanQuestionChoice = {
  key: string;
  label: string;
};

export type PlanIntakeQuestion = {
  id: string;
  question: string;
  choices: PlanQuestionChoice[];
  /** When true, the Questions UI allows selecting more than one choice. */
  multi_select?: boolean;
};

/** Cursor-style batched plan questions (Continue / Skip). */
export type PlanQuestionsBatchPayload = {
  batch_id: string;
  phase: 'pre_plan' | 'mid_plan' | 'roadblock';
  plan_id?: string | null;
  explore_summary?: {
    synthesis?: string;
    files_searched?: number;
    searches?: number;
  };
  questions: PlanIntakeQuestion[];
  allow_skip?: boolean;
  submitted?: boolean;
};

/** Plan proposal awaiting user confirmation (SSE plan_confirmation_required). */
export type PlanConfirmationPayload = {
  plan_id: string;
  approval_id: string;
  plan_title?: string;
  message?: string;
  tasks?: Array<{ title: string; order_index: number }>;
};

/** Active subagent row in multitask/plan fanout. */
export type ActiveSubagentRow = {
  id: string;
  slug: string;
  label: string;
  /** SSE activity slug — mapped to AgentPresenceState at the presence hook. */
  state: string;
  conversationId?: string | null;
  startedAt: number;
  stepCount?: number;
  /** Brief done linger before strip clears. */
  cardStatus?: 'running' | 'done' | 'failed' | 'approval_required';
};

export type SubagentAttribution = {
  runId: string;
  slug: string;
  label: string;
  conversationId?: string | null;
  status: 'finished' | 'failed' | 'action_required';
};

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** Durable cyan From/Finished links for subagent results (not plain text dumps). */
  subagentAttributions?: SubagentAttribution[];
  /** Blob URLs kept after send so image previews stay visible in history (not revoked with composer clear). */
  attachmentPreviews?: MessageAttachmentPreview[];
  /** When Agent Sam emits `plan_created` with a saved plan map artifact. */
  implementationPlan?: ImplementationPlanChip | null;
  /** Live plan checklist from plan_* / task_* SSE (compact UI; verbose fields in task.trace). */
  executionPlan?: ExecutionPlanState | null;
  /** Reserved for structured previews from the Worker (optional; fences use `AgentCodeFencePreview` today). */
  previewArtifacts?: AgentPreviewArtifact[];
  /** Cinematic progressive image generation (SSE `image_generation_*`). */
  imageGenerationState?: ImageGenerationState | null;
  /** Veo video generation (queued → local playable; optional Stream Save). */
  videoGenerationState?: VideoGenerationState | null;
  /** Email draft artifact from Agent Sam email composition (SSE `email_draft`). */
  emailArtifact?: EmailArtifact | null;
  /** Agent question rendered inline in thread. */
  agentQuestion?: AgentQuestionPayload | null;
  /** Batched plan intake questions (Continue / Skip). */
  planQuestionsBatch?: PlanQuestionsBatchPayload | null;
  /** Plan proposal bubble — View Plan / Build → */
  planConfirmation?: PlanConfirmationPayload | null;
  /** Agent-generated files from monaco_file_generated / RWS pipeline output (shown in files panel). */
  agentFiles?: AgentGeneratedFile[];
  /** Completed tool timeline for this assistant turn (survives a later retry). */
  toolTraces?: import('./execution/types').AgentToolTraceRow[];
}

export type AgentGeneratedFile = {
  /** Display name, e.g. rws-summary.md */
  filename: string;
  /** R2 public URL to fetch content on demand */
  r2Url?: string;
  /** Inline content when small enough to embed */
  content?: string;
  /** Virtual Monaco workspace path */
  workspacePath?: string;
  /** File kind for icon selection */
  kind: 'md' | 'sql' | 'ts' | 'js' | 'txt' | 'json' | 'image' | 'other';
  /** Provisional R2 staging (agentsam_stage_file) — not shipped to github/fsa/sandbox */
  staged?: boolean;
  /** Same path overwritten in this conversation */
  stagedUpdated?: boolean;
  stagedRef?: {
    bucket: string;
    key: string;
    etag: string | null;
    path: string;
  };
};

/** Host-managed chat tab strip (e.g. App.tsx multi-session). */
export type AgentChatShellTab = { id: string; title: string };

export type { AgentWorkspaceContextPacket };

export interface ChatAssistantProps {
  activeProject: ProjectType;
  /** Design Studio linkage when on /dashboard/designstudio */
  designStudioSceneId?: string | null;
  designStudioBlueprintId?: string | null;
  designStudioCadJobId?: string | null;
  activeFileContent?: string;
  /** Surface-level default subagent slug — pinned on every message from this surface. */
  defaultSubagentSlug?: string;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onFileSelect?: (file: Pick<ActiveFile, 'name' | 'content'> & Partial<ActiveFile> & { workspacePath?: string }) => void;
  onRunInTerminal?: (cmd: string) => void;
  activeFileName?: string;
  /** Full open-file metadata so @file / @monaco can include tool routing (r2_read, r2_write, github_file). */
  activeFile?: ActiveFile | null;
  /** Current editor cursor (for @monaco injection only). */
  editorCursorLine?: number;
  editorCursorColumn?: number;
  /** SSE: agent tool `r2_write` emits `r2_file_updated` for Monaco sync */
  onR2FileUpdated?: (event: { type: 'r2_file_updated'; bucket: string; key: string }) => void;
  /** SSE: `browser_navigate` / `surface_open` opens the Browser tab (Agent Live when agent_run_id is active). */
  onBrowserNavigate?: (event: {
    type: 'browser_navigate';
    url: string;
    /** When true, BrowserView opens Browser Run Live View (shared agent session). */
    agent_live?: boolean;
    /** When true without agent_live, BrowserView may show MYBROWSER screenshot preview. */
    automation?: boolean;
    screenshot_url?: string;
    page_text?: string;
    title?: string;
  }) => void;
  /** Dropped or attached .glb: parent uses a blob URL and should open the Voxel (engine) tab. */
  onGlbFileSelect?: (file: File) => void;
  /** Mobile: open GitHub repos panel (`actions` activity); optional repo to expand. */
  onOpenGitHubIntegration?: (opts?: { expandRepoFullName?: string }) => void;
  /** Mobile: leave full-screen chat and show the main editor / welcome workspace. */
  onMobileOpenDashboard?: () => void;
  /** Open the code editor tab from chat (e.g. mobile Context tab). */
  onOpenCodeTab?: () => void;
  /** Open the Search sidebar (knowledge + chat history). */
  onOpenChatHistory?: () => void;
  /** When the active thread is deleted from chat header menu. */
  onDeleteActiveChat?: (conversationId: string) => void;
  /** Mobile agent home: Quickstart chip → /dashboard/agent/quickstart. */
  onOpenQuickstart?: () => void;
  /** `agentsam_user_policy` row fields for the active workspace (from App bootstrap). */
  agentsamPolicy?: Record<string, unknown> | null;
  /** IAM workspace id (`auth_users.active_workspace_id` / settings) — scopes approval polling and APIs. */
  workspaceId?: string | null;
  /** Mirror active tab's server conversation id when the host switches chat tabs (empty = unsaved thread). */
  syncedHostConversationId?: string;
  /** Optional horizontal tab strip above chat (Cursor-style parallel threads). */
  agentChatShellTabs?: AgentChatShellTab[];
  activeAgentChatShellTabId?: string | null;
  onAgentChatShellTabSelect?: (tabId: string) => void;
  /** Close a chat tab (host removes tab + switches neighbor). */
  onAgentChatShellTabClose?: (tabId: string) => void;
  /** Open a parallel chat tab (host allocates tab + messages slot). */
  onAgentChatShellNewTab?: () => void;
  /** When false, hide workbench tab strip (center chat home uses thread header only). */
  showAgentWorkbenchTabs?: boolean;
  /** Parent mirrors streaming state (approval polling). */
  onLoadingChange?: (loading: boolean) => void;
  /** SSE surfaced a command_run awaiting approval. */
  onApprovalRequired?: (commandRunId: string) => void;
  /** Active agentsam_command_run id for approval queue scoping. */
  agentRunId?: string | null;
  /** SSE `context.agent_run_id` (`agentsam_agent_run.id`) for run-spine linkage (e.g. BrowserView screenshots). */
  onAgentRunContext?: (agentRunId: string | null) => void;
  /** Active workbench tab (Workspace, code, browser, …). */
  activeWorkbenchTab?: string;
  /** Browser panel URL when host controls navigation. */
  browserUrl?: string | null;
  /** Labels/paths for open editor files (Monaco tabs). */
  openFilePaths?: string[];
  /** Active plan id from workspace dashboard when known. */
  activePlanId?: string | null;
  /** Notify host when chat creates or selects a plan. */
  onActivePlanChange?: (planId: string | null) => void;
  hostWorkspaceContext?: Partial<import('../../src/ideWorkspace').AgentWorkspaceContextPacket> | null;
  /** CMS route context (project_slug, page_id, KV/DO keys) — available on agent + CMS routes. */
  cmsContext?: AgentWorkspaceContextPacket | null;
  /** Route-aware default route_key from dashboard surface. */
  dashboardRouteKey?: string | null;
  /** Route-aware default task_type — when set, classifier is skipped for this turn. */
  dashboardTaskType?: string | null;
  /** Human label for active dashboard route context. */
  dashboardRouteLabel?: string | null;
  /** Per-route quick actions (Fuel admin pattern). */
  routeQuickActions?: Array<{
    id: string;
    label: string;
    message: string;
    route_key?: string;
    task_type?: string;
  }>;
  /** Desktop /dashboard/agent home: portal frosted composer into center host. */
  atmosphericHomeMode?: boolean;
  composerPortalTarget?: HTMLElement | null;
  /** Desktop /dashboard/agent home: portal message thread above center composer. */
  messagesPortalTarget?: HTMLElement | null;
  /** Override default composer placeholder text. */
  composerPlaceholder?: string;
  /** Host-owned scratchpad rail toggle (desktop sidebar). */
  onToggleScratchpad?: () => void;
  scratchpadOpen?: boolean;
  /** File count badge for the scratchpad chip (host Files panel). */
  scratchpadFileCount?: number;
  /** OAuth/MCP rows from GET /api/integrations/connectors/catalog — App-owned, no fetch in sheet. */
  availableConnectors?: import('../../src/hooks/useAvailableConnectors').ComposerAvailableConnector[];
  availableConnectorsLoading?: boolean;
  /** Open /dashboard/agent/editor + files explorer (CodeXml chip / startup action). */
  onOpenEditor?: () => void;
}

const CHAT_IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;

export type StagedAttachment = {
  id: string;
  file: File;
  type: 'image' | 'file';
  previewUrl: string | null;
  /** Worker SESSION_CACHE / R2 stage id for agentsam_r2_put (att_*). */
  agentAttachmentId?: string | null;
  stageStatus?: 'pending' | 'ready' | 'error';
  stageError?: string | null;
};

/** POST raw bytes → att_* for tool-side r2_put (parallel to vision multipart on send). */
export async function stageFileForAgentTools(file: File): Promise<{
  ok: boolean;
  attachment_id?: string;
  error?: string;
}> {
  try {
    const form = new FormData();
    form.append('file', file, file.name || 'upload.bin');
    const res = await fetch('/api/agent/attachments', {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      attachment_id?: string;
      error?: string;
    };
    if (!res.ok || !data?.ok || !data.attachment_id) {
      return { ok: false, error: data?.error || `stage_http_${res.status}` };
    }
    return { ok: true, attachment_id: String(data.attachment_id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'stage_failed' };
  }
}

export function isImageAttachmentFile(file: File): boolean {
  const type = String(file.type || '').trim();
  if (type.startsWith('image/')) return true;
  return CHAT_IMAGE_EXT_RE.test(String(file.name || '').toLowerCase());
}

/** Ensure multipart upload has real bytes (preview blob is authoritative when File.size is 0). */
export async function resolveAttachmentFileForUpload(
  attachment: StagedAttachment,
): Promise<File> {
  const { file, previewUrl, type } = attachment;
  if (file.size > 0) return file;
  if (type === 'image' && previewUrl) {
    const res = await fetch(previewUrl);
    const blob = await res.blob();
    const mime =
      String(blob.type || file.type || '').trim() ||
      (String(file.name || '').toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
    const name = file.name?.trim() || `image-${Date.now()}.png`;
    return new File([blob], name, { type: mime });
  }
  return file;
}

export type PickerItem = { id: string; label: string; kind: string };
export type SlashCmd = { id?: string; slug: string; description: string | null };

export type ToolApprovalPayload = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  preview?: string;
  /** agentsam_approval_queue id — PATCH /api/agent/approval/:id after Allow. */
  approval_id?: string;
  proposal_id?: string;
  risk_level?: 'low' | 'medium' | 'high' | 'critical' | string;
  server_display_name?: string;
  /** Terminal connection_resolution from worker (e.g. superadmin_operator_workspace). */
  connection_resolution?: string;
  /** Plan-task terminal gate: Allow → approve queue → POST /api/agent/plan-task/resume (SSE). */
  plan_terminal?: {
    plan_id: string;
    task_id: string;
    command_run_id?: string;
    approval_id: string;
  };
};

export type ChatModelRow = {
  id: string;
  name: string;
  provider: string;
  model_key: string;
  api_platform: string;
  /** Catalog-synthesized picker section (`agentsam_model_catalog`); falls back to `provider`. */
  picker_group?: string;
  size_class?: string;
  input_rate_per_mtok?: number | null;
  output_rate_per_mtok?: number | null;
  byok_configured?: boolean;
  byok_masked?: string | null;
  billing_key_source?: 'byok' | 'platform' | string;
};

/**
 * Separator injected between the user's visible message and silent context blocks.
 * The suppression instruction is critical — without it the model treats the injected
 * blocks as conversation content and echoes or comments on them in its reply.
 */
export const MENTION_CONTEXT_HEADER =
  '\n\n--- On-demand context (this message only) ---\n' +
  'IMPORTANT: Do not repeat, reference, summarize, or acknowledge the blocks below. ' +
  'Use them silently as reference only. Begin your reply to the user message above directly.\n';

export const MENTION_FILE_MAX_CHARS = 8000;
export const MENTION_R2_LIST_MAX_ROWS = 250;
/** Worker request body cap (inform UI); combined files rejected above CHAT_ATTACH_MAX_TOTAL_BYTES in worker.js */
export const CHAT_REQUEST_MAX_BYTES = 100 * 1024 * 1024;
export const CHAT_ATTACH_MAX_TOTAL_BYTES = 90 * 1024 * 1024;

export type ChatImageHandlingMode = 'ephemeral_vision' | 'temporary_context' | 'persisted_asset';

/** Default: analyze-only — no R2/D1 write on attach. */
export function resolveComposerImageHandlingMode(message: string): ChatImageHandlingMode {
  const msg = String(message || '').trim();
  if (
    /\b(save this|save to (the )?project|add to project|use as (the )?hero|add this to (the )?cms|store this as|attach this to|make this reusable|store as (a )?reference|use as asset)\b/i.test(
      msg,
    )
  ) {
    return 'persisted_asset';
  }
  if (
    /\b(compare this image|keep this screenshot|use this as reference|reference for the next|keep (this|it) in context while)\b/i.test(
      msg,
    )
  ) {
    return 'temporary_context';
  }
  return 'ephemeral_vision';
}

/**
 * Phone composer clearance — home-indicator safe area + small lip.
 * (Legacy fixed mobile tab bar was removed; do not reintroduce ~56px ghost pad.)
 */
export const MOBILE_CHAT_COMPOSER_BOTTOM_PAD =
  'calc(env(safe-area-inset-bottom, 0px) + 12px)';

/**
 * Phone `/dashboard/agent` empty-home scroll body — home-indicator only.
 * (AgentMobileHomePanel owns chrome; composer sits above the session list.)
 */
export const MOBILE_AGENT_HOME_SCROLL_BOTTOM_PAD =
  'calc(env(safe-area-inset-bottom, 0px) + 12px)';

/** Mobile: keep composer short so flex-1 message list does not jump on every keystroke; scroll inside textarea instead. */
export const COMPOSER_TEXTAREA_MAX_PX_NARROW = 104;
export const COMPOSER_TEXTAREA_MAX_PX_WIDE = 200;

/** Per-user + per-workspace — legacy default (migrated to per-chat keys). */
export function githubRepoContextStorageKey(userId: string | null, workspaceId: string | null): string {
  const u = userId?.trim() || 'anon';
  const w = workspaceId?.trim() || 'nows';
  return `${LS_GH_REPO}:${u}:${w}`;
}

export type ChatGithubContextStored = {
  repo: string;
  path?: string | null;
  branch?: string | null;
  /** Eager-read body from GitHub picker (Context Envelope v1). */
  content?: string | null;
  content_truncated?: boolean;
  content_sha?: string | null;
};

/** Per-user + per-workspace + per-conversation GitHub context for Agent Sam chat. */
export function chatGithubContextStorageKey(
  userId: string | null,
  workspaceId: string | null,
  conversationId: string | null | undefined,
): string {
  const u = userId?.trim() || 'anon';
  const w = workspaceId?.trim() || 'nows';
  const c = conversationId?.trim() || 'draft';
  return `${LS_GH_REPO}:${u}:${w}:chat:${c}`;
}

export function readChatGithubContext(key: string): ChatGithubContextStored | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw?.trim()) return null;
    const parsed = JSON.parse(raw) as ChatGithubContextStored;
    if (parsed?.repo?.trim()) {
      return {
        repo: parsed.repo.trim(),
        path: parsed.path?.trim() || null,
        branch: parsed.branch?.trim() || null,
        content: parsed.content?.trim() || null,
        content_truncated: !!parsed.content_truncated,
        content_sha: parsed.content_sha?.trim() || null,
      };
    }
    if (raw.includes('/')) {
      return { repo: raw.trim(), path: null, branch: null };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function writeChatGithubContext(key: string, ctx: ChatGithubContextStored): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        repo: ctx.repo.trim(),
        path: ctx.path?.trim() || null,
        branch: ctx.branch?.trim() || null,
        content: ctx.content?.trim() || null,
        content_truncated: ctx.content_truncated ?? false,
        content_sha: ctx.content_sha?.trim() || null,
      }),
    );
  } catch {
    /* ignore */
  }
}

/** Composer model picker: Thompson / resolveRoutingArm on the Worker when sent as `model`. */
export const AUTO_MODEL_KEY = 'auto';

export type ChatSubagentProfileRow = {
  id: string;
  slug: string;
  display_name: string;
  description?: string;
  default_model_id?: string | null;
  agent_type?: string;
  access_mode?: string;
  is_platform_global?: number;
};

export function isAutoModelSelection(modelKey: string | null | undefined): boolean {
  const k = modelKey != null ? String(modelKey).trim().toLowerCase() : '';
  return k === '' || k === AUTO_MODEL_KEY;
}

export type AgentMode = 'ask' | 'plan' | 'agent' | 'debug' | 'multitask';

export const AGENT_MODES = [
  { id: 'agent', label: 'Agent', description: 'Execute and open surfaces' },
  { id: 'plan', label: 'Plan', description: 'Design technical plans' },
  { id: 'debug', label: 'Debug', description: 'Inspect, prove, and fix' },
  { id: 'multitask', label: 'Multitask', description: 'Coordinate workflows' },
  { id: 'ask', label: 'Ask', description: 'Talk and answer questions' },
] as const satisfies ReadonlyArray<{ id: AgentMode; label: string; description: string }>;

export type WorkflowLedgerState = {
  runId: string | null;
  stepsTotal: number | null;
  stepsCompleted: number;
  currentNodeKey: string | null;
  runCost: number | null;
  runTokensIn: number | null;
  runTokensOut: number | null;
  lastError: string | null;
  status?: 'idle' | 'running' | 'completed' | 'failed' | null;
};

export type ExecPanelState = {
  tool_name: string;
  status: 'running' | 'done' | 'error';
  lines: string[];
  duration_ms?: number;
  started: string;
  is_sql: boolean;
  sql_rows?: Record<string, unknown>[];
} | null;
