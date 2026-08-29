/** Code-index display helpers (ProjectDetail peel B1). */

export type EmbedCostRollup = {
  cost_usd_30d?: number;
  cost_usd_today?: number;
  embed_events_30d?: number;
  embed_events_today?: number;
  cost_usd_this_run?: number | null;
  embed_events_this_run?: number | null;
  active_full_run?: boolean;
  this_run_id?: string | null;
};

export function relativeTimeLabel(input: string | number | null | undefined): string {
  if (input == null || input === '') return '—';
  const d =
    typeof input === 'number'
      ? new Date(input > 1e12 ? input : input * 1000)
      : new Date(String(input));
  const t = d.getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.round((Date.now() - t) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return `${abs}s ago`;
  const m = Math.round(abs / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 14) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

/** This-run dollars (ref_id); append today when it differs so OpenAI day bars reconcile. */
export function formatEmbedSpendLine(cost: EmbedCostRollup | null | undefined): string {
  if (!cost) return '';
  const fmt = (v: number | null | undefined) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return '$0';
    return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
  };
  if (cost.this_run_id && cost.cost_usd_this_run != null && Number.isFinite(Number(cost.cost_usd_this_run))) {
    const label = cost.active_full_run ? 'this run' : 'last run';
    const parts = [`spend ${fmt(cost.cost_usd_this_run)} · ${label}`];
    const today = Number(cost.cost_usd_today);
    const run = Number(cost.cost_usd_this_run);
    // OpenAI Usage day bars include cancelled restarts; show today when it is meaningfully higher.
    if (Number.isFinite(today) && today > run + 0.005) {
      parts.push(`${fmt(today)} today`);
    }
    return parts.join(' · ');
  }
  const today = Number(cost.cost_usd_today);
  if (Number.isFinite(today) && today > 0) {
    return `spend ${fmt(today)} · today`;
  }
  return `spend ${fmt(cost.cost_usd_30d)} · last 30d`;
}

export function friendlyIndexError(error?: string | null, message?: string | null): string | null {
  const code = String(error || '').trim();
  const msg = String(message || '').trim();
  const raw = msg || code;
  if (!raw) return null;
  if (code === 'index_stopped_use_resume') {
    return (
      message ||
      'Index is stopped with a checkpoint — use Continue (same run), not a new Build.'
    );
  }
  if (/EMAXCONNSESSION|max clients reached|open slot in the pool|Connection terminated unexpectedly/i.test(raw)) {
    return `Postgres session pooler busy or dropped — ${raw.slice(0, 180)}`;
  }
  if (code === 'newer_run_in_progress') {
    return (
      message ||
      'A newer index run is already active for this repo — Continue will not cancel it.'
    );
  }
  return raw;
}
