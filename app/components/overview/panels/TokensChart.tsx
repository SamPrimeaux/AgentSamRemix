import { AreaChart, Area, CartesianGrid, Tooltip, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { DashboardBundle } from "../types";
import { T, fmt } from "../constants";
import { PulseCard, CardHeader, Dot, NavLink, Tip, Ico } from "../primitives";
import { PulseEmpty } from "./PulseEmpty";
import { OVERVIEW_LINKS, go } from "../overviewLinks";

export function TokensChart({ tokenTimeseries }: { tokenTimeseries?: DashboardBundle["token_timeseries"] }) {
  const hasLive = Boolean(tokenTimeseries?.length);
  const data = hasLive
    ? tokenTimeseries!.map((r) => ({
        date: String(r.date || "").slice(5),
        input: Number(r.input) || 0,
        output: Number(r.output) || 0,
        cached: Number(r.cached) || 0,
      }))
    : [];

  const total = data.reduce((s, r) => s + r.input + r.output + r.cached, 0);

  return (
    <PulseCard>
      <CardHeader icon={Ico.zap} title="Tokens Over Time" action={<NavLink href={OVERVIEW_LINKS.tokens} label="Cost breakdown" />} />
      <div className="ov-pulse-body">
        {!hasLive || total === 0 ? (
          <PulseEmpty
            message="No token usage recorded in the last 7 days."
            href={OVERVIEW_LINKS.tokens}
            linkLabel="Open costs"
          />
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
              {(
                [
                  ["Input", T.accent],
                  ["Output", T.violet],
                  ["Cached", T.blue],
                ] as const
              ).map(([l, c]) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => go(OVERVIEW_LINKS.tokens)}
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
            <ResponsiveContainer width="100%" height={148}>
              <AreaChart
                data={data}
                margin={{ top: 0, right: 0, left: -22, bottom: 0 }}
                onClick={() => go(OVERVIEW_LINKS.tokens)}
                style={{ cursor: "pointer" }}
              >
                <defs>
                  {(
                    [
                      ["ti", T.accent],
                      ["to", T.violet],
                      ["tc", T.blue],
                    ] as const
                  ).map(([id, c]) => (
                    <linearGradient key={id} id={`tg${id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={c} stopOpacity=".4" />
                      <stop offset="95%" stopColor={c} stopOpacity="0" />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={T.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: T.muted }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 9, fill: T.muted }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => fmt.tok(v)}
                />
                <Tooltip content={<Tip fmt={(v: number) => fmt.tok(v)} />} />
                <Area type="monotone" dataKey="input" name="Input" stroke={T.accent} fill="url(#tgti)" strokeWidth={1.5} />
                <Area type="monotone" dataKey="output" name="Output" stroke={T.violet} fill="url(#tgto)" strokeWidth={1.5} />
                <Area type="monotone" dataKey="cached" name="Cached" stroke={T.blue} fill="url(#tgtc)" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </PulseCard>
  );
}
