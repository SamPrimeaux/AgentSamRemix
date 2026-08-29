import React from 'react';
import { ClipboardCopy } from 'lucide-react';
import { cellMatches, rowKeyForRow, type GridCellSource, type SelectedGridCell } from './databaseGridTypes';
import { cellValueAsCopyText, formatGridCellDisplay } from './databaseGridFormat';

export type DatabaseResultsGridProps = {
  rows: Record<string, unknown>[];
  columns: string[];
  source: GridCellSource;
  datasource: 'd1' | 'supabase';
  table?: string;
  pk?: string;
  selectedCell: SelectedGridCell | null;
  onSelectCell: (cell: SelectedGridCell) => void;
  onOpenCellDetail: (cell: SelectedGridCell) => void;
  onCopyCell: (text: string) => void;
  /** Data tab row checkboxes */
  showRowSelector?: boolean;
  selectedRows?: Set<string>;
  onToggleRow?: (rowKey: string, checked: boolean) => void;
  onToggleAllRows?: (checked: boolean) => void;
  rowSelectorDisabled?: boolean;
  editingCell?: { rowKey: string; col: string; value: string } | null;
  onBeginInlineEdit?: (cell: SelectedGridCell) => void;
  onEditingValueChange?: (value: string) => void;
  onCommitInlineEdit?: () => void;
  onCancelInlineEdit?: () => void;
  getCellEditable?: (row: Record<string, unknown>, col: string, rowIndex: number) => { editable: boolean; reason?: string };
  cellTitle?: (col: string, editable: boolean, reason?: string) => string;
  sortCol?: string;
  sortDir?: 'asc' | 'desc';
  onSortColumn?: (col: string) => void;
};

export function DatabaseResultsGrid({
  rows,
  columns,
  source,
  datasource,
  table,
  pk,
  selectedCell,
  onSelectCell,
  onOpenCellDetail,
  onCopyCell,
  showRowSelector = false,
  selectedRows,
  onToggleRow,
  onToggleAllRows,
  rowSelectorDisabled = false,
  editingCell,
  onBeginInlineEdit,
  onEditingValueChange,
  onCommitInlineEdit,
  onCancelInlineEdit,
  getCellEditable,
  cellTitle,
  sortCol,
  sortDir,
  onSortColumn,
}: DatabaseResultsGridProps) {
  const cols = columns.length ? columns : Object.keys(rows[0] || {});

  const buildCell = (row: Record<string, unknown>, col: string, rowIndex: number): SelectedGridCell => {
    const rowKey = rowKeyForRow(row, pk, rowIndex);
    const editMeta = getCellEditable?.(row, col, rowIndex) ?? { editable: false };
    return {
      source,
      datasource,
      table,
      rowIndex,
      rowKey,
      columnKey: col,
      value: row[col],
      row,
      editable: editMeta.editable,
      reasonIfNotEditable: editMeta.reason,
    };
  };

  const defaultTitle = (col: string, editable: boolean, reason?: string) => {
    if (editable) return 'Click to select · double-click to edit · Enter for detail';
    return reason ? `${reason} · double-click for full value` : 'Click to select · double-click for full value';
  };

  return (
    <table className="database-results-grid w-full min-w-max border-collapse text-left text-[12px]">
      <thead className="sticky top-0 z-[1] bg-[var(--database-bg)]">
        <tr className="border-b border-[var(--database-border)] text-[10px] uppercase tracking-widest text-[var(--database-text-muted)]">
          {showRowSelector && (
            <th className="w-10 px-3 py-2">
              <input
                type="checkbox"
                disabled={rowSelectorDisabled || rows.length === 0}
                checked={rows.length > 0 && selectedRows?.size === rows.length}
                onChange={(e) => onToggleAllRows?.(e.target.checked)}
                aria-label="Select all rows on page"
              />
            </th>
          )}
          {cols.map((h) => (
            <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">
              {onSortColumn ? (
                <button
                  type="button"
                  onClick={() => onSortColumn(h)}
                  className="cursor-pointer text-left uppercase tracking-widest hover:text-[var(--database-accent)]"
                >
                  {h}
                  {sortCol === h ? ` ${sortDir}` : ''}
                </button>
              ) : (
                h
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => {
          const key = rowKeyForRow(row, pk, rowIndex);
          const rowSelected = Boolean(selectedRows?.has(key));
          const rowHasSelectedCell = selectedCell?.rowKey === key;
          return (
            <tr
              key={`${key}-${rowIndex}`}
              className={`database-results-row group border-b border-[var(--database-border)]/50 ${
                rowSelected || rowHasSelectedCell ? 'database-results-row--selected' : ''
              }`}
            >
              {showRowSelector && (
                <td className="px-3 py-1.5">
                  <input
                    type="checkbox"
                    disabled={rowSelectorDisabled}
                    checked={rowSelected}
                    onChange={(e) => onToggleRow?.(key, e.target.checked)}
                    aria-label={`Select row ${rowIndex + 1}`}
                  />
                </td>
              )}
              {cols.map((col) => {
                const cell = buildCell(row, col, rowIndex);
                const isSelected = cellMatches(selectedCell, key, col);
                const isPkCol = Boolean(pk && col === pk);
                const isInlineEditing =
                  editingCell?.rowKey === key && editingCell.col === col && cell.editable && !isPkCol;
                const title = (cellTitle ?? defaultTitle)(col, cell.editable && !isPkCol, cell.reasonIfNotEditable);

                return (
                  <td
                    key={col}
                    role="gridcell"
                    tabIndex={0}
                    className={`database-grid-cell max-w-[320px] truncate border-r border-[var(--database-border)]/40 px-3 py-1.5 font-mono ${
                      isSelected ? 'database-grid-cell--selected' : ''
                    } ${cell.editable && !isPkCol ? 'database-grid-cell--editable' : 'database-grid-cell--readonly'}`}
                    title={title}
                    onClick={() => onSelectCell(cell)}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      if (cell.editable && !isPkCol && onBeginInlineEdit) {
                        onBeginInlineEdit(cell);
                        return;
                      }
                      onOpenCellDetail(cell);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (cell.editable && !isPkCol && onBeginInlineEdit && e.shiftKey) {
                          onBeginInlineEdit(cell);
                        } else {
                          onOpenCellDetail(cell);
                        }
                      }
                    }}
                  >
                    {isInlineEditing && editingCell ? (
                      <div className="flex min-w-[120px] flex-col gap-1">
                        <input
                          autoFocus
                          value={editingCell.value}
                          onChange={(e) => onEditingValueChange?.(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              onCommitInlineEdit?.();
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              onCancelInlineEdit?.();
                            }
                          }}
                          className="w-full rounded border border-[var(--database-accent)] bg-[var(--database-panel)] px-2 py-1 text-[11px] outline-none ring-1 ring-[var(--database-cell-selected-border)]"
                        />
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => onCommitInlineEdit?.()}
                            className="rounded border border-[var(--database-accent)]/40 bg-[var(--database-cell-selected-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--database-accent)]"
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => onCancelInlineEdit?.()}
                            className="rounded border border-[var(--database-border)] px-2 py-0.5 text-[10px] font-bold text-[var(--database-text-muted)]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate">{formatGridCellDisplay(row[col], col)}</span>
                        <button
                          type="button"
                          title="Copy cell"
                          className={`database-grid-cell-copy shrink-0 rounded p-0.5 hover:bg-[var(--database-row-hover-bg)] ${
                            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onCopyCell(cellValueAsCopyText(row[col]));
                          }}
                        >
                          <ClipboardCopy size={10} />
                        </button>
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
