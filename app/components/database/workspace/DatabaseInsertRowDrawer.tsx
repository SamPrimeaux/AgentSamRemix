import React from 'react';
import { X } from 'lucide-react';
import {
  databaseColumnDefault as columnDefault,
  isDatabaseNotNull as isNotNull,
  isDatabasePrimaryKey as isPrimaryKey,
  type DatabaseSchemaColumn as SchemaColumn,
} from '../../../src/lib/databaseStudioModels';

/**
 * S2 peel -- mechanical move only, no behavior change.
 * Extracted from DatabaseStudio.tsx (Insert Row drawer + generic Drawer shell).
 * Drawer wrapper is local here since Insert Row was its only caller.
 */
function Drawer({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <aside className="absolute right-0 top-0 z-30 flex h-full w-full max-w-[420px] flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate font-mono text-[11px] text-muted">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-[var(--bg-hover)] hover:text-main">
          <X size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </aside>
  );
}

export interface DatabaseInsertRowDrawerProps {
  drawer: string | null;
  selectedTable: string | null | undefined;
  schema: SchemaColumn[];
  insertValues: Record<string, string>;
  setInsertValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  insertSql: string;
  setDrawer: (v: string | null) => void;
  insertRow: () => void | Promise<void>;
}

export function DatabaseInsertRowDrawer({
  drawer,
  selectedTable,
  schema,
  insertValues,
  setInsertValues,
  insertSql,
  setDrawer,
  insertRow,
}: DatabaseInsertRowDrawerProps) {
  return (
    <>
      {drawer === 'insert' && (
        <Drawer title="Insert Row" subtitle={selectedTable || undefined} onClose={() => setDrawer(null)}>
          <div className="space-y-3">
            {schema.map((col) => (
              <label key={col.name} className="block">
                <span className="mb-1 flex items-center gap-2 text-[11px] font-bold">
                  {col.name}
                  <span className="font-mono text-[10px] text-muted">{col.type || 'TEXT'}</span>
                  {isNotNull(col) && !isPrimaryKey(col) && <span className="text-[var(--solar-red)]">*</span>}
                </span>
                <input
                  value={insertValues[col.name] ?? ''}
                  onChange={(e) => setInsertValues((prev) => ({ ...prev, [col.name]: e.target.value }))}
                  placeholder={columnDefault(col) ? `default: ${columnDefault(col)}` : ''}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 font-mono text-[12px] outline-none focus:border-[var(--color-accent,var(--solar-cyan))]"
                />
              </label>
            ))}
            <div>
              <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-muted">Generated SQL</p>
              <pre className="max-h-36 overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3 font-mono text-[11px] text-[var(--color-accent,var(--solar-cyan))]">{insertSql}</pre>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setDrawer(null)} className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-[11px] font-bold hover:bg-[var(--bg-hover)]">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void insertRow()}
                className="rounded-lg border border-[var(--color-accent,var(--solar-cyan))]/30 bg-[var(--color-accent,var(--solar-cyan))]/15 px-3 py-2 text-[11px] font-bold text-[var(--color-accent,var(--solar-cyan))]"
              >
                Insert Row
              </button>
            </div>
          </div>
        </Drawer>
      )}

    </>
  );
}
