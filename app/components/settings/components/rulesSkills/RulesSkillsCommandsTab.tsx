import React from 'react';
import type { SettingsPanelModel } from '../../hooks/useSettingsData';
import { Toggle } from '../../settingsUi';

export function RulesSkillsCommandsTab({ data }: { data: SettingsPanelModel }) {
  return (
    <>
      {data.commandsError2 ? (
        <div className="text-[11px] text-[var(--color-danger)]">{data.commandsError2}</div>
      ) : null}
      {data.commandsLoading2 ? (
        <div className="text-[12px] text-muted">Loading commands…</div>
      ) : null}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] overflow-hidden">
        <div className="grid grid-cols-6 gap-0 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted border-b border-[var(--border-subtle)] bg-[var(--bg-app)]">
          <div className="col-span-2">Slug</div>
          <div className="col-span-2">Name</div>
          <div className="col-span-1">Risk</div>
          <div className="col-span-1 text-right">Active</div>
        </div>
        {data.commands2.map((c) => {
          const id = String(c.id);
          const risk = String(c.risk_level || 'none');
          const riskClass =
            risk === 'high'
              ? 'text-[var(--color-danger)] border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5'
              : risk === 'medium'
                ? 'text-[var(--color-warning)] border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5'
                : risk === 'low'
                  ? 'text-[var(--solar-blue)] border-[var(--solar-blue)]/30 bg-[var(--solar-blue)]/5'
                  : 'text-muted border-[var(--border-subtle)] bg-[var(--bg-app)]';
          return (
            <div key={id} className="border-b border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => data.setExpandedCommandId((p) => (p === id ? null : id))}
                className="w-full grid grid-cols-6 gap-0 px-4 py-3 text-left items-center hover:bg-[var(--bg-hover)]"
              >
                <div className="col-span-2 font-mono text-[11px] text-[var(--solar-cyan)] truncate">
                  {String(c.slug || '')}
                </div>
                <div className="col-span-2 text-[11px] text-main truncate">
                  {String(c.display_name || '')}
                </div>
                <div className="col-span-1">
                  <span
                    className={`text-[9px] px-2 py-0.5 rounded border font-black uppercase tracking-widest ${riskClass}`}
                  >
                    {risk}
                  </span>
                </div>
                <div className="col-span-1 flex justify-end" onClick={(e) => e.stopPropagation()}>
                  <Toggle
                    on={!!Number(c.is_active ?? 1)}
                    onChange={(v) => {
                      const prev = data.commands2;
                      data.setCommands2((p) =>
                        p.map((x) => (String(x.id) === id ? { ...x, is_active: v ? 1 : 0 } : x)),
                      );
                      void data.patchCommandActive(id, v, prev);
                    }}
                  />
                </div>
              </button>
              {data.expandedCommandId === id && (
                <div className="px-4 pb-4 text-[11px] text-muted">
                  <div className="mt-2 text-main">{String(c.description || '')}</div>
                  {c.usage_hint ? (
                    <pre className="mt-3 p-3 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[10px] overflow-auto">
                      {String(c.usage_hint)}
                    </pre>
                  ) : null}
                  {c.modes_json ? (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {(() => {
                        try {
                          const arr = JSON.parse(String(c.modes_json));
                          return Array.isArray(arr) ? arr : [];
                        } catch {
                          return [];
                        }
                      })().map((m: unknown) => (
                        <span
                          key={String(m)}
                          className="text-[9px] px-2 py-0.5 rounded bg-[var(--bg-app)] border border-[var(--border-subtle)] text-muted font-mono"
                        >
                          {String(m)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {c.handler_ref ? (
                    <pre className="mt-3 p-3 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[10px] overflow-auto">
                      {String(c.handler_ref)}
                    </pre>
                  ) : null}
                  {c.handler_sql ? (
                    <pre className="mt-3 p-3 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[10px] overflow-auto">
                      {String(c.handler_sql)}
                    </pre>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
