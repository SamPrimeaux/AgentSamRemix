import React, { useCallback, useEffect, useState } from 'react';
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

export default function McpTab(_props: Props) {
  const [range, setRange] = useState<Range>('7d');
  const [tools, setTools] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    const j = await getJson<Record<string, unknown>>(`/api/analytics/mcp/tools?range=${range}`);
    setTools(j);
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = (tools?.rows as Record<string, unknown>[]) || [];
  const slow = (tools?.summary as { slowest_tools?: Record<string, unknown>[] })?.slowest_tools || [];
  const breaks = (tools?.breakdowns as { rows?: Record<string, unknown>[] }[])?.[0]?.rows || [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-100">MCP · tool reliability</div>
          <div className="text-[11px] text-slate-500">
            Aggregated from agentsam_mcp_tool_execution (fallback agentsam_tool_call_log) plus recent broken tool
            chains.
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

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Tool leaderboard">
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-1 pr-2">tool</th>
                  <th className="pb-1 pr-2">calls</th>
                  <th className="pb-1 pr-2">ok</th>
                  <th className="pb-1 pr-2">avg ms</th>
                  <th className="pb-1">max ms</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const calls = Number(r.calls) || 0;
                  const ok = Number(r.successes) || 0;
                  const rate = calls ? Math.round((ok / calls) * 1000) / 10 : null;
                  return (
                    <tr key={String(r.tool_name)} className="border-t border-slate-800/70">
                      <td className="py-1 pr-2 font-mono text-slate-200">{String(r.tool_name)}</td>
                      <td className="py-1 pr-2">{String(calls)}</td>
                      <td className="py-1 pr-2">{rate == null ? '—' : `${rate}%`}</td>
                      <td className="py-1 pr-2">{Math.round(Number(r.avg_ms) || 0)}</td>
                      <td className="py-1">{String(r.max_ms)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length ? <div className="text-slate-500">No MCP executions in window.</div> : null}
          </div>
        </Section>

        <Section title="Slowest tools + chain breaks">
          <div className="mb-3">
            <div className="text-[11px] text-slate-500 mb-1">Slowest (avg latency)</div>
            <div className="space-y-1 font-mono text-[11px] text-slate-400">
              {slow.map((s) => (
                <div key={String(s.tool_name)} className="flex justify-between gap-2">
                  <span className="truncate">{String(s.tool_name)}</span>
                  <span>
                    {String(s.avg_ms)}ms · {String(s.calls)} calls
                  </span>
                </div>
              ))}
              {!slow.length ? <div className="text-slate-500">—</div> : null}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 mb-1">agentsam_tool_chain · failed / timeout / cancelled</div>
            <div className="max-h-[220px] overflow-auto space-y-1 text-[10px] text-slate-400">
              {breaks.map((b) => (
                <div key={String(b.id)} className="rounded border border-slate-800/60 p-2">
                  <div className="font-mono text-slate-200">{String(b.tool_name)}</div>
                  <div className="text-slate-600 truncate">{String(b.error_message || '')}</div>
                </div>
              ))}
              {!breaks.length ? <div className="text-slate-500">No recent chain breaks.</div> : null}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
