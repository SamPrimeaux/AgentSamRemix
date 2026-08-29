/**
 * Inline pre-flight approval card in the chat thread (ChatGPT-style).
 */

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Play, ShieldAlert } from 'lucide-react';
import type { ToolApprovalPayload } from '../types';
import {
  defaultIntegrationLabel,
  defaultLaneFootnote,
  formatToolApprovalTitle,
  normalizeToolApprovalRisk,
  resolveToolApprovalPreview,
  toolApprovalRiskStyles,
} from '../toolApprovalCopy';
import {
  ApprovalUnifiedDiff,
  looksLikeUnifiedDiff,
} from '../../../src/components/ApprovalUnifiedDiff';

export type ToolApprovalCardProps = {
  tool: ToolApprovalPayload;
  busy?: boolean;
  onAllow: () => void;
  onDeny: () => void;
  className?: string;
};

export function ToolApprovalCard({
  tool,
  busy = false,
  onAllow,
  onDeny,
  className = '',
}: ToolApprovalCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(true);
  const preview = useMemo(() => resolveToolApprovalPreview(tool), [tool]);
  const showDiff = useMemo(() => looksLikeUnifiedDiff(preview), [preview]);
  const title = formatToolApprovalTitle(tool.name, tool.description);
  const risk = toolApprovalRiskStyles(normalizeToolApprovalRisk(tool.risk_level));
  const integration = defaultIntegrationLabel(tool);
  const laneNote = defaultLaneFootnote(tool);
  const allowLabel = /^spawn_lane_extension$/i.test(String(tool.name || ''))
    ? 'Extend budget'
    : 'Allow & run';
  const denyLabel = /^spawn_lane_extension$/i.test(String(tool.name || ''))
    ? 'Keep current cap'
    : 'Deny';

  return (
    <div
      role="region"
      aria-label="Tool approval"
      className={`w-full min-w-0 max-w-full ${className}`.trim()}
    >
      <div
        className={`relative w-full min-w-0 rounded-2xl border border-violet-500/20 bg-[color-mix(in_srgb,var(--dashboard-panel)_68%,#2d1b4e_32%)] backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 ${risk.ring} overflow-hidden`}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-500/[0.06] via-transparent to-black/[0.12]" aria-hidden />

        <div className="relative px-3 py-2.5 border-b border-white/[0.06]">
          <p className="text-[0.625rem] font-medium uppercase tracking-wide text-violet-300/90 truncate">
            {integration}
          </p>
          <div className="mt-1 flex items-start gap-2">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-400/20 text-amber-200/90">
              <ShieldAlert size={15} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] font-medium leading-snug text-[var(--dashboard-text)]">
                {title}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide ${risk.pill}`}
                >
                  {normalizeToolApprovalRisk(tool.risk_level)} risk
                </span>
                {laneNote ? (
                  <span className="text-[0.625rem] text-[var(--dashboard-muted)]">{laneNote}</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {preview ? (
          <div className="relative border-b border-white/[0.05]">
            <button
              type="button"
              onClick={() => setDetailsOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-[0.6875rem] font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-white/[0.03] transition-colors"
            >
              <span>{showDiff ? 'Diff view' : 'Details'}</span>
              {detailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {detailsOpen ? (
              showDiff ? (
                <div className="mx-2 mb-2 max-h-[min(24vh,180px)] overflow-auto rounded-xl border border-white/[0.06] bg-black/25 px-2.5 py-2">
                  <ApprovalUnifiedDiff text={preview} />
                </div>
              ) : (
                <pre className="m-0 mx-2 mb-2 max-h-[min(24vh,180px)] overflow-auto rounded-xl border border-white/[0.06] bg-black/25 px-2.5 py-2 text-[0.6875rem] font-mono text-[var(--dashboard-text)]/95 whitespace-pre-wrap break-words">
                  {preview}
                </pre>
              )
            ) : null}
          </div>
        ) : null}

        <div className="relative flex flex-wrap items-center justify-end gap-2 px-3 py-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={onDeny}
            className="inline-flex items-center justify-center min-h-[2rem] px-3 rounded-lg text-[0.72rem] font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-white/[0.04] disabled:opacity-45 transition-colors"
          >
            {denyLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onAllow}
            className="inline-flex items-center justify-center gap-1.5 min-h-[2rem] px-3.5 rounded-lg text-[0.75rem] font-semibold text-[var(--solar-base03)] bg-[var(--solar-cyan)] shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_4px_14px_rgba(34,211,238,0.22)] hover:brightness-110 disabled:opacity-45 transition-all"
          >
            <Play size={13} className="fill-current" aria-hidden />
            {busy ? 'Running…' : allowLabel}
          </button>
        </div>

        <p className="px-3 pb-2 text-[0.625rem] text-[var(--dashboard-muted)]">
          {/^spawn_lane_extension$/i.test(String(tool.name || ''))
            ? 'Fanout is paused until you decide. Deny resumes under the existing budget.'
            : 'Using tools comes with risks. Nothing runs until you allow.'}
        </p>
      </div>
    </div>
  );
}
