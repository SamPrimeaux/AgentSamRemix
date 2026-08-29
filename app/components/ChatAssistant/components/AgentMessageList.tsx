/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { User, ChevronRight, FileText, ShieldAlert, Sparkles } from 'lucide-react';
import { SetiFileIcon } from '../../../src/components/SetiFileIcon';
import type { ActiveFile } from '../../../types';
import type {
  Message,
  ImplementationPlanMarkdown,
  AgentPreviewArtifact,
  ActiveSubagentRow,
} from '../types';
import type { ThinkingCardState } from '../../../src/components/ThinkingCard';
import { IAM_AGENT_CHAT_CONVERSATION_CHANGE } from '../../../agentChatConstants';
import type { AgentPresence } from '../../../features/agent-presence/presenceTypes';
import {
  resolveInlinePresenceDisplay,
  shouldShowInlinePresence,
} from '../../../features/mode-presence/resolveInlinePresenceDisplay';
import { AgentChatMarkdown } from './AgentChatMarkdown';
import { AgentCodeFencePreview } from './AgentCodeFencePreview';
import { AgentCodeDiffPreview } from './AgentCodeDiffPreview';
import {
  collapseEmbeddedFileDumpsForChat,
  suggestHtmlArtifactFilename,
} from '../streamParsing';
import type { WorkflowLedgerState } from '../types';
import type { AgentToolTraceRow } from '../execution/types';
import { preserveLiveCadTraceRows, traceRowCadJobLive } from '../../../lib/cadToolTrace';
import { resolveAssistantToolTraces } from '../../../lib/persistAssistantToolTraces';
import { ExecutionTimeline } from '../execution/ExecutionTimeline';
import { prepareAssistantMessageWithToolTrace } from '../../../lib/stripToolTraceMessageContent';
import { isAgentRuntimeDumpText } from '../../../shared/agent-runtime/user-visible-agent-error.js';
import { AgentPresenceGlyphRow } from '../../../features/mode-presence/AgentPresenceGlyphRow';
import { AgentPresenceInline } from '../../../features/mode-presence/AgentPresenceInline';
import { WorkflowRunPresenceBanner } from './WorkflowRunBoard';
import { ArtifactChipList } from '../execution/ArtifactChipList';
import type { AgentMode } from '../types';
import { AgentPlanChecklist } from './AgentPlanChecklist';
import { AgentImageGenerationCard } from '../../../components/AgentImageGenerationCard';
import { AgentVideoGenerationCard } from '../../../components/AgentVideoGenerationCard';
import { EmailArtifactCard } from '../artifacts/EmailArtifactCard';
import { ToolApprovalCard } from './ToolApprovalCard';
import type { ToolApprovalPayload } from '../types';
import { AgentMobileFilesChangedEnvelope } from './AgentMobileFilesChangedEnvelope';
import { collectDiffArtifactsFromMessages } from '../lib/collectChatDiffArtifacts';
import { MobileCodeSnippetRow } from './MobileCodeSnippetRow';

const ASSISTANT_AVATAR_DARK =
  'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/dbb316af-9c97-4959-f09f-bf58b2783d00/avatar';
const ASSISTANT_AVATAR_LIGHT =
  'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/11f6af46-0a3c-482a-abe8-83edc5a8a200/avatar';

function CollapsedLogPreview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const preview = String(text || '').slice(0, 240).trim();
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[0.6875rem] font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"
      >
        {open ? 'Hide pasted log' : 'Show pasted log'}
      </button>
      {open ? (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[0.6875rem] text-[var(--dashboard-muted)]">
          {text}
        </pre>
      ) : (
        <pre className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap break-words text-[0.6875rem] text-[var(--dashboard-muted)] opacity-70">
          {preview}
          {text.length > 240 ? '…' : ''}
        </pre>
      )}
    </div>
  );
}

function assistantAvatarUrl(isDarkTheme: boolean): string {
  return isDarkTheme ? ASSISTANT_AVATAR_DARK : ASSISTANT_AVATAR_LIGHT;
}

const LANG_TO_EXT: Record<string, string> = {
  sql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  sqlite: 'sql',
  plpgsql: 'sql',
  graphql: 'graphql',
  diff: 'diff',
  patch: 'patch',
  yaml: 'yaml',
  yml: 'yml',
  toml: 'toml',
  md: 'md',
  markdown: 'md',
  mermaid: 'mmd',
  tsx: 'tsx',
  jsx: 'jsx',
  ts: 'ts',
  js: 'js',
  css: 'css',
  html: 'html',
  json: 'json',
  py: 'py',
  python: 'py',
  sh: 'sh',
  bash: 'sh',
  zsh: 'sh',
  shell: 'sh',
  rust: 'rs',
  go: 'go',
  java: 'java',
  php: 'php',
  vue: 'vue',
  svelte: 'svelte',
};

const getLangMeta = (lang: string) => {
  const ext = LANG_TO_EXT[lang.toLowerCase()] ?? (lang || 'txt');
  return {
    ext,
    icon: <SetiFileIcon filename={`preview.${ext}`} size={15} />,
  };
};

/** Fenced blocks that always use the preview workstation (even when short). */
const PREVIEW_LANGS = new Set([
  'sql',
  'postgres',
  'postgresql',
  'mysql',
  'sqlite',
  'plpgsql',
  'graphql',
  'diff',
  'patch',
  'json',
  'yaml',
  'yml',
  'html',
  'htm',
  'css',
  'svg',
  'javascript',
  'js',
  'typescript',
  'ts',
]);

export type AgentMessageListProps = {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  showEmptyThreadPlaceholder: boolean;
  displayMessages: Message[];
  isLoading: boolean;
  mode: AgentMode;
  presence: Pick<AgentPresence, 'state' | 'label' | 'detail' | 'toolName'>;
  thinkingState?: ThinkingCardState | null;
  showInlinePresence?: boolean;
  isNarrow?: boolean;
  isDarkTheme: boolean;
  toolTraceRows: AgentToolTraceRow[];
  /** Omit on read-only panes (e.g. split-child) that never own tool traces. */
  setToolTraceRows?: React.Dispatch<React.SetStateAction<AgentToolTraceRow[]>>;
  /** Resolved model for the active/last turn (shown in Done footer). */
  runModelKey?: string | null;
  workspaceId: string | null;
  workflowLedger: WorkflowLedgerState;
  activeSubagents?: ActiveSubagentRow[];
  onStopSubagent?: (id: string) => void;
  /** Desktop: open parent|child beside. Mobile: falls back to conversation switch. */
  onOpenBeside?: (conversationId: string, label: string) => void;
  onSendUserMessage?: (text: string) => void;
  onFileSelect?: (file: Pick<ActiveFile, 'name' | 'content'> & Partial<ActiveFile>) => void;
  onRunInTerminal?: (cmd: string) => void;
  /** Optional: assistant markdown images delegate here (default: new tab). */
  onImagePreview?: (src: string) => void;
  onRunPlan?: (planId: string) => void;
  runPlanBusy?: boolean;
  onSavePlanWorkspace?: (planId: string) => void;
  savePlanBusy?: boolean;
  onPlanIntakeSubmit?: (payload: {
    batchId: string;
    selections: Record<string, string>;
    optionalDetails: string;
    skip: boolean;
  }) => void;
  planIntakeBusy?: boolean;
  /** Inline pre-flight gate — rendered in-thread before tool execution. */
  pendingToolApproval?: ToolApprovalPayload | null;
  approvalBusy?: boolean;
  onApprovePendingTool?: () => void;
  onDenyPendingTool?: () => void;
  /** Mobile agent home renders history elsewhere — skip centered empty state. */
  suppressEmptyPlaceholder?: boolean;
  /** Mobile thread: envelope file list instead of inline Monaco diff blobs. */
  mobileEnvelopeDiffs?: boolean;
  onOpenDiffTab?: () => void;
  onOpenDiffFile?: (entryId: string) => void;
};

function renderMessageContent(
  content: string,
  msgIndex: number,
  onFileSelect?: AgentMessageListProps['onFileSelect'],
  onRunInTerminal?: AgentMessageListProps['onRunInTerminal'],
  /** Assistant replies often use headings/lists; user paste may need literal newlines. */
  renderTextAsMarkdown = false,
  onImagePreview?: AgentMessageListProps['onImagePreview'],
  mobileCompactCode = false,
): React.ReactNode {
  const imgHandler =
    onImagePreview ?? ((u: string) => window.open(u, '_blank', 'noopener,noreferrer'));

  let display = content
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
    .replace(/<antml:invoke[\s\S]*?<\/antml:invoke>/gi, '')
    .replace(/<invoke[\s\S]*?<\/antml:invoke>/gi, '')
    .replace(/<invoke[\s\S]*?<\/invoke>/gi, '')
    .trim();
  display = display.replace(/\[FILE_CREATED:(.+?)\]/g, (_, key: string) => `Created ${key} — opened in editor`);
  // Historical threads: unfenced HTML dumps used to flood chat as broken markdown.
  display = collapseEmbeddedFileDumpsForChat(display);

  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)\n```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let codeCount = 0;
  const suggestedHtmlName = suggestHtmlArtifactFilename(display, '');

  while ((match = codeBlockRegex.exec(display)) !== null) {
    if (match.index > lastIndex) {
      const text = display.substring(lastIndex, match.index);
      parts.push(
        renderTextAsMarkdown ? (
          <AgentChatMarkdown
            key={`text-${lastIndex}`}
            source={text}
            onImageClick={imgHandler}
          />
        ) : (
          <span
            key={`text-${lastIndex}`}
            className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] max-w-full"
          >
            {text}
          </span>
        ),
      );
    }

    const lang = match[1] || 'text';
    const code = match[2];
    const { ext, icon } = getLangMeta(lang);
    const isShell = ['sh', 'bash', 'zsh', 'shell'].includes(lang);
    codeCount++;

    const langLower = lang.toLowerCase();
    const isHtmlLang =
      langLower === 'html' ||
      langLower === 'htm' ||
      ext === 'html' ||
      /<!DOCTYPE\s+html/i.test(code) ||
      /<\s*html[\s>]/i.test(code);
    const isLarge = code.split('\n').length > 5 || code.length > 200;
    const useFencePreview = !isShell && (isLarge || PREVIEW_LANGS.has(langLower) || isHtmlLang);
    const htmlFileName = isHtmlLang
      ? suggestedHtmlName || `visualizer_${msgIndex}_${codeCount}.html`
      : '';
    const fileName = htmlFileName || `agent_output_${msgIndex}_${codeCount}.${ext}`;
    const fenceBase = htmlFileName
      ? htmlFileName.replace(/\.html?$/i, '')
      : `agent_output_${msgIndex}_${codeCount}`;
    const fenceExt = htmlFileName ? 'html' : ext;

    if (mobileCompactCode && (isLarge || useFencePreview)) {
      parts.push(
        <MobileCodeSnippetRow
          key={`code-${match.index}`}
          fileName={fileName}
          lang={isShell ? 'shell' : isHtmlLang ? 'html' : lang}
          lineCount={code.split('\n').length}
          code={code}
          isShell={isShell}
          onOpenMonaco={() => onFileSelect?.({ name: fileName, content: code })}
          onRunInTerminal={isShell ? () => onRunInTerminal?.(code) : undefined}
        />,
      );
    } else if (isShell && isLarge) {
      parts.push(
        <div
          key={`code-${match.index}`}
          className="my-3 p-3 bg-[var(--scene-bg)] border border-[var(--dashboard-border)] rounded-xl group hover:border-[var(--solar-green)]/50 transition-all max-w-full min-w-0"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 bg-[var(--dashboard-panel)] border border-[var(--dashboard-border)] rounded-lg flex items-center justify-center text-[var(--solar-green)]">
              <span className="text-[0.6875rem] font-bold font-mono">$_</span>
            </div>
            <div>
              <span className="text-[0.75rem] font-bold text-[var(--text-heading)] tracking-tight">Shell Script</span>
              <span className="text-[0.625rem] text-[var(--dashboard-muted)] ml-2">
                {code.split('\n').length} lines · {lang}
              </span>
            </div>
          </div>
          <pre className="text-[0.6875rem] font-mono text-[var(--solar-green)] bg-[var(--bg-code-pre)] rounded-lg p-3 overflow-x-auto overflow-y-hidden whitespace-pre border border-[var(--dashboard-border)] max-w-full min-w-0">
            {code}
          </pre>
          <p className="text-[0.625rem] text-[var(--dashboard-muted)] mt-2 mb-0">
            Stop with Ctrl+C when you have enough logs.
          </p>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => onRunInTerminal?.(code)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--solar-green)]/10 hover:bg-[var(--solar-green)]/20 border border-[var(--solar-green)]/30 text-[var(--solar-green)] rounded-lg text-[0.6875rem] font-bold transition-colors"
            >
              <span className="font-mono">$</span> Run in Terminal
            </button>
            <button
              type="button"
              onClick={() => onFileSelect?.({ name: `script_${msgIndex}_${codeCount}.${ext}`, content: code })}
              className="flex items-center gap-2 px-3 py-1.5 bg-[var(--dashboard-panel)] border border-[var(--dashboard-border)] hover:border-[var(--solar-cyan)]/40 text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] rounded-lg text-[0.6875rem] transition-colors"
            >
              Open in Monaco
            </button>
          </div>
        </div>,
      );
    } else if (useFencePreview) {
      parts.push(
        <AgentCodeFencePreview
          key={`code-${match.index}`}
          lang={isHtmlLang ? 'html' : lang}
          code={code}
          fileBase={fenceBase}
          fileExt={fenceExt}
          onOpenMonaco={onFileSelect}
        />,
      );
    } else if (!isShell && isLarge) {
      parts.push(
        <div
          key={`code-${match.index}`}
          className="my-3 p-3 bg-[var(--scene-bg)] border border-[var(--dashboard-border)] rounded-xl flex items-center justify-between group hover:border-[var(--solar-cyan)] transition-all cursor-pointer shadow-inner max-w-full min-w-0"
          onClick={() => onFileSelect?.({ name: fileName, content: code })}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[var(--dashboard-panel)] border border-[var(--dashboard-border)] rounded-lg flex items-center justify-center text-[var(--solar-cyan)]">
              {icon}
            </div>
            <div className="flex flex-col">
              <span className="text-[0.75rem] font-bold text-[var(--text-heading)] tracking-tight">{fileName}</span>
              <span className="text-[0.625rem] text-[var(--dashboard-muted)] mt-0.5">
                {code.split('\n').length} lines · {lang}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[0.625rem] text-[var(--solar-cyan)] opacity-0 group-hover:opacity-100 transition-opacity font-bold uppercase tracking-wider">
              Open in Monaco
            </span>
            <ChevronRight size={14} className="text-[var(--dashboard-muted)] group-hover:text-[var(--solar-cyan)] transition-colors" />
          </div>
        </div>,
      );
    } else {
      // Short non-shell blocks: Monaco syntax preview for all code, even 1-5 line snippets.
      parts.push(
        <AgentCodeFencePreview
          key={`code-${match.index}`}
          lang={isHtmlLang ? 'html' : lang}
          code={code}
          fileBase={fenceBase}
          fileExt={fenceExt}
          onOpenMonaco={onFileSelect}
          collapseLines={30}
          maxPreviewHeightPx={180}
        />,
      );
    }

    lastIndex = codeBlockRegex.lastIndex;
  }

  if (lastIndex < display.length) {
    const tail = display.substring(lastIndex);
    parts.push(
      renderTextAsMarkdown ? (
        <AgentChatMarkdown key="text-end" source={tail} onImageClick={imgHandler} />
      ) : (
        <span key="text-end" className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] max-w-full">
          {tail}
        </span>
      ),
    );
  }

  return parts.length > 0 ? (
    <>{parts}</>
  ) : renderTextAsMarkdown ? (
    <AgentChatMarkdown source={display} onImageClick={imgHandler} />
  ) : (
    <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] max-w-full">{display}</span>
  );
}

function openImplementationPlanMarkdown(
  planMarkdown: ImplementationPlanMarkdown,
  planId: string,
  onFileSelect?: AgentMessageListProps['onFileSelect'],
) {
  const pub = typeof planMarkdown.public_url === 'string' ? planMarkdown.public_url.trim() : '';
  const aid = typeof planMarkdown.artifact_id === 'string' ? planMarkdown.artifact_id.trim() : '';
  const url =
    pub ||
    (aid ? `/api/artifacts/${encodeURIComponent(aid)}/content` : '');
  if (!url || !onFileSelect) return;
  void (async () => {
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return;
      const text = await r.text();
      const safeId = planId.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 48);
      onFileSelect({ name: `plan-${safeId || 'export'}.md`, content: text });
    } catch {
      /* ignore */
    }
  })();
}

function AssistantPreviewArtifactsBar({
  artifacts,
  onFileSelect,
  onImagePreview,
  hideInlineDiffs = false,
}: {
  artifacts: AgentPreviewArtifact[];
  onFileSelect?: AgentMessageListProps['onFileSelect'];
  onImagePreview?: AgentMessageListProps['onImagePreview'];
  hideInlineDiffs?: boolean;
}) {
  const diffArts = artifacts.filter(
    (a) => a.kind === 'diff' && typeof a.before === 'string' && typeof a.content === 'string',
  );
  const chipArts = artifacts.filter((a) => !diffArts.includes(a));

  return (
  <>
      {!hideInlineDiffs
        ? diffArts.map((a) => (
        <AgentCodeDiffPreview
          key={a.id}
          path={a.path || a.title || a.id}
          before={a.before!}
          after={a.content!}
          language={a.language}
          onOpenMonaco={(file) =>
            onFileSelect?.({
              ...file,
              originalContent: file.originalContent ?? a.before,
            })
          }
        />
      ))
        : null}
      {chipArts.length > 0 ? (
        <ArtifactChipList
          artifacts={chipArts}
          onOpenArtifact={(a) =>
            onFileSelect?.({
              name: `sse-preview-${a.kind}-${a.id.slice(0, 8)}.${a.kind === 'sql' ? 'sql' : a.kind === 'diff' ? 'diff' : a.language || 'txt'}`,
              content: a.content || `# ${a.title || a.kind}\n`,
              originalContent: a.before,
            })
          }
          onOpenImageUrl={onImagePreview}
        />
      ) : null}
    </>
  );
}

function formatSubagentMeta(row: ActiveSubagentRow): string {
  if (row.stepCount != null && row.stepCount > 0) return `${row.stepCount} steps`;
  const elapsed = Math.max(0, Math.floor((Date.now() - row.startedAt) / 1000));
  if (elapsed < 60) return `${elapsed}s`;
  return `${Math.floor(elapsed / 60)}m`;
}

function AgentQuestionBubble({
  question,
  options,
  onSend,
}: {
  question: string;
  options?: string[];
  onSend?: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="flex flex-col gap-2 min-w-0 rounded-lg border border-[var(--dashboard-border)]/80 bg-[var(--scene-bg)]/60 px-3 py-2.5">
      <p className="text-[18px] leading-snug text-[var(--dashboard-text)] m-0">{question}</p>
      {options && options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onSend?.(opt)}
              className="px-2.5 py-1 rounded-full text-[11px] text-[var(--dashboard-text)] border border-[var(--color-border-secondary,var(--dashboard-border))] bg-transparent hover:bg-[var(--bg-hover)] transition-colors"
              style={{ borderWidth: '0.5px' }}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = draft.trim();
            if (!t) return;
            onSend?.(t);
            setDraft('');
          }}
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Your answer…"
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[12px] bg-[var(--scene-bg)] border border-[var(--dashboard-border)] text-[var(--dashboard-text)]"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-[var(--solar-cyan)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}

function PlanReadyActions({
  planId,
  planMarkdown,
  onViewPlan,
  onRunPlan,
  onSavePlanWorkspace,
  runPlanBusy,
  savePlanBusy,
}: {
  planId: string;
  planMarkdown?: ImplementationPlanMarkdown;
  onViewPlan?: (planId: string, planMarkdown?: ImplementationPlanMarkdown) => void;
  onRunPlan?: (planId: string) => void;
  onSavePlanWorkspace?: (planId: string) => void;
  runPlanBusy?: boolean;
  savePlanBusy?: boolean;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {planMarkdown ? (
        <button
          type="button"
          onClick={() => onViewPlan?.(planId, planMarkdown)}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--dashboard-border)]/90 bg-[var(--scene-bg)]/80 px-3 py-1.5 text-[11px] font-medium text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] hover:border-[var(--solar-cyan)]/35 transition-colors"
        >
          <FileText size={14} className="shrink-0" />
          View Plan
        </button>
      ) : null}
      <button
        type="button"
        disabled={savePlanBusy || runPlanBusy}
        onClick={() => onSavePlanWorkspace?.(planId)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--dashboard-border)]/90 bg-[var(--scene-bg)]/80 px-3 py-1.5 text-[11px] font-medium text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] hover:border-[var(--solar-cyan)]/35 disabled:opacity-40 transition-colors"
      >
        {savePlanBusy ? 'Saving…' : 'Save to workspace'}
      </button>
      <button
        type="button"
        disabled={runPlanBusy}
        onClick={() => onRunPlan?.(planId)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--solar-cyan)]/40 bg-[var(--solar-cyan)]/10 px-3 py-1.5 text-[11px] font-semibold text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/15 disabled:opacity-40 transition-colors"
      >
        {runPlanBusy ? 'Building…' : 'Build'}
      </button>
    </div>
  );
}

export const AgentMessageList: React.FC<AgentMessageListProps> = ({
  scrollRef,
  showEmptyThreadPlaceholder,
  displayMessages,
  isLoading,
  mode,
  presence,
  thinkingState = null,
  showInlinePresence = false,
  isNarrow = false,
  isDarkTheme,
  toolTraceRows,
  setToolTraceRows,
  runModelKey = null,
  workspaceId,
  workflowLedger,
  activeSubagents = [],
  onStopSubagent,
  onOpenBeside,
  onSendUserMessage,
  onFileSelect,
  onRunInTerminal,
  onImagePreview,
  onRunPlan,
  runPlanBusy = false,
  onSavePlanWorkspace,
  savePlanBusy = false,
  onPlanIntakeSubmit,
  planIntakeBusy = false,
  pendingToolApproval = null,
  approvalBusy = false,
  onApprovePendingTool,
  onDenyPendingTool,
  suppressEmptyPlaceholder = false,
  mobileEnvelopeDiffs = false,
  onOpenDiffTab,
  onOpenDiffFile,
}) => {
  const mobileDiffEntries = useMemo(
    () => (mobileEnvelopeDiffs ? collectDiffArtifactsFromMessages(displayMessages) : []),
    [mobileEnvelopeDiffs, displayMessages],
  );
  const inlinePresence = useMemo(
    () =>
      shouldShowInlinePresence({ showInlinePresence, toolTraceRows })
        ? resolveInlinePresenceDisplay({ mode, presence, thinkingState })
        : null,
    [showInlinePresence, toolTraceRows, mode, presence, thinkingState],
  );

  const lastAssistantMessageIndex = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (displayMessages[i].role === 'assistant') return i;
    }
    return -1;
  }, [displayMessages]);

  return (
    <div
      ref={scrollRef}
      className="order-4 flex flex-col flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain w-full max-w-full agent-scroll-area"
    >
      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col space-y-6 px-3 sm:px-4 pt-6 pb-4">
      {showEmptyThreadPlaceholder && !suppressEmptyPlaceholder ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 px-6">
          <img
            src={assistantAvatarUrl(!!isDarkTheme)}
            alt="Agent Sam"
            width={100}
            height={100}
            style={{ objectFit: 'contain' }}
          />
          <p className="text-[13px] font-semibold text-[var(--dashboard-text)]">What should we work on?</p>
          <p className="text-[11px] text-[var(--dashboard-muted)] text-center leading-relaxed">
            Type below to start a conversation with Agent Sam.
          </p>
        </div>
      ) : (
        displayMessages.map((msg, i) => {
          const isLastAssistant = msg.role === 'assistant' && i === lastAssistantMessageIndex;
          const tracesForMsg = resolveAssistantToolTraces(msg, isLastAssistant, toolTraceRows);
          const tracesAreLive = isLastAssistant && toolTraceRows.length > 0;
          const assistantContent =
            tracesForMsg.length
              ? prepareAssistantMessageWithToolTrace(msg.content, tracesForMsg)
              : msg.content;
          const visibleAssistant = isAgentRuntimeDumpText(assistantContent) ? '' : assistantContent;
          if (
            msg.role === 'assistant' &&
            !visibleAssistant.trim() &&
            isAgentRuntimeDumpText(String(msg.content || '')) &&
            !msg.imageGenerationState &&
            !msg.videoGenerationState &&
            !msg.emailArtifact &&
            !(msg.previewArtifacts && msg.previewArtifacts.length) &&
            !tracesForMsg.length
          ) {
            return null;
          }
          const traceOnlyAssistant =
            msg.role === 'assistant' &&
            !visibleAssistant.trim() &&
            tracesForMsg.length > 0 &&
            !msg.imageGenerationState &&
            !msg.emailArtifact &&
            !(msg.previewArtifacts && msg.previewArtifacts.length > 0);

          if (traceOnlyAssistant) {
            return (
              <div key={i} className="flex w-full min-w-0 max-w-full justify-start">
                <div className="min-w-0 flex-1 w-full">
                  <ExecutionTimeline
                    rows={tracesForMsg}
                    mode={mode}
                    workspaceId={workspaceId}
                    compact={isNarrow}
                    showDoneFooter={false}
                    runModelKey={runModelKey}
                    onOpenInEditor={
                      onFileSelect
                        ? (file) =>
                            onFileSelect({ name: file.name, content: file.content, originalContent: file.content })
                        : undefined
                    }
                    onDismissRow={
                      tracesAreLive && setToolTraceRows
                        ? (id) =>
                            setToolTraceRows((prev) => prev.filter((r) => r.id !== id || traceRowCadJobLive(r)))
                        : undefined
                    }
                    onClear={
                      tracesAreLive && setToolTraceRows
                        ? () => setToolTraceRows((prev) => preserveLiveCadTraceRows(prev))
                        : undefined
                    }
                    onCadJobTerminal={
                      tracesAreLive && setToolTraceRows
                        ? (rowId) =>
                            setToolTraceRows((prev) =>
                              prev.map((r) =>
                                r.id === rowId ? { ...r, status: 'done' as const, cadJobLive: false } : r,
                              ),
                            )
                        : undefined
                    }
                  />
                </div>
              </div>
            );
          }

          return (
          <div key={i} className={`flex w-full min-w-0 max-w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`flex gap-2.5 min-w-0 ${
                msg.role === 'user' ? 'flex-row-reverse max-w-[min(85%,100%)]' : 'max-w-full w-full'
              }`}
            >
              <div
                className={`flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center mt-1 overflow-hidden ${
                  msg.role === 'user'
                    ? 'bg-[var(--dashboard-border)]'
                    : 'bg-[var(--solar-cyan)]/10 border border-[var(--solar-cyan)]/25'
                }`}
              >
                {msg.role === 'user' ? (
                  <User size={11} className="text-[var(--dashboard-muted)]" />
                ) : (
                  <img
                    src={assistantAvatarUrl(!!isDarkTheme)}
                    alt=""
                    width={24}
                    height={24}
                    className="w-full h-full object-contain"
                    aria-hidden
                  />
                )}
              </div>
              {msg.role === 'assistant' ? (
                <div className="flex flex-col min-w-0 flex-1 gap-0">
                  {msg.imageGenerationState ? (
                    <div className="mb-3">
                      <AgentImageGenerationCard
                        state={msg.imageGenerationState}
                        workspaceId={workspaceId}
                        onImagePreview={onImagePreview}
                      />
                    </div>
                  ) : null}
                  {msg.videoGenerationState ? (
                    <div className="mb-3">
                      <AgentVideoGenerationCard
                        state={msg.videoGenerationState}
                        workspaceId={workspaceId}
                      />
                    </div>
                  ) : null}
                  {msg.emailArtifact ? (
                    <div className="mb-3">
                      <EmailArtifactCard artifact={msg.emailArtifact} />
                    </div>
                  ) : null}
                  {msg.previewArtifacts &&
                  msg.previewArtifacts.filter((a) => !(msg.imageGenerationState && a.kind === 'image')).length >
                    0 ? (
                    <AssistantPreviewArtifactsBar
                      artifacts={msg.previewArtifacts.filter(
                        (a) => !(msg.imageGenerationState && a.kind === 'image'),
                      )}
                      onFileSelect={onFileSelect}
                      onImagePreview={onImagePreview}
                      hideInlineDiffs={mobileEnvelopeDiffs}
                    />
                  ) : null}
                  {/* Tools first, then answer — reply stays below the loader stack (visible). */}
                  {tracesForMsg.length > 0 ? (
                    <ExecutionTimeline
                      rows={tracesForMsg}
                      mode={mode}
                      workspaceId={workspaceId}
                      compact={isNarrow}
                      showDoneFooter={false}
                      runModelKey={runModelKey}
                      onOpenInEditor={
                        onFileSelect
                          ? (file) =>
                              onFileSelect({ name: file.name, content: file.content, originalContent: file.content })
                          : undefined
                      }
                      onDismissRow={
                        tracesAreLive && setToolTraceRows
                          ? (id) =>
                              setToolTraceRows((prev) =>
                                prev.filter((r) => r.id !== id || traceRowCadJobLive(r)),
                              )
                          : undefined
                      }
                      onClear={
                        tracesAreLive && setToolTraceRows
                          ? () => setToolTraceRows((prev) => preserveLiveCadTraceRows(prev))
                          : undefined
                      }
                      onCadJobTerminal={
                        tracesAreLive && setToolTraceRows
                          ? (rowId) =>
                              setToolTraceRows((prev) =>
                                prev.map((r) =>
                                  r.id === rowId
                                    ? { ...r, status: 'done' as const, cadJobLive: false }
                                    : r,
                                ),
                              )
                          : undefined
                      }
                    />
                  ) : null}
                  {visibleAssistant.trim() ? (
                    <div
                      className={`agent-content text-[0.8125rem] leading-relaxed min-w-0 break-words [overflow-wrap:anywhere] text-[var(--dashboard-text)] w-full${
                        tracesForMsg.length > 0 ? ' mt-3' : ''
                      }`}
                    >
                      {renderMessageContent(
                        visibleAssistant,
                        i,
                        onFileSelect,
                        onRunInTerminal,
                        true,
                        onImagePreview,
                        mobileEnvelopeDiffs,
                      )}
                    </div>
                  ) : null}
                  {msg.planQuestionsBatch && !msg.planQuestionsBatch.submitted ? (
                    <div className="agent-content min-w-0 w-full mt-2 mb-1">
                      <button
                        type="button"
                        onClick={() =>
                          onFileSelect?.({
                            name: 'Questions',
                            content: '',
                            fileKind: 'questions_intake',
                            workspacePath: `questions:${msg.planQuestionsBatch!.batch_id}`,
                          })
                        }
                        className="flex w-full items-center gap-2.5 rounded-xl border border-[var(--solar-cyan)]/25 bg-[var(--solar-cyan)]/8 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--solar-cyan)]/12"
                      >
                        <Sparkles size={15} className="shrink-0 text-[var(--solar-cyan)]" aria-hidden />
                        <span className="text-[13px] font-medium text-[var(--dashboard-text)]">
                          Agent Sam has questions — open the Questions tab
                        </span>
                        <ChevronRight size={14} className="ml-auto shrink-0 text-[var(--dashboard-muted)]" aria-hidden />
                      </button>
                    </div>
                  ) : null}
                  {msg.agentQuestion ? (
                    <div className="agent-content min-w-0 break-words w-full mt-2 mb-1">
                      <AgentQuestionBubble
                        question={msg.agentQuestion.question}
                        options={msg.agentQuestion.options}
                        onSend={onSendUserMessage}
                      />
                    </div>
                  ) : null}
                  {msg.executionPlan?.status === 'ready' && msg.executionPlan.plan_id ? (
                    <PlanReadyActions
                      planId={msg.executionPlan.plan_id}
                      planMarkdown={msg.implementationPlan?.plan_markdown}
                      onViewPlan={(planId, planMarkdown) => {
                        if (planMarkdown) openImplementationPlanMarkdown(planMarkdown, planId, onFileSelect);
                      }}
                      onRunPlan={onRunPlan}
                      runPlanBusy={runPlanBusy}
                      onSavePlanWorkspace={onSavePlanWorkspace}
                      savePlanBusy={savePlanBusy}
                    />
                  ) : null}
                  {msg.executionPlan && msg.executionPlan.tasks.length > 0 && msg.executionPlan.status !== 'ready' ? (
                    <AgentPlanChecklist
                      plan={msg.executionPlan}
                      mode={mode}
                      onRunPlan={onRunPlan}
                      runPlanBusy={runPlanBusy}
                      onSavePlanWorkspace={onSavePlanWorkspace}
                      savePlanBusy={savePlanBusy}
                    />
                  ) : null}
                  {msg.subagentAttributions && msg.subagentAttributions.length > 0 ? (
                    <div className="flex flex-col gap-0.5 mt-1.5 mb-1">
                      {msg.subagentAttributions.map((attr) => {
                        const clickable = !!attr.conversationId;
                        const prefix =
                          attr.status === 'action_required'
                            ? 'Action required'
                            : attr.status === 'failed'
                              ? 'Failed'
                              : 'Finished';
                        return (
                          <button
                            key={attr.runId}
                            type="button"
                            disabled={!clickable}
                            title={clickable ? 'Open beside' : 'Conversation unavailable'}
                            onClick={() => {
                              if (!attr.conversationId) return;
                              if (onOpenBeside) {
                                onOpenBeside(attr.conversationId, attr.label);
                                return;
                              }
                              window.dispatchEvent(
                                new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, {
                                  detail: { id: attr.conversationId },
                                }),
                              );
                            }}
                            className={`text-left text-[0.75rem] font-medium truncate max-w-full ${
                              clickable
                                ? 'text-[var(--solar-cyan)] hover:underline cursor-pointer'
                                : 'text-[var(--solar-cyan)]/50 cursor-default'
                            }`}
                          >
                            {prefix} {attr.label} ›
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div
                  className={`agent-content text-[0.8125rem] leading-relaxed min-w-0 break-words [overflow-wrap:anywhere] bg-[var(--scene-bg)] border border-[var(--dashboard-border)] px-4 py-3 rounded-2xl rounded-tr-sm text-[var(--dashboard-text)]`}
                >
                  {msg.role === 'user' && msg.attachmentPreviews && msg.attachmentPreviews.length > 0 ? (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {msg.attachmentPreviews.map((ap, j) =>
                        ap.type === 'image' && ap.previewUrl ? (
                          <img
                            key={j}
                            src={ap.previewUrl}
                            alt=""
                            className="max-h-40 max-w-full rounded-lg border border-[var(--dashboard-border)] object-contain"
                          />
                        ) : (
                          <span
                            key={j}
                            className="text-[0.6875rem] text-[var(--dashboard-muted)] px-2 py-1 rounded border border-[var(--dashboard-border)]/60"
                          >
                            {ap.name}
                          </span>
                        ),
                      )}
                    </div>
                  ) : null}
                  {isAgentRuntimeDumpText(msg.content) ? (
                    <CollapsedLogPreview text={msg.content} />
                  ) : (
                    renderMessageContent(msg.content, i, onFileSelect, onRunInTerminal, false, onImagePreview)
                  )}
                </div>
              )}
            </div>
          </div>
          );
        })
      )}

      {mobileEnvelopeDiffs && mobileDiffEntries.length > 0 ? (
        <AgentMobileFilesChangedEnvelope
          entries={mobileDiffEntries}
          onOpenDiffTab={onOpenDiffTab}
          onOpenDiffFile={onOpenDiffFile}
        />
      ) : null}

      {activeSubagents.map((row) => (
        <div key={row.id} className="flex justify-start w-full min-w-0">
          <AgentPresenceInline
            mode={mode}
            state={row.state}
            title={row.label.slice(0, 40)}
            meta={formatSubagentMeta(row)}
            size="sm"
            onStop={onStopSubagent ? () => onStopSubagent(row.id) : undefined}
            onClick={
              row.conversationId
                ? () => {
                    if (onOpenBeside) {
                      onOpenBeside(row.conversationId!, row.label);
                      return;
                    }
                    window.dispatchEvent(
                      new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, {
                        detail: { id: row.conversationId },
                      }),
                    );
                  }
                : undefined
            }
          />
        </div>
      ))}

      {/* Tool timeline owns loader copy — skip duplicate "Working through tools" banner. */}
      {workflowLedger.runId && isLoading && toolTraceRows.length === 0 ? (
        <div className="mx-0 mb-1">
          <WorkflowRunPresenceBanner ledger={workflowLedger} mode={mode} active={isLoading} />
        </div>
      ) : null}

      {pendingToolApproval && onApprovePendingTool && onDenyPendingTool ? (
        <div className="flex w-full min-w-0 max-w-full justify-start">
          <div className="flex gap-2.5 min-w-0 w-full max-w-full">
            <div className="flex-shrink-0 w-6 h-6 rounded-md bg-amber-500/15 border border-amber-400/25 flex items-center justify-center mt-1">
              <ShieldAlert size={11} className="text-amber-200/90" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <ToolApprovalCard
                tool={pendingToolApproval}
                busy={approvalBusy}
                onAllow={onApprovePendingTool}
                onDeny={onDenyPendingTool}
              />
            </div>
          </div>
        </div>
      ) : null}

      {inlinePresence ? (
        <div className="flex justify-start w-full min-w-0 pl-0.5" role="status" aria-live="polite">
          <AgentPresenceGlyphRow
            mode={mode}
            state={inlinePresence.state}
            iconKey={inlinePresence.iconKey}
            label={inlinePresence.meta ? `${inlinePresence.title} · ${inlinePresence.meta}` : inlinePresence.title}
            size={22}
            active={inlinePresence.shimmer !== false}
            startedAt={thinkingState?.startedAt ?? null}
          />
        </div>
      ) : null}

      </div>
    </div>
  );
};
