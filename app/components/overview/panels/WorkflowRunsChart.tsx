import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { DashboardBundle } from "../types";
import { T, workflowStackRows } from "../constants";
import { PulseCard, CardHeader, Dot, NavLink, Tip, Ico } from "../primitives";
import { PulseEmpty } from "./PulseEmpty";
import { OVERVIEW_LINKS, go } from "../overviewLinks";

type ChartRow = {
  date: string;
  succeeded: number;
  failed: number;
  running: number;
};

export function WorkflowRunsChart({
  workflowTimeseries,
  stackRows,
}: {
  workflowTimeseries?: DashboardBundle["workflow_timeseries"];
  stackRows?: DashboardBundle["workflow_by_day_status"];
}) {
  const hasLive = Boolean(workflowTimeseries?.length || stackRows?.length);
  const data: ChartRow[] = hasLive
    ? workflowTimeseries && workflowTimeseries.length > 0
      ? workflowTimeseries.map((r) => ({
          date: String(r.date || "").slice(5),
          succeeded: Number(r.succeeded) || 0,
          failed: Number(r.failed) || 0,
          running: Number(r.running) || 0,
        }))
      : workflowStackRows(stackRows!)
    : [];

  const total = data.reduce((s, r) => s + r.succeeded + r.failed + r.running, 0);

  return (
    <PulseCard>
      <CardHeader
        icon={Ico.cpu}
        title="Workflow Runs Over Time"
        action={<NavLink href={OVERVIEW_LINKS.workflowRuns} label="All runs" />}
      />
      <div className="ov-pulse-body">
        {!hasLive || total === 0 ? (
          <PulseEmpty
            message="No workflow runs in the last 7 days for this workspace."
            href={OVERVIEW_LINKS.workflowRuns}
            linkLabel="Agent run timeline"
          />
        ) : (
          <>
            <div style={{ display: "flex", gap: 14, marginBottom: 8, flexWrap: "wrap" }}>
              {(
                [
                  ["Succeeded", T.accent],
                  ["Failed", T.red],
                  ["Running", T.amber],
                ] as const
              ).map(([l, c]) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => go(OVERVIEW_LINKS.workflowRuns)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 10,
                    color: T.muted,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    fontFamily: T.font,
                  }}
                >
                  <Dot c={c} />
                  {l}
                </button>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={data} margin={{ top: 0, right: 0, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: T.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: T.muted }} axisLine={false} tickLine={false} />
                <Tooltip content={<Tip />} />
                <Bar
                  dataKey="succeeded"
                  stackId="a"
                  fill={T.accent}
                  name="Succeeded"
                  cursor="pointer"
                  onClick={() => go(OVERVIEW_LINKS.workflowRuns)}
                />
                <Bar
                  dataKey="failed"
                  stackId="a"
                  fill={T.red}
                  name="Failed"
                  cursor="pointer"
                  onClick={() => go(OVERVIEW_LINKS.workflowRuns)}
                />
                <Bar
                  dataKey="running"
                  stackId="a"
                  fill={T.amber}
                  name="Running"
                  radius={[2, 2, 0, 0]}
                  cursor="pointer"
                  onClick={() => go(OVERVIEW_LINKS.workflowRuns)}
                />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </PulseCard>
  );
}

function div({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={style}>{children}</div>;
}
