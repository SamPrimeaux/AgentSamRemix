import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import type { VideosOutletContext } from './VideosShell';
import { copyStreamFromUrl, formatBytes, useVideosToast, type MediaAssetRow } from './videosApi';
import { VIDEOS_BASE, videosDetailPath } from './videosRegistry';

/**
 * R2 / Drive asset panel — preview + metadata + Import to Stream.
 * No fake Stream Settings/Captions/Embed tabs.
 */
export function VideosAssetDetailPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const { workspaceId } = useOutletContext<VideosOutletContext>();
  const navigate = useNavigate();
  const { toasts, add: toast } = useVideosToast();
  const [asset, setAsset] = useState<MediaAssetRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fromUrl, setFromUrl] = useState('');

  const load = useCallback(async () => {
    if (!assetId) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('media_kind', 'video');
      const ws = workspaceId?.trim();
      if (ws) params.set('workspace_id', ws);
      const r = await fetch(`/api/media/assets?${params.toString()}`, {
        credentials: 'same-origin',
      });
      const d = await r.json();
      if (!r.ok || d.error) {
        setError(d.error || `HTTP ${r.status}`);
        setAsset(null);
        return;
      }
      const rows: MediaAssetRow[] = d.assets || [];
      const hit = rows.find((a) => a.id === assetId) || null;
      if (!hit) {
        setError('Asset not found');
        setAsset(null);
        return;
      }
      setAsset(hit);
      try {
        const meta = JSON.parse(hit.metadata_json || '{}') as { public_url?: string; url?: string };
        setFromUrl(String(meta.public_url || meta.url || ''));
      } catch {
        setFromUrl('');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [assetId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const importToStream = async () => {
    const url = fromUrl.trim();
    if (!url) {
      toast('Provide a publicly reachable URL for Stream copy-from-URL', 'err');
      return;
    }
    setBusy(true);
    try {
      const res = await copyStreamFromUrl({
        url,
        name: asset?.filename || undefined,
      });
      if (!res.ok || !res.video?.uid) {
        toast(res.error || 'Import failed', 'err');
        return;
      }
      toast('Imported to Stream');
      navigate(videosDetailPath(res.video.uid, 'settings'));
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Import failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>Loading asset…</div>
    );
  }

  if (error || !asset) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ color: '#f87171', fontSize: 13 }}>{error || 'Not found'}</div>
        <button type="button" onClick={() => navigate(VIDEOS_BASE)} style={linkBtn}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 24px 32px', maxWidth: 640 }}>
      <button type="button" onClick={() => navigate(VIDEOS_BASE)} style={linkBtn}>
        ← Hosted videos
      </button>
      <h2 style={{ margin: '12px 0 8px', fontSize: 18, fontWeight: 600 }}>
        {asset.filename || asset.object_key || asset.id}
      </h2>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'grid', gap: 6 }}>
        <div>
          <strong>ID</strong> · <code>{asset.id}</code>
        </div>
        <div>
          <strong>Bucket</strong> · {asset.bucket || '—'}
        </div>
        <div>
          <strong>Key</strong> · <code>{asset.object_key || '—'}</code>
        </div>
        <div>
          <strong>Type</strong> · {asset.content_type || '—'}
        </div>
        <div>
          <strong>Size</strong> · {formatBytes(asset.size_bytes)}
        </div>
        <div>
          <strong>Status</strong> · {asset.status || '—'}
        </div>
      </div>

      <div
        style={{
          marginTop: 20,
          padding: 14,
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-panel)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>Import to Stream</div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
          Stream copy-from-URL needs a reachable HTTPS URL. Paste one below (signed R2 URL or
          public link).
        </p>
        <input
          value={fromUrl}
          onChange={(e) => setFromUrl(e.target.value)}
          placeholder="https://…"
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-app)',
            color: 'var(--text-main)',
            fontSize: 13,
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void importToStream()}
          style={{
            alignSelf: 'flex-start',
            padding: '7px 12px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-main)',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {busy ? 'Importing…' : 'Import to Stream'}
        </button>
      </div>

      {toasts.length ? (
        <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 80 }}>
          {toasts.map((t) => (
            <div
              key={t.id}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 12,
                background: t.type === 'err' ? '#7f1d1d' : 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                color: t.type === 'err' ? '#fecaca' : 'var(--text-main)',
                marginBottom: 8,
              }}
            >
              {t.msg}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  padding: 0,
};

export default VideosAssetDetailPage;
