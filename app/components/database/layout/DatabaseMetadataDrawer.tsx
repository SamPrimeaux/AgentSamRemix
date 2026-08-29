import React from 'react';
import { Key, Link2, Plus, X } from 'lucide-react';

import {
  databaseColumnDefault,
  isDatabaseNotNull,
  isDatabasePrimaryKey,
  quoteDatabaseIdent,
  type DatabaseIndexMeta,
  type DatabaseRelationMeta,
  type DatabaseSchemaColumn,
} from '../../../src/lib/databaseStudioModels';

type MetaPanel = 'schema' | 'indexes' | 'relations';

type Props = {
  table: string;
  panel: MetaPanel;
  datasourceLabel: string;
  canWriteRows: boolean;
  selectedTableSqlName: string;
  schema: DatabaseSchemaColumn[];
  indexes: DatabaseIndexMeta[];
  relations: DatabaseRelationMeta[];
  onClose: () => void;
  onApplySql: (sql: string) => void;
};

export function DatabaseMetadataDrawer({
  table,
  panel,
  datasourceLabel,
  canWriteRows,
  selectedTableSqlName,
  schema,
  indexes,
  relations,
  onClose,
  onApplySql,
}: Props) {
  return (
    <div className="database-meta-overlay" role="dialog" aria-modal="true">
      <div className="database-meta-panel">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--database-border)] px-4 py-3">
          <div>
            <h2 className="font-mono text-sm font-semibold">
              {table} · {panel}
            </h2>
            <p className="text-[11px] text-[var(--database-text-muted)]">{datasourceLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--database-text-muted)] hover:bg-[var(--database-row-hover-bg)]"
          >
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {panel === 'schema' ? (
            <>
              <div className="mb-3 flex gap-2">
                <button
                  type="button"
                  disabled={!canWriteRows}
                  onClick={() => onApplySql(`ALTER TABLE ${selectedTableSqlName}\nADD COLUMN new_column TEXT;`)}
                  className="rounded-lg border border-[var(--database-border)] px-3 py-1.5 text-[11px] font-bold hover:bg-[var(--database-row-hover-bg)] disabled:opacity-40"
                >
                  Add Column
                </button>
                <button
                  type="button"
                  disabled={!canWriteRows}
                  onClick={() =>
                    onApplySql(`ALTER TABLE ${selectedTableSqlName}\nRENAME TO ${quoteDatabaseIdent(`${table}_new`)};`)
                  }
                  className="rounded-lg border border-[var(--database-border)] px-3 py-1.5 text-[11px] font-bold hover:bg-[var(--database-row-hover-bg)] disabled:opacity-40"
                >
                  Edit Table
                </button>
              </div>
              <table className="w-full min-w-[560px] border-collapse text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[var(--database-border)] text-[10px] uppercase tracking-widest text-[var(--database-text-muted)]">
                    {['#', 'Column', 'Type', 'Nullable', 'Default'].map((h) => (
                      <th key={h} className="px-3 py-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {schema.map((col, index) => (
                    <tr key={col.name} className="border-b border-[var(--database-border)]/50">
                      <td className="px-3 py-2 font-mono text-[var(--database-text-muted)]">{index + 1}</td>
                      <td className="px-3 py-2 font-mono font-semibold">
                        {isDatabasePrimaryKey(col) && <Key size={12} className="mr-1 inline text-[var(--solar-yellow)]" />}
                        {col.name}
                      </td>
                      <td className="px-3 py-2 font-mono text-[var(--database-accent)]">{col.type || 'TEXT'}</td>
                      <td className="px-3 py-2">{isDatabaseNotNull(col) ? 'NOT NULL' : 'nullable'}</td>
                      <td className="px-3 py-2 font-mono text-[var(--database-text-muted)]">
                        {databaseColumnDefault(col) ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {panel === 'indexes' ? (
            <>
              <button
                type="button"
                disabled={!canWriteRows}
                onClick={() =>
                  onApplySql(`CREATE INDEX idx_${table}_column\nON ${selectedTableSqlName} (column_name);`)
                }
                className="mb-4 rounded-lg border border-[var(--database-border)] px-3 py-2 text-[11px] font-bold text-[var(--database-accent)] hover:bg-[var(--database-row-hover-bg)] disabled:opacity-40"
              >
                <Plus size={12} className="mr-1 inline" /> Add Index
              </button>
              {indexes.map((idx) => (
                <div key={idx.name} className="mb-3 rounded-lg border border-[var(--database-border)] bg-[var(--database-bg)] p-3">
                  <div className="font-mono text-sm">{idx.name}</div>
                  <pre className="mt-2 whitespace-pre-wrap text-[11px] text-[var(--database-text-muted)]">{idx.sql || 'auto index'}</pre>
                </div>
              ))}
            </>
          ) : null}
          {panel === 'relations' ? (
            relations.length ? (
              relations.map((rel, i) => (
                <div
                  key={`${rel.from}-${rel.to}-${i}`}
                  className="mb-3 flex items-center gap-3 rounded-lg border border-[var(--database-border)] bg-[var(--database-bg)] p-3 font-mono text-[12px]"
                >
                  <Link2 size={14} className="text-[var(--database-accent)]" />
                  <span>{rel.source_column || rel.from}</span>
                  <span className="text-[var(--database-text-muted)]">→</span>
                  <span>
                    {rel.target_table || rel.table}.{rel.target_column || rel.to}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-[12px] text-[var(--database-text-muted)]">No foreign keys found for this table.</p>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
