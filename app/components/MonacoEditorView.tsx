import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import {
  Save,
  GitCompare,
  Copy,
  Check,
  RotateCcw,
  GitBranch,
  X,
} from 'lucide-react';

import type { ActiveFile } from '../types';
import { useEditor } from '../src/EditorContext';
import { FilePreview } from '../src/components/FilePreview';
import { QuestionsIntakePage } from '../src/components/QuestionsIntakePage';
import { SetiFileIcon } from '../src/components/SetiFileIcon';
import { detectFileKind, isEditableTextKind } from '../src/lib/fileKind';
import { buildR2ObjectUrl } from '../src/lib/r2Urls';
import {
  applyMonacoTheme,
  buildDiffEditorOptions,
  buildStandaloneEditorOptions,
  resolveMonacoThemeId,
} from '../src/lib/monacoThemes';
import {
  disposeMonacoModelForPath,
  getOrCreateMonacoModel,
  monacoLanguageForFilename,
  resolveMonacoModelPath,
} from '../src/lib/monacoModelRegistry';
import type { AgentWorkspaceContextPacket } from '../src/ideWorkspace';
import type { EditorModelMeta } from '../types/editorModel';
import { useMonacoSafe } from '../src/hooks/useMonacoSafe';
import { attachMonacoTodoHighlight } from '../src/lib/monacoTodoHighlight';
import { attachMonacoTokenInspector } from '../src/lib/monacoSemanticHighlighting';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'];
const isImageKey = (key: string) => IMAGE_EXTS.some((e) => key.toLowerCase().endsWith(e));
const isImageMime = (ct: string) => ct.trim().toLowerCase().startsWith('image/');

export type { EditorModelMeta } from '../types/editorModel';

interface MonacoEditorViewProps {
  onChange?: (val?: string) => void;
  onSave?: (content: string) => void;
  /** Live cursor for status bar (IDE parity). */
  onCursorPositionChange?: (line: number, column: number) => void;
  /** Indent / EOL / encoding for status bar (from the live Monaco model). */
  onEditorModelMeta?: (meta: EditorModelMeta) => void;
  /** Agent Sam workbench context from App shell (optional). */
  workspaceContext?: AgentWorkspaceContextPacket | null;
  /** When set with onMdViewModeChange, App owns Source/Split/Preview chrome. */
  mdViewMode?: 'source' | 'split' | 'preview';
  onMdViewModeChange?: (mode: 'source' | 'split' | 'preview') => void;
  /** Hide internal markdown toggles when App renders them on the workbench tab bar. */
  hideMdViewToggle?: boolean;
}

const LARGE_FILE_CHAR_THRESHOLD = 100_000;

function normalizeCollabPath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

function collabPathMatchesTab(
  tab: { id: string; workspacePath?: string; name: string },
  filePath: string,
): boolean {
  const target = normalizeCollabPath(filePath);
  if (!target) return false;
  const candidates = [
    tab.workspacePath,
    tab.id,
    tab.name,
    resolveMonacoModelPath(tab),
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map((v) => normalizeCollabPath(v));
  return candidates.some(
    (c) => c === target || c.endsWith(`/${target}`) || target.endsWith(`/${c}`),
  );
}

/** Minimal markdown → HTML for the in-editor preview pane. No library needed. */
function markdownToHtml(md: string): string {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (``` fenced) — must run before inline code
  const withFenced = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre><code>${code.trimEnd()}</code></pre>`,
  );

  const body = withFenced
    // headings
    .replace(/^#{6} (.+)$/gm, '<h6>$1</h6>')
    .replace(/^#{5} (.+)$/gm, '<h5>$1</h5>')
    .replace(/^#{4} (.+)$/gm, '<h4>$1</h4>')
    .replace(/^#{3} (.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2} (.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{1} (.+)$/gm, '<h1>$1</h1>')
    // bold + italic combined
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // strikethrough
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    // inline code (after fenced blocks)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // images before links (same syntax, img first)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:6px;" />')
    // links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // blockquote
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    // unordered list items
    .replace(/^[-*+] (.+)$/gm, '<li>$1</li>')
    // ordered list items
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // hr
    .replace(/^---+$/gm, '<hr />')
    // double newline → paragraph break
    .replace(/\n\n+/g, '</p><p>')
    // single newline → <br> (only outside block elements)
    .replace(/\n(?!<(?:h[1-6]|ul|ol|li|blockquote|pre|hr))/g, '<br />');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
    font-size: 14px; line-height: 1.7; max-width: 780px;
    margin: 0 auto; padding: 28px 32px 64px;
    color: #d4d4d8; background: #0f1117;
  }
  h1, h2, h3, h4, h5, h6 {
    color: #f0f4ff; font-weight: 600; margin: 1.6em 0 0.5em; line-height: 1.3;
  }
  h1 { font-size: 1.875em; border-bottom: 1px solid #27272a; padding-bottom: 0.35em; }
  h2 { font-size: 1.5em;   border-bottom: 1px solid #27272a; padding-bottom: 0.25em; }
  h3 { font-size: 1.25em; }
  h4 { font-size: 1.1em; }
  p { margin: 0.65em 0; }
  a { color: #7dd3fc; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    background: #1e1e2e; padding: 2px 6px; border-radius: 4px;
    font-size: 0.875em; font-family: 'JetBrains Mono', 'Fira Code', monospace;
    color: #93c5fd; border: 1px solid #27272a;
  }
  pre {
    background: #1a1a2e; border: 1px solid #27272a; border-radius: 8px;
    padding: 16px 20px; overflow-x: auto; margin: 1.2em 0;
  }
  pre code {
    background: transparent; border: none; padding: 0;
    font-size: 0.8125em; color: #a5b4fc; line-height: 1.6;
  }
  blockquote {
    border-left: 3px solid #6358ff; margin: 1em 0;
    padding: 0.4em 0 0.4em 1.1em; color: #a1a1aa;
    background: rgba(99,88,255,0.06); border-radius: 0 6px 6px 0;
  }
  li { margin: 0.25em 0; padding-left: 0.25em; }
  hr { border: 0; border-top: 1px solid #27272a; margin: 2em 0; }
  img { max-width: 100%; border-radius: 6px; }
  strong { color: #f0f4ff; font-weight: 600; }
  del { color: #71717a; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #27272a; padding: 8px 12px; text-align: left; }
  th { background: #1a1a2e; color: #f0f4ff; font-weight: 600; }
  tr:nth-child(even) { background: rgba(255,255,255,0.02); }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
</style>
</head>
<body><p>${body}</p></body>
</html>`;
}

/** Extract replacement text from a unified diff (full-file replace hunks). */
function contentAfterUnifiedDiff(patch: string): string | null {
  const lines = patch.split('\n');
  const out: string[] = [];
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) out.push(line.slice(1));
  }
  return out.length > 0 ? out.join('\n') : null;
}

export const MonacoEditorView: React.FC<MonacoEditorViewProps> = ({
  onChange,
  onSave,
  onCursorPositionChange,
  onEditorModelMeta,
  workspaceContext: _workspaceContext = null,
  mdViewMode: mdViewModeProp,
  onMdViewModeChange,
  hideMdViewToggle = false,
}) => {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeFile,
    closeSavedFiles,
    closeAllFiles,
    dirtyFileCount,
    updateActiveContent,
    discardChanges,
    questionsIntake,
  } = useEditor();
  const activeFile = tabs.find(t => t.id === activeTabId) || null;
  const isDirty = activeFile?.isDirty;
  const savedFileCount = tabs.length - dirtyFileCount;

  const monaco = useMonacoSafe();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const [editorThemeId, setEditorThemeId] = useState(resolveMonacoThemeId);
  const contentListenerRef = useRef<{ dispose?: () => void } | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursorPositionChange);
  const onEditorModelMetaRef = useRef(onEditorModelMeta);
  const updateActiveContentRef = useRef(updateActiveContent);
  const syncingContentRef = useRef(false);
  onChangeRef.current = onChange;
  onCursorRef.current = onCursorPositionChange;
  onEditorModelMetaRef.current = onEditorModelMeta;
  updateActiveContentRef.current = updateActiveContent;
  const [showDiff, setShowDiff] = useState(false);
  const [copied, setCopied] = useState(false);
  const [gitActionHint, setGitActionHint] = useState<string | null>(null);
  const [mdViewModeLocal, setMdViewModeLocal] = useState<'source' | 'split' | 'preview'>('split');
  const mdViewMode = mdViewModeProp ?? mdViewModeLocal;
  const setMdViewMode = (mode: 'source' | 'split' | 'preview') => {
    if (onMdViewModeChange) onMdViewModeChange(mode);
    else setMdViewModeLocal(mode);
  };

  const isMarkdown = Boolean(activeFile?.name?.match(/\.(md|markdown)$/i));

  const resolvedKind =
    activeFile?.fileKind ||
    (activeFile?.isImage
      ? 'image'
      : activeFile?.isBinary
        ? 'binary'
        : activeFile
          ? detectFileKind({
              name: activeFile.name,
              key: activeFile.r2Key,
              contentType: activeFile.contentType,
              size: activeFile.size,
            })
          : 'text');
  const showQuestionsIntake = activeFile?.fileKind === 'questions_intake';
  const showMediaPreview = Boolean(activeFile && !isEditableTextKind(resolvedKind) && !showQuestionsIntake);
  const hasDiffData =
    activeFile?.originalContent !== undefined &&
    activeFile.originalContent !== activeFile.content;
  const showMonacoBody = Boolean(
    activeFile &&
    !showMediaPreview &&
    !showQuestionsIntake &&
    !(showDiff && hasDiffData) &&
    !(isMarkdown && mdViewMode === 'preview'),
  );

  useEffect(() => {
    if (!monaco) return;
    const syncTheme = () => {
      const id = applyMonacoTheme(monaco);
      setEditorThemeId((prev) => (prev === id ? prev : id));
    };
    syncTheme();
    window.addEventListener('iam:cms-theme-applied', syncTheme);
    const mo = new MutationObserver(syncTheme);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-monaco-theme', 'data-monaco-theme-data'],
    });
    return () => {
      window.removeEventListener('iam:cms-theme-applied', syncTheme);
      mo.disconnect();
    };
  }, [monaco]);

  useEffect(() => {
    const onLayout = () => {
      try {
        editorRef.current?.layout();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('iam:monaco-layout', onLayout);
    window.addEventListener('resize', onLayout);
    return () => {
      window.removeEventListener('iam:monaco-layout', onLayout);
      window.removeEventListener('resize', onLayout);
    };
  }, []);

  // Agent Cmd+I Handler
  useEffect(() => {
    if (!monaco || !editorRef.current) return;
    const editor = editorRef.current;
    
    const disposable = editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => {
      const selection = editor.getSelection();
      if (!selection || !activeFile) return;
      const selectedText = editor.getModel()?.getValueInRange(selection);
      if (!selectedText) return;

      // Dispatch a custom event that ChatAssistant.tsx will listen to
      window.dispatchEvent(new CustomEvent('iam:agent-refactor', { 
        detail: { 
          selection: selectedText,
          path: activeFile.id,
          content: activeFile.content 
        } 
      }));
    });

    return () => disposable?.dispose?.();
  }, [monaco, activeFile]);

  const pushModelMeta = useCallback(
    (editor: { getModel: () => { getOptions: () => { tabSize: number; insertSpaces: boolean }; getEOL: () => string } | null }) => {
      const onMeta = onEditorModelMetaRef.current;
      if (!onMeta) return;
      const m = editor.getModel();
      if (!m) return;
      const o = m.getOptions();
      const raw = m.getEOL();
      onMeta({
        tabSize: o.tabSize,
        insertSpaces: o.insertSpaces,
        eol: raw === '\r\n' ? 'CRLF' : 'LF',
        encoding: 'UTF-8',
      });
    },
    [],
  );

  useEffect(() => {
    const onFormat = () => {
      const ed = editorRef.current;
      if (!ed) return;
      void ed.getAction('editor.action.formatDocument')?.run();
    };
    window.addEventListener('iam-format-document', onFormat);
    return () => window.removeEventListener('iam-format-document', onFormat);
  }, []);

  // IAM_COLLAB iam_monaco_patch — apply agent file writes when this tab is open
  useEffect(() => {
    const applyFullContent = (filePath: string, nextContent: string) => {
      const tab = activeFileRef.current;
      const editor = editorRef.current;
      if (!tab || !editor) return;
      if (!collabPathMatchesTab(tab, filePath)) return;
      const model = editor.getModel();
      if (!model) return;
      syncingContentRef.current = true;
      try {
        const fullRange = model.getFullModelRange();
        editor.executeEdits('iam_local_fs_write', [{ range: fullRange, text: nextContent }]);
        updateActiveContentRef.current(nextContent);
        onChangeRef.current?.(nextContent);
      } finally {
        syncingContentRef.current = false;
      }
    };

    const onMonacoPatch = (e: Event) => {
      const detail = (e as CustomEvent<{ filePath?: string; patch?: string }>).detail || {};
      const filePath = typeof detail.filePath === 'string' ? detail.filePath.trim() : '';
      const patch = typeof detail.patch === 'string' ? detail.patch : '';
      if (!filePath || !patch) return;
      if (!monaco) return;
      const nextContent = contentAfterUnifiedDiff(patch);
      if (nextContent == null) return;
      applyFullContent(filePath, nextContent);
    };

    // client_fs fulfill write — full file body (not unified diff)
    const onLocalFsWritten = (e: Event) => {
      const detail =
        (e as CustomEvent<{ path?: string; content?: string }>).detail || {};
      const filePath = typeof detail.path === 'string' ? detail.path.trim() : '';
      if (!filePath || typeof detail.content !== 'string') return;
      applyFullContent(filePath, detail.content);
    };

    window.addEventListener('iam:monaco_patch', onMonacoPatch as EventListener);
    window.addEventListener('iam:local_fs_file_written', onLocalFsWritten as EventListener);
    return () => {
      window.removeEventListener('iam:monaco_patch', onMonacoPatch as EventListener);
      window.removeEventListener('iam:local_fs_file_written', onLocalFsWritten as EventListener);
    };
  }, [monaco]);

  // Cmd+S / Ctrl+S handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (activeFile?.fileKind === 'truncated') return;
        if (activeFile && onSave) {
          onSave(activeFile.content);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeFile, onSave]);

  // Host DOM for Monaco differs between markdown source vs split — remount when that changes.
  const monacoHostKey = !isMarkdown
    ? 'text'
    : mdViewMode === 'split'
      ? 'md-split'
      : mdViewMode === 'source'
        ? 'md-source'
        : 'md-hidden';

  // Create Monaco once per host; tab switches use setModel (per-file undo stacks).
  useLayoutEffect(() => {
    if (!monaco || !showMonacoBody) {
      contentListenerRef.current?.dispose?.();
      contentListenerRef.current = null;
      editorRef.current?.dispose?.();
      editorRef.current = null;
      return;
    }

    let cursorDisposable: { dispose?: () => void } | null = null;
    let todoHighlight: { dispose: () => void } | null = null;
    let tokenInspector: { dispose: () => void } | null = null;
    let cancelled = false;

    const mountEditor = () => {
      if (cancelled || editorRef.current || !containerRef.current) return;

      const editor = monaco.editor.create(
        containerRef.current,
        buildStandaloneEditorOptions(false, false),
      );
      editorRef.current = editor;
      todoHighlight = attachMonacoTodoHighlight(monaco, editor);
      tokenInspector = attachMonacoTokenInspector(monaco, editor);

      const bootstrap = editor.getModel();
      if (bootstrap) bootstrap.dispose();

      const push = () => {
        const p = editor.getPosition();
        const onCursor = onCursorRef.current;
        if (p && onCursor) onCursor(p.lineNumber, p.column);
      };
      cursorDisposable = editor.onDidChangeCursorPosition(() => push());

      contentListenerRef.current = editor.onDidChangeModelContent(() => {
        if (syncingContentRef.current) return;
        if (activeFileRef.current?.fileKind === 'truncated') return;
        const v = editor.getValue();
        updateActiveContentRef.current(v);
        onChangeRef.current?.(v);
      });

      pushModelMeta(editor);
      push();
    };

    mountEditor();
    const raf = requestAnimationFrame(mountEditor);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      tokenInspector?.dispose();
      tokenInspector = null;
      todoHighlight?.dispose();
      todoHighlight = null;
      cursorDisposable?.dispose?.();
      contentListenerRef.current?.dispose?.();
      contentListenerRef.current = null;
      editorRef.current?.dispose?.();
      editorRef.current = null;
    };
  }, [monaco, showMonacoBody, pushModelMeta, monacoHostKey]);

  /** Cmd+K # content hits → reveal line after file open */
  useEffect(() => {
    const onReveal = (e: Event) => {
      const detail = (e as CustomEvent<{ line?: number; column?: number }>).detail || {};
      const line = Number(detail.line);
      const column = Number(detail.column) || 1;
      if (!Number.isFinite(line) || line < 1) return;
      const editor = editorRef.current;
      if (!editor) return;
      const pos = { lineNumber: Math.floor(line), column: Math.max(1, Math.floor(column)) };
      editor.revealLineInCenter(pos.lineNumber);
      editor.setPosition(pos);
      editor.focus();
      const onCursor = onCursorRef.current;
      if (onCursor) onCursor(pos.lineNumber, pos.column);
    };
    window.addEventListener('iam-editor-reveal', onReveal as EventListener);
    return () => window.removeEventListener('iam-editor-reveal', onReveal as EventListener);
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !monaco || !activeFile) return;

    const modelPath = resolveMonacoModelPath(activeFile);
    const lang = monacoLanguageForFilename(activeFile.name);
    const fileModel = getOrCreateMonacoModel({
      monaco,
      path: modelPath,
      content: activeFile.content ?? '',
      language: lang,
    });

    if (editor.getModel() !== fileModel) {
      editor.setModel(fileModel);
    } else {
      const next = activeFile.content ?? '';
      if (fileModel.getValue() !== next) {
        syncingContentRef.current = true;
        try {
          fileModel.setValue(next);
        } finally {
          syncingContentRef.current = false;
        }
      }
    }

    const isLarge = (activeFile.content?.length ?? 0) > LARGE_FILE_CHAR_THRESHOLD;
    const isTruncated = activeFile.fileKind === 'truncated';
    editor.updateOptions(buildStandaloneEditorOptions(isLarge, isTruncated));
    pushModelMeta(editor);
    // Re-bind after Source↔Split remount (monacoHostKey) — otherwise Source stays blank.
  }, [activeFile?.id, activeFile?.content, activeFile?.fileKind, activeFile?.name, monaco, pushModelMeta, monacoHostKey]);

  useEffect(() => {
    setShowDiff(false);
    setMdViewMode('split');
  }, [activeFile?.id]);

  useEffect(() => {
    const ed = editorRef.current;
    if (ed && activeFile) pushModelMeta(ed);
  }, [activeFile?.id, pushModelMeta]);

  // Force Monaco to reflow when split view mode changes (e.g. source↔split width shift)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try { editorRef.current?.layout(); } catch { /* ignore */ }
    });
    return () => cancelAnimationFrame(raf);
  }, [mdViewMode]);

  // Monaco Completions Integration
  useEffect(() => {
    if (!monaco || !activeFile) return;
    const lang = monacoLanguageForFilename(activeFile.name);
    const disposable = monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ['.', '(', '[', '{', ' ', ':', '='],
      provideCompletionItems: async (model, position) => {
        const rangeBefore = {
          startLineNumber: Math.max(1, position.lineNumber - 120),
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        };
        const context = model.getValueInRange(rangeBefore).slice(-4000);
        try {
          const res = await fetch('/api/monaco/complete', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context, language: lang, mode: 'explain' }),
          });
          if (!res.ok) return { suggestions: [] };
          const j = (await res.json()) as { text?: string; error?: string };
          if (j.error || !j.text?.trim()) return { suggestions: [] };
          const line = j.text.trim().split('\n')[0] ?? '';
          if (!line) return { suggestions: [] };
          return {
            suggestions: [
              {
                label: line.length > 72 ? `${line.slice(0, 69)}…` : line,
                kind: monaco.languages.CompletionItemKind.Text,
                insertText: line,
                range: {
                  startLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column,
                },
              },
            ],
          };
        } catch {
          return { suggestions: [] };
        }
      },
    });
    return () => disposable?.dispose?.();
  }, [monaco, activeFile?.id]);

  const handleCopy = useCallback(() => {
    if (activeFile?.content) {
      navigator.clipboard.writeText(activeFile.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [activeFile]);

  const requestGitSyncProposal = useCallback(async () => {
    setGitActionHint(null);
    try {
      const res = await fetch('/api/agent/git/sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        proposal_id?: string;
        error?: string;
      };
      if (res.ok && j.proposal_id) setGitActionHint(`Sync proposal queued: ${j.proposal_id}`);
      else setGitActionHint(j.error || `Git sync failed (${res.status})`);
    } catch (e) {
      setGitActionHint(e instanceof Error ? e.message : 'Git sync request failed');
    }
    window.setTimeout(() => setGitActionHint(null), 12000);
  }, []);

  const refreshGitStatus = useCallback(async () => {
    setGitActionHint(null);
    try {
      const res = await fetch('/api/agent/git/status', { credentials: 'same-origin' });
      const j = (await res.json().catch(() => ({}))) as {
        branch?: string;
        git_hash?: string | null;
        error?: string;
      };
      if (res.ok && j.branch) {
        const short = j.git_hash ? String(j.git_hash).slice(0, 7) : 'unknown';
        setGitActionHint(`Deploy ref: ${j.branch} @ ${short}`);
      } else {
        setGitActionHint(j.error || `Git status failed (${res.status})`);
      }
    } catch (e) {
      setGitActionHint(e instanceof Error ? e.message : 'Git status request failed');
    }
    window.setTimeout(() => setGitActionHint(null), 10000);
  }, []);

  if (!activeFile) {
    return (
      <div className="flex-1 bg-[var(--scene-bg)] flex items-center justify-center select-none h-full">
        <div className="flex flex-col items-center gap-4 text-muted text-center px-8">
          <SetiFileIcon filename="untitled.txt" size={40} className="opacity-30" />
          <p className="text-[13px] font-medium">No files open</p>
          <p className="text-[11px] opacity-60 max-w-xs leading-relaxed">
            Open a file from the Explorer panel to begin. Multi-tab editing enabled.
          </p>
        </div>
      </div>
    );
  }

  const language = monacoLanguageForFilename(activeFile.name);

  const previewUrl =
    activeFile.previewUrl ||
    (activeFile.localObjectUrl ? activeFile.localObjectUrl : null) ||
    (activeFile.r2Bucket && activeFile.r2Key
      ? buildR2ObjectUrl(activeFile.r2Bucket, activeFile.r2Key)
      : null);

  const isTruncated = resolvedKind === 'truncated';
  const totalKb = activeFile.originalSize
    ? (activeFile.originalSize / 1024).toFixed(0)
    : activeFile.size
      ? (activeFile.size / 1024).toFixed(0)
      : null;

  const mdViewToggle =
    isMarkdown && !hideMdViewToggle ? (
    <div
      className="flex items-center rounded border border-[var(--dashboard-border)] overflow-hidden shrink-0 ml-auto mr-2"
      role="group"
      aria-label="Markdown view mode"
    >
      {(['source', 'split', 'preview'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMdViewMode(mode);
          }}
          className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-all border-r border-[var(--dashboard-border)] last:border-r-0 ${
            mdViewMode === mode
              ? 'bg-[var(--solar-cyan)] text-black'
              : 'text-muted hover:text-[var(--solar-cyan)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          {mode === 'source' ? 'Source' : mode === 'split' ? 'Split' : 'Preview'}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="flex flex-col h-full w-full bg-[var(--scene-bg)] overflow-hidden">
      {/* ── Tab Header (+ markdown Source/Split/Preview on the tab row) ── */}
      <div className="h-9 flex items-center border-b border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] shrink-0 min-w-0">
        <div className="flex items-center flex-1 min-w-0 overflow-x-auto no-scrollbar">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 h-9 border-r border-[var(--dashboard-border)] cursor-pointer select-none transition-all group min-w-[120px] max-w-[200px] ${
                activeTabId === tab.id
                  ? 'bg-[var(--scene-bg)] text-[var(--solar-cyan)] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--solar-cyan)] relative'
                  : 'text-muted hover:bg-[var(--dashboard-canvas)]'
              }`}
            >
              <SetiFileIcon filename={tab.name} size={14} />
              <span className="text-[11px] font-mono truncate flex-1">{tab.name}</span>
              {tab.isDirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--solar-yellow)] shrink-0" />
              )}
              <X
                size={12}
                className="text-inherit opacity-0 group-hover:opacity-100 hover:text-[var(--solar-red)] transition-all"
                onClick={(e) => {
                  e.stopPropagation();
                  if (monaco) {
                    disposeMonacoModelForPath(monaco, resolveMonacoModelPath(tab));
                  }
                  closeFile(tab.id);
                }}
              />
            </div>
          ))}
        </div>
        {tabs.length > 0 && (
          <div className="flex items-center gap-1 px-2 shrink-0 border-l border-[var(--dashboard-border)]">
            {dirtyFileCount > 0 && (
              <span
                className="px-1.5 py-0.5 rounded bg-[var(--solar-yellow)]/15 text-[var(--solar-yellow)] text-[9px] font-bold tabular-nums"
                title={`${dirtyFileCount} file${dirtyFileCount === 1 ? '' : 's'} with unsaved changes`}
                aria-label={`${dirtyFileCount} unsaved file${dirtyFileCount === 1 ? '' : 's'}`}
              >
                {dirtyFileCount} unsaved
              </span>
            )}
            <button
              type="button"
              disabled={savedFileCount === 0}
              onClick={() => {
                if (monaco) {
                  tabs
                    .filter((tab) => !tab.isDirty)
                    .forEach((tab) => disposeMonacoModelForPath(monaco, resolveMonacoModelPath(tab)));
                }
                closeSavedFiles();
              }}
              className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide text-muted hover:text-[var(--solar-cyan)] hover:bg-[var(--bg-hover)] disabled:opacity-35 disabled:pointer-events-none"
              title={savedFileCount > 0 ? `Close ${savedFileCount} saved file${savedFileCount === 1 ? '' : 's'}` : 'No saved files to close'}
            >
              Close saved
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  dirtyFileCount > 0 &&
                  !window.confirm(
                    `Close all files? ${dirtyFileCount} file${dirtyFileCount === 1 ? ' has' : 's have'} unsaved changes.`,
                  )
                ) {
                  return;
                }
                if (monaco) {
                  tabs.forEach((tab) =>
                    disposeMonacoModelForPath(monaco, resolveMonacoModelPath(tab)),
                  );
                }
                closeAllFiles();
              }}
              className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide text-muted hover:text-[var(--solar-red)] hover:bg-[var(--bg-hover)]"
              title="Close all open files"
            >
              Close all
            </button>
          </div>
        )}
        {mdViewToggle}
      </div>

      {/* ── Editor Toolbar (Active Tab Stats) ── */}
      <div className="h-8 flex items-center justify-between px-3 bg-[var(--scene-bg)] border-b border-[var(--dashboard-border)] shrink-0">
        <div className="flex items-center gap-4 text-[10px] uppercase tracking-widest text-muted font-bold">
           <span>{language}</span>
           <span className="opacity-50">UTF-8</span>
           {gitActionHint && <span className="text-[var(--solar-cyan)] animate-pulse">{gitActionHint}</span>}
        </div>
        <div className="flex items-center gap-2">
           {hasDiffData && (
             <button onClick={() => setShowDiff(!showDiff)} className={`px-2 py-0.5 rounded border transition-all ${showDiff ? 'bg-[var(--solar-cyan)] text-black border-[var(--solar-cyan)]' : 'border-[var(--dashboard-border)]'}`}>
               Diff
             </button>
           )}
           {hasDiffData && showDiff && activeFile && (
             <>
               <button
                 type="button"
                 onClick={() => {
                   onSave?.(activeFile.content);
                   setShowDiff(false);
                 }}
                 className="px-2 py-0.5 rounded border border-[var(--color-success)] bg-[var(--color-success)]/15 text-[var(--color-success)] font-bold transition-all hover:bg-[var(--color-success)]/25"
                 title="Accept changes"
               >
                 Accept
               </button>
               <button
                 type="button"
                 onClick={() => {
                   onSave?.(activeFile.originalContent ?? '');
                   setShowDiff(false);
                 }}
                 className="px-2 py-0.5 rounded border border-[var(--color-danger)] bg-[var(--color-danger)]/15 text-[var(--color-danger)] font-bold transition-all hover:bg-[var(--color-danger)]/25"
                 title="Reject changes"
               >
                 Reject
               </button>
             </>
           )}
           {isDirty && !isTruncated && (
             <button 
                onClick={() => onSave?.(activeFile.content)}
                className="px-3 py-0.5 bg-[var(--solar-cyan)] text-black rounded font-bold shadow-[0_0_10px_rgba(45,212,191,0.2)]"
              >
               Save
             </button>
           )}
        </div>
      </div>

      {/* ── Editor Body ── */}
      <div className="flex-1 overflow-hidden relative">
        {showQuestionsIntake ? (
          questionsIntake ? (
            <QuestionsIntakePage
              batch={questionsIntake.batch}
              busy={questionsIntake.busy}
              onSubmit={questionsIntake.onSubmit}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-[var(--dashboard-muted)]">
              No pending questions.
            </div>
          )
        ) : showMediaPreview ? (
          <FilePreview
            kind={resolvedKind === 'unknown' ? 'binary' : resolvedKind}
            name={activeFile.name}
            url={previewUrl || ''}
            contentType={activeFile.contentType}
            size={activeFile.size}
            message={activeFile.binaryMessage}
            onRevokeObjectUrl={
              activeFile.localObjectUrl
                ? () => {
                    try {
                      URL.revokeObjectURL(activeFile.localObjectUrl!);
                    } catch {
                      /* ignore */
                    }
                  }
                : undefined
            }
          />
        ) : showDiff && hasDiffData ? (
          <DiffEditor
            height="100%"
            language={language}
            theme={editorThemeId}
            original={activeFile.originalContent ?? ''}
            modified={activeFile.content}
            beforeMount={(m) => {
              applyMonacoTheme(m);
            }}
            options={buildDiffEditorOptions({ modifiedEditable: !isTruncated })}
          />
        ) : isMarkdown && mdViewMode === 'preview' ? (
          /* ── Markdown: Preview only ── */
          <iframe
            key={`md-preview-${activeFile.id}`}
            title={`Preview ${activeFile.name}`}
            srcDoc={markdownToHtml(activeFile.content ?? '')}
            sandbox="allow-scripts"
            className="absolute inset-0 w-full h-full border-0"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          />
        ) : isMarkdown && mdViewMode === 'split' ? (
          /* ── Markdown: Split view (Monaco left | preview right) ── */
          <div className="flex h-full w-full min-h-0">
            {/* Monaco pane */}
            <div className="flex flex-col min-h-0 min-w-0" style={{ width: '50%', borderRight: '1px solid var(--dashboard-border)' }}>
              {isTruncated && (
                <div
                  className="px-3 py-1.5 text-xs bg-[var(--accent-warning)] text-[var(--bg-primary,#060e14)] flex items-center gap-2 shrink-0 border-b border-[var(--dashboard-border)]"
                  role="status"
                >
                  <span>Showing first 500KB — save disabled</span>
                </div>
              )}
              <div ref={containerRef} className="flex-1 min-h-0 w-full" />
            </div>
            {/* Preview pane */}
            <div className="relative min-h-0 min-w-0 flex flex-col" style={{ width: '50%' }}>
              <div
                className="shrink-0 px-3 py-1 text-[10px] uppercase tracking-widest text-muted border-b border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] flex items-center gap-2"
                style={{ pointerEvents: 'none', zIndex: 1 }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--solar-cyan)] inline-block" />
                Preview
              </div>
              <iframe
                key={`md-split-${activeFile.id}`}
                title={`Split preview ${activeFile.name}`}
                srcDoc={markdownToHtml(activeFile.content ?? '')}
                sandbox="allow-scripts"
                className="flex-1 w-full border-0 min-h-0"
                style={{ display: 'block' }}
              />
            </div>
          </div>
        ) : (
          /* ── Default: Monaco source (+ markdown source mode) ── */
          <div className="flex flex-col h-full w-full min-h-0">
            {isTruncated && (
              <div
                className="px-3 py-1.5 text-xs bg-[var(--accent-warning)] text-[var(--bg-primary,#060e14)] flex items-center gap-2 shrink-0 border-b border-[var(--dashboard-border)]"
                role="status"
              >
                <span>
                  Showing first 500KB of {activeFile.name}
                  {totalKb ? ` (${totalKb}KB total)` : ''} — save disabled
                </span>
              </div>
            )}
            <div ref={containerRef} className="flex-1 min-h-0 w-full" />
          </div>
        )}
      </div>
    </div>
  );
};
