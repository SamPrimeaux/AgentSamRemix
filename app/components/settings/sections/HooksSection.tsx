import React from 'react';
import type { SettingsPanelModel } from '../hooks/useSettingsData';
import { Toggle, relativeTime } from '../settingsUi';

export type HooksSectionProps = { data: SettingsPanelModel };

export function HooksSection({ data }: HooksSectionProps) {
  const hd = data.hooksData;
  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-bold text-[var(--text-heading)] uppercase tracking-widest">Hooks</h2>
        <button
          type="button"
          onClick={() => data.setNewHookOpen((p) => !p)}
          className="px-3 py-1.5 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30"
        >
          New Hook
        </button>
      </div>
      {data.hooksError2 ? (
        <div className="text-[11px] text-[var(--color-danger)]">{data.hooksError2}</div>
      ) : null}
      {data.hooksLoading2 && !hd ? (
        <div className="text-[12px] text-muted">Loading hooks…</div>
      ) : null}

      {hd && (
        <>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] overflow-hidden">
            <div className="grid grid-cols-7 gap-0 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted border-b border-[var(--border-subtle)] bg-[var(--bg-app)]">
              <div className="col-span-1">Trigger</div>
              <div className="col-span-3">Command</div>
              <div className="col-span-1">Provider</div>
              <div className="col-span-1">Runs</div>
              <div className="col-span-1 text-right">Active</div>
            </div>
            {hd.hooks.map((h) => (
              <div
                key={String(h.id)}
                className="grid grid-cols-7 gap-0 px-4 py-3 border-b border-[var(--border-subtle)] items-center text-[11px]"
              >
                <div className="col-span-1">
                  <span className="text-[9px] px-2 py-0.5 rounded bg-[var(--bg-app)] border border-[var(--border-subtle)] text-muted font-mono">
                    {String(h.trigger || '')}
                  </span>
                </div>
                <div className="col-span-3 font-mono text-[10px] text-main truncate">
                  {String(h.command || '')}
                </div>
                <div className="col-span-1">
                  <span className="text-[9px] px-2 py-0.5 rounded bg-[var(--bg-app)] border border-[var(--border-subtle)] text-muted">
                    {String(h.provider || 'system')}
                  </span>
                </div>
                <div className="col-span-1 text-[10px] text-muted">
                  {Number(h.run_count || 0)} · {h.last_ran ? relativeTime(h.last_ran) : '—'}
                </div>
                <div className="col-span-1 flex items-center justify-end gap-2">
                  <Toggle
                    on={!!Number(h.is_active ?? 1)}
                    onChange={(v) => {
                      const snapshot = data.hooksData;
                      void data.patchHookActive(String(h.id), v, snapshot);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const ok = window.confirm('Delete this hook? This cannot be undone.');
                      if (!ok) return;
                      const snapshot = data.hooksData;
                      void data.deleteHook(String(h.id), snapshot);
                    }}
                    className="text-[10px] px-2 py-1 rounded border border-[var(--border-subtle)] text-muted hover:text-[var(--color-danger)] hover:border-[var(--color-danger)]/40"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {data.newHookOpen && (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted mb-3">
                New Hook
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1 text-[11px]">
                  <span className="text-muted">Trigger</span>
                  <select
                    value={data.newHookDraft.trigger}
                    onChange={(e) =>
                      data.setNewHookDraft((p) => ({ ...p, trigger: e.target.value }))
                    }
                    className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px]"
                  >
                    {['pre_tool_call', 'post_tool_call', 'pre_message', 'post_message', 'on_error', 'on_deploy'].map(
                      (t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px] md:col-span-2">
                  <span className="text-muted">Command</span>
                  <input
                    value={data.newHookDraft.command}
                    onChange={(e) =>
                      data.setNewHookDraft((p) => ({ ...p, command: e.target.value }))
                    }
                    className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px] font-mono"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px]">
                  <span className="text-muted">Provider</span>
                  <select
                    value={data.newHookDraft.provider}
                    onChange={(e) =>
                      data.setNewHookDraft((p) => ({ ...p, provider: e.target.value }))
                    }
                    className="px-3 py-2 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[12px]"
                  >
                    {['system', 'github', 'resend', 'custom'].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[11px] text-muted"
                  onClick={() => data.setNewHookOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg bg-[var(--solar-cyan)]/20 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30"
                  onClick={() => void data.createHook()}
                >
                  Save
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-[var(--border-subtle)] pt-3">
            <div className="text-[12px] font-semibold text-main">Recent Executions</div>
            <div className="mt-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] overflow-hidden">
              <div className="grid grid-cols-5 gap-0 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted border-b border-[var(--border-subtle)] bg-[var(--bg-app)]">
                <div className="col-span-1">Status</div>
                <div className="col-span-1">Ran</div>
                <div className="col-span-1">Duration</div>
                <div className="col-span-2">Error</div>
              </div>
              {(hd.executions || []).map((e: any, i: number) => {
                const st = String(e.status || 'success');
                const cls =
                  st === 'success'
                    ? 'text-[var(--color-success)]'
                    : st === 'timeout'
                      ? 'text-[var(--color-warning)]'
                      : 'text-[var(--color-danger)]';
                return (
                  <div
                    key={String(e.id || i)}
                    className="grid grid-cols-5 gap-0 px-4 py-3 border-b border-[var(--border-subtle)] text-[11px] items-center"
                  >
                    <div className="col-span-1">
                      <span
                        className={`text-[9px] px-2 py-0.5 rounded bg-[var(--bg-app)] border border-[var(--border-subtle)] font-black uppercase tracking-widest ${cls}`}
                      >
                        {st}
                      </span>
                    </div>
                    <div className="col-span-1 text-[10px] text-muted">
                      {e.ran_at ? relativeTime(e.ran_at) : '—'}
                    </div>
                    <div className="col-span-1 text-[10px] text-muted font-mono">
                      {Number(e.duration_ms || 0)}ms
                    </div>
                    <div className="col-span-2 text-[10px] text-[var(--color-danger)] truncate">
                      {String(e.error || '').slice(0, 60)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
