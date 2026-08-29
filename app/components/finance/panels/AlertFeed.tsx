// app/dashboard/components/finance/panels/AlertFeed.tsx

import React, { useState } from 'react';
import { cn } from '../../../lib/utils';
import { SpendAlert } from '../types';
import { fmt, SEVERITY_COLORS } from '../constants';
import { resolveAlert } from '../hooks/useFinanceData';

interface Props {
  alerts: SpendAlert[];
  onRefresh: () => void;
}

const SEVERITY_LABELS: Record<string, string> = {
  info:     'Info',
  warning:  'Warning',
  critical: 'Critical',
};

export function AlertFeed({ alerts, onRefresh }: Props) {
  const [resolving, setResolving] = useState<number | null>(null);
  const [err, setErr] = useState('');

  async function handleResolve(id: number) {
    setResolving(id);
    setErr('');
    try {
      await resolveAlert(id);
      onRefresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setResolving(null);
    }
  }

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-2">
        <div className="text-3xl opacity-30">✓</div>
        <p className="text-sm">No unresolved spend alerts.</p>
        <p className="text-xs text-slate-600">Alerts fire automatically when model budgets are crossed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-3xl">
      {err && (
        <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
          {err}
        </div>
      )}
      {alerts.map((a) => {
        const color = SEVERITY_COLORS[a.severity] ?? '#6b7280';
        const over = a.actual_usd / a.threshold_usd;
        return (
          <div
            key={a.id}
            className="bg-[#0d2128] border border-white/[0.06] rounded-xl p-4 flex items-start gap-4"
            style={{ borderLeftColor: color, borderLeftWidth: 3 }}
          >
            {/* Severity dot */}
            <div
              className="w-2 h-2 rounded-full mt-1.5 shrink-0"
              style={{ background: color, boxShadow: `0 0 6px ${color}80` }}
            />

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5"
                  style={{
                    background: `${color}20`,
                    color,
                    border: `1px solid ${color}40`,
                  }}
                >
                  {SEVERITY_LABELS[a.severity]}
                </span>
                {a.provider_slug && (
                  <span className="text-[10px] text-slate-500 font-mono">{a.provider_slug}</span>
                )}
                <span className="text-[10px] text-slate-600">{a.period}</span>
              </div>

              <p className="text-sm text-white mt-1.5 font-medium leading-snug">{a.message}</p>

              {/* Threshold bar */}
              <div className="mt-2.5 space-y-1">
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>Actual: <span className="text-white font-semibold">{fmt.usd(a.actual_usd)}</span></span>
                  <span>Threshold: {fmt.usd(a.threshold_usd)}</span>
                </div>
                <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(over * 100, 100)}%`,
                      background: color,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Action */}
            <button
              onClick={() => handleResolve(a.id)}
              disabled={resolving === a.id}
              className={cn(
                'shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors',
                'border-white/10 text-slate-400 hover:text-white hover:border-white/25 hover:bg-white/[0.05]',
                resolving === a.id && 'opacity-40 cursor-not-allowed'
              )}
            >
              {resolving === a.id ? 'Resolving…' : 'Resolve'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
