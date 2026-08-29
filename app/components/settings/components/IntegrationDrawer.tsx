import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { IntegrationCard, type CatalogRow, type ConnectionRow } from './IntegrationCard';
import {
  CfStackSummary,
  type CfStackConfig,
} from '../sections/CfStackWizard';

export type IntegrationDrawerProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  mode: 'connected' | 'available';
  catalog: CatalogRow | null;
  connection: ConnectionRow | null;
  legacy?: { is_connected?: number; last_used?: string } | null;
  iamHosted?: boolean;
  connected?: boolean;
  onConnectOAuth?: (slug: string) => void;
  onConnectApiKey?: (slug: string, apiKey: string) => Promise<void>;
  onDisconnect?: (slug: string) => Promise<void>;
  onTest?: (slug: string) => Promise<{ status?: string; latency_ms?: number; error?: string }>;
  onOpenInMonaco?: (content: string, filename: string) => void;
  /** Cloudflare family extras */
  showCfStack?: boolean;
  cfOAuthConnected?: boolean;
  cfStackConfigured?: boolean;
  cfStackConfig?: CfStackConfig | null;
  workspaceId?: string | null;
  onOpenCfWizard?: () => void;
  /** Satellite CF capabilities folded under this tile */
  foldedCapabilities?: string[];
};

export function IntegrationDrawer({
  open,
  onClose,
  title,
  mode,
  catalog,
  connection,
  legacy,
  iamHosted,
  connected,
  onConnectOAuth,
  onConnectApiKey,
  onDisconnect,
  onTest,
  onOpenInMonaco,
  showCfStack,
  cfOAuthConnected,
  cfStackConfigured,
  cfStackConfig,
  workspaceId,
  onOpenCfWizard,
  foldedCapabilities,
}: IntegrationDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const heading =
    title ||
    String(catalog?.name || connection?.display_name || connection?.provider_key || 'Integration');

  return (
    <div className="iam-int-drawer-root" role="presentation">
      <button
        type="button"
        className="iam-int-drawer-backdrop"
        aria-label="Close integration panel"
        onClick={onClose}
      />
      <aside
        className="iam-int-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
      >
        <header className="iam-int-drawer-head">
          <div className="min-w-0">
            <h3 className="iam-int-drawer-title">{heading}</h3>
            <p className="iam-int-drawer-sub">Health, reconnect, and connection details</p>
          </div>
          <button
            type="button"
            className="iam-int-drawer-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </header>

        <div className="iam-int-drawer-body">
          {foldedCapabilities && foldedCapabilities.length > 0 ? (
            <div className="iam-int-drawer-caps">
              <div className="iam-int-drawer-caps-label">Included Cloudflare capabilities</div>
              <div className="iam-int-drawer-caps-row">
                {foldedCapabilities.map((c) => (
                  <span key={c} className="iam-int-drawer-cap">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <IntegrationCard
            mode={mode}
            initialExpanded
            catalog={catalog}
            connection={connection}
            legacy={legacy}
            iamHosted={iamHosted}
            connected={connected}
            onConnectOAuth={onConnectOAuth}
            onConnectApiKey={onConnectApiKey}
            onDisconnect={onDisconnect}
            onTest={onTest}
            onOpenInMonaco={onOpenInMonaco}
          />

          {showCfStack && cfOAuthConnected ? (
            <div className="iam-int-drawer-stack">
              <div className="iam-int-drawer-stack-title">Cloudflare stack</div>
              {cfStackConfigured ? (
                <>
                  <p className="iam-int-drawer-stack-copy">
                    Account-wide stack configured (shared across your workspaces).
                  </p>
                  <CfStackSummary config={cfStackConfig} />
                  <button
                    type="button"
                    onClick={onOpenCfWizard}
                    className="iam-int-drawer-btn ghost"
                  >
                    Reconfigure stack
                  </button>
                </>
              ) : (
                <>
                  <p className="iam-int-drawer-stack-copy">
                    OAuth is connected. Configure D1, Worker, and Tunnel once for your account (applies across workspaces).
                  </p>
                  <button
                    type="button"
                    onClick={onOpenCfWizard}
                    className="iam-int-drawer-btn primary"
                  >
                    Configure your CF stack →
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
