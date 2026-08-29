import React from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { CF_STREAM_DOCS_URL } from './videosRegistry';
import type { StreamCapabilities } from './videosApi';

const card: React.CSSProperties = {
  padding: 14,
  borderRadius: 12,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)',
  marginBottom: 12,
  fontFamily: 'inherit',
};

function Row({ label, value, onCopy }: { label: string; value: string; onCopy?: () => void }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 10px',
          borderRadius: 8,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-app)',
          fontSize: 12,
          color: 'var(--text-main)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {value || '—'}
        </span>
        {value && onCopy ? (
          <button
            type="button"
            onClick={onCopy}
            title="Copy"
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 2,
            }}
          >
            <Copy size={13} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

const CF_CONNECT_HREF = '/dashboard/settings/integrations';

export type VideosUsageSidebarProps = {
  videosStored: number;
  accountId?: string | null;
  customerSubdomain?: string | null;
  capabilities?: StreamCapabilities | null;
  onCopy?: (msg: string, type?: 'ok' | 'err') => void;
};

export function VideosUsageSidebar({
  videosStored,
  accountId,
  customerSubdomain,
  capabilities,
  onCopy,
}: VideosUsageSidebarProps) {
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onCopy?.(`${label} copied`);
    } catch {
      onCopy?.('Copy failed', 'err');
    }
  };

  const connected = !!capabilities?.connected;
  const reconnect = !!capabilities?.reconnect_required;
  const selectAccount = !!capabilities?.account_selection_required;
  const readOnly = connected && capabilities?.can_read && !capabilities?.can_write;
  const platformOwned = !!capabilities?.platform_owned;
  const source = capabilities?.credential_source || null;

  let statusLabel = 'R2 / Drive only — Stream optional';
  if (selectAccount) statusLabel = 'Choose a Cloudflare account';
  else if (reconnect) statusLabel = 'Reconnect Cloudflare (Stream scopes)';
  else if (readOnly) statusLabel = 'Reconnect with Stream Write';
  else if (platformOwned) statusLabel = 'Platform Stream';
  else if (connected && capabilities?.can_write) statusLabel = 'Connected · read/write';
  else if (connected) statusLabel = 'Connected · read';
  else if (capabilities && !connected) statusLabel = 'Connect Cloudflare for Stream';

  return (
    <aside style={{ width: 280, flexShrink: 0, fontFamily: 'inherit' }}>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-main)' }}>
          Usage
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Videos stored</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-main)' }}>{videosStored}</div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-main)' }}>
          Cloudflare Stream
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.4 }}>
          {statusLabel}
        </div>
        {source ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
            Credential: {source}
            {platformOwned ? ' · platform' : ''}
          </div>
        ) : null}
        {(reconnect || !connected || selectAccount || readOnly) && (
          <a
            href={CF_CONNECT_HREF}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--accent, #f6821f)',
              textDecoration: 'none',
              marginBottom: 8,
            }}
          >
            {reconnect || readOnly ? 'Reconnect Cloudflare' : 'Connect Cloudflare'}
            <ExternalLink size={12} />
          </a>
        )}
        {selectAccount && capabilities?.accounts?.length ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            {capabilities.accounts.length} accounts available — pick one in Integrations.
          </div>
        ) : null}
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-main)' }}>
          Account details
        </div>
        <Row
          label="Account ID"
          value={accountId || capabilities?.account_id || ''}
          onCopy={
            accountId || capabilities?.account_id
              ? () => void copy(String(accountId || capabilities?.account_id), 'Account ID')
              : undefined
          }
        />
        <Row
          label="Customer subdomain"
          value={customerSubdomain || ''}
          onCopy={
            customerSubdomain
              ? () => void copy(customerSubdomain, 'Customer subdomain')
              : undefined
          }
        />
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text-main)' }}>
          Resources
        </div>
        {(
          [
            ['Stream docs', CF_STREAM_DOCS_URL],
            ['Uploads', `${CF_STREAM_DOCS_URL}uploading/`],
            ['Embed', `${CF_STREAM_DOCS_URL}viewing/using-the-stream-player/`],
            ['Webhooks', `${CF_STREAM_DOCS_URL}stream-live/webhooks/`],
          ] as const
        ).map(([label, href]) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--text-main)',
              textDecoration: 'none',
              marginBottom: 8,
            }}
          >
            {label}
            <ExternalLink size={12} style={{ color: 'var(--text-muted)' }} />
          </a>
        ))}
      </div>
    </aside>
  );
}
