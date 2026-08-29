import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link2, RefreshCw, Search, Upload } from 'lucide-react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import type { VideosOutletContext } from './VideosShell';
import { VideosUsageSidebar } from './VideosUsageSidebar';
import {
  copyStreamFromUrl,
  createStreamDirectUpload,
  fetchStreamCapabilities,
  fetchVideosOverview,
  formatDuration,
  useVideosToast,
  type StreamCapabilities,
  type VideosListRow,
} from './videosApi';
import {
  CF_STREAM_DOCS_URL,
  VIDEOS_SOURCE_TABS,
  videosAssetPath,
  videosDetailPath,
  type VideosSourceTab,
} from './videosRegistry';

type IngestTab = 'upload' | 'link' | 'api';

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

export function VideosOverviewPage() {
  const { workspaceId } = useOutletContext<VideosOutletContext>();
  const navigate = useNavigate();
  const { toasts, add: toast } = useVideosToast();
  const [source, setSource] = useState<VideosSourceTab>('all');
  const [rows, setRows] = useState<VideosListRow[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [customerSubdomain, setCustomerSubdomain] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<StreamCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ingest, setIngest] = useState<IngestTab>('upload');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [res, caps] = await Promise.all([
        fetchVideosOverview(source, workspaceId),
        fetchStreamCapabilities(),
      ]);
      setCapabilities(caps);
      setRows(res.rows);
      if (res.account_id) setAccountId(res.account_id);
      else if (caps.account_id) setAccountId(caps.account_id);
      if (res.customer_subdomain) setCustomerSubdomain(res.customer_subdomain);
      if (res.error && !res.rows.length) setError(res.error);
      else if (res.error) toast(res.error, 'err');
      if (caps.reconnect_required) {
        toast(caps.message || 'Reconnect Cloudflare to enable Stream', 'err');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [source, workspaceId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const name = row.source === 'stream' ? row.name || row.uid : row.name;
      return String(name).toLowerCase().includes(needle) || row.rowKey.toLowerCase().includes(needle);
    });
  }, [rows, q]);

  const onDirectUpload = async () => {
    setBusy(true);
    try {
      const res = await createStreamDirectUpload({ max_duration_seconds: 3600 });
      if (!res.ok || !res.upload_url) {
        toast(res.error || 'Direct upload failed', 'err');
        return;
      }
      toast(res.uid ? `Upload ready · ${res.uid}` : 'Upload URL created');
      window.open(res.upload_url, '_blank', 'noopener');
      setTimeout(() => void load(), 2500);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Direct upload failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  const onFromUrl = async () => {
    const url = linkUrl.trim();
    if (!url) {
      toast('URL required', 'err');
      return;
    }
    setBusy(true);
    try {
      const res = await copyStreamFromUrl({
        url,
        name: linkName.trim() || undefined,
      });
      if (!res.ok || !res.video?.uid) {
        toast(res.error || 'Copy from URL failed', 'err');
        return;
      }
      toast('Import started');
      setLinkUrl('');
      setLinkName('');
      navigate(videosDetailPath(res.video.uid, 'settings'));
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Copy from URL failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  const openRow = (row: VideosListRow) => {
    if (row.source === 'stream') navigate(videosDetailPath(row.uid, 'settings'));
    else navigate(videosAssetPath(row.id));
  };

  const ingestTab = (id: IngestTab, label: string, icon: React.ReactNode) => (
    <button
      key={id}
      type="button"
      onClick={() => setIngest(id)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 14px',
        fontSize: 12,
        fontWeight: 600,
        border: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        background: ingest === id ? 'var(--solar-cyan)' : 'var(--bg-elevated)',
        color: ingest === id ? '#000' : 'var(--text-muted)',
        fontFamily: 'inherit',
      }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '16px 20px 24px' }}>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)' }}>
          Live and on-demand video streaming.
        </p>

        <div
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            overflow: 'hidden',
            marginBottom: 16,
            background: 'var(--bg-panel)',
          }}
        >
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
            {ingestTab('upload', 'Quick Upload', <Upload size={13} />)}
            {ingestTab('link', 'Use Link', <Link2 size={13} />)}
            {ingestTab('api', 'Use API', <span style={{ fontSize: 11, fontWeight: 700 }}>API</span>)}
          </div>
          <div style={{ padding: 16 }}>
            {ingest === 'upload' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDirectUpload()}
                style={{
                  width: '100%',
                  minHeight: 88,
                  borderRadius: 10,
                  border: '1px dashed var(--border-subtle)',
                  background: 'var(--bg-app)',
                  color: 'var(--solar-cyan)',
                  fontSize: 13,
                  cursor: busy ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Drop videos here or click to browse (opens Stream direct upload)
              </button>
            ) : null}
            {ingest === 'link' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
                <input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://…"
                  style={inputStyle}
                />
                <input
                  value={linkName}
                  onChange={(e) => setLinkName(e.target.value)}
                  placeholder="Optional name"
                  style={inputStyle}
                />
                <button type="button" disabled={busy} onClick={() => void onFromUrl()} style={actionBtn}>
                  Import to Stream
                </button>
              </div>
            ) : null}
            {ingest === 'api' ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Use the Stream API or Workers binding to upload programmatically.{' '}
                <a
                  href={`${CF_STREAM_DOCS_URL}get-started/stream-uploads/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--solar-cyan)' }}
                >
                  Open upload docs
                </a>
              </div>
            ) : null}
          </div>
          <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'flex',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              overflow: 'hidden',
            }}
          >
            {VIDEOS_SOURCE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSource(t.id)}
                style={{
                  padding: '6px 12px',
                  fontSize: 11,
                  border: 'none',
                  cursor: 'pointer',
                  background: source === t.id ? 'var(--solar-cyan)' : 'var(--bg-elevated)',
                  color: source === t.id ? '#000' : 'var(--text-muted)',
                  fontWeight: source === t.id ? 600 : 400,
                  fontFamily: 'inherit',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{filtered.length} shown</span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
          }}
        >
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search videos"
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-main)',
              fontSize: 13,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <button
            type="button"
            title="Refresh"
            onClick={() => void load()}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {error ? (
          <div style={{ color: '#f87171', fontSize: 12, marginBottom: 12 }}>{error}</div>
        ) : null}

        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : !filtered.length ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>
            {source === 'drive'
              ? 'No Drive videos in media_assets yet.'
              : source === 'r2'
                ? 'No R2 video assets yet.'
                : 'No videos found. Use Quick Upload or Use Link to add a Stream video.'}
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
            {filtered.map((row, i) => {
              const title = row.source === 'stream' ? row.name || row.uid : row.name;
              const thumb = row.source === 'stream' ? row.thumbnail : undefined;
              const ready = row.source === 'stream' ? !!row.ready || row.status === 'ready' : true;
              const badge =
                row.source === 'stream' ? 'Stream' : row.source === 'drive' ? 'Drive' : 'R2';
              return (
                <button
                  key={row.rowKey}
                  type="button"
                  onClick={() => openRow(row)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    alignItems: 'center',
                    gap: 14,
                    padding: '12px 14px',
                    border: 'none',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)',
                    background: 'var(--bg-panel)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: 'inherit',
                    fontFamily: 'inherit',
                  }}
                >
                  <div
                    style={{
                      width: 96,
                      height: 54,
                      borderRadius: 6,
                      overflow: 'hidden',
                      background: 'var(--bg-elevated)',
                      flexShrink: 0,
                    }}
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          color: 'var(--text-muted)',
                        }}
                      >
                        {badge}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--solar-cyan)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {title}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 10,
                        alignItems: 'center',
                        fontSize: 11,
                        color: 'var(--text-muted)',
                      }}
                    >
                      {row.source === 'stream' ? (
                        <span>{formatDuration(row.duration_sec)}</span>
                      ) : null}
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          color: ready ? '#4ade80' : 'var(--text-muted)',
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: ready ? '#4ade80' : 'var(--text-muted)',
                          }}
                        />
                        {row.source === 'stream'
                          ? ready
                            ? 'Ready'
                            : row.status || 'Pending'
                          : badge}
                      </span>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {row.source === 'stream' ? relativeCreated(row.created) : badge}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div
        style={{
          borderLeft: '1px solid var(--border-subtle)',
          padding: '16px 14px',
          overflowY: 'auto',
          background: 'var(--bg-panel)',
        }}
      >
        <VideosUsageSidebar
          videosStored={rows.filter((r) => r.source === 'stream').length || rows.length}
          accountId={accountId}
          customerSubdomain={customerSubdomain}
          capabilities={capabilities}
          onCopy={(msg, type) => toast(msg, type)}
        />
      </div>

      <ToastStack toasts={toasts} />
    </div>
  );
}

const actionBtn: React.CSSProperties = {
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
  cursor: 'pointer',
  fontFamily: 'inherit',
  alignSelf: 'flex-start',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-app)',
  color: 'var(--text-main)',
  fontSize: 13,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

export default VideosOverviewPage;
