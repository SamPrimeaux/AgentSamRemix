import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, RefreshCw, Sparkles, Zap } from 'lucide-react';

export type QuickstartTemplate = {
  id: string;
  slug: string;
  name: string;
  description: string;
  modelHint: string;
  seedMessage: string;
  /** Pins Thompson arm slice (D1 agentsam_routing_arms.task_type). */
  task_type: string;
  /** Pins agentsam_prompt_routes.route_key when present. */
  route_key: string;
  /** Quickstart workspace card slug (e.g. card-slides) for post-intake routing. */
  quickstart_card?: string;
  /** Open a companion surface when the card starts (Draw engines). */
  openSurface?: 'excalidraw' | 'wireframe' | null;
  subagentSlug?: string;
  subagentProfileId?: string | null;
};

type ApiQuickstartTemplate = {
  id: string;
  slug: string;
  name: string;
  description: string;
  model_hint: string;
  seed_message: string;
  task_type: string;
  route_key: string;
  open_surface?: 'excalidraw' | 'wireframe' | null;
  subagent_slug?: string;
  subagent_profile_id?: string | null;
  sort_order?: number;
  icon?: string;
  agent_type?: string;
};

function mapApiTemplate(row: ApiQuickstartTemplate): QuickstartTemplate {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? '',
    modelHint: row.model_hint || 'auto',
    seedMessage: row.seed_message,
    task_type: row.task_type || 'chat',
    route_key: row.route_key || 'chat',
    openSurface:
      row.open_surface === 'excalidraw' || row.open_surface === 'wireframe'
        ? row.open_surface
        : null,
    subagentSlug: row.subagent_slug ?? row.slug,
    subagentProfileId: row.subagent_profile_id ?? null,
  };
}

type Props = {
  onBack: () => void;
  onBegin: (template: QuickstartTemplate) => void;
};

export function AgentQuickstartPage({ onBack, onBegin }: Props) {
  const [templates, setTemplates] = useState<QuickstartTemplate[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [source, setSource] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');

  const loadTemplates = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      const res = await fetch('/api/agent/quickstart/templates', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        templates?: ApiQuickstartTemplate[];
        source?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const rows = Array.isArray(body.templates) ? body.templates.map(mapApiTemplate) : [];
      if (!rows.length) {
        throw new Error('No quickstart templates configured');
      }
      setTemplates(rows);
      setSource(body.source ?? '');
      setSelectedId((prev) => (rows.some((t) => t.id === prev) ? prev : rows[0].id));
      setLoadState('ready');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? templates[0],
    [templates, selectedId],
  );

  return (
    <motionSafe className="flex-1 overflow-y-auto bg-[var(--scene-bg)] py-10 px-6">
      <motionSafe className="max-w-3xl mx-auto space-y-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-[12px] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Agent home
        </button>

        <motionSafe>
          <motionSafe className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--solar-cyan)] mb-2">
            <Zap size={12} />
            Quickstart
          </motionSafe>
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--dashboard-text)]">
            What do you want to build?
          </h1>
          <p className="text-[13px] text-[var(--dashboard-muted)] mt-1 max-w-xl">
            Templates load from D1 <span className="font-mono">agentsam_subagent_profile</span> (
            <span className="font-mono">is_platform_global=1</span>). Add or edit cards in D1 — no
            dashboard deploy required.
            {source ? (
              <span className="block mt-1 text-[11px] font-mono text-[var(--solar-cyan)]/70">
                source: {source}
              </span>
            ) : null}
          </p>
        </motionSafe>

        {loadState === 'loading' ? (
          <motionSafe className="flex items-center gap-2 text-[13px] text-[var(--dashboard-muted)] py-8">
            <Loader2 size={16} className="animate-spin" />
            Loading templates…
          </motionSafe>
        ) : null}

        {loadState === 'error' ? (
          <motionSafe className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 space-y-3">
            <p className="text-[13px] text-[var(--dashboard-text)]">
              Could not load quickstart templates: {loadError}
            </p>
            <button
              type="button"
              onClick={() => void loadTemplates()}
              className="inline-flex items-center gap-2 text-[12px] text-[var(--solar-cyan)]"
            >
              <RefreshCw size={14} />
              Retry
            </button>
          </motionSafe>
        ) : null}

        {loadState === 'ready' ? (
          <motionSafe className="grid gap-3 sm:grid-cols-2">
            {templates.map((tpl) => {
              const active = tpl.id === selected?.id;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setSelectedId(tpl.id)}
                  className={`text-left rounded-2xl border p-4 transition-all ${
                    active
                      ? 'border-[var(--solar-cyan)]/50 bg-[var(--dashboard-card)] shadow-[0_0_0_1px_rgba(56,189,248,0.15)]'
                      : 'border-[var(--dashboard-border)] bg-[var(--dashboard-card)]/40 hover:bg-[var(--dashboard-card)]'
                  }`}
                >
                  <motionSafe className="text-[13px] font-semibold text-[var(--dashboard-text)]">
                    {tpl.name}
                  </motionSafe>
                  <p className="text-[11px] text-[var(--dashboard-muted)] mt-1 leading-snug">
                    {tpl.description}
                  </p>
                  <p className="text-[10px] font-mono text-[var(--solar-cyan)]/80 mt-2">{tpl.modelHint}</p>
                </button>
              );
            })}
          </motionSafe>
        ) : null}

        {loadState === 'ready' ? (
          <motionSafe className="rounded-2xl border border-[var(--dashboard-border)] bg-[var(--dashboard-card)] p-4 space-y-3">
            <label className="block text-[10px] font-black uppercase tracking-widest text-[var(--dashboard-muted)]">
              Describe your agent (optional)
            </label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Or describe your agent…"
              rows={3}
              className="w-full rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-canvas)] px-3 py-2 text-[13px] text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)]/60 resize-y min-h-[72px] focus:outline-none focus:border-[var(--solar-cyan)]/40"
            />
            {selected ? (
              <p className="text-[11px] text-[var(--dashboard-muted)]">
                Template <span className="font-mono text-[var(--solar-cyan)]">{selected.slug}</span>
                {selected.subagentSlug ? (
                  <span>
                    {' '}
                    · subagent <span className="font-mono">{selected.subagentSlug}</span>
                  </span>
                ) : null}
                {selected.subagentProfileId ? (
                  <span>
                    {' '}
                    · profile <span className="font-mono">{selected.subagentProfileId}</span>
                  </span>
                ) : null}
              </p>
            ) : null}
          </motionSafe>
        ) : null}

        {loadState === 'ready' ? (
          <motionSafe className="flex flex-wrap items-center gap-3 pb-8">
            <button
              type="button"
              disabled={!selected}
              onClick={() => {
                if (!selected) return;
                const extra = customPrompt.trim();
                const message = extra
                  ? `${selected.seedMessage}\n\nUser goal: ${extra}`
                  : selected.seedMessage;
                onBegin({ ...selected, seedMessage: message });
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--solar-cyan)]/20 border border-[var(--solar-cyan)]/40 text-[13px] font-medium text-[var(--dashboard-text)] hover:bg-[var(--solar-cyan)]/30 disabled:opacity-40 transition-colors"
            >
              <Sparkles size={16} />
              Begin in chat
              <ArrowRight size={14} />
            </button>
            <a
              href="/dashboard/settings/rules-skills"
              className="text-[12px] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] underline-offset-2 hover:underline"
            >
              Advanced: Skills &amp; subagents in Settings
            </a>
          </motionSafe>
        ) : null}
      </motionSafe>
    </motionSafe>
  );
}

function motionSafe({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={className}>{children}</div>;
}
