import type { DashboardBundle } from "./types";

export const T = {
  /** Page canvas — matches main shell background */
  bg: "var(--dashboard-canvas, var(--bg-app, var(--bg-canvas, #02080b)))",
  /** Primary panel surface */
  surface: "var(--dashboard-panel, var(--bg-panel, var(--bg-elevated, #0a1620)))",
  /** Nested / inset surface */
  surf2: "var(--dashboard-card, var(--bg-elevated, var(--bg-panel, #0a1620)))",
  border: "var(--dashboard-border, var(--border-subtle, var(--color-border, rgba(148, 163, 184, 0.14))))",
  text: "var(--dashboard-text, var(--color-text, var(--text-primary, var(--text-main, #e5eef2))))",
  muted: "var(--dashboard-muted, var(--text-muted, #8aa0aa))",
  /** Primary interactive / highlight (cyan in default solar theme) */
  accent: "var(--accent-secondary, var(--solar-cyan, #2dd4bf))",
  /** Secondary accent (blue / primary brand) */
  accent2: "var(--color-primary, var(--accent-primary, var(--solar-blue, #3a9fe8)))",
  /**
   * UI typography: cms_themes `fontFamily` → --font-family; Tailwind entry sets --font-sans (Nunito).
   */
  font: "var(--font-family, var(--font-sans, 'Nunito', system-ui, -apple-system, sans-serif))",
  /** Status + chart accents — solar + shell semantic tokens so themes stay coherent */
  green: "var(--color-success-strong, var(--solar-green, #22c55e))",
  red: "var(--color-danger-strong, var(--accent-danger, var(--solar-red, #e63333)))",
  amber: "var(--color-warning-strong, var(--accent-warning, var(--solar-yellow, #e6ac00)))",
  blue: "var(--solar-blue, #3a9fe8)",
  violet: "var(--solar-violet, #7c83d4)",
  /** Subtle fills (tracks, skeleton) — works with light or dark CMS vars */
  track: "color-mix(in srgb, var(--dashboard-text, var(--text-main, #e5eef2)) 7%, transparent)",
  grid: "color-mix(in srgb, var(--dashboard-border, var(--border-subtle, #1e3e4a)) 55%, transparent)",
  tooltipBg: "var(--dashboard-panel, var(--bg-panel, #0a1620))",
  radius: "var(--border-radius, 10px)",
};

/** Canonical provider groups for Model Intelligence bar chart (x-axis). */
export const MODEL_PROVIDER_GROUPS = [
  { key: "anthropic", label: "Anthropic" },
  { key: "openai", label: "OpenAI" },
  { key: "google", label: "Google" },
  { key: "workers_ai", label: "Workers AI" },
] as const;

export const DAYS = ["May 8", "May 9", "May 10", "May 11", "May 12", "May 13", "May 14"];

export const fmt = {
  usd: (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(2)}`),
  num: (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)),
  tok: (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : `${(n / 1000).toFixed(0)}K`),
  pct: (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`,
  hrs: (n: number) => `${n.toFixed(1)}h`,
};

/** Relative time from unix seconds (D1), epoch ms, or ISO string (matches settings `relTime` style). */
export function relTime(ts: number | string | null | undefined): string {
  if (ts == null || ts === "") return "—";
  let ms: number;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    ms = ts > 1e12 ? ts : ts * 1000;
  } else {
    const s = String(ts).trim();
    const n = Number(s);
    if (Number.isFinite(n) && /^\d+(\.\d+)?$/.test(s)) {
      ms = n > 1e12 ? n : n * 1000;
    } else {
      const parsed = Date.parse(s);
      if (!Number.isFinite(parsed)) return "—";
      ms = parsed;
    }
  }
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 0) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function formatErrorTypeTag(errorType: string): string {
  const raw = String(errorType || "error").trim();
  if (!raw) return "Error";
  return raw
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function shortErrorSource(source: string): string {
  const x = String(source || "").trim();
  if (!x) return "";
  const parts = x.split("/");
  const last = parts[parts.length - 1];
  return (last || x).slice(0, 32);
}

export function severityColor(sev: "high" | "medium" | "low"): string {
  if (sev === "high") return T.red;
  if (sev === "medium") return T.amber;
  return T.accent;
}

export const rand = (base: number, variance = 0.35) => base * (1 - variance / 2 + (Math.random() - 0.5) * variance);
export const seedArr = (base: number, len = 9) =>
  Array.from({ length: len }, (_, i) => Math.max(0, base * (0.7 + Math.sin(i * 1.4) * 0.2 + Math.random() * 0.3)));

export const STEP_COLORS = [T.accent, T.blue, T.violet, T.amber, T.green];

export function workflowStackRows(rows: NonNullable<DashboardBundle["workflow_by_day_status"]>) {
  const byDay = new Map<string, { date: string; succeeded: number; failed: number; running: number }>();
  for (const r of rows) {
    const short = String(r.day || "").slice(5);
    if (!short) continue;
    const st = String(r.status || "").toLowerCase();
    const n = Number(r.c) || 0;
    let o = byDay.get(short);
    if (!o) {
      o = { date: short, succeeded: 0, failed: 0, running: 0 };
      byDay.set(short, o);
    }
    if (st === "completed" || st === "succeeded" || st === "success" || st === "ok") o.succeeded += n;
    else if (st === "failed" || st === "error") o.failed += n;
    else if (st === "running") o.running += n;
    else o.succeeded += n;
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function dashboardBundleUrl() {
  const g =
    typeof globalThis !== "undefined"
      ? (globalThis as unknown as { __IAM_WORKSPACE_ID__?: string }).__IAM_WORKSPACE_ID__
      : "";
  const ws = g && g !== "global" ? String(g).trim() : "";
  return ws ? `/api/overview/dashboard-bundle?workspace_id=${encodeURIComponent(ws)}` : "/api/overview/dashboard-bundle";
}

export function provSlug(p: string): string {
  const x = String(p || "").toLowerCase();
  if (x.includes("openai")) return "openai";
  if (x.includes("anthropic")) return "anthropic";
  if (x.includes("google")) return "google";
  if (x.includes("workers") || x.includes("cloudflare")) return "workers_ai";
  if (x.includes("meta") || x.includes("llama")) return "meta";
  if (x.includes("mistral")) return "mistral";
  return "other";
}

const PROVIDER_SLUG_KEYS = ["openai", "anthropic", "google", "workers_ai", "mistral", "meta"] as const;

/** Map provider label to slug key (substring match on known slugs). */
export function providerPcKey(provider: string): string {
  const s = String(provider || "").toLowerCase().trim();
  for (const k of PROVIDER_SLUG_KEYS) {
    if (s.includes(k)) return k;
  }
  return provSlug(provider);
}

export function decayedScore01(x: number | null | undefined): number {
  if (x == null || !Number.isFinite(Number(x))) return 0;
  return Math.min(1, Math.max(0, Number(x)));
}

export function wfStepEpochSec(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? n / 1000 : n;
  const d = Date.parse(String(v));
  return Number.isFinite(d) ? d / 1000 : 0;
}
