import React from 'react';

type GlbAssetThumbProps = {
  url: string;
  thumbnail?: string | null;
  alt?: string;
};

/** Poster-only thumb — never loads GLB for library/gallery cards. */
export function GlbAssetThumb({ thumbnail, alt }: GlbAssetThumbProps) {
  if (thumbnail) {
    return (
      <img
        src={thumbnail}
        alt={alt || ''}
        loading="lazy"
        decoding="async"
        className="cad-assets__thumb-img"
      />
    );
  }

  return <span className="cad-assets__thumb-placeholder">GLB</span>;
}
