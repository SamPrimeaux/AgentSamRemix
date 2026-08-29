/**
 * Compact Monaco diff for in-chat code previews (read-only).
 *
 * @license SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState, useEffect } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import {
  applyMonacoTheme,
  buildDiffEditorOptions,
  resolveMonacoThemeId,
} from '../../../src/lib/monacoThemes';

const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  css: 'css',
  html: 'html',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  sql: 'sql',
  sh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
};

function monacoLanguage(lang: string | undefined, path: string | undefined): string {
  if (lang && lang.trim()) {
    const k = lang.trim().toLowerCase();
    return LANG_MAP[k] || k;
  }
  const m = String(path || '').match(/\.([a-z0-9]+)$/i);
  if (m) {
    const ext = m[1].toLowerCase();
    return LANG_MAP[ext] || ext;
  }
  return 'plaintext';
}

/** Slice to changed hunk ±context for inline chat bubbles (~4 lines). */
export function compactDiffSlice(
  before: string,
  after: string,
  contextLines = 2,
  maxLines = 4,
): { before: string; after: string } {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  let firstDiff = 0;
  while (firstDiff < maxLen && beforeLines[firstDiff] === afterLines[firstDiff]) firstDiff++;
  if (firstDiff >= maxLen) return { before, after };

  let lastDiff = maxLen - 1;
  while (lastDiff > firstDiff && beforeLines[lastDiff] === afterLines[lastDiff]) lastDiff--;

  const start = Math.max(0, firstDiff - contextLines);
  let bSlice = beforeLines.slice(start, Math.min(beforeLines.length, lastDiff + contextLines + 1));
  let aSlice = afterLines.slice(start, Math.min(afterLines.length, lastDiff + contextLines + 1));

  if (bSlice.length > maxLines) {
    const rel = firstDiff - start;
    const from = Math.max(0, rel - 1);
    bSlice = bSlice.slice(from, from + maxLines);
    aSlice = aSlice.slice(from, from + maxLines);
  }

  return { before: bSlice.join('\n'), after: aSlice.join('\n') };
}

export type DiffViewerProps = {
  before: string;
  after: string;
  language?: string;
  path?: string;
  /** Max height for the diff widget */
  heightPx?: number;
  className?: string;
  /** Inline chat bubble — ~4 lines around the change hunk */
  compact?: boolean;
  /** Mobile Diff tab — inline unified diff, word wrap, collapse unchanged regions */
  mobileInline?: boolean;
};

export function DiffViewer({
  before,
  after,
  language,
  path,
  heightPx = 200,
  className = '',
  compact = false,
  mobileInline = false,
}: DiffViewerProps) {
  const monacoLang = useMemo(() => monacoLanguage(language, path), [language, path]);
  const display = useMemo(
    () => (compact ? compactDiffSlice(before, after) : { before, after }),
    [before, after, compact],
  );
  const resolvedHeight = compact ? 96 : heightPx;
  const [themeId, setThemeId] = useState(resolveMonacoThemeId);

  useEffect(() => {
    const sync = () => setThemeId(resolveMonacoThemeId());
    window.addEventListener('iam:cms-theme-applied', sync);
    return () => window.removeEventListener('iam:cms-theme-applied', sync);
  }, []);

  return (
    <div
      className={`overflow-hidden rounded-lg border border-white/[0.06] bg-black/30 ${className}`.trim()}
      style={{ height: resolvedHeight, minHeight: compact ? 72 : 120 }}
    >
      <DiffEditor
        height="100%"
        language={monacoLang}
        theme={themeId}
        original={display.before}
        modified={display.after}
        beforeMount={(m) => {
          applyMonacoTheme(m);
        }}
        options={{
          ...buildDiffEditorOptions({ isLarge: false, modifiedEditable: false }),
          readOnly: true,
          fontSize: mobileInline ? 11 : 12,
          padding: { top: 8, bottom: 8 },
          ...(mobileInline
            ? {
                renderSideBySide: false,
                diffWordWrap: 'on',
                hideUnchangedRegions: {
                  enabled: true,
                  minimumLineCount: 3,
                  contextLineCount: 2,
                },
              }
            : null),
        }}
      />
    </div>
  );
}
