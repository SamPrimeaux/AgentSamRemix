import React, { useMemo } from 'react';

/** Standalone prototype; loaded only when /dashboard/examples is explicitly opened. */
export const EXAMPLES_GALLERY_SRC = '/prototypes/examples-gallery';

type Props = {
  className?: string;
};

/** Embeds the standalone examples gallery prototype (cache-busted per deploy). */
export function ExamplesGalleryEmbed({ className = 'flex-1 w-full min-h-0 border-0 bg-[#f7f5ef]' }: Props) {
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
