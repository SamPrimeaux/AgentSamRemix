import React from 'react';
import { X } from 'lucide-react';
import type { ConnectTile } from '../../client-api/connectTiles';
import { IconEditorControls } from './IconEditorControls';
import './HomeTileEditor.css';

export type ConnectIconEditorProps = {
  tile: ConnectTile;
  workspaceId?: string | null;
  onChange: (next: ConnectTile) => void;
  onClose: () => void;
  onReset: () => void;
};

export function ConnectIconEditor({
  tile,
  workspaceId,
  onChange,
  onClose,
  onReset,
}: ConnectIconEditorProps) {
  const imageUrl = tile.custom_icon_url || tile.icon_url || null;

  return (
    <div className="iam-home-tile-inspector-scrim" role="presentation" onClick={onClose}>
      <aside
        className="iam-home-tile-inspector"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-icon-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="iam-home-tile-inspector-head">
          <h3 id="connect-icon-editor-title">Edit connect icon</h3>
          <button type="button" className="iam-section-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <p className="iam-home-tile-editor-note">
          {tile.title} — also editable from Settings → Integrations.
        </p>

        <IconEditorControls
          draft={{
            title: tile.title,
            subtitle: tile.connected ? tile.account_display || 'Connected' : 'Connect',
            image_url: imageUrl,
            icon_slug: tile.icon_slug,
            icon_scale: tile.icon_scale,
            icon_bg: tile.icon_bg,
          }}
          presentation={tile.custom_icon_url ? 'app' : 'brand'}
          onChange={(patch) => {
            const next: ConnectTile = { ...tile };
            if (patch.image_url !== undefined) {
              next.custom_icon_url = patch.image_url;
            }
            if (patch.icon_scale !== undefined) next.icon_scale = patch.icon_scale;
            if (patch.icon_bg !== undefined) next.icon_bg = patch.icon_bg;
            onChange(next);
          }}
          workspaceId={workspaceId}
        />

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
