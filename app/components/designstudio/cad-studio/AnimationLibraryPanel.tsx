import React, { useEffect, useMemo, useState } from 'react';
import { Clapperboard, Search, X } from 'lucide-react';

export type AnimationClip = {
  action_id: number;
  name: string;
  category?: string;
  glb_url?: string | null;
  pack_source?: 'character' | 'catalog';
  ready?: boolean;
  job_id?: string;
};

export type AnimationLibraryPanelProps = {
  clips: AnimationClip[];
  /** Character-scoped packs for the selected/rigged entity. */
  characterPacks?: AnimationClip[];
  selectedActionId: number | null;
  addedActionIds: number[];
  onSelect: (clip: AnimationClip) => void;
  onToggleAdded: (actionId: number) => void;
  /** Apply selected clip via Meshy API (or spawn ready GLB). */
  onApplySelected?: (clip: AnimationClip) => void | Promise<void>;
  applyBusy?: boolean;
  onClose?: () => void;
  loading?: boolean;
  characterLoading?: boolean;
  rigTaskId?: string | null;
};

const FALLBACK_CLIPS: AnimationClip[] = [
  { action_id: 92, name: 'Walking', pack_source: 'catalog' },
  { action_id: 93, name: 'Running', pack_source: 'catalog' },
  { action_id: 94, name: 'Idle', pack_source: 'catalog' },
  { action_id: 95, name: 'Jump', pack_source: 'catalog' },
  { action_id: 96, name: 'Wave', pack_source: 'catalog' },
  { action_id: 97, name: 'Air Squat', pack_source: 'catalog' },
  { action_id: 98, name: 'Agree Gesture', pack_source: 'catalog' },
  { action_id: 99, name: 'Alert', pack_source: 'catalog' },
];

export function AnimationLibraryPanel({
  clips,
  characterPacks = [],
  selectedActionId,
  addedActionIds,
  onSelect,
  onToggleAdded,
  onApplySelected,
  applyBusy = false,
  onClose,
  loading = false,
  characterLoading = false,
  rigTaskId = null,
}: AnimationLibraryPanelProps) {
  const hasCharacter = Boolean(rigTaskId) || characterPacks.length > 0;
  const [tab, setTab] = useState<'character' | 'library' | 'added'>('library');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (hasCharacter) setTab((prev) => (prev === 'added' ? prev : 'character'));
  }, [rigTaskId]); // only when rig identity changes

  const catalog = clips.length > 0 ? clips : FALLBACK_CLIPS;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list: AnimationClip[];
    if (tab === 'character') list = characterPacks;
    else if (tab === 'added') {
      const pool = [...characterPacks, ...catalog];
      const seen = new Set<number>();
      list = pool.filter((c) => {
        if (!addedActionIds.includes(c.action_id) || seen.has(c.action_id)) return false;
        seen.add(c.action_id);
        return true;
      });
    } else list = catalog;
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }, [tab, characterPacks, catalog, addedActionIds, search]);

  const selectedClip = useMemo(() => {
    const pool = [...characterPacks, ...catalog];
    return pool.find((c) => c.action_id === selectedActionId) ?? null;
  }, [characterPacks, catalog, selectedActionId]);

  const applyLabel = (() => {
    if (applyBusy) return 'Applying…';
    if (selectedClip?.ready && selectedClip.glb_url) return 'Spawn pack GLB';
    return 'Apply clip (Meshy)';
  })();

  return (
    <aside className="cad-editor cad-editor--animation-library">
      <div className="cad-anim-lib__head">
        <div className="cad-anim-lib__tabs" role="tablist">
          {hasCharacter ? (
            <button
              type="button"
              role="tab"
              className={`cad-anim-lib__tab${tab === 'character' ? ' active' : ''}`}
              onClick={() => setTab('character')}
            >
              Character
            </button>
          ) : null}
          <button
            type="button"
            role="tab"
            className={`cad-anim-lib__tab${tab === 'library' ? ' active' : ''}`}
            onClick={() => setTab('library')}
          >
            Library
          </button>
          <button
            type="button"
            role="tab"
            className={`cad-anim-lib__tab${tab === 'added' ? ' active' : ''}`}
            onClick={() => setTab('added')}
          >
            Added
          </button>
        </div>
        {onClose ? (
          <button
            type="button"
            className="cad-anim-lib__close"
            onClick={onClose}
            title="Close Animation Library"
            aria-label="Close Animation Library"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      <div className="cad-anim-lib__search-wrap">
        <Search size={12} className="cad-anim-lib__search-icon" />
        <input
          className="cad-anim-lib__search"
          placeholder={tab === 'character' ? 'Search character packs' : 'Search animation'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {tab === 'character' && rigTaskId ? (
        <p className="cad-anim-lib__hint" title={rigTaskId}>
          Rig {rigTaskId.slice(0, 8)}…
        </p>
      ) : null}
      <div className="cad-anim-lib__body">
        {tab === 'character' && characterLoading ? (
          <p className="cad-anim-lib__empty">Loading character packs…</p>
        ) : loading && tab === 'library' ? (
          <p className="cad-anim-lib__empty">Loading animations…</p>
        ) : filtered.length === 0 ? (
          <p className="cad-anim-lib__empty">
            {tab === 'character'
              ? rigTaskId
                ? 'No packs for this character yet. Pick a clip in Library and Apply.'
                : 'Select a rigged character to see its packs.'
              : tab === 'added'
                ? 'No added animations yet.'
                : 'No animations match your search.'}
          </p>
        ) : (
          <div className="cad-anim-lib__grid">
            {filtered.map((clip) => {
              const active = selectedActionId === clip.action_id;
              const added = addedActionIds.includes(clip.action_id);
              return (
                <button
                  key={`${clip.pack_source || 'c'}-${clip.action_id}-${clip.name}`}
                  type="button"
                  className={`cad-anim-lib__card${active ? ' active' : ''}${clip.ready ? ' ready' : ''}`}
                  onClick={() => onSelect(clip)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onToggleAdded(clip.action_id);
                  }}
                  title={
                    clip.ready
                      ? 'Ready — Apply spawns this pack GLB'
                      : added
                        ? 'Right-click to remove from Added'
                        : 'Right-click to add to Added'
                  }
                >
                  <span className="cad-anim-lib__silhouette" aria-hidden="true" />
                  <span className="cad-anim-lib__label">
                    <Clapperboard size={10} className="cad-anim-lib__label-icon" />
                    <span className="cad-anim-lib__label-text">{clip.name}</span>
                  </span>
                  {clip.ready ? <span className="cad-anim-lib__badge cad-anim-lib__badge--ready">Ready</span> : null}
                  {!clip.ready && added ? <span className="cad-anim-lib__badge">+</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {onApplySelected ? (
        <div className="cad-anim-lib__footer">
          <button
            type="button"
            className="cad-studio__primary-btn"
            disabled={applyBusy || selectedActionId == null}
            onClick={() => {
              if (selectedClip) void onApplySelected(selectedClip);
            }}
          >
            {applyLabel}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
