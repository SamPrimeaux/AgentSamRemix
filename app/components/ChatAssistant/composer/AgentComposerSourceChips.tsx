import React from 'react';
import { X, Globe, Link2, Box } from 'lucide-react';
import type { ChatComposerSource } from './types';
import { WEB_SEARCH_SOURCE_ID, SANDBOX_AGENT_SOURCE_ID } from './types';

export type AgentComposerSourceChipsProps = {
  sources: ChatComposerSource[];
  onRemove: (id: string) => void;
  className?: string;
};

function chipIcon(kind: ChatComposerSource['kind']) {
  if (kind === 'web_search') return <Globe size={11} className="shrink-0 opacity-80" aria-hidden />;
  if (kind === 'sandbox_agent') return <Box size={11} className="shrink-0 opacity-80" aria-hidden />;
  return <Link2 size={11} className="shrink-0 opacity-80" aria-hidden />;
}

export function AgentComposerSourceChips({ sources, onRemove, className = '' }: AgentComposerSourceChipsProps) {
  if (!sources.length) return null;

  const chipLabel = (s: ChatComposerSource) => {
    if (s.id === WEB_SEARCH_SOURCE_ID) return 'Web search';
    if (s.id === SANDBOX_AGENT_SOURCE_ID) return 'Remote sandbox';
    return s.label;
  };

  return (
    <div className={`flex flex-wrap items-center gap-1.5 min-w-0 ${className}`.trim()}>
      {sources.map((s) => (
        <span
          key={s.id}
          className="inline-flex items-center gap-1 max-w-[min(100%,14rem)] pl-2 pr-1 py-0.5 rounded-full border border-[var(--dashboard-border)]/90 bg-[var(--scene-bg)]/90 text-[0.625rem] font-medium text-[var(--dashboard-text)]"
          title={
            s.kind === 'web_search'
              ? 'Web search enabled for this message'
              : s.kind === 'sandbox_agent'
                ? 'Remote sandbox agent enabled for this message'
                : `Using ${s.label}`
          }
        >
          {chipIcon(s.kind)}
          <span className="truncate">{chipLabel(s)}</span>
          <button
            type="button"
            aria-label={`Remove ${s.label}`}
            className="p-0.5 rounded-full text-[var(--dashboard-muted)] hover:text-[var(--solar-red)] hover:bg-[var(--bg-hover)]"
            onClick={() => onRemove(s.id)}
          >
            <X size={10} aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}
