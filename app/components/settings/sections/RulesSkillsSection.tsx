import React from 'react';
import type { RulesSkillsTabId } from '../hooks/useSettingsSections';
import type { SettingsPanelModel } from '../hooks/useSettingsData';
import { RulesSkillsDrawers } from '../components/RulesSkillsDrawers';
import { RulesSkillsSkillsTab } from '../components/rulesSkills/RulesSkillsSkillsTab';
import { RulesSkillsSubagentsTab } from '../components/rulesSkills/RulesSkillsSubagentsTab';
import { RulesSkillsCommandsTab } from '../components/rulesSkills/RulesSkillsCommandsTab';
import { RulesSkillsRulesTab } from '../components/rulesSkills/RulesSkillsRulesTab';
import { Plus } from 'lucide-react';

export type RulesSkillsSectionProps = {
  data: SettingsPanelModel;
  rulesSkillsTab: RulesSkillsTabId;
  setRulesSkillsTab: (t: RulesSkillsTabId) => void;
};

export function RulesSkillsSection({ data, rulesSkillsTab, setRulesSkillsTab }: RulesSkillsSectionProps) {
  const newButton =
    rulesSkillsTab === 'skills' ? (
      <button
        type="button"
        onClick={() => {
          data.setEditingSkill(null);
          data.setSkillDraft({
            name: '',
            description: '',
            content_markdown: '',
            slash_trigger: '',
            globs: '',
            always_apply: false,
            tags: '',
          });
          data.setSkillDrawerOpen(true);
        }}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30"
      >
        <Plus size={14} /> New skill
      </button>
    ) : rulesSkillsTab === 'rules' ? (
      <button
        type="button"
        onClick={() => data.openNewRuleDrawer()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30"
      >
        <Plus size={14} /> New rule
      </button>
    ) : rulesSkillsTab === 'subagents' ? (
      <button
        type="button"
        onClick={() => data.startCreateSubagentViaChat()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30"
      >
        <Plus size={14} /> New subagent
      </button>
    ) : null;

  return (
    <div className="flex flex-col gap-4 max-w-3xl w-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--text-heading)] tracking-tight">
            Rules, Skills, Subagents
          </h2>
          <p className="text-[11px] text-muted mt-1 max-w-xl leading-relaxed">
            Configure how Agent Sam behaves in this workspace — your IAM equivalent of Cursor rules, skills, and
            subagents.
          </p>
        </div>
        {newButton}
      </div>

      <div
        role="tablist"
        className="flex items-center gap-1 p-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)]/60 w-fit"
      >
        {(['rules', 'skills', 'subagents', 'commands'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={rulesSkillsTab === t}
            onClick={() => setRulesSkillsTab(t)}
            className={`px-3.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
              rulesSkillsTab === t
                ? 'bg-[var(--bg-panel)] text-[var(--text-heading)] shadow-sm border border-[var(--border-subtle)]'
                : 'text-muted hover:text-main'
            }`}
          >
            {t === 'skills'
              ? 'Skills'
              : t === 'subagents'
                ? 'Subagents'
                : t === 'commands'
                  ? 'Commands'
                  : 'Rules'}
          </button>
        ))}
      </div>

      {rulesSkillsTab === 'rules' && <RulesSkillsRulesTab data={data} />}
      {rulesSkillsTab === 'skills' && <RulesSkillsSkillsTab data={data} />}
      {rulesSkillsTab === 'subagents' && <RulesSkillsSubagentsTab data={data} />}
      {rulesSkillsTab === 'commands' && <RulesSkillsCommandsTab data={data} />}

      <RulesSkillsDrawers data={data} />
    </div>
  );
}
