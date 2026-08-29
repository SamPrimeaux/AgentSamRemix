import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, Send, Trash2, Zap, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { DataGrid } from './DataGrid';
import type { SqlDialect } from './SQLConsole';

export type SqlRunResult = {
  success: boolean;
  results?: Record<string, unknown>[];
  error?: string;
  meta?: unknown;
};

type ChatMsg = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  sql?: string;
  text?: string;
  error?: string;
  results?: Record<string, unknown>[];
  meta?: unknown;
};

const SUGGESTIONS: Record<SqlDialect, { label: string; sql: string }[]> = {
  d1: [
    { label: 'List tables', sql: `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;` },
    { label: 'SQLite version', sql: `SELECT sqlite_version() AS version;` },
    { label: 'Count tables', sql: `SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type='table';` },
  ],
  postgres: [
    {
      label: 'Public tables',
      sql: `SELECT table_schema, table_name, table_type
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog','information_schema')
ORDER BY table_schema, table_name
LIMIT 50;`,
    },
    { label: 'Extensions', sql: `SELECT extname, extversion FROM pg_extension ORDER BY 1;` },
    { label: 'pgvector check', sql: `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS pgvector_installed;` },
  ],
};

function id(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

interface DatabaseAgentChatProps {
  runSQL: (sql: string) => Promise<SqlRunResult>;
  dialect: SqlDialect;
  dbLabel: string;
}

export const DatabaseAgentChat: React.FC<DatabaseAgentChatProps> = ({ runSQL, dialect, dbLabel }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      id: id(),
      role: 'system',
      text: `Database agent for ${dbLabel}. Paste SQL and press Run. Suggestions below match your current engine (${dialect === 'postgres' ? 'PostgreSQL / Hyperdrive' : 'SQLite / D1'}).`,
    },
  ]);
  const [running, setRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, running]);

  const executeSql = useCallback(
    async (sql: string) => {
      const trimmed = sql.trim();
      if (!trimmed) return;
      const userMsg: ChatMsg = { id: id(), role: 'user', sql: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setRunning(true);
      try {
        const out = await runSQL(trimmed);
        if (out.success) {
          const rows = out.results ?? [];
          const meta = out.meta;
          setMessages((prev) => [
            ...prev,
            {
              id: id(),
              role: 'assistant',
              results: rows,
              meta,
              text:
                rows.length === 0 && meta != null
                  ? 'Statement completed.'
                  : rows.length === 0
                    ? 'OK (no rows returned).'
                    : undefined,
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: id(),
              role: 'assistant',
              error: out.error || 'Query failed',
            },
          ]);
        }
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          {
            id: id(),
            role: 'assistant',
            error: e instanceof Error ? e.message : String(e),
          },
        ]);
      } finally {
        setRunning(false);
      }
    },
    [runSQL],
  );

  const runFromInput = () => {
    const sql = input.trim();
    if (!sql || running) return;
    setInput('');
    void executeSql(sql);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runFromInput();
  };

  const clearChat = () => {
    setMessages([
      {
        id: id(),
        role: 'system',
        text: 'Chat cleared. Paste SQL to run against the active connection.',
      },
    ]);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-app)] overflow-hidden">
      <div className="px-4 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-panel)] shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[var(--solar-magenta)]/15">
            <Sparkles size={14} className="text-[var(--solar-magenta)]" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest">Database agent</div>
            <div className="text-[9px] text-muted font-mono">{dbLabel}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={clearChat}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest text-muted hover:bg-[var(--bg-hover)] hover:text-main"
        >
          <Trash2 size={11} /> Clear
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[min(100%,42rem)] rounded-xl border px-3 py-2.5 text-[12px] ${
                m.role === 'user'
                  ? 'bg-[var(--solar-cyan)]/10 border-[var(--solar-cyan)]/25 text-main'
                  : m.role === 'system'
                    ? 'bg-[var(--bg-panel)] border-[var(--border-subtle)] text-muted italic'
                    : m.error
                      ? 'bg-[var(--solar-red)]/8 border-[var(--solar-red)]/25 text-main'
                      : 'bg-[var(--bg-panel)] border-[var(--border-subtle)] text-main'
              }`}
            >
              {m.role === 'user' && m.sql && (
                <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-[var(--solar-cyan)]">{m.sql}</pre>
              )}
              {m.role === 'system' && m.text && <p className="text-[11px] leading-relaxed not-italic">{m.text}</p>}
              {m.role === 'assistant' && m.error && (
                <div className="flex items-start gap-2">
                  <XCircle size={14} className="text-[var(--solar-red)] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-[var(--solar-red)] mb-1">Error</div>
                    <pre className="text-[11px] font-mono whitespace-pre-wrap break-words">{m.error}</pre>
                  </div>
                </div>
              )}
              {m.role === 'assistant' && !m.error && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--solar-green)]">
                    <CheckCircle2 size={12} />
                    Success
                    {m.results != null && (
                      <span className="font-mono font-normal text-muted normal-case">
                        {m.results.length} row{m.results.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {m.text && <p className="text-[11px] text-muted">{m.text}</p>}
                  {m.meta != null && (
                    <pre className="text-[10px] font-mono p-2 rounded bg-[var(--bg-app)] border border-[var(--border-subtle)] overflow-x-auto text-muted">
                      {JSON.stringify(m.meta, null, 2)}
                    </pre>
                  )}
                  {m.results && m.results.length > 0 && (
                    <div className="max-h-[min(60vh,28rem)] overflow-auto rounded-lg border border-[var(--border-subtle)]">
                      <DataGrid data={m.results} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {running && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[11px] text-muted">
              <Loader2 size={14} className="animate-spin text-[var(--solar-cyan)]" />
              Running query…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 shrink-0">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {SUGGESTIONS[dialect].map((s) => (
            <button
              key={s.label}
              type="button"
              disabled={running}
              onClick={() => void executeSql(s.sql)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest bg-[var(--bg-app)] border border-[var(--border-subtle)] text-muted hover:border-[var(--solar-cyan)]/40 hover:text-main disabled:opacity-50"
            >
              <Zap size={10} className="text-[var(--solar-orange)]" />
              {s.label}
            </button>
          ))}
        </div>
        <form onSubmit={onSubmit} className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                runFromInput();
              }
            }}
            placeholder="Write SQL… (Enter to run, Shift+Enter for newline)"
            rows={3}
            disabled={running}
            spellCheck={false}
            className="flex-1 resize-none rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-[12px] font-mono text-main placeholder:text-muted focus:outline-none focus:border-[var(--solar-cyan)]/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={running || !input.trim()}
            className="self-end px-4 py-2 rounded-lg bg-[var(--solar-cyan)]/20 border border-[var(--solar-cyan)]/35 text-[var(--solar-cyan)] text-[11px] font-bold uppercase tracking-widest hover:bg-[var(--solar-cyan)]/30 disabled:opacity-40 flex items-center gap-2 shrink-0"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Run
          </button>
        </form>
      </div>
    </div>
  );
};
