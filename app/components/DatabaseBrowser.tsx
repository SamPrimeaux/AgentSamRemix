import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Search,
  HardDrive,
  RefreshCw,
  Terminal,
  Table as TableIcon,
  ChevronRight,
  MessageSquare,
  Settings,
  ExternalLink,
  X,
  Check,
} from 'lucide-react';
import { SQLConsole, SqlDialect } from './SQLConsole';
import { DatabaseAgentChat } from './DatabaseAgentChat';
import type { DatabaseExplorerJump } from '../types/databaseExplorer';

type DBView = 'console' | 'agent' | 'settings';
type DBTarget = 'd1' | 'hyperdrive';

const KNOWN_CONNECTIONS: Record<DBTarget, { name: string; label: string }> = {
  d1: { name: 'Cloudflare D1', label: 'inneranimalmedia-business' },
  hyperdrive: { name: 'Supabase (Hyperdrive)', label: 'postgres' },
};

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

type TableEntry = { name: string; table_schema?: string };

function qualifiedFromTable(table: TableEntry) {
  const schema = table.table_schema?.trim() || 'agentsam';
  return `${schema}.${quoteIdent(table.name)}`;
}

function normalizeHyperTables(payload: unknown): TableEntry[] {
  const data = payload as { tables?: unknown[] };
  if (!Array.isArray(data?.tables)) return [];
  return data.tables
    .map((item) => {
      if (typeof item === 'string') return { name: item, table_schema: 'agentsam' };
      const row = item as { name?: string; table_name?: string; table_schema?: string };
      const name = String(row.name ?? row.table_name ?? '').trim();
      return { name, table_schema: row.table_schema ?? 'agentsam' };
    })
    .filter((t) => t.name);
}

export type { DatabaseExplorerJump } from '../types/databaseExplorer';

export const DatabaseBrowser: React.FC<{
  onClose?: () => void;
  explorerJump?: DatabaseExplorerJump | null;
  onExplorerJumpConsumed?: () => void;
}> = ({ onClose, explorerJump, onExplorerJumpConsumed }) => {
  const [view, setView] = useState<DBView>('console');
  const [dbTarget, setDbTarget] = useState<DBTarget>('d1');
  const [hyperdriveOk, setHyperdriveOk] = useState<boolean | null>(null);
  const [tables, setTables] = useState<TableEntry[]>([]);
  const [tableFilter, setTableFilter] = useState('');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sqlHistory, setSqlHistory] = useState<string[]>([]);
  const [remoteSqlHistory, setRemoteSqlHistory] = useState<
    { id?: string; sql_text?: string; ok?: number; created_at?: number; duration_ms?: number }[]
  >([]);
  const [sqlSnippets, setSqlSnippets] = useState<{ id?: string; title?: string; sql_text?: string }[]>([]);
  const [consoleInitialSql, setConsoleInitialSql] = useState<string | undefined>(undefined);
  const [consoleInitialSqlRev, setConsoleInitialSqlRev] = useState(0);

  const queryEndpoint = dbTarget === 'hyperdrive' ? '/api/hyperdrive/query' : '/api/d1/query';
  const sqlDialect: SqlDialect = dbTarget === 'hyperdrive' ? 'postgres' : 'd1';

  const pushConsoleSql = useCallback((text: string) => {
    setConsoleInitialSql(text);
    setConsoleInitialSqlRev((n) => n + 1);
  }, []);

  const loadRemoteHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/db/query-history', { credentials: 'same-origin' });
      const data = res.ok ? await res.json() : { items: [] };
      setRemoteSqlHistory(Array.isArray(data.items) ? data.items : []);
    } catch {
      setRemoteSqlHistory([]);
    }
  }, []);

  const loadSnippets = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/db/snippets', { credentials: 'same-origin' });
      const data = res.ok ? await res.json() : { items: [] };
      setSqlSnippets(Array.isArray(data.items) ? data.items : []);
    } catch {
      setSqlSnippets([]);
    }
  }, []);

  useEffect(() => {
    if (view === 'console') {
      void loadRemoteHistory();
      void loadSnippets();
    }
  }, [view, loadRemoteHistory, loadSnippets]);

  const runSQL = useCallback(
    async (
      sql: string,
    ): Promise<{
      success: boolean;
      results?: Record<string, unknown>[];
      error?: string;
      meta?: unknown;
      executionMs?: number | null;
    }> => {
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      try {
        const res = await fetch(queryEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ sql }),
        });
        const data = await res.json();
        const ms = typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : null;
        if (res.status === 401) {
          void fetch('/api/agent/db/query-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              sql_text: sql,
              db_target: dbTarget,
              ok: false,
              error_message: data.error || 'Unauthorized',
              duration_ms: ms,
            }),
          }).catch(() => {});
          return { success: false, error: data.error || 'Unauthorized', executionMs: ms };
        }
        if (res.status === 403) {
          void fetch('/api/agent/db/query-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              sql_text: sql,
              db_target: dbTarget,
              ok: false,
              error_message: data.error || 'Forbidden',
              duration_ms: ms,
            }),
          }).catch(() => {});
          return { success: false, error: data.error || 'Forbidden', executionMs: ms };
        }
        if (data.error && !Array.isArray(data.results)) {
          void fetch('/api/agent/db/query-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              sql_text: sql,
              db_target: dbTarget,
              ok: false,
              error_message: String(data.error),
              duration_ms: ms,
            }),
          }).catch(() => {});
          void loadRemoteHistory();
          return { success: false, error: data.error, executionMs: ms };
        }
        if (Array.isArray(data.results)) {
          setSqlHistory((prev) => [sql, ...prev].slice(0, 50));
          const rowCount = data.results.length;
          const serverMs =
            data.executionMs != null && Number.isFinite(Number(data.executionMs))
              ? Math.round(Number(data.executionMs))
              : null;
          const durationForLog = serverMs ?? ms;
          void fetch('/api/agent/db/query-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              sql_text: sql,
              db_target: dbTarget,
              ok: true,
              row_count: rowCount,
              duration_ms: durationForLog,
            }),
          }).catch(() => {});
          void loadRemoteHistory();
          return {
            success: true,
            results: data.results as Record<string, unknown>[],
            meta: data.meta,
            executionMs: serverMs ?? ms,
          };
        }
        void fetch('/api/agent/db/query-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            sql_text: sql,
            db_target: dbTarget,
            ok: false,
            error_message: data.error || 'Query failed',
            duration_ms: ms,
          }),
        }).catch(() => {});
        void loadRemoteHistory();
        return { success: false, error: data.error || 'Query failed', executionMs: ms };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        void fetch('/api/agent/db/query-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            sql_text: sql,
            db_target: dbTarget,
            ok: false,
            error_message: msg,
          }),
        }).catch(() => {});
        void loadRemoteHistory();
        const msCatch =
          typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : null;
        return { success: false, error: msg, executionMs: msCatch };
      }
    },
    [queryEndpoint, dbTarget, loadRemoteHistory],
  );

  const saveSnippet = useCallback(
    async (sql: string) => {
      const title = window.prompt('Snippet title');
      if (!title || !title.trim()) return;
      try {
        const res = await fetch('/api/agent/db/snippets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ title: title.trim(), sql_text: sql, db_target: dbTarget }),
        });
        if (res.ok) void loadSnippets();
      } catch {
        /* ignore */
      }
    },
    [dbTarget, loadSnippets],
  );

  useEffect(() => {
    if (!explorerJump?.token) return;
    if (explorerJump.dbTarget) setDbTarget(explorerJump.dbTarget);
    setView('console');
    const qs = explorerJump.querySql?.trim();
    const tbl = explorerJump.table?.trim();
    if (qs) {
      pushConsoleSql(qs);
    } else if (tbl) {
      const target = explorerJump.dbTarget ?? dbTarget;
      if (target === 'hyperdrive') {
        const entry = tables.find((t) => t.name === tbl) ?? { name: tbl, table_schema: 'agentsam' };
        pushConsoleSql(`SELECT * FROM ${qualifiedFromTable(entry)} LIMIT 100;`);
      } else {
        pushConsoleSql(`SELECT * FROM ${quoteIdent(tbl)} LIMIT 100;`);
      }
    }
    onExplorerJumpConsumed?.();
  }, [explorerJump?.token, explorerJump?.querySql, explorerJump?.table, explorerJump?.dbTarget, pushConsoleSql, onExplorerJumpConsumed]);

  useEffect(() => {
    fetch('/api/hyperdrive/status', { credentials: 'same-origin' })
      .then((r) => setHyperdriveOk(r.ok))
      .catch(() => setHyperdriveOk(false));
  }, []);

  useEffect(() => {
    void fetchTables();
  }, [dbTarget]);

  const fetchTables = async () => {
    setIsLoading(true);
    setSelectedTable(null);
    try {
      const endpoint = dbTarget === 'hyperdrive' ? '/api/hyperdrive/tables' : '/api/agent/db/tables';
      const res = await fetch(endpoint, { credentials: 'same-origin' });
      const data = await res.json();
      setTables(dbTarget === 'hyperdrive' ? normalizeHyperTables(data) : (Array.isArray(data.tables) ? data.tables.map((n: string) => ({ name: n })) : []));
    } catch (err) {
      console.error('fetchTables:', err);
      setTables([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTableClick = (table: TableEntry) => {
    setSelectedTable(table.name);
    if (dbTarget === 'hyperdrive') {
      pushConsoleSql(`SELECT * FROM ${qualifiedFromTable(table)} LIMIT 100;`);
    } else {
      pushConsoleSql(`SELECT * FROM ${quoteIdent(table.name)} LIMIT 100;`);
    }
  };

  const handleSqliteMasterClick = () => {
    setSelectedTable('sqlite_master');
    pushConsoleSql('SELECT * FROM sqlite_master LIMIT 100;');
  };

  const handleInformationSchemaClick = () => {
    setSelectedTable('information_schema.tables');
    pushConsoleSql(
      `SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('agentsam','public') AND table_type = 'BASE TABLE' ORDER BY table_schema, table_name LIMIT 100;`,
    );
  };

  const filteredTables = tables.filter((t) => {
    const label = `${t.table_schema ?? 'agentsam'}.${t.name}`.toLowerCase();
    return label.includes(tableFilter.toLowerCase()) || t.name.toLowerCase().includes(tableFilter.toLowerCase());
  });

  const conn = KNOWN_CONNECTIONS[dbTarget];

  return (
    <div className="w-full h-full min-h-0 bg-[var(--bg-panel)] flex flex-col text-main overflow-hidden relative">
      <div className="px-3 sm:px-4 py-2.5 border-b border-[var(--border-subtle)] flex flex-wrap items-center gap-x-3 gap-y-2 justify-between shrink-0 bg-[var(--bg-panel)]">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
          <div className="p-1.5 bg-[var(--solar-blue)]/10 rounded shrink-0">
            <Database size={14} className="text-[var(--solar-blue)]" />
          </div>
          <div className="flex flex-col leading-none min-w-0">
            <span className="text-[0.6875rem] font-bold tracking-widest uppercase">Database Explorer</span>
            <span className="text-[0.6875rem] text-muted font-mono mt-0.5 truncate max-w-[min(100%,14rem)] sm:max-w-none">
              {conn.label}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {(['d1', 'hyperdrive'] as DBTarget[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  if (t === 'hyperdrive' && !hyperdriveOk) return;
                  setDbTarget(t);
                }}
                className={`px-2 py-0.5 rounded text-[0.625rem] font-bold uppercase tracking-widest transition-all ${
                  dbTarget === t
                    ? 'text-[var(--text-heading)] border border-[var(--border-subtle)] bg-[var(--bg-hover)]'
                    : 'text-muted hover:text-[var(--text-heading)]'
                }`}
              >
                {t === 'd1' ? 'D1' : 'Hyperdrive'}
                {t === 'hyperdrive' && (
                  <span
                    className={`ml-1 w-1.5 h-1.5 inline-block rounded-full ${
                      hyperdriveOk ? 'bg-[var(--solar-green)]' : 'bg-[var(--solar-red)]'
                    }`}
                  />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-1.5 items-center flex-wrap justify-end w-full sm:w-auto overflow-x-auto pb-0.5 sm:pb-0 -mx-1 px-1 sm:mx-0 sm:px-0">
          <button
            type="button"
            onClick={() => setView('console')}
            className={`p-1 px-2 rounded text-[0.6875rem] flex items-center gap-1.5 transition-all ${
              view === 'console' ? 'bg-[var(--solar-cyan)]/20 text-[var(--solar-cyan)]' : 'hover:bg-[var(--bg-hover)] text-muted'
            }`}
            title="SQL console and table list"
          >
            <Terminal size={12} /> Console
          </button>
          <button
            type="button"
            onClick={() => setView('agent')}
            className={`p-1 px-2 rounded text-[0.6875rem] flex items-center gap-1.5 transition-all ${
              view === 'agent' ? 'bg-[var(--solar-magenta)]/20 text-[var(--solar-magenta)]' : 'hover:bg-[var(--bg-hover)] text-muted'
            }`}
          >
            <MessageSquare size={12} /> Agent
          </button>
          <button
            type="button"
            onClick={() => setView('settings')}
            className={`p-1 px-2 rounded text-[0.6875rem] flex items-center gap-1.5 transition-all ${
              view === 'settings' ? 'bg-[var(--solar-magenta)]/20 text-[var(--solar-magenta)]' : 'hover:bg-[var(--bg-hover)] text-muted'
            }`}
          >
            <Settings size={12} />
          </button>
          <div className="w-[1px] h-4 bg-[var(--border-subtle)] mx-1 self-center" />
          <button
            type="button"
            onClick={() => void fetchTables()}
            className="p-1.5 hover:bg-[var(--bg-hover)] rounded text-muted"
            title="Refresh"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 hover:bg-[var(--bg-hover)] rounded text-muted hover:text-[var(--solar-red)]"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0 max-md:flex-col">
        {view === 'console' && (
          <div className="w-60 max-md:w-full max-md:max-h-[min(38vh,260px)] max-md:min-h-[140px] max-md:shrink-0 border-r max-md:border-r-0 max-md:border-b border-[var(--border-subtle)] flex flex-col bg-[var(--bg-panel)] shrink-0 min-h-0">
            <div className="p-2 border-b border-[var(--border-subtle)]">
              <div className="flex items-center bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-md px-2 py-1 focus-within:border-[var(--solar-blue)]/50 transition-all">
                <Search size={12} className="text-muted mr-2 shrink-0" />
                <input
                  type="text"
                  placeholder="Filter tables..."
                  value={tableFilter}
                  onChange={(e) => setTableFilter(e.target.value)}
                  className="bg-transparent border-none outline-none text-[0.6875rem] w-full placeholder:text-muted font-mono"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-1 py-2 custom-scrollbar">
              <div className="text-[0.625rem] font-black uppercase tracking-widest text-muted mb-1 px-3 flex items-center justify-between">
                <span>Tables / Views</span>
                <span className="bg-[var(--bg-app)] px-1 rounded text-[0.6875rem] opacity-60">{filteredTables.length}</span>
              </div>

              {filteredTables.map((table) => (
                <div
                  key={`${table.table_schema ?? 'agentsam'}:${table.name}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleTableClick(table)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleTableClick(table);
                  }}
                  className={`group flex items-center gap-2.5 px-3 py-1.5 hover:bg-[var(--bg-hover)] cursor-pointer rounded-md text-[0.75rem] transition-all relative ${
                    selectedTable === table.name ? 'bg-[var(--bg-hover)] text-[var(--solar-blue)] font-bold' : 'text-main'
                  }`}
                >
                  {selectedTable === table.name && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-[var(--solar-blue)] rounded-r-sm" />
                  )}
                  <TableIcon
                    size={13}
                    className={`shrink-0 ${selectedTable === table.name ? 'text-[var(--solar-blue)]' : 'text-muted group-hover:text-[var(--solar-blue)]'}`}
                  />
                  <span className="truncate font-mono text-[11px]">
                    {dbTarget === 'hyperdrive' && table.table_schema && table.table_schema !== 'agentsam' ? (
                      <span className="text-muted">{table.table_schema}.</span>
                    ) : null}
                    {table.name}
                  </span>
                  <div className="ml-auto opacity-0 group-hover:opacity-40">
                    <ChevronRight size={10} />
                  </div>
                </div>
              ))}

              {filteredTables.length === 0 && !isLoading && (
                <div className="px-3 py-8 text-center opacity-30 text-[0.6875rem] font-mono">
                  {tableFilter ? 'No match.' : 'No tables found.'}
                </div>
              )}

              <div className="mt-4">
                <div className="text-[0.625rem] font-black uppercase tracking-widest text-muted mb-1 px-3">System</div>
                {dbTarget === 'd1' ? (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={handleSqliteMasterClick}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleSqliteMasterClick();
                    }}
                    className="group flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-hover)] rounded-md text-[0.6875rem] text-muted hover:text-[var(--text-heading)] transition-colors"
                  >
                    <Database size={12} />
                    <span className="font-mono">sqlite_master</span>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={handleInformationSchemaClick}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleInformationSchemaClick();
                    }}
                    className="group flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-hover)] rounded-md text-[0.6875rem] text-muted hover:text-[var(--text-heading)] transition-colors"
                  >
                    <Database size={12} />
                    <span className="font-mono">information_schema (public)</span>
                  </div>
                )}
              </div>

              <>
                <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
                  <div className="text-[0.625rem] font-black uppercase tracking-widest text-muted mb-1 px-3 flex items-center justify-between gap-2">
                    <span>Saved snippets</span>
                    <button
                      type="button"
                      className="text-[0.625rem] text-[var(--solar-cyan)] hover:brightness-110"
                      onClick={() => void loadSnippets()}
                    >
                      Refresh
                    </button>
                  </div>
                  {sqlSnippets.length === 0 ? (
                    <p className="px-3 text-[0.625rem] text-muted opacity-80">No snippets yet. Use Save in the console.</p>
                  ) : (
                    sqlSnippets.map((s) => (
                      <button
                        key={s.id || s.title}
                        type="button"
                        onClick={() => {
                          const t = s.sql_text != null ? String(s.sql_text) : '';
                          if (!t) return;
                          pushConsoleSql(t);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] rounded-md text-[0.6875rem] text-main truncate"
                        title={s.title}
                      >
                        {s.title || 'Untitled'}
                      </button>
                    ))
                  )}
                </div>
                <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
                  <div className="text-[0.625rem] font-black uppercase tracking-widest text-muted mb-1 px-3 flex items-center justify-between gap-2">
                    <span>Server history</span>
                    <button
                      type="button"
                      className="text-[0.625rem] text-[var(--solar-cyan)] hover:brightness-110"
                      onClick={() => void loadRemoteHistory()}
                    >
                      Refresh
                    </button>
                  </div>
                  {remoteSqlHistory.length === 0 ? (
                    <p className="px-3 text-[0.625rem] text-muted opacity-80">
                      Runs sync here after migration 225 is applied.
                    </p>
                  ) : (
                    remoteSqlHistory.slice(0, 25).map((h) => {
                      const st = h.sql_text != null ? String(h.sql_text) : '';
                      const ok = h.ok !== 0;
                      return (
                        <button
                          key={h.id || st.slice(0, 24)}
                          type="button"
                          onClick={() => {
                            if (!st) return;
                            pushConsoleSql(st);
                          }}
                          className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] rounded-md text-[0.625rem] font-mono text-muted border-b border-[var(--border-subtle)]/40"
                        >
                          <span className={ok ? 'text-[var(--solar-green)]' : 'text-[var(--solar-red)]'}>
                            {ok ? 'ok' : 'err'}
                          </span>{' '}
                          <span className="text-main truncate block">{st.replace(/\s+/g, ' ').slice(0, 72)}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            </div>

            <div className="p-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-app)] text-[0.625rem] text-muted shrink-0 flex items-center justify-between font-mono">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--solar-green)] animate-pulse" />
                <span>Connected</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-hidden bg-[var(--bg-app)] min-h-0 min-w-0 flex flex-col">
          {view === 'console' && (
            <SQLConsole
              key={dbTarget}
              onExecute={runSQL}
              history={sqlHistory}
              dialect={sqlDialect}
              initialSql={consoleInitialSql}
              initialSqlRevision={consoleInitialSqlRev}
              onSaveSnippet={(sql) => void saveSnippet(sql)}
            />
          )}

          {view === 'agent' && (
            <DatabaseAgentChat
              runSQL={runSQL}
              dialect={sqlDialect}
              dbLabel={`${KNOWN_CONNECTIONS[dbTarget].name} — ${KNOWN_CONNECTIONS[dbTarget].label}`}
            />
          )}

          {view === 'settings' && (
            <div className="p-6 overflow-y-auto h-full">
              <div className="max-w-xl mx-auto flex flex-col gap-5">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
                  <h2 className="text-[0.9375rem] font-bold flex items-center gap-2">
                    <Settings size={16} className="text-[var(--solar-cyan)]" /> Database Connections
                  </h2>
                </div>

                <ConnectionCard
                  name="Cloudflare D1 (Native)"
                  sublabel="inneranimalmedia-business"
                  status="Connected"
                  active={dbTarget === 'd1'}
                  color="var(--solar-blue)"
                  icon={<HardDrive size={18} style={{ color: 'var(--solar-blue)' }} />}
                  onSelect={() => {
                    setDbTarget('d1');
                    setView('console');
                  }}
                />
                <ConnectionCard
                  name="Supabase via Hyperdrive"
                  sublabel="postgres / supabase"
                  status={hyperdriveOk === null ? 'Checking...' : hyperdriveOk ? 'Connected' : 'Unavailable'}
                  active={dbTarget === 'hyperdrive'}
                  color="var(--solar-green)"
                  icon={<ExternalLink size={18} style={{ color: 'var(--solar-green)' }} />}
                  onSelect={() => {
                    if (hyperdriveOk) {
                      setDbTarget('hyperdrive');
                      setView('console');
                    }
                  }}
                  disabled={!hyperdriveOk}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ConnectionCard = ({
  name,
  sublabel,
  status,
  active,
  color,
  icon,
  onSelect,
  disabled,
}: {
  name: string;
  sublabel: string;
  status: string;
  active: boolean;
  color: string;
  icon: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}) => (
  <div
    role="button"
    tabIndex={disabled ? -1 : 0}
    onClick={!disabled ? onSelect : undefined}
    onKeyDown={(e) => {
      if (!disabled && (e.key === 'Enter' || e.key === ' ')) onSelect();
    }}
    className={`p-4 rounded-xl border transition-all ${
      disabled
        ? 'opacity-40 cursor-not-allowed border-[var(--border-subtle)]'
        : active
          ? 'cursor-pointer border-transparent ring-1 shadow-lg'
          : 'cursor-pointer border-[var(--border-subtle)] hover:border-[var(--solar-cyan)]/40'
    } bg-[var(--bg-panel)]`}
    style={active && !disabled ? { boxShadow: `0 0 20px ${color}22` } : {}}
  >
    <div className="flex items-center gap-4">
      <div className="p-2 bg-[var(--bg-app)] rounded-lg">{icon}</div>
      <div className="flex-1">
        <h4 className="text-[0.8125rem] font-bold">{name}</h4>
        <span className="text-[0.625rem] font-mono text-muted">{sublabel}</span>
      </div>
      <span
        className="text-[0.625rem] font-black uppercase tracking-widest"
        style={{ color: status === 'Connected' ? 'var(--solar-green)' : 'var(--text-muted)' }}
      >
        {status}
      </span>
      {active && !disabled && <Check size={14} style={{ color }} />}
    </div>
  </div>
);
