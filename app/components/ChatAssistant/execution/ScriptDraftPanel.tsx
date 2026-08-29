/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Local actions for a Python draft opened from Agent Sam (Monaco buffer or workspace file).
 * Syntax / run are delegated to the parent so results can be recorded in ExecutionTimeline
 * (single-line commands only — no multiline paste into zsh).
 */

import React from 'react';
import { Play, Terminal, Wand2 } from 'lucide-react';
import { SetiFileIcon } from '../../../src/components/SetiFileIcon';

export type ScriptDraftPanelProps = {
  fileName: string | null;
  workspacePath?: string | null;
  onFocusEditor?: () => void;
  onSyntaxCheck?: () => void;
  onRunScript?: () => void;
  syntaxBusy?: boolean;
  runBusy?: boolean;
};

export const ScriptDraftPanel: React.FC<ScriptDraftPanelProps> = ({
  fileName,
  workspacePath,
  onFocusEditor,
  onSyntaxCheck,
  onRunScript,
  syntaxBusy,
  runBusy,
}) => {
  const isPy = !!fileName && /\.py$/i.test(fileName);
  if (!isPy) return null;

  const rel = (workspacePath || '').trim();
  const canRunOnDisk = rel.length > 0 && !rel.startsWith('mcp_tool:');

  return (
    <div className="mb-3 rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-3 py-2.5 space-y-2">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 rounded-md border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] p-1.5 text-[var(--solar-cyan)]">
          <SetiFileIcon filename={fileName || 'script.py'} size={16} />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Script draft</div>
          <div className="text-[12px] font-mono text-[var(--dashboard-text)] truncate" title={fileName || ''}>
            {fileName}
          </div>
          <p className="text-[10px] text-muted leading-snug">
            {canRunOnDisk
              ? 'Syntax check uses python3 -m py_compile; run uses python3 <path>. Both are single-line PTY commands (see Terminal when WS is connected).'
              : 'Buffer-only draft: save to your connected workspace folder to enable Syntax check and Run.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onFocusEditor?.()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--dashboard-text)] hover:border-[var(--solar-cyan)]/40"
        >
          <Wand2 size={13} className="text-[var(--solar-cyan)]" aria-hidden />
          Focus editor
        </button>
        <button
          type="button"
          disabled={!canRunOnDisk || !onSyntaxCheck || syntaxBusy}
          onClick={() => onSyntaxCheck?.()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--dashboard-text)] hover:border-[var(--solar-cyan)]/40 disabled:opacity-40 disabled:pointer-events-none"
          title={!canRunOnDisk ? 'Save file into the connected workspace first' : undefined}
        >
          <Terminal size={13} className="text-[var(--solar-yellow)]" aria-hidden />
          {syntaxBusy ? 'Syntax…' : 'Syntax check'}
        </button>
        <button
          type="button"
          disabled={!canRunOnDisk || !onRunScript || runBusy}
          onClick={() => onRunScript?.()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--solar-green)]/35 bg-[var(--solar-green)]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--solar-green)] hover:bg-[var(--solar-green)]/15 disabled:opacity-40 disabled:pointer-events-none"
          title={!canRunOnDisk ? 'Save file into the connected workspace first' : undefined}
        >
          <Play size={13} aria-hidden />
          {runBusy ? 'Run…' : 'Run'}
        </button>
      </div>
    </div>
  );
};
