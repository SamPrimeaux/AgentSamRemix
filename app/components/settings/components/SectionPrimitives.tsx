import React from 'react';
import { AlertCircle, AlertTriangle, Info, Loader2 } from 'lucide-react';

export type SettingsWarning = {
  code: string;
  message: string;
  severity: 'info' | 'warn' | 'critical';
  table?: string;
  provider?: string;
  suggestedAction?: string;
};

export type SettingsAction = {
  key: string;
  label: string;
  enabled: boolean;
  reasonDisabled?: string;
};

export type ProviderConnectionState = {
  provider: string;
  status:
    | 'connected'
    | 'not_connected'
    | 'degraded'
    | 'missing_config'
    | 'error'
    | 'unknown'
    | string;
  accountLabel?: string | null;
  resourceLabel?: string | null;
  lastCheckedAt?: string | number | null;
  capabilities?: string[];
  warnings?: SettingsWarning[];
};

export type SettingsResponse<T = unknown> = {
  ok: boolean;
  generated_at: number;
  section: string;
  summary: Record<string, unknown>;
  rows: T[];
  warnings: SettingsWarning[];
  actions?: SettingsAction[];
  providers?: ProviderConnectionState[];
  extra?: Record<string, unknown>;
};

export function SectionHeader({
  title,
  description,
  right,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h2 className="text-[13px] font-bold text-[var(--text-heading)] uppercase tracking-widest">
          {title}
        </h2>
        {description ? (
          <p className="text-[11px] text-muted mt-1 max-w-2xl">{description}</p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function SummaryGrid({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode; hint?: string }>;
}) {
  if (!items?.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2.5"
        >
          <div className="text-[10px] uppercase tracking-widest text-muted font-semibold">
            {it.label}
          </div>
          <div className="mt-1 text-[14px] font-semibold text-main truncate">
            {it.value}
          </div>
          {it.hint ? (
            <div className="mt-0.5 text-[10px] text-muted font-mono truncate">
              {it.hint}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function severityIcon(s: SettingsWarning['severity']) {
  if (s === 'critical') return <AlertCircle size={13} />;
  if (s === 'warn') return <AlertTriangle size={13} />;
  return <Info size={13} />;
}

function severityClass(s: SettingsWarning['severity']) {
  if (s === 'critical')
    return 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 text-[var(--color-danger)]';
  if (s === 'warn')
    return 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5 text-[var(--color-warning)]';
  return 'border-[var(--border-subtle)] bg-[var(--bg-app)] text-muted';
}

export function WarningStrip({ warnings }: { warnings: SettingsWarning[] }) {
  if (!warnings?.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {warnings.map((w, i) => (
        <div
          key={`${w.code}_${i}`}
          className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] ${severityClass(w.severity)}`}
        >
          <span className="mt-[1px] shrink-0">{severityIcon(w.severity)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="font-mono text-[10px] uppercase tracking-wider opacity-80">
                {w.code}
              </span>
              {w.table ? (
                <span className="font-mono text-[10px] opacity-70">table: {w.table}</span>
              ) : null}
              {w.provider ? (
                <span className="font-mono text-[10px] opacity-70">provider: {w.provider}</span>
              ) : null}
            </div>
            <div className="mt-0.5 text-main">{w.message}</div>
            {w.suggestedAction ? (
              <div className="mt-0.5 text-[10px] opacity-80">{w.suggestedAction}</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatusBadge({
  status,
}: {
  status: ProviderConnectionState['status'];
}) {
  const s = String(status || '').toLowerCase();
  let cls =
    'border-[var(--border-subtle)] bg-[var(--bg-app)] text-muted';
  let label = s || 'unknown';
  if (s === 'connected') {
    cls =
      'border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]';
  } else if (s === 'degraded') {
    cls =
      'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]';
  } else if (s === 'error' || s === 'failed') {
    cls = 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]';
  } else if (s === 'missing_config') {
    cls =
      'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]';
    label = 'Missing config';
  } else if (s === 'not_connected') {
    label = 'Not connected';
  }
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border ${cls}`}
    >
      {label}
    </span>
  );
}

function providerLabel(slug: string) {
  const s = String(slug || '').toLowerCase();
  const map: Record<string, string> = {
    cloudflare: 'Cloudflare',
    supabase: 'Supabase',
    google_drive: 'Google Drive',
    google_ai: 'Google AI',
    google: 'Google',
    github: 'GitHub',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    workers_ai: 'Workers AI',
    resend: 'Resend',
    local: 'Local',
  };
  return map[s] || (slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'Other');
}

export function ProviderCard({ p }: { p: ProviderConnectionState }) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold text-main truncate">
          {providerLabel(p.provider)}
        </div>
        <StatusBadge status={p.status} />
      </div>
      <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-muted">
        {p.accountLabel ? <div className="truncate">Account: {p.accountLabel}</div> : null}
        {p.resourceLabel ? <div className="truncate">{p.resourceLabel}</div> : null}
        {p.capabilities && p.capabilities.length ? (
          <div className="flex flex-wrap gap-1 mt-1">
            {p.capabilities.map((c) => (
              <span
                key={c}
                className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-app)] font-mono text-muted"
              >
                {c}
              </span>
            ))}
          </div>
        ) : null}
        {p.warnings && p.warnings.length ? (
          <div className="mt-2">
            <WarningStrip warnings={p.warnings} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ActionButton({
  action,
  onClick,
  variant = 'default',
}: {
  action: SettingsAction;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger';
}) {
  const base = 'text-[11px] px-3 py-1.5 rounded-lg border transition-colors';
  let cls = `${base} border-[var(--border-subtle)] text-main hover:bg-[var(--bg-hover)]`;
  if (variant === 'primary') {
    cls = `${base} border-[var(--solar-cyan)]/50 text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/10`;
  } else if (variant === 'danger') {
    cls = `${base} border-[var(--color-danger)]/40 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10`;
  }
  return (
    <button
      type="button"
      title={action.enabled ? action.label : action.reasonDisabled || 'Disabled'}
      disabled={!action.enabled}
      onClick={onClick}
      className={`${cls} disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {action.label}
    </button>
  );
}

export function ActionRow({
  actions,
  onAction,
}: {
  actions?: SettingsAction[];
  onAction?: (key: string) => void;
}) {
  if (!actions?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {actions.map((a) => (
        <div key={a.key} className="flex items-center gap-2">
          <ActionButton action={a} onClick={() => (a.enabled ? onAction?.(a.key) : undefined)} />
          {!a.enabled && a.reasonDisabled ? (
            <span className="text-[10px] text-muted italic">
              {a.reasonDisabled}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-6 text-[11px] text-muted text-center">
      {message}
    </div>
  );
}

export function LoadingRow({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-[11px] text-muted">
      <Loader2 size={12} className="animate-spin" />
      {label}
    </div>
  );
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  emptyMessage,
}: {
  columns: Array<{ key: string; label: string; render?: (row: T) => React.ReactNode; widthClass?: string }>;
  rows: T[];
  emptyMessage: string;
}) {
  if (!rows?.length) return <EmptyState message={emptyMessage} />;
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-panel)]">
      <div className="grid gap-0 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-muted border-b border-[var(--border-subtle)] bg-[var(--bg-app)]"
        style={{ gridTemplateColumns: columns.map((c) => c.widthClass || '1fr').join(' ') }}
      >
        {columns.map((c) => (
          <div key={c.key} className="px-1 truncate">
            {c.label}
          </div>
        ))}
      </div>
      {rows.map((row, i) => (
        <div
          key={i}
          className="grid gap-0 px-3 py-2 border-b border-[var(--border-subtle)] text-[11px] items-center"
          style={{ gridTemplateColumns: columns.map((c) => c.widthClass || '1fr').join(' ') }}
        >
          {columns.map((c) => (
            <div key={c.key} className="px-1 truncate text-main">
              {c.render
                ? c.render(row)
                : row[c.key] != null
                  ? String(row[c.key])
                  : '—'}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function formatRelativeFromValue(input: string | number | null | undefined): string {
  if (input == null || input === '') return '—';
  let t: number;
  if (typeof input === 'number') {
    t = input < 1e12 ? input * 1000 : input;
  } else {
    const parsed = Date.parse(String(input));
    if (Number.isFinite(parsed)) {
      t = parsed;
    } else {
      const n = Number(input);
      if (!Number.isFinite(n)) return '—';
      t = n < 1e12 ? n * 1000 : n;
    }
  }
  if (!Number.isFinite(t)) return '—';
  const diff = Math.round((Date.now() - t) / 1000);
  const abs = Math.abs(diff);
  const fmt = (n: number, unit: string) => `${n}${unit}${diff >= 0 ? ' ago' : ''}`;
  if (abs < 60) return fmt(abs, 's');
  const m = Math.round(abs / 60);
  if (m < 60) return fmt(m, 'm');
  const h = Math.round(m / 60);
  if (h < 48) return fmt(h, 'h');
  const days = Math.round(h / 24);
  if (days < 14) return fmt(days, 'd');
  const weeks = Math.round(days / 7);
  return fmt(weeks, 'w');
}

export function RelTime({ value }: { value: string | number | null | undefined }) {
  return <span className="text-muted">{formatRelativeFromValue(value)}</span>;
}
