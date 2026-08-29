import { useCallback, useMemo, useState } from 'react';

import { rowKeyForRow, type SelectedGridCell } from '../databaseGridTypes';
import {
  databaseColumnDefault,
  isDatabaseNotNull,
  isDatabasePrimaryKey,
  quoteDatabaseIdent,
  type DatabaseSchemaColumn,
} from '../../../src/lib/databaseStudioModels';

type CrudInput = {
  canInsertRow: boolean;
  canDeleteRows: boolean;
  canEditDataCell: boolean;
  canWriteRows: boolean;
  datasource: 'd1' | 'supabase';
  selectedTable: string | null;
  selectedTableSqlName: string;
  schema: DatabaseSchemaColumn[];
  pk: string;
  page: number;
  selectedRows: Set<string>;
  sqlResults: Record<string, unknown>[];
  dataRows: Record<string, unknown>[];
  fetchD1Json: <T>(url: string, init?: RequestInit) => Promise<T>;
  executeSqlInternal: (
    sql: string,
    opts?: { studioApproved?: boolean; destructiveConfirmed?: boolean },
  ) => Promise<unknown>;
  refreshTableRows: (page: number) => Promise<void>;
  setSql: (sql: string) => void;
  setSelectedTable: (table: string | null) => void;
  setMetaPanel: (panel: 'schema' | 'indexes' | 'relations' | null) => void;
  resetMetadata: () => void;
  setDataError: (error: string | null) => void;
  setSelectedRows: (rows: Set<string>) => void;
  setCellDetail: (payload: null) => void;
  flashMenuToast?: (message: string) => void;
};

export function useDatabaseCrud({
  canInsertRow,
  canDeleteRows,
  canEditDataCell,
  canWriteRows,
  datasource,
  selectedTable,
  selectedTableSqlName,
  schema,
  pk,
  page,
  selectedRows,
  sqlResults,
  dataRows,
  fetchD1Json,
  executeSqlInternal,
  refreshTableRows,
  setSql,
  setSelectedTable,
  setMetaPanel,
  resetMetadata,
  setDataError,
  setSelectedRows,
  setCellDetail,
  flashMenuToast,
}: CrudInput) {
  const [drawer, setDrawer] = useState<'insert' | null>(null);
  const [insertValues, setInsertValues] = useState<Record<string, string>>({});
  const [editingCell, setEditingCell] = useState<{ rowKey: string; col: string; value: string } | null>(null);
  const [deleteRowsModal, setDeleteRowsModal] = useState(false);
  const [dropTableModal, setDropTableModal] = useState<string | null>(null);
  const [dropTableBusy, setDropTableBusy] = useState(false);

  const insertSql = useMemo(() => {
    if (!selectedTable) return '';
    const pairs = schema
      .filter((col) => insertValues[col.name] !== undefined && insertValues[col.name] !== '')
      .map((col) => [col.name, insertValues[col.name]] as const);
    if (!pairs.length) return `INSERT INTO ${selectedTableSqlName} DEFAULT VALUES;`;
    const cols = pairs.map(([name]) => quoteDatabaseIdent(name)).join(', ');
    const vals = pairs
      .map(([, value]) => (value.toLowerCase() === 'null' ? 'NULL' : `'${value.replace(/'/g, "''")}'`))
      .join(', ');
    return `INSERT INTO ${selectedTableSqlName} (${cols}) VALUES (${vals});`;
  }, [insertValues, schema, selectedTable, selectedTableSqlName]);

  const insertRow = useCallback(async () => {
    if (!canInsertRow || !selectedTable) return;
    const missing = schema.filter(
      (c) =>
        isDatabaseNotNull(c) &&
        !isDatabasePrimaryKey(c) &&
        databaseColumnDefault(c) == null &&
        !insertValues[c.name],
    );
    if (missing.length) {
      setDataError(`Required fields missing: ${missing.map((c) => c.name).join(', ')}`);
      return;
    }
    try {
      await fetchD1Json(`/api/d1/table/${encodeURIComponent(selectedTable)}/row`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns: insertValues }),
      });
      setDrawer(null);
      setInsertValues({});
      await refreshTableRows(page);
    } catch (e) {
      setDataError(e instanceof Error ? e.message : String(e));
    }
  }, [canInsertRow, fetchD1Json, insertValues, page, refreshTableRows, schema, selectedTable, setDataError]);

  const deleteSelectedRows = useCallback(async () => {
    if (!canDeleteRows || !selectedTable || !pk) return;
    const gridRows = sqlResults.length ? sqlResults : dataRows;
    const pkVals = gridRows.filter((r, i) => selectedRows.has(rowKeyForRow(r, pk, i))).map((r) => r[pk]);
    try {
      await fetchD1Json(`/api/d1/table/${encodeURIComponent(selectedTable)}/rows`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pk_col: pk, pk_vals: pkVals, confirm: true }),
      });
      setDeleteRowsModal(false);
      setSelectedRows(new Set());
      await refreshTableRows(page);
    } catch (e) {
      setDataError(e instanceof Error ? e.message : String(e));
    }
  }, [
    canDeleteRows,
    dataRows,
    fetchD1Json,
    page,
    pk,
    refreshTableRows,
    selectedRows,
    selectedTable,
    setDataError,
    setSelectedRows,
    sqlResults,
  ]);

  const applyCellEdit = useCallback(
    async (cell: SelectedGridCell, nextValue: string) => {
      if (!canEditDataCell || !selectedTable || !pk || cell.columnKey === pk) return;
      const pkVal = cell.row[pk];
      if (pkVal == null) return;
      try {
        await fetchD1Json(`/api/d1/table/${encodeURIComponent(selectedTable)}/row`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pk_col: pk, pk_val: pkVal, updates: { [cell.columnKey]: nextValue } }),
        });
        setEditingCell(null);
        setCellDetail(null);
        await refreshTableRows(page);
      } catch (e) {
        setDataError(e instanceof Error ? e.message : String(e));
      }
    },
    [canEditDataCell, fetchD1Json, page, pk, refreshTableRows, selectedTable, setCellDetail, setDataError],
  );

  const confirmDropTable = useCallback(async () => {
    const name = dropTableModal;
    if (!name || !canWriteRows || datasource !== 'd1') return;
    setDropTableBusy(true);
    try {
      const sql = `DROP TABLE ${quoteDatabaseIdent(name)};`;
      setSql(sql);
      await executeSqlInternal(sql, { studioApproved: true, destructiveConfirmed: true });
      if (selectedTable === name) {
        setSelectedTable(null);
        setMetaPanel(null);
        resetMetadata();
      }
      setDropTableModal(null);
      flashMenuToast?.(`Dropped ${name}`);
    } catch (e) {
      flashMenuToast?.(e instanceof Error ? e.message : 'Drop table failed');
    } finally {
      setDropTableBusy(false);
    }
  }, [
    canWriteRows,
    datasource,
    dropTableModal,
    executeSqlInternal,
    flashMenuToast,
    resetMetadata,
    selectedTable,
    setMetaPanel,
    setSelectedTable,
    setSql,
  ]);

  return {
    drawer,
    setDrawer,
    insertValues,
    setInsertValues,
    insertSql,
    insertRow,
    editingCell,
    setEditingCell,
    deleteRowsModal,
    setDeleteRowsModal,
    deleteSelectedRows,
    applyCellEdit,
    dropTableModal,
    setDropTableModal,
    dropTableBusy,
    confirmDropTable,
  };
}
