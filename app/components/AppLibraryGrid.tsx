/**
 * App library grid — workspace/design cards with icon drop, hide, pin, top-4 relevance.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { EyeOff, Eye, Pin, PinOff, Plus, ImagePlus, Trash2 } from 'lucide-react';
import {
  loadAppLibraryPrefs,
  saveAppLibraryPrefs,
  rankAppLibraryIds,
  type AppLibraryPrefs,
} from '../lib/appLibraryStorage';

export type AppLibraryItem = {
  id: string;
  name: string;
  subtitle?: string;
  active?: boolean;
  lastViewedLabel?: string;
  onOpen: () => void;
};

type AppLibraryGridProps = {
  title: string;
  items: AppLibraryItem[];
  sessionUserId?: string | null;
  /** How many cards in the primary (top) row — default 4 */
  topN?: number;
  onCreate?: () => void;
  createLabel?: string;
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

export const AppLibraryGrid: React.FC<AppLibraryGridProps> = ({
  title,
  items,
  sessionUserId = null,
  topN = 4,
  onCreate,
  createLabel = 'Add workspace',
}) => {
  const [prefs, setPrefs] = useState<AppLibraryPrefs>(() => loadAppLibraryPrefs(sessionUserId));
  const [showHidden, setShowHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iconTargetRef = useRef<string | null>(null);

  const persist = useCallback(
    (next: AppLibraryPrefs) => {
      setPrefs(next);
      saveAppLibraryPrefs(sessionUserId, next);
    },
    [sessionUserId],
  );

  const byId = useMemo(() => {
    const m = new Map<string, AppLibraryItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const recentIds = useMemo(
    () => items.filter((i) => i.lastViewedLabel && i.lastViewedLabel !== '—').map((i) => i.id),
    [items],
  );

  const rankedIds = useMemo(
    () =>
      rankAppLibraryIds({
        allIds: items.map((i) => i.id),
        activeId: items.find((i) => i.active)?.id ?? null,
        recentIds,
        pins: prefs.pins,
        hidden: showHidden ? [] : prefs.hidden,
      }),
    [items, recentIds, prefs.pins, prefs.hidden, showHidden],
  );

  const visibleItems = rankedIds
    .map((id) => byId.get(id))
    .filter((x): x is AppLibraryItem => Boolean(x));

  const primary = visibleItems.slice(0, topN);
  const rest = visibleItems.slice(topN);
  const shown = expanded ? visibleItems : primary;

  const hideId = (id: string) => {
    if (prefs.hidden.includes(id)) return;
    persist({ ...prefs, hidden: [...prefs.hidden, id] });
  };
  const unhideId = (id: string) => {
    persist({ ...prefs, hidden: prefs.hidden.filter((h) => h !== id) });
  };
  const togglePin = (id: string) => {
    const pinned = prefs.pins.includes(id);
    persist({
      ...prefs,
      pins: pinned ? prefs.pins.filter((p) => p !== id) : [id, ...prefs.pins.filter((p) => p !== id)],
    });
  };

  const onDropIcon = async (id: string, file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 400_000) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      persist({ ...prefs, icons: { ...prefs.icons, [id]: dataUrl } });
    } catch {
      /* ignore */
    }
  };

  const clearIcon = (id: string) => {
    const next = { ...prefs.icons };
    delete next[id];
    persist({ ...prefs, icons: next });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <p className="text-[14px] font-medium" style={{ color: 'var(--dashboard-text)' }}>
          {title}
        </p>
        <div className="flex items-center gap-2">
          {prefs.hidden.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg"
              style={{
                border: '1px solid var(--dashboard-border)',
                color: 'var(--text-muted)',
                background: 'transparent',
              }}
            >
              {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
              {showHidden ? 'Hide archived' : `Show hidden (${prefs.hidden.length})`}
            </button>
          ) : null}
          {onCreate ? (
            <button
              type="button"
              onClick={onCreate}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg"
              style={{
                border: '1px solid color-mix(in srgb, var(--solar-cyan) 40%, transparent)',
                color: 'var(--solar-cyan)',
                background: 'transparent',
              }}
            >
              <Plus size={12} /> {createLabel}
            </button>
          ) : null}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const id = iconTargetRef.current;
          const f = e.target.files?.[0] ?? null;
          e.target.value = '';
          if (id) void onDropIcon(id, f);
        }}
      />

      {shown.length === 0 ? (
        <div
          className="rounded-xl px-4 py-10 text-center text-[12px]"
          style={{
            border: '1px solid var(--dashboard-border)',
            background: 'var(--dashboard-panel)',
            color: 'var(--text-muted)',
          }}
        >
          No apps yet — clone a repo or connect a workspace.
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}>
          {shown.map((item) => {
            const icon = prefs.icons[item.id];
            const label = prefs.labels[item.id] || item.name;
            const isHidden = prefs.hidden.includes(item.id);
            const isPinned = prefs.pins.includes(item.id);
            return (
              <div
                key={item.id}
                className="group relative flex flex-col rounded-xl overflow-hidden text-left transition-colors"
                style={{
                  background: 'var(--dashboard-panel)',
                  border: item.active
                    ? '1.5px solid var(--solar-cyan)'
                    : '1px solid var(--dashboard-border)',
                  opacity: isHidden ? 0.55 : 1,
                }}
              >
                <button
                  type="button"
                  className="flex flex-col flex-1 text-left min-h-0"
                  onClick={() => item.onOpen()}
                >
                  <div
                    className="relative flex items-center justify-center"
                    style={{
                      height: 96,
                      background: 'var(--dashboard-canvas)',
                      borderBottom: '1px solid var(--dashboard-border)',
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const f = e.dataTransfer.files?.[0] ?? null;
                      void onDropIcon(item.id, f);
                    }}
                  >
                    {icon ? (
                      <img src={icon} alt="" className="w-12 h-12 rounded-xl object-cover" />
                    ) : (
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-[16px] font-semibold"
                        style={{ background: 'var(--bg-hover)', color: 'var(--solar-cyan)' }}
                      >
                        {label.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    {item.active ? (
                      <span
                        className="absolute top-2 left-2 text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                        style={{ background: 'var(--solar-cyan)', color: '#000' }}
                      >
                        active
                      </span>
                    ) : null}
                  </div>
                  <div className="px-3 py-2.5 min-w-0">
                    <p className="text-[12px] font-medium leading-tight truncate" style={{ color: 'var(--dashboard-text)' }}>
                      {label}
                    </p>
                    <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                      {item.subtitle || item.lastViewedLabel || 'Workspace'}
                    </p>
                  </div>
                </button>

                <div
                  className="flex items-center gap-0.5 px-2 pb-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    title="Set icon (or drop image on card)"
                    className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
                    onClick={() => {
                      iconTargetRef.current = item.id;
                      fileInputRef.current?.click();
                    }}
                  >
                    <ImagePlus size={12} />
                  </button>
                  {icon ? (
                    <button
                      type="button"
                      title="Clear icon"
                      className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
                      onClick={() => clearIcon(item.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    title={isPinned ? 'Unpin' : 'Pin to top'}
                    className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
                    onClick={() => togglePin(item.id)}
                  >
                    {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
                  </button>
                  <button
                    type="button"
                    title={isHidden ? 'Unhide' : 'Hide from library'}
                    className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] ml-auto"
                    onClick={() => (isHidden ? unhideId(item.id) : hideId(item.id))}
                  >
                    {isHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rest.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-[12px] underline-offset-2 hover:underline"
          style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          {expanded ? 'Show top 4 only' : `Show ${rest.length} more`}
        </button>
      ) : null}
    </div>
  );
};
