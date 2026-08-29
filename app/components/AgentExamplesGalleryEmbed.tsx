import React, { useMemo } from 'react';

/** Production R2 path (Vite public/ → dist/prototypes/ → static/dashboard/app/prototypes/). */
export const EXAMPLES_GALLERY_SRC = '/static/dashboard/app/prototypes/examples-gallery.html';

type Props = {
  className?: string;
};

/** Embeds the standalone examples gallery prototype (cache-busted per deploy). */
export function AgentExamplesGalleryEmbed({ className = 'flex-1 w-full min-h-0 border-0 bg-[#f7f5ef]' }: Props) {
  const src = useMemo(() => {
    const bust =
      (typeof __IAM_BUILD_GIT_SHA__ !== 'undefined' && String(__IAM_BUILD_GIT_SHA__).trim()) ||
      String(Date.now());
    return `${EXAMPLES_GALLERY_SRC}?v=${encodeURIComponent(bust)}`;
  }, []);

  return (
    <iframe
      title="IAM Examples Gallery"
      src={src}
      className={className}
      sandbox="allow-scripts allow-same-origin allow-forms"
    />
  );
}
