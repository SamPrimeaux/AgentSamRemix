import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AnalyticsLayoutResponse } from '../types';
import { AgentChatPlanTracePanel } from '../panels/AgentChatPlanTracePanel';

type Props = { layout: AnalyticsLayoutResponse | null };

type Range = '24h' | '7d' | '30d' | 'all';

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-800/90 bg-slate-950/45 overflow-hidden">
      <header className="border-b border-slate-800/80 px-3 py-2 bg-slate-950/60">
        <h3 className="text-[13px] font-semibold text-slate-100">{title}</h3>
        {subtitle ? <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p> : null}
      </header>
      <div className="p-3 text-[12px] text-slate-300">{children}</div>
    </section>
  );
}

function fmtTs(v: unknown): string {
  if (v == null) return '—';
  const n = Number(v);
  if (Number.isFinite(n) && n > 1e9) {
    try {
      return new Date(n * 1000).toISOString().replace('T', ' ').slice(0, 19);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

export default function AgentTab(_props: Props) {
  const [searchParams] = useSearchParams();
  const runIdFromUrl = searchParams.get('run_id')?.trim() || null;
  const [range, setRange] = useState<Range>('7d');
  const [runs, setRuns] = useState<Record<string, unknown>[] | null>(null);
  const [runSummary, setRunSummary] = useState<Record<string, unknown> | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(runIdFromUrl);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [graph, setGraph] = useState<Record<string, unknown> | null>(null);
  const [deps, setDeps] = useState<Record<string, unknown> | null>(null);
  const [inspector, setInspector] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setErr(null);
    const j = await getJson<{
      rows?: Record<string, unknown>[];
      summary?: Record<string, unknown>;
      warnings?: { message?: string }[];
    }>(`/api/analytics/agent/runs?range=${range}&limit=50`);
    if (!j) {
      setErr('Failed to load workflow runs');
      setRuns([]);
      return;
    }
    const nextRows = j.rows || [];
    setRuns(nextRows);
    setRunSummary(j.summary || {});
    setSelectedRunId((prev) => {
      if (runIdFromUrl && nextRows.some((r) => String(r.id) === runIdFromUrl)) return runIdFromUrl;
      if (prev && nextRows.some((r) => String(r.id) === prev)) return prev;
      return nextRows[0]?.id ? String(nextRows[0].id) : null;
    });
  }, [range, runIdFromUrl]);

  useEffect(() => {
    if (runIdFromUrl) setSelectedRunId(runIdFromUrl);
  }, [runIdFromUrl]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!selectedRunId) {
        setDetail(null);
        return;
      }
      const d = await getJson<Record<string, unknown>>(
        `/api/analytics/agent/runs?range=${range}&run_id=${encodeURIComponent(selectedRunId)}`,
      );
      if (!alive) return;
      setDetail(d);
    })();
    return () => {
      alive = false;
    };
  }, [selectedRunId, range]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [g, dp] = await Promise.all([
        getJson<Record<string, unknown>>(`/api/analytics/agent/graph?range=${range}`),
        getJson<Record<string, unknown>>(`/api/analytics/agent/dependencies?range=${range}`),
      ]);
      if (!alive) return;
      setGraph(g);
      setDeps(dp);
    })();
    return () => {
      alive = false;
    };
  }, [range]);

  const wf = graph?.summary as Record<string, unknown> | undefined;
  const nodes = (wf?.nodes as Record<string, unknown>[]) || [];
  const edges = (wf?.edges as Record<string, unknown>[]) || [];
  const depRows = (deps?.rows as Record<string, unknown>[]) || [];

  const waterfall = (detail?.waterfall as Record<string, unknown>[]) || [];
  const failurePath = (detail?.failurePath as Record<string, unknown>[]) || [];
  const toolLedger = (detail?.toolLedger as Record<string, unknown>[]) || [];
  const runRow = (detail?.summary as { run?: Record<string, unknown> } | undefined)?.run;

  const statusChips = useMemo(() => {
    const by = (runSummary?.by_status || {}) as Record<string, number>;
    return Object.entries(by).sort((a, b) => b[1] - a[1]);
  }, [runSummary]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-100">Agent Sam · execution spine</div>
          <div className="text-[11px] text-slate-500">
            D1 workflow runs, execution steps, workflow DAG, dependency edges, and tool ledger — not chart-first.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-slate-500">Range</label>
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
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-[12px] text-slate-200 hover:bg-slate-800/80"
            onClick={() => void loadList()}
          >
            Refresh
          </button>
        </div>
      </div>

      {err ? (
        <div className="rounded border border-rose-900/50 bg-rose-950/30 p-2 text-[12px] text-rose-100">{err}</div>
      ) : null}

      <AgentChatPlanTracePanel />

      <div className="grid gap-3 xl:grid-cols-12">
        <div className="xl:col-span-4 space-y-3">
          <Section title="Run timeline" subtitle="agentsam_workflow_runs — newest first">
            {statusChips.length ? (
              <div className="mb-2 flex flex-wrap gap-1">
                {statusChips.map(([k, v]) => (
                  <span
                    key={k}
                    className="rounded bg-slate-900/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
                  >
                    {k}:{v}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="max-h-[420px] overflow-auto space-y-1">
              {(runs || []).map((r) => {
                const id = String(r.id || '');
                const active = id === selectedRunId;
                return (
                  <button
                    key={id || Math.random()}
                    type="button"
                    onClick={() => setSelectedRunId(id)}
                    className={`flex w-full flex-col rounded border px-2 py-1.5 text-left font-mono text-[11px] ${
                      active
                        ? 'border-cyan-700/60 bg-cyan-950/25 text-cyan-100'
                        : 'border-slate-800 bg-slate-950/30 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="truncate">{id}</span>
                      <span className="shrink-0 text-slate-500">{String(r.status || '')}</span>
                    </div>
                    <div className="mt-0.5 flex justify-between gap-2 text-[10px] text-slate-500">
                      <span className="truncate">{String(r.workflow_key || r.workflow_id || '')}</span>
                      <span>{fmtTs(r.started_at)}</span>
                    </div>
                  </button>
                );
              })}
              {runs && runs.length === 0 ? <div className="text-slate-500">No runs in window.</div> : null}
            </div>
          </Section>
        </div>

        <div className="xl:col-span-8 space-y-3">
          <Section title="Pinned run" subtitle="agentsam_execution_steps · step_results_json waterfall">
            {!runRow ? (
              <div className="text-slate-500">Select a run from the timeline.</div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-3 font-mono text-[11px] text-slate-400">
                  <span>
                    <span className="text-slate-600">status</span> {String(runRow.status)}
                  </span>
                  <span>
                    <span className="text-slate-600">model</span> {String(runRow.model_used || '—')}
                  </span>
                  <span>
                    <span className="text-slate-600">duration_ms</span> {String(runRow.duration_ms ?? '—')}
                  </span>
                  <span>
                    <span className="text-slate-600">tokens</span>{' '}
                    {Number(runRow.input_tokens || 0) + Number(runRow.output_tokens || 0)}
                  </span>
                  <span>
                    <span className="text-slate-600">supabase_sync</span>{' '}
                    {String(runRow.supabase_sync_status || '—')}
                  </span>
                </div>
                {failurePath.length ? (
                  <div className="rounded border border-rose-900/40 bg-rose-950/20 p-2">
                    <div className="text-[11px] font-semibold text-rose-100">Failure path</div>
                    <ul className="mt-1 list-inside list-disc text-[11px] text-rose-200/90">
                      {failurePath.map((f) => (
                        <li key={String(f.id)}>
                          {String(f.node_key || '—')} · {String(f.status)}{' '}
                          <span className="text-rose-300/80">
                            {String(f.error_json_preview || '').slice(0, 120)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="space-y-1">
                  <div className="text-[11px] text-slate-500">Step waterfall (latency bar)</div>
                  {waterfall.length ? (
                    waterfall.map((w, i) => {
                      const bar = Math.round((Number(w.bar) || 0) * 100);
                      const ok = String(w.status || '').toLowerCase().includes('fail') ? false : true;
                      return (
                        <div key={`${String(w.node_key)}-${i}`} className="flex items-center gap-2">
                          <div className="w-36 shrink-0 truncate font-mono text-[10px] text-slate-400" title={String(w.node_key)}>
                            {String(w.node_key || '—')}
                          </div>
                          <div className="flex-1 h-2 rounded bg-slate-900">
                            <div
                              className={`h-2 rounded ${ok ? 'bg-cyan-700/70' : 'bg-rose-600/80'}`}
                              style={{ width: `${bar}%` }}
                            />
                          </div>
                          <div className="w-16 shrink-0 text-right font-mono text-[10px] text-slate-500">
                            {Number(w.latency_ms || 0)}ms
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-slate-500">No waterfall rows (no steps / empty step_results_json).</div>
                  )}
                </div>
              </div>
            )}
          </Section>

          <div className="grid gap-3 lg:grid-cols-2">
            <Section title="Workflow DAG" subtitle="agentsam_workflow_nodes + agentsam_workflow_edges">
              {String(wf?.state || '') !== 'LIVE' ? (
                <div className="text-slate-500">No graph in scope ({String(wf?.state || 'EMPTY')}).</div>
              ) : (
                <div className="max-h-[280px] overflow-auto space-y-2 font-mono text-[10px] text-slate-400">
                  <div className="text-slate-500">
                    workflow <span className="text-slate-300">{String((wf.workflow as { id?: string })?.id || '')}</span>{' '}
                    · {nodes.length} nodes · {edges.length} edges
                  </div>
                  <div className="space-y-0.5">
                    {edges.map((e, i) => (
                      <div key={i} className="truncate">
                        {String(e.from_node_key)} → {String(e.to_node_key)}{' '}
                        <span className="text-slate-600">{String(e.condition_type || '')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            <Section title="Execution dependency graph" subtitle="agentsam_execution_dependency_graph">
              {depRows.length ? (
                <div className="max-h-[280px] overflow-auto font-mono text-[10px] text-slate-400 space-y-1">
                  {depRows.slice(0, 40).map((row, i) => (
                    <pre key={i} className="whitespace-pre-wrap break-all text-[10px] text-slate-500">
                      {JSON.stringify(row).slice(0, 280)}
                    </pre>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500">No dependency rows in window.</div>
              )}
            </Section>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Section title="Tool-call ledger" subtitle="agentsam_execution_steps (truncated previews)">
              <div className="max-h-[260px] overflow-auto">
                <table className="w-full border-collapse text-[10px]">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="pb-1 pr-2">node</th>
                      <th className="pb-1 pr-2">type</th>
                      <th className="pb-1 pr-2">status</th>
                      <th className="pb-1">ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {toolLedger.map((t) => (
                      <tr
                        key={String(t.step_id)}
                        className="cursor-pointer border-t border-slate-800/60 hover:bg-slate-900/40"
                        onClick={() => setInspector(t)}
                      >
                        <td className="py-1 pr-2 font-mono text-slate-300 truncate max-w-[140px]">{String(t.node_key)}</td>
                        <td className="py-1 pr-2 text-slate-500">{String(t.node_type || '—')}</td>
                        <td className="py-1 pr-2">{String(t.status)}</td>
                        <td className="py-1 text-slate-500">{String(t.latency_ms ?? '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!toolLedger.length ? <div className="text-slate-500">No steps for this run.</div> : null}
              </div>
            </Section>

            <Section title="Node inspector" subtitle="Click a ledger row">
              {!inspector ? (
                <div className="text-slate-500">No node selected.</div>
              ) : (
                <div className="max-h-[260px] overflow-auto font-mono text-[10px] text-slate-400 space-y-1">
                  <div>
                    <span className="text-slate-600">step_id</span> {String(inspector.step_id)}
                  </div>
                  <div>
                    <span className="text-slate-600">node_key</span> {String(inspector.node_key)}
                  </div>
                  <pre className="whitespace-pre-wrap break-all text-[10px] text-slate-500">
                    {String(inspector.preview || '—')}
                  </pre>
                </div>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
