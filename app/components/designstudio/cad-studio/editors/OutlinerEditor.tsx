import React, { useMemo, useState } from 'react';
import type { GameEntity } from '../../../../types';
import type { ProtocolArtifact } from '../useCadStudioProtocol';

export type OutlinerEditorProps = {
  entities: GameEntity[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  artifacts?: ProtocolArtifact[];
  onToggleVisibility?: (id: string) => void;
  onToggleSelectable?: (id: string) => void;
  onToggleRender?: (id: string) => void;
  /** Hide duplicate header when nested inside RightPanelTabs. */
  embedded?: boolean;
};

type CollectionFlags = Record<string, { visible: boolean; selectable: boolean; render: boolean }>;

export function OutlinerEditor({
  entities,
  selectedId,
  onSelect,
  artifacts = [],
  onToggleVisibility,
  onToggleSelectable,
  onToggleRender,
  embedded = false,
}: OutlinerEditorProps) {
  const [filter, setFilter] = useState('');
  const [flags, setFlags] = useState<CollectionFlags>({});

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter((e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
  }, [entities, filter]);

  const getFlags = (id: string) =>
    flags[id] ?? { visible: true, selectable: true, render: true };

  const toggle = (id: string, key: 'visible' | 'selectable' | 'render') => {
    setFlags((prev) => {
      const cur = prev[id] ?? { visible: true, selectable: true, render: true };
      const next = { ...cur, [key]: !cur[key] };
      return { ...prev, [id]: next };
    });
    if (key === 'visible') onToggleVisibility?.(id);
    if (key === 'selectable') onToggleSelectable?.(id);
    if (key === 'render') onToggleRender?.(id);
  };

  return (
    <section className={`cad-editor cad-editor--outliner${embedded ? ' cad-editor--outliner-embedded' : ''}`}>
      {embedded ? (
        <div className="cad-outliner__toolbar">
          <input
            className="cad-studio__search"
            placeholder="Search collection"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <span className="cad-outliner__count">{entities.length}</span>
        </div>
      ) : (
        <div className="cad-studio__panel-head cad-outliner__head">
          <span>Scene Collection</span>
          <input
            className="cad-studio__search"
            placeholder="Search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <span>{entities.length}</span>
        </div>
      )}
      <div className="cad-outliner__body">
        <div className="cad-studio__tree">
        <div className="cad-studio__tree-row indent-0">
          <span>▾</span>
          <span className="cad-studio__obj-icon" style={{ borderColor: '#a7b2c0' }} />
          <span>Scene Collection</span>
          <span className="cad-outliner__flags">
            <span title="Visibility">V</span>
            <span title="Selectable">S</span>
            <span title="Render">R</span>
          </span>
        </div>
        <div className="cad-studio__tree-row indent-1">
          <span>▾</span>
          <span className="cad-studio__obj-icon" style={{ borderColor: '#a7b2c0' }} />
          <span>Collection</span>
        </div>
        {filtered.map((ent) => {
          const f = getFlags(ent.id);
          return (
            <div
              key={ent.id}
              className={`cad-studio__tree-row indent-2 cad-outliner__entity${selectedId === ent.id ? ' active' : ''}`}
              onClick={() => onSelect(ent.id)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(ent.id)}
              role="button"
              tabIndex={0}
            >
              <span />
              <span className="cad-studio__obj-icon" />
              <span>{ent.name}</span>
              <span className="cad-outliner__flags">
                <button type="button" className={`cad-outliner__flag${f.visible ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(ent.id, 'visible'); }}>V</button>
                <button type="button" className={`cad-outliner__flag${f.selectable ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(ent.id, 'selectable'); }}>S</button>
                <button type="button" className={`cad-outliner__flag${f.render ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(ent.id, 'render'); }}>R</button>
              </span>
            </div>
          );
        })}
        {artifacts.length > 0 ? (
          <>
            <div className="cad-studio__tree-row indent-1">
              <span>▾</span>
              <span className="cad-studio__obj-icon" style={{ borderColor: 'var(--cs-teal)' }} />
              <span>Artifacts</span>
            </div>
            {artifacts.map((a) => (
              <div key={a.id} className="cad-studio__tree-row indent-2">
                <span />
                <span className="cad-studio__obj-icon" style={{ borderColor: 'var(--cs-teal)' }} />
                <span>{a.name}</span>
              </div>
            ))}
          </>
        ) : null}
        </div>
      </div>
    </section>
  );
}
