import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCopy, Pencil, X } from 'lucide-react';

export type CellDetailPayload = {
  datasourceLabel: string;
  tableName: string;
  columnName: string;
  rowKey: string | null;
  rowIndex?: number;
  rawValue: unknown;
  editable?: boolean;
  reasonIfNotEditable?: string;
};

type Props = {
  payload: CellDetailPayload | null;
  onClose: () => void;
  onCopy: (text: string) => void;
  onCopyRowJson?: () => void;
  onApplyEdit?: (nextValue: string) => void | Promise<void>;
};

function formatRaw(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export function DatabaseCellDetailDrawer({ payload, onClose, onCopy, onCopyRowJson, onApplyEdit }: Props) {
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditMode(false);
    setDraft(payload?.rawValue == null ? '' : String(payload.rawValue));
  }, [payload?.columnName, payload?.rowKey, payload?.rawValue]);

  const prettyJson = useMemo(() => {
    if (!payload) return null;
    const { rawValue } = payload;
    if (rawValue === null || rawValue === undefined) return null;
    if (typeof rawValue === 'object') {
      try {
        return JSON.stringify(rawValue, null, 2);
      } catch {
        return null;
      }
    }
    const text = String(rawValue).trim();
    if (!(text.startsWith('{') || text.startsWith('['))) return null;
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return null;
    }
  }, [payload]);

  if (!payload) return null;

  const copyText = formatRaw(payload.rawValue);
  const canEdit = payload.editable === true && Boolean(onApplyEdit);

  const handleApply = async () => {
    if (!onApplyEdit) return;
    setSaving(true);
    try {
      await onApplyEdit(draft);
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="database-cell-drawer" role="dialog" aria-label="Cell detail" aria-modal="true">
      <div className="flex items-center justify-between border-b border-[var(--database-border)] px-4 py-3">
        <div className="min-w-0 pr-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--database-text-muted)]">Cell detail</p>
          <p className="truncate font-mono text-sm font-semibold">
            {payload.tableName}.{payload.columnName}
          </p>
          <p className="mt-0.5 text-[10px] text-[var(--database-text-muted)]">{payload.datasourceLabel}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 hover:bg-[var(--database-row-hover-bg)]"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3 text-[12px]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
          <dt className="text-[var(--database-text-muted)]">Source</dt>
          <dd>{payload.tableName}</dd>
          <dt className="text-[var(--database-text-muted)]">Column</dt>
          <dd>{payload.columnName}</dd>
          <dt className="text-[var(--database-text-muted)]">Row</dt>
          <dd className="break-all">
            {payload.rowKey != null ? payload.rowKey : payload.rowIndex != null ? `#${payload.rowIndex + 1}` : '—'}
          </dd>
        </dl>

        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-[var(--database-text-muted)]">Value</span>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => onCopy(copyText)}
                className="inline-flex items-center gap-1 rounded border border-[var(--database-border)] px-2 py-0.5 text-[10px] font-bold hover:bg-[var(--database-row-hover-bg)]"
              >
                <ClipboardCopy size={11} /> Copy cell
              </button>
              {onCopyRowJson && (
                <button
                  type="button"
                  onClick={onCopyRowJson}
                  className="inline-flex items-center gap-1 rounded border border-[var(--database-border)] px-2 py-0.5 text-[10px] font-bold hover:bg-[var(--database-row-hover-bg)]"
                >
                  <ClipboardCopy size={11} /> Copy row
                </button>
              )}
              {canEdit && !editMode && (
                <button
                  type="button"
                  onClick={() => setEditMode(true)}
                  className="inline-flex items-center gap-1 rounded border border-[var(--database-accent)]/40 px-2 py-0.5 text-[10px] font-bold text-[var(--database-accent)] hover:bg-[var(--database-cell-selected-bg)]"
                >
                  <Pencil size={11} /> Edit
                </button>
              )}
            </div>
          </div>

          {editMode && canEdit ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={8}
                className="w-full resize-y rounded-lg border border-[var(--database-accent)] bg-[var(--database-bg)] p-3 font-mono text-[11px] outline-none ring-1 ring-[var(--database-cell-selected-border)]"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleApply()}
                  className="rounded-lg border border-[var(--database-accent)]/40 bg-[var(--database-cell-selected-bg)] px-3 py-1.5 text-[10px] font-bold text-[var(--database-accent)] disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Apply'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditMode(false);
                    setDraft(payload.rawValue == null ? '' : String(payload.rawValue));
                  }}
                  className="rounded-lg border border-[var(--database-border)] px-3 py-1.5 text-[10px] font-bold"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : payload.rawValue === null || payload.rawValue === undefined ? (
            <span className="database-null-chip">NULL</span>
          ) : (
            <pre className="max-h-[min(50vh,360px)] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--database-border)] bg-[var(--database-bg)] p-3 font-mono text-[11px]">
              {prettyJson ?? copyText}
            </pre>
          )}

          {!canEdit && payload.reasonIfNotEditable && (
            <p className="mt-2 rounded border border-[var(--database-border)] bg-[var(--database-row-hover-bg)] px-2 py-1.5 text-[10px] text-[var(--database-text-muted)]">
              {payload.reasonIfNotEditable}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
