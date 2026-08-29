import type { CSSProperties, ReactNode } from "react";
import { T } from "./constants";

export function Card({ children, style = {} }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 16, ...style }}>
      {children}
    </div>
  );
}

export function CardHeader({ icon, title, action }: { icon?: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        {icon && <span style={{ color: T.muted, display: "flex", alignItems: "center" }}>{icon}</span>}
        <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{title}</span>
      </div>
      {action}
    </div>
  );
}

export function Pill({ label }: { label: string }) {
  return (
    <span style={{ fontSize: 10, color: T.muted, background: T.surf2, padding: "3px 10px", borderRadius: 20, cursor: "pointer" }}>
      {label} ▾
    </span>
  );
}

export function NavLink({
  href,
  label,
  onClick,
}: {
  href: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        if (onClick) onClick();
      }}
      style={{
        fontSize: 10,
        color: T.accent,
        textDecoration: "none",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </a>
  );
}

/** Flex column card shell for System Pulse panels (scrollable body). */
export function PulseCard({
  children,
  style = {},
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", padding: 14, ...style }}>
      {children}
    </Card>
  );
}

export function Skel({ w = "100%", h = 16, r = 4 }: { w?: string | number; h?: number; r?: number }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: T.track, animation: "ovpulse 1.6s ease-in-out infinite" }} />;
}

export function Dot({ c }: { c: string }) {
  return <div style={{ width: 7, height: 7, borderRadius: "50%", background: c, flexShrink: 0 }} />;
}

export function Trend({ val }: { val: number }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: val >= 0 ? T.green : T.red }}>
      {val >= 0 ? "▲" : "▼"} {Math.abs(val).toFixed(1)}%
    </span>
  );
}

export function Sparkline({
  data,
  color = T.accent,
  h = 36,
  w = 110,
}: {
  data: number[];
  color?: string;
  h?: number;
  w?: number;
}) {
  if (!data || data.length < 2) return <div style={{ height: h }} />;
  const min = Math.min(...data),
    max = Math.max(...data),
    range = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / range) * (h - 6) - 3]);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const id = color.replace(/[^a-z0-9]/gi, "x");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`sp${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#sp${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Tip = ({ active, payload, label, fmt: fmtFn }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: T.tooltipBg, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 11, fontFamily: T.font }}>
      {label && <div style={{ color: T.muted, marginBottom: 4 }}>{label}</div>}
      {payload.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p: any, i: number) => (
          <div key={i} style={{ color: p.color || T.text, display: "flex", gap: 8 }}>
            <span style={{ color: T.muted }}>{p.name}:</span>
            <span style={{ fontWeight: 600 }}>{fmtFn ? fmtFn(p.value, p.name) : p.value?.toLocaleString()}</span>
          </div>
        ),
      )}
    </div>
  );
};

export const Ico = {
  flame: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2c0 6-6 6-6 12a6 6 0 0012 0c0-6-6-6-6-12z" />
    </svg>
  ),
  cpu: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M20 9h3M1 15h3M20 15h3" />
    </svg>
  ),
  cloud: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 10a6 6 0 00-12 0 4 4 0 000 8h12a4 4 0 000-8z" />
    </svg>
  ),
  zap: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  clock: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  tool: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  list: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  pulse: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  refresh: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  ),
  db: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
  route: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="5" cy="6" r="3" />
      <circle cx="19" cy="6" r="3" />
      <circle cx="12" cy="18" r="3" />
      <path d="M5 9v4a7 7 0 007 7M19 9v4a7 7 0 01-7 7" />
    </svg>
  ),
  deploy: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
    </svg>
  ),
};
