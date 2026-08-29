import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { SettingsPanelModel } from '../hooks/useSettingsData';
import type { AgentsamUserPolicy } from '../types';
import { AllowlistChipInput } from './AllowlistChipInput';
import {
  McpToolPreferenceControl,
  type McpToolPreference,
} from '../../mcp/McpToolPreferenceControl';

export type AgentsAllowlistsProps = {
  data: SettingsPanelModel;
  workspaceId?: string | null;
  policy: AgentsamUserPolicy | null;
  onPolicyChange: (patch: Partial<AgentsamUserPolicy>) => void;
};

function SubsectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
      {children}
    </div>
  );
}

function AllowlistAccordion({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-[var(--bg-hover)]/40 transition-colors"
        aria-expanded={open}
      >
        <ChevronRight
          size={14}
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <span className="text-[12px] font-semibold text-main">{title}</span>
        <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[var(--bg-app)] border border-[var(--border-subtle)] text-muted">
          {count}
        </span>
      </button>
      {open ? <div className="px-4 pb-4 pt-1 border-t border-[var(--border-subtle)]/60">{children}</div> : null}
    </div>
  );
}

export function AgentsAllowlists({ data, workspaceId, policy, onPolicyChange }: AgentsAllowlistsProps) {
  const ws = data.agentsWorkspaceId || workspaceId || '';
  const groups = data.agentsMcpGroups || [];
  const prefs = data.agentsMcpGroupPrefs || {};
  const disabled = data.agentsSaving || data.agentsLoading;
  const mcpKeys = data.agentsMcp.map((t) => t.tool_key);

  const mcpCount =
    mcpKeys.length > 0
      ? mcpKeys.length
      : groups.reduce((n, g) => n + (g.tools?.length ?? 0), 0);

  const setGroupPref = (groupKey: string, value: McpToolPreference) => {
    const next = { ...prefs, [groupKey]: value };
    data.setAgentsMcpGroupPrefs(next);
    void data.saveAgentsMcpGroupPreferences(next);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <SubsectionLabel>Run mode</SubsectionLabel>
        <select
          value={policy?.auto_run_mode || 'allowlist'}
          disabled={!policy || disabled}
          onChange={(e) => onPolicyChange({ auto_run_mode: e.target.value })}
          className="max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2 text-[12px] text-main disabled:opacity-40"
        >
          <option value="allowlist">Allowlist (auto-run granted tools)</option>
          <option value="manual">Auto-review (always confirm)</option>
        </select>
        <p className="text-[10px] text-muted">
          Allowlist = ask unless the tool or command is on your grant list (MCP allowlist + Always Run
          patterns). Auto-review = always confirm when the catalog requires approval.
        </p>
      </div>

      <AllowlistAccordion title="Command allowlist (Always Run patterns)" count={data.agentsCommands.length}>
        <AllowlistChipInput
          hideLabel
          placeholder="e.g. git status"
          items={data.agentsCommands}
          inputValue={data.newCommand}
          onInputChange={data.setNewCommand}
          onAdd={() => void data.addAgentsCommand()}
          onRemove={(c) => void data.removeAgentsCommand(c)}
          onAddBulk={(cmds) => data.addAgentsCommandsBulk(cmds)}
          existingCommands={data.agentsCommands}
          workspaceId={ws}
          showSuggestions
          disabled={disabled}
        />
      </AllowlistAccordion>

      <AllowlistAccordion title="MCP allowlist" count={mcpCount}>
        <AllowlistChipInput
          hideLabel
          hint="Format: server:tool · server:* · *:tool · *:*"
          placeholder="e.g. inneranimalmedia:d1_query"
          items={mcpKeys}
          inputValue={data.newToolKey}
          onInputChange={data.setNewToolKey}
          onAdd={() => void data.addAgentsMcp()}
          onRemove={(key) => void data.removeAgentsMcp(key)}
          disabled={disabled}
        />
        {groups.length > 0 ? (
          <details className="mt-4 rounded-lg border border-[var(--border-subtle)]/60 bg-[var(--bg-panel)]/40 p-3">
            <summary className="cursor-pointer text-[11px] font-semibold text-main">
              OAuth MCP tool permissions ({groups.length} groups)
            </summary>
            <p className="text-[10px] text-muted mt-2 mb-3 leading-relaxed">
              Per-group access for OAuth MCP clients. Changes apply on the next connection without
              reconnecting.
            </p>
            <div className="space-y-2">
              {groups.map((g) => (
                <div
                  key={g.group_key}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border border-[var(--border-subtle)] rounded-lg px-2.5 py-2 bg-[var(--bg-panel)]"
                >
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-main truncate">
                      {g.label}
                    </div>
                    <div className="text-[10px] text-muted">
                      {g.tools.length} tools
                      {g.read_count > 0 ? ` · ${g.read_count} read` : ''}
                      {g.write_count > 0 ? ` · ${g.write_count} write` : ''}
                    </div>
                  </div>
                  <McpToolPreferenceControl
                    compact
                    value={(prefs[g.group_key] as McpToolPreference) || 'deny'}
                    onChange={(v) => setGroupPref(g.group_key, v)}
                    disabled={disabled}
                  />
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </AllowlistAccordion>

      <AllowlistAccordion title="Fetch domain allowlist" count={data.agentsDomains.length}>
        <AllowlistChipInput
          hideLabel
          hint="Format: example.com or *.example.com"
          placeholder="e.g. example.com"
          items={data.agentsDomains}
          inputValue={data.newDomain}
          onInputChange={data.setNewDomain}
          onAdd={() => void data.addAgentsDomain()}
          onRemove={(h) => void data.removeAgentsDomain(h)}
          disabled={disabled}
        />
      </AllowlistAccordion>

      <p className="text-[10px] text-muted">
        Workspace scope: <code className="font-mono text-[var(--solar-cyan)]">{ws || '—'}</code>.
        Allowlists save immediately when you add or remove items.
      </p>
    </div>
  );
}
