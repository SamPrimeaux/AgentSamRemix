import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { SqlRiskLevel, SqlStatementKind } from '../../src/lib/databaseSqlSafety';

export type SqlConfirmPayload = {
  sql: string;
  kind: SqlStatementKind;
  riskLevel: SqlRiskLevel;
  requiresConfirmTyping: boolean;
  datasourceLabel: string;
};

type Props = {
  payload: SqlConfirmPayload | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DatabaseSqlConfirmModal({ payload, onCancel, onConfirm }: Props) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    setTyped('');
  }, [payload?.sql]);

  if (!payload) return null;

  const needsConfirm = payload.requiresConfirmTyping;
  const confirmOk = !needsConfirm || typed.trim() === 'CONFIRM';

  return (
    <div className="database-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="sql-confirm-title">
      <div className="database-modal-panel">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--database-border)] px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--database-error-text)]" />
            <div>
              <h2 id="sql-confirm-title" className="text-sm font-semibold text-[var(--database-text)]">
                Confirm SQL execution
              </h2>
              <p className="mt-1 text-[11px] text-[var(--database-text-muted)]">
                This statement can change or destroy data. Review carefully before running.
              </p>
            </div>
          </div>
          <button type="button" onClick={onCancel} className="rounded p-1 text-[var(--database-text-muted)] hover:bg-[var(--database-row-hover-bg)]" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3 text-[12px]">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-[11px]">
            <dt className="text-[var(--database-text-muted)]">Datasource</dt>
            <dd>{payload.datasourceLabel}</dd>
            <dt className="text-[var(--database-text-muted)]">Statement</dt>
            <dd className="uppercase">{payload.kind}</dd>
            <dt className="text-[var(--database-text-muted)]">Risk</dt>
            <dd className="uppercase">{payload.riskLevel}</dd>
          </dl>

          <div>
            <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-[var(--database-text-muted)]">SQL preview</p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--database-border)] bg-[var(--database-bg)] p-3 font-mono text-[11px]">
              {payload.sql}
            </pre>
          </div>

          {needsConfirm ? (
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--database-error-text)]">
                Type <span className="font-mono">CONFIRM</span> to run this destructive statement
              </span>
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="CONFIRM"
                className="w-full rounded-lg border border-[var(--database-border)] bg-[var(--database-bg)] px-3 py-2 font-mono text-[12px] outline-none focus:border-[var(--database-accent)]"
              />
            </label>
          ) : (
            <p className="text-[11px] text-[var(--database-text-muted)]">
              Click <strong>Confirm and Run</strong> to execute this statement in the selected datasource.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--database-border)] px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[var(--database-border)] px-3 py-2 text-[11px] font-bold hover:bg-[var(--database-row-hover-bg)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!confirmOk}
            onClick={onConfirm}
            className="rounded-lg border border-[var(--database-error-text)]/40 bg-[var(--database-error-bg)] px-3 py-2 text-[11px] font-bold text-[var(--database-error-text)] disabled:opacity-40"
          >
            Confirm and Run
          </button>
        </div>
      </div>
    </div>
  );
}
