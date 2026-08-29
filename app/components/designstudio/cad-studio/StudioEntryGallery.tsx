/**
 * Compact in-progress jobs + optional asset library on the Design Studio entry screen.
 * Assets load lazily via folder-bookmark toggle (no stock grid on initial paint).
 */
import React, { useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { designStudioBimGalleryItem } from '../../../lib/designStudioBimExample';
import { useStudioGallery, resolveGalleryCadJobId } from './useStudioGallery';
import type { GalleryItem } from './cadStudioTypes';
import { GlbAssetThumb } from './editors/GlbAssetThumb';
import { FolderBookmarkIcon } from './FolderBookmarkIcon';

export type StudioEntryGalleryProps = {
  onSpawnStock?: (name: string, url: string, scale: number) => void;
  onCancelJob?: (cadJobId: string) => void;
  generating?: boolean;
  activeJobLabel?: string;
  activeProgressPct?: number;
  activeJobId?: string | null;
  libraryOpen?: boolean;
  onLibraryOpenChange?: (open: boolean) => void;
};

function GalleryCard({
  item,
  onSpawn,
  onCancel,
  cancelling,
}: {
  item: GalleryItem;
  onSpawn?: (item: GalleryItem) => void;
  onCancel?: (item: GalleryItem) => void;
  cancelling?: boolean;
}) {
  const disabled = item.pending || !item.url;
  const pct = item.progressPct != null ? Math.min(100, Math.max(0, item.progressPct)) : 0;
  const cadJobId = resolveGalleryCadJobId(item);
  const canCancel = Boolean(item.pending && (cadJobId || item.externalTaskId));
  const statusLabel =
    String(item.status || '').toLowerCase() === 'script_ready' ? 'Script ready' : null;

  return (
    <div className="studio-entry__gallery-card-wrap">
      <button
        type="button"
        className={`studio-entry__gallery-card${item.pending ? ' studio-entry__gallery-card--pending' : ''}`}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onSpawn?.(item);
        }}
        title={item.name}
      >
        <div className="studio-entry__gallery-thumb">
          <GlbAssetThumb url={item.url} thumbnail={item.thumbnail} alt={item.name} />
          {item.pending ? (
            <span className="studio-entry__gallery-pending" aria-hidden>
              {statusLabel ? (
                <span className="studio-entry__gallery-status">{statusLabel}</span>
              ) : pct > 0 ? (
                <span className="studio-entry__gallery-pct">{pct}%</span>
              ) : (
                <Loader2 size={16} className="studio-entry__spin" />
              )}
            </span>
          ) : null}
        </div>
        <span className="studio-entry__gallery-name">{item.name}</span>
      </button>
      {canCancel ? (
        <button
          type="button"
          className="studio-entry__gallery-cancel"
          aria-label={`Cancel ${item.name}`}
          title="Cancel job"
          disabled={cancelling}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void onCancel?.(item);
          }}
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}

export function StudioEntryGallery({
  onSpawnStock,
  onCancelJob,
  generating,
  activeJobLabel,
  activeProgressPct,
  activeJobId,
  libraryOpen: libraryOpenProp,
  onLibraryOpenChange,
}: StudioEntryGalleryProps) {
  const gallery = useStudioGallery({ mode: 'entry', autoFetch: true });
  const [libraryOpenInternal, setLibraryOpenInternal] = useState(false);
  const libraryOpen = libraryOpenProp ?? libraryOpenInternal;
  const setLibraryOpen = onLibraryOpenChange ?? setLibraryOpenInternal;
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const bimExample = useMemo(() => designStudioBimGalleryItem(), []);

  const stockItems = useMemo(
    () => gallery.items.filter((i) => i.source === 'stock' || i.source === 'mine'),
    [gallery.items],
  );

  const pendingItems = useMemo(
    () => gallery.items.filter((i) => i.pending && i.source !== 'stock' && i.source !== 'mine'),
    [gallery.items],
  );

  const showGenerating =
    generating &&
    Boolean(activeJobLabel) &&
    !pendingItems.some((i) => resolveGalleryCadJobId(i) === activeJobId);

  const toggleLibrary = () => {
    const next = !libraryOpen;
    if (next && !gallery.assetsLoaded) void gallery.refreshAssets();
    setLibraryOpen(next);
  };

  React.useEffect(() => {
    if (libraryOpen && !gallery.assetsLoaded) void gallery.refreshAssets();
  }, [libraryOpen, gallery.assetsLoaded, gallery.refreshAssets]);

  const handleSpawn = (item: GalleryItem) => {
    if (!item.url) return;
    const scale =
      item.scale != null && Number.isFinite(item.scale) ? item.scale : 1;
    onSpawnStock?.(item.name, item.url, scale);
  };

  const handleCancel = async (item: GalleryItem) => {
    setCancellingId(item.id);
    try {
      await gallery.dismissPending(item);
      const cadJobId = resolveGalleryCadJobId(item);
      if (cadJobId) onCancelJob?.(cadJobId);
    } catch (e) {
      console.warn('[StudioEntryGallery] cancel failed', e);
    } finally {
      setCancellingId(null);
    }
  };

  const hasCreating = pendingItems.length > 0 || showGenerating;

  return (
    <div className="studio-entry__gallery" aria-label="Design Studio jobs and assets">
      <div className="studio-entry__gallery-section">
        <p className="studio-entry__gallery-label">Proof models</p>
        <div className="studio-entry__gallery-grid">
          <div className="studio-entry__gallery-card-wrap studio-entry__gallery-card-wrap--featured">
            <GalleryCard item={bimExample} onSpawn={handleSpawn} />
            <span className="studio-entry__gallery-badge">FreeCAD · BIM</span>
          </div>
        </div>
      </div>

      {hasCreating ? (
        <div className="studio-entry__gallery-section">
          <p className="studio-entry__gallery-label">Creating</p>
          <div className="studio-entry__gallery-grid">
            {pendingItems.map((item) => (
              <GalleryCard
                key={item.id}
                item={item}
                onCancel={(i) => void handleCancel(i)}
                cancelling={cancellingId === item.id}
              />
            ))}
            {showGenerating ? (
              <div className="studio-entry__gallery-card-wrap">
                <div className="studio-entry__gallery-card studio-entry__gallery-card--pending studio-entry__gallery-card--static">
                  <div className="studio-entry__gallery-thumb">
                    <span className="cad-assets__thumb-placeholder">
                      <Loader2 size={18} className="studio-entry__spin" />
                    </span>
                    {activeProgressPct != null && activeProgressPct > 0 ? (
                      <span className="studio-entry__gallery-pending">
                        <span className="studio-entry__gallery-pct">
                          {Math.min(100, activeProgressPct)}%
                        </span>
                      </span>
                    ) : null}
                  </div>
                  <span className="studio-entry__gallery-name">{activeJobLabel}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {libraryOpen ? (
        <div className="studio-entry__library-toggle-row">
          <button
            type="button"
            className="studio-entry__library-toggle studio-entry__library-toggle--open"
            onClick={toggleLibrary}
            aria-expanded={libraryOpen}
            aria-controls="studio-entry-asset-library"
          >
            <FolderBookmarkIcon size={20} stroke="currentColor" />
            <span>Hide asset library</span>
            {gallery.assetsLoading ? (
              <Loader2 size={14} className="studio-entry__spin" aria-hidden />
            ) : null}
          </button>
        </div>
      ) : null}

      {libraryOpen ? (
        <div
          id="studio-entry-asset-library"
          className="studio-entry__gallery-section studio-entry__gallery-section--library"
        >
          <p className="studio-entry__gallery-label">Stock library</p>
          {gallery.assetsLoading && stockItems.length === 0 ? (
            <p className="studio-entry__gallery-hint">Loading assets…</p>
          ) : null}
          {!gallery.assetsLoading && stockItems.length === 0 ? (
            <p className="studio-entry__gallery-hint">No stock assets found.</p>
          ) : null}
          {stockItems.length > 0 ? (
            <div className="studio-entry__gallery-grid">
              {stockItems.map((item) => (
                <GalleryCard key={item.id} item={item} onSpawn={handleSpawn} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
