/**
 * Overview — remaster v2 (modular)
 * Inner Animal Media · Agent Sam Observability
 */

import '../../ops-overview-shell.css';
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ActivityData, AgentActivity, DashboardBundle, DeployData, KpiStripData, WorkflowData } from "./types";
import { T, dashboardBundleUrl } from "./constants";
import { QuickNav } from "./panels/QuickNav";
import { OpsPillars } from "./panels/OpsPillars";
import { MtdSpendStrip } from "./panels/MtdSpendStrip";
import { WorkflowRunsChart } from "./panels/WorkflowRunsChart";
import { ToolWaterfall } from "./panels/ToolWaterfall";
import { ErrorInbox } from "./panels/ErrorInbox";
import { TokensChart } from "./panels/TokensChart";
import { DeploymentsTimeline } from "./panels/DeploymentsTimeline";
import { SystemHealth } from "./panels/SystemHealth";
import { OverviewLowerGrid } from "./panels/OverviewLowerGrid";
import { bootstrapSupabaseFromSession, setSupabaseBootstrap } from "../../src/lib/supabase";
import { useRealtimeSignal, type SignalTarget } from "../../hooks/useRealtimeSignal";

/** Interval for the sole `/api/overview/dashboard-bundle` poll scheduler (Realtime only sets dirty). */
const BUNDLE_REFRESH_MS = 120_000;
const SIGNAL_FLASH_MS = 1500;

export default function OverviewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Legacy push/email deep links landed on overview — route approvals into Agent chat UI.
  useEffect(() => {
    const proposal = String(searchParams.get('proposal') || searchParams.get('id') || '').trim();
    if (!proposal) return;
    navigate(`/dashboard/agent?proposal=${encodeURIComponent(proposal)}`, { replace: true });
  }, [navigate, searchParams]);

  const [kpi, setKpi] = useState<KpiStripData | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [agent, setAgent] = useState<AgentActivity | null>(null);
  const [wf, setWf] = useState<WorkflowData | null>(null);
  const [dep, setDep] = useState<DeployData | null>(null);
  const [bundle, setBundle] = useState<DashboardBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null);
  const [signalActive, setSignalActive] = useState(false);
  const [signalError, setSignalError] = useState(false);
  const [lastSignalAt, setLastSignalAt] = useState<Date | null>(null);

  const lastBundleFetchAt = useRef(0);
  const bundleDirty = useRef(false);
  const signalFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bundlePollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const flashSignal = useCallback(() => {
    setSignalActive(true);
    setLastSignalAt(new Date());
    if (signalFlashTimer.current) clearTimeout(signalFlashTimer.current);
    signalFlashTimer.current = setTimeout(() => setSignalActive(false), SIGNAL_FLASH_MS);
  }, []);

  const refetchBundle = useCallback(async (opts?: { force?: boolean }) => {
    const now = Date.now();
    if (!opts?.force && now - lastBundleFetchAt.current < BUNDLE_REFRESH_MS) return;
    lastBundleFetchAt.current = now;
    try {
      const r = await fetch(dashboardBundleUrl(), { credentials: "same-origin" });
      if (r.ok) setBundle((await r.json()) as DashboardBundle);
    } catch {
      /* non-fatal */
    }
  }, []);

  const refetchDeployments = useCallback(async () => {
    try {
      const r = await fetch("/api/overview/deployments", { credentials: "same-origin" });
      if (r.ok) setDep(await r.json());
    } catch {
      /* non-fatal */
    }
    await refetchBundle();
  }, [refetchBundle]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [k, a, ag, w, d, b] = await Promise.allSettled([
        fetch("/api/overview/kpi-strip", { credentials: "same-origin" }).then((r) => r.json()),
        fetch("/api/overview/activity-strip", { credentials: "same-origin" }).then((r) => r.json()),
        fetch("/api/overview/agent-activity", { credentials: "same-origin" }).then((r) => r.json()),
        fetch("/api/overview/commands-workflows", { credentials: "same-origin" }).then((r) => r.json()),
        fetch("/api/overview/deployments", { credentials: "same-origin" }).then((r) => r.json()),
        fetch(dashboardBundleUrl(), { credentials: "same-origin" }).then((r) => r.json()),
      ]);
      if (k.status === "fulfilled") setKpi(k.value);
      if (a.status === "fulfilled") setActivity(a.value);
      if (ag.status === "fulfilled") setAgent(ag.value);
      if (w.status === "fulfilled") setWf(w.value);
      if (d.status === "fulfilled") setDep(d.value);
      if (b.status === "fulfilled") {
        setBundle(b.value as DashboardBundle);
        lastBundleFetchAt.current = Date.now();
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onWs = () => {
      void load();
    };
    window.addEventListener("iam_workspace_id", onWs);
    return () => window.removeEventListener("iam_workspace_id", onWs);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, cfgRes] = await Promise.all([
          fetch("/api/auth/me", { credentials: "same-origin" }),
          fetch("/api/config/client", { credentials: "same-origin" }),
        ]);
        if (cancelled) return;
        if (meRes.ok) {
          const me = (await meRes.json()) as { user?: { supabase_user_id?: string | null } };
          const uid = me.user?.supabase_user_id?.trim() || null;
          setSupabaseUserId(uid);
        }
        if (cfgRes.ok) {
          const cfg = (await cfgRes.json()) as {
            supabaseUrl?: string;
            supabaseAnonKey?: string;
            supabase_url?: string;
            supabase_anon_key?: string;
          };
          const url = String(cfg.supabaseUrl ?? cfg.supabase_url ?? "").trim();
          const key = String(cfg.supabaseAnonKey ?? cfg.supabase_anon_key ?? "").trim();
          if (url && key) {
            setSupabaseBootstrap(url, key);
            await bootstrapSupabaseFromSession();
          }
        } else if (cfgRes.status === 503 || cfgRes.status === 401) {
          setSignalError(true);
        }
      } catch {
        if (!cancelled) setSignalError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignal = useCallback(
    (_target: SignalTarget) => {
      bundleDirty.current = true;
      flashSignal();
      void refetchBundle({ force: true });
    },
    [flashSignal, refetchBundle],
  );

  useRealtimeSignal({
    onSignal: handleSignal,
    supabaseUserId,
    enabled: Boolean(supabaseUserId),
  });

  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const force = bundleDirty.current;
      bundleDirty.current = false;
      void refetchBundle(force ? { force: true } : undefined);
    };

    const startPoll = () => {
      if (bundlePollTimer.current) clearInterval(bundlePollTimer.current);
      bundlePollTimer.current = setInterval(tick, BUNDLE_REFRESH_MS);
    };

    const stopPoll = () => {
      if (bundlePollTimer.current) {
        clearInterval(bundlePollTimer.current);
        bundlePollTimer.current = null;
      }
    };

    startPoll();
    const onVis = () => (document.hidden ? stopPoll() : startPoll());
    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stopPoll();
    };
  }, [refetchBundle]);

  useEffect(() => {
    return () => {
      if (signalFlashTimer.current) clearTimeout(signalFlashTimer.current);
    };
  }, []);

  return (
    <>
      <style>{`
        @keyframes ovpulse{0%,100%{opacity:1}50%{opacity:0.4}}
        .ov-wrap *{box-sizing:border-box;}
        .ov-wrap a{color:var(--accent-secondary, var(--solar-cyan, #2dd4bf));}
      `}</style>
      <div className="ov-wrap" style={{ fontFamily: T.font, background: T.bg, color: T.text, minHeight: "100vh", padding: "22px 26px", overflowX: "hidden" }}>
        <QuickNav />

        <MtdSpendStrip bundle={bundle} loading={loading} />

        <OpsPillars bundle={bundle} loading={loading} />

        <OverviewLowerGrid>
          <div id="workflow-runs">
            <WorkflowRunsChart workflowTimeseries={bundle?.workflow_timeseries} stackRows={bundle?.workflow_by_day_status} />
          </div>
          <div id="tool-waterfall">
            <ToolWaterfall toolWaterfall={bundle?.tool_waterfall} />
          </div>
          <div id="error-inbox">
            <ErrorInbox errorLog={bundle?.error_log} errorSeverityTimeseries={bundle?.error_severity_timeseries} />
          </div>
          <div id="tokens-chart">
            <TokensChart tokenTimeseries={bundle?.token_timeseries} />
          </div>
          <div id="deployments-timeline">
            <DeploymentsTimeline
              data={dep}
              ghEvents={bundle?.github_push_events}
              deploymentStats={bundle?.deployment_stats}
              deploymentTimeseries={bundle?.deployment_timeseries}
            />
          </div>
          <SystemHealth crons={bundle?.cron_latest} cronHeatmap={bundle?.cron_heatmap} />
        </OverviewLowerGrid>
      </div>
    </>
  );
}
