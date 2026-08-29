import React from 'react';
import Editor from '@monaco-editor/react';
import type { SettingsPanelModel } from '../hooks/useSettingsData';
import { Toggle } from '../settingsUi';

export type RulesSkillsDrawersProps = {
  data: SettingsPanelModel;
};

export function RulesSkillsDrawers({ data }: RulesSkillsDrawersProps) {
  return (
    <>
      {data.skillDrawerOpen && (
        <div className="fixed inset-0 z-[250]">
          <div
            className="absolute inset-0 bg-[var(--text-main)]/40"
            onClick={() => data.setSkillDrawerOpen(false)}
            onKeyDown={(e) => e.key === 'Escape' && data.setSkillDrawerOpen(false)}
            role="presentation"
          />
          <div className="absolute top-0 right-0 h-full w-[480px] max-w-[92vw] bg-[var(--bg-panel)] border-l border-[var(--border-subtle)] shadow-2xl flex flex-col">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <div className="text-[12px] font-semibold text-[var(--text-heading)]">
                {data.editingSkill ? 'Edit Skill' : 'New Skill'}
              </div>
              <button
                type="button"
                className="text-[11px] text-muted"
                onClick={() => data.setSkillDrawerOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="p-4 flex-1 overflow-auto custom-scrollbar space-y-3">
              <label className="flex flex-col gap-1 text-[11px]">
                <span className="text-muted">Name</span>
                <input
                  value={data.skillDraft.name || ''}
                  onChange={(e) => data.setSkillDraft((p: any) => ({ ...p, name: e.target.value }))}
                  className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px]">
                <span className="text-muted">Description</span>
                <textarea
                  rows={3}
                  value={data.skillDraft.description || ''}
                  onChange={(e) => data.setSkillDraft((p: any) => ({ ...p, description: e.target.value }))}
                  className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px]"
                />
              </label>
              <div className="text-[11px] text-muted">Content (markdown)</div>
              <div className="rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-app)]">
                <Editor
                  height="300px"
                  defaultLanguage="markdown"
                  theme="vs-dark"
                  value={data.skillDraft.content_markdown || ''}
                  onChange={(v) => data.setSkillDraft((p: any) => ({ ...p, content_markdown: v || '' }))}
                  options={{ minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false }}
                />
              </div>
              <label className="flex flex-col gap-1 text-[11px]">
                <span className="text-muted">Slash trigger</span>
                <input
                  placeholder="/myskill"
                  value={data.skillDraft.slash_trigger || ''}
                  onChange={(e) => data.setSkillDraft((p: any) => ({ ...p, slash_trigger: e.target.value }))}
                  className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px] font-mono"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px]">
                <span className="text-muted">Globs</span>
                <input
                  placeholder="**/*.ts"
                  value={data.skillDraft.globs || ''}
                  onChange={(e) => data.setSkillDraft((p: any) => ({ ...p, globs: e.target.value }))}
                  className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px] font-mono"
                />
              </label>
              <div className="flex items-center justify-between py-2">
                <div className="text-[11px] text-muted">Always apply</div>
                <Toggle
                  on={!!data.skillDraft.always_apply}
                  onChange={(v) => data.setSkillDraft((p: any) => ({ ...p, always_apply: v }))}
                />
              </div>
              <label className="flex flex-col gap-1 text-[11px]">
                <span className="text-muted">Tags</span>
                <input
                  placeholder="tag1,tag2"
                  value={data.skillDraft.tags || ''}
                  onChange={(e) => data.setSkillDraft((p: any) => ({ ...p, tags: e.target.value }))}
                  className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px]"
                />
              </label>
            </div>
            <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2 bg-[var(--bg-app)]">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[11px] text-muted"
                onClick={() => data.setSkillDrawerOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30"
                onClick={() => void data.saveSkillDrawer()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {data.ruleDrawerOpen && (
        <div className="fixed inset-0 z-[250]">
          <div
            className="absolute inset-0 bg-[var(--text-main)]/40"
            onClick={() => data.setRuleDrawerOpen(false)}
            onKeyDown={(e) => e.key === 'Escape' && data.setRuleDrawerOpen(false)}
            role="presentation"
          />
          <div className="absolute top-0 right-0 h-full w-[520px] max-w-[94vw] bg-[var(--bg-panel)] border-l border-[var(--border-subtle)] shadow-2xl flex flex-col">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold text-[var(--text-heading)]">
                  {data.ruleDraft?.id ? 'Edit rule' : 'New rule'}
                </div>
                <div className="text-[10px] text-muted mt-0.5">
                  Injected into Agent Sam as ## Rules on chat (unless set to Manual).
                </div>
              </div>
              <button
                type="button"
                className="text-[11px] text-muted"
                onClick={() => data.setRuleDrawerOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="p-4 flex-1 overflow-auto custom-scrollbar space-y-3">
              <label className="flex flex-col gap-1 text-[11px]">
                <span className="text-muted">Title</span>
                <input
                  value={data.ruleDraft.title || ''}
                  onChange={(e) => data.setRuleDraft((p: any) => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. deploy-safety"
                  className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px] font-mono"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-[11px]">
                  <span className="text-muted">Apply</span>
                  <select
                    value={data.ruleDraft.apply_mode || 'always'}
                    onChange={(e) =>
                      data.setRuleDraft((p: any) => ({ ...p, apply_mode: e.target.value }))
                    }
                    className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px]"
                  >
                    <option value="always">Always</option>
                    <option value="glob">By file path (glob)</option>
                    <option value="manual">Manual only</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px]">
                  <span className="text-muted">Globs (when Apply = glob)</span>
                  <input
                    value={data.ruleDraft.globs || ''}
                    onChange={(e) => data.setRuleDraft((p: any) => ({ ...p, globs: e.target.value }))}
                    placeholder="scripts/**/*.py, app/dashboard/**"
                    disabled={(data.ruleDraft.apply_mode || 'always') !== 'glob'}
                    className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px] font-mono disabled:opacity-40"
                  />
                </label>
              </div>
              <div className="text-[11px] text-muted">Rule body (markdown)</div>
              <div className="rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-app)] min-h-[280px]">
                <Editor
                  height="320px"
                  defaultLanguage="markdown"
                  theme="vs-dark"
                  value={data.ruleDraft.body_markdown || ''}
                  onChange={(v) =>
                    data.setRuleDraft((p: any) => ({ ...p, body_markdown: v || '' }))
                  }
                  options={{ minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false }}
                />
              </div>
            </div>
            <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2 bg-[var(--bg-app)]">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[11px] text-muted"
                onClick={() => data.setRuleDrawerOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30"
                onClick={() => void data.saveRuleDrawer()}
              >
                Save rule
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
