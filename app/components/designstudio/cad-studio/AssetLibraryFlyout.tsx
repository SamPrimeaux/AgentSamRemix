import React from 'react';
import { BookOpen, X } from 'lucide-react';

export type AssetLibraryFlyoutProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export function AssetLibraryFlyout({ open, onClose, children }: AssetLibraryFlyoutProps) {
  // Keep mounted so useStudioGallery state (fetched GLBs) persists across open/close.
  // Visibility toggled via CSS so the gallery hook doesn't re-fetch every open.
  return (
    <>
      {open && <button type="button" className="cad-asset-library__backdrop" aria-label="Close library" onClick={onClose} />}
      <aside
        className="cad-asset-library cad-studio__slide-drawer"
        aria-label="Asset library"
        style={{ display: open ? undefined : 'none' }}
      >
        <div className="cad-asset-library__head">
          <span className="cad-asset-library__title">
            <BookOpen size={14} strokeWidth={1.75} />
            Library
          </span>
          <button type="button" className="cad-studio__btn" onClick={onClose} title="Close library">
            <X size={14} />
          </button>
        </div>
        <div className="cad-asset-library__body">{children}</div>
      </aside>
    </>
  );
}
