import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Copy, ExternalLink } from 'lucide-react';
import {
  NavLink,
  Navigate,
  Outlet,
  useNavigate,
  useOutlet,
  useOutletContext,
  useParams,
} from 'react-router-dom';
import type { VideosOutletContext } from './VideosShell';
import { StreamPlayerEmbed } from './StreamPlayerEmbed';
import {
  deleteStreamVideo,
  formatBytes,
  formatDuration,
  getStreamVideo,
  useVideosToast,
  type StreamVideoDetail,
} from './videosApi';
import { CF_STREAM_DOCS_URL, VIDEOS_BASE, VIDEOS_DETAIL_TABS } from './videosRegistry';

export type VideosDetailOutletContext = VideosOutletContext & {
  uid: string;
  video: StreamVideoDetail;
  reload: () => Promise<void>;
  toast: (msg: string, type?: 'ok' | 'err') => void;
};

function ToastStack({
  toasts,
}: {
  toasts: Array<{ id: number; msg: string; type: 'ok' | 'err' }>;
}) {
  if (!toasts.length) return null;
  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 80,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
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
            maxWidth: 320,
          }}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}

function relativeCreated(iso?: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 1) return 'Created today';
  if (days < 30) return `Created ${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Created ${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `Created ${years} year${years === 1 ? '' : 's'} ago`;
}

function CopyRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          padding: '7px 10px',
          borderRadius: 8,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-app)',
          fontSize: 11,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          wordBreak: 'break-all',
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>{value}</span>
        <button
          type="button"
          title="Copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
            } catch {
              /* ignore */
            }
          }}
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
      </div>
    </div>
  );
}

export function VideosDetailShell() {
  const { uid } = useParams<{ uid: string }>();
  const parent = useOutletContext<VideosOutletContext>();
  const navigate = useNavigate();
  const { toasts, add: toast } = useVideosToast();
  const [video, setVideo] = useState<StreamVideoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setError('');
    try {
      const res = await getStreamVideo(uid);
      if (!res.ok || !res.video) {
        setError(res.error || 'Failed to load video');
        setVideo(null);
        return;
      }
      setVideo(res.video);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
      setVideo(null);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    parent.setDocsUrl(CF_STREAM_DOCS_URL);
    return () => parent.setDocsUrl(null);
  }, [parent]);

  const ctx: VideosDetailOutletContext | null = useMemo(() => {
    if (!uid || !video) return null;
    return { ...parent, uid, video, reload, toast };
  }, [parent, uid, video, reload, toast]);

  const onDelete = async () => {
    if (!uid) return;
    if (!confirm('Delete this Stream video? This cannot be undone.')) return;
    const res = await deleteStreamVideo(uid);
    if (!res.ok) {
      toast(res.error || 'Delete failed', 'err');
      return;
    }
    toast('Video deleted');
    navigate(VIDEOS_BASE);
  };

  if (!uid) return <Navigate to={VIDEOS_BASE} replace />;

  if (loading && !video) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>Loading video…</div>
    );
  }

  if (error || !video || !ctx) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>
          {error || 'Video not found'}
        </div>
        <button type="button" onClick={() => navigate(VIDEOS_BASE)} style={ghostLink}>
          ← Back to videos
        </button>
      </div>
    );
  }

  const watchUrl = video.watch_url || '';
  const ready = !!video.ready || video.status === 'ready';
  const embedPrefs = (video.embed || {}) as Record<string, unknown>;
  const playerControls = embedPrefs.controls !== false;
  const playerMuted = !!embedPrefs.muted;
  const playerAutoplay = !!embedPrefs.autoplay;
  const playerLoop = !!embedPrefs.loop;
  const playerPrimary =
    typeof embedPrefs.primary_color === 'string' ? embedPrefs.primary_color : undefined;
  const playerStart =
    embedPrefs.start_time != null && embedPrefs.start_time !== ''
      ? (embedPrefs.start_time as string | number)
      : undefined;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={{ padding: '16px 24px 0' }}>
        <button type="button" onClick={() => navigate(VIDEOS_BASE)} style={ghostLink}>
          ← Overview
        </button>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginTop: 10,
            marginBottom: 12,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 650,
                letterSpacing: '-0.02em',
              }}
            >
              {video.name || video.uid}
            </h2>
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                alignItems: 'center',
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  color: ready ? '#4ade80' : 'var(--text-muted)',
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: ready ? '#4ade80' : 'var(--text-muted)',
                  }}
                />
                {ready ? 'Ready' : video.status || 'Pending'}
              </span>
              <span>{relativeCreated(video.created)}</span>
              <span>{formatDuration(video.duration_sec)}</span>
              <span>{formatBytes(video.size_bytes)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <a
              href={CF_STREAM_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={outlineBtn}
            >
              <BookOpen size={13} />
              Open documentation
            </a>
            {watchUrl ? (
              <a href={watchUrl} target="_blank" rel="noopener noreferrer" style={primaryBtn}>
                Video Link
                <ExternalLink size={13} />
              </a>
            ) : (
              <button type="button" disabled style={{ ...primaryBtn, opacity: 0.5 }}>
                Video Link unavailable
              </button>
            )}
          </div>
        </div>

        <nav
          style={{
            display: 'flex',
            gap: 0,
            overflowX: 'auto',
            borderBottom: '1px solid var(--border-subtle)',
          }}
          aria-label="Video detail sections"
        >
          {VIDEOS_DETAIL_TABS.map((tab) => (
            <NavLink
              key={tab.id}
              to={`${VIDEOS_BASE}/${encodeURIComponent(uid)}/${tab.id}`}
              style={({ isActive }) => ({
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--solar-cyan)' : 'var(--text-muted)',
                textDecoration: 'none',
                borderBottom: isActive ? '2px solid var(--solar-cyan)' : '2px solid transparent',
                whiteSpace: 'nowrap',
              })}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 0,
          alignItems: 'flex-start',
          padding: '16px 24px 32px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 420px', minWidth: 0, paddingRight: 20 }}>
          <Outlet context={ctx} />
          <div
            style={{
              marginTop: 28,
              paddingTop: 16,
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>
                Delete video
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Permanently remove this Stream video. This cannot be undone.
              </div>
            </div>
            <button type="button" onClick={() => void onDelete()} style={dangerBtn}>
              Delete video
            </button>
          </div>
        </div>

        <aside
          style={{
            flex: '0 0 320px',
            width: 320,
            maxWidth: '100%',
          }}
        >
          <div
            style={{
              borderRadius: 12,
              overflow: 'hidden',
              border: '1px solid var(--border-subtle)',
              background: '#000',
              marginBottom: 12,
            }}
          >
            <StreamPlayerEmbed
              src={video.uid}
              customerSubdomain={video.customer_subdomain}
              requireSignedUrls={!!video.require_signed_urls}
              controls={playerControls}
              muted={playerMuted}
              autoplay={playerAutoplay}
              loop={playerLoop}
              primaryColor={playerPrimary}
              startTime={playerStart}
              poster={video.thumbnail || undefined}
              title={video.name || video.uid}
            />
          </div>

          <div
            style={{
              padding: 14,
              borderRadius: 12,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-elevated)',
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Video details</div>
            <CopyRow label="Video ID" value={video.uid} />
            <CopyRow label="Customer subdomain" value={video.customer_subdomain} />
            <CopyRow label="HLS" value={video.hls || video.playback?.hls as string} />
            <CopyRow label="Dash" value={video.dash} />
            <CopyRow label="Watch URL" value={watchUrl} />
          </div>

          {Object.keys(video.resource_tags || {}).length ? (
            <div
              style={{
                padding: 14,
                borderRadius: 12,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-elevated)',
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Tags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(video.resource_tags || {}).map(([k, v]) => (
                  <span
                    key={k}
                    style={{
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-app)',
                    }}
                  >
                    {k}
                    {v ? `=${v}` : ''}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
      <ToastStack toasts={toasts} />
    </div>
  );
}

const ghostLink: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  padding: 0,
};

const outlineBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-main)',
  fontSize: 12,
  fontWeight: 500,
  textDecoration: 'none',
  fontFamily: 'inherit',
};

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--solar-cyan)',
  color: '#000',
  fontSize: 12,
  fontWeight: 600,
  textDecoration: 'none',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const dangerBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 8,
  border: '1px solid #7f1d1d',
  background: 'transparent',
  color: '#f87171',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
};

export default VideosDetailShell;
