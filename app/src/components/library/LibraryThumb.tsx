import type { LibraryDisplayKind, LibraryItem } from '../../lib/library/types';

function FolderIconSvg() {
  return (
    <svg className="folder-icon file-icon" viewBox="0 0 24 24" aria-hidden>
      <path d="M3 7h7l2 2h9v10H3z" />
    </svg>
  );
}

function FileIconSvg({ kind }: { kind: LibraryDisplayKind }) {
  if (kind === 'pdf') {
    return (
      <svg className="pdf-icon file-icon" viewBox="0 0 24 24" aria-hidden>
        <path d="M6 2h9l5 5v15H6z" />
      </svg>
    );
  }
  if (kind === 'spark' || kind === 'glb') {
    return (
      <svg className="sheet-icon file-icon" viewBox="0 0 24 24" aria-hidden>
        <path d="M6 2h12v20H6z" />
      </svg>
    );
  }
  return (
    <svg className="doc-icon file-icon" viewBox="0 0 24 24" aria-hidden>
      <path d="M6 2h9l5 5v15H6z" />
    </svg>
  );
}

export function LibraryThumb({ item }: { item: LibraryItem }) {
  if (item.kind === 'folder') {
    return (
      <div className="thumb">
        <FolderIconSvg />
      </div>
    );
  }

  if (item.previewUrl) {
    return (
      <div className="thumb">
        <img src={item.previewUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  const kind = item.displayKind;
  if (kind === 'spark') {
    return (
      <div className="thumb">
        <div className="spark-thumb">
          <svg viewBox="0 0 24 24" style={{ width: 34, height: 34 }}>
            <path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" fill="white" stroke="none" />
          </svg>
        </div>
      </div>
    );
  }
  if (kind === 'photo') {
    return (
      <div className="thumb">
        <div className="photo-thumb">Preview</div>
      </div>
    );
  }
  if (kind === 'pdf') {
    return (
      <div className="thumb pdf-thumb">
        <div className="pdf-banner">PDF</div>
        <div className="pdf-body">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }
  return (
    <div className="thumb doc">
      <div className="doc-lines">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function LibraryFileIcon({ item }: { item: LibraryItem }) {
  if (item.kind === 'folder') return <FolderIconSvg />;
  return <FileIconSvg kind={item.displayKind} />;
}

export function sourceLabel(source: LibraryItem['source']): string {
  switch (source) {
    case 'artifacts':
      return 'Artifact';
    case 'drive':
      return 'Drive';
    case 'r2':
      return 'R2';
    case 'local':
      return 'Local';
    default:
      return source;
  }
}
