/**
 * In-chat diff card — Monaco diff + click to open full editor with patch applied.
 *
 * @license SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import { ExternalLink } from 'lucide-react';
import { SetiFileIcon } from '../../../src/components/SetiFileIcon';
import type { ActiveFile } from '../../../types';
import { DiffViewer } from './DiffViewer';

export type AgentCodeDiffPreviewProps = {
  path: string;
  before: string;
  after: string;
  language?: string;
  onOpenMonaco?: (file: Pick<ActiveFile, 'name' | 'content'> & Partial<ActiveFile>) => void;
};

function fileNameFromPath(path: string): string {
  const p = String(path || '').trim().replace(/^\/+/, '');
  const base = p.split('/').pop() || 'patch';
  return base.includes('.') ? base : `${base}.txt`;
}

export function AgentCodeDiffPreview({
  path,
  before,
  after,
  language,
  onOpenMonaco,
}: AgentCodeDiffPreviewProps) {
  const name = fileNameFromPath(path);
  const added = Math.max(0, after.split('\n').length - before.split('\n').length);
  const removed = Math.max(0, before.split('\n').length - after.split('\n').length);

  const openMonaco = useCallback(() => {
    onOpenMonaco?.({
      name,
      content: after,
      originalContent: before,
    });
  }, [after, before, name, onOpenMonaco]);

  return (
    <button
      type="button"
      onClick={openMonaco}
      disabled={!onOpenMonaco}
      className="group my-3 w-full min-w-0 max-w-full text-left rounded-2xl border border-white/[0.08] bg-[color-mix(in_srgb,var(--dashboard-panel)_70%,transparent)] backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden transition-colors hover:border-[var(--solar-cyan)]/35 disabled:cursor-default disabled:opacity-90"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/[0.06] bg-[var(--dashboard-panel)]/60">
        <div className="flex items-center gap-2 min-w-0">
          <SetiFileIcon filename={path || 'diff.patch'} size={14} className="shrink-0" />
          <span className="truncate text-[0.75rem] font-mono font-medium text-[var(--dashboard-text)]">
            {path || name}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {removed > 0 ? (
            <span className="text-[0.625rem] font-mono text-red-400/90">−{removed}</span>
          ) : null}
          {added > 0 ? (
            <span className="text-[0.625rem] font-mono text-emerald-400/90">+{added}</span>
          ) : null}
          <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-[var(--dashboard-muted)] group-hover:text-[var(--solar-cyan)]">
            Open
            <ExternalLink size={12} className="opacity-70" aria-hidden />
          </span>
        </div>
      </div>
      <div className="p-2 pointer-events-none">
        <DiffViewer before={before} after={after} language={language} path={path} compact />
      </div>
    </button>
  );
}
