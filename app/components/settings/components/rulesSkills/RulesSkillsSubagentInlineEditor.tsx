import React from 'react';
import Editor from '@monaco-editor/react';
import type { SettingsPanelModel } from '../../hooks/useSettingsData';

function globsToInput(raw: unknown): string {
  if (raw == null) return '';
  if (Array.isArray(raw)) return raw.join(', ');
  const s = String(raw).trim();
  if (!s) return '';
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.join(', ');
  } catch {
    /* plain string */
  }
  return s;
}

export function RulesSkillsSubagentInlineEditor({ data }: { data: SettingsPanelModel }) {
  const id = data.editingSubagentId;
  if (!id) return null;
  const isCreate = id === '__new__';

  return (
    <div className="rounded-2xl border border-[var(--solar-cyan)]/25 bg-[var(--bg-panel)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] text-muted uppercase tracking-wider mb-0.5">
            Rules / Subagents / {isCreate ? 'new' : String(data.subagentDraft.slug || id)}
          </div>
          <div className="text-[12px] font-semibold text-[var(--text-heading)]">
            {isCreate ? 'New subagent' : 'Configure subagent'}
          </div>
        </div>
        <button
          type="button"
          className="text-[11px] text-muted hover:text-main"
          onClick={() => data.closeSubagentEdit()}
        >
          Close
        </button>
      </div>
      <div className="p-4 space-y-3 max-h-[min(70vh,640px)] overflow-y-auto custom-scrollbar">
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-muted">Display name</span>
          <input
            value={data.subagentDraft.display_name || ''}
            onChange={(e) => data.setSubagentDraft((p: Record<string, unknown>) => ({ ...p, display_name: e.target.value }))}
            className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-muted">Slug</span>
          <input
            value={data.subagentDraft.slug || ''}
            onChange={(e) => data.setSubagentDraft((p: Record<string, unknown>) => ({ ...p, slug: e.target.value }))}
            placeholder="auto from name if empty"
            className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px] font-mono"
          />
          <span className="text-[10px] text-muted">
            Unique per workspace. Used as subagent_slug in chat and multitask lanes.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-muted">Description</span>
          <textarea
            rows={2}
            value={data.subagentDraft.description || ''}
            onChange={(e) => data.setSubagentDraft((p: Record<string, unknown>) => ({ ...p, description: e.target.value }))}
            className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px] resize-y"
          />
        </label>
        <div className="text-[11px] text-muted">Instructions (markdown)</div>
        <div className="rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-app)]">
          <Editor
            height="220px"
            defaultLanguage="markdown"
            theme="vs-dark"
            value={data.subagentDraft.instructions_markdown || ''}
            onChange={(v) =>
              data.setSubagentDraft((p: Record<string, unknown>) => ({ ...p, instructions_markdown: v || '' }))
            }
            options={{ minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false }}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-muted">Default model</span>
            <select
              value={data.subagentDraft.default_model_id || ''}
              onChange={(e) =>
                data.setSubagentDraft((p: Record<string, unknown>) => ({ ...p, default_model_id: e.target.value }))
              }
              className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px]"
            >
              <option value="">—</option>
              {data.modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-muted">Personality tone</span>
            <select
              value={data.subagentDraft.personality_tone || 'professional'}
              onChange={(e) =>
                data.setSubagentDraft((p: Record<string, unknown>) => ({ ...p, personality_tone: e.target.value }))
              }
              className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px]"
            >
              <option value="professional">professional</option>
              <option value="casual">casual</option>
              <option value="technical">technical</option>
              <option value="concise">concise</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-muted">Access mode</span>
            <select
              value={data.subagentDraft.access_mode || 'read_write'}
              onChange={(e) =>
                data.setSubagentDraft((p: Record<string, unknown>) => ({ ...p, access_mode: e.target.value }))
              }
              className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px]"
            >
              <option value="read_write">read_write</option>
              <option value="read_only">read_only</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-muted">Sandbox mode</span>
            <select
              value={data.subagentDraft.sandbox_mode || 'workspace-write'}
              onChange={(e) =>
                data.setSubagentDraft((p: Record<string, unknown>) => ({ ...p, sandbox_mode: e.target.value }))
              }
              className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px]"
            >
              <option value="workspace-write">workspace-write</option>
              <option value="workspace-read">workspace-read</option>
              <option value="read-only">read-only</option>
              <option value="isolated">isolated</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-muted">Reasoning effort</span>
            <select
              value={data.subagentDraft.model_reasoning_effort || 'medium'}
              onChange={(e) =>
                data.setSubagentDraft((p: Record<string, unknown>) => ({
                  ...p,
                  model_reasoning_effort: e.target.value,
                }))
              }
              className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px]"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-muted">Tool profile key</span>
            <input
              value={data.subagentDraft.tool_profile_key || ''}
              onChange={(e) =>
                data.setSubagentDraft((p: Record<string, unknown>) => ({ ...p, tool_profile_key: e.target.value }))
              }
              placeholder="agentsam_tool_profiles.profile_key"
              className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px] font-mono"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] sm:col-span-2">
            <span className="text-muted">Allowed tool globs</span>
            <input
              value={globsToInput(data.subagentDraft.allowed_tool_globs)}
              onChange={(e) =>
                data.setSubagentDraft((p: Record<string, unknown>) => ({
                  ...p,
                  allowed_tool_globs: e.target.value,
                }))
              }
              placeholder="d1_*, agentsam_*, fs_*"
              className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px] font-mono"
            />
          </label>
        </div>
        <div className="text-[10px] text-muted">
          Agent type:{' '}
          <span className="font-mono text-main">{String(data.subagentDraft.agent_type || 'custom')}</span>
        </div>
      </div>
      <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2 bg-[var(--bg-app)]/60">
        <div>
          {!isCreate ? (
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border border-red-500/30 text-[11px] text-red-300/90 hover:bg-red-500/10"
              onClick={() => void data.deleteSubagent(String(id))}
            >
              Delete
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[11px] text-muted"
            onClick={() => data.closeSubagentEdit()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30"
            onClick={() => void data.saveSubagentEdit()}
          >
            {isCreate ? 'Create' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
