/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tool Request/Result mini window — read-only Monaco (same path as chat fences).
 */

import React, { useMemo } from 'react';
import {
  detectToolTraceLang,
  TOOL_TRACE_VIEWPORT_MAX_LINES,
  type ToolTracePreviewLang,
} from '../../../lib/toolTracePreview';
import { AgentCodeFencePreview } from '../components/AgentCodeFencePreview';

export type ToolTraceCodeBlockProps = {
  label: 'Request' | 'Result' | 'Output';
  text: string;
  lang?: ToolTracePreviewLang;
  onOpenInEditor?: (file: { name: string; content: string }) => void;
  editorFilename?: string;
};

const EXT_FOR_LANG: Record<ToolTracePreviewLang, string> = {
  json: 'json',
  shell: 'sh',
  diff: 'diff',
  text: 'txt',
};

/** Compact Monaco height for the agent sidebar (~9-line default collapse). */
const TOOL_TRACE_MAX_PREVIEW_H = 196;

function prettyForMonaco(raw: string, lang: ToolTracePreviewLang): string {
  if (lang !== 'json') return raw;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function splitEditorFilename(name?: string): { fileBase: string; fileExt: string } {
  const fallback = { fileBase: 'tool-trace', fileExt: 'txt' };
  if (!name || !name.trim()) return fallback;
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0 || dot === trimmed.length - 1) {
    return { fileBase: trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_') || fallback.fileBase, fileExt: 'txt' };
  }
  return {
    fileBase: trimmed.slice(0, dot).replace(/[^a-zA-Z0-9._-]+/g, '_') || fallback.fileBase,
    fileExt: trimmed.slice(dot + 1).toLowerCase() || 'txt',
  };
}

export const ToolTraceCodeBlock: React.FC<ToolTraceCodeBlockProps> = ({
  label,
  text,
  lang,
  onOpenInEditor,
  editorFilename,
}) => {
  const resolvedLang = useMemo(
    () => detectToolTraceLang(text, lang),
    [text, lang],
  );

  const displayText = useMemo(
    () => prettyForMonaco(String(text || ''), resolvedLang),
    [text, resolvedLang],
  );

  const { fileBase, fileExt } = useMemo(() => {
    const fromName = splitEditorFilename(editorFilename);
    if (editorFilename?.includes('.')) return fromName;
    return {
      fileBase: fromName.fileBase,
      fileExt: EXT_FOR_LANG[resolvedLang] || fromName.fileExt,
    };
  }, [editorFilename, resolvedLang]);

  if (!String(text || '').trim()) return null;

  return (
    <div className="tool-trace-code-block tool-trace-code-block--monaco">
      <div className="tool-trace-code-block__head">
        <span className="tool-trace-code-block__label">{label}</span>
      </div>
      <div role="region" aria-label={`${label} preview`}>
        <AgentCodeFencePreview
          lang={resolvedLang === 'text' ? 'text' : resolvedLang}
          code={displayText}
          fileBase={fileBase}
          fileExt={fileExt}
          onOpenMonaco={onOpenInEditor}
          collapseLines={TOOL_TRACE_VIEWPORT_MAX_LINES}
          maxPreviewHeightPx={TOOL_TRACE_MAX_PREVIEW_H}
          compact
          className="tool-trace-monaco-fence"
        />
      </div>
    </div>
  );
};
