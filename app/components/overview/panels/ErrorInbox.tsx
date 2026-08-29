import { useMemo, useState } from "react";
import { BarChart, Bar, CartesianGrid, Tooltip, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { DashboardBundle } from "../types";
import { T, relTime, formatErrorTypeTag, shortErrorSource, severityColor } from "../constants";
import { PulseCard, CardHeader, Dot, Ico, NavLink, Tip } from "../primitives";
import { PulseEmpty } from "./PulseEmpty";
import { OVERVIEW_LINKS, go } from "../overviewLinks";

const PREVIEW_ROWS = 5;

function bucketErrorLogByDay(
  log: NonNullable<DashboardBundle["error_log"]>,
): Array<{ date: string; high: number; medium: number; low: number }> {
  const by = new Map<string, { high: number; medium: number; low: number }>();
  for (const r of log) {
    const ms =
      typeof r.created_at === "number"
        ? r.created_at > 1e12
          ? r.created_at
          : r.created_at * 1000
        : Date.parse(String(r.created_at));
    if (!Number.isFinite(ms)) continue;
    const d = new Date(ms);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const sev = r.severity || "low";
    const cur = by.get(key) || { high: 0, medium: 0, low: 0 };
    if (sev === "high") cur.high += 1;
    else if (sev === "medium") cur.medium += 1;
    else cur.low += 1;
    by.set(key, cur);
  }
  return [...by.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7);
}

function errorRowHref(r: { source?: string; source_id?: string | null; error_type?: string }) {
  const src = String(r.source || "").trim();
  if (src) return OVERVIEW_LINKS.errorsSource(src);
  return OVERVIEW_LINKS.errors;
}

function rowKey(r: { source?: string; source_id?: string | null; created_at?: number; error_type?: string }, i: number) {
  return `${r.source || ""}:${r.source_id || ""}:${r.created_at ?? i}:${r.error_type || ""}`;
}

export function ErrorInbox({
  errorLog,
  errorSeverityTimeseries,
}: {
  errorLog?: DashboardBundle["error_log"];
  errorSeverityTimeseries?: DashboardBundle["error_severity_timeseries"];
}) {
  const [listExpanded, setListExpanded] = useState(false);
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);
  const log = errorLog ?? [];
  const hasLive = log.length > 0;

  const chartData = useMemo(() => {
    if (errorSeverityTimeseries?.length) {
      return errorSeverityTimeseries.map((r) => ({
        date: String(r.date || "").slice(5),
        high: Number(r.high) || 0,
        medium: Number(r.medium) || 0,
        low: Number(r.low) || 0,
      }));
    }
    return bucketErrorLogByDay(log).map((r) => ({ ...r, date: r.date.slice(5) }));
  }, [errorSeverityTimeseries, log]);

  const hi = log.filter((r) => r.severity === "high").length;
  const med = log.filter((r) => r.severity === "medium").length;
  const lo = log.filter((r) => r.severity === "low").length;
  const counts = [
    { l: "High", n: hi, c: T.red, sev: "high" as const },
    { l: "Medium", n: med, c: T.amber, sev: "medium" as const },
    { l: "Low", n: lo, c: T.accent, sev: "low" as const },
  ];

  const rows = log.map((r, i) => {
    const sev = r.severity;
    const c = severityColor(sev);
    const tag = formatErrorTypeTag(String(r.error_type || ""));
    const src = shortErrorSource(String(r.source || ""));
    const fullMsg = String(r.error_message || "");
    const msg = fullMsg.slice(0, 220);
    const time = relTime(r.created_at);
    const key = rowKey(r, i);
    const contextParts: string[] = [];
    if (r.source) contextParts.push(`Source: ${r.source}`);
    if (r.source_id) contextParts.push(`ID: ${r.source_id}`);
    return {
      key,
      time,
      tag,
      src,
      msg,
      fullMsg,
      context: contextParts.join(" · "),
      c,
      sev,
      raw: r,
      href: errorRowHref(r),
      advisorsHref: OVERVIEW_LINKS.errors,
    };
  });

  const visible = listExpanded ? rows : rows.slice(0, PREVIEW_ROWS);
  const hasMore = rows.length > PREVIEW_ROWS;

  return (
    <PulseCard>
      <CardHeader
        icon={Ico.pulse}
        title="Error Inbox"
        action={
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {hasMore ? (
              <button
                type="button"
                onClick={() => setListExpanded((v) => !v)}
                style={{
                  fontSize: 10,
                  color: T.accent,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: T.font,
                }}
              >
                {listExpanded ? "Show less" : `View all (${rows.length})`}
              </button>
            ) : (
              <NavLink href={OVERVIEW_LINKS.errors} label="Advisors" />
            )}
          </span>
        }
      />
      <div className="ov-pulse-body">
        {!hasLive ? (
          <PulseEmpty message="No unresolved errors for this workspace." href={OVERVIEW_LINKS.errors} linkLabel="Error advisors" />
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {counts.map((s) => (
                <button
                  key={s.l}
                  type="button"
                  onClick={() => go(OVERVIEW_LINKS.errors)}
                  style={{
                    flex: 1,
                    background: T.surf2,
                    borderRadius: 7,
                    padding: "6px 10px",
                    border: `1px solid ${T.border}`,
                    cursor: "pointer",
                    fontFamily: T.font,
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontSize: 16, fontWeight: 700, color: s.c }}>{s.n}</div>
                  <div style={{ fontSize: 9, color: T.muted }}>{s.l}</div>
                </button>
              ))}
            </div>
            <div
              style={{
                fontSize: 9,
                color: T.muted,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 6,
              }}
            >
              Severity (7d)
            </div>
            <ResponsiveContainer width="100%" height={88}>
              <BarChart
                data={chartData.length ? chartData : [{ date: "—", high: 0, medium: 0, low: 0 }]}
                margin={{ top: 2, right: 4, left: -28, bottom: 0 }}
                barGap={1}
                onClick={() => go(OVERVIEW_LINKS.errors)}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={T.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: T.muted }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<Tip />} />
                <Bar dataKey="high" stackId="sev" name="High" fill={T.red} />
                <Bar dataKey="medium" stackId="sev" name="Medium" fill={T.amber} />
                <Bar dataKey="low" stackId="sev" name="Low" fill={T.accent} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 9, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", margin: "8px 0 6px" }}>
              Recent
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {visible.map((e, i) => {
                const isOpen = openRowKey === e.key;
                return (
                  <div
                    key={e.key}
                    style={{
                      borderBottom: i < visible.length - 1 ? `1px solid ${T.border}` : "none",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenRowKey((k) => (k === e.key ? null : e.key))}
                      aria-expanded={isOpen}
                      style={{
                        display: "flex",
                        gap: 7,
                        alignItems: "flex-start",
                        padding: "7px 0",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontFamily: T.font,
                        width: "100%",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ fontSize: 9, color: T.muted, width: 52, flexShrink: 0, marginTop: 2 }}>{e.time}</span>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color: e.c,
                          background: `color-mix(in srgb, ${e.c} 18%, transparent)`,
                          padding: "1px 6px",
                          borderRadius: 3,
                          flexShrink: 0,
                        }}
                      >
                        {e.tag}
                      </span>
                      <span style={{ fontSize: 9, color: T.muted, lineHeight: 1.5, flex: 1, overflow: "hidden" }}>
                        {e.src ? (
                          <>
                            <span style={{ color: T.text, opacity: 0.75 }}>{e.src}</span>
                            {e.msg ? " · " : ""}
                          </>
                        ) : null}
                        {isOpen ? e.fullMsg : e.msg}
                      </span>
                      <Dot c={e.c} />
                    </button>
                    {isOpen ? (
                      <div
                        style={{
                          margin: "0 0 10px 59px",
                          padding: "10px 12px",
                          background: T.surf2,
                          borderRadius: 8,
                          border: `1px solid ${T.border}`,
                          fontSize: 10,
                          lineHeight: 1.5,
                        }}
                      >
                        <div style={{ color: T.text, whiteSpace: "pre-wrap", wordBreak: "break-word", marginBottom: 8 }}>
                          {e.fullMsg || "—"}
                        </div>
                        {e.context ? (
                          <div style={{ color: T.muted, fontSize: 9, marginBottom: 8 }}>{e.context}</div>
                        ) : null}
                        <a
                          href={e.advisorsHref}
                          style={{ fontSize: 10, color: T.accent, textDecoration: "none", fontWeight: 600 }}
                        >
                          View in Advisors →
                        </a>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {!listExpanded && hasMore ? (
              <button
                type="button"
                onClick={() => go(OVERVIEW_LINKS.errors)}
                style={{
                  marginTop: 8,
                  fontSize: 10,
                  color: T.accent,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: T.font,
                }}
              >
                Open full error log in Advisors
              </button>
            ) : null}
          </>
        )}
      </div>
    </PulseCard>
  );
}
