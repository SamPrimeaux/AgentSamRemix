import React from 'react';
import { X } from 'lucide-react';
import type { DashboardHomeTile } from '../../client-api/home';
import { IconEditorControls } from './IconEditorControls';
import './HomeTileEditor.css';

const DESTINATION_OPTIONS = [
  { label: 'Agent Sam', path: '/dashboard/agent' },
  { label: 'Design Studio', path: '/dashboard/designstudio' },
  { label: 'Database', path: '/dashboard/database' },
  { label: 'CMS Suite', path: '/dashboard/cms' },
  { label: 'Artifacts', path: '/dashboard/artifacts' },
  { label: 'Integrations', path: '/dashboard/settings/integrations' },
  { label: 'Projects', path: '/dashboard/projects' },
];

export type HomeTileEditorProps = {
  tile: DashboardHomeTile;
  workspaceId?: string | null;
  onChange: (next: DashboardHomeTile) => void;
  onClose: () => void;
  onReset: () => void;
};

export function HomeTileEditor({
  tile,
  workspaceId,
  onChange,
  onClose,
  onReset,
}: HomeTileEditorProps) {
  const destValue = DESTINATION_OPTIONS.some((o) => o.path === tile.path)
    ? tile.path
    : '__custom__';

  return (
    <div className="iam-home-tile-inspector-scrim" role="presentation" onClick={onClose}>
      <aside
        className="iam-home-tile-inspector"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-tile-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="iam-home-tile-inspector-head">
          <h3 id="home-tile-editor-title">Edit app icon</h3>
          <button type="button" className="iam-section-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <IconEditorControls
          draft={{
            title: tile.title,
            subtitle: tile.cta_label,
            image_url: tile.image_url,
            icon_scale: tile.icon_scale,
            icon_bg: tile.icon_bg,
          }}
          presentation="app"
          onChange={(patch) => onChange({ ...tile, ...patch })}
          workspaceId={workspaceId}
        />

        <label className="iam-home-tile-field">
          Title
          <input
            value={tile.title}
            onChange={(e) => onChange({ ...tile, title: e.target.value })}
          />
        </label>

        <label className="iam-home-tile-field">
          Action label
          <input
            value={tile.cta_label}
            onChange={(e) => onChange({ ...tile, cta_label: e.target.value })}
          />
        </label>

        <label className="iam-home-tile-field">
          Opens
          <select
            value={destValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v !== '__custom__') onChange({ ...tile, path: v });
            }}
          >
            {DESTINATION_OPTIONS.map((o) => (
              <option key={o.path} value={o.path}>
                {o.label}
              </option>
            ))}
            <option value="__custom__">Custom path…</option>
          </select>
        </label>

        {destValue === '__custom__' ? (
          <label className="iam-home-tile-field">
            Custom path
            <input
              value={tile.path}
              onChange={(e) => onChange({ ...tile, path: e.target.value })}
              placeholder="/dashboard/…"
            />
          </label>
        ) : null}

        <footer className="iam-home-tile-inspector-foot">
          <button type="button" onClick={onReset}>
            Reset
          </button>
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </aside>
    </div>
  );
}

export const HOME_LAYOUT_STORAGE_KEY = 'iam.dashboard.home.layout.v1';

export function loadHomeLayoutDraft(workspaceId: string): DashboardHomeTile[] | null {
  try {
    const raw = localStorage.getItem(`${HOME_LAYOUT_STORAGE_KEY}:${workspaceId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tiles?: DashboardHomeTile[] };
    return Array.isArray(parsed.tiles) ? parsed.tiles : null;
  } catch {
    return null;
  }
}

export function saveHomeLayoutDraft(workspaceId: string, tiles: DashboardHomeTile[]) {
  try {
    localStorage.setItem(
      `${HOME_LAYOUT_STORAGE_KEY}:${workspaceId}`,
      JSON.stringify({ tiles, saved_at: Date.now() }),
    );
  } catch {
    /* quota */
  }
}
