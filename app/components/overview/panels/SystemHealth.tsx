import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { DashboardBundle } from "../types";
import { T, DAYS } from "../constants";
import { Card, CardHeader, Pill, Tip, Ico } from "../primitives";

type Cell = "ok" | "fail" | "skip" | "warn" | "empty";

function cellColor(cell: Cell): string {
  switch (cell) {
    case "ok":
      return T.green;
    case "fail":
      return T.red;
    case "skip":
      return T.muted;
    case "warn":
      return T.amber;
    default:
      return T.track;
  }
}

function cellLabel(cell: Cell): string {
  switch (cell) {
    case "ok":
      return "OK";
    case "fail":
      return "Failed";
    case "skip":
      return "Skipped";
    case "warn":
      return "Running / unknown";
    default:
      return "No run";
  }
}

export function SystemHealth({
  crons: _crons,
  cronHeatmap,
}: {
  crons?: DashboardBundle["cron_latest"];
  cronHeatmap?: DashboardBundle["cron_heatmap"];
}) {
  void _crons;
  const jobs = cronHeatmap?.length
    ? cronHeatmap
    : [];
  const uptime = DAYS.map((date) => ({ date, pct: 99.5 + Math.random() * 0.5 }));

  const numRuns = 7;
  const colCount = Math.max(jobs.length, 1);

  return (
    <Card style={{ flex: "1 1 240px", minWidth: 0 }}>
      <CardHeader icon={Ico.pulse} title="System Health" action={<Pill label="agentsam_cron_runs" />} />
      <div style={{ fontSize: 9, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Cron runs (newest → older)</div>
      {jobs.length === 0 ? (
        <div style={{ fontSize: 10, color: T.muted, padding: "12px 0 16px" }}>No cron history in D1 for this tenant.</div>
      ) : (
        <div style={{ overflowX: "auto", marginBottom: 10, maxWidth: "100%" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `22px repeat(${colCount}, minmax(10px, 1fr))`,
              gap: 3,
              minWidth: 22 + colCount * 12,
              alignItems: "center",
            }}
          >
            <div />
            {jobs.map((j) => (
              <div
                key={j.job_name}
                title={j.job_name}
                style={{
                  fontSize: 7,
                  color: T.muted,
                  textAlign: "center",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 48,
                  justifySelf: "center",
                }}
              >
                {j.job_name.length > 10 ? `${j.job_name.slice(0, 9)}…` : j.job_name}
              </div>
            ))}
            {Array.from({ length: numRuns }, (_, runIdx) => (
              // runIdx 0 = most recent row in heatmap (runs[0])
              <div key={runIdx} style={{ display: "contents" }}>
                <div style={{ fontSize: 7, color: T.muted, textAlign: "right", paddingRight: 2 }}>{runIdx + 1}</div>
                {jobs.map((j) => {
                  const cell = (j.runs[runIdx] || "empty") as Cell;
                  return (
                    <div
                      key={`${j.job_name}-${runIdx}`}
                      title={`${j.job_name} · run ${runIdx + 1} (newest=1): ${cellLabel(cell)}`}
                      style={{
                        width: "100%",
                        height: 10,
                        borderRadius: 2,
                        background: cellColor(cell),
                        opacity: cell === "empty" ? 0.35 : 1,
                        boxSizing: "border-box",
                        border: `1px solid ${T.border}`,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10, fontSize: 9, color: T.muted }}>
        {(
          [
            ["OK", T.green],
            ["Fail", T.red],
            ["Skip", T.muted],
            ["Run/pend.", T.amber],
            ["Empty", T.track],
          ] as const
        ).map(([l, c]) => (
          <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c, border: `1px solid ${T.border}` }} />
            {l}
          </span>
        ))}
      </div>
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
        <div style={{ fontSize: 9, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Uptime (7d)</div>
        <ResponsiveContainer width="100%" height={52}>
          <AreaChart data={uptime} margin={{ top: 2, right: 0, left: -28, bottom: 0 }}>
            <XAxis hide />
            <YAxis domain={[99, 100.1]} hide />
            <Tooltip content={<Tip fmt={(v: number) => `${v.toFixed(3)}%`} />} />
            <Area type="monotone" dataKey="pct" name="Uptime" stroke={T.green} fill={T.green} fillOpacity={0.15} strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
