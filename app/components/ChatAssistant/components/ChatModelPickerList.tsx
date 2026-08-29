/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Model picker dropdown list. Mechanical peel from ChatAssistant.tsx.
 */

import { Sparkles } from 'lucide-react';
import type { ChatModelRow } from '../types';
import { AUTO_MODEL_KEY, isAutoModelSelection } from '../types';

export type ChatModelPickerListProps = {
  onPick: (modelKey: string) => void;
  selectedModelKey: string;
  modelPickerGroups: { group: string; models: ChatModelRow[] }[];
  modelPickerByokHint: Set<string>;
  defaultModelKey: string | null | undefined;
  chatModelsLoading: boolean;
  chatModelsError: string | null | undefined;
  reloadChatModels: () => void;
};

export function ChatModelPickerList({
  onPick, selectedModelKey, modelPickerGroups, modelPickerByokHint,
  defaultModelKey, chatModelsLoading, chatModelsError, reloadChatModels,
}: ChatModelPickerListProps) {
  return (
    <>
      <button
        type="button"
        className={`mx-1 mb-1 flex w-[min(100%,calc(100vw-3rem))] min-w-0 flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--dashboard-panel)] ${
          isAutoModelSelection(selectedModelKey)
            ? 'bg-[var(--dashboard-panel)]/80 text-[var(--solar-cyan)]'
            : 'text-[var(--dashboard-text)]'
        }`}
        onClick={() => onPick(AUTO_MODEL_KEY)}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold tracking-tight">Auto</span>
          {isAutoModelSelection(selectedModelKey) ? (
            <Sparkles size={10} className="shrink-0 animate-pulse" />
          ) : null}
        </div>
        <span className="text-[9px] text-[var(--dashboard-muted)] leading-tight">
          Thompson routing · workspace policy
        </span>
      </button>
      <div className="mx-2 mb-1 border-t border-[var(--dashboard-border)]" role="separator" />
      {!modelPickerGroups.length ? (
        <div className="mx-2 mb-2 px-2 py-2 text-[10px] text-[var(--dashboard-muted)] leading-snug">
          {chatModelsLoading
            ? 'Loading models…'
            : chatModelsError
              ? (
                <span className="flex flex-col gap-1">
                  <span>Could not load models ({chatModelsError}).</span>
                  <button
                    type="button"
                    className="self-start underline text-[var(--solar-cyan)]"
                    onClick={() => reloadChatModels()}
                  >
                    Retry
                  </button>
                </span>
              )
              : (
                <span className="flex flex-col gap-1">
                  <span>No picker models yet.</span>
                  <button
                    type="button"
                    className="self-start underline text-[var(--solar-cyan)]"
                    onClick={() => reloadChatModels()}
                  >
                    Retry load
                  </button>
                </span>
              )}
        </div>
      ) : null}
      {modelPickerGroups.map(({ group, models }) => (
      <div key={group} className="pb-1">
        <div className="px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-[var(--dashboard-muted)] opacity-60">
          {group}
        </div>
        {models.map((m) => {
          const isSession = !isAutoModelSelection(selectedModelKey) && selectedModelKey === m.model_key;
          const isDefault = defaultModelKey != null && defaultModelKey === m.model_key;
          const rateIn = m.input_rate_per_mtok;
          const rateOut = m.output_rate_per_mtok;
          return (
            <button
              key={m.id}
              type="button"
              className={`mx-1 flex w-[min(100%,calc(100vw-3rem))] min-w-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--dashboard-panel)] ${
                isSession ? 'bg-[var(--dashboard-panel)]/80 text-[var(--solar-cyan)]' : 'text-[var(--dashboard-text)]'
              }`}
              onClick={() => onPick(m.model_key)}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="truncate text-[11px] font-bold tracking-tight">{m.name}</span>
                  {m.size_class ? (
                    <span className="shrink-0 rounded border border-[var(--dashboard-border)] px-1 py-0 text-[8px] font-bold uppercase tracking-wide text-[var(--dashboard-muted)]">
                      {m.size_class}
                    </span>
                  ) : null}
                  {isDefault && !isSession ? (
                    <span
                      className="shrink-0 rounded bg-[var(--dashboard-border)] px-1 py-0 text-[8px] font-bold uppercase tracking-wide text-[var(--dashboard-muted)]"
                      title="Workspace default model (Thompson routing when Auto is selected)"
                    >
                      Workspace default
                    </span>
                  ) : null}
                  {m.byok_configured || m.billing_key_source === 'byok' ? (
                    <span className="shrink-0 rounded border border-emerald-500/40 px-1 py-0 text-[8px] font-bold uppercase tracking-wide text-emerald-400/90">
                      BYOK
                    </span>
                  ) : null}
                </div>
                {rateIn != null && rateOut != null ? (
                  <span className="text-[9px] text-[var(--dashboard-muted)]">
                    ${rateIn.toFixed(2)} in · ${rateOut.toFixed(2)} out / MTok
                  </span>
                ) : null}
              </div>
              {isSession ? <Sparkles size={10} className="shrink-0 animate-pulse" /> : null}
            </button>
          );
        })}
      </div>
      ))}
      {modelPickerByokHint.size > 0 ? (
        <div className="mx-2 mt-1 border-t border-[var(--dashboard-border)] pt-2">
          <p className="px-2 pb-1 text-[9px] leading-snug text-[var(--dashboard-muted)]">
            Paste your OpenAI, Anthropic, or Cloudflare AI keys to run models on your quota (BYOK).
          </p>
          <button
            type="button"
            className="mx-1 mb-1 w-[calc(100%-0.5rem)] rounded-lg border border-[var(--dashboard-border)] px-3 py-2 text-left text-[10px] font-semibold text-[var(--solar-cyan)] hover:bg-[var(--dashboard-panel)]"
            onClick={() => {
              window.location.assign('/dashboard/settings/keys');
            }}
          >
            Connect provider keys → Settings
          </button>
        </div>
      ) : null}
    </>

  );
}
