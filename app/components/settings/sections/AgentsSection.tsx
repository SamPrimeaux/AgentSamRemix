import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { IAM_AGENT_CHAT_COMPOSE } from '../../../agentChatConstants';
import type { AgentsamUserPolicy } from '../types';
import type { SettingsPanelModel } from '../hooks/useSettingsData';
import { Toggle } from '../settingsUi';
import { AgentsAllowlists } from '../components/AgentsAllowlists';
import { AllowlistChipInput } from '../components/AllowlistChipInput';
import {
  applyTextSizeToDom,
  joinVoiceKeywords,
  mergePolicySettingsJson,
  parsePolicySettingsJson,
  splitVoiceKeywords,
} from '../components/agentsSectionHelpers';

export type AgentsSectionProps = { data: SettingsPanelModel; workspaceId?: string | null };

const SUBAGENT_SETUP_COMPOSE_MESSAGE = '/create-subagent';

function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)]/80 p-5 flex flex-col gap-4">
      <div className="border-b border-[var(--border-subtle)]/60 pb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] text-muted">{children}</span>;
}

function ToggleRow({
  label,
  desc,
  on,
  onChange,
  disabled,
}: {
  label: string;
  desc?: string;
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-[var(--border-subtle)]/40 last:border-0">
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-main">{label}</div>
        {desc ? <div className="text-[11px] text-muted mt-0.5">{desc}</div> : null}
      </div>
      <DisabledToggleWrap disabled={disabled}>
        <Toggle on={on} onChange={onChange} />
      </DisabledToggleWrap>
    </div>
  );
}

function DisabledToggleWrap({ disabled, children }: { disabled?: boolean; children: React.ReactNode }) {
  if (!disabled) return <>{children}</>;
  return <div className="opacity-40 pointer-events-none shrink-0">{children}</div>;
}

const selectClass =
  'rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2 text-[12px] text-main w-full disabled:opacity-40';

export function AgentsSection({ data, workspaceId }: AgentsSectionProps) {
  const navigate = useNavigate();
  const policy = data.agentsPolicy;
  const settingsJson = parsePolicySettingsJson(policy?.settings_json);
  const disabled = data.agentsSaving || data.agentsLoading;

  const [voiceKeywords, setVoiceKeywords] = useState<string[]>(() =>
    splitVoiceKeywords(policy?.voice_submit_keyword),
  );
  const [newVoiceKeyword, setNewVoiceKeyword] = useState('');

  useEffect(() => {
    setVoiceKeywords(splitVoiceKeywords(policy?.voice_submit_keyword));
  }, [policy?.voice_submit_keyword]);

  useEffect(() => {
    if (policy?.text_size) applyTextSizeToDom(policy.text_size);
  }, [policy?.text_size]);

  const patchPolicy = useCallback(
    (patch: Partial<AgentsamUserPolicy>) => {
      data.setAgentsPolicy((p) => (p ? { ...p, ...patch } : p));
    },
    [data],
  );

  const patchSettingsJson = useCallback(
    (patch: Record<string, unknown>) => {
      data.setAgentsPolicy((p) =>
        p ? { ...p, settings_json: mergePolicySettingsJson(p, patch) } : p,
      );
    },
    [data],
  );

  const composeSubagentSetupInChat = useCallback(() => {
    const message = SUBAGENT_SETUP_COMPOSE_MESSAGE;
    window.dispatchEvent(
      new CustomEvent(IAM_AGENT_CHAT_COMPOSE, {
        detail: {
          message,
          selectionStart: message.length,
          selectionEnd: message.length,
          ensureAgentPanel: true,
          send: false,
        },
      }),
    );
  }, []);

  const handleTextSizeChange = (textSize: string) => {
    patchPolicy({ text_size: textSize });
    applyTextSizeToDom(textSize);
    void fetch('/api/settings/agents/policy', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: data.agentsWorkspaceId || workspaceId || '',
        policy: { text_size: textSize },
      }),
    }).catch(() => {});
  };

  const addVoiceKeyword = () => {
    const word = newVoiceKeyword.trim().toLowerCase();
    if (!word || /\s/.test(word) || voiceKeywords.includes(word)) {
      setNewVoiceKeyword('');
      return;
    }
    const next = [...voiceKeywords, word];
    setVoiceKeywords(next);
    patchPolicy({ voice_submit_keyword: joinVoiceKeywords(next) });
    setNewVoiceKeyword('');
  };

  const removeVoiceKeyword = (word: string) => {
    const next = voiceKeywords.filter((w) => w !== word);
    setVoiceKeywords(next);
    patchPolicy({ voice_submit_keyword: joinVoiceKeywords(next) });
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-none px-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-bold text-[var(--text-heading)] uppercase tracking-widest">
          Agents
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={data.agentsLoading}
            onClick={() => void data.loadAgentsSettings(workspaceId)}
            className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[11px] text-muted hover:text-main disabled:opacity-40"
          >
            Refresh
          </button>
          <button
            type="button"
            disabled={data.agentsSaving || !policy}
            onClick={() => void data.saveAgentsPolicy()}
            className="px-3 py-1.5 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30 disabled:opacity-40"
          >
            {data.agentsSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {data.agentsError ? (
        <div className="text-[11px] text-[var(--color-danger)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 rounded-lg p-3">
          {data.agentsError}
        </div>
      ) : null}

      <div className="text-[11px] text-muted">
        Workspace scope:{' '}
        <code className="font-mono text-[var(--solar-cyan)]">
          {data.agentsWorkspaceId || workspaceId || '—'}
        </code>
      </div>

      {data.agentsLoading && !policy ? (
        <div className="text-[12px] text-muted">Loading…</div>
      ) : null}

      {policy ? (
        <>
          {/* Section 1: Agents */}
          <SectionCard title="Agents">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <FieldLabel>Text size</FieldLabel>
                <select
                  value={policy.text_size || 'default'}
                  disabled={disabled}
                  onChange={(e) => handleTextSizeChange(e.target.value)}
                  className={selectClass}
                >
                  <option value="small">Small</option>
                  <option value="default">Default</option>
                  <option value="large">Large</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel>Max tab count</FieldLabel>
                <input
                  type="number"
                  min={1}
                  max={50}
                  disabled={disabled}
                  value={policy.max_tab_count}
                  onChange={(e) =>
                    patchPolicy({ max_tab_count: Number(e.target.value || 0) })
                  }
                  className={selectClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel>Queue messages</FieldLabel>
                <select
                  value={policy.queue_messages_mode || 'after_current'}
                  disabled={disabled}
                  onChange={(e) => patchPolicy({ queue_messages_mode: e.target.value })}
                  className={selectClass}
                >
                  <option value="after_current">After current</option>
                  <option value="immediately">Immediately</option>
                  <option value="never">Never</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel>Usage summary</FieldLabel>
                <select
                  value={policy.usage_summary_mode || 'auto'}
                  disabled={disabled}
                  onChange={(e) => patchPolicy({ usage_summary_mode: e.target.value })}
                  className={selectClass}
                >
                  <option value="auto">Auto</option>
                  <option value="always">Always</option>
                  <option value="off">Off</option>
                </select>
              </label>
            </div>
            <div className="flex flex-col">
              <ToggleRow
                label="Agent autocomplete"
                desc="Autocomplete suggestions from the agent"
                on={Number(policy.agent_autocomplete) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ agent_autocomplete: v ? 1 : 0 })}
              />
              <ToggleRow
                label="Auto-approve mode transitions"
                desc="Allow Agent Sam to switch modes without asking each time"
                on={Boolean(settingsJson.auto_approve_mode_transitions)}
                disabled={disabled}
                onChange={(v) => patchSettingsJson({ auto_approve_mode_transitions: v })}
              />
            </div>
          </SectionCard>

          {/* Section 2: Subagents */}
          <SectionCard
            title="Subagents"
            action={
              <button
                type="button"
                onClick={composeSubagentSetupInChat}
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-[var(--solar-cyan)] hover:border-[var(--solar-cyan)]/40 transition-colors"
                title="Create subagent via chat"
                aria-label="Create subagent via chat"
              >
                <Plus size={14} aria-hidden />
              </button>
            }
          >
            {Array.isArray(data.agentsSubagents) && data.agentsSubagents.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="text-muted uppercase tracking-wider border-b border-[var(--border-subtle)]">
                      <th className="py-2 pr-2">Active</th>
                      <th className="py-2 pr-2">Slug</th>
                      <th className="py-2 pr-2">Name</th>
                      <th className="py-2 pr-2">Model</th>
                      <th className="py-2 pr-2">Sandbox</th>
                      <th className="py-2">Configure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.agentsSubagents.map((row) => {
                      const id = String(row.id || '').trim();
                      const slug = String(row.slug || '').trim();
                      const on = Number(row.is_active) !== 0;
                      return (
                        <tr key={id || slug} className="border-b border-[var(--border-subtle)]/40">
                          <td className="py-2 pr-2 align-middle">
                            <Toggle
                              on={on}
                              onChange={(v) => {
                                if (!id) return;
                                void data.patchAgentsSubagent(id, { is_active: v }).catch(() => {});
                              }}
                            />
                          </td>
                          <td className="py-2 pr-2 font-mono text-[var(--solar-cyan)]">
                            {slug || '—'}
                          </td>
                          <td className="py-2 pr-2">{String(row.display_name || '')}</td>
                          <td className="py-2 pr-2 font-mono text-muted">
                            {String(row.default_model_id || '—')}
                          </td>
                          <td className="py-2 pr-2 text-muted">
                            {String(row.sandbox_mode ?? row.access_mode ?? '—')}
                          </td>
                          <td className="py-2">
                            {id || slug ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const qp = new URLSearchParams({ tab: 'subagents' });
                                  if (id) qp.set('id', id);
                                  else if (slug) qp.set('slug', slug);
                                  navigate(`/dashboard/settings/rules?${qp.toString()}`);
                                }}
                                className="px-2 py-1 rounded-md border border-[var(--border-subtle)] text-[10px] font-semibold uppercase tracking-wide text-[var(--solar-cyan)] hover:bg-[var(--bg-hover)]"
                              >
                                Configure
                              </button>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-[12px] text-muted">No subagent profiles yet.</div>
            )}
          </SectionCard>

          {/* Section 3: Agent Review */}
          <SectionCard title="Agent review">
            <div className="flex flex-col">
              <ToggleRow
                label="Start agent review on commit"
                on={Boolean(settingsJson.agent_review_on_commit)}
                disabled={disabled}
                onChange={(v) => patchSettingsJson({ agent_review_on_commit: v })}
              />
              <ToggleRow
                label="Include submodules in agent review"
                on={Boolean(settingsJson.agent_review_submodules)}
                disabled={disabled}
                onChange={(v) => patchSettingsJson({ agent_review_submodules: v })}
              />
              <ToggleRow
                label="Include untracked files in agent review"
                on={Boolean(settingsJson.agent_review_untracked)}
                disabled={disabled}
                onChange={(v) => patchSettingsJson({ agent_review_untracked: v })}
              />
            </div>
            <label className="flex flex-col gap-1 max-w-md">
              <FieldLabel>Default approach</FieldLabel>
              <select
                value={settingsJson.agent_review_approach || 'quick'}
                disabled={disabled}
                onChange={(e) =>
                  patchSettingsJson({
                    agent_review_approach: e.target.value === 'deep' ? 'deep' : 'quick',
                  })
                }
                className={selectClass}
              >
                <option value="quick">Quick</option>
                <option value="deep">Deep</option>
              </select>
            </label>
          </SectionCard>

          {/* Section 4: Context */}
          <SectionCard title="Context">
            <div className="flex flex-col">
              <ToggleRow
                label="Web search tool"
                on={Number(policy.web_search_enabled) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ web_search_enabled: v ? 1 : 0 })}
              />
              <ToggleRow
                label="Auto-accept web search"
                on={Number(policy.auto_accept_web_search) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ auto_accept_web_search: v ? 1 : 0 })}
              />
              <ToggleRow
                label="Web fetch tool"
                on={Number(policy.web_fetch_enabled) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ web_fetch_enabled: v ? 1 : 0 })}
              />
              <ToggleRow
                label="Apply .agentsamignore files"
                on={Number(policy.hierarchical_ignore) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ hierarchical_ignore: v ? 1 : 0 })}
              />
            </div>
          </SectionCard>

          {/* Section 5: Approvals & Execution */}
          <SectionCard title="Approvals & execution">
            <AgentsAllowlists
              data={data}
              workspaceId={workspaceId}
              policy={policy}
              onPolicyChange={patchPolicy}
            />
          </SectionCard>

          {/* Section 6: Applying Changes */}
          <SectionCard title="Applying changes">
            <div className="flex flex-col">
              <ToggleRow
                label="Inline diffs"
                desc="Show inline diffs for edits"
                on={Number(policy.inline_diffs) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ inline_diffs: v ? 1 : 0 })}
              />
              <ToggleRow
                label="Auto format on agent finish"
                desc="Format files after agent completion"
                on={Number(policy.auto_format_on_agent_finish) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ auto_format_on_agent_finish: v ? 1 : 0 })}
              />
            </div>
          </SectionCard>

          {/* Section 7: Inline Editing & Terminal */}
          <SectionCard title="Inline editing & terminal">
            <div className="flex flex-col">
              <ToggleRow
                label="Legacy terminal tool"
                on={Number(policy.legacy_terminal_tool) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ legacy_terminal_tool: v ? 1 : 0 })}
              />
              <ToggleRow
                label="Toolbar on selection"
                on={Number(policy.toolbar_on_selection) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ toolbar_on_selection: v ? 1 : 0 })}
              />
              <ToggleRow
                label="Auto-parse links"
                on={Number(policy.auto_parse_links) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ auto_parse_links: v ? 1 : 0 })}
              />
              <ToggleRow
                label="Themed diff backgrounds"
                on={Number(policy.themed_diff_backgrounds) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ themed_diff_backgrounds: v ? 1 : 0 })}
              />
              <ToggleRow
                label="Terminal hint"
                on={Number(policy.terminal_hint) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ terminal_hint: v ? 1 : 0 })}
              />
              <ToggleRow
                label="Preview box for terminal"
                on={Number(policy.terminal_preview_box) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ terminal_preview_box: v ? 1 : 0 })}
              />
            </div>
          </SectionCard>

          {/* Section 8: Voice Mode */}
          <SectionCard title="Voice mode">
            <AllowlistChipInput
              label="Submit keywords"
              hint="Single words only — no spaces. Agent listens for these to submit voice input."
              placeholder="e.g. submit"
              items={voiceKeywords}
              inputValue={newVoiceKeyword}
              onInputChange={setNewVoiceKeyword}
              onAdd={addVoiceKeyword}
              onRemove={removeVoiceKeyword}
              disabled={disabled}
            />
          </SectionCard>

          {/* Section 9: Attribution */}
          <SectionCard title="Attribution">
            <div className="flex flex-col">
              <ToggleRow
                label="Commit attribution"
                desc="Mark Agent commits as 'Made with Agent Sam'"
                on={Number(policy.commit_attribution) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ commit_attribution: v ? 1 : 0 })}
              />
              <ToggleRow
                label="PR attribution"
                desc="Mark pull requests as made with Agent Sam"
                on={Number(policy.pr_attribution) === 1}
                disabled={disabled}
                onChange={(v) => patchPolicy({ pr_attribution: v ? 1 : 0 })}
              />
            </div>
          </SectionCard>

          {/* Section 10: Git */}
          <SectionCard title="Git">
            <label className="flex flex-col gap-1 max-w-md">
              <FieldLabel>Branch prefix</FieldLabel>
              <input
                type="text"
                disabled={disabled}
                value={String(settingsJson.branch_prefix ?? 'agentsam/')}
                placeholder="agentsam/"
                onChange={(e) => patchSettingsJson({ branch_prefix: e.target.value })}
                className={selectClass}
              />
              <span className="text-[10px] text-muted mt-1">
                Prefix for new branches created by Agent Sam (e.g., agentsam/, username/)
              </span>
            </label>
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
