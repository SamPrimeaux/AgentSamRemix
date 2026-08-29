import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, ImagePlus, Search, X } from 'lucide-react';
import { fetchCfImageLibrary, type CfImagePick } from './themeTweaksModel';

export type CfImagePickerProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (img: CfImagePick) => void;
  workspaceId?: string | null;
  title?: string;
};

export function CfImagePicker({
  open,
  onClose,
  onSelect,
  workspaceId,
  title = 'Browse Cloudflare Images',
}: CfImagePickerProps): React.ReactElement | null {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<CfImagePick[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const result = await fetchCfImageLibrary(page, 60, workspaceId);
      setItems(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } finally {
      setLoading(false);
    }
  }, [open, page, workspaceId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = query.trim()
    ? items.filter((img) => {
        const q = query.trim().toLowerCase();
        const blob = `${img.name || ''} ${img.id} ${img.url}`.toLowerCase();
        return blob.includes(q);
      })
    : items;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        className="absolute inset-0 bg-[var(--text-main)]/45 backdrop-blur-[2px]"
        aria-label="Close image browser"
        onClick={onClose}
      />
      <div className="relative z-[1] flex flex-col w-full sm:max-w-2xl max-h-[min(88dvh,720px)] rounded-t-2xl sm:rounded-2xl border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--dashboard-border)] shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-main truncate">{title}</h3>
            <p className="text-[11px] text-muted">
              {total > 0 ? `${total.toLocaleString()} images in Cloudflare` : 'Loading catalog…'}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <a
              href="/dashboard/images?source=cf_images"
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[var(--dashboard-border)] text-muted hover:text-main hover:bg-[var(--bg-hover)]"
            >
              <ExternalLink size={12} />
              Media library
            </a>
            <button
              type="button"
              aria-label="Close"
              className="p-1.5 rounded-md text-muted hover:text-main hover:bg-[var(--bg-hover)]"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-4 py-2 border-b border-[var(--dashboard-border)] shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter this page…"
              className="w-full pl-8 pr-3 py-2 text-[12px] rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-canvas)] text-main"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4">
          {loading ? (
            <p className="text-[12px] text-muted text-center py-8">Loading images…</p>
          ) : filtered.length === 0 ? (
            <p className="text-[12px] text-muted text-center py-8">No images on this page.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {filtered.map((img) => (
                <button
                  key={img.id || img.url}
                  type="button"
                  title={img.name || img.url}
                  className="group rounded-lg overflow-hidden border border-[var(--dashboard-border)] hover:border-[var(--solar-cyan)] hover:ring-2 hover:ring-[var(--solar-cyan)]/30 transition-all text-left"
                  onClick={() => {
                    onSelect(img);
                    onClose();
                  }}
                >
                  <div className="aspect-square bg-[var(--dashboard-canvas)]">
                    <img
                      src={img.thumbnail_url || img.url}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="px-1.5 py-1 text-[9px] text-muted truncate font-mono">
                    {img.name || img.id.slice(0, 12)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-t border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]">
          <button
            type="button"
            disabled={page <= 1 || loading}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md border border-[var(--dashboard-border)] disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft size={14} />
            Prev
          </button>
          <span className="text-[11px] text-muted tabular-nums">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md border border-[var(--dashboard-border)] disabled:opacity-40"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function CoverImageAddButton({
  onClick,
  label = 'Add cover image',
}: {
  onClick: () => void;
  label?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-dashed border-[var(--dashboard-border)] text-muted hover:text-main hover:border-[var(--solar-cyan)] hover:bg-[var(--bg-hover)] transition-colors"
    >
      <ImagePlus size={16} strokeWidth={1.75} />
    </button>
  );
}
