import { useCallback, useMemo, useState } from 'react';

import { databaseTableApiPath, fetchDatabaseJson } from '../../../src/lib/databaseStudioApi';
import {
  databaseTableMetaFromSelection,
  findSelectedDatabaseTable,
  qualifiedDatabaseTableRef,
  type DatabaseDataResponse,
  type DatabaseSortDir,
  type DatabaseTableMeta,
} from '../../../src/lib/databaseStudioModels';
import { serializeDatabaseFilters, type DatabaseFilterRule } from '../../../src/lib/databaseTableFilters';

export const DATABASE_PAGE_SIZE = 50;

type Datasource = 'd1' | 'supabase';
type StudioSection = 'd1' | 'platform_supabase' | 'connected_supabase';

type UseDatabaseBrowseInput = {
  activeTables: DatabaseTableMeta[];
  datasource: Datasource;
  selectedTable?: string | null;
  selectedTableMeta?: DatabaseTableMeta;
  studioSection: StudioSection;
  supabaseProjectRef: string;
  fetchD1Json: <T>(url: string, init?: RequestInit) => Promise<T>;
  setSql: (value: string) => void;
  runSql: (statement?: string) => void;
  adoptRows: (rows: Record<string, unknown>[], columns?: string[]) => void;
  sqlResultsLength: number;
};

export function useDatabaseBrowse({
  activeTables,
  datasource,
  selectedTable,
  selectedTableMeta,
  studioSection,
  supabaseProjectRef,
  fetchD1Json,
  setSql,
  runSql,
  adoptRows,
  sqlResultsLength,
}: UseDatabaseBrowseInput) {
  const [data, setData] = useState<DatabaseDataResponse>({ rows: [], total_count: 0, page: 1, total_pages: 1 });
  const [dataError, setDataError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState('');
  const [sortDir, setSortDir] = useState<DatabaseSortDir>('asc');
  const [filters, setFilters] = useState<DatabaseFilterRule[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [browseMeta, setBrowseMeta] = useState({ page: 1, total_pages: 1, total_count: 0 });

  const selectTableSql = useCallback((table: DatabaseTableMeta | string, pageNum = 1) => {
    const offset = (Math.max(1, pageNum) - 1) * DATABASE_PAGE_SIZE;
    const meta = typeof table === 'string'
      ? findSelectedDatabaseTable(activeTables, table, datasource)
        ?? databaseTableMetaFromSelection(table, datasource)
      : table;
    return `SELECT * FROM ${qualifiedDatabaseTableRef(meta, datasource)} LIMIT ${DATABASE_PAGE_SIZE} OFFSET ${offset};`;
  }, [activeTables, datasource]);

  const tableBrowseTotalPages = useMemo(() => {
    if (filters.length && browseMeta.total_pages) return browseMeta.total_pages;
    const count = selectedTableMeta?.row_count;
    if (count != null && Number.isFinite(count)) return Math.max(1, Math.ceil(count / DATABASE_PAGE_SIZE));
    if (sqlResultsLength < DATABASE_PAGE_SIZE) return Math.max(1, page);
    return Math.max(browseMeta.total_pages, page + 1);
  }, [browseMeta.total_pages, filters.length, page, selectedTableMeta?.row_count, sqlResultsLength]);

  const syncDataResponseToGrid = useCallback((payload: DatabaseDataResponse) => {
    setData(payload);
    adoptRows(payload.rows, payload.columns);
    setBrowseMeta({
      page: payload.page,
      total_pages: payload.total_pages,
      total_count: payload.total_count,
    });
  }, [adoptRows]);

  const refreshTableRows = useCallback(async (nextPage = page) => {
    if (!selectedTable) return;
    setPage(nextPage);
    if (filters.length) {
      setDataLoading(true);
      setDataError(null);
      try {
        const meta = selectedTableMeta ?? { name: selectedTable };
        const query = new URLSearchParams({
          page: String(nextPage),
          limit: String(DATABASE_PAGE_SIZE),
        });
        if (sortCol) query.set('sort', sortCol);
        if (sortCol) query.set('dir', sortDir);
        query.set('filter', serializeDatabaseFilters(filters));
        const dataPath = databaseTableApiPath(
          meta,
          datasource,
          'data',
          studioSection === 'connected_supabase' ? supabaseProjectRef : '',
        );
        const dataUrl = `${dataPath}${dataPath.includes('?') ? '&' : '?'}${query.toString()}`;
        const payload = datasource === 'd1'
          ? await fetchD1Json<DatabaseDataResponse>(dataUrl)
          : await fetchDatabaseJson<DatabaseDataResponse>(dataUrl);
        syncDataResponseToGrid(payload);
        setSelectedRows(new Set());
      } catch (error) {
        setDataError(error instanceof Error ? error.message : String(error));
      } finally {
        setDataLoading(false);
      }
      return;
    }
    const statement = selectTableSql(selectedTable, nextPage);
    setSql(statement);
    runSql(statement);
  }, [
    datasource,
    fetchD1Json,
    filters,
    page,
    runSql,
    selectedTable,
    selectedTableMeta,
    selectTableSql,
    setSql,
    sortCol,
    sortDir,
    studioSection,
    supabaseProjectRef,
    syncDataResponseToGrid,
  ]);

  const applyFiltersToTable = useCallback(() => {
    if (!selectedTable) return;
    setPage(1);
    void refreshTableRows(1);
  }, [refreshTableRows, selectedTable]);

  const resetForTable = useCallback(() => {
    setPage(1);
    setSelectedRows(new Set());
    setDataError(null);
  }, []);

  return {
    data,
    dataError,
    setDataError,
    page,
    setPage,
    sortCol,
    setSortCol,
    sortDir,
    setSortDir,
    filters,
    setFilters,
    dataLoading,
    selectedRows,
    setSelectedRows,
    browseMeta,
    setBrowseMeta,
    selectTableSql,
    tableBrowseTotalPages,
    refreshTableRows,
    applyFiltersToTable,
    resetForTable,
  };
}
