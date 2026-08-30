import React from 'react';
import { ExamplesGalleryEmbed } from '../../components/ExamplesGalleryEmbed';

/**
 * Low-priority route adapter. The gallery is intentionally outside Agent's
 * critical bundle; when CMS resumes, /dashboard/examples can point at the
 * CMS-owned implementation without changing the public route again.
 */
export default function ExamplesPage() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <ExamplesGalleryEmbed />
    </div>
  );
}
