import React, { useCallback, useEffect, useState } from 'react';
import { SHELL_VERSION } from '@/src/shellVersion';
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

export default function WorkersTab(_props: Props) {
  const [range, setRange] = useState<Range>('7d');
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [r2, setR2] = useState<Record<string, unknown> | null>(null);
  const [dashv, setDashv] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    const q = `range=${range}`;
    const [s, r, d] = await Promise.all([
      getJson<Record<string, unknown>>(`/api/analytics/workers/summary?${q}`),
      getJson<Record<string, unknown>>(`/api/analytics/workers/r2?${q}`),
      getJson<Record<string, unknown>>(`/api/analytics/workers/dashboard-versions?${q}`),
    ]);
    setSummary(s);
    setR2(r);
    setDashv(d);
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const bundle = (summary?.deployments as Record<string, unknown> | undefined) || undefined;
  const deployments = (bundle?.deployments as Record<string, unknown>[]) || [];
  const cron = (bundle?.cron_runs as Record<string, unknown>[]) || [];
  const webhooks = (bundle?.webhook_events as Record<string, unknown>[]) || [];
  const health = (bundle?.deployment_health as Record<string, unknown>[]) || [];
  const tracking = (bundle?.deployment_tracking as Record<string, unknown>[]) || [];
  const perf = bundle?.perf_headline as Record<string, unknown> | undefined;

  const r2Buckets = (r2?.summary as { by_bucket?: Record<string, unknown>[] })?.by_bucket || [];
  const dashRows = (dashv?.rows as Record<string, unknown>[]) || [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-100">Workers · deploy + dashboard truth</div>
          <div className="text-[11px] text-slate-500">
            Answers: did the Worker deploy, is cron/webhook traffic moving, what is the live dashboard bundle label.
          </div>
        </div>
        <div className="flex items-center gap-2">
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
          <span className="font-mono text-[10px] text-slate-500">shell {SHELL_VERSION}</span>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Latest deployments (D1 deployments)">
          <div className="max-h-[240px] overflow-auto space-y-1 font-mono text-[10px] text-slate-400">
            {deployments.map((row) => (
              <div key={String(row.id)} className="rounded border border-slate-800/60 bg-slate-950/40 p-2">
                <div className="flex justify-between gap-2">
                  <span className="truncate text-slate-200">{String(row.version || row.id)}</span>
                  <span>{String(row.status || '')}</span>
                </div>
                <div className="mt-0.5 text-slate-600 truncate">
                  {String(row.git_hash || '')} · {String(row.environment || '')}
                </div>
              </div>
            ))}
            {!deployments.length ? <div className="text-slate-500">No deployment rows.</div> : null}
          </div>
        </Section>

        <Section title="Dashboard versions (D1 dashboard_versions)">
          <div className="max-h-[240px] overflow-auto space-y-1 font-mono text-[10px] text-slate-400">
            {dashRows.slice(0, 12).map((row, i) => (
              <pre key={i} className="whitespace-pre-wrap break-all">
                {JSON.stringify(row).slice(0, 400)}
              </pre>
            ))}
            {!dashRows.length ? <div className="text-slate-500">No dashboard_versions rows.</div> : null}
          </div>
        </Section>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Section title="R2 inventory">
          <div className="space-y-1 font-mono text-[11px] text-slate-400">
            {r2Buckets.map((row, i) => (
              <div key={i} className="flex justify-between gap-2">
                <span className="truncate">{String(row.bucket)}</span>
                <span>
                  {String(row.objects)} obj · {String(row.bytes)} bytes
                </span>
              </div>
            ))}
            {!r2Buckets.length ? <div className="text-slate-500">No R2 inventory rows.</div> : null}
          </div>
        </Section>

        <Section title="Cron health (agentsam_cron_runs)">
          <div className="max-h-[200px] overflow-auto space-y-1 text-[11px] text-slate-400">
            {cron.slice(0, 12).map((c) => (
              <div key={String(c.id)} className="truncate">
                <span className="text-slate-200">{String(c.job_name)}</span> · {String(c.status)} ·{' '}
                {String(c.duration_ms || '—')}ms
              </div>
            ))}
            {!cron.length ? <div className="text-slate-500">No cron rows in window.</div> : null}
          </div>
        </Section>

        <Section title="Webhook health (agentsam_webhook_events)">
          <div className="max-h-[200px] overflow-auto space-y-1 text-[11px] text-slate-400">
            {webhooks.slice(0, 12).map((w) => (
              <div key={String(w.id)} className="truncate">
                <span className="text-slate-200">{String(w.provider)}</span> · {String(w.event_type)} ·{' '}
                {String(w.status)}
              </div>
            ))}
            {!webhooks.length ? <div className="text-slate-500">No webhook rows in window.</div> : null}
          </div>
        </Section>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Deployment health (agentsam_deployment_health)">
          <div className="max-h-[200px] overflow-auto font-mono text-[10px] text-slate-400 space-y-1">
            {health.map((row, i) => (
              <pre key={i} className="whitespace-pre-wrap break-all">
                {JSON.stringify(row).slice(0, 400)}
              </pre>
            ))}
            {!health.length ? <div className="text-slate-500">Empty.</div> : null}
          </div>
        </Section>

        <Section title="Deployment tracking + perf headline">
          <div className="mb-2 max-h-[120px] overflow-auto font-mono text-[10px] text-slate-500 space-y-1">
            {tracking.slice(0, 6).map((row, i) => (
              <pre key={i} className="whitespace-pre-wrap break-all">
                {JSON.stringify(row).slice(0, 320)}
              </pre>
            ))}
            {!tracking.length ? <div className="text-slate-500">No deployment_tracking rows.</div> : null}
          </div>
          <div className="font-mono text-[11px] text-slate-400 space-y-0.5 border-t border-slate-800 pt-2">
            <div>executions (metrics window): {String(perf?.executions ?? '—')}</div>
            <div>failures: {String(perf?.failures ?? '—')}</div>
            <div>avg_latency_ms: {String(perf?.avg_latency_ms ?? '—')}</div>
          </div>
        </Section>
      </div>
    </div>
  );
}
