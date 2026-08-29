import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Copy, KeyRound, Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  cfDeliveryBase,
  fetchImagesCapabilities,
  imagesListUrl,
  type ImagesCapabilities,
  type ImagesSourceTab,
} from './imagesApi';
import { R2BucketPicker } from '../r2/R2BucketPicker';

async function resolveAccount(
  workspaceId?: string | null,
): Promise<{ accountHash: string; transformed: string | number; caps: ImagesCapabilities | null }> {
  const caps = await fetchImagesCapabilities(workspaceId);
  let accountHash = String(caps?.account_hash || caps?.accountHash || '').trim();
  let transformed: string | number = caps?.images_transformed ?? '—';
  if (!accountHash) {
    try {
      const r = await fetch(imagesListUrl(workspaceId, 'cf_images', 1, 1), {
        credentials: 'same-origin',
      });
      const d = await r.json();
      if (d.accountHash) accountHash = String(d.accountHash);
      if (d.images_transformed != null) transformed = d.images_transformed;
    } catch {
      /* ignore */
    }
  }
  return { accountHash, transformed, caps };
}

export type ImagesUsageAccountSidebarProps = {
  workspaceId?: string | null;
  source?: ImagesSourceTab;
  imagesStored: number;
  imagesTransformed?: string | number;
  accountHash?: string;
  driveConnected?: boolean | null;
  driveAccountEmail?: string | null;
  driveError?: string | null;
  r2Buckets?: string[];
  r2Bucket?: string;
  onSelectR2Bucket?: (bucket: string) => void;
  onConnectR2Bucket?: () => void;
  r2ConnectName?: string;
  onR2ConnectNameChange?: (name: string) => void;
  connectingR2?: boolean;
  onConnectDrive?: () => void;
  connectingDrive?: boolean;
  onCopy?: (msg: string) => void;
};

const card: React.CSSProperties = {
  padding: 14,
  borderRadius: 12,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)',
  marginBottom: 12,
  fontFamily: 'inherit',
};

/** Shared Usage + Account panel — content depends on active source chip. */
export function ImagesUsageAccountSidebar({
  workspaceId: _workspaceId,
  source = 'all',
  imagesStored,
  imagesTransformed = '—',
  accountHash = '',
  driveConnected = null,
  driveAccountEmail = null,
  driveError = null,
  r2Buckets = [],
  r2Bucket = '',
  onSelectR2Bucket,
  onConnectR2Bucket,
  r2ConnectName = '',
  onR2ConnectNameChange,
  connectingR2 = false,
  onConnectDrive,
  connectingDrive = false,
  onCopy,
}: ImagesUsageAccountSidebarProps) {
  void _workspaceId;
  const deliveryUrl = accountHash ? cfDeliveryBase(accountHash) : '';

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onCopy?.(label);
    } catch {
      onCopy?.('Copy failed');
    }
  };

  return (
    <aside style={{ width: 280, flexShrink: 0, fontFamily: 'inherit' }}>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-main)' }}>
          Usage
        </div>
        <Row label="Images in view" value={String(imagesStored)} />
        {(source === 'cf_images' || source === 'all') && (
          <Row label="Images transformed" value={String(imagesTransformed ?? '—')} />
        )}
      </div>

      {source === 'drive' ? (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-main)' }}>
            Google Drive
          </div>
          {driveConnected ? (
            <>
              <Row label="Status" value="Connected" />
              <Row label="Account" value={driveAccountEmail || '—'} />
              {driveError ? (
                <p style={{ fontSize: 12, color: '#f87171', margin: '8px 0 0' }}>{driveError}</p>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.45 }}>
                  Browse-only. Files stay in Drive until you Import to R2 (R2 + registry — not CF Images).
                </p>
              )}
              <button type="button" onClick={() => onConnectDrive?.()} disabled={connectingDrive} style={ctaBtn}>
                {connectingDrive ? 'Reconnecting…' : 'Reconnect Drive'}
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.45 }}>
                Connect Google Drive to list and preview images without copying them into IAM storage.
              </p>
              <button type="button" onClick={() => onConnectDrive?.()} disabled={connectingDrive} style={ctaBtn}>
                {connectingDrive ? 'Connecting…' : 'Connect Google Drive'}
              </button>
            </>
          )}
        </div>
      ) : source === 'r2' ? (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-main)' }}>
            R2 storage
          </div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            Active bucket
          </label>
          <div style={{ marginBottom: 10 }}>
            <R2BucketPicker
              buckets={r2Buckets}
              value={r2Bucket}
              onChange={(b) => onSelectR2Bucket?.(b)}
              placeholder="Select…"
              fullWidth
            />
          </div>
          <Row label="Known buckets" value={String(r2Buckets.length)} />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 8px', lineHeight: 1.45 }}>
            Connect a bucket by name (must be reachable with your R2 API keys). Cloudflare Images OAuth does not
            replace R2 keys.
          </p>
          <input
            type="text"
            value={r2ConnectName}
            onChange={(e) => onR2ConnectNameChange?.(e.target.value)}
            placeholder="bucket-name"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              fontSize: 12,
              padding: '7px 8px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-panel)',
              color: 'var(--text-main)',
              fontFamily: 'inherit',
              marginBottom: 8,
            }}
          />
          <button type="button" onClick={() => onConnectR2Bucket?.()} disabled={connectingR2} style={ctaBtn}>
            {connectingR2 ? 'Connecting…' : 'Connect R2 bucket'}
          </button>
          <Link to="/dashboard/settings/storage" style={{ ...linkCta, marginTop: 8 }}>
            <Link2 size={13} /> Storage settings (R2 keys)
          </Link>
          <Link to="/dashboard/images/keys" style={{ ...linkCta, marginTop: 8 }}>
            <KeyRound size={13} /> Cloudflare Images / Keys
          </Link>
        </div>
      ) : (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-main)' }}>
            Cloudflare Images
          </div>
          {accountHash ? (
            <>
              <Row
                label="Account hash"
                value={accountHash}
                action={
                  <IconBtn label="Copy hash" onClick={() => void copy(accountHash, 'Account hash copied')}>
                    <Copy size={12} />
                  </IconBtn>
                }
              />
              <Row
                label="Delivery URL"
                value={deliveryUrl}
                action={
                  <IconBtn
                    label="Copy delivery URL"
                    onClick={() => void copy(deliveryUrl, 'Delivery URL copied')}
                  >
                    <Copy size={12} />
                  </IconBtn>
                }
              />
            </>
          ) : (
            <div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.45 }}>
                Connect Cloudflare Images to get an account hash and delivery URL. Separate from R2 object storage.
              </p>
              <Link to="/dashboard/images/keys" style={linkCta}>
                <KeyRound size={13} /> Connect on Keys
              </Link>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function Row({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-main)',
            wordBreak: 'break-all',
            lineHeight: 1.35,
            fontFamily: 'inherit',
          }}
          title={value}
        >
          {value.length > 48 ? `${value.slice(0, 20)}…${value.slice(-12)}` : value}
        </div>
      </div>
      {action}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        display: 'flex',
        padding: 6,
        borderRadius: 6,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-app)',
        color: 'var(--text-muted)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

const ctaBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  marginTop: 12,
  padding: '8px 12px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--solar-cyan)',
  color: '#000',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  width: '100%',
};

const linkCta: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 12,
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-app)',
  color: 'var(--solar-cyan)',
  fontSize: 12,
  fontWeight: 600,
  textDecoration: 'none',
  fontFamily: 'inherit',
};

export function ImagesToastStack({
  toasts,
}: {
  toasts: { id: number; msg: string; type: 'ok' | 'err' }[];
}) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 32,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 500,
        pointerEvents: 'none',
        fontFamily: 'inherit',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 16px',
            borderRadius: 10,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            color: t.type === 'err' ? '#f87171' : 'var(--solar-cyan)',
            fontSize: 13,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}
        >
          {t.type === 'ok' ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export function useImagesAccountState(workspaceId?: string | null) {
  const [accountHash, setAccountHash] = useState('');
  const [transformed, setTransformed] = useState<string | number>('—');
  const [caps, setCaps] = useState<ImagesCapabilities | null>(null);

  const refresh = useCallback(async () => {
    const r = await resolveAccount(workspaceId);
    setAccountHash(r.accountHash);
    setTransformed(r.transformed);
    setCaps(r.caps);
    return r;
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { accountHash, setAccountHash, transformed, caps, refresh };
}

export default ImagesUsageAccountSidebar;
