import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { connectGoogleDrive, fetchR2BucketNames } from '../../src/lib/library/libraryApi';
import { cloudflareImageUrl } from '../../src/lib/cloudflareImageUrl';
import { ImageBatchBar } from './ImageBatchBar';
import type { ImagesOutletContext } from './ImagesShell';
import {
  ImagesToastStack,
  ImagesUsageAccountSidebar,
  useImagesAccountState,
} from './ImagesUsageAccountSidebar';
import {
  buildCfImageUrl,
  imagesBatchDeleteUrl,
  imagesBatchExportUrl,
  imagesListUrl,
  imagesR2BucketStorageKey,
  imagesUploadUrl,
  imagesDetailPath,
  loadImagesStorageBrowse,
  saveImagesStorageBrowse,
  useImagesToast,
  type ImagesSourceTab,
} from './imagesApi';
import { loadR2SavedBuckets, saveR2SavedBuckets } from '../../src/lib/r2Listing';
import { R2BucketPicker } from '../r2/R2BucketPicker';

type ItemSource = 'r2' | 'cf_images' | 'drive';

type CfImage = {
  id: string;
  source?: ItemSource;
  filename?: string;
  url?: string;
  thumbnail?: string;
  thumbnail_url?: string;
  cloudflare_image_id?: string | null;
  drive_file_id?: string;
  r2_key?: string | null;
  r2_bucket?: string;
  created_at?: string;
  uploaded?: string;
  mime_type?: string;
};

const PER_PAGE = 50;

function parseSourceTab(raw: string | null): ImagesSourceTab | null {
  if (raw === 'all' || raw === 'r2' || raw === 'cf_images' || raw === 'drive') return raw;
  return null;
}

export function ImagesStoragePage() {
  const { workspaceId } = useOutletContext<ImagesOutletContext>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toasts, add: toast } = useImagesToast();
  const { accountHash, setAccountHash, transformed, refresh: refreshAccount } =
    useImagesAccountState(workspaceId);

  const [images, setImages] = useState<CfImage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [source, setSource] = useState<ImagesSourceTab>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [driveAccountEmail, setDriveAccountEmail] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [r2Buckets, setR2Buckets] = useState<string[]>([]);
  const [r2Bucket, setR2Bucket] = useState('');
  const [r2SelectionRequired, setR2SelectionRequired] = useState(false);
  const [r2ConnectName, setR2ConnectName] = useState('');
  const [r2ConnectBusy, setR2ConnectBusy] = useState(false);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [browseReady, setBrowseReady] = useState(false);

  const mergeBucketList = useCallback((names: string[]) => {
    setR2Buckets((prev) => {
      const next = [...new Set([...prev, ...names.map((n) => n.trim()).filter(Boolean)])].sort((a, b) =>
        a.localeCompare(b),
      );
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(
        imagesListUrl(workspaceId, source, page, PER_PAGE, undefined, undefined, r2Bucket || undefined),
        { credentials: 'same-origin' },
      );
      const d = await r.json();
      if (d.error) {
        setError(d.error);
        setImages([]);
        setTotal(0);
        return;
      }
      const rows: CfImage[] = d.items || d.images || [];
      setImages(rows);
      setTotal(typeof d.total === 'number' ? d.total : rows.length);
      if (d.accountHash) setAccountHash(String(d.accountHash));
      if (typeof d.drive_connected === 'boolean') setDriveConnected(d.drive_connected);
      setDriveAccountEmail(
        typeof d.drive_account_email === 'string' && d.drive_account_email
          ? d.drive_account_email
          : null,
      );
      setDriveError(typeof d.drive_error === 'string' && d.drive_error ? d.drive_error : null);
      setR2SelectionRequired(d.r2_selection_required === true);
      if (Array.isArray(d.r2_buckets) && d.r2_buckets.length) {
        mergeBucketList(
          d.r2_buckets.map((b: string | { name?: string }) => (typeof b === 'string' ? b : b.name || '')),
        );
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, source, page, r2Bucket, setAccountHash, mergeBucketList]);

  // Restore browse context: URL query > sessionStorage > last R2 bucket localStorage.
  useEffect(() => {
    if (browseReady) return;
    const urlSource = parseSourceTab(searchParams.get('source'));
    const urlBucket = searchParams.get('r2_bucket')?.trim() || '';
    const urlPage = Number(searchParams.get('page') || '0');
    const savedBrowse = loadImagesStorageBrowse(workspaceId);
    let nextSource: ImagesSourceTab = 'all';
    let nextBucket = '';
    let nextPage = 1;
    if (urlSource || urlBucket) {
      nextSource = urlSource || (urlBucket ? 'r2' : 'all');
      nextBucket = urlBucket;
      nextPage = Number.isFinite(urlPage) && urlPage >= 1 ? urlPage : 1;
    } else if (savedBrowse) {
      nextSource = savedBrowse.source;
      nextBucket = savedBrowse.r2Bucket || '';
      nextPage = savedBrowse.page || 1;
    } else {
      try {
        const saved = localStorage.getItem(imagesR2BucketStorageKey(workspaceId));
        if (saved?.trim()) {
          nextSource = 'r2';
          nextBucket = saved.trim();
        }
      } catch {
        /* ignore */
      }
    }
    setSource(nextSource);
    setR2Bucket(nextBucket);
    setPage(nextPage);
    const fromLs = loadR2SavedBuckets(null);
    if (fromLs.length) mergeBucketList(fromLs);
    setBrowseReady(true);
  }, [workspaceId, mergeBucketList, searchParams, browseReady]);

  // Persist browse context so detail → Storage returns to the same R2 grid.
  useEffect(() => {
    if (!browseReady) return;
    saveImagesStorageBrowse(workspaceId, {
      source,
      r2Bucket: source === 'r2' ? r2Bucket : undefined,
      page,
    });
    const next = new URLSearchParams();
    if (source !== 'all') next.set('source', source);
    if (source === 'r2' && r2Bucket.trim()) next.set('r2_bucket', r2Bucket.trim());
    if (page > 1) next.set('page', String(page));
    const cur = searchParams.toString();
    const want = next.toString();
    if (cur !== want) setSearchParams(next, { replace: true });
  }, [browseReady, source, r2Bucket, page, workspaceId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!browseReady) return;
    void load();
  }, [browseReady, load]);

  useEffect(() => {
    let cancelled = false;
    fetchR2BucketNames()
      .then((list) => {
        if (!cancelled && list.length) mergeBucketList(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mergeBucketList]);

  const selectR2Bucket = useCallback(
    (name: string) => {
      const n = name.trim();
      setR2Bucket(n);
      setPage(1);
      try {
        if (n) localStorage.setItem(imagesR2BucketStorageKey(workspaceId), n);
        else localStorage.removeItem(imagesR2BucketStorageKey(workspaceId));
      } catch {
        /* ignore */
      }
    },
    [workspaceId],
  );

  const onConnectR2Bucket = useCallback(async () => {
    const name = r2ConnectName.trim();
    if (!name) {
      toast('Enter an R2 bucket name', 'err');
      return;
    }
    setR2ConnectBusy(true);
    try {
      const qs = new URLSearchParams({ bucket: name, prefix: '' });
      const res = await fetch(`/api/r2/list?${qs}`, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        toast(
          typeof data.user_message === 'string'
            ? data.user_message
            : typeof data.error === 'string'
              ? data.error
              : `Bucket "${name}" not found or not accessible. Connect R2 keys under Settings → Storage.`,
          'err',
          6000,
        );
        return;
      }
      const saved = loadR2SavedBuckets(null);
      const next = saved.includes(name) ? saved : [...saved, name];
      saveR2SavedBuckets(null, next);
      mergeBucketList(next);
      selectR2Bucket(name);
      setR2ConnectName('');
      toast(`Connected R2 bucket: ${name}`);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Could not connect bucket', 'err');
    } finally {
      setR2ConnectBusy(false);
    }
  }, [r2ConnectName, toast, mergeBucketList, selectR2Bucket]);

  const onConnectDrive = useCallback(async () => {
    setConnectingDrive(true);
    try {
      const result = await connectGoogleDrive('/dashboard/images/storage');
      if (result.ok) {
        toast('Google Drive connected');
        setSource('drive');
        await load();
      } else if (result.error && result.error !== 'popup_blocked') {
        toast(`Drive connect failed: ${result.error}`, 'err');
      }
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Drive connect failed', 'err');
    } finally {
      setConnectingDrive(false);
    }
  }, [load, toast]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [source]);

  useEffect(() => {
    const close = () => setMenuId(null);
    if (menuId) {
      window.addEventListener('click', close);
      return () => window.removeEventListener('click', close);
    }
  }, [menuId]);

  const resolveUrl = (img: CfImage) => {
    if (img.source === 'drive') {
      const driveId = img.drive_file_id || (img.id?.startsWith('drive_') ? img.id.slice(6) : '');
      if (driveId) return `/api/images/drive/${encodeURIComponent(driveId)}/preview`;
    }
    if (img.url && !img.url.includes('drive.google.com') && !img.url.includes('docs.google.com')) {
      return img.url;
    }
    if (img.r2_key && img.r2_bucket) {
      return `/api/r2/buckets/${encodeURIComponent(img.r2_bucket)}/object/${encodeURIComponent(img.r2_key)}`;
    }
    const cfId = img.cloudflare_image_id || (img.id?.startsWith('cf_live_') ? img.id.slice(9) : '');
    if (accountHash && cfId) return buildCfImageUrl(accountHash, cfId);
    return img.url || img.thumbnail_url || img.thumbnail || '';
  };

  const previewProps = (img: CfImage) => {
    const raw = resolveUrl(img);
    return cloudflareImageUrl(raw);
  };

  const postUpload = async (file: File, opts?: { destination?: 'r2'; r2Bucket?: string }) => {
    const fd = new FormData();
    fd.append('file', file);
    if (opts?.destination === 'r2') {
      fd.append('destination', 'r2');
      if (opts.r2Bucket) fd.append('r2_bucket', opts.r2Bucket);
    }
    const r = await fetch(
      imagesUploadUrl(workspaceId, {
        destination: opts?.destination,
        r2Bucket: opts?.r2Bucket,
      }),
      { method: 'POST', credentials: 'same-origin', body: fd },
    );
    return { r, d: await r.json().catch(() => ({})) };
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => {
      const t = (f.type || '').toLowerCase();
      const name = (f.name || '').toLowerCase();
      if (t.startsWith('image/')) return true;
      // Some browsers omit type for AVIF — still treat as image by extension.
      return /\.(avif|png|jpe?g|gif|webp|svg|heic|heif)$/i.test(name);
    });
    if (!list.length) {
      toast(
        'No image files selected. Supported: JPEG, PNG, WebP, GIF, HEIC, SVG (CF Images); AVIF and others → use R2 tab.',
        'err',
        6500,
      );
      return;
    }
    if (source === 'r2' && !r2Bucket.trim()) {
      toast('Select or connect an R2 bucket before uploading.', 'err', 5000);
      return;
    }
    setBusy(true);
    try {
      for (const file of list) {
        const preferR2 = source === 'r2';
        let { d } = await postUpload(
          file,
          preferR2 ? { destination: 'r2', r2Bucket: r2Bucket.trim() } : undefined,
        );
        if (!(d.ok && (d.image || d.item)) && d.code === 'cf_images_unsupported' && d.fallback === 'r2') {
          const bucketForFallback = r2Bucket.trim() || r2Buckets[0] || '';
          const msg = String(d.error || 'Cloudflare Images rejected this format.');
          const useR2 =
            bucketForFallback &&
            window.confirm(
              `${msg}\n\nUpload "${file.name}" to R2 bucket "${bucketForFallback}" instead? (CF Images does not accept AVIF on this account.)`,
            );
          if (!useR2) {
            toast(
              bucketForFallback
                ? `${msg} Tip: switch to the R2 tab, select a bucket, and upload there.`
                : `${msg} Connect an R2 bucket on the R2 tab, then retry.`,
              'err',
              8000,
            );
            continue;
          }
          if (!r2Bucket.trim() && bucketForFallback) selectR2Bucket(bucketForFallback);
          ({ d } = await postUpload(file, {
            destination: 'r2',
            r2Bucket: bucketForFallback,
          }));
        }
        if (!(d.ok && (d.image || d.item))) {
          toast(d.error || `Upload failed: ${file.name}`, 'err', 6000);
          continue;
        }
        toast(
          d.destination === 'r2'
            ? `Saved to R2 (${d.r2_bucket || r2Bucket}): ${file.name}`
            : `Uploaded: ${file.name}`,
        );
      }
      await load();
      await refreshAccount();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Upload failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteOne = async (img: CfImage) => {
    if (!confirm(`Delete "${img.filename || img.id}"? This cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/images/${encodeURIComponent(img.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const d = await r.json();
      if (d.ok) {
        toast('Image deleted');
        setSelected((s) => {
          const n = new Set(s);
          n.delete(img.id);
          return n;
        });
        await load();
      } else toast(d.error || 'Delete failed', 'err');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'err');
    }
  };

  const exportOne = (img: CfImage) => {
    const url = resolveUrl(img);
    if (!url) {
      toast('No URL to export', 'err');
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = img.filename || `${img.id}.jpg`;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const copyUrl = async (img: CfImage) => {
    const url = resolveUrl(img);
    if (!url) {
      toast('No URL', 'err');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('URL copied');
    } catch {
      toast('Copy failed', 'err');
    }
  };

  const batchDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} image(s)? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const r = await fetch(imagesBatchDeleteUrl(workspaceId), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const d = await r.json();
      if (!r.ok && d.error) {
        toast(d.error, 'err');
      } else {
        toast(`Deleted ${ids.length} image(s)`);
        setSelected(new Set());
        await load();
      }
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Batch delete failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  const batchExport = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await fetch(imagesBatchExportUrl(workspaceId), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (r.ok) {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const d = await r.json();
          const urls: string[] = d.urls || d.items?.map((i: { url?: string }) => i.url).filter(Boolean) || [];
          if (urls.length) {
            for (const u of urls) window.open(u, '_blank', 'noopener');
            toast(`Exported ${urls.length} URL(s)`);
          } else if (d.error) toast(d.error, 'err');
          else toast('Export returned no URLs', 'err');
        } else {
          const blob = await r.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'images-export.zip';
          a.click();
          URL.revokeObjectURL(a.href);
          toast('Export downloaded');
        }
      } else {
        // Fallback: open each selected delivery URL
        const picked = images.filter((i) => selected.has(i.id));
        for (const img of picked) {
          const u = resolveUrl(img);
          if (u) window.open(u, '_blank', 'noopener');
        }
        toast(`Opened ${picked.length} URL(s)`);
      }
    } catch {
      const picked = images.filter((i) => selected.has(i.id));
      for (const img of picked) {
        const u = resolveUrl(img);
        if (u) window.open(u, '_blank', 'noopener');
      }
      toast(`Opened ${picked.length} URL(s)`);
    } finally {
      setBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const chip = (id: ImagesSourceTab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => {
        setSource(id);
        setPage(1);
      }}
      style={{
        padding: '6px 12px',
        fontSize: 11,
        border: 'none',
        cursor: 'pointer',
        background: source === id ? 'var(--solar-cyan)' : 'var(--bg-elevated)',
        color: source === id ? '#000' : 'var(--text-muted)',
        fontWeight: source === id ? 600 : 400,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '16px 20px 24px' }}>
        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
          }}
          onClick={() => {
            if (source === 'drive') return;
            fileRef.current?.click();
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            border: `1px dashed ${dragOver ? 'var(--solar-cyan)' : 'var(--border-subtle)'}`,
            borderRadius: 12,
            padding: '28px 16px',
            textAlign: 'center',
            background: dragOver
              ? 'color-mix(in srgb, var(--solar-cyan) 8%, var(--bg-panel))'
              : 'var(--bg-panel)',
            cursor: source === 'drive' ? 'default' : busy ? 'wait' : 'pointer',
            marginBottom: 16,
            color: 'var(--text-muted)',
            fontSize: 13,
            fontFamily: 'inherit',
            opacity: source === 'drive' ? 0.65 : 1,
          }}
        >
          <Upload size={22} style={{ color: 'var(--solar-cyan)', flexShrink: 0 }} />
          <div style={{ lineHeight: 1.4 }}>
            {source === 'drive'
              ? 'Drive is browse-only — Import copies to R2 + registry (not CF Images)'
              : busy
                ? 'Uploading…'
                : source === 'r2'
                  ? r2Bucket
                    ? `Drop images to upload to R2 · ${r2Bucket}`
                    : 'Select an R2 bucket below, then drop images to upload'
                  : 'Drop images here or click to upload (JPEG/PNG/WebP/GIF/HEIC/SVG → CF Images; AVIF → R2 fallback)'}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.length) void uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'flex',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              overflow: 'hidden',
            }}
          >
            {chip('all', 'All')}
            {chip('r2', 'R2')}
            {chip('cf_images', 'CF Images')}
            {chip('drive', 'Drive')}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{total} total</span>
          {source === 'r2' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Bucket</label>
              <R2BucketPicker
                buckets={r2Buckets}
                value={r2Bucket}
                onChange={selectR2Bucket}
                placeholder="Select R2 bucket…"
              />
              <input
                type="text"
                value={r2ConnectName}
                onChange={(e) => setR2ConnectName(e.target.value)}
                placeholder="Connect bucket name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void onConnectR2Bucket();
                  }
                }}
                style={{
                  fontSize: 12,
                  padding: '5px 8px',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-main)',
                  width: 160,
                  fontFamily: 'inherit',
                }}
              />
              <button
                type="button"
                disabled={r2ConnectBusy || !r2ConnectName.trim()}
                onClick={() => void onConnectR2Bucket()}
                style={{
                  fontSize: 11,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--solar-cyan)',
                  color: '#000',
                  fontWeight: 600,
                  cursor: r2ConnectBusy ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                  opacity: r2ConnectBusy || !r2ConnectName.trim() ? 0.5 : 1,
                }}
              >
                {r2ConnectBusy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          )}
        </div>

        <ImageBatchBar
          selectedCount={selected.size}
          onExport={() => void batchExport()}
          onDelete={() => void batchDelete()}
          disabled={busy}
        />

        {error && (
          <div style={{ color: '#f87171', fontSize: 12, marginBottom: 12 }}>{error}</div>
        )}

        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : source === 'r2' && (r2SelectionRequired || !r2Bucket) ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0', lineHeight: 1.5 }}>
            Select an R2 bucket above to browse objects, or type a bucket name and click{' '}
            <strong style={{ color: 'var(--text-main)' }}>Connect</strong> (requires R2 API keys in Settings →
            Storage). Example: <code style={{ color: 'var(--solar-cyan)' }}>your-project-bucket</code>
          </div>
        ) : !images.length ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>
            No images found for this source.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 14,
            }}
          >
            {images.map((img) => {
              const prev = previewProps(img);
              const isSel = selected.has(img.id);
              return (
                <div
                  key={img.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(imagesDetailPath(img))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(imagesDetailPath(img));
                    }
                  }}
                  style={{
                    border: isSel
                      ? '1px solid var(--solar-cyan)'
                      : '1px solid var(--border-subtle)',
                    borderRadius: 12,
                    overflow: 'hidden',
                    background: 'var(--bg-panel)',
                    cursor: 'pointer',
                    position: 'relative',
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ position: 'relative', aspectRatio: '4/3', background: 'var(--bg-elevated)' }}>
                    {prev.src ? (
                      <img
                        src={prev.src}
                        srcSet={prev.srcSet}
                        sizes={prev.sizes}
                        alt={img.filename || img.id}
                        loading="lazy"
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
                          color: 'var(--text-muted)',
                          fontSize: 11,
                        }}
                      >
                        No preview
                      </div>
                    )}
                    <input
                      type="checkbox"
                      checked={isSel}
                      onClick={(e) => toggleSelect(img.id, e)}
                      onChange={() => {}}
                      aria-label={`Select ${img.filename || img.id}`}
                      style={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        width: 16,
                        height: 16,
                        cursor: 'pointer',
                        zIndex: 2,
                      }}
                    />
                    <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 2 }}>
                      <button
                        type="button"
                        aria-label="More actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuId((m) => (m === img.id ? null : img.id));
                        }}
                        style={{
                          display: 'flex',
                          padding: 5,
                          borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                          background: 'var(--bg-elevated)',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                        }}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      {menuId === img.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            marginTop: 4,
                            minWidth: 140,
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 8,
                            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                            overflow: 'hidden',
                            zIndex: 10,
                          }}
                        >
                          <MenuItem
                            icon={<Eye size={12} />}
                            label="Open"
                            onClick={() => {
                              setMenuId(null);
                              navigate(imagesDetailPath(img));
                            }}
                          />
                          <MenuItem
                            icon={<Pencil size={12} />}
                            label={img.source === 'r2' && !img.cloudflare_image_id ? 'Details' : 'Edit'}
                            onClick={() => {
                              setMenuId(null);
                              // CF Images transform editor — not for R2 browse objects.
                              if (img.source === 'r2' && !img.cloudflare_image_id) {
                                navigate(imagesDetailPath(img));
                                return;
                              }
                              navigate(`/dashboard/images/${encodeURIComponent(img.id)}/edit`);
                            }}
                          />
                          <MenuItem
                            icon={<Copy size={12} />}
                            label="Copy url"
                            onClick={() => {
                              setMenuId(null);
                              void copyUrl(img);
                            }}
                          />
                          <MenuItem
                            icon={<Download size={12} />}
                            label="Export"
                            onClick={() => {
                              setMenuId(null);
                              exportOne(img);
                            }}
                          />
                          <MenuItem
                            icon={<Trash2 size={12} />}
                            label="Delete"
                            danger
                            onClick={() => {
                              setMenuId(null);
                              void deleteOne(img);
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ padding: '9px 11px' }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--text-main)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: 'inherit',
                      }}
                      title={img.filename || img.id}
                    >
                      {img.filename || img.id}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'inherit' }}>
                      {img.source === 'cf_images'
                        ? 'CF Images'
                        : img.source === 'drive'
                          ? 'Drive'
                          : img.source === 'r2'
                            ? 'R2'
                            : '—'}
                      <span style={{ opacity: 0.7 }}> · click open · checkbox select</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              marginTop: 20,
            }}
          >
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={pagerBtn(page <= 1)}
            >
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              style={pagerBtn(page >= totalPages)}
            >
              <ChevronRight size={14} />
            </button>
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
        <ImagesUsageAccountSidebar
          workspaceId={workspaceId}
          source={source}
          imagesStored={total}
          imagesTransformed={transformed}
          accountHash={accountHash}
          driveConnected={driveConnected}
          driveAccountEmail={driveAccountEmail}
          driveError={driveError}
          r2Buckets={r2Buckets}
          r2Bucket={r2Bucket}
          onSelectR2Bucket={selectR2Bucket}
          onConnectR2Bucket={() => void onConnectR2Bucket()}
          r2ConnectName={r2ConnectName}
          onR2ConnectNameChange={setR2ConnectName}
          connectingR2={r2ConnectBusy}
          onConnectDrive={() => void onConnectDrive()}
          connectingDrive={connectingDrive}
          onCopy={(msg) => toast(msg.includes('fail') ? msg : msg, msg.includes('fail') ? 'err' : 'ok')}
        />
      </div>

      <ImagesToastStack toasts={toasts} />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '8px 12px',
        border: 'none',
        background: 'transparent',
        color: danger ? '#f87171' : 'var(--text-main)',
        fontSize: 12,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function pagerBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 8,
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-elevated)',
    color: disabled ? 'var(--text-muted)' : 'var(--text-main)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
  };
}

export default ImagesStoragePage;
