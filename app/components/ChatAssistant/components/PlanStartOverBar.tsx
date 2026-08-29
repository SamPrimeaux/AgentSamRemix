/**
 * Active plan controls — revert blocked tasks or refine via chat (@plan …).
 */

import React, { useState } from 'react';
import { RotateCcw, Pencil } from 'lucide-react';

export type PlanStartOverBarProps = {
  planId: string;
  planTitle?: string;
  onReverted?: () => void;
  onRefineHint?: () => void;
  isNarrow?: boolean;
};

export const PlanStartOverBar: React.FC<PlanStartOverBarProps> = ({
  planId,
  planTitle,
  onReverted,
  onRefineHint,
  isNarrow = false,
}) => {
  const [busy, setBusy] = useState(false);

  const handleRevert = async () => {
    if (busy || !planId.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/agent/plan/revert', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId }),
      });
      if (res.ok) onReverted?.();
    } catch {
      /* non-fatal */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-[var(--dashboard-border)]/80 bg-[var(--scene-bg)]/50 ${
        isNarrow ? 'flex-wrap px-2.5 py-2' : 'px-3 py-2'
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--dashboard-muted)]">
        Active plan: <span className="font-medium text-[var(--dashboard-text)]">{planTitle || planId}</span>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleRevert()}
        className="inline-flex items-center gap-1 rounded-full border border-[var(--dashboard-border)] px-2.5 py-1 min-h-[32px] text-[10px] font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
      >
        <RotateCcw size={12} />
        {busy ? 'Resetting…' : 'Start over'}
      </button>
      <button
        type="button"
        onClick={onRefineHint}
        className="inline-flex items-center gap-1 rounded-full border border-[var(--solar-cyan)]/30 px-2.5 py-1 min-h-[32px] text-[10px] font-medium text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/10"
      >
        <Pencil size={12} />
        Refine (@plan)
      </button>
    </div>
  );
};
