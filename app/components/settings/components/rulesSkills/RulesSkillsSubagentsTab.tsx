import React from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { SettingsPanelModel } from '../../hooks/useSettingsData';
import { Toggle } from '../../settingsUi';
import { RulesSkillsEmpty, RulesSkillsIntro } from './rulesSkillsUi';
import { RulesSkillsSubagentInlineEditor } from './RulesSkillsSubagentInlineEditor';

export function RulesSkillsSubagentsTab({ data }: { data: SettingsPanelModel }) {
  const activeCount = (data.subagents || []).filter((sa) => Number(sa.is_active ?? 1) === 1).length;
  const configuring = Boolean(data.editingSubagentId);

  return (
    <div className="flex flex-col gap-4">
      <RulesSkillsIntro tab="subagents" />

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => data.startCreateSubagentViaChat()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[11px] text-muted hover:text-main"
          title="Compose /create-subagent in chat"
        >
          Via chat
        </button>
        <button
          type="button"
          onClick={() => data.startCreateSubagent()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30"
        >
          <Plus size={14} /> New subagent
        </button>
      </div>

      {data.subagentsError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[12px] text-red-200">
          {data.subagentsError}
        </div>
      ) : null}

      {data.subagentsLoading ? (
        <div className="text-[12px] text-muted animate-pulse">Loading subagents…</div>
      ) : null}

      {!data.subagentsLoading && !data.subagentsError && (data.subagents || []).length === 0 && !configuring ? (
        <RulesSkillsEmpty
          message="No custom subagents for this workspace yet. Create one here — full CRUD, no chat required."
          action={
            <button
              type="button"
              onClick={() => data.startCreateSubagent()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30"
            >
              <Plus size={14} /> New subagent
            </button>
          }
        />
      ) : null}

      {!data.subagentsLoading && (data.subagents || []).length > 0 ? (
        <>
          <div className="flex items-center justify-between text-[10px] text-muted uppercase tracking-wider">
            <span>
              {activeCount} active · {(data.subagents || []).length} total
            </span>
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] overflow-hidden divide-y divide-[var(--border-subtle)]">
            {(data.subagents || []).map((sa) => {
              const id = String(sa.id);
              const isEditing = data.editingSubagentId === id;
              return (
                <div
                  key={id}
                  className={`group flex items-center gap-3 px-4 py-3 transition-colors ${
                    isEditing ? 'bg-[var(--bg-hover)]/60' : 'hover:bg-[var(--bg-hover)]/40'
                  }`}
                >
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left flex items-center gap-3"
                    onClick={() => data.openEditSubagent(sa)}
                  >
                    <div className="w-8 h-8 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] flex items-center justify-center shrink-0 text-[12px] font-bold text-[var(--solar-cyan)]">
                      {String(sa.display_name || sa.id || '?')[0]?.toUpperCase?.() || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-semibold text-main truncate">
                        {String(sa.display_name || sa.id || '')}
                      </div>
                      <div className="text-[10px] text-muted truncate font-mono">
                        {String(sa.slug || '')}
                        {sa.description ? ` · ${String(sa.description)}` : ''}
                      </div>
                    </div>
                    <ChevronRight
                      size={14}
                      className={`shrink-0 text-muted transition-transform ${
                        isEditing ? 'rotate-90 text-[var(--solar-cyan)]' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    />
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[9px] px-2 py-0.5 rounded bg-[var(--bg-app)] border border-[var(--border-subtle)] text-muted font-black uppercase tracking-widest hidden sm:inline">
                      {String(sa.agent_type || 'custom')}
                    </span>
                    <Toggle
                      on={!!Number(sa.is_active ?? 1)}
                      onChange={(v) => {
                        const prev = data.subagents;
                        data.setSubagents((p) =>
                          p.map((x) => (String(x.id) === id ? { ...x, is_active: v ? 1 : 0 } : x)),
                        );
                        void data.patchSubagentActive(id, v, prev);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => data.openEditSubagent(sa)}
                      className={`px-3 py-1.5 rounded-lg border text-[11px] ${
                        isEditing
                          ? 'border-[var(--solar-cyan)]/40 text-[var(--solar-cyan)] bg-[var(--solar-cyan)]/10'
                          : 'border-[var(--border-subtle)] text-muted hover:text-main'
                      }`}
                    >
                      {isEditing ? 'Configuring' : 'Configure'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      <RulesSkillsSubagentInlineEditor data={data} />
    </div>
  );
}
