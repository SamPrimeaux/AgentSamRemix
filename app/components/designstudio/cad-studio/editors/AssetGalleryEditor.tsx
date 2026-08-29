import React, { useRef, useState } from 'react';
import { useStudioGallery, resolveGalleryCadJobId } from '../useStudioGallery';
import type { GalleryItem } from '../cadStudioTypes';
import { GlbAssetThumb } from './GlbAssetThumb';
import {
  LayoutGrid, Box, FileStack, Zap, Funnel, SquareMousePointer, Upload, RefreshCw, X,
} from 'lucide-react';

export type AssetGalleryEditorProps = {
  onSpawn: (item: GalleryItem) => void;
  onUpload?: (file: File) => void;
  variant?: 'panel' | 'library';
};

type SourceFilter = 'all' | 'stock' | 'mine' | 'job' | 'meshy';

const FILTER_ICONS: { key: SourceFilter; Icon: React.ElementType; label: string }[] = [
  { key: 'all',   Icon: LayoutGrid,         label: 'All assets' },
  { key: 'stock', Icon: Box,                label: 'Stock models' },
  { key: 'mine',  Icon: FileStack,          label: 'My generations' },
  { key: 'job',   Icon: Zap,               label: 'Job outputs' },
  { key: 'meshy', Icon: Funnel,            label: 'Meshy' },
];

export function AssetGalleryEditor({ onSpawn, onUpload, variant = 'panel' }: AssetGalleryEditorProps) {
  const gallery = useStudioGallery({ mode: 'full', autoFetch: true });
  const fileRef = useRef<HTMLInputElement>(null);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const toggleItem = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <section
      className={`cad-editor cad-editor--assets${variant === 'library' ? ' cad-editor--assets-library' : ''}`}
    >
      {/* ── Head: search + upload ── */}
      <div className="cad-studio__panel-head cad-assets__head">
        <input
          className="cad-studio__search"
          placeholder="Search GLBs…"
          value={gallery.filter}
          onChange={(e) => gallery.setFilter(e.target.value)}
        />
        <button
          type="button"
          className="cad-studio__icon-btn"
          onClick={() => fileRef.current?.click()}
          title="Upload GLB"
        >
          <Upload size={14} strokeWidth={1.75} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".glb,.gltf"
          className="cad-editor__hidden-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload?.(f);
            e.target.value = '';
          }}
        />
      </div>

      {/* ── Icon filter bar ── */}
      <div className="cad-assets__icon-filters">
        {FILTER_ICONS.map(({ key, Icon, label }) => (
          <button
            key={key}
            type="button"
            className={`cad-assets__icon-filter${gallery.sourceFilter === key ? ' active' : ''}`}
            onClick={() => gallery.setSourceFilter(key)}
            title={label}
            aria-pressed={gallery.sourceFilter === key}
          >
            <Icon size={15} strokeWidth={1.75} />
          </button>
        ))}

        {/* divider */}
        <span className="cad-assets__filter-sep" />

        {/* multi-select */}
        <button
          type="button"
          className={`cad-assets__icon-filter${multiSelect ? ' active' : ''}`}
          onClick={() => { setMultiSelect(v => !v); setSelected(new Set()); }}
          title="Multi-select"
          aria-pressed={multiSelect}
        >
          <SquareMousePointer size={15} strokeWidth={1.75} />
        </button>

        {/* refresh */}
        <button
          type="button"
          className="cad-assets__icon-filter"
          onClick={() => void gallery.refresh()}
          title="Refresh"
        >
          <RefreshCw size={14} strokeWidth={1.75} />
        </button>

        {gallery.total > 0 && (
          <span className="cad-assets__count">{gallery.total}</span>
        )}
      </div>

      {/* multi-select action bar */}
      {multiSelect && selected.size > 0 && (
        <div className="cad-assets__multibar">
          <span>{selected.size} selected</span>
          <button
            type="button"
            className="cad-studio__icon-btn"
            onClick={() => {
              gallery.items
                .filter(i => selected.has(i.id))
                .forEach(i => onSpawn(i));
              setSelected(new Set());
            }}
          >
            Spawn All
          </button>
        </div>
      )}

      {/* ── Grid ── */}
      <div className="cad-assets__scroll">
        {gallery.loading && <p className="cad-editor__hint cad-assets__status">Loading assets…</p>}
        {gallery.error && <p className="cad-editor__hint cad-editor__hint--error cad-assets__status">{gallery.error}</p>}
        {!gallery.loading && gallery.items.length === 0 && (
          <p className="cad-editor__hint cad-assets__status">No GLBs yet — upload or generate.</p>
        )}
        <div className="cad-assets__grid">
          {gallery.items.map((item) => {
            const isSelected = selected.has(item.id);
            const spawnable = !item.pending && item.url;
            return (
              <div
                key={item.id}
                className={`cad-assets__card-wrap${item.pending ? ' cad-assets__card-wrap--pending' : ''}`}
              >
                <button
                  type="button"
                  className={`cad-assets__card${isSelected ? ' selected' : ''}${item.pending ? ' cad-assets__card--pending' : ''}`}
                  onClick={() => {
                    if (!spawnable) return;
                    if (multiSelect) toggleItem(item.id);
                    else onSpawn(item);
                  }}
                  disabled={!spawnable && !multiSelect}
                  title={item.name}
                >
                  {multiSelect && spawnable && (
                    <span className={`cad-assets__check${isSelected ? ' checked' : ''}`} aria-hidden />
                  )}
                  <div className="cad-assets__thumb">
                    <GlbAssetThumb url={item.url} thumbnail={item.thumbnail} alt={item.name} />
                    {item.pending ? (
                      <span className="cad-assets__pending-overlay" aria-hidden>
                        {item.progressPct != null && item.progressPct > 0
                          ? `${Math.min(100, item.progressPct)}%`
                          : item.status || '…'}
                      </span>
                    ) : null}
                  </div>
                  <div className="cad-assets__meta">
                    <span className="cad-assets__name">{item.name}</span>
                    <span className="cad-assets__source">{item.source}</span>
                  </div>
                </button>
                {item.pending && (resolveGalleryCadJobId(item) || item.externalTaskId) ? (
                  <button
                    type="button"
                    className="cad-assets__cancel"
                    aria-label={`Cancel ${item.name}`}
                    title="Cancel job"
                    disabled={cancellingId === item.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCancellingId(item.id);
                      void gallery.dismissPending(item).finally(() => setCancellingId(null));
                    }}
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
