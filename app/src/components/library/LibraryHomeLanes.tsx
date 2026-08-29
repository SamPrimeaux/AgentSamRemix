import type { MouseEvent } from 'react';
import type { LibraryItem, LibrarySource } from '../../lib/library/types';
import { LibraryFileIcon, LibraryThumb } from './LibraryThumb';

const LANE_ORDER: LibrarySource[] = ['artifacts', 'drive', 'r2', 'local'];

const LANE_TITLE: Record<LibrarySource, string> = {
  artifacts: 'My artifacts',
  drive: 'Google Drive',
  r2: 'R2 Storage',
  local: 'Local folder',
};

const LANE_HINT: Record<LibrarySource, string> = {
  artifacts: 'Saved gens, uploads, and agent artifacts in D1',
  drive: 'Google Drive folders and files',
  r2: 'Workspace R2 bucket prefixes',
  local: 'Browser-granted local folder',
};

type Props = {
  folders: LibraryItem[];
  files: LibraryItem[];
  selectedId: string | null;
  onItemClick: (item: LibraryItem) => void;
  onContextMenu: (e: MouseEvent, item: LibraryItem) => void;
  onOpenSource: (source: LibrarySource) => void;
  driveConnected?: boolean;
  localFolderName?: string | null;
  onConnectDrive?: () => void;
  onConnectLocal?: () => void;
};

function KebabButton() {
  return (
    <span className="kebab" role="presentation" aria-hidden>
      <svg className="drive-icon" viewBox="0 0 24 24">
        <path d="M12 6h.01M12 12h.01M12 18h.01" strokeWidth={3} />
      </svg>
    </span>
  );
}

const PREVIEW_LIMIT = 9;

export function LibraryHomeLanes({
  folders,
  files,
  selectedId,
  onItemClick,
  onContextMenu,
  onOpenSource,
  driveConnected,
  localFolderName,
  onConnectDrive,
  onConnectLocal,
}: Props) {
  const bySource = (source: LibrarySource) => ({
    folders: folders.filter((i) => i.source === source),
    files: files.filter((i) => i.source === source),
  });

  return (
    <div className="lib-home-lanes">
      {LANE_ORDER.map((source) => {
        const group = bySource(source);
        const total = group.folders.length + group.files.length;
        const previewFolders = group.folders.slice(0, PREVIEW_LIMIT);
        const folderSlots = previewFolders.length;
        const previewFiles = group.files.slice(0, Math.max(0, PREVIEW_LIMIT - folderSlots));
        const overflow = total > PREVIEW_LIMIT;

        const emptyHint =
          source === 'drive' && driveConnected === false
            ? 'Connect Google Drive to browse this lane'
            : source === 'local' && !localFolderName
              ? 'Choose a local folder to browse this lane'
              : total === 0
                ? 'Nothing at the root of this source yet'
                : null;

        return (
          <section key={source} className={`lib-source-lane lib-source-lane--${source}`}>
            <header className="lib-source-lane__head">
              <div className="lib-source-lane__title-block">
                <h2 className="lib-source-lane__title">{LANE_TITLE[source]}</h2>
                <p className="lib-source-lane__hint">{LANE_HINT[source]}</p>
              </div>
              <div className="lib-source-lane__meta">
                <span className="lib-source-lane__count">
                  {total} {total === 1 ? 'item' : 'items'}
                </span>
                <button
                  type="button"
                  className="lib-source-lane__open"
                  onClick={() => onOpenSource(source)}
                >
                  Open lane
                </button>
              </div>
            </header>

            {emptyHint ? (
              <div className="lib-source-lane__empty">
                <span>{emptyHint}</span>
                {source === 'drive' && driveConnected === false && onConnectDrive ? (
                  <button type="button" className="upgrade" onClick={onConnectDrive}>
                    Connect Drive
                  </button>
                ) : null}
                {source === 'local' && !localFolderName && onConnectLocal ? (
                  <button type="button" className="upgrade" onClick={() => void onConnectLocal()}>
                    Choose folder
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                {previewFolders.length > 0 ? (
                  <div className="folder-grid">
                    {previewFolders.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`folder-card${selectedId === item.id ? ' selected' : ''}`}
                        onClick={() => onItemClick(item)}
                        onContextMenu={(e) => onContextMenu(e, item)}
                      >
                        <LibraryFileIcon item={item} />
                        <span className="file-name">{item.name}</span>
                        <KebabButton />
                      </button>
                    ))}
                  </div>
                ) : null}
                {previewFiles.length > 0 ? (
                  <div className="file-grid">
                    {previewFiles.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`file-card${selectedId === item.id ? ' selected' : ''}`}
                        onClick={() => onItemClick(item)}
                        onContextMenu={(e) => onContextMenu(e, item)}
                      >
                        <div className="card-head">
                          <LibraryFileIcon item={item} />
                          <span className="file-name">{item.name}</span>
                          <KebabButton />
                        </div>
                        <LibraryThumb item={item} />
                      </button>
                    ))}
                  </div>
                ) : null}
                {overflow ? (
                  <button
                    type="button"
                    className="lib-source-lane__more"
                    onClick={() => onOpenSource(source)}
                  >
                    Show all {total} in {LANE_TITLE[source]} →
                  </button>
                ) : null}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
