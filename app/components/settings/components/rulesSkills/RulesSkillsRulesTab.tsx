import React from 'react';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { SettingsPanelModel } from '../../hooks/useSettingsData';
import { Toggle } from '../../settingsUi';
import { ApplyModeBadge, RulesSkillsEmpty, RulesSkillsIntro } from './rulesSkillsUi';

export function RulesSkillsRulesTab({ data }: { data: SettingsPanelModel }) {
  const activeCount = data.rules.filter((r) => Number(r.is_active ?? 1) === 1).length;

  return (
    <div className="flex flex-col gap-4">
      <RulesSkillsIntro tab="rules" />

      {data.rulesError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[12px] text-red-200">
          {data.rulesError}
        </div>
      ) : null}

      {data.rulesLoading ? (
        <div className="text-[12px] text-muted animate-pulse">Loading rules…</div>
      ) : null}

      {!data.rulesLoading && !data.rulesError && data.rules.length === 0 ? (
        <RulesSkillsEmpty
          message="No rules yet. Add workspace guidance — like .cursorrules — for Agent Sam."
          action={
            <button
              type="button"
              onClick={() => data.openNewRuleDrawer()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30"
            >
              <Plus size={14} /> New rule
            </button>
          }
        />
      ) : null}

      {!data.rulesLoading && data.rules.length > 0 ? (
        <>
          <div className="flex items-center justify-between text-[10px] text-muted uppercase tracking-wider">
            <span>
              {activeCount} active · {data.rules.length} total
            </span>
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] overflow-hidden divide-y divide-[var(--border-subtle)]">
            {data.rules.map((r) => {
              const isGlobal =
                !r.workspace_id || String(r.workspace_id).trim() === '';
              const readOnly = r.user_id == null;
              return (
                <div
                  key={String(r.id)}
                  className="group flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)]/40 transition-colors"
                >
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left flex items-center gap-3"
                    onClick={() => data.openEditRuleDrawer(r)}
                    disabled={readOnly}
                  >
                    <div className="w-8 h-8 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] flex items-center justify-center shrink-0 text-[11px] font-bold text-muted">
                      {String(r.title || '?')[0]?.toUpperCase() || 'R'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-main truncate">
                          {String(r.title || r.id)}
                        </span>
                        {isGlobal ? (
                          <span className="text-[8px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-muted uppercase">
                            all workspaces
                          </span>
                        ) : null}
                        {readOnly ? (
                          <span className="text-[8px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-muted uppercase">
                            read-only
                          </span>
                        ) : null}
                      </div>
                      <ApplyModeBadge mode={r.apply_mode} globs={r.globs} />
                      <div className="text-[10px] text-muted mt-1 line-clamp-1 font-mono opacity-80">
                        {String(r.body_markdown || '').replace(/\s+/g, ' ').slice(0, 96)}
                        {String(r.body_markdown || '').length > 96 ? '…' : ''}
                      </div>
                    </div>
                    {!readOnly ? (
                      <ChevronRight
                        size={14}
                        className="text-muted opacity-0 group-hover:opacity-100 shrink-0"
                      />
                    ) : null}
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[9px] text-muted font-mono hidden sm:inline">
                      v{Number(r.version || 1)}
                    </span>
                    <Toggle
                      on={!!Number(r.is_active ?? 1)}
                      disabled={readOnly}
                      onChange={(v) => {
                        const prev = data.rules;
                        data.setRules((p) =>
                          p.map((x) =>
                            String(x.id) === String(r.id) ? { ...x, is_active: v ? 1 : 0 } : x,
                          ),
                        );
                        void data.patchRuleActive(String(r.id), v, prev);
                      }}
                    />
                    {!readOnly ? (
                      <button
                        type="button"
                        title="Remove rule"
                        onClick={() => void data.deleteRule(String(r.id))}
                        className="p-1.5 rounded-lg border border-transparent text-muted hover:text-red-300 hover:border-red-500/30 hover:bg-red-500/10"
                      >
                        <Trash2 size={13} />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
