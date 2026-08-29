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

function fmtPct(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${Math.round(v * 10) / 10}%`;
}

function fmtMs(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${Math.round((v / 1000) * 10) / 10}s`;
}

function SourceBadge() {
  return (
    <span className="text-[10px] px-2 py-1 rounded border border-[var(--border-subtle)] text-muted bg-[var(--bg-canvas)]">
      Supabase
    </span>
  );
}

export default function RagTab() {
  const [rag, setRag] = useState<AnalyticsResponse | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getJson<AnalyticsResponse>('/api/analytics/rag?range=7d');
      if (!alive) return;
      setRag(r);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const summary = rag?.summary || {};
  const warningLowLog = useMemo(() => {
    const w = (rag?.warnings || []).find((x) => x.code === 'RAG_QUERY_LOG_LOW');
    return w || null;
  }, [rag]);

  const sources = useMemo(() => {
    const b0 = (rag?.breakdowns || []).find((b: any) => b?.key === 'sources');
    const rows = (b0?.rows || []) as Array<{ key: string; count: number }>;
    return rows
      .map((r) => ({ key: String(r.key || 'unknown'), count: Number(r.count ?? 0) || 0 }))
      .slice(0, 12);
  }, [rag]);

  const recentDocs = useMemo(() => {
    const rows = (rag?.rows || []).filter((r: any) => r?.kind === 'document');
    return rows.slice(0, 10);
  }, [rag]);

  const recentSearchLogs = useMemo(() => {
    const rows = (rag?.rows || []).filter((r: any) => r?.kind === 'search_log');
    return rows.slice(0, 10);
  }, [rag]);

  return (
    <div className="space-y-3">
      {!rag?.ok ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <EmptyTelemetryCard
            title="RAG Analytics"
            dataSourceKey="rag"
            status="not_connected_yet"
            reason="`/api/analytics/rag` is not returning telemetry yet (Hyperdrive binding missing, tenant not resolved, or Supabase tables not reachable)."
            suggestedAction="Verify env.HYPERDRIVE is configured and the worker can query Supabase Postgres via Hyperdrive."
          />
        </div>
      ) : (
        <>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: 'RAG Documents', value: fmtNumber(summary.document_count) },
              { label: 'Embedding Coverage', value: fmtPct(summary.embedding_coverage_percent) },
              { label: 'Search Logs', value: fmtNumber(summary.search_log_count) },
              { label: 'Avg Search Latency', value: fmtMs(summary.avg_search_latency_ms) },
              { label: 'Top Similarity', value: summary.top_similarity != null ? String(summary.top_similarity) : '—' },
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

          {warningLowLog ? (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted">Warning</div>
                  <div className="text-sm font-semibold text-[var(--text)]">Low semantic search logging volume</div>
                </div>
                <SourceBadge />
              </div>
              <div className="mt-2 text-[13px] text-muted leading-relaxed">{warningLowLog.message}</div>
            </div>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted">Source breakdown</div>
                  <div className="text-sm font-semibold text-[var(--text)]">Documents by source</div>
                </div>
                <SourceBadge />
              </div>
              {!sources.length ? (
                <div className="mt-3">
                  <EmptyTelemetryCard
                    title="Source Breakdown"
                    dataSourceKey="documents"
                    status="empty_capability"
                    reason="No distinct sources were returned from `documents.source`."
                    suggestedAction="Confirm `documents.source` is populated during ingest and that tenant scoping matches expectations."
                  />
                </div>
              ) : (
                <div className="mt-3 overflow-auto border border-[var(--border-subtle)] rounded">
                  <table className="w-full text-left text-[12px]">
                    <thead className="sticky top-0 bg-[var(--bg-panel)] text-[11px] uppercase text-muted">
                      <tr>
                        <th className="p-2">Source</th>
                        <th className="p-2">Documents</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sources.map((r) => (
                        <tr key={r.key} className="border-t border-[var(--border-subtle)]">
                          <td className="p-2 font-mono text-[11px]">{r.key}</td>
                          <td className="p-2">{fmtNumber(r.count)}</td>
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
                  <div className="text-[11px] uppercase tracking-wide text-muted">Recent activity</div>
                  <div className="text-sm font-semibold text-[var(--text)]">Search logs + documents</div>
                </div>
                <SourceBadge />
              </div>

              <div className="mt-3 grid gap-3">
                <div className="overflow-auto border border-[var(--border-subtle)] rounded">
                  <table className="w-full text-left text-[12px]">
                    <thead className="sticky top-0 bg-[var(--bg-panel)] text-[11px] uppercase text-muted">
                      <tr>
                        <th className="p-2">When</th>
                        <th className="p-2">Query</th>
                        <th className="p-2">Latency</th>
                        <th className="p-2">Top sim</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(recentSearchLogs || []).map((r: any, idx: number) => (
                        <tr key={`log-${idx}`} className="border-t border-[var(--border-subtle)]">
                          <td className="p-2 text-muted">{String(r.created_at ?? '—')}</td>
                          <td className="p-2">{String(r.query_preview ?? '').slice(0, 70) || '—'}</td>
                          <td className="p-2">{fmtMs(r.latency_ms)}</td>
                          <td className="p-2">{r.top_similarity != null ? String(r.top_similarity) : '—'}</td>
                        </tr>
                      ))}
                      {!recentSearchLogs.length ? (
                        <tr>
                          <td className="p-2 text-muted" colSpan={4}>
                            No recent `semantic_search_log` rows for this range.
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
                        <th className="p-2">When</th>
                        <th className="p-2">Source</th>
                        <th className="p-2">Title</th>
                        <th className="p-2">Embedded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(recentDocs || []).map((r: any, idx: number) => (
                        <tr key={`doc-${idx}`} className="border-t border-[var(--border-subtle)]">
                          <td className="p-2 text-muted">{String(r.created_at ?? '—')}</td>
                          <td className="p-2 font-mono text-[11px]">{String(r.source ?? '—').slice(0, 42)}</td>
                          <td className="p-2">{String(r.title ?? '').slice(0, 70) || '—'}</td>
                          <td className="p-2">{r.has_embedding === true ? 'yes' : r.has_embedding === false ? 'no' : '—'}</td>
                        </tr>
                      ))}
                      {!recentDocs.length ? (
                        <tr>
                          <td className="p-2 text-muted" colSpan={4}>
                            No recent `documents` rows for this range.
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

