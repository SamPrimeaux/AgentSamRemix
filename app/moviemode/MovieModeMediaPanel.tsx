import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cloud,
  Film,
  FolderOpen,
  HardDrive,
  Loader2,
  MoreHorizontal,
  Music,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { detectFileKind } from '../src/lib/fileKind';
import { uploadFileToR2 } from '../src/lib/r2MultipartUpload';
import type { MediaLibraryItem } from './types';
import { MOVIEMODE_CLIP_DRAG } from './createEmptyTimeline';
import {
  dispatchMovieModeAddClip,
  dispatchMovieModePreviewClip,
} from './movieModeMediaEvents';
import { useMovieModeShell, type MovieModeBinTab } from './useMovieModeShell';

type StreamVideo = {
  uid: string;
  name: string;
  duration_sec: number | null;
  ready: boolean;
  thumbnail: string;
  hls: string;
};

type MovieModeTemplate = {
  id: string;
  pack_slug: string;
  pack_title: string;
  slug: string;
  title: string;
  description?: string | null;
  stream_uid?: string | null;
  stream_hls_url?: string | null;
  thumbnail_url?: string | null;
  duration_sec?: number | null;
  is_free?: number;
};

function kindForBinTab(tab: MovieModeBinTab): string | null {
  if (tab === 'media') return 'video';
  if (tab === 'audio') return 'audio';
  if (tab === 'text') return 'text';
  return null;
}

function mapApiAsset(a: Record<string, unknown>): MediaLibraryItem | null {
  const key = String(a.object_key || a.r2_key || a.key || '');
  const bucket = String(a.bucket || a.r2_bucket || 'inneranimalmedia');
  const name = String(a.filename || key.split('/').pop() || a.id || 'asset');
  const ct = String(a.content_type || a.mime_type || '');
  const kind = detectFileKind({ name, key, contentType: ct });
  if (kind === 'text' && !name.match(/\.(srt|vtt|txt)$/i)) return null;
  const assetId = String(a.id || '');
  return {
    id: `api:${assetId}`,
    name,
    kind: kind === 'text' ? 'binary' : kind,
    previewUrl: `/api/r2/buckets/${encodeURIComponent(bucket)}/object/${encodeURIComponent(key)}`,
    contentType: ct,
    size: typeof a.size_bytes === 'number' ? a.size_bytes : null,
    source: 'api',
    r2Bucket: bucket,
    r2Key: key,
    assetId,
    vectorizeId: a.vectorize_id ? String(a.vectorize_id) : null,
    durationSec: typeof a.duration_ms === 'number' ? a.duration_ms / 1000 : null,
  };
}

function formatDur(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export const MovieModeMediaPanel: React.FC<{
  projectId?: string | null;
  projectSlug?: string | null;
}> = ({ projectId, projectSlug }) => {
  const { binTab, mediaSource, searchQuery, setMediaSource, setSearchQuery } = useMovieModeShell();
  const [library, setLibrary] = useState<MediaLibraryItem[]>([]);
  const [streamVideos, setStreamVideos] = useState<StreamVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [importingUid, setImportingUid] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [templates, setTemplates] = useState<MovieModeTemplate[]>([]);
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mediaKindFilter = kindForBinTab(binTab);

  const loadLibrary = useCallback(async () => {
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);
    if (mediaKindFilter) params.set('media_kind', mediaKindFilter);
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    const res = await fetch(`/api/media/assets?${params}`, { credentials: 'include' });
    const data = (await res.json().catch(() => ({}))) as {
      assets?: Array<Record<string, unknown>>;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || 'Failed to load library');
    const mapped = (data.assets || [])
      .map(mapApiAsset)
      .filter((x): x is MediaLibraryItem => Boolean(x));
    setLibrary(mapped);
  }, [projectId, mediaKindFilter, searchQuery]);

  const loadTemplates = useCallback(async () => {
    const res = await fetch('/api/moviemode/templates?pack=starter-broll', { credentials: 'include' });
    const data = (await res.json()) as { ok?: boolean; templates?: MovieModeTemplate[]; error?: string };
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Templates load failed');
    let rows = data.templates || [];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      rows = rows.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q) ||
          (t.pack_title || '').toLowerCase().includes(q),
      );
    }
    setTemplates(rows);
  }, [searchQuery]);

  const loadStream = useCallback(async () => {
    const res = await fetch('/api/stream/videos?limit=100', { credentials: 'include' });
    const data = (await res.json()) as {
      ok?: boolean;
      videos?: StreamVideo[];
      error?: string;
    };
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Stream list failed');
    let vids = data.videos || [];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      vids = vids.filter((v) => v.name.toLowerCase().includes(q) || v.uid.includes(q));
    }
    if (mediaKindFilter === 'video') {
      /* stream is video-only */
    }
    setStreamVideos(vids);
  }, [searchQuery, mediaKindFilter]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      await Promise.all([
        loadLibrary(),
        binTab === 'templates' ? loadTemplates() : Promise.resolve(),
        mediaSource === 'stream' || binTab === 'media' ? loadStream() : Promise.resolve(),
      ]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [loadLibrary, loadStream, loadTemplates, mediaSource, binTab]);

  const applyTemplate = async (tpl: MovieModeTemplate) => {
    setApplyingTemplateId(tpl.id);
    setErr(null);
    try {
      const res = await fetch(`/api/moviemode/templates/${encodeURIComponent(tpl.id)}/apply`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId || null,
          project_slug: projectSlug || tpl.pack_slug,
          import_stream: true,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        asset?: Record<string, unknown>;
        preview_url?: string;
        template?: MovieModeTemplate;
      };
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Apply failed');
      const asset = data.asset;
      const item: MediaLibraryItem = asset
        ? (mapApiAsset(asset) as MediaLibraryItem)
        : {
            id: `stream:${tpl.stream_uid}`,
            name: tpl.title,
            kind: 'video',
            previewUrl: data.preview_url || tpl.stream_hls_url || '',
            source: 'stream',
            streamUid: tpl.stream_uid || undefined,
            durationSec: tpl.duration_sec ?? null,
          };
      if (item.previewUrl) dispatchMovieModeAddClip(item);
      setMediaSource('library');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Template apply failed');
    } finally {
      setApplyingTemplateId(null);
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleLibrary = useMemo(() => {
    if (binTab === 'transitions' || binTab === 'effects' || binTab === 'stickers' || binTab === 'templates') {
      return library.filter((i) => {
        const metaTab = (i as MediaLibraryItem & { binTab?: string }).binTab;
        return metaTab === binTab;
      });
    }
    return library;
  }, [library, binTab]);

  const onUploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setErr(null);
    const slug = projectSlug || 'imports';
    try {
      for (const file of Array.from(files)) {
        const kind = detectFileKind({ name: file.name, contentType: file.type, size: file.size });
        const mediaKind =
          kind === 'video' || kind === 'audio' || kind === 'image' ? kind : 'binary';
        const key = `moviemode/${projectId || 'draft'}/${slug}/source/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`;
        const up = await uploadFileToR2({
          bucket: 'inneranimalmedia',
          key,
          file,
          contentType: file.type,
        });
        if (!up.ok) throw new Error(up.error || 'Upload failed');
        await fetch('/api/media/assets/register', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bucket: 'inneranimalmedia',
            object_key: key,
            filename: file.name,
            content_type: file.type,
            media_kind: mediaKind,
            project_id: projectId || null,
            transcribe: mediaKind === 'video' || mediaKind === 'audio',
          }),
        });
      }
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const importStream = async (video: StreamVideo) => {
    setImportingUid(video.uid);
    setErr(null);
    try {
      const res = await fetch('/api/stream/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream_uid: video.uid,
          filename: video.name,
          project_id: projectId || null,
          project_slug: projectSlug || 'imports',
          transcribe: true,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Import failed');
      setMediaSource('library');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImportingUid(null);
    }
  };

  const deleteAsset = async (item: MediaLibraryItem) => {
    if (!item.assetId) return;
    if (!window.confirm(`Delete "${item.name}" from library?`)) return;
    setMenuId(null);
    try {
      const res = await fetch(`/api/media/assets/${encodeURIComponent(item.assetId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Delete failed');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const saveRename = async (item: MediaLibraryItem) => {
    if (!item.assetId) return;
    const name = renameValue.trim();
    if (!name) return;
    try {
      const res = await fetch(`/api/media/assets/${encodeURIComponent(item.assetId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: name }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Rename failed');
      setRenameId(null);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Rename failed');
    }
  };

  const onDragStart = (e: React.DragEvent, item: MediaLibraryItem) => {
    e.dataTransfer.setData(MOVIEMODE_CLIP_DRAG, JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const placeholderCopy =
    binTab === 'transitions'
      ? 'Save transition presets to your library to reuse across projects.'
      : binTab === 'effects'
        ? 'Effect presets and LUTs will appear here.'
        : binTab === 'stickers'
          ? 'Sticker packs and PNG overlays — upload or import to build your kit.'
          : binTab === 'templates'
            ? 'Full timeline templates for MeauxCLOUD launch, AB show, and brand cuts.'
            : binTab === 'text'
              ? 'Lower thirds, titles, and caption assets.'
              : null;

  const sourceTabs = (
    <div className="flex gap-1 px-2 py-1.5 border-b border-[var(--border-subtle)]">
      {(
        [
          { id: 'library' as const, label: 'Library', icon: <HardDrive size={12} /> },
          { id: 'stream' as const, label: 'Stream', icon: <Cloud size={12} /> },
          { id: 'uploads' as const, label: 'Upload', icon: <Upload size={12} /> },
        ] as const
      ).map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => {
            if (s.id === 'uploads') fileInputRef.current?.click();
            else setMediaSource(s.id);
          }}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium ${
            mediaSource === s.id
              ? 'bg-[var(--bg-hover)] text-[var(--solar-cyan)]'
              : 'text-muted hover:text-main'
          }`}
        >
          {s.icon}
          {s.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--dashboard-panel)]">
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--dashboard-border)]">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted">
            Media bin
          </p>
          <p className="text-[10px] text-muted capitalize">{binTab}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Upload files"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 rounded-md bg-[var(--solar-cyan)]/15 text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/25 disabled:opacity-40"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          </button>
          <button
            type="button"
            title="Refresh"
            onClick={() => void refresh()}
            className="p-1.5 rounded-md text-muted hover:text-main hover:bg-[var(--bg-hover)]"
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </div>

      <div className="px-2 py-1.5 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-1.5 rounded-md border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-2 py-1">
          <Search size={12} className="text-muted shrink-0" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search media…"
            className="flex-1 bg-transparent text-[11px] text-main outline-none placeholder:text-muted"
          />
          {searchQuery ? (
            <button type="button" onClick={() => setSearchQuery('')} className="text-muted">
              <X size={12} />
            </button>
          ) : null}
        </div>
      </div>

      {(binTab === 'media' || binTab === 'audio') && sourceTabs}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={
          binTab === 'audio'
            ? 'audio/*'
            : binTab === 'text'
              ? '.srt,.vtt,.txt,text/plain'
              : 'video/*,audio/*,image/*'
        }
        className="hidden"
        onChange={(e) => void onUploadFiles(e.target.files)}
      />

      {err ? <p className="px-3 py-2 text-[10px] text-red-400">{err}</p> : null}
      {loading ? (
        <div className="flex items-center gap-2 p-4 text-[11px] text-muted">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {placeholderCopy && visibleLibrary.length === 0 && mediaSource !== 'stream' ? (
          <p className="text-[11px] text-muted leading-relaxed px-1 py-2">{placeholderCopy}</p>
        ) : null}

        {binTab === 'templates' ? (
          <div className="space-y-3">
            <p className="text-[11px] text-muted px-1 leading-relaxed">
              <strong className="text-main">IAM Starter B-Roll (Free)</strong> — platform
              clips for all workspaces. Apply imports from Stream → your library, then adds to
              timeline.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="rounded-lg border border-[var(--dashboard-border)] overflow-hidden bg-[var(--scene-bg)]"
                >
                  <div className="aspect-video bg-black/40 relative">
                    {tpl.thumbnail_url ? (
                      <img
                        src={tpl.thumbnail_url}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <Film size={24} className="m-auto text-[var(--solar-cyan)] absolute inset-0 self-center justify-self-center" />
                    )}
                    <span className="absolute bottom-1 right-1 text-[9px] px-1 py-0.5 rounded bg-black/70 text-white">
                      {formatDur(tpl.duration_sec)}
                    </span>
                    {tpl.is_free ? (
                      <span className="absolute top-1 left-1 text-[8px] px-1 py-0.5 rounded bg-[var(--solar-cyan)]/90 text-[#0a0f14] font-semibold">
                        FREE
                      </span>
                    ) : null}
                  </div>
                  <div className="p-1.5">
                    <p className="text-[10px] text-main truncate" title={tpl.title}>
                      {tpl.title}
                    </p>
                    <button
                      type="button"
                      disabled={applyingTemplateId === tpl.id}
                      onClick={() => void applyTemplate(tpl)}
                      className="mt-1 w-full text-[9px] py-1 rounded bg-[var(--solar-cyan)]/20 text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/30 disabled:opacity-40"
                    >
                      {applyingTemplateId === tpl.id ? 'Importing…' : 'Use template'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {!loading && templates.length === 0 ? (
              <p className="text-[11px] text-muted px-1">
                No templates yet — run migration 617 on D1.
              </p>
            ) : null}
          </div>
        ) : mediaSource === 'stream' && (binTab === 'media' || binTab === 'audio') ? (
          <div className="grid grid-cols-2 gap-2">
            {streamVideos.map((v) => (
              <div
                key={v.uid}
                className="group relative rounded-lg border border-[var(--dashboard-border)] overflow-hidden bg-[var(--scene-bg)]"
              >
                <div className="aspect-video bg-black/40 relative">
                  <img
                    src={v.thumbnail}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <span className="absolute bottom-1 right-1 text-[9px] px-1 py-0.5 rounded bg-black/70 text-white">
                    {formatDur(v.duration_sec)}
                  </span>
                </div>
                <div className="p-1.5">
                  <p className="text-[10px] text-main truncate" title={v.name}>
                    {v.name}
                  </p>
                  <div className="flex gap-1 mt-1">
                    <button
                      type="button"
                      disabled={importingUid === v.uid}
                      onClick={() => void importStream(v)}
                      className="flex-1 text-[9px] py-1 rounded bg-[var(--solar-cyan)]/20 text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/30 disabled:opacity-40"
                    >
                      {importingUid === v.uid ? 'Importing…' : 'Import'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {!loading && streamVideos.length === 0 ? (
              <p className="col-span-2 text-[11px] text-muted">No Stream videos found.</p>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {visibleLibrary.map((item) => (
              <div
                key={item.id}
                draggable
                onDragStart={(e) => onDragStart(e, item)}
                className="group relative rounded-lg border border-[var(--dashboard-border)] overflow-hidden bg-[var(--scene-bg)] hover:border-[var(--solar-cyan)]/40"
              >
                <div className="aspect-video bg-black/30 flex items-center justify-center relative">
                  {item.kind === 'image' ? (
                    <img src={item.previewUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : item.kind === 'audio' ? (
                    <Music size={24} className="text-[var(--solar-magenta)]" />
                  ) : (
                    <Film size={24} className="text-[var(--solar-cyan)]" />
                  )}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 flex items-center justify-center gap-1">
                    <button
                      type="button"
                      title="Add to timeline"
                      onClick={() => dispatchMovieModeAddClip(item)}
                      className="p-1.5 rounded-full bg-[var(--solar-cyan)] text-[#0a0f14]"
                    >
                      <Plus size={12} />
                    </button>
                    <button
                      type="button"
                      title="Preview"
                      onClick={() => dispatchMovieModePreviewClip(item)}
                      className="p-1.5 rounded-full bg-white/20 text-white"
                    >
                      <Play size={12} />
                    </button>
                  </div>
                </div>
                <div className="p-1.5 flex items-start gap-1">
                  {renameId === item.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveRename(item);
                        if (e.key === 'Escape') setRenameId(null);
                      }}
                      onBlur={() => void saveRename(item)}
                      className="flex-1 text-[10px] bg-[var(--bg-hover)] rounded px-1 py-0.5 outline-none"
                    />
                  ) : (
                    <p className="flex-1 text-[10px] text-main truncate" title={item.name}>
                      {item.name}
                    </p>
                  )}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setMenuId(menuId === item.id ? null : item.id)}
                      className="p-0.5 rounded text-muted hover:text-main"
                    >
                      <MoreHorizontal size={12} />
                    </button>
                    {menuId === item.id ? (
                      <div className="absolute right-0 top-full z-20 mt-0.5 min-w-[120px] rounded-md border border-[var(--dashboard-border)] bg-[var(--bg-elevated)] shadow-lg py-1">
                        <button
                          type="button"
                          className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] hover:bg-[var(--bg-hover)]"
                          onClick={() => {
                            setRenameId(item.id);
                            setRenameValue(item.name);
                            setMenuId(null);
                          }}
                        >
                          <Pencil size={10} /> Rename
                        </button>
                        <button
                          type="button"
                          className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] text-red-400 hover:bg-[var(--bg-hover)]"
                          onClick={() => void deleteAsset(item)}
                        >
                          <Trash2 size={10} /> Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {!loading && visibleLibrary.length === 0 && !placeholderCopy ? (
              <p className="col-span-2 text-[11px] text-muted px-1">
                No items yet — tap <strong className="text-main">+</strong> to upload or
                open <strong className="text-main">Stream</strong> to import Cloudflare clips.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
