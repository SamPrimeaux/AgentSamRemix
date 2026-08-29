/**
 * Compact CMS image picker — reuses /api/images (CF Images + tags) scoped by project_slug.
 */
import React, { useCallback, useEffect, useState } from 'react';

type PickerImage = {
  id: string;
  filename?: string;
  variants?: string[];
  urls?: { public?: string; avatar?: string };
  url?: string;
  meta?: { project_slug?: string; label?: string };
  tags?: string[];
};

function deliveryUrl(img: PickerImage): string {
  return (
    img.urls?.public ||
    img.urls?.avatar ||
    img.variants?.[0] ||
    img.url ||
    ''
  );
}

type Props = {
  projectSlug: string;
  open: boolean;
  onClose: () => void;
  onSelect: (url: string, image: PickerImage) => void;
  /** Tag/link selected image onto this project_slug before returning URL. */
  linkOnSelect?: boolean;
};

export function CmsImagePicker({
  projectSlug,
  open,
  onClose,
  onSelect,
  linkOnSelect = true,
}: Props) {
  const [scope, setScope] = useState<'site' | 'all'>('site');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PickerImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        source: 'cf_images',
        page: '1',
        per_page: '48',
      });
      if (scope === 'site' && projectSlug) params.set('project_slug', projectSlug);
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`/api/images?${params}`, { credentials: 'include', cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as {
        items?: PickerImage[];
        images?: PickerImage[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setItems(Array.isArray(data.items) ? data.items : Array.isArray(data.images) ? data.images : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load_failed');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [open, projectSlug, scope, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = useCallback(
    async (img: PickerImage) => {
      const url = deliveryUrl(img);
      if (!url) return;
      setBusyId(img.id);
      try {
        if (linkOnSelect && projectSlug) {
          await fetch(`/api/images/${encodeURIComponent(img.id)}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              project_slug: projectSlug,
              tags: Array.from(new Set([...(img.tags || []), 'cms', 'branding'])),
            }),
          }).catch(() => null);
        }
        onSelect(url, img);
        onClose();
      } finally {
        setBusyId(null);
      }
    },
    [linkOnSelect, onClose, onSelect, projectSlug],
  );

  if (!open) return null;

  return (
    <div className="ts-media-picker" role="dialog" aria-label="Choose image">
      <button type="button" className="ts-media-picker__backdrop" aria-label="Close" onClick={onClose} />
      <div className="ts-media-picker__panel">
        <div className="ts-media-picker__head">
          <strong>Media library</strong>
          <button type="button" className="ts-icon-btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="ts-media-picker__filters">
          <button
            type="button"
            className={`ts-btn ts-btn--ghost ts-btn--sm${scope === 'site' ? ' is-active' : ''}`}
            onClick={() => setScope('site')}
          >
            This site
          </button>
          <button
            type="button"
            className={`ts-btn ts-btn--ghost ts-btn--sm${scope === 'all' ? ' is-active' : ''}`}
            onClick={() => setScope('all')}
          >
            All my library
          </button>
          <input
            className="ts-media-picker__search"
            placeholder="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {loading ? (
          <p className="ts-rail__empty">Loading…</p>
        ) : error ? (
          <p className="ts-rail__empty">{error}</p>
        ) : items.length === 0 ? (
          <p className="ts-rail__empty">
            No images{scope === 'site' ? ' tagged for this site yet — try All my library' : ''}.
          </p>
        ) : (
          <div className="ts-media-picker__grid">
            {items.map((img) => {
              const src = deliveryUrl(img);
              return (
                <button
                  key={img.id}
                  type="button"
                  className="ts-media-picker__tile"
                  disabled={!!busyId}
                  onClick={() => void pick(img)}
                  title={img.meta?.label || img.filename || img.id}
                >
                  {src ? <img src={src} alt="" /> : <span>{img.id.slice(0, 8)}</span>}
                  {busyId === img.id ? <span className="ts-media-picker__busy">…</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default CmsImagePicker;
