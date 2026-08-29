import React, { useEffect, useState } from 'react';
import { ExternalLink, KeyRound, RefreshCw } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import type { ImagesOutletContext } from './ImagesShell';
import { ImagesToastStack } from './ImagesUsageAccountSidebar';
import {
  fetchImagesCapabilities,
  imagesListUrl,
  useImagesToast,
  type ImagesCapabilities,
} from './imagesApi';

const CF_OAUTH_START =
  '/api/oauth/cloudflare/start?return_to=' + encodeURIComponent('/dashboard/images/keys');

export function ImagesKeysPage() {
  const { workspaceId } = useOutletContext<ImagesOutletContext>();
  const { toasts, add: toast } = useImagesToast();
  const [caps, setCaps] = useState<ImagesCapabilities | null>(null);
  const [accountHash, setAccountHash] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const c = await fetchImagesCapabilities(workspaceId);
      setCaps(c);
      let hash = String(c?.account_hash || c?.accountHash || '').trim();
      if (!hash) {
        const r = await fetch(imagesListUrl(workspaceId, 'cf_images', 1, 1), {
          credentials: 'same-origin',
        });
        const d = await r.json();
        if (d.accountHash) hash = String(d.accountHash);
      }
      setAccountHash(hash);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to load capabilities', 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount + workspace
  }, [workspaceId]);

  const row = (label: string, value: React.ReactNode) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 0',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 13,
      }}
    >
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-main)', textAlign: 'right' }}>{value}</span>
    </div>
  );

  const flag = (v: boolean | undefined) =>
    v === true ? (
      <span style={{ color: 'var(--solar-cyan)' }}>Connected</span>
    ) : v === false ? (
      <span style={{ color: '#f87171' }}>Unavailable</span>
    ) : (
      <span style={{ color: 'var(--text-muted)' }}>—</span>
    );

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 24px 32px', maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Keys & connections</h2>
        <button
          type="button"
          onClick={() => void load()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-muted)',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      <div
        style={{
          padding: 18,
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-panel)',
          marginBottom: 16,
        }}
      >
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading capabilities…</div>
        ) : (
          <>
            {row('Cloudflare Images', flag(caps?.cf_images))}
            {row('R2', flag(caps?.r2))}
            {row('Google Drive', flag(caps?.drive))}
            {row(
              'Account hash',
              accountHash ? (
                <code style={{ fontSize: 11 }}>{accountHash}</code>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>Not connected</span>
              ),
            )}
          </>
        )}
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
        Connect Cloudflare with Images read/write scopes to use hosted delivery, transforms, and your
        own account hash. R2 browsing still works when Cloudflare OAuth includes R2 scopes even if
        Images is unavailable.
      </p>

      <a
        href={CF_OAUTH_START}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          borderRadius: 8,
          background: 'var(--solar-cyan)',
          color: '#000',
          fontSize: 13,
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        <KeyRound size={15} />
        Connect Cloudflare
        <ExternalLink size={13} />
      </a>

      <ImagesToastStack toasts={toasts} />
    </div>
  );
}

export default ImagesKeysPage;
