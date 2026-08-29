import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { DashboardBundle, DeployData } from "../types";
import { T, DAYS } from "../constants";
import { Card, CardHeader, Dot, Pill, Tip, Ico } from "../primitives";

const COMMIT_PREVIEW = 7;

export function DeploymentsTimeline({
  data,
  ghEvents,
  deploymentStats,
  deploymentTimeseries,
}: {
  data: DeployData | null;
  ghEvents?: DashboardBundle["github_push_events"];
  deploymentStats?: DashboardBundle["deployment_stats"];
  deploymentTimeseries?: DashboardBundle["deployment_timeseries"];
}) {
  const deploys = data?.deployments?.slice(0, 6) || [];
  const ds = deploymentStats ?? {
    total: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    avg_ms: 0,
  };
  const successPct = ds.total > 0 ? ((ds.succeeded / ds.total) * 100).toFixed(1) + "%" : "0.0%";
  const hist =
    deploymentTimeseries && deploymentTimeseries.length > 0
      ? deploymentTimeseries.map((r) => ({
          date: String(r.date || "").slice(5),
          prod: Number(r.prod) || 0,
          staging: Number(r.staging) || 0,
        }))
      : DAYS.map((date) => ({ date, prod: 0, staging: 0 }));
  const fallback = [
    { worker_name: "agent-sam-worker", environment: "prod", status: "success", deployed_at: "2h ago" },
    { worker_name: "iam-api-gateway", environment: "prod", status: "success", deployed_at: "5h ago" },
    { worker_name: "mcp-server", environment: "staging", status: "success", deployed_at: "1d ago" },
    { worker_name: "iam-pty", environment: "prod", status: "rollback", deployed_at: "2d ago" },
  ];
  const ghRows =
    ghEvents?.map((g) => ({
      worker_name: String(g.commit_message || "").slice(0, 56) || "(push)",
      environment: String(g.branch || "—"),
      status: "success",
      deployed_at: String(g.received_at || "").slice(5, 16) || "—",
      author: String(g.author_username || ""),
      repo: String(g.repo_full_name || ""),
    })) || [];
  const rows = ghRows.length > 0 ? ghRows : deploys.length > 0 ? deploys : fallback;
  const [commitsExpanded, setCommitsExpanded] = useState(false);
  const visibleRows = commitsExpanded ? rows : rows.slice(0, COMMIT_PREVIEW);
  const moreCommits = rows.length > COMMIT_PREVIEW;

  return (
    <Card style={{ flex: "2 1 340px" }}>
      <CardHeader icon={Ico.deploy} title="Deployments Timeline" action={<Pill label="agentsam_webhook_events" />} />
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[
          [String(ds.total), "Total", T.text],
          [successPct, "Success", T.green],
          [String(ds.failed), "Failed", T.red],
          [String(ds.cancelled), "Cancelled", T.amber],
        ].map(([v, l, c]) => (
          <div key={l} style={{ flex: 1, background: T.surf2, borderRadius: 7, padding: "7px 10px", border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: c }}>{v}</div>
            <div style={{ fontSize: 9, color: T.muted }}>{l}</div>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={68}>
        <BarChart data={hist} margin={{ top: 0, right: 0, left: -28, bottom: 0 }} barSize={6} barGap={2}>
          <XAxis dataKey="date" tick={{ fontSize: 8, fill: T.muted }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 8, fill: T.muted }} axisLine={false} tickLine={false} />
          <Tooltip content={<Tip />} />
          <Bar dataKey="prod" name="Prod" fill={T.accent} radius={[2, 2, 0, 0]} />
          <Bar dataKey="staging" name="Staging" fill={T.violet} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", gap: 12, marginTop: 4, marginBottom: 8 }}>
        {[
          ["Prod", T.accent],
          ["Staging", T.violet],
        ].map(([l, c]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: T.muted }}>
            <Dot c={c} />
            {l}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Recent activity</span>
        {moreCommits ? (
          <button
            type="button"
            onClick={() => setCommitsExpanded((v) => !v)}
            style={{ fontSize: 10, color: T.accent, background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}
          >
            {commitsExpanded ? "Show less" : `View all (${rows.length})`}
          </button>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {visibleRows.map((d: any, i: number) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 0",
              borderBottom: i < visibleRows.length - 1 ? `1px solid ${T.border}` : "none",
              fontSize: 10,
            }}
          >
            <Dot c={d.status === "success" ? T.green : d.status === "rollback" ? T.amber : T.red} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.repo ? `${d.repo} · ${d.author || ""}` : ""}>
              {d.worker_name}
            </span>
            <span style={{ color: T.muted, fontSize: 9 }}>{d.environment}</span>
            <span style={{ color: T.muted, fontSize: 9 }}>{d.deployed_at || new Date(d.timestamp || 0).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
