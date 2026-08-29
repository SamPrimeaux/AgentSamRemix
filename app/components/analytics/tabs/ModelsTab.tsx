import React, { useCallback, useEffect, useState } from 'react';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import type { AnalyticsLayoutResponse } from '../types';

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800/90 bg-slate-950/45 overflow-hidden">
      <header className="border-b border-slate-800/80 px-3 py-2">
        <h3 className="text-[13px] font-semibold text-slate-100">{title}</h3>
      </header>
      <div className="p-3 text-[12px] text-slate-300">{children}</div>
    </section>
  );
}

export default function ModelsTab(_props: Props) {
  const [range, setRange] = useState<Range>('7d');
  const [lb, setLb] = useState<Record<string, unknown> | null>(null);
  const [routing, setRouting] = useState<Record<string, unknown> | null>(null);
  const [evals, setEvals] = useState<Record<string, unknown> | null>(null);
  const [drift, setDrift] = useState<Record<string, unknown> | null>(null);
  const [cache, setCache] = useState<Record<string, unknown> | null>(null);
  const [arms, setArms] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    const q = `range=${range}`;
    const [a, b, c, d, e, f] = await Promise.all([
      getJson<Record<string, unknown>>(`/api/analytics/models/leaderboard?${q}`),
      getJson<Record<string, unknown>>(`/api/analytics/models/routing-decisions?${q}`),
      getJson<Record<string, unknown>>(`/api/analytics/models/evals?${q}`),
      getJson<Record<string, unknown>>(`/api/analytics/models/drift?${q}`),
      getJson<Record<string, unknown>>(`/api/analytics/models/prompt-cache?${q}`),
      getJson<Record<string, unknown>>(`/api/analytics/models/routing-arms?${q}`),
    ]);
    setLb(a);
    setRouting(b);
    setEvals(c);
    setDrift(d);
    setCache(e);
    setArms(f);
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const leaderboard = (lb?.modelLeaderboard as Record<string, unknown>[]) || [];
  const scatter = (lb?.costLatencyScatter as Record<string, unknown>[]) || [];
  const routRows = (routing?.rows as Record<string, unknown>[]) || [];
  const evalRows = (evals?.rows as Record<string, unknown>[]) || [];
  const driftRows = (drift?.rows as Record<string, unknown>[]) || [];
  const cacheRows = (cache?.rows as Record<string, unknown>[]) || [];
  const agg = (cache?.summary as { aggregate?: Record<string, unknown> })?.aggregate;
  const armRows = (arms?.rows as Record<string, unknown>[]) || [];
  const failureBreakdown = (arms?.failure_breakdown as Record<string, unknown>[]) || [];

  const scatterData = scatter
    .filter((r) => Number(r.avg_latency_ms) > 0 || Number(r.avg_cost_usd) > 0)
    .map((r) => ({
      name: `${String(r.model_key)} · ${String(r.provider || '')}`,
      x: Number(r.avg_latency_ms) || 0,
      y: Number(r.avg_cost_usd) || 0,
      z: Number(r.success_rate_pct) || 0,
    }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-100">Model routing truth</div>
          <div className="text-[11px] text-slate-500">
            Leaderboard from agentsam_execution_performance_metrics; routing + evals from Supabase when Hyperdrive is
            live.
          </div>
        </div>
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
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-3">
          <Section title="Model leaderboard (cost · latency · success)">
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-1 pr-2">model</th>
                    <th className="pb-1 pr-2">provider</th>
                    <th className="pb-1 pr-2">exec</th>
                    <th className="pb-1 pr-2">succ%</th>
                    <th className="pb-1 pr-2">avg ms</th>
                    <th className="pb-1">cost</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((r) => (
                    <tr key={`${String(r.model_key)}-${String(r.provider)}`} className="border-t border-slate-800/70">
                      <td className="py-1 pr-2 font-mono text-slate-200">{String(r.model_key)}</td>
                      <td className="py-1 pr-2 text-slate-500">{String(r.provider)}</td>
                      <td className="py-1 pr-2">{String(r.executions)}</td>
                      <td className="py-1 pr-2">{r.success_rate_pct == null ? '—' : `${r.success_rate_pct}%`}</td>
                      <td className="py-1 pr-2">{String(r.avg_latency_ms)}</td>
                      <td className="py-1 text-slate-400">{Number(r.total_cost_usd || 0).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!leaderboard.length ? <div className="text-slate-500">No performance metrics in window.</div> : null}
            </div>
          </Section>

          <Section title="Routing decisions (Supabase)">
            <div className="max-h-[220px] overflow-auto font-mono text-[10px] text-slate-400 space-y-1">
              {routRows.slice(0, 25).map((row, i) => (
                <pre key={i} className="whitespace-pre-wrap break-all">
                  {JSON.stringify(row).slice(0, 360)}
                </pre>
              ))}
              {!routRows.length ? <div className="text-slate-500">No rows (Hyperdrive off or empty).</div> : null}
            </div>
          </Section>

          <Section title="Eval runs (Supabase)">
            <div className="max-h-[200px] overflow-auto font-mono text-[10px] text-slate-400 space-y-1">
              {evalRows.slice(0, 20).map((row, i) => (
                <pre key={i} className="whitespace-pre-wrap break-all">
                  {JSON.stringify(row).slice(0, 360)}
                </pre>
              ))}
              {!evalRows.length ? <div className="text-slate-500">No eval rows.</div> : null}
            </div>
          </Section>
        </div>

        <div className="space-y-3">
          <Section title="Cost vs latency">
            {scatterData.length ? (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis type="number" dataKey="x" name="avg_latency_ms" stroke="#64748b" tick={{ fontSize: 10 }} />
                    <YAxis type="number" dataKey="y" name="avg_cost_usd" stroke="#64748b" tick={{ fontSize: 10 }} />
                    <ZAxis type="number" dataKey="z" range={[40, 160]} name="succ%" />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      formatter={(value: number, name: string) => [`${value}`, name]}
                    />
                    <Scatter data={scatterData} fill="#22d3ee" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-slate-500">Not enough points.</div>
            )}
            <div className="text-[10px] text-slate-500 mt-1">Bubble size ~ success rate (%).</div>
          </Section>

          <Section title="Prompt cache savings (D1)">
            <div className="font-mono text-[11px] text-slate-400 space-y-1">
              <div>keys: {String(agg?.key_rows ?? '—')}</div>
              <div>read_hits: {String(agg?.read_hits ?? '—')}</div>
              <div>savings_usd: {String(agg?.savings_usd ?? '—')}</div>
            </div>
            <div className="mt-2 max-h-[160px] overflow-auto text-[10px] text-slate-500 space-y-1">
              {cacheRows.map((r, i) => (
                <div key={i} className="truncate">
                  {String(r.model_key)} · reads {String(r.reads)} · ${String(r.savings)}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Routing arms (D1)">
            <div className="max-h-[200px] overflow-auto font-mono text-[10px] text-slate-400 space-y-1">
              {armRows.slice(0, 12).map((row, i) => (
                <pre key={i} className="whitespace-pre-wrap break-all">
                  {JSON.stringify(row).slice(0, 320)}
                </pre>
              ))}
              {!armRows.length ? <div className="text-slate-500">Empty.</div> : null}
            </div>
          </Section>

          <Section title="Failure categories (model × category)">
            <div className="max-h-[200px] overflow-auto">
              <table className="w-full border-collapse text-[10px]">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-1 pr-2">model</th>
                    <th className="pb-1 pr-2">category</th>
                    <th className="pb-1 pr-2">n</th>
                    <th className="pb-1">β skip</th>
                  </tr>
                </thead>
                <tbody>
                  {failureBreakdown.map((r, i) => (
                    <tr key={i} className="border-t border-slate-800/70">
                      <td className="py-1 pr-2 font-mono text-slate-200">{String(r.model_key)}</td>
                      <td className="py-1 pr-2 text-slate-400">{String(r.failure_category)}</td>
                      <td className="py-1 pr-2 tabular-nums">{String(r.event_count)}</td>
                      <td className="py-1 tabular-nums text-slate-500">{String(r.bandit_skipped_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!failureBreakdown.length ? (
                <div className="text-slate-500">No categorized auto_error rows.</div>
              ) : null}
            </div>
          </Section>

          <Section title="Model drift signals (D1)">
            <div className="max-h-[200px] overflow-auto font-mono text-[10px] text-slate-400 space-y-1">
              {driftRows.slice(0, 15).map((row, i) => (
                <pre key={i} className="whitespace-pre-wrap break-all">
                  {JSON.stringify(row).slice(0, 320)}
                </pre>
              ))}
              {!driftRows.length ? <div className="text-slate-500">No drift rows.</div> : null}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
