import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

type Props = {
  tableName: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Cloudflare D1–style Drop Table confirm: type exact table name to enable Delete.
 */
export function DatabaseDropTableModal({ tableName, busy = false, onCancel, onConfirm }: Props) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    setTyped('');
  }, [tableName]);

  if (!tableName) return null;

  const confirmOk = typed === tableName && !busy;

  return (
    <div className="database-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="drop-table-title">
      <div className="database-modal-panel">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--database-border)] px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--database-error-text)]" />
            <div>
              <h2 id="drop-table-title" className="text-sm font-semibold text-[var(--database-text)]">
                Drop Table
              </h2>
              <p className="mt-1 text-[11px] text-[var(--database-text-muted)]">
                This permanently deletes <span className="font-mono text-[var(--database-error-text)]">{tableName}</span>{' '}
                and all of its data. This action is irreversible.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded p-1 text-[var(--database-text-muted)] hover:bg-[var(--database-row-hover-bg)] disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3 text-[12px]">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-[var(--database-error-text)]">
              Type <span className="font-mono">{tableName}</span> to confirm
            </span>
            <input
              autoFocus
              value={typed}
              disabled={busy}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={tableName}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-[var(--database-border)] bg-[var(--database-bg)] px-3 py-2 font-mono text-[12px] outline-none focus:border-[var(--database-error-text)] disabled:opacity-50"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--database-border)] px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-[var(--database-border)] px-3 py-2 text-[11px] font-bold hover:bg-[var(--database-row-hover-bg)] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!confirmOk}
            onClick={onConfirm}
            className="rounded-lg border border-[var(--database-error-text)]/40 bg-[var(--database-error-bg)] px-3 py-2 text-[11px] font-bold text-[var(--database-error-text)] disabled:opacity-40"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
