import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Download,
  Filter,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { MonacoSurface } from '../../MonacoSurface';
import { DatabaseResultsGrid } from '../DatabaseResultsGrid';
import { rowKeyForRow, type SelectedGridCell } from '../databaseGridTypes';
import {
  DATABASE_FILTER_UI_OPS,
  DATABASE_FILTER_UI_LABELS,
  type DatabaseFilterRule,
  type DatabaseFilterUiOp,
} from '../../../src/lib/databaseTableFilters';
import {
  DATABASE_MIN_RESULTS_PANE_H,
  DATABASE_MIN_SQL_EDITOR_H,
} from '../hooks/useDatabasePaneLayout';
import type { DatabaseSchemaColumn as SchemaColumn } from '../../../src/lib/databaseStudioModels';
import type { DatabaseStudioDatasource as Datasource } from '../../../src/lib/databaseStudioRoute';

const FILTER_OPS: DatabaseFilterUiOp[] = DATABASE_FILTER_UI_OPS;

/**
 * S2-S3 peel -- mechanical move only, no behavior change.
 * Extracted from DatabaseStudio.tsx: setup-gate, SQL editor + run/format toolbar,
 * table-browse results grid, SQL-results grid, error panel, and row filter/action
 * bar. One cohesive interactive unit -- editor run state, filters, and both result
 * grids all react to the same live state, so it stays as a single component rather
 * than being split further (splitting would require lifting state back up between
 * siblings, defeating the point of the peel).
 */
export interface DatabaseSqlResultsWorkspaceProps {
  setupContent: React.ReactNode;
  sqlStackRef: React.RefObject<HTMLDivElement>;
  selectedCell: SelectedGridCell | null;
  setSelectedCell: React.Dispatch<React.SetStateAction<SelectedGridCell | null>>;
  setCellDetail: (v: unknown) => void;
  copyToClipboard: (text: string) => void | Promise<void>;
  applyCellEdit: (cell: any, nextValue: string) => void | Promise<void>;
  selectedTable: string | null | undefined;
  pk: string | null | undefined;
  sql: string;
  setSql: (v: string) => void;
  sqlEditorRef: React.MutableRefObject<any>;
  resultsPaneHeight: number;
  splitterDragging: boolean;
  beginResultsPaneResize: (e: React.PointerEvent) => void;
  resetResultsPaneHeight: () => void;
  sqlRunState: string;
  lastQueryMs: number | null;
  lastRowsRead: number | null;
  effectiveDatasource: Datasource;
  sqlRunning: boolean;
  runSql: () => void | Promise<void>;
  canInsertRow: boolean;
  insertDisabledReason: string;
  setDrawer: (v: string | null) => void;
  canDeleteRows: boolean;
  deleteDisabledReason: string;
  setDeleteRowsModal: (v: boolean) => void;
  refreshTableRows: (page: number) => void | Promise<void>;
  page: number;
  loadingMain: boolean;
  copyVisibleDataCsv: () => void;
  selectedRows: Set<string>;
  setSelectedRows: React.Dispatch<React.SetStateAction<Set<string>>>;
  filters: DatabaseFilterRule[];
  setFilters: React.Dispatch<React.SetStateAction<DatabaseFilterRule[]>>;
  schema: SchemaColumn[];
  applyFiltersToTable: () => void;
  sqlResults: Record<string, unknown>[];
  sqlColumns: string[];
  sqlError: string | null;
  lastAttemptedSql: string | null;
  datasourceLabel: string;
  exportSqlResultsCsv: () => void;
  openCellDetail: (cell: any) => void;
  canWriteRows: boolean;
  editingCell: { rowKey: string; col: string; value: string } | null;
  setEditingCell: React.Dispatch<React.SetStateAction<{ rowKey: string; col: string; value: string } | null>>;
  getDataCellEditable: (row: Record<string, unknown>, col: string) => any;
  data: Record<string, unknown>[];
  browseMeta: { total_count?: number } | null | undefined;
  selectedTableMeta: { row_count?: number; [k: string]: unknown } | null | undefined;
  tableBrowseTotalPages: number;
  sortCol: string | null;
  sortDir: 'asc' | 'desc';
  setSortCol: (v: string) => void;
  setSortDir: (v: 'asc' | 'desc') => void;
}

export function DatabaseSqlResultsWorkspace(props: DatabaseSqlResultsWorkspaceProps) {
  const {
    setupContent, sqlStackRef, selectedCell, setSelectedCell, setCellDetail, copyToClipboard, applyCellEdit,
    selectedTable, pk, sql, setSql, sqlEditorRef, resultsPaneHeight, splitterDragging,
    beginResultsPaneResize, resetResultsPaneHeight, sqlRunState, lastQueryMs, lastRowsRead,
    effectiveDatasource, sqlRunning, runSql, canInsertRow, insertDisabledReason, setDrawer,
    canDeleteRows, deleteDisabledReason, setDeleteRowsModal, refreshTableRows, page, loadingMain,
    copyVisibleDataCsv, selectedRows, setSelectedRows, filters, setFilters, schema,
    applyFiltersToTable, sqlResults, sqlColumns, sqlError, lastAttemptedSql, datasourceLabel,
    exportSqlResultsCsv, openCellDetail, canWriteRows, editingCell, setEditingCell,
    getDataCellEditable, data, browseMeta, selectedTableMeta, tableBrowseTotalPages,
    sortCol, sortDir, setSortCol, setSortDir,
  } = props;

  return (
    <>
      {setupContent}
          {!setupContent && (
            <div ref={sqlStackRef} className="flex h-full min-h-0 flex-col">
              <div
                className="min-h-0 flex-1"
                style={{ minHeight: DATABASE_MIN_SQL_EDITOR_H, background: 'var(--database-monaco-bg)' }}
              >
                <MonacoSurface
                  height="100%"
                  language="sql"
                  value={sql}
                  onChange={setSql}
                  onMount={(ed) => {
                    sqlEditorRef.current = ed;
                  }}
                />
              </div>

              <div
                role="separator"
                aria-orientation="horizontal"
                aria-valuenow={resultsPaneHeight}
                title="Drag to resize results · double-click to reset"
                className="database-splitter hidden md:block"
                data-dragging={splitterDragging ? 'true' : undefined}
                onPointerDown={beginResultsPaneResize}
                onDoubleClick={resetResultsPaneHeight}
              />

              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--database-border)] bg-[var(--database-panel)] px-4 py-2">
                <button
                  type="button"
                  onClick={() => void sqlEditorRef.current?.getAction('editor.action.formatDocument')?.run()}
                  className="text-[11px] font-medium text-[var(--database-text-muted)] hover:text-[var(--database-text)]"
                >
                  Format <span className="font-mono text-[10px] opacity-70">(⌥F)</span>
                </button>
                <div className="flex items-center gap-2">
                  {sqlRunState === 'success' && lastQueryMs != null && (
                    <span className="font-mono text-[10px] text-[var(--database-text-muted)]">
                      {lastQueryMs}ms · {lastRowsRead ?? 0} rows · {effectiveDatasource}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={sqlRunning}
                    onClick={() => void runSql()}
                    className="inline-flex items-center gap-2 rounded-lg bg-[var(--database-accent)] px-4 py-1.5 text-[11px] font-bold text-[var(--database-bg)] shadow-sm disabled:opacity-50"
                  >
                    {sqlRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                    {sqlRunning ? 'Running…' : 'Run'}
                  </button>
                </div>
              </div>

              <div
                className="database-results-pane--mobile flex shrink-0 flex-col border-t border-[var(--database-border)] md:max-h-[75%]"
                style={{ height: resultsPaneHeight, minHeight: DATABASE_MIN_RESULTS_PANE_H }}
              >
                {selectedTable && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--database-border)] bg-[var(--database-panel)] px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!canInsertRow}
                        title={!canInsertRow ? insertDisabledReason : 'Insert a new row'}
                        onClick={() => canInsertRow && setDrawer('insert')}
                        className="flex items-center gap-1 rounded-lg border border-[var(--database-border)] px-3 py-1.5 text-[11px] font-bold text-[var(--database-accent)] hover:bg-[var(--database-row-hover-bg)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Plus size={12} /> Insert Row
                      </button>
                      <button
                        type="button"
                        disabled={!canDeleteRows}
                        title={!canDeleteRows ? deleteDisabledReason : `Delete ${selectedRows.size} selected row(s)`}
                        onClick={() => canDeleteRows && setDeleteRowsModal(true)}
                        className="flex items-center gap-1 rounded-lg border border-[var(--database-border)] px-3 py-1.5 text-[11px] font-bold text-[var(--database-error-text)] hover:bg-[var(--database-row-hover-bg)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 size={12} /> Delete Row
                      </button>
                      <button
                        type="button"
                        onClick={() => void refreshTableRows(page)}
                        className="rounded-lg border border-[var(--database-border)] p-1.5 text-[var(--database-text-muted)] hover:bg-[var(--database-row-hover-bg)]"
                      >
                        <RefreshCw size={13} className={loadingMain || sqlRunning ? 'animate-spin' : ''} />
                      </button>
                      <button
                        type="button"
                        onClick={() => copyVisibleDataCsv()}
                        className="flex items-center gap-1 rounded-lg border border-[var(--database-border)] px-3 py-1.5 text-[11px] font-bold hover:bg-[var(--database-row-hover-bg)]"
                      >
                        <Download size={12} /> Export CSV
                      </button>
                      {selectedRows.size > 0 && (
                        <span className="rounded bg-[var(--database-cell-selected-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--database-accent)]">
                          {selectedRows.size} selected
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Filter size={12} className="text-[var(--database-text-muted)]" />
                      <select
                        value={filters[0]?.col || ''}
                        onChange={(e) =>
                          setFilters(e.target.value ? [{ id: 'f1', col: e.target.value, op: 'contains', val: '' }] : [])
                        }
                        className="rounded border border-[var(--database-border)] bg-[var(--database-bg)] px-2 py-1 text-[11px]"
                      >
                        <option value="">Filter</option>
                        {schema.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {filters[0] && (
                        <select
                          value={filters[0].op}
                          onChange={(e) => setFilters([{ ...filters[0], op: e.target.value as DatabaseFilterUiOp }])}
                          className="rounded border border-[var(--database-border)] bg-[var(--database-bg)] px-2 py-1 text-[11px]"
                        >
                          {FILTER_OPS.map((op) => (
                            <option key={op} value={op}>
                              {DATABASE_FILTER_UI_LABELS[op]}
                            </option>
                          ))}
                        </select>
                      )}
                      {filters[0] && !['is_null', 'is_not_null'].includes(filters[0].op) && (
                        <input
                          value={filters[0].val}
                          onChange={(e) => setFilters([{ ...filters[0], val: e.target.value }])}
                          onKeyDown={(e) => e.key === 'Enter' && applyFiltersToTable()}
                          className="w-28 rounded border border-[var(--database-border)] bg-[var(--database-bg)] px-2 py-1 text-[11px]"
                        />
                      )}
                      {filters.length > 0 && (
                        <button
                          type="button"
                          onClick={() => applyFiltersToTable()}
                          className="rounded border border-[var(--database-border)] px-2 py-1 text-[10px] font-bold hover:bg-[var(--database-row-hover-bg)]"
                        >
                          Apply
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--database-border)] px-4 py-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--database-text-muted)]">
                    {sqlRunState === 'error' ? 'Query error' : 'Results'}
                  </span>
                  {!selectedTable && sqlResults.length > 0 && sqlRunState !== 'error' && (
                    <button
                      type="button"
                      onClick={() => exportSqlResultsCsv()}
                      className="inline-flex items-center gap-1 rounded border border-[var(--database-border)] px-2 py-0.5 text-[10px] font-bold hover:bg-[var(--database-row-hover-bg)]"
                    >
                      <Download size={11} /> Export CSV
                    </button>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {sqlRunState === 'error' && sqlError ? (
                    <div className="database-sql-error-panel">
                      <p className="font-semibold">{sqlError}</p>
                      <p className="mt-2 text-[10px] opacity-90">
                        Datasource: <span className="font-mono">{datasourceLabel}</span>
                      </p>
                      {lastAttemptedSql ? (
                        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-[var(--database-border)] bg-[var(--database-bg)] p-2 text-[11px] text-[var(--database-text)]">
                          {lastAttemptedSql}
                        </pre>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void copyToClipboard(sqlError)}
                          className="inline-flex items-center gap-1 rounded border border-[var(--database-border)] px-2 py-1 text-[10px] font-bold hover:bg-[var(--database-row-hover-bg)]"
                        >
                          <ClipboardCopy size={12} /> Copy error
                        </button>
                        {lastAttemptedSql ? (
                          <button
                            type="button"
                            onClick={() => void copyToClipboard(lastAttemptedSql)}
                            className="inline-flex items-center gap-1 rounded border border-[var(--database-border)] px-2 py-1 text-[10px] font-bold hover:bg-[var(--database-row-hover-bg)]"
                          >
                            <ClipboardCopy size={12} /> Copy SQL
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : sqlResults.length ? (
                    <DatabaseResultsGrid
                      rows={sqlResults}
                      columns={sqlColumns.length ? sqlColumns : Object.keys(sqlResults[0] || {})}
                      source="sql_result"
                      datasource={effectiveDatasource}
                      table={selectedTable || undefined}
                      pk={pk || undefined}
                      selectedCell={selectedCell?.source === 'sql_result' ? selectedCell : null}
                      onSelectCell={(cell) => {
                        setSelectedCell(cell);
                        setCellDetail(null);
                      }}
                      onOpenCellDetail={openCellDetail}
                      onCopyCell={(text) => void copyToClipboard(text)}
                      showRowSelector={Boolean(selectedTable)}
                      selectedRows={selectedRows}
                      rowSelectorDisabled={!canWriteRows}
                      onToggleRow={(rowKey, checked) =>
                        setSelectedRows((prev) => {
                          const next = new Set(prev);
                          checked ? next.add(rowKey) : next.delete(rowKey);
                          return next;
                        })
                      }
                      onToggleAllRows={(checked) =>
                        setSelectedRows(
                          checked ? new Set(sqlResults.map((r, i) => rowKeyForRow(r, pk, i))) : new Set(),
                        )
                      }
                      editingCell={editingCell}
                      getCellEditable={(row, col, rowIndex) => getDataCellEditable(row, col)}
                      onBeginInlineEdit={(cell) => {
                        setSelectedCell(cell);
                        setEditingCell({
                          rowKey: cell.rowKey,
                          col: cell.columnKey,
                          value: cell.value == null ? '' : String(cell.value),
                        });
                      }}
                      onEditingValueChange={(value) => setEditingCell((prev) => (prev ? { ...prev, value } : prev))}
                      onCommitInlineEdit={() => {
                        if (!editingCell) return;
                        const rowIndex = sqlResults.findIndex((r, i) => rowKeyForRow(r, pk, i) === editingCell.rowKey);
                        if (rowIndex < 0) return;
                        const row = sqlResults[rowIndex];
                        const editMeta = getDataCellEditable(row, editingCell.col);
                        void applyCellEdit(
                          {
                            source: 'sql_result',
                            datasource: effectiveDatasource,
                            table: selectedTable || undefined,
                            rowIndex,
                            rowKey: editingCell.rowKey,
                            columnKey: editingCell.col,
                            value: row[editingCell.col],
                            row,
                            editable: editMeta.editable,
                            reasonIfNotEditable: editMeta.reason,
                          },
                          editingCell.value,
                        );
                      }}
                      onCancelInlineEdit={() => setEditingCell(null)}
                      sortCol={sortCol}
                      sortDir={sortDir}
                      onSortColumn={(col) => {
                        setSortCol(col);
                        setSortDir(sortCol === col && sortDir === 'asc' ? 'desc' : 'asc');
                        if (selectedTable) void refreshTableRows(1);
                      }}
                    />
                  ) : (
                    <p className="p-4 text-[12px] text-[var(--database-text-muted)]">
                      {sqlRunState === 'running' ? 'Running query…' : 'Run a query to see results.'}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--database-border)] px-4 py-1.5 font-mono text-[10px] text-[var(--database-text-muted)]">
                  <span>
                    Query {lastQueryMs != null ? `${lastQueryMs}ms` : '—'} · {lastRowsRead != null ? lastRowsRead : '—'} rows on page
                    {selectedTable && (
                      <>
                        {' '}
                        ·{' '}
                        {(filters.length ? browseMeta.total_count : selectedTableMeta?.row_count)?.toLocaleString() ?? '—'} total
                      </>
                    )}
                  </span>
                  {selectedTable && (
                    <div className="flex items-center gap-2">
                      <span>
                        Page {page} of {tableBrowseTotalPages}
                      </span>
                      <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => void refreshTableRows(Math.max(1, page - 1))}
                        className="rounded border border-[var(--database-border)] px-2 py-1 disabled:opacity-40"
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={12} />
                      </button>
                      <button
                        type="button"
                        disabled={page >= tableBrowseTotalPages}
                        onClick={() => void refreshTableRows(Math.min(tableBrowseTotalPages, page + 1))}
                        className="rounded border border-[var(--database-border)] px-2 py-1 disabled:opacity-40"
                        aria-label="Next page"
                      >
                        <ChevronRight size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

    </>
  );
}
