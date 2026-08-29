import React, { useMemo, useState } from 'react';
import {
  Paperclip,
  Image as ImageIcon,
  Globe,
  Link2,
  Plus,
  Search,
  ExternalLink,
  Check,
  Box,
} from 'lucide-react';
import type { ConnectableIntegration } from './useComposerIntegrations';
import type { ChatComposerSource } from './types';
import { WEB_SEARCH_SOURCE, WEB_SEARCH_SOURCE_ID, SANDBOX_AGENT_SOURCE_ID } from './types';

export type AgentComposerPlusMenuProps = {
  style: React.CSSProperties;
  connectables: ConnectableIntegration[];
  connectablesLoading: boolean;
  activeSourceIds: Set<string>;
  webSearchAllowed: boolean;
  sandboxAgentAllowed?: boolean;
  onUploadFile: () => void;
  onUploadImage: () => void;
  onToggleWebSearch: () => void;
  onToggleSandboxAgent?: () => void;
  onToggleSource: (source: ChatComposerSource, enabled: boolean) => void;
  sourceFromIntegration: (item: ConnectableIntegration) => ChatComposerSource;
};

export function AgentComposerPlusMenu({
  style,
  connectables,
  connectablesLoading,
  activeSourceIds,
  webSearchAllowed,
  sandboxAgentAllowed = true,
  onUploadFile,
  onUploadImage,
  onToggleWebSearch,
  onToggleSandboxAgent,
  onToggleSource,
  sourceFromIntegration,
}: AgentComposerPlusMenuProps) {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return connectables;
    return connectables.filter(
      (c) => c.label.toLowerCase().includes(q) || c.providerKey.toLowerCase().includes(q),
    );
  }, [connectables, filter]);

  return (
    <div
      className="bg-[var(--scene-bg)] border border-[var(--dashboard-border)] rounded-xl shadow-2xl flex flex-col text-[0.6875rem] overflow-hidden min-w-[min(100vw-2rem,280px)] max-h-[min(420px,70dvh)]"
      style={style}
      role="menu"
    >
      <div className="px-3 py-2 border-b border-[var(--dashboard-border)]/70">
        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-[var(--dashboard-muted)] mb-1.5">
          Add to message
        </p>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--dashboard-muted)]" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search connections"
            className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] text-[0.6875rem] text-[var(--dashboard-text)] placeholder:text-[var(--text-placeholder-strong)] outline-none focus:border-[var(--solar-cyan)]"
          />
        </div>
      </div>

      <div className="overflow-y-auto py-1 chat-hide-scroll">
        <button
          type="button"
          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--dashboard-panel)] text-[var(--dashboard-text)]"
          onClick={onUploadFile}
        >
          <Paperclip size={14} className="text-[var(--dashboard-muted)] shrink-0" />
          <span>Add photos &amp; files</span>
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--dashboard-panel)] text-[var(--dashboard-text)]"
          onClick={onUploadImage}
        >
          <ImageIcon size={14} className="text-[var(--dashboard-muted)] shrink-0" />
          <span>Image</span>
        </button>
        {webSearchAllowed ? (
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--dashboard-panel)] text-[var(--dashboard-text)]"
            onClick={onToggleWebSearch}
          >
            <span className="inline-flex items-center gap-3">
              <Globe size={14} className="text-[var(--dashboard-muted)] shrink-0" />
              Web search
            </span>
            {activeSourceIds.has(WEB_SEARCH_SOURCE_ID) ? (
              <Check size={14} className="text-[var(--solar-cyan)] shrink-0" />
            ) : null}
          </button>
        ) : null}
        {sandboxAgentAllowed && onToggleSandboxAgent ? (
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--dashboard-panel)] text-[var(--dashboard-text)]"
            onClick={onToggleSandboxAgent}
          >
            <span className="inline-flex items-center gap-3 min-w-0">
              <Box size={14} className="text-[var(--dashboard-muted)] shrink-0" />
              <span className="flex flex-col min-w-0">
                <span>Remote sandbox</span>
                <span className="text-[0.5625rem] text-[var(--dashboard-muted)] leading-tight">
                  Isolated Linux agent for repo/test/research tasks
                </span>
              </span>
            </span>
            {activeSourceIds.has(SANDBOX_AGENT_SOURCE_ID) ? (
              <Check size={14} className="text-[var(--solar-cyan)] shrink-0" />
            ) : null}
          </button>
        ) : null}

        <div className="border-t border-[var(--dashboard-border)] my-1 mx-2" role="separator" />
        <p className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-[var(--dashboard-muted)]">
          Sources &amp; apps
        </p>

        {connectablesLoading ? (
          <p className="px-3 py-2 text-[0.625rem] text-[var(--dashboard-muted)]">Loading connections…</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-2 text-[0.625rem] text-[var(--dashboard-muted)]">No matches</p>
        ) : (
          filtered.map((item) => {
            const src = sourceFromIntegration(item);
            const active = activeSourceIds.has(src.id);
            return (
              <div
                key={item.providerKey}
                className="flex items-center gap-1 px-2 py-0.5 hover:bg-[var(--dashboard-panel)]/60"
              >
                <button
                  type="button"
                  className="flex flex-1 min-w-0 items-center justify-between gap-2 px-1 py-1.5 text-left text-[var(--dashboard-text)]"
                  onClick={() => {
                    if (item.connected) onToggleSource(src, !active);
                    else if (item.connectUrl.startsWith('http')) {
                      window.open(item.connectUrl, '_blank', 'noopener,noreferrer');
                    } else {
                      window.location.href = item.connectUrl;
                    }
                  }}
                >
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <Link2 size={13} className="text-[var(--dashboard-muted)] shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.connected ? (
                    active ? (
                      <Check size={13} className="text-[var(--solar-cyan)] shrink-0" />
                    ) : (
                      <span className="text-[0.5625rem] text-[var(--dashboard-muted)] shrink-0">off</span>
                    )
                  ) : (
                    <span className="text-[0.5625rem] text-amber-300/90 shrink-0">connect</span>
                  )}
                </button>
                {!item.connected && item.connectUrl.startsWith('/') ? (
                  <a
                    href={item.connectUrl}
                    className="p-1 text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)]"
                    title="Connect"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink size={12} />
                  </a>
                ) : null}
              </div>
            );
          })
        )}

        <button
          type="button"
          className="flex w-full items-center gap-3 px-3 py-2 mt-1 text-left hover:bg-[var(--dashboard-panel)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] border-t border-[var(--dashboard-border)]/60"
          onClick={() => {
            window.location.href = '/dashboard/settings?section=integrations';
          }}
        >
          <Plus size={14} className="shrink-0" />
          <span>Connect more</span>
        </button>
      </div>
    </div>
  );
}
