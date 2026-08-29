import React, { useEffect, useMemo, useState } from 'react';
import { EmptyTelemetryCard } from '../cards/EmptyTelemetryCard';

type AnalyticsResponse = {
  ok: boolean;
  backend: 'd1' | 'supabase' | 'mixed';
  range: '24h' | '7d' | '30d' | 'all';
  generated_at: number;
  summary: Record<string, any>;
  series: Array<Record<string, any>>;
  breakdowns: Array<Record<string, any>>;
  rows: Array<Record<string, any>>;
  warnings: Array<{ code: string; message: string; backend?: 'd1' | 'supabase' | 'mixed'; severity: 'info' | 'warn' | 'critical' }>;
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function fmtNumber(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1_000_000) return `${Math.round(v / 10_000) / 100}M`;
  if (v >= 10_000) return `${Math.round(v / 100) / 10}K`;
  return String(Math.round(v));
}

function fmtBytes(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1_000_000_000) return `${Math.round((v / 1_000_000_000) * 10) / 10} GB`;
  if (v >= 1_000_000) return `${Math.round((v / 1_000_000) * 10) / 10} MB`;
  if (v >= 1_000) return `${Math.round((v / 1_000) * 10) / 10} KB`;
  return `${Math.round(v)} B`;
}

function SourceBadge() {
  return (
    <span className="text-[10px] px-2 py-1 rounded border border-[var(--border-subtle)] text-muted bg-[var(--bg-canvas)]">
      Supabase
    </span>
  );
}

export default function CodebaseTab() {
  const [codebase, setCodebase] = useState<AnalyticsResponse | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getJson<AnalyticsResponse>('/api/analytics/codebase?range=7d');
      if (!alive) return;
      setCodebase(r);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const summary = codebase?.summary || {};

  const langDist = useMemo(() => {
    const rows = (summary.language_distribution || []) as Array<{ language: string; count: number }>;
    return rows
      .map((r) => ({ language: String(r.language || 'unknown'), count: Number(r.count ?? 0) || 0 }))
      .slice(0, 12);
  }, [summary.language_distribution]);

  const largestFiles = useMemo(() => {
    const rows = (summary.largest_files || []) as Array<any>;
    return rows.slice(0, 10);
  }, [summary.largest_files]);

  const routeSymbols = useMemo(() => {
    const rows = (summary.route_symbols || []) as Array<any>;
    return rows.slice(0, 25);
  }, [summary.route_symbols]);

  const functionSymbols = useMemo(() => {
    const rows = (summary.function_symbols || []) as Array<any>;
    return rows.slice(0, 25);
  }, [summary.function_symbols]);

  return (
    <div className="space-y-3">
      {!codebase?.ok ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <EmptyTelemetryCard
            title="Codebase Analytics"
            dataSourceKey="codebase"
            status="not_connected_yet"
            reason="`/api/analytics/codebase` is not returning telemetry yet (Hyperdrive binding missing, tenant not resolved, or Supabase tables not reachable)."
            suggestedAction="Verify env.HYPERDRIVE is configured and Supabase Postgres is reachable via Hyperdrive."
          />
        </div>
      ) : (
        <>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: 'Files', value: fmtNumber(summary.file_count) },
              { label: 'Lines', value: fmtNumber(summary.total_lines) },
              { label: 'Chunks', value: fmtNumber(summary.chunk_count) },
              { label: 'Symbols', value: fmtNumber(summary.symbol_count) },
              { label: 'Bytes', value: fmtBytes(summary.total_bytes) },
            ].map((k) => (
              <div key={k.label} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted">{k.label}</div>
                  <SourceBadge />
                </div>
                <div className="mt-1 text-[18px] font-semibold text-[var(--text)]">{k.value}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted">Latest snapshot</div>
                  <div className="text-sm font-semibold text-[var(--text)]">Index freshness</div>
                </div>
                <SourceBadge />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted">Snapshots</div>
                  <div className="mt-1 text-[16px] font-semibold text-[var(--text)]">{fmtNumber(summary.snapshot_count)}</div>
                </div>
                <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted">Latest</div>
                  <div className="mt-1 text-[12px] font-mono text-[var(--text)]">
                    {summary.latest_snapshot_at ? String(summary.latest_snapshot_at) : '—'}
                  </div>
                </div>
              </div>
              {!summary.latest_snapshot_at ? (
                <div className="mt-3">
                  <EmptyTelemetryCard
                    title="Latest Snapshot"
                    dataSourceKey="codebase_snapshots"
                    status="empty_capability"
                    reason="No snapshot timestamp was returned. The table may be empty or uses a different timestamp column."
                    suggestedAction="Confirm `codebase_snapshots` has captured_at/created_at and that the index sync job inserts snapshots."
                  />
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted">Language distribution</div>
                  <div className="text-sm font-semibold text-[var(--text)]">Chunks by language</div>
                </div>
                <SourceBadge />
              </div>
              {!langDist.length ? (
                <div className="mt-3">
                  <EmptyTelemetryCard
                    title="Language Distribution"
                    dataSourceKey="codebase_chunks"
                    status="empty_capability"
                    reason="No language rows were returned from `codebase_chunks.language`."
                    suggestedAction="Confirm `codebase_chunks` rows exist and populate the `language` column during ingestion."
                  />
                </div>
              ) : (
                <div className="mt-3 overflow-auto border border-[var(--border-subtle)] rounded">
                  <table className="w-full text-left text-[12px]">
                    <thead className="sticky top-0 bg-[var(--bg-panel)] text-[11px] uppercase text-muted">
                      <tr>
                        <th className="p-2">Language</th>
                        <th className="p-2">Chunks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {langDist.map((r) => (
                        <tr key={r.language} className="border-t border-[var(--border-subtle)]">
                          <td className="p-2 font-mono text-[11px]">{r.language}</td>
                          <td className="p-2">{fmtNumber(r.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted">Largest files</div>
                  <div className="text-sm font-semibold text-[var(--text)]">Top 10 by bytes</div>
                </div>
                <SourceBadge />
              </div>
              {!largestFiles.length ? (
                <div className="mt-3">
                  <EmptyTelemetryCard
                    title="Largest Files"
                    dataSourceKey="codebase_files"
                    status="empty_capability"
                    reason="No `codebase_files` rows were returned for largest files."
                    suggestedAction="Confirm `codebase_files` contains content/bytes and that the index sync job is running."
                  />
                </div>
              ) : (
                <div className="mt-3 overflow-auto border border-[var(--border-subtle)] rounded">
                  <table className="w-full text-left text-[12px]">
                    <thead className="sticky top-0 bg-[var(--bg-panel)] text-[11px] uppercase text-muted">
                      <tr>
                        <th className="p-2">File</th>
                        <th className="p-2">Lines</th>
                        <th className="p-2">Bytes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {largestFiles.map((r: any, idx: number) => (
                        <tr key={`lf-${idx}`} className="border-t border-[var(--border-subtle)]">
                          <td className="p-2 font-mono text-[11px]">{String(r.file_path ?? '—')}</td>
                          <td className="p-2">{r.line_count != null ? fmtNumber(r.line_count) : '—'}</td>
                          <td className="p-2">{r.bytes != null ? fmtBytes(r.bytes) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted">Symbols & routes</div>
                  <div className="text-sm font-semibold text-[var(--text)]">Important exported surfaces</div>
                </div>
                <SourceBadge />
              </div>

              <div className="mt-3 grid gap-3">
                <div className="overflow-auto border border-[var(--border-subtle)] rounded">
                  <table className="w-full text-left text-[12px]">
                    <thead className="sticky top-0 bg-[var(--bg-panel)] text-[11px] uppercase text-muted">
                      <tr>
                        <th className="p-2">Route symbol</th>
                        <th className="p-2">Type</th>
                        <th className="p-2">File</th>
                      </tr>
                    </thead>
                    <tbody>
                      {routeSymbols.map((r: any, idx: number) => (
                        <tr key={`rs-${idx}`} className="border-t border-[var(--border-subtle)]">
                          <td className="p-2 font-mono text-[11px]">{String(r.name ?? '—')}</td>
                          <td className="p-2 text-muted">{String(r.symbol_type ?? '—')}</td>
                          <td className="p-2 font-mono text-[11px]">{String(r.file_path ?? '—')}</td>
                        </tr>
                      ))}
                      {!routeSymbols.length ? (
                        <tr>
                          <td className="p-2 text-muted" colSpan={3}>
                            No route symbols returned (symbol typing may not be present in `codebase_symbols`).
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <div className="overflow-auto border border-[var(--border-subtle)] rounded">
                  <table className="w-full text-left text-[12px]">
                    <thead className="sticky top-0 bg-[var(--bg-panel)] text-[11px] uppercase text-muted">
                      <tr>
                        <th className="p-2">Function symbol</th>
                        <th className="p-2">Type</th>
                        <th className="p-2">File</th>
                      </tr>
                    </thead>
                    <tbody>
                      {functionSymbols.map((r: any, idx: number) => (
                        <tr key={`fs-${idx}`} className="border-t border-[var(--border-subtle)]">
                          <td className="p-2 font-mono text-[11px]">{String(r.name ?? '—')}</td>
                          <td className="p-2 text-muted">{String(r.symbol_type ?? '—')}</td>
                          <td className="p-2 font-mono text-[11px]">{String(r.file_path ?? '—')}</td>
                        </tr>
                      ))}
                      {!functionSymbols.length ? (
                        <tr>
                          <td className="p-2 text-muted" colSpan={3}>
                            No function symbols returned (symbol typing may not be present in `codebase_symbols`).
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

