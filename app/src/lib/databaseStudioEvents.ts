/**
 * Database Studio ↔ ChatAssistant bridge (window CustomEvents).
 */

import {
  canClientAutorunDatabaseSql,
  classifyDatabaseSqlStatement,
  type SqlStatementKind,
} from './databaseSqlSafety';

export type DatabaseDatasource = 'd1' | 'supabase';
export type DatabaseResourceScope = 'platform' | 'workspace' | 'connected';
export type DbApplySqlMode = 'replace' | 'new_tab' | 'append';
export type DatabaseMainTab = 'schema' | 'data' | 'sql' | 'indexes' | 'relations';

export type DatabaseSurfaceContext = {
  route: '/dashboard/database' | `/dashboard/database/${string}`;
  surface: 'database';
  view: 'studio';
  provider: DatabaseDatasource;
  resourceScope: DatabaseResourceScope;
  resourceRef?: string | null;
  /** Binding/name for iam_db_action gating (e.g. D1 database name). */
  datasource_binding?: string | null;
  activeSchema?: string | null;
  datasource: DatabaseDatasource;
  dialect: 'sqlite' | 'postgresql';
  selectedTable: string | null;
  activeMainTab: DatabaseMainTab;
  currentSqlBuffer?: string;
  selectedSql?: string;
  lastAttemptedSql?: string;
  lastError?: string | null;
  lastResultMeta?: {
    rowsRead?: number | null;
    durationMs?: number | null;
    runState?: string;
  };
  selectedCellSummary?: {
    table?: string;
    column?: string;
    rowKey?: string | null;
    valuePreview?: string;
  } | null;
  selectedRowSummary?: Record<string, unknown> | null;
  schemaSummary?: {
    columnCount?: number;
    primaryKeys?: string[];
    columns?: Array<{ name: string; type?: string; pk?: boolean }>;
  } | null;
  dataSummary?: {
    page?: number;
    totalPages?: number;
    totalCount?: number;
    rowsOnPage?: number;
  } | null;
  activeFilters?: Array<{ col: string; op: string; val?: string }>;
  capabilities: {
    canRead: boolean;
    canWrite: boolean;
    isSuperadmin: boolean;
  };
  sqlRunState?: string;
  updatedAt: number;
};

export type DbApplySqlDetail = {
  datasource: DatabaseDatasource;
  sql: string;
  mode?: DbApplySqlMode;
  /** Default false — never auto-run destructive/mutation from chat in v1. */
  run?: boolean;
};

export type DbOpenTableDetail = {
  datasource: DatabaseDatasource;
  table: string;
  tab?: DatabaseMainTab;
};

export type DbOpenQueryAnalysisDetail = {
  datasource?: DatabaseDatasource;
  sql?: string;
  error?: string;
  queryFingerprint?: string;
};

export type IamDbActionRefresh = 'schema' | 'data' | 'both';

/** v2 iam_db_action block shape (assistant fenced JSON). */
export type IamDbActionPayload = {
  iam_db_action: string;
  datasource?: DatabaseDatasource;
  /** Must match the active studio binding name when set (e.g. inneranimalmedia-business). */
  datasource_binding?: string;
  sql?: string;
  mode?: DbApplySqlMode;
  run?: boolean;
  table?: string;
  tab?: DatabaseMainTab;
  error?: string;
  proposal_id?: string;
  run_after_approval?: boolean;
  refresh?: IamDbActionRefresh;
};

const SQL_FENCE_RE = /```(?:sql|postgresql|postgres|sqlite|d1)?\s*\n([\s\S]*?)```/gi;
const IAM_DB_ACTION_RE = /```(?:json)?\s*\n\s*(\{[\s\S]*?"iam_db_action"\s*:\s*"[^"]+"[\s\S]*?\})\s*```/gi;

function normalizeDatabaseDatasource(value: unknown): DatabaseDatasource | null {
  if (value === 'd1') return 'd1';
  if (value === 'supabase' || value === 'hyperdrive') return 'supabase';
  return null;
}

export function extractSqlBlocksFromMarkdown(text: string): string[] {
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(SQL_FENCE_RE.source, SQL_FENCE_RE.flags);
  while ((m = re.exec(text)) !== null) {
    const block = m[1]?.trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

function parseIamDbActionBlock(raw: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Parse assistant ```json {"iam_db_action":...} ``` blocks and dispatch studio events.
 */
function iamDbActionBindingAllowed(
  obj: Record<string, unknown>,
  opts: { datasource?: DatabaseDatasource; activeDatasourceBinding?: string | null },
): boolean {
  const activeBinding =
    opts.activeDatasourceBinding != null ? String(opts.activeDatasourceBinding).trim() : '';
  const blockBinding =
    obj.datasource_binding != null ? String(obj.datasource_binding).trim() : '';
  if (blockBinding && activeBinding && blockBinding !== activeBinding) {
    return false;
  }
  if (blockBinding && !activeBinding) {
    return false;
  }
  const ds = normalizeDatabaseDatasource(obj.datasource);
  if (ds && opts.datasource && ds !== opts.datasource) {
    return false;
  }
  return true;
}

export function parseAndDispatchDatabaseStudioActions(
  content: string,
  opts: {
    datasource?: DatabaseDatasource;
    isSuperadmin?: boolean;
    activeDatasourceBinding?: string | null;
  } = {},
) {
  if (typeof window === 'undefined') return;
  const defaultDs: DatabaseDatasource = opts.datasource === 'supabase' ? 'supabase' : 'd1';
  let m: RegExpExecArray | null;
  const re = new RegExp(IAM_DB_ACTION_RE);
  while ((m = re.exec(content)) !== null) {
    const obj = parseIamDbActionBlock(m[1]);
    if (!obj) continue;
    if (!iamDbActionBindingAllowed(obj, opts)) continue;
    const action = String(obj.iam_db_action || '').trim();
    const ds: DatabaseDatasource = normalizeDatabaseDatasource(obj.datasource) || defaultDs;
    const runAfterApproval = obj.run_after_approval === true;
    const proposalId =
      obj.proposal_id != null ? String(obj.proposal_id).trim() : '';
    void proposalId;
    void obj.refresh;
    if (runAfterApproval && !proposalId) continue;

    if (action === 'apply-sql' || action === 'db:apply-sql') {
      const sql = String(obj.sql || '').trim();
      if (!sql) continue;
      dispatchDbApplySql(
        {
          datasource: ds,
          sql,
          mode: (obj.mode as DbApplySqlMode) || 'replace',
          run: runAfterApproval ? false : obj.run === true,
        },
        { isSuperadmin: opts.isSuperadmin },
      );
    } else if (action === 'open-table' || action === 'db:open-table') {
      const table = String(obj.table || '').trim();
      if (!table) continue;
      dispatchDbOpenTable({
        datasource: ds,
        table,
        tab: (obj.tab as DatabaseMainTab) || 'data',
      });
    } else if (action === 'open-query-analysis' || action === 'db:open-query-analysis') {
      dispatchDbOpenQueryAnalysis({
        datasource: ds,
        sql: obj.sql != null ? String(obj.sql) : undefined,
        error: obj.error != null ? String(obj.error) : undefined,
      });
    }
  }
}

export function dispatchDbApplySql(detail: DbApplySqlDetail, opts?: { isSuperadmin?: boolean }) {
  if (typeof window === 'undefined') return;
  const runRequested = detail.run === true;
  const sql = String(detail.sql || '').trim();
  if (!sql) return;

  let run = false;
  if (runRequested) {
    run = canClientAutorunDatabaseSql(sql, true, opts?.isSuperadmin === true);
  }

  window.dispatchEvent(
    new CustomEvent('db:apply-sql', {
      detail: {
        datasource: detail.datasource,
        sql,
        mode: detail.mode ?? 'replace',
        run,
      },
    }),
  );
}

export function dispatchDbOpenTable(detail: DbOpenTableDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('db:open-table', { detail }));
}

export function dispatchDbOpenQueryAnalysis(detail: DbOpenQueryAnalysisDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('db:open-query-analysis', { detail }));
}

/** Last published studio snapshot (survives ChatAssistant remount / conversation switch). */
let lastDatabaseSurfaceContext: DatabaseSurfaceContext | null = null;
let lastPublisherId: string | null = null;
let publishSeq = 0;

function newPublisherId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `dbpub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export type DatabaseSurfacePublisher = {
  publisherId: string;
  publish: (payload: DatabaseSurfaceContext) => void;
  clear: () => void;
};

/**
 * Owned publisher so an older Studio unmount cannot clear a newer instance's snapshot.
 */
export function createDatabaseSurfacePublisher(): DatabaseSurfacePublisher {
  const publisherId = newPublisherId();
  return {
    publisherId,
    publish(payload: DatabaseSurfaceContext) {
      if (typeof window === 'undefined') return;
      publishSeq += 1;
      lastPublisherId = publisherId;
      lastDatabaseSurfaceContext = payload;
      window.dispatchEvent(new CustomEvent('iam-database-surface-context', { detail: payload }));
    },
    clear() {
      if (lastPublisherId !== publisherId) return;
      lastDatabaseSurfaceContext = null;
      lastPublisherId = null;
    },
  };
}

/** Publish live studio context for ChatAssistant / agent chat payload. */
export function publishDatabaseSurfaceContext(payload: DatabaseSurfaceContext) {
  if (typeof window === 'undefined') return;
  publishSeq += 1;
  lastPublisherId = lastPublisherId || 'legacy';
  lastDatabaseSurfaceContext = payload;
  window.dispatchEvent(new CustomEvent('iam-database-surface-context', { detail: payload }));
}

/** Read last Studio snapshot without waiting for another CustomEvent. */
export function getDatabaseSurfaceContext(): DatabaseSurfaceContext | null {
  return lastDatabaseSurfaceContext;
}

/** Clear when the owning Studio instance leaves (or legacy clear with no owner). */
export function clearDatabaseSurfaceContext(publisherId?: string | null) {
  if (publisherId != null && lastPublisherId != null && lastPublisherId !== publisherId) return;
  lastDatabaseSurfaceContext = null;
  lastPublisherId = null;
}

/** Test helper — current publisher ownership. */
export function getDatabaseSurfacePublisherMeta() {
  return { publisherId: lastPublisherId, publishSeq };
}

/**
 * When on /dashboard/database, push the last assistant SQL fence into the editor (never auto-run by default).
 */
export function tryDispatchDbApplyFromAssistantMessage(
  content: string,
  opts: {
    datasource?: DatabaseDatasource;
    isSuperadmin?: boolean;
    activeDatasourceBinding?: string | null;
  } = {},
) {
  if (typeof window === 'undefined') return;
  if (!window.location.pathname.startsWith('/dashboard/database')) return;

  parseAndDispatchDatabaseStudioActions(content, opts);

  const blocks = extractSqlBlocksFromMarkdown(content);
  if (!blocks.length) return;

  const sql = blocks[blocks.length - 1];
  const datasource: DatabaseDatasource =
    opts.datasource ??
    (window.location.pathname.includes('database') ? 'd1' : 'd1');

  dispatchDbApplySql(
    {
      datasource,
      sql,
      mode: 'replace',
      run: false,
    },
    { isSuperadmin: opts.isSuperadmin },
  );
}
