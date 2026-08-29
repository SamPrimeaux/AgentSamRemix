import type { MouseEvent } from 'react';
import { formatBytes } from '../../lib/library/formatLibrary';
import type { LibraryItem } from '../../lib/library/types';
import { LibraryFileIcon, sourceLabel } from './LibraryThumb';

type Props = {
  folders: LibraryItem[];
  files: LibraryItem[];
  selectedId: string | null;
  onItemClick: (item: LibraryItem) => void;
  onContextMenu: (e: MouseEvent, item: LibraryItem) => void;
};

function ListRow({
  item,
  selected,
  onItemClick,
  onContextMenu,
}: {
  item: LibraryItem;
  selected: boolean;
  onItemClick: (item: LibraryItem) => void;
  onContextMenu: (e: MouseEvent, item: LibraryItem) => void;
}) {
  return (
    <button
      type="button"
      className={`lib-list-row${selected ? ' selected' : ''}`}
      onClick={() => onItemClick(item)}
      onContextMenu={(e) => onContextMenu(e, item)}
    >
      <span className="lib-list-col lib-list-col--name">
        <LibraryFileIcon item={item} />
        <span className="file-name">{item.name}</span>
      </span>
      <span className="lib-list-col lib-list-col--owner">{item.ownerName ?? '—'}</span>
      <span className="lib-list-col lib-list-col--modified">{item.modifiedLabel ?? '—'}</span>
      <span className="lib-list-col lib-list-col--size">
        {item.kind === 'folder' ? '—' : formatBytes(item.size)}
      </span>
      <span className="lib-list-col lib-list-col--source">{sourceLabel(item.source)}</span>
    </button>
  );
}

export function LibraryListView({ folders, files, selectedId, onItemClick, onContextMenu }: Props) {
  const rows = [...folders, ...files];
  return (
    <div className="lib-list-table">
      <div className="lib-list-head-row">
        <span className="lib-list-col lib-list-col--name">
          Name <span className="sort-dot">↓</span>
        </span>
        <span className="lib-list-col lib-list-col--owner">Owner</span>
        <span className="lib-list-col lib-list-col--modified">Date modified</span>
        <span className="lib-list-col lib-list-col--size">File size</span>
        <span className="lib-list-col lib-list-col--source">Source</span>
      </div>
      {rows.map((item) => (
        <ListRow
          key={item.id}
          item={item}
          selected={selectedId === item.id}
          onItemClick={onItemClick}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}
