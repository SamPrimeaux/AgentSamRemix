/**
 * DatabaseStudio controller facade — mechanical peel from DatabaseStudio.tsx.
 * Wires existing useDatabase* hooks + host orchestration; no behavior change.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  createDatabaseSurfacePublisher,
  type DatabaseDatasource,
  type DatabaseSurfaceContext,
  type DbApplySqlMode,
} from '../../../src/lib/databaseStudioEvents';
import type { TableContextMenuAction } from '../DatabaseTableContextMenu';
import type { CellDetailPayload } from '../DatabaseCellDetailDrawer';
import { rowKeyForRow, type SelectedGridCell } from '../databaseGridTypes';
import { useWorkspace } from '../../../src/context/WorkspaceContext';
import {
  isPlatformWorkspace,
  type DatabaseStudioDatasource,
} from '../../../src/lib/databaseStudioRoute';
import {
  databaseTableMetaFromSelection as tableMetaFromSelection,
  findSelectedDatabaseTable as findSelectedTable,
  isDatabaseNotNull as isNotNull,
  isDatabasePrimaryKey as isPrimaryKey,
  qualifiedDatabaseTableRef as qualifiedTableRef,
  quoteDatabaseIdent as quoteIdent,
  type DatabaseSchemaColumn as SchemaColumn,
} from '../../../src/lib/databaseStudioModels';
import {
  databaseTableApiPath as tableApiPath,
  fetchDatabaseJson as fetchJson,
} from '../../../src/lib/databaseStudioApi';
import { resolveDatabaseStudioPermissions } from '../../../src/lib/databaseStudioPermissions';
import { useDatabasePaneLayout } from './useDatabasePaneLayout';
import { useDatabaseSidebarLayout } from './useDatabaseSidebarLayout';
import {
  readStoredDatasource,
  useDatabaseRouteState,
} from './useDatabaseRouteState';
import { useDatabaseResources } from './useDatabaseResources';
import { isPlatformD1Source } from '../resources/preferD1Resource';
import { useDatabaseTables } from './useDatabaseTables';
import { useDatabaseTableMetadata } from './useDatabaseTableMetadata';
import {
  useDatabaseSectionShell,
  resolveDatabaseStudioActiveTables,
} from './useDatabaseSectionShell';
import { useDatabaseSqlRunner } from './useDatabaseSqlRunner';
import { useDatabaseBrowse } from './useDatabaseBrowse';
import { useDatabaseCrud } from './useDatabaseCrud';

export type DatabaseStudioProps = {
  databaseName?: string;
  onBackToOverview?: () => void;
};

type Datasource = DatabaseStudioDatasource;
type MetaPanel = 'schema' | 'indexes' | 'relations';

export function useDatabaseStudioController({
  databaseName,
  onBackToOverview,
}: DatabaseStudioProps) {
  const { workspaceId, workspaces } = useWorkspace();
  const surfacePublisherRef = useRef(createDatabaseSurfacePublisher());
  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tableSearch, setTableSearch] = useState('');
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [tableMenu, setTableMenu] = useState<{ table: string; x: number; y: number } | null>(null);
  const [menuToast, setMenuToast] = useState<string | null>(null);

  const [selectedCell, setSelectedCell] = useState<SelectedGridCell | null>(null);
  const [cellDetail, setCellDetail] = useState<CellDetailPayload | null>(null);

  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const {
    d1Resources,
    d1ResourceId,
    d1ResourceName,
    d1OnboardingRequired,
    setD1ResourceId,
    setD1ResourceName,
    setD1OnboardingRequired,
    supabaseConnected,
    supabaseProjects,
    supabaseProjectRef,
    supabaseConnectUrl,
    platformSupabase,
    setSupabaseProjectRef,
    d1FetchInit,
    fetchD1Json,
    loadDataPlaneContext,
    loadD1Resources,
  } = useDatabaseResources({
    workspaceId,
    databaseName,
    initialSource: searchParams.get('source'),
    initialResourceRef: searchParams.get('resource_ref'),
  });
  const {
    tables,
    d1Status,
    d1LoadError,
    hyperStatus,
    loadingTables,
    tableError,
    setTableError,
    loadTables,
    loadCustomerSupabaseTables,
    clearD1Tables,
    clearSupabaseTables,
  } = useDatabaseTables({
    d1FetchInit,
    setD1OnboardingRequired,
  });
  const [capLoaded, setCapLoaded] = useState(false);
  const [pageReady, setPageReady] = useState(false);
  const [hyperHealthBad, setHyperHealthBad] = useState(false);

  const sqlEditorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);
  const {
    resultsPaneHeight,
    splitterDragging,
    sqlStackRef,
    beginResultsPaneResize,
    resetResultsPaneHeight,
  } = useDatabasePaneLayout();
  const {
    sidebarWidth,
    sidebarCollapsed,
    sidebarDragging,
    studioShellRef,
    beginSidebarResize,
    toggleSidebarCollapsed,
  } = useDatabaseSidebarLayout();
  const selectedD1Resource = d1Resources.find(
    (resource) =>
      (d1ResourceId && resource.database_id === d1ResourceId) ||
      (!d1ResourceId && resource.database_name === d1ResourceName),
  );
  const d1ResourceScope = isPlatformD1Source(selectedD1Resource?.source)
    ? 'platform'
    : 'connected';
  const d1ResourceRef =
    selectedD1Resource?.database_id?.trim() ||
    d1ResourceId.trim() ||
    selectedD1Resource?.database_name?.trim() ||
    d1ResourceName.trim();
  const onNamedDatabaseBound = useCallback((name: string) => {
    setD1ResourceName((current) => current.trim() || name);
    clearD1Tables();
  }, [clearD1Tables, setD1ResourceName]);
  const {
    sidebarSource,
    setSidebarSource,
    studioSection,
    setStudioSection,
    selectedTable,
    setSelectedTable,
    metaPanel,
    setMetaPanel,
    effectiveDatasource,
  } = useDatabaseRouteState({
    searchParams,
    setSearchParams,
    databaseName,
    d1ResourceScope,
    d1ResourceRef,
    supabaseProjectRef,
    onNamedDatabaseBound,
  });
  const datasource: Datasource = sidebarSource;

  const activeTables = resolveDatabaseStudioActiveTables({
    studioSection,
    isSuperadmin,
    tables,
    effectiveDatasource,
  });
  const {
    schema,
    indexes,
    relations,
    columnCache,
    columnLoading,
    loadingMetadata,
    loadSchema,
    loadColumns,
    resetMetadata,
    clearColumnCache,
  } = useDatabaseTableMetadata({
    activeTables,
    datasource: effectiveDatasource,
    studioSection,
    supabaseProjectRef,
    fetchD1Json,
  });
  const connectedSupabase = supabaseProjects.find((project) => project.ref === supabaseProjectRef);
  const {
    datasourceLabel,
    filteredTables,
    selectD1Resource,
    selectSupabaseResource,
    onSelectD1,
    onSelectSupabase,
    onRefreshTables,
    sidebarEmptyMuted,
    setupContent,
  } = useDatabaseSectionShell({
    studioSection,
    setStudioSection,
    setSidebarSource,
    effectiveDatasource,
    isSuperadmin,
    activeTables,
    tableSearch,
    pageReady,
    databaseName,
    d1ResourceRef,
    d1Resources,
    setD1ResourceId,
    setD1ResourceName,
    clearD1Tables,
    clearSupabaseTables,
    loadTables,
    loadCustomerSupabaseTables,
    selectedD1Resource,
    d1ResourceName,
    platformSupabase,
    connectedSupabase,
    supabaseProjectRef,
    setSupabaseProjectRef,
    setSelectedTable,
    selectedTable,
    loadingTables,
    clearColumnCache,
    setExpandedTables,
    datasource,
    capLoaded,
    supabaseConnectUrl,
    supabaseConnected,
    workspaceId,
  });
  const selectedTableMeta = useMemo(
    () =>
      selectedTable
        ? findSelectedTable(activeTables, selectedTable, effectiveDatasource)
        : undefined,
    [activeTables, effectiveDatasource, selectedTable],
  );
  const selectedTableSqlName = selectedTableMeta
    ? qualifiedTableRef(selectedTableMeta, effectiveDatasource)
    : selectedTable && effectiveDatasource === 'd1'
      ? qualifiedTableRef({ name: selectedTable }, 'd1')
      : '';
  const pk = useMemo(() => schema.find(isPrimaryKey)?.name || '', [schema]);
  const { canWriteRows } = resolveDatabaseStudioPermissions({
    datasource: effectiveDatasource,
    resourceScope: d1ResourceScope,
    resourceRef: d1ResourceRef,
    capabilityLoaded: capLoaded,
    isSuperadmin,
    primaryKey: pk,
    selectedTable,
    selectedRowCount: 0,
  });
  const {
    sql,
    setSql,
    sqlResults,
    sqlColumns,
    sqlError,
    setSqlError,
    sqlRunState,
    setSqlRunState,
    sqlRunning,
    lastAttemptedSql,
    lastQueryMs,
    lastRowsRead,
    sqlConfirmModal,
    setSqlConfirmModal,
    requestRunSql,
    runSql,
    runSqlRef,
    confirmSqlModalRun,
    adoptRows,
    setExternalError,
    executeSqlInternal,
    clearSql,
  } = useDatabaseSqlRunner({
    datasource: effectiveDatasource,
    datasourceLabel,
    studioSection,
    canWriteRows,
    d1ResourceScope,
    d1ResourceRef,
    supabaseProjectRef,
    selectedTable,
    selectedTableSchema: selectedTableMeta?.table_schema,
    fetchD1Json,
    loadTables,
    loadCustomerSupabaseTables,
    loadSchema,
  });
  const {
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
    selectTableSql,
    tableBrowseTotalPages,
    refreshTableRows,
    applyFiltersToTable,
    resetForTable,
  } = useDatabaseBrowse({
    activeTables,
    datasource: effectiveDatasource,
    selectedTable,
    selectedTableMeta,
    studioSection,
    supabaseProjectRef,
    fetchD1Json,
    setSql,
    runSql: requestRunSql,
    adoptRows,
    sqlResultsLength: sqlResults.length,
  });
  const {
    canEditDataCell,
    canInsertRow,
    canDeleteRows,
    insertDisabledReason,
    deleteDisabledReason,
    editDisabledReason,
  } = resolveDatabaseStudioPermissions({
    datasource: effectiveDatasource,
    resourceScope: d1ResourceScope,
    resourceRef: d1ResourceRef,
    capabilityLoaded: capLoaded,
    isSuperadmin,
    primaryKey: pk,
    selectedTable,
    selectedRowCount: selectedRows.size,
  });
  const loadingMain = dataLoading || loadingMetadata;

  const loadThemeAccent = useCallback(async () => {
    const root = document.documentElement;
    const cmsReady =
      root.getAttribute('data-dashboard-theme-ready') === 'true' || Boolean(root.getAttribute('data-cms-theme'));
    if (cmsReady) {
      const hasMonacoBg =
        root.style.getPropertyValue('--database-monaco-bg').trim() || root.getAttribute('data-monaco-bg')?.trim();
      if (hasMonacoBg) return;
    }
    try {
      const theme = await fetchJson<{
        theme?: { config?: Record<string, unknown>; monaco_bg?: string };
        variables?: Record<string, string>;
      }>('/api/workspace/settings');
      if (!cmsReady) {
        const config = theme.theme?.config || {};
        const variables = theme.variables || {};
        const accent = String((config.accent_color || config.accentColor || variables['--color-accent'] || variables['--solar-cyan'] || '') ?? '').trim();
        if (accent) root.style.setProperty('--color-accent', accent);
      }
      const monacoBg = theme.theme?.monaco_bg;
      if (monacoBg && !root.style.getPropertyValue('--database-monaco-bg').trim()) {
        root.style.setProperty('--database-monaco-bg', String(monacoBg));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadCapabilities = useCallback(async (): Promise<boolean> => {
    try {
      const payload = await fetchJson<{ capabilities?: { is_superadmin?: boolean } }>('/api/integrations/summary');
      const superadmin = payload.capabilities?.is_superadmin === true;
      setIsSuperadmin(superadmin);
      return superadmin;
    } catch {
      setIsSuperadmin(false);
      return false;
    } finally {
      setCapLoaded(true);
    }
  }, [databaseName]);

  useEffect(() => {
    if (databaseName?.trim() || !workspaceId?.trim() || !pageReady) return;
    if (isPlatformWorkspace(activeWorkspace)) return;
    let cancelled = false;
    (async () => {
      try {
        const ctx = await fetchD1Json<{
          databases?: Array<{ database_name: string; workspace_id: string }>;
          active_database_name?: string | null;
        }>('/api/d1/context');
        if (cancelled) return;
        const match = ctx.databases?.find((d) => d.workspace_id === workspaceId);
        const name = match?.database_name || ctx.active_database_name || '';
        if (name.trim()) {
          navigate(`/dashboard/database/${encodeURIComponent(name.trim())}`, { replace: true });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [databaseName, workspaceId, pageReady, fetchD1Json, navigate, activeWorkspace]);

  useEffect(() => {
    let cancelled = false;
    const initialDs = databaseName?.trim() ? 'd1' : readStoredDatasource();
    (async () => {
      const [, superadmin] = await Promise.all([
        loadThemeAccent(),
        loadCapabilities(),
        loadD1Resources(),
      ]);
      if (cancelled) return;
      setPageReady(true);
      void loadDataPlaneContext();
      if (superadmin && initialDs === 'supabase') void loadTables('supabase');
    })();
    return () => {
      cancelled = true;
    };
  }, [
    databaseName,
    loadCapabilities,
    loadDataPlaneContext,
    loadD1Resources,
    loadTables,
    loadThemeAccent,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/hyperdrive/health', { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 401) {
          setHyperHealthBad(false);
          return;
        }
        if (res.status >= 500 || res.status === 503) {
          setHyperHealthBad(true);
          return;
        }
        setHyperHealthBad(data.ok === false);
      } catch {
        if (!cancelled) setHyperHealthBad(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onFmt = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      void sqlEditorRef.current?.getAction('editor.action.formatDocument')?.run();
    };
    window.addEventListener('keydown', onFmt);
    return () => window.removeEventListener('keydown', onFmt);
  }, []);

  useEffect(() => {
    const sqlForTable = (name: string, ds: Datasource) => {
      const meta =
        findSelectedTable(tables[ds], name, ds) ?? tableMetaFromSelection(name, ds);
      return `SELECT * FROM ${qualifiedTableRef(meta, ds)} LIMIT 50;`;
    };

    const onApply = (ev: Event) => {
      const e = ev as CustomEvent<{
        sql?: string;
        run?: boolean;
        autorun?: boolean;
        mode?: DbApplySqlMode;
        datasource?: DatabaseDatasource;
      }>;
      const text = String(e.detail?.sql ?? '').trim();
      if (!text) return;

      const targetDs = e.detail?.datasource;
      if (targetDs === 'd1' || targetDs === 'supabase') {
        setSidebarSource(targetDs);
        setStudioSection((current) =>
          targetDs === 'd1'
            ? 'd1'
            : current === 'connected_supabase'
              ? current
              : 'platform_supabase',
        );
      }

      const mode = e.detail?.mode ?? 'replace';
      const shouldRun = e.detail?.run === true || e.detail?.autorun === true;

      if (mode === 'append') {
        setSql((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
      } else {
        setSql(text);
      }

      if (shouldRun && (!targetDs || targetDs === effectiveDatasource)) {
        queueMicrotask(() => runSqlRef.current(text));
      }
    };

    const onOpenTable = (ev: Event) => {
      const e = ev as CustomEvent<{ datasource?: DatabaseDatasource; table?: string; tab?: MetaPanel | 'data' | 'sql' }>;
      const name = String(e.detail?.table ?? '').trim();
      if (!name) return;
      const ds: Datasource = e.detail?.datasource === 'supabase' ? 'supabase' : 'd1';
      setSidebarSource(ds);
      setStudioSection(
        ds === 'd1'
          ? 'd1'
          : studioSection === 'connected_supabase'
            ? 'connected_supabase'
            : 'platform_supabase',
      );
      setPage(1);
      const tab = e.detail?.tab;
      if (tab === 'schema' || tab === 'indexes' || tab === 'relations') {
        setSelectedTable(name);
        setMetaPanel(tab);
        void loadSchema(name);
        return;
      }
      const sqlText = sqlForTable(name, ds);
      setSelectedTable(name);
      setSql(sqlText);
      setMetaPanel(null);
      if (ds === effectiveDatasource) {
        queueMicrotask(() => runSqlRef.current(sqlText));
      }
    };

    const onQueryAnalysis = (ev: Event) => {
      const e = ev as CustomEvent<{ sql?: string; error?: string; datasource?: DatabaseDatasource }>;
      if (e.detail?.datasource === 'd1' || e.detail?.datasource === 'supabase') {
        setSidebarSource(e.detail.datasource);
      }
      const sqlText = String(e.detail?.sql ?? lastAttemptedSql ?? '').trim();
      const errText = e.detail?.error != null ? String(e.detail.error) : '';
      if (sqlText) {
        setSql(errText ? `${sqlText}\n\n-- Last error:\n-- ${errText.replace(/\n/g, '\n-- ')}` : sqlText);
      }
      if (errText) {
        setExternalError(errText);
      }
    };

    window.addEventListener('db:apply-sql', onApply as EventListener);
    window.addEventListener('db:open-table', onOpenTable as EventListener);
    window.addEventListener('db:open-query-analysis', onQueryAnalysis as EventListener);
    return () => {
      window.removeEventListener('db:apply-sql', onApply as EventListener);
      window.removeEventListener('db:open-table', onOpenTable as EventListener);
      window.removeEventListener('db:open-query-analysis', onQueryAnalysis as EventListener);
    };
  }, [
    effectiveDatasource,
    isSuperadmin,
    lastAttemptedSql,
    loadSchema,
    studioSection,
    tables,
  ]);

  useEffect(() => {
    const dialect = effectiveDatasource === 'supabase' ? 'postgresql' : 'sqlite';
    const gridRows = sqlResults.length ? sqlResults : data.rows;
    const selectedRow =
      selectedCell && pk
        ? gridRows.find((r, i) => rowKeyForRow(r, pk, i) === selectedCell.rowKey)
        : selectedCell?.row ?? null;
    const cellRow = selectedCell?.row ?? null;
    const provider = effectiveDatasource;
    const resourceRef =
      effectiveDatasource === 'd1'
        ? d1ResourceRef || null
        : studioSection === 'connected_supabase'
        ? supabaseProjectRef || null
        : 'platform_supabase';
    const resourceScope =
      effectiveDatasource === 'd1'
        ? d1ResourceScope
        : studioSection === 'platform_supabase'
          ? 'platform'
          : 'connected';
    const activeSchema =
      effectiveDatasource === 'supabase' && selectedTable
        ? selectedTableMeta?.table_schema || null
        : null;
    const payload: DatabaseSurfaceContext = {
      route: databaseName?.trim()
        ? `/dashboard/database/${encodeURIComponent(databaseName.trim())}`
        : '/dashboard/database',
      surface: 'database',
      view: 'studio',
      provider,
      resourceScope,
      resourceRef,
      datasource_binding: resourceRef,
      activeSchema,
      datasource: effectiveDatasource,
      dialect,
      selectedTable: selectedTableMeta?.name || selectedTable,
      activeMainTab: metaPanel || (selectedTable ? 'data' : 'sql'),
      currentSqlBuffer: sql ? sql.slice(0, 4000) : '',
      selectedSql: sql ? sql.slice(0, 2000) : '',
      lastAttemptedSql: lastAttemptedSql ? lastAttemptedSql.slice(0, 4000) : '',
      lastError: sqlError,
      lastResultMeta: {
        rowsRead: lastRowsRead,
        durationMs: lastQueryMs,
        runState: sqlRunState,
      },
      selectedCellSummary:
        selectedCell
          ? {
              table:
                selectedCell.table ||
                selectedTableMeta?.name ||
                selectedTable ||
                (selectedCell.source === 'sql_result' ? 'query' : ''),
              column: selectedCell.columnKey,
              rowKey: selectedCell.rowKey,
              valuePreview: (() => {
                const v = cellRow?.[selectedCell.columnKey] ?? selectedCell.value;
                if (v == null) return 'NULL';
                return typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 200);
              })(),
            }
          : null,
      selectedRowSummary: selectedRow ? { ...selectedRow } : null,
      schemaSummary: schema.length
        ? {
            columnCount: schema.length,
            primaryKeys: schema.filter(isPrimaryKey).map((c) => c.name),
            columns: schema.slice(0, 40).map((c) => ({
              name: c.name,
              type: c.type,
              pk: isPrimaryKey(c),
            })),
          }
        : null,
      dataSummary: {
        page: filters.length ? browseMeta.page : page,
        totalPages: filters.length ? browseMeta.total_pages : tableBrowseTotalPages,
        totalCount: filters.length ? browseMeta.total_count : (selectedTableMeta?.row_count ?? browseMeta.total_count),
        rowsOnPage: sqlResults.length,
      },
      activeFilters: filters.map(({ col, op, val }) => ({ col, op, val })),
      capabilities: {
        canRead: true,
        canWrite: canWriteRows,
        isSuperadmin,
      },
      sqlRunState,
      updatedAt: Date.now(),
    };
    surfacePublisherRef.current.publish(payload);
  }, [
    browseMeta,
    data.rows,
    activeWorkspace?.database_studio_name,
    canWriteRows,
    databaseName,
    d1ResourceScope,
    d1ResourceRef,
    effectiveDatasource,
    filters.length,
    isSuperadmin,
    lastAttemptedSql,
    lastQueryMs,
    lastRowsRead,
    page,
    pk,
    metaPanel,
    schema,
    selectedCell,
    selectedTable,
    selectedTableMeta?.name,
    selectedTableMeta?.row_count,
    selectedTableMeta?.table_schema,
    sql,
    sqlError,
    sqlResults,
    sqlRunState,
    studioSection,
    supabaseProjectRef,
    tableBrowseTotalPages,
  ]);

  useEffect(() => {
    const publisher = surfacePublisherRef.current;
    return () => {
      publisher.clear();
    };
  }, []);

  const onPickTable = (name: string) => {
    setSelectedTable(name);
    setPage(1);
    setMetaPanel(null);
    setFilters([]);
    setSelectedRows(new Set());
    void loadSchema(name);
    const statement = selectTableSql(name, 1);
    setSql(statement);
    requestRunSql(statement);
  };

  const openTableMeta = (name: string, panel: MetaPanel) => {
    setSelectedTable(name);
    setMetaPanel(panel);
    setTableMenu(null);
    void loadSchema(name);
  };

  const flashMenuToast = useCallback((msg: string) => {
    setMenuToast(msg);
    window.setTimeout(() => setMenuToast((cur) => (cur === msg ? null : cur)), 2200);
  }, []);

  const {
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
  } = useDatabaseCrud({
    canInsertRow,
    canDeleteRows,
    canEditDataCell,
    canWriteRows,
    datasource: effectiveDatasource,
    selectedTable,
    selectedTableSqlName,
    schema,
    pk,
    page,
    selectedRows,
    sqlResults,
    dataRows: data.rows,
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
  });

  const fetchCreateSql = useCallback(
    async (table: string): Promise<string | null> => {
      const meta =
        findSelectedTable(activeTables, table, effectiveDatasource) ??
        tableMetaFromSelection(table, effectiveDatasource);
      if (effectiveDatasource !== 'd1') {
        // Best-effort: synthesize from columns for non-D1.
        const path = tableApiPath(
          meta,
          effectiveDatasource,
          'schema',
          studioSection === 'connected_supabase' ? supabaseProjectRef : '',
        );
        const payload = await fetchJson<{ columns?: SchemaColumn[]; schema?: SchemaColumn[] }>(path);
        const cols = payload.columns || payload.schema || [];
        if (!cols.length) return null;
        const lines = cols.map((c) => {
          const parts = [`  ${quoteIdent(c.name)} ${c.type || 'TEXT'}`];
          if (isNotNull(c)) parts[0] += ' NOT NULL';
          if (isPrimaryKey(c)) parts[0] += ' PRIMARY KEY';
          return parts[0];
        });
        return `CREATE TABLE ${qualifiedTableRef(meta, effectiveDatasource)} (\n${lines.join(',\n')}\n);`;
      }
      const payload = await fetchD1Json<{
        create_sql?: string | null;
        sql?: string | null;
        columns?: SchemaColumn[];
        schema?: SchemaColumn[];
      }>(tableApiPath(meta, 'd1', 'schema'));
      const fromMaster = (payload.create_sql || payload.sql || '').trim();
      if (fromMaster) return fromMaster.endsWith(';') ? fromMaster : `${fromMaster};`;
      const cols = payload.columns || payload.schema || [];
      if (!cols.length) return null;
      const lines = cols.map((c) => {
        let line = `  ${quoteIdent(c.name)} ${c.type || 'TEXT'}`;
        if (isNotNull(c)) line += ' NOT NULL';
        if (isPrimaryKey(c)) line += ' PRIMARY KEY';
        return line;
      });
      return `CREATE TABLE ${quoteIdent(meta.name)} (\n${lines.join(',\n')}\n);`;
    },
    [activeTables, effectiveDatasource, fetchD1Json, studioSection, supabaseProjectRef],
  );

  const onTableMenuAction = useCallback(
    async (action: TableContextMenuAction) => {
      if (!tableMenu) return;
      const name = tableMenu.table;
      setTableMenu(null);
      if (action === 'copy_name') {
        await copyToClipboard(name);
        flashMenuToast('Table name copied');
        return;
      }
      if (action === 'copy_schema') {
        try {
          const createSql = await fetchCreateSql(name);
          if (!createSql) {
            flashMenuToast('No CREATE TABLE SQL available');
            return;
          }
          await copyToClipboard(createSql);
          flashMenuToast('Table schema copied');
        } catch (e) {
          flashMenuToast(e instanceof Error ? e.message : 'Copy schema failed');
        }
        return;
      }
      if (action === 'explore_data') {
        onPickTable(name);
        return;
      }
      if (action === 'edit_schema') {
        openTableMeta(name, 'schema');
        return;
      }
      if (action === 'view_indexes') {
        openTableMeta(name, 'indexes');
        return;
      }
      if (action === 'view_relations') {
        openTableMeta(name, 'relations');
        return;
      }
      if (action === 'delete') {
        if (!canWriteRows || effectiveDatasource !== 'd1') {
          flashMenuToast('Drop table requires D1 write access');
          return;
        }
        setDropTableModal(name);
      }
    },
    [
      canWriteRows,
      copyToClipboard,
      effectiveDatasource,
      fetchCreateSql,
      flashMenuToast,
      tableMenu,
    ],
  );

  const toggleColumns = async (table: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    setExpandedTables((previous) => {
      const next = new Set(previous);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
    await loadColumns(table);
  };

  const getDataCellEditable = useCallback(
    (row: Record<string, unknown>, col: string) => {
      const isPkCol = Boolean(pk && col === pk);
      if (isPkCol) return { editable: false, reason: 'Primary key columns cannot be edited inline.' };
      if (!canEditDataCell) return { editable: false, reason: editDisabledReason };
      return { editable: true };
    },
    [canEditDataCell, editDisabledReason, pk],
  );

  const openCellDetail = useCallback((cell: SelectedGridCell) => {
    setSelectedCell(cell);
    const tableLabel =
      cell.source === 'sql_result' ? (selectedTable ? `Query result · ${selectedTable}` : 'Query result') : cell.table || 'Table';
    setCellDetail({
      datasourceLabel,
      tableName: tableLabel,
      columnName: cell.columnKey,
      rowKey: cell.source === 'data_tab' && pk && cell.row[pk] != null ? String(cell.row[pk]) : cell.rowKey,
      rowIndex: cell.rowIndex,
      rawValue: cell.value,
      editable: cell.editable,
      reasonIfNotEditable: cell.reasonIfNotEditable,
    });
  }, [datasourceLabel, pk, selectedTable]);

  const exportRows = useCallback((rows: Record<string, unknown>[], filename: string) => {
    const cols = Object.keys(rows[0] || {});
    const csv = [cols.join(','), ...rows.map((row) => cols.map((col) => JSON.stringify(row[col] ?? '')).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const copyVisibleDataCsv = useCallback(() => {
    const rows = sqlResults.length ? sqlResults : data.rows;
    exportRows(rows, `${selectedTable || 'table'}-page.csv`);
  }, [data.rows, exportRows, selectedTable, sqlResults]);

  const exportSqlResultsCsv = useCallback(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const base = selectedTable || 'query';
    exportRows(sqlResults, `${effectiveDatasource}-${base}-${stamp}.csv`);
  }, [effectiveDatasource, exportRows, selectedTable, sqlResults]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCellDetail(null);
        setEditingCell(null);
        return;
      }
      if (event.key === 'Enter' && selectedCell && !editingCell) {
        const tag = (event.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        event.preventDefault();
        openCellDetail(selectedCell);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingCell, openCellDetail, selectedCell]);

  useEffect(() => {
    if (!tableMenu) return;
    const close = () => setTableMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [tableMenu]);


  return {
    studioShellRef,
    sidebarWidth,
    sidebarCollapsed,
    sidebarDragging,
    beginSidebarResize,
    toggleSidebarCollapsed,
    effectiveDatasource,
    isSuperadmin,
    supabaseConnected,
    supabaseConnectUrl,
    tableSearch,
    setTableSearch,
    filteredTables,
    selectedTable,
    expandedTables,
    columnCache,
    columnLoading,
    pageReady,
    loadingTables,
    d1LoadError,
    d1OnboardingRequired,
    sidebarEmptyMuted,
    onSelectD1,
    onSelectSupabase,
    onRefreshTables,
    clearSql,
    onPickTable,
    toggleColumns,
    setTableMenu,
    tableMenu,
    canWriteRows,
    onTableMenuAction,
    menuToast,
    onBackToOverview,
    datasourceLabel,
    d1Resources,
    d1ResourceRef,
    selectD1Resource,
    studioSection,
    supabaseProjectRef,
    supabaseProjects,
    platformSupabase,
    selectSupabaseResource,
    cellDetail,
    setCellDetail,
    copyToClipboard,
    selectedCell,
    setSelectedCell,
    applyCellEdit,
    pk,
    sqlStackRef,
    sql,
    setSql,
    sqlEditorRef,
    resultsPaneHeight,
    splitterDragging,
    beginResultsPaneResize,
    resetResultsPaneHeight,
    sqlRunState,
    lastQueryMs,
    lastRowsRead,
    sqlRunning,
    runSql,
    canInsertRow,
    insertDisabledReason,
    setDrawer,
    canDeleteRows,
    deleteDisabledReason,
    setDeleteRowsModal,
    refreshTableRows,
    page,
    loadingMain,
    copyVisibleDataCsv,
    selectedRows,
    setSelectedRows,
    filters,
    setFilters,
    schema,
    applyFiltersToTable,
    sqlResults,
    sqlColumns,
    sqlError,
    lastAttemptedSql,
    exportSqlResultsCsv,
    openCellDetail,
    editingCell,
    setEditingCell,
    getDataCellEditable,
    data,
    browseMeta,
    selectedTableMeta,
    tableBrowseTotalPages,
    sortCol,
    sortDir,
    setSortCol,
    setSortDir,
    setupContent,
    metaPanel,
    setMetaPanel,
    selectedTableSqlName,
    indexes,
    relations,
    sqlConfirmModal,
    setSqlConfirmModal,
    confirmSqlModalRun,
    dropTableModal,
    dropTableBusy,
    setDropTableModal,
    confirmDropTable,
    deleteRowsModal,
    deleteSelectedRows,
    drawer,
    insertValues,
    setInsertValues,
    insertSql,
    insertRow,
    dataError,
    tableError,
    setDataError,
    setTableError,
};
}
