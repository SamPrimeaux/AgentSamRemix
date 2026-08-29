import { useEffect, useMemo, useState } from "react";
import type { DashboardBundle } from "../types";
import { T, STEP_COLORS, wfStepEpochSec, relTime } from "../constants";
import { PulseCard, CardHeader, NavLink, Ico, Dot } from "../primitives";
import { OVERVIEW_LINKS, go } from "../overviewLinks";

type McpToolCall = {
  id?: string;
  tool_name?: string;
  tool_display_name?: string;
  status?: string;
  invoked_at?: string;
  completed_at?: string;
  duration_ms?: number;
};

function statusLabel(status: string | null | undefined) {
  const s = String(status || "").toLowerCase();
  if (s === "failed" || s === "error" || s === "timeout") return { text: "Failed", color: T.red };
  if (s === "running" || s === "started") return { text: "Running", color: T.amber };
  if (s === "completed" || s === "success") return { text: "Completed", color: T.green };
  return { text: status ? String(status) : "—", color: T.muted };
}

function durationMs(row: McpToolCall): number {
  const direct = Number(row.duration_ms);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const start = Date.parse(String(row.invoked_at || ""));
  const end = Date.parse(String(row.completed_at || row.invoked_at || ""));
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start;
  return 0;
}

function isSuccessStatus(status: string | null | undefined): boolean {
  const s = String(status || "").toLowerCase();
  return s === "completed" || s === "success" || s === "ok";
}

export function ToolWaterfall({ toolWaterfall }: { toolWaterfall?: DashboardBundle["tool_waterfall"] }) {
  const rawSteps = toolWaterfall?.steps;
  const run = toolWaterfall?.run;
  const runId = run?.id ? String(run.id) : null;
  const hasLive = Boolean(rawSteps?.length);

  const [recentCalls, setRecentCalls] = useState<McpToolCall[]>([]);
  const [callsLoading, setCallsLoading] = useState(false);

  useEffect(() => {
    if (hasLive) return;
    let cancelled = false;
    setCallsLoading(true);
    void (async () => {
      try {
        const r = await fetch("/api/mcp/tool-calls?limit=10&days=7", { credentials: "same-origin" });
        if (!r.ok) return;
        const j = (await r.json()) as { calls?: McpToolCall[] };
        if (!cancelled) setRecentCalls((j.calls || []).slice(0, 10));
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) setCallsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasLive]);

  const steps = useMemo(() => {
    if (!rawSteps?.length) return [];
    const runStart = wfStepEpochSec(rawSteps[0].started_at);
    const last = rawSteps[rawSteps.length - 1];
    const runEnd = wfStepEpochSec(last.completed_at ?? last.started_at);
    let totalSec = Math.max(runEnd - runStart, 0);
    if (totalSec <= 0) {
      const sumMs = rawSteps.reduce((s, r) => s + Math.max(0, Number(r.latency_ms) || 0), 0);
      totalSec = Math.max(sumMs / 1000, 1e-3);
    } else {
      totalSec = Math.max(totalSec, 1e-3);
    }
    const totalMs = totalSec * 1000;
    return rawSteps.map((s, i) => {
      const ms = Math.max(0, Number(s.latency_ms) || 0);
      const bar = ((wfStepEpochSec(s.started_at) - runStart) / totalSec) * 100;
      const len = Math.max((ms / totalMs) * 100, 2);
      const st = String(s.status || "").toLowerCase();
      let c = STEP_COLORS[i % STEP_COLORS.length];
      if (st === "success" || st === "completed") c = T.accent;
      else if (st === "failed" || st === "error") c = T.red;
      else if (st === "running") c = T.amber;
      const label = String(s.node_key || s.node_type || "step").slice(0, 40);
      return {
        n: i + 1,
        tool: label,
        dur: `${(ms / 1000).toFixed(2)}s`,
        bar,
        len,
        c,
        status: st,
      };
    });
  }, [rawSteps]);

  const totalS = useMemo(() => {
    if (!rawSteps?.length) return 0;
    const ms = rawSteps.reduce((s, r) => s + Math.max(0, Number(r.latency_ms) || 0), 0);
    return ms / 1000;
  }, [rawSteps]);

  const errN =
    rawSteps?.filter((r) => {
      const st = String(r.status || "").toLowerCase();
      return st.includes("error") || st === "failed" || st === "timeout";
    }).length ?? 0;

  const runTitle = run?.display_name ? String(run.display_name).slice(0, 120) : null;
  const runHref = runId ? OVERVIEW_LINKS.workflowRun(runId) : OVERVIEW_LINKS.workflowRuns;
  const badge = statusLabel(run?.status);

  const showRecentList = !hasLive && recentCalls.length > 0;

  return (
    <PulseCard>
      <CardHeader
        icon={Ico.zap}
        title="Tool Call Waterfall"
        action={
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {hasLive ? (
              <span
                style={{
                  fontSize: 10,
                  color: badge.color,
                  background: `color-mix(in srgb, ${badge.color} 14%, transparent)`,
                  padding: "2px 8px",
                  borderRadius: 20,
                }}
              >
                {badge.text}
              </span>
            ) : null}
            <NavLink href={runHref} label={runId ? "Open run" : "Open run"} />
          </span>
        }
      />
      <div className="ov-pulse-body">
        {!hasLive && !showRecentList ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 140,
              padding: "20px 12px",
              border: `1px dashed ${T.border}`,
              borderRadius: 8,
              textAlign: "center",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 11, color: T.muted }}>
              {callsLoading ? "Loading recent tool calls…" : "No runs yet"}
            </span>
            <NavLink href={OVERVIEW_LINKS.workflowRuns} label="Open run" />
          </div>
        ) : null}

        {showRecentList ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <div
              style={{
                fontSize: 9,
                color: T.muted,
                marginBottom: 8,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Recent tool calls (D1: agentsam_mcp_tool_execution)
            </div>
            {recentCalls.map((row, i) => {
              const name = String(row.tool_display_name || row.tool_name || "tool").slice(0, 48);
              const ms = durationMs(row);
              const ok = isSuccessStatus(row.status);
              return (
                <div
                  key={String(row.id || i)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto auto",
                    gap: 8,
                    alignItems: "center",
                    padding: "8px 0",
                    borderBottom: i < recentCalls.length - 1 ? `1px solid ${T.border}` : "none",
                    fontSize: 10,
                  }}
                >
                  <span style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>
                    {name}
                  </span>
                  <span style={{ color: T.muted, fontSize: 9 }}>{ms > 0 ? `${ms} ms` : "—"}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 9, color: T.muted }}>{relTime(row.invoked_at)}</span>
                    <Dot c={ok ? T.green : T.red} />
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        {hasLive ? (
          <>
            {runTitle ? (
              <button
                type="button"
                onClick={() => go(runHref)}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: T.text,
                  marginTop: -8,
                  marginBottom: 10,
                  lineHeight: 1.35,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: T.font,
                  width: "100%",
                }}
              >
                {runTitle}
              </button>
            ) : null}
            <div
              style={{
                fontSize: 9,
                display: "grid",
                gridTemplateColumns: "14px minmax(0, 1fr) 36px 1fr",
                gap: "0 8px",
                color: T.muted,
                paddingBottom: 6,
                borderBottom: `1px solid ${T.border}`,
                marginBottom: 8,
              }}
            >
              <span>#</span>
              <span>Node</span>
              <span>Dur</span>
              <span>Timeline</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {steps.map((s) => (
                <button
                  key={s.n}
                  type="button"
                  onClick={() => go(runHref)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "14px minmax(0, 1fr) 36px 1fr",
                    gap: "0 8px",
                    alignItems: "center",
                    background: "none",
                    border: "none",
                    padding: "2px 0",
                    cursor: "pointer",
                    fontFamily: T.font,
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span style={{ fontSize: 9, color: T.muted }}>{s.n}</span>
                  <span style={{ fontSize: 9, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.tool}
                  </span>
                  <span style={{ fontSize: 9, color: T.muted }}>{s.dur}</span>
                  <div style={{ height: 12, background: T.track, borderRadius: 3, position: "relative", overflow: "hidden" }}>
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${s.bar}%`,
                        width: `${s.len}%`,
                        background: s.c,
                        borderRadius: 3,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                </button>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 10,
                paddingTop: 8,
                borderTop: `1px solid ${T.border}`,
                fontSize: 9,
                color: T.muted,
              }}
            >
              <span>Total: {totalS.toFixed(2)}s</span>
              <span>{steps.length} steps</span>
              <button
                type="button"
                onClick={() => go(runHref)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: errN > 0 ? T.red : T.muted,
                  cursor: "pointer",
                  fontFamily: T.font,
                  fontSize: 9,
                }}
              >
                {errN} errors
              </button>
            </div>
          </>
        ) : null}
      </div>
    </PulseCard>
  );
}
