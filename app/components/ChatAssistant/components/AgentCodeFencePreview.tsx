/**
 * In-chat "mini workstation" for fenced code blocks — Monaco syntax preview + Copy + Open in Monaco.
 * Shell blocks stay in AgentMessageList (Run in Terminal path).
 *
 * @license SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState, useEffect } from 'react';
import { Editor } from '@monaco-editor/react';
import { Copy, ExternalLink, ChevronDown, ChevronUp, Play } from 'lucide-react';
import type { ActiveFile } from '../../../types';
import {
  applyMonacoTheme,
  buildStandaloneEditorOptions,
  resolveMonacoThemeId,
} from '../../../src/lib/monacoThemes';

const FENCE_LABEL: Record<string, string> = {
  sql: 'SQL',
  postgres: 'SQL',
  postgresql: 'SQL',
  mysql: 'SQL',
  sqlite: 'SQL',
  plpgsql: 'PL/pgSQL',
  graphql: 'GraphQL',
  diff: 'Diff',
  patch: 'Patch',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  markdown: 'Markdown',
  html: 'HTML',
  css: 'CSS',
  ts: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  jsx: 'JSX',
  py: 'Python',
  rs: 'Rust',
  go: 'Go',
  toml: 'TOML',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  shell: 'Shell',
  text: 'Text',
  txt: 'Text',
};

// Monaco language IDs — differ from file extensions in some cases
const MONACO_LANG: Record<string, string> = {
  sql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  sqlite: 'sql',
  plpgsql: 'sql',
  graphql: 'graphql',
  diff: 'diff',
  patch: 'diff',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  css: 'css',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  python: 'python',
  rs: 'rust',
  go: 'go',
  toml: 'toml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shell: 'shell',
};

function labelForLang(lang: string) {
  const k = String(lang || 'text').toLowerCase().trim();
  return FENCE_LABEL[k] || (k ? k.toUpperCase() : 'CODE');
}

function monacoLangForFence(lang: string): string {
  const k = String(lang || '').toLowerCase().trim();
  return MONACO_LANG[k] || k || 'plaintext';
}

const LINE_H = 20; // px per line at fontSize 12 / lineHeight 20
const MAX_H = 320;
const MIN_H = 72;
const DEFAULT_COLLAPSE_LINES = 18;

export type AgentCodeFencePreviewProps = {
  lang: string;
  code: string;
  /** Suggested Monaco tab name without extension */
  fileBase: string;
  fileExt: string;
  onOpenMonaco?: (file: Pick<ActiveFile, 'name' | 'content'> & Partial<ActiveFile>) => void;
  /** Lines before collapse toggle (Monaco always gets full content) */
  collapseLines?: number;
  /** Max Monaco preview height in px */
  maxPreviewHeightPx?: number;
  /** Extra classes on the outer shell (e.g. tool-trace compact) */
  className?: string;
  /** Tighter margins for nested panels (tool REQUEST/OUTPUT) */
  compact?: boolean;
};

export function AgentCodeFencePreview({
  lang,
  code,
  fileBase,
  fileExt,
  onOpenMonaco,
  collapseLines = DEFAULT_COLLAPSE_LINES,
  maxPreviewHeightPx = MAX_H,
  className = '',
  compact = false,
}: AgentCodeFencePreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [themeId, setThemeId] = useState(resolveMonacoThemeId);
  const lines = code.split('\n');
  const long = lines.length > collapseLines;

  useEffect(() => {
    const sync = () => setThemeId(resolveMonacoThemeId());
    window.addEventListener('iam:cms-theme-applied', sync);
    return () => window.removeEventListener('iam:cms-theme-applied', sync);
  }, []);

  const monacoLang = monacoLangForFence(lang);
  const visibleLines = !expanded && long ? collapseLines : lines.length;
  const editorH = Math.max(MIN_H, Math.min(maxPreviewHeightPx, visibleLines * LINE_H + 16));
  const displayValue = !expanded && long ? lines.slice(0, collapseLines).join('\n') : code;

  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(code); } catch { /* ignore */ }
  }, [code]);

  const openMonaco = useCallback(() => {
    // Use lang-derived extension so Monaco tab opens with correct tokenization — not ".text"
    const ext = fileExt || lang || 'txt';
    const name = `${fileBase}.${ext}`.replace(/[^a-zA-Z0-9._-]+/g, '_');
    onOpenMonaco?.({ name, content: code });
  }, [code, fileBase, fileExt, lang, onOpenMonaco]);

  const isHtml =
    /^(html|htm)$/i.test(fileExt || '') ||
    /^(html|htm)$/i.test(lang || '') ||
    /<!DOCTYPE\s+html/i.test(code) ||
    /<\s*html[\s>]/i.test(code);

  const openLivePreview = useCallback(() => {
    const ext = isHtml ? 'html' : fileExt || lang || 'txt';
    const name = `${fileBase}.${ext}`.replace(/[^a-zA-Z0-9._-]+/g, '_');
    onOpenMonaco?.({ name, content: code });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('iam:open-editor-preview', {
          detail: { file: { name, content: code, originalContent: code } },
        }),
      );
    }
  }, [code, fileBase, fileExt, isHtml, lang, onOpenMonaco]);

  const shellClass = [
    compact ? 'my-1' : 'my-3',
    'rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] overflow-hidden max-w-full min-w-0 shadow-inner',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={shellClass}>

      {/* ── Header ── */}
      <div className={`flex items-center justify-between gap-2 ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} bg-[var(--dashboard-panel)] border-b border-[var(--dashboard-border)]`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[0.6875rem] font-mono font-semibold tracking-wide text-[var(--text-heading)] truncate">
            {labelForLang(lang)}
          </span>
          <span className="text-[0.625rem] text-[var(--dashboard-muted)] shrink-0 tabular-nums">
            {lines.length} {lines.length === 1 ? 'line' : 'lines'}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            title="Copy"
            onClick={() => void copy()}
            className="p-1.5 rounded-md border border-transparent text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] hover:border-[var(--dashboard-border)] hover:bg-[var(--scene-bg)] transition-colors"
          >
            <Copy size={14} aria-hidden />
          </button>
          {isHtml ? (
            <button
              type="button"
              title="Live preview"
              onClick={openLivePreview}
              disabled={!onOpenMonaco}
              className="p-1.5 rounded-md border border-transparent text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] hover:border-[var(--dashboard-border)] hover:bg-[var(--scene-bg)] transition-colors disabled:opacity-40"
            >
              <Play size={14} aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            title="Open in Monaco"
            onClick={openMonaco}
            disabled={!onOpenMonaco}
            className="p-1.5 rounded-md border border-transparent text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] hover:border-[var(--dashboard-border)] hover:bg-[var(--scene-bg)] transition-colors disabled:opacity-40"
          >
            <ExternalLink size={14} aria-hidden />
          </button>
        </div>
      </div>

      {/* ── Monaco syntax preview — read-only ── */}
      <div style={{ height: editorH }} className="w-full">
        <Editor
          height="100%"
          language={monacoLang}
          theme={themeId}
          value={displayValue}
          beforeMount={(m) => { applyMonacoTheme(m); }}
          options={{
            ...buildStandaloneEditorOptions(false, true),
            readOnly: true,
            lineNumbers: 'on',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            folding: false,
            fontSize: 12,
            lineHeight: LINE_H,
            padding: { top: 8, bottom: 8 },
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              verticalScrollbarSize: 6,
              horizontalScrollbarSize: 6,
            },
            overviewRulerLanes: 0,
            renderLineHighlight: 'none',
            contextmenu: false,
            wordWrap: 'off',
            guides: { indentation: false, bracketPairs: false },
          }}
        />
      </div>

      {/* ── Collapse toggle ── */}
      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[0.625rem] font-medium text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/5 border-t border-[var(--dashboard-border)]/60 transition-colors"
        >
          {expanded ? (
            <><ChevronUp size={13} aria-hidden /> Collapse</>
          ) : (
            <><ChevronDown size={13} aria-hidden /> Show all {lines.length} lines</>
          )}
        </button>
      ) : null}

    </div>
  );
}
