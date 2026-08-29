import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { DrawLibraryRow } from '../../lib/excalidrawLibraries';
import {
  fetchDrawLibraryCatalog,
  fetchDrawLibraryPrefs,
  saveDrawLibraryPrefs,
} from '../../lib/excalidrawLibraries';

export type DrawLibraryPanelProps = {
  open: boolean;
  onClose: () => void;
  onApply: (enabledSlugs: string[]) => void;
};

export function DrawLibraryPanel({ open, onClose, onApply }: DrawLibraryPanelProps) {
  const [catalog, setCatalog] = useState<DrawLibraryRow[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, prefs] = await Promise.all([fetchDrawLibraryCatalog(), fetchDrawLibraryPrefs()]);
      setCatalog(rows);
      const prefMap = new Map(prefs.map((p) => [p.slug, p.enabled]));
      const next = new Set<string>();
      if (prefMap.size > 0) {
        for (const row of rows) {
          if (prefMap.get(row.slug)) next.add(row.slug);
        }
      } else {
        for (const row of rows) {
          if (row.auto_load === 1 || row.auto_load === true) next.add(row.slug);
        }
      }
      setEnabled(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const grouped = useMemo(() => {
    const map = new Map<string, DrawLibraryRow[]>();
    for (const row of catalog) {
      const cat = row.category?.trim() || 'General';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(row);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [catalog]);

  const toggle = (slug: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const slugs = [...enabled];
      await saveDrawLibraryPrefs(slugs);
      onApply(slugs);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="draw-library-panel" role="dialog" aria-label="Excalidraw libraries">
      <div className="draw-library-panel__header">
        <h2 className="draw-library-panel__title">Shape libraries</h2>
        <p className="draw-library-panel__subtitle">
          Enable template packs for mockups, architecture, UML, and wireframes. Applied when you open the canvas.
        </p>
      </div>
      {loading ? (
        <div className="draw-library-panel__loading" aria-busy="true">
          <div className="draw-library-panel__skeleton-row" />
          <div className="draw-library-panel__skeleton-row" />
          <div className="draw-library-panel__skeleton-row" />
          <div className="draw-library-panel__skeleton-row" style={{ width: '62%' }} />
        </div>
      ) : (
        <div className="draw-library-panel__body">
          {grouped.map(([category, rows]) => (
            <section key={category} className="draw-library-panel__section">
              <h3 className="draw-library-panel__category">{category}</h3>
              <ul className="draw-library-panel__list">
                {rows.map((row) => {
                  const on = enabled.has(row.slug);
                  return (
                    <li key={row.slug}>
                      <label className="draw-library-panel__row">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(row.slug)}
                        />
                        <span className="draw-library-panel__name">{row.name}</span>
                        {row.item_count != null ? (
                          <span className="draw-library-panel__meta">{row.item_count} items</span>
                        ) : null}
                        {row.auto_load === 1 || row.auto_load === true ? (
                          <span className="draw-library-panel__badge">Default</span>
                        ) : null}
                      </label>
                      {row.description ? (
                        <p className="draw-library-panel__desc">{row.description}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <div className="draw-library-panel__actions">
        <button type="button" className="iam-chat-startup-chip" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="iam-chat-startup-chip"
          disabled={saving || loading}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : 'Apply & open canvas'}
        </button>
      </div>
    </div>
  );
}
