import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchDatabaseJson } from '../../../src/lib/databaseStudioApi';
import {
  evaluateDatabaseSqlSafety,
  getDatabaseSqlRunGate,
} from '../../../src/lib/databaseSqlSafety';
import type { DatabaseSqlRunState } from '../../../src/lib/databaseStudioModels';
import type { SqlConfirmPayload } from '../DatabaseSqlConfirmModal';

type Datasource = 'd1' | 'supabase';
type StudioSection = 'd1' | 'platform_supabase' | 'connected_supabase';

type UseDatabaseSqlRunnerInput = {
  datasource: Datasource;
  datasourceLabel: string;
  studioSection: StudioSection;
  canWriteRows: boolean;
  d1ResourceScope: 'platform' | 'connected';
  d1ResourceRef: string;
  supabaseProjectRef: string;
  selectedTable?: string | null;
  selectedTableSchema?: string | null;
  fetchD1Json: <T>(url: string, init?: RequestInit) => Promise<T>;
  loadTables: (datasource: Datasource) => Promise<void>;
  loadCustomerSupabaseTables: (projectRef: string) => Promise<void>;
  loadSchema: (table: string) => Promise<void>;
};

export function useDatabaseSqlRunner({
  datasource,
  datasourceLabel,
  studioSection,
  canWriteRows,
  d1ResourceScope,
  d1ResourceRef,
  supabaseProjectRef,
  selectedTable,
  selectedTableSchema,
  fetchD1Json,
  loadTables,
  loadCustomerSupabaseTables,
  loadSchema,
}: UseDatabaseSqlRunnerInput) {
  const [sql, setSql] = useState('');
  const [sqlResults, setSqlResults] = useState<Record<string, unknown>[]>([]);
  const [sqlColumns, setSqlColumns] = useState<string[]>([]);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlRunState, setSqlRunState] = useState<DatabaseSqlRunState>('idle');
  const [lastAttemptedSql, setLastAttemptedSql] = useState('');
  const [lastQueryMs, setLastQueryMs] = useState<number | null>(null);
  const [lastRowsRead, setLastRowsRead] = useState<number | null>(null);
  const [sqlConfirmModal, setSqlConfirmModal] = useState<SqlConfirmPayload | null>(null);
  const sqlRef = useRef(sql);
  const runSqlRef = useRef<(statement: string) => Promise<void>>(async () => {});
  sqlRef.current = sql;

  const clearResultError = useCallback((message: string, state: DatabaseSqlRunState = 'error') => {
    setSqlError(message);
    setSqlResults([]);
    setSqlColumns([]);
    setSqlRunState(state);
  }, []);

  const adoptRows = useCallback((rows: Record<string, unknown>[], columns?: string[]) => {
    setSqlResults(rows);
    setSqlColumns(columns?.length ? columns : Object.keys(rows[0] || {}));
    setSqlRunState('success');
  }, []);

  const executeSqlInternal = useCallback(async (
    raw: string,
    opts: { studioApproved?: boolean; destructiveConfirmed?: boolean } = {},
  ) => {
    setLastAttemptedSql(raw);
    setSqlRunState('running');
    setSqlError(null);
    const startedAt = performance.now();
    try {
      const resourceRef =
        datasource === 'd1'
          ? d1ResourceRef
          : studioSection === 'platform_supabase'
            ? 'platform_supabase'
            : supabaseProjectRef.trim();
      if (!resourceRef) throw new Error('Select a database resource before running SQL.');

      const endpoint =
        studioSection === 'connected_supabase'
          ? '/api/data-plane/customer-supabase/query'
          : datasource === 'd1'
            ? '/api/d1/query'
            : '/api/hyperdrive/query';
      const fetchQuery = datasource === 'd1' ? fetchD1Json : fetchDatabaseJson;
      const payload = await fetchQuery<{
        rows?: Record<string, unknown>[];
        results?: Record<string, unknown>[];
        error?: string;
      }>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: raw,
          params: [],
          provider: datasource,
          resource_ref: resourceRef,
          resource_scope:
            datasource === 'd1'
              ? d1ResourceScope
              : studioSection === 'platform_supabase'
                ? 'platform'
                : 'connected',
          schema: selectedTableSchema || undefined,
          project_ref: studioSection === 'connected_supabase' ? supabaseProjectRef || undefined : undefined,
          studio_approved: opts.studioApproved === true,
          destructive_confirmed: opts.destructiveConfirmed === true,
        }),
      });

      if (payload.error) {
        clearResultError(payload.error);
        setLastQueryMs(Math.round(performance.now() - startedAt));
        setLastRowsRead(0);
        return;
      }

      const rows = payload.rows || payload.results || [];
      adoptRows(Array.isArray(rows) ? rows : []);
      setLastQueryMs(Math.round(performance.now() - startedAt));
      setLastRowsRead(Array.isArray(rows) ? rows.length : 0);

      const statementKind = evaluateDatabaseSqlSafety(raw, { canWrite: canWriteRows }).kind;
      if (statementKind !== 'read' && statementKind !== 'explain') {
        if (studioSection === 'connected_supabase') {
          await loadCustomerSupabaseTables(supabaseProjectRef);
        } else {
          await loadTables(datasource);
        }
        if (selectedTable) await loadSchema(selectedTable);
      }
    } catch (error) {
      clearResultError(error instanceof Error ? error.message : String(error));
      setLastQueryMs(Math.round(performance.now() - startedAt));
      setLastRowsRead(0);
    }
  }, [
    adoptRows,
    canWriteRows,
    clearResultError,
    d1ResourceRef,
    d1ResourceScope,
    datasource,
    fetchD1Json,
    loadCustomerSupabaseTables,
    loadSchema,
    loadTables,
    selectedTable,
    selectedTableSchema,
    studioSection,
    supabaseProjectRef,
  ]);

  const requestRunSql = useCallback((statement?: string) => {
    const raw = (statement ?? sqlRef.current).trim();
    if (!raw) {
      clearResultError('Empty query');
      return;
    }
    const safety = evaluateDatabaseSqlSafety(raw, { canWrite: canWriteRows });
    if (!safety.allowed) {
      clearResultError(safety.error || 'SQL not permitted');
      return;
    }
    const gate = getDatabaseSqlRunGate(raw, { canWrite: canWriteRows });
    if (!gate.canExecute) {
      if (gate.requiresApproval || gate.requiresRunModal) {
        setSqlConfirmModal({
          sql: raw,
          kind: gate.kind,
          riskLevel: gate.riskLevel,
          requiresConfirmTyping: gate.requiresConfirmTyping,
          datasourceLabel,
        });
        return;
      }
      clearResultError(gate.error || 'SQL not permitted');
      return;
    }
    void executeSqlInternal(raw, {
      studioApproved: true,
      destructiveConfirmed: gate.requiresConfirmTyping,
    });
  }, [canWriteRows, clearResultError, datasourceLabel, executeSqlInternal]);

  const confirmSqlModalRun = useCallback(() => {
    if (!sqlConfirmModal) return;
    const payload = sqlConfirmModal;
    setSqlConfirmModal(null);
    void executeSqlInternal(payload.sql, {
      studioApproved: true,
      destructiveConfirmed: payload.requiresConfirmTyping,
    });
  }, [executeSqlInternal, sqlConfirmModal]);

  const setExternalError = useCallback((message: string) => {
    setSqlError(message);
    setSqlRunState('error');
  }, []);

  const clearSql = useCallback(() => {
    setSql('');
    setSqlResults([]);
    setSqlColumns([]);
    setSqlError(null);
    setSqlRunState('idle');
    setLastAttemptedSql('');
    setLastQueryMs(null);
    setLastRowsRead(null);
  }, []);

  useEffect(() => {
    runSqlRef.current = async (statement: string) => {
      requestRunSql(statement);
    };
  }, [requestRunSql]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      requestRunSql();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestRunSql]);

  return {
    sql,
    setSql,
    sqlResults,
    sqlColumns,
    sqlError,
    setSqlError,
    sqlRunState,
    setSqlRunState,
    sqlRunning: sqlRunState === 'running',
    lastAttemptedSql,
    lastQueryMs,
    lastRowsRead,
    sqlConfirmModal,
    setSqlConfirmModal,
    requestRunSql,
    runSql: requestRunSql,
    runSqlRef,
    confirmSqlModalRun,
    adoptRows,
    setExternalError,
    executeSqlInternal,
    clearSql,
  };
}
