import React, { useMemo, useState } from 'react';
import {
  Box,
  Check,
  Globe,
  Image as ImageIcon,
  Paperclip,
  Search,
  Telescope,
  Terminal,
} from 'lucide-react';
import { resolveIntegrationIconUrl } from '../../../src/lib/resolveIntegrationIconUrl';
import type { ComposerAvailableConnector } from '../../../src/hooks/useAvailableConnectors';
import type { ChatComposerSource } from '../composer/types';
import { WEB_SEARCH_SOURCE_ID, SANDBOX_AGENT_SOURCE_ID } from '../composer/types';

export type ComposerConnectorSheetProps = {
  style: React.CSSProperties;
  connectors: ComposerAvailableConnector[];
  connectorsLoading: boolean;
  activeSourceIds: Set<string>;
  webSearchAllowed: boolean;
  sandboxAgentAllowed?: boolean;
  onClose: () => void;
  onAttachFiles: () => void;
  onCreateImage: () => void;
  onWebSearch: () => void;
  onDeepResearch: () => void;
  onSandbox?: () => void;
  /** Opens in-app terminal (composer + menu). */
  onOpenTerminal?: () => void;
  onToggleSource: (source: ChatComposerSource, enabled: boolean) => void;
  sourceFromConnector: (item: ComposerAvailableConnector) => ChatComposerSource;
};

function ConnectorIcon({
  connector,
  size = 28,
}: {
  connector: ComposerAvailableConnector;
  size?: number;
}) {
  const src = resolveIntegrationIconUrl(
    connector.providerKey,
    connector.iconUrl,
    connector.iconSlug,
  );
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="rounded-lg object-contain bg-[var(--scene-bg)]"
        style={{ width: size, height: size }}
      />
    );
  }
  const letter = (connector.name.trim()[0] || '?').toUpperCase();
  return (
    <span
      className="inline-flex items-center justify-center rounded-lg bg-[var(--scene-bg)] text-[10px] font-bold text-[var(--dashboard-text)] border border-[var(--dashboard-border)]"
      style={{ width: size, height: size }}
    >
      {letter}
    </span>
  );
}

function CapabilityRow({
  icon,
  label,
  description,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--bg-hover)] text-[var(--dashboard-text)]"
      onClick={onClick}
    >
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--scene-bg)] text-[var(--dashboard-muted)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.875rem] font-medium">{label}</span>
        {description ? (
          <span className="block text-[0.75rem] text-[var(--dashboard-muted)] truncate">{description}</span>
        ) : null}
      </span>
      {active ? <Check size={14} className="shrink-0 text-[var(--accent,var(--accent-secondary,var(--solar-cyan)))]" /> : null}
    </button>
  );
}

export function ComposerConnectorSheet({
  style,
  connectors,
  connectorsLoading,
  activeSourceIds,
  webSearchAllowed,
  sandboxAgentAllowed = false,
  onClose,
  onAttachFiles,
  onCreateImage,
  onWebSearch,
  onDeepResearch,
  onSandbox,
  onOpenTerminal,
  onToggleSource,
  sourceFromConnector,
}: ComposerConnectorSheetProps) {
  const [filter, setFilter] = useState('');

  const filteredConnectors = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return connectors;
    return connectors.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.providerKey.toLowerCase().includes(q),
    );
  }, [connectors, filter]);

  return (
    <div
      className="flex w-full max-h-[min(480px,70dvh)] flex-col overflow-hidden rounded-2xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] text-[0.8125rem] shadow-2xl"
      style={{
        ...style,
        // Force opaque panel — --dashboard-panel is often translucent over the canvas.
        backgroundColor: 'var(--scene-bg, #0f1419)',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
      }}
      role="menu"
    >
      <div className="overflow-y-auto chat-hide-scroll py-1">
        <CapabilityRow
          icon={<Paperclip size={16} />}
          label="Add photos & files"
          onClick={() => {
            onAttachFiles();
            onClose();
          }}
        />
        {onOpenTerminal ? (
          <CapabilityRow
            icon={<Terminal size={16} />}
            label="Terminal"
            description="Open Local / VM / Sandbox shell"
            onClick={() => {
              onOpenTerminal();
              onClose();
            }}
          />
        ) : null}
        <div className="mx-3 my-1 border-t border-[var(--dashboard-border)]" role="separator" />
        <CapabilityRow
          icon={<ImageIcon size={16} />}
          label="Create image"
          description="Visualize anything"
          onClick={() => {
            onCreateImage();
            onClose();
          }}
        />
        {webSearchAllowed ? (
          <CapabilityRow
            icon={<Globe size={16} />}
            label="Web search"
            description="Find real-time info"
            active={activeSourceIds.has(WEB_SEARCH_SOURCE_ID)}
            onClick={() => {
              onWebSearch();
              onClose();
            }}
          />
        ) : null}
        <CapabilityRow
          icon={<Telescope size={16} />}
          label="Deep research"
          description="Get a detailed report"
          onClick={() => {
            onDeepResearch();
            onClose();
          }}
        />
        {sandboxAgentAllowed && onSandbox ? (
          <CapabilityRow
            icon={<Box size={16} />}
            label="Remote sandbox"
            description="Isolated Linux agent"
            active={activeSourceIds.has(SANDBOX_AGENT_SOURCE_ID)}
            onClick={() => {
              onSandbox();
              onClose();
            }}
          />
        ) : null}

        <div className="mx-3 my-1 border-t border-[var(--dashboard-border)]" role="separator" />

        {connectorsLoading ? (
          <p className="px-4 py-3 text-[0.75rem] text-[var(--dashboard-muted)]">Loading connections…</p>
        ) : filteredConnectors.length === 0 ? (
          <p className="px-4 py-3 text-[0.75rem] text-[var(--dashboard-muted)]">No matching connections</p>
        ) : (
          filteredConnectors.map((connector) => {
            const src = sourceFromConnector(connector);
            const active = activeSourceIds.has(src.id);
            return (
              <button
                key={connector.id}
                type="button"
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--bg-hover)] text-[var(--dashboard-text)]"
                onClick={() => {
                  if (connector.connected) {
                    onToggleSource(src, !active);
                    onClose();
                    return;
                  }
                  const url = connector.connectUrl?.trim();
                  if (url) {
                    if (url.startsWith('http')) {
                      window.open(url, '_blank', 'noopener,noreferrer');
                    } else {
                      window.location.href = url;
                    }
                  }
                  onClose();
                }}
              >
                <ConnectorIcon connector={connector} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[0.875rem] font-medium">{connector.name}</span>
                    {!connector.connected ? (
                      <span className="shrink-0 rounded-full border border-[var(--dashboard-border)] px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">
                        Connect
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[0.75rem] text-[var(--dashboard-muted)]">
                    {connector.description}
                  </span>
                </span>
                {connector.connected && active ? (
                  <Check size={14} className="shrink-0 text-[var(--accent,var(--accent-secondary,var(--solar-cyan)))]" />
                ) : null}
              </button>
            );
          })
        )}
      </div>

      <div className="border-t border-[var(--dashboard-border)] px-4 py-2.5">
        <div className="relative">
          <Search size={14} className="absolute left-0 top-1/2 -translate-y-1/2 text-[var(--dashboard-muted)]" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Type to search tools & sources…"
            className="w-full bg-transparent pl-6 text-[0.8125rem] text-[var(--dashboard-text)] placeholder:text-[var(--text-placeholder-strong)] outline-none"
          />
        </div>
      </div>
    </div>
  );
}
