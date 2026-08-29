import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AnalyticsLayoutResponse } from '../types';

type Props = { layout: AnalyticsLayoutResponse | null };

type Range = '24h' | '7d' | '30d' | 'all';
type ResolvedFilter = 'open' | 'resolved' | 'all';

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800/90 bg-slate-950/45 overflow-hidden">
      <header className="border-b border-slate-800/80 px-3 py-2">
        <h3 className="text-[13px] font-semibold text-slate-100">{title}</h3>
        {subtitle ? <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p> : null}
      </header>
      <div className="p-3 text-[12px] text-slate-300">{children}</div>
    </section>
  );
}

function severityStyle(s: string) {
  if (s === 'critical') return 'border-rose-800/60 bg-rose-950/30 text-rose-100';
  if (s === 'warn') return 'border-amber-800/50 bg-amber-950/25 text-amber-100';
  return 'border-slate-800/60 bg-slate-950/30 text-slate-200';
}

function fmtUnix(ts: unknown): string {
  const n = Number(ts);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Date(n * 1000).toISOString().replace('T', ' ').slice(0, 19);
  } catch {
    return String(ts);
  }
}

export default function AdvisorsTab(_props: Props) {
  const [searchParams] = useSearchParams();
  const sourceFromUrl = searchParams.get('source')?.trim() || '';
  const [range, setRange] = useState<Range>('7d');
  const [resolved, setResolved] = useState<ResolvedFilter>('open');
  const [sourceQ, setSourceQ] = useState(sourceFromUrl);
  const [main, setMain] = useState<Record<string, unknown> | null>(null);
  const [gr, setGr] = useState<Record<string, unknown> | null>(null);
  const [errLog, setErrLog] = useState<Record<string, unknown> | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const errUrl = useMemo(() => {
    const p = new URLSearchParams({ range, resolved });
    if (sourceQ.trim()) p.set('source', sourceQ.trim());
    p.set('limit', '100');
    return `/api/analytics/errors/d1-log?${p.toString()}`;
  }, [range, resolved, sourceQ]);

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      getJson<Record<string, unknown>>(`/api/analytics/advisors?range=${range}`),
      getJson<Record<string, unknown>>(`/api/analytics/advisors/guardrails?range=${range}`),
      getJson<Record<string, unknown>>(errUrl),
    ]);
    setMain(a);
    setGr(b);
    setErrLog(c);
  }, [range, errUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (sourceFromUrl) setSourceQ(sourceFromUrl);
  }, [sourceFromUrl]);

  const findings = (main?.rows as { severity?: string; title?: string; detail?: string; code?: string }[]) || [];
  const grRows = (gr?.rows as Record<string, unknown>[]) || [];
  const counts = (main?.summary as { counts?: Record<string, number> })?.counts;

  const errRows = (errLog?.rows as Record<string, unknown>[]) || [];
  const errSummary = errLog?.summary as
    | {
        open_in_window?: number;
        by_error_type?: { error_type?: string; c?: number }[];
        by_source?: { source?: string; c?: number }[];
      }
    | undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-100">Advisors · what to fix next</div>
          <div className="text-[11px] text-slate-500">
            D1 <span className="font-mono text-slate-400">agentsam_error_log</span> with suggested actions, plus
            heuristics and guardrails.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[12px] text-slate-200"
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
          >
            <option value="24h">24h</option>
            <option value="7d">7d</option>
            <option value="30d">30d</option>
            <option value="all">All</option>
          </select>
          <select
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[12px] text-slate-200"
            value={resolved}
            onChange={(e) => setResolved(e.target.value as ResolvedFilter)}
          >
            <option value="open">Unresolved only</option>
            <option value="resolved">Resolved only</option>
            <option value="all">All</option>
          </select>
          <input
            type="search"
            placeholder="Filter source contains…"
            className="w-44 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[12px] text-slate-200 placeholder:text-slate-600"
            value={sourceQ}
            onChange={(e) => setSourceQ(e.target.value)}
          />
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-[12px] text-slate-200 hover:bg-slate-800/80"
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>
      </div>

      {counts ? (
        <div className="flex flex-wrap gap-2 font-mono text-[10px] text-slate-500">
          <span className="rounded bg-slate-900/80 px-2 py-0.5">critical:{counts.critical ?? 0}</span>
          <span className="rounded bg-slate-900/80 px-2 py-0.5">warn:{counts.warnings ?? 0}</span>
          <span className="rounded bg-slate-900/80 px-2 py-0.5">info:{counts.info ?? 0}</span>
          <span className="rounded bg-slate-900/80 px-2 py-0.5">
            open errors (full window):{errSummary?.open_in_window ?? '—'}
          </span>
        </div>
      ) : null}

      <Section
        title="D1 error log (agentsam_error_log)"
        subtitle="Operator table: triage by type/source, then mark resolved in D1 after the fix ships."
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(errSummary?.by_error_type || []).slice(0, 8).map((b) => (
            <div key={String(b.error_type)} className="rounded border border-slate-800/80 bg-slate-950/50 px-2 py-1.5">
              <div className="truncate font-mono text-[10px] text-slate-400">{String(b.error_type || '—')}</div>
              <div className="text-[14px] font-semibold text-slate-100">{String(b.c ?? 0)}</div>
            </div>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap gap-2 text-[10px] text-slate-500">
          {(errSummary?.by_source || []).slice(0, 10).map((b) => (
            <span key={String(b.source)} className="rounded bg-slate-900/70 px-1.5 py-0.5 font-mono">
              {String(b.source || '—')}:{String(b.c ?? 0)}
            </span>
          ))}
        </div>
        <div className="mb-2 rounded border border-slate-800/60 bg-slate-950/60 p-2 font-mono text-[10px] text-slate-500">
          After verifying the fix:{' '}
          <code className="text-cyan-600/90">{`UPDATE agentsam_error_log SET resolved = 1 WHERE id = 'err_…';`}</code>
        </div>
        <div className="max-h-[min(70vh,520px)] overflow-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-[1] bg-slate-950/95">
              <tr className="text-left text-slate-500">
                <th className="pb-1 pr-2">when</th>
                <th className="pb-1 pr-2">type</th>
                <th className="pb-1 pr-2">source</th>
                <th className="pb-1 pr-2">message</th>
                <th className="pb-1">r</th>
              </tr>
            </thead>
            <tbody>
              {errRows.map((row) => {
                const id = String(row.id || '');
                const open = expandedId === id;
                return (
                  <React.Fragment key={id}>
                    <tr
                      className="cursor-pointer border-t border-slate-800/70 hover:bg-slate-900/40 align-top"
                      onClick={() => setExpandedId(open ? null : id)}
                    >
                      <td className="py-1 pr-2 whitespace-nowrap font-mono text-[10px] text-slate-500">
                        {fmtUnix(row.created_at)}
                      </td>
                      <td className="py-1 pr-2 font-mono text-[10px] text-amber-200/90">{String(row.error_type || '—')}</td>
                      <td className="py-1 pr-2 font-mono text-[10px] text-slate-400">{String(row.source || '—')}</td>
                      <td className="py-1 pr-2 text-slate-300 break-words max-w-[280px]">
                        {String(row.error_message || '').slice(0, 200)}
                        {String(row.error_message || '').length > 200 ? '…' : ''}
                      </td>
                      <td className="py-1 text-center text-slate-500">{String(row.resolved ?? '0')}</td>
                    </tr>
                    {open ? (
                      <tr className="bg-slate-900/30">
                        <td colSpan={5} className="px-2 pb-3 pt-0 text-[10px] text-slate-400 space-y-2">
                          <div>
                            <span className="text-slate-600">id</span>{' '}
                            <span className="font-mono text-cyan-700/90">{id}</span>
                          </div>
                          <div>
                            <span className="text-slate-600">workspace / session / source_id</span>
                            <div className="font-mono text-slate-300">
                              {String(row.workspace_id)} · {String(row.session_id || '—')} ·{' '}
                              {String(row.source_id || '—')}
                            </div>
                          </div>
                          {row.error_code ? (
                            <div>
                              <span className="text-slate-600">error_code</span>{' '}
                              <span className="font-mono">{String(row.error_code)}</span>
                            </div>
                          ) : null}
                          <div className="rounded border border-emerald-900/40 bg-emerald-950/20 p-2 text-emerald-100/95">
                            <div className="font-semibold text-emerald-200/90">Suggested action</div>
                            <p className="mt-1 whitespace-pre-wrap">{String(row.suggested_action || '')}</p>
                          </div>
                          {row.context_json ? (
                            <details>
                              <summary className="cursor-pointer text-slate-500">context_json</summary>
                              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-slate-500">
                                {String(row.context_json)}
                              </pre>
                            </details>
                          ) : null}
                          {row.stack_trace ? (
                            <details>
                              <summary className="cursor-pointer text-slate-500">stack_trace</summary>
                              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-rose-200/70">
                                {String(row.stack_trace)}
                              </pre>
                            </details>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {!errRows.length ? (
            <div className="py-4 text-center text-slate-500">No rows for this filter (or table empty).</div>
          ) : null}
        </div>
      </Section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Critical findings & warnings" subtitle="Roll-up from advisors pass (includes error log highlights)">
          <div className="space-y-2 max-h-[420px] overflow-auto">
            {findings.map((f, i) => (
              <div key={i} className={`rounded border p-2 text-[11px] ${severityStyle(String(f.severity || 'info'))}`}>
                <div className="font-semibold">{String(f.title || f.code || 'finding')}</div>
                <div className="mt-1 text-[11px] opacity-90 whitespace-pre-wrap break-words">{String(f.detail || '')}</div>
              </div>
            ))}
            {!findings.length ? <div className="text-slate-500">No advisor findings in this pass.</div> : null}
          </div>
        </Section>

        <Section title="Guardrail events (D1)" subtitle="agentsam_guardrail_events">
          <div className="max-h-[420px] overflow-auto font-mono text-[10px] text-slate-400 space-y-1">
            {grRows.slice(0, 40).map((row, i) => (
              <pre key={i} className="whitespace-pre-wrap break-all">
                {JSON.stringify(row).slice(0, 420)}
              </pre>
            ))}
            {!grRows.length ? <div className="text-slate-500">No guardrail rows.</div> : null}
          </div>
        </Section>
      </div>
    </div>
  );
}
