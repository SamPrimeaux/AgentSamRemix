import React, { useEffect, useState } from 'react';
import { Cloud, HardDrive, Upload } from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';
import { connectGoogleDrive } from '../../src/lib/library/libraryApi';
import type { ImagesOutletContext } from './ImagesShell';
import { ImagesToastStack } from './ImagesUsageAccountSidebar';
import { imagesListUrl, useImagesToast } from './imagesApi';

export function ImagesSourcingKitPage() {
  const { workspaceId } = useOutletContext<ImagesOutletContext>();
  const { toasts, add: toast } = useImagesToast();
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const r = await fetch(imagesListUrl(workspaceId, 'drive', 1, 1), {
        credentials: 'same-origin',
      });
      const d = await r.json();
      if (typeof d.drive_connected === 'boolean') setDriveConnected(d.drive_connected);
    } catch {
      /* optional */
    }
  };

  useEffect(() => {
    void refresh();
  }, [workspaceId]);

  const onConnectDrive = async () => {
    setBusy(true);
    try {
      const out = await connectGoogleDrive('/dashboard/images/sourcing-kit');
      if (out.ok) {
        toast('Google Drive connected');
        await refresh();
      } else {
        toast(out.error || 'Drive connect failed', 'err');
      }
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Drive connect failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  const card = (
    icon: React.ReactNode,
    title: string,
    body: string,
    action: React.ReactNode,
  ) => (
    <div
      style={{
        padding: 18,
        borderRadius: 12,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--solar-cyan)' }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{body}</p>
      <div>{action}</div>
    </div>
  );

  const linkBtn = (to: string, label: string) => (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        padding: '7px 12px',
        borderRadius: 8,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        color: 'var(--text-main)',
        fontSize: 12,
        textDecoration: 'none',
      }}
    >
      {label}
    </Link>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 24px 32px', maxWidth: 800 }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600 }}>Sourcing Kit</h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Bring assets into the Media Library from Cloudflare R2, Google Drive, or direct upload. Hosted
        CF Images transforms require Keys → Connect Cloudflare with Images scopes.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 14,
        }}
      >
        {card(
          <Upload size={18} />,
          'Upload',
          'Drop files on Storage or use the upload zone to POST into the library.',
          linkBtn('/dashboard/images/storage', 'Go to Storage'),
        )}
        {card(
          <HardDrive size={18} />,
          'Cloudflare R2',
          'Browse R2 buckets from the Storage R2 source chip. Connect Cloudflare OAuth if buckets are empty.',
          linkBtn('/dashboard/images/storage', 'Browse R2'),
        )}
        {card(
          <Cloud size={18} />,
          'Google Drive',
          driveConnected === false
            ? 'Drive is not connected for this user. Connect once, then browse the Drive source tab.'
            : driveConnected === true
              ? 'Drive is connected. Open Storage → Drive to browse and import.'
              : 'Connect Google Drive to browse and import files into R2 / CF Images.',
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConnectDrive()}
            style={{
              display: 'inline-flex',
              padding: '7px 12px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--solar-cyan)',
              color: '#000',
              fontSize: 12,
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {busy ? 'Connecting…' : driveConnected ? 'Reconnect Drive' : 'Connect Drive'}
          </button>,
        )}
      </div>

      <ImagesToastStack toasts={toasts} />
    </div>
  );
}

export default ImagesSourcingKitPage;
