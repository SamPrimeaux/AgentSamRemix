import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { DashboardBundle } from "../types";
import { T, fmt } from "../constants";
import { Sparkline, Skel } from "../primitives";

const GRID_STYLE = `
.ov-pillars {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
  grid-template-columns: 1fr;
}
@media (min-width: 640px) {
  .ov-pillars { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 1024px) {
  .ov-pillars { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
.ov-pillar {
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  background: var(--dashboard-panel, #0a1620);
  border: 1px solid var(--dashboard-border, rgba(148,163,184,0.14));
  border-radius: var(--border-radius, 10px);
  padding: 14px 16px;
  color: inherit;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  transition: border-color 0.15s ease;
}
.ov-pillar:hover {
  border-color: color-mix(in srgb, var(--accent-secondary, #2dd4bf) 40%, transparent);
}
.ov-pillar:focus-visible {
  outline: 2px solid var(--accent-secondary, #2dd4bf);
  outline-offset: 2px;
}
`;

type Pillar = {
  id: string;
  title: string;
  primary: string;
  secondary?: string;
  tertiary?: string;
  badge?: string;
  href: string;
  scrollId: string;
  spark?: number[];
};

function sumWfSpark(ts: NonNullable<DashboardBundle["workflow_timeseries"]>): number[] {
  return ts.map((r) => (Number(r.succeeded) || 0) + (Number(r.failed) || 0) + (Number(r.running) || 0));
}

function seriesHasNonZero(values: number[]) {
  return values.some((v) => v > 0);
}

export function OpsPillars({
  bundle,
  loading,
}: {
  bundle: DashboardBundle | null;
  loading: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const onOverview = location.pathname === "/dashboard/overview" || location.pathname === "/dashboard/overview/";
  const live = bundle?.ok === true && bundle.kpis != null;
  const k = bundle?.kpis ?? {};

  const pillars: Pillar[] = useMemo(() => {
    const agentCalls7 = Number(k.agent_calls_7d) || 0;
    const mcpToday = Number(k.mcp_calls_today) || 0;
    const wfOk = Number(k.workflow_runs_today_success) || 0;
    const wfFail = Number(k.workflow_runs_today_failed) || 0;
    const openTasks = Number(k.open_tasks) || 0;
    const plansN = bundle?.active_plans?.length ?? 0;
    const healthRatio = k.worker_health_ratio;
    const healthPrimary =
      healthRatio != null && Number.isFinite(Number(healthRatio))
        ? `${Number(healthRatio).toFixed(1)}%`
        : "--";
    const push7 = Number(k.github_push_events_7d) || 0;
    const deployOk = Number(bundle?.deployment_stats?.succeeded) || 0;

    const wfSpark =
      bundle?.workflow_timeseries?.length && seriesHasNonZero(sumWfSpark(bundle.workflow_timeseries))
        ? sumWfSpark(bundle.workflow_timeseries)
        : undefined;

    const showPush = live ? push7 > 0 : false;
    const showDeploys = live ? deployOk > 0 : false;

    return [
      {
        id: "execution",
        title: "Execution",
        primary: live ? fmt.num(agentCalls7) : "--",
        secondary: live ? `OK ${wfOk} / failed ${wfFail}` : undefined,
        badge: mcpToday > 0 ? `${fmt.num(mcpToday)} MCP today` : undefined,
        spark: wfSpark,
        href: "/dashboard/analytics/agent",
        scrollId: "workflow-runs",
      },
      {
        id: "plans",
        title: "Plans and work",
        primary: live ? String(openTasks) : "--",
        secondary: live ? `${plansN} active plans` : undefined,
        href: "/dashboard/tasks?plan_status=active",
        scrollId: "active-plans",
      },
      {
        id: "platform",
        title: "Platform",
        primary: healthPrimary,
        secondary: showPush ? `${fmt.num(push7)} pushes 7d` : undefined,
        tertiary: showDeploys ? `${fmt.num(deployOk)} deploys` : undefined,
        href: "/dashboard/analytics/deploys",
        scrollId: "deployments-timeline",
      },
    ];
  }, [bundle, k, live]);

  const handleClick = (p: Pillar) => {
    if (onOverview) {
      const el = document.getElementById(p.scrollId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    navigate(p.href);
  };

  return (
    <>
      <style>{GRID_STYLE}</style>
      <div className="ov-pillars" role="group" aria-label="Operations pillars">
        {pillars.map((p) => (
          <button key={p.id} type="button" className="ov-pillar" onClick={() => handleClick(p)} data-pillar={p.id}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted }}>
              {p.title}
            </div>
            {loading ? (
              <>
                <Skel h={22} w="50%" />
                <Skel h={32} />
              </>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 4 }}>
                  <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>{p.primary}</span>
                  {p.badge ? (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color: T.accent,
                        background: `color-mix(in srgb, ${T.accent} 12%, transparent)`,
                        padding: "2px 8px",
                        borderRadius: 20,
                        marginLeft: "auto",
                      }}
                    >
                      {p.badge}
                    </span>
                  ) : null}
                </div>
                {p.spark && p.spark.length >= 2 ? (
                  <Sparkline data={p.spark} color={T.accent} h={32} w={120} />
                ) : null}
                {p.secondary ? (
                  <div style={{ fontSize: 10, color: T.muted }}>{p.secondary}</div>
                ) : null}
                {p.tertiary ? (
                  <div style={{ fontSize: 10, color: T.muted }}>{p.tertiary}</div>
                ) : null}
              </>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
