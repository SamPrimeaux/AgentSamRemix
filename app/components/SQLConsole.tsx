import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import { Play, RotateCcw, Save, Trash2, Download } from 'lucide-react';
import { DataGrid } from './DataGrid';

const MonacoEditorView = lazy(() =>
  import('./MonacoEditorView').then((m) => ({ default: m.MonacoEditorView })),
);

export type SqlDialect = 'd1' | 'postgres';

function downloadText(filename: string, mime: string, body: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

interface SQLConsoleProps {
  onExecute: (sql: string) => Promise<{
    success: boolean;
    results?: any[];
    error?: string;
    executionMs?: number | null;
  }>;
  history: string[];
  dialect?: SqlDialect;
  /** When set, replaces editor contents (use with `initialSqlRevision` to re-apply the same string). */
  initialSql?: string;
  /** Increment to push `initialSql` into the editor again. */
  initialSqlRevision?: number;
  onSaveSnippet?: (sql: string) => void;
}

const DEFAULT_SQL: Record<SqlDialect, string> = {
  d1: `-- SQLite / D1
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`,
  postgres: `-- PostgreSQL (Supabase via Hyperdrive)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type IN ('BASE TABLE','VIEW')
ORDER BY table_name;`,
};

export const SQLConsole: React.FC<SQLConsoleProps> = ({
  onExecute,
  history: _history,
  dialect = 'd1',
  initialSql,
  initialSqlRevision = 0,
  onSaveSnippet,
}) => {
  const [sql, setSql] = useState(DEFAULT_SQL[dialect]);
  const [results, setResults] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionTime, setExecutionTime] = useState(0);
  const sqlRef = useRef(sql);
  const editorShellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sqlRef.current = sql;
  }, [sql]);

  useEffect(() => {
    setSql(DEFAULT_SQL[dialect]);
  }, [dialect]);

  useEffect(() => {
    if (initialSql === undefined || initialSql === null) return;
    setSql(initialSql);
    sqlRef.current = initialSql;
  }, [initialSql, initialSqlRevision]);

  const runQuery = useCallback(
    async (text?: string) => {
      const queryText = text ?? sqlRef.current;
      setIsExecuting(true);
      setError(null);
      const startTime = Date.now();
      try {
        const res = await onExecute(queryText);
        const wallMs = Date.now() - startTime;
        const execTime =
          res.executionMs != null && Number.isFinite(Number(res.executionMs))
            ? Math.round(Number(res.executionMs))
            : wallMs;
        setExecutionTime(execTime);
        if (res.success) {
          setResults(res.results || []);
        } else {
          setError(res.error || 'Unknown error');
        }
      } catch (err: unknown) {
        const execTime = Date.now() - startTime;
        setExecutionTime(execTime);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsExecuting(false);
      }
    },
    [onExecute],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
      const active = document.activeElement;
      if (!active || !editorShellRef.current?.contains(active)) return;
      e.preventDefault();
      void runQuery();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [runQuery]);

  const approxBytes = useMemo(() => {
    if (!results || !results.length) return 0;
    try {
      return new Blob([JSON.stringify(results)]).size;
    } catch {
      return 0;
    }
  }, [results]);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-panel)] overflow-hidden">
      {/* Editor Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-app)]">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void runQuery()}
            disabled={isExecuting}
            className="flex items-center gap-1.5 px-3 py-1 bg-[var(--solar-green)]/10 hover:bg-[var(--solar-green)]/20 border border-[var(--solar-green)]/30 text-[var(--solar-green)] rounded text-[11px] font-bold transition-all disabled:opacity-50"
          >
            <Play size={12} className={isExecuting ? 'animate-pulse' : ''} />
            {isExecuting ? 'Running...' : 'Run Query'}
          </button>
          <button
            type="button"
            onClick={() => setSql('')}
            className="p-1 px-2 hover:bg-[var(--bg-hover)] rounded text-muted hover:text-white transition-colors"
          >
            <RotateCcw size={13} />
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onSaveSnippet?.(sqlRef.current)}
            className="p-1 text-muted hover:text-white"
            title="Save snippet"
          >
            <Save size={13} />
          </button>
          <button
            type="button"
            className="p-1 text-muted hover:text-white"
            title="Reset starter SQL"
            onClick={() => {
              const next = DEFAULT_SQL[dialect];
              setSql(next);
              sqlRef.current = next;
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Editor Area — Monaco fills flex-1; min-h-0 allows flex child to shrink */}
      <div
        ref={editorShellRef}
        className="flex-1 flex flex-col min-h-0 border-b border-[var(--border-subtle)] overflow-hidden"
      >
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-[11px] text-muted">
              Loading editor…
            </div>
          }
        >
          <MonacoEditorView
            onChange={(newContent) => {
              const next = newContent ?? '';
              sqlRef.current = next;
              setSql(next);
            }}
            onSave={(content) => void runQuery(content)}
            onCursorPositionChange={() => {}}
            onEditorModelMeta={() => {}}
          />
        </Suspense>
      </div>

      {/* Results Area */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="px-4 py-1.5 bg-[var(--bg-app)] border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold tracking-widest uppercase text-muted">
          <span>Results</span>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {executionTime > 0 && <span className="text-[var(--solar-cyan)]">{executionTime}ms</span>}
            {results && results.length > 0 && (
              <>
                <span>{results.length} rows</span>
                {approxBytes > 0 && (
                  <span className="normal-case font-mono opacity-80">
                    ~{approxBytes < 1024 ? `${approxBytes} B` : `${(approxBytes / 1024).toFixed(1)} KB`}
                  </span>
                )}
                <button
                  type="button"
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] normal-case font-semibold"
                  title="Download JSON"
                  onClick={() =>
                    downloadText('query-results.json', 'application/json', JSON.stringify(results, null, 2))
                  }
                >
                  <Download size={11} /> JSON
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] normal-case font-semibold"
                  title="Download CSV"
                  onClick={() => downloadText('query-results.csv', 'text/csv', rowsToCsv(results as Record<string, unknown>[]))}
                >
                  <Download size={11} /> CSV
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 min-h-0">
          {error ? (
            <div className="p-3 bg-[var(--solar-red)]/10 border border-[var(--solar-red)]/20 rounded text-[var(--solar-red)] text-[12px] font-mono">
              <span className="font-bold">Error:</span> {error}
            </div>
          ) : results && results.length === 0 && !error ? (
            <div className="p-3 bg-[var(--solar-green)]/10 border border-[var(--solar-green)]/20 rounded text-[var(--solar-green)] text-[12px] font-mono">
              <span className="font-bold">Success!</span> Query executed in {executionTime}ms
            </div>
          ) : results && results.length > 0 ? (
            <DataGrid data={results} />
          ) : (
            <div className="h-full flex flex-col items-center justify-center opacity-30 text-[11px] font-mono">
              <Terminal size={24} className="mb-2" />
              Run a query to see results
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Terminal = ({ size, className }: { size: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);
