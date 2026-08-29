import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import type { DashboardBundle } from "../types";
import { T, fmt, providerPcKey, MODEL_PROVIDER_GROUPS } from "../constants";
import { lookupProviderColor, normalizeProviderKey } from "../../../lib/providerColors";
import { Card, Ico, NavLink } from "../primitives";
import { PulseEmpty } from "./PulseEmpty";
import { OVERVIEW_LINKS } from "../overviewLinks";

type TabId = "by_provider" | "cost_latency";

type LbRow = {
  model: string;
  modelKey: string;
  prov: string;
  pk: string;
  runs: number;
  success: number;
  latMs: number;
  costPer1k: number;
  decayed: number | null;
  listIn: number | null;
  listOut: number | null;
  realizedPer1k: number | null;
  status: { label: string; color: string };
  driftPct: number | null;
};

function pricingStatus(row: {
  routing_eligible?: number | null;
  requires_owner_approval?: number | null;
  is_paused?: number | null;
}): { label: string; color: string } {
  if (Number(row.requires_owner_approval) === 1) return { label: "BLOCKED", color: T.red };
  if (Number(row.routing_eligible) === 1 && Number(row.is_paused) !== 1) return { label: "ACTIVE", color: T.green };
  if (row.routing_eligible == null && row.is_paused == null) return { label: "—", color: T.muted };
  return { label: "GATED", color: T.amber };
}

function costDriftPct(realized: number | null | undefined, listIn: number | null | undefined): number | null {
  const r = realized != null ? Number(realized) : NaN;
  const l = listIn != null ? Number(listIn) : NaN;
  if (!Number.isFinite(r) || !Number.isFinite(l) || l <= 0) return null;
  const pct = ((r - l) / l) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) < 0.05) return null;
  return Math.round(pct * 10) / 10;
}

function mapProviderGroup(pk: string): (typeof MODEL_PROVIDER_GROUPS)[number]["key"] | null {
  const nk = normalizeProviderKey(pk);
  if (nk === "anthropic" || nk === "openai" || nk === "google" || nk === "cloudflare") {
    return nk === "cloudflare" ? "workers_ai" : nk;
  }
  return null;
}

function ProviderChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: T.tooltipBg,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 11,
        fontFamily: T.font,
        maxWidth: 280,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6, color: T.text }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: T.muted, marginBottom: 2 }}>
          {p.name}: <span style={{ color: p.color, fontWeight: 600 }}>{fmt.num(Number(p.value) || 0)} runs</span>
        </div>
      ))}
    </div>
  );
}

export function ModelIntelligenceCard({
  perfRows,
  costLatency,
  providerColorMap = {},
}: {
  perfRows?: DashboardBundle["model_leaderboard"];
  costLatency?: DashboardBundle["cost_latency"];
  arms?: DashboardBundle["routing_arms"];
  routingTimeseries?: DashboardBundle["routing_timeseries"];
  providerColorMap?: Record<string, string>;
}) {
  const colorFor = (providerKey: string) =>
    lookupProviderColor(providerColorMap, providerPcKey(providerKey)) ?? T.accent;
  const [tab, setTab] = useState<TabId>("by_provider");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  const lbRows: LbRow[] = useMemo(() => {
    if (!perfRows?.length) return [];
    return perfRows.map((r) => {
      const prov = String(r.provider || "—");
      const pk = providerPcKey(prov);
      const runs = Math.round(Number(r.runs) || 0);
      const listIn = r.list_in_per_1k != null ? Number(r.list_in_per_1k) : null;
      const listOut = r.list_out_per_1k != null ? Number(r.list_out_per_1k) : null;
      const realized = r.realized_per_1k != null ? Number(r.realized_per_1k) : null;
      const modelKey = String(r.model_key || "—");
      return {
        model: modelKey.slice(0, 40),
        modelKey,
        prov,
        pk,
        runs,
        success: Math.round((Number(r.success_pct) || 0) * 10) / 10,
        latMs: Number(r.avg_latency_ms) || 0,
        costPer1k: realized ?? (Number(r.total_cost_usd) && Number(r.total_tokens) ? (Number(r.total_cost_usd) / Number(r.total_tokens)) * 1000 : 0),
        decayed: r.decayed_score,
        listIn,
        listOut,
        realizedPer1k: realized,
        status: pricingStatus(r),
        driftPct: costDriftPct(realized, listIn),
      };
    });
  }, [perfRows]);

  const { providerChartRows, modelBarKeys } = useMemo(() => {
    const keys = new Set<string>();
    const rows = MODEL_PROVIDER_GROUPS.map((g) => {
      if (!lookupProviderColor(providerColorMap, g.key)) return null;
      const row: Record<string, string | number> = { provider: g.label, pk: g.key };
      for (const r of lbRows) {
        const grp = mapProviderGroup(r.pk);
        if (grp !== g.key) continue;
        const barKey = r.modelKey.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32) || "model";
        keys.add(barKey);
        row[barKey] = ((row[barKey] as number) || 0) + r.runs;
      }
      return row;
    }).filter(Boolean) as Array<Record<string, string | number>>;
    return { providerChartRows: rows, modelBarKeys: [...keys] };
  }, [lbRows, providerColorMap]);

  const costLatencySorted = useMemo(() => {
    const fromLb = lbRows.map((r) => ({
      model: r.model.length > 28 ? `${r.model.slice(0, 27)}…` : r.model,
      modelFull: r.model,
      pk: r.pk,
      costPer1k: r.costPer1k,
      latMs: r.latMs,
    }));
    if (fromLb.length) {
      return [...fromLb].sort((a, b) => b.costPer1k - a.costPer1k);
    }
    if (!costLatency?.length) return [];
    return [...costLatency]
      .map((r) => {
        const pk = providerPcKey(String(r.provider || ""));
        const cost = Number(r.cost_usd) || 0;
        return {
          model: String(r.model_key || "—").slice(0, 28),
          modelFull: String(r.model_key || "—"),
          pk,
          costPer1k: cost,
          latMs: Number(r.latency_ms) || 0,
        };
      })
      .sort((a, b) => b.costPer1k - a.costPer1k);
  }, [lbRows, costLatency]);

  const drilldownRows = useMemo(() => {
    if (!selectedProvider) return [];
    const g = MODEL_PROVIDER_GROUPS.find((x) => x.label === selectedProvider);
    if (!g) return [];
    return lbRows.filter((r) => mapProviderGroup(r.pk) === g.key);
  }, [lbRows, selectedProvider]);

  const tabs: { id: TabId; label: string }[] = [
    { id: "by_provider", label: "By Provider" },
    { id: "cost_latency", label: "Cost and Latency" },
  ];

  return (
    <Card
      style={{ marginBottom: 10 }}
      data-source="D1: agentsam_agent_run, agentsam_model_pricing · Supabase mirror: agentsam_routing_arms (cost/latency fallback)"
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ color: T.muted, display: "flex" }}>{Ico.list}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>Model Intelligence</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4, background: T.surf2, borderRadius: 8, padding: 3, border: `1px solid ${T.border}` }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  if (t.id !== "by_provider") setSelectedProvider(null);
                }}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "5px 12px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontFamily: T.font,
                  color: tab === t.id ? T.text : T.muted,
                  background: tab === t.id ? T.surface : "transparent",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <NavLink href="/dashboard/analytics/models" label="Full table" />
        </div>
      </div>

      {tab === "by_provider" ? (
        lbRows.length === 0 ? (
          <PulseEmpty message="No model runs in this workspace yet." href={OVERVIEW_LINKS.workflowRuns} linkLabel="View agent runs" />
        ) : (
          <>
            <div style={{ fontSize: 9, color: T.muted, marginBottom: 8 }}>
              Runs by provider and model · click a provider group for per-model detail
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={providerChartRows}
                margin={{ top: 8, right: 8, left: -8, bottom: 4 }}
                onClick={(state) => {
                  const label = String(state?.activeLabel ?? "");
                  if (label) setSelectedProvider((cur) => (cur === label ? null : label));
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={T.grid} vertical={false} />
                <XAxis dataKey="provider" tick={{ fontSize: 9, fill: T.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: T.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ProviderChartTooltip />} cursor={{ fill: "color-mix(in srgb, var(--dashboard-text) 4%, transparent)" }} />
                <Legend wrapperStyle={{ fontSize: 9 }} />
                {modelBarKeys.map((key) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    name={key.replace(/_/g, " ")}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={28}
                    fill={T.accent}
                  >
                    {providerChartRows.map((row, idx) => (
                      <Cell key={`${key}-${idx}`} fill={colorFor(String(row.pk))} />
                    ))}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8, marginBottom: selectedProvider ? 10 : 0, fontSize: 9 }}>
              {MODEL_PROVIDER_GROUPS.filter((g) => lookupProviderColor(providerColorMap, g.key)).map((g) => (
                <span key={g.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: T.muted }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: lookupProviderColor(providerColorMap, g.key)! }} />
                  {g.label}
                </span>
              ))}
            </div>
            {selectedProvider && drilldownRows.length > 0 ? (
              <div
                style={{
                  marginTop: 4,
                  padding: 10,
                  background: T.surf2,
                  borderRadius: 8,
                  border: `1px solid ${T.border}`,
                  overflowX: "auto",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{selectedProvider} — models</span>
                  <button
                    type="button"
                    onClick={() => setSelectedProvider(null)}
                    style={{ fontSize: 10, color: T.muted, background: "none", border: "none", cursor: "pointer", fontFamily: T.font }}
                  >
                    Close
                  </button>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr style={{ color: T.muted, textAlign: "left", borderBottom: `1px solid ${T.border}` }}>
                      {["Model", "Runs", "Success %", "Realized $/1K", "Avg ms", "Status"].map((h) => (
                        <th key={h} style={{ padding: "6px 8px", fontWeight: 600 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {drilldownRows.map((r) => (
                      <tr key={r.modelKey} style={{ borderBottom: `1px solid ${T.border}` }}>
                        <td style={{ padding: "7px 8px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.model}>
                          {r.model}
                        </td>
                        <td style={{ padding: "7px 8px" }}>{fmt.num(r.runs)}</td>
                        <td style={{ padding: "7px 8px", color: r.success > 95 ? T.green : T.amber }}>{r.success}%</td>
                        <td style={{ padding: "7px 8px" }}>
                          {r.realizedPer1k != null ? `$${r.realizedPer1k.toFixed(4)}` : "—"}
                        </td>
                        <td style={{ padding: "7px 8px", color: T.muted }}>{Math.round(r.latMs)}</td>
                        <td style={{ padding: "7px 8px" }}>
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              color: r.status.color,
                              background: `color-mix(in srgb, ${r.status.color} 14%, transparent)`,
                              padding: "2px 8px",
                              borderRadius: 20,
                            }}
                          >
                            {r.status.label}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )
      ) : null}

      {tab === "cost_latency" ? (
        costLatencySorted.length === 0 ? (
          <PulseEmpty message="No routing arm statistics for this workspace." href="/dashboard/analytics/models" linkLabel="Models analytics" />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 9, color: T.muted, marginBottom: 6, fontWeight: 600 }}>Avg cost per 1K tokens</div>
              <ResponsiveContainer width="100%" height={Math.max(160, costLatencySorted.length * 22)}>
                <BarChart data={costLatencySorted} layout="vertical" margin={{ top: 2, right: 12, left: 4, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.grid} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 8, fill: T.muted }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${Number(v).toFixed(4)}`} />
                  <YAxis type="category" dataKey="model" width={88} tick={{ fontSize: 8, fill: T.muted }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(v: number) => [`$${Number(v).toFixed(4)}`, "Cost / 1K"]}
                    contentStyle={{ background: T.tooltipBg, border: `1px solid ${T.border}`, fontSize: 11 }}
                  />
                  <Bar dataKey="costPer1k" name="Cost / 1K" radius={[0, 3, 3, 0]} barSize={10}>
                    {costLatencySorted.map((entry, idx) => (
                      <Cell key={`c-${entry.modelFull}-${idx}`} fill={colorFor(entry.pk)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div style={{ fontSize: 9, color: T.muted, marginBottom: 6, fontWeight: 600 }}>Avg latency (ms)</div>
              <ResponsiveContainer width="100%" height={Math.max(160, costLatencySorted.length * 22)}>
                <BarChart data={costLatencySorted} layout="vertical" margin={{ top: 2, right: 12, left: 4, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.grid} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 8, fill: T.muted }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="model" width={88} tick={{ fontSize: 8, fill: T.muted }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(v: number) => [`${Math.round(Number(v))} ms`, "Latency"]}
                    contentStyle={{ background: T.tooltipBg, border: `1px solid ${T.border}`, fontSize: 11 }}
                  />
                  <Bar dataKey="latMs" name="Latency" radius={[0, 3, 3, 0]} barSize={10}>
                    {costLatencySorted.map((entry, idx) => (
                      <Cell key={`l-${entry.modelFull}-${idx}`} fill={colorFor(entry.pk)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      ) : null}
    </Card>
  );
}
