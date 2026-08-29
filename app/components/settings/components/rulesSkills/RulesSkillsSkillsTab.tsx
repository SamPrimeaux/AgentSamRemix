import React from 'react';
import type { SettingsPanelModel } from '../../hooks/useSettingsData';
import { Toggle, relativeTime } from '../../settingsUi';

export function RulesSkillsSkillsTab({ data }: { data: SettingsPanelModel }) {
  return (
    <>
      {data.skillsError ? (
        <div className="text-[11px] text-[var(--color-danger)]">{data.skillsError}</div>
      ) : null}
      {data.skillsLoading ? (
        <div className="text-[12px] text-muted">Loading skills…</div>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {data.skills.map((skill) => (
          <div
            key={String(skill.id)}
            className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] flex items-center justify-center text-[12px] font-bold text-[var(--solar-cyan)]">
                    {String(skill.icon || String(skill.name || '?')[0] || '?')
                      .toUpperCase()
                      .slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-main truncate">
                      {String(skill.name || '')}
                    </div>
                    <div className="text-[10px] text-muted truncate">
                      {String(skill.description || '').slice(0, 80)}
                      {String(skill.description || '').length > 80 ? '…' : ''}
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-muted mt-2 flex items-center gap-2">
                  {Number(skill.invocation_count || 0) > 0 ? (
                    <span>{Number(skill.invocation_count)} uses</span>
                  ) : null}
                  {skill.last_used ? <span>{relativeTime(skill.last_used)}</span> : null}
                </div>
              </div>
              <Toggle
                on={!!Number(skill.is_active ?? 1)}
                onChange={(v) => {
                  const prev = data.skills;
                  data.setSkills((p) =>
                    p.map((s) => (String(s.id) === String(skill.id) ? { ...s, is_active: v ? 1 : 0 } : s)),
                  );
                  void data.patchSkillActive(String(skill.id), v, prev);
                }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  data.setEditingSkill(skill);
                  data.setSkillDraft({
                    name: skill.name || '',
                    description: skill.description || '',
                    content_markdown: skill.content_markdown || '',
                    slash_trigger: skill.slash_trigger || '',
                    globs: skill.globs || '',
                    always_apply: !!Number(skill.always_apply || 0),
                    tags: skill.tags || '',
                  });
                  data.setSkillDrawerOpen(true);
                }}
                className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[11px] text-muted hover:text-main"
              >
                Edit
              </button>
              <code className="text-[10px] text-muted font-mono truncate">
                {String(skill.slash_trigger || '')}
              </code>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
