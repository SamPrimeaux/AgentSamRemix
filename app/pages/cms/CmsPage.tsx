import React, { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

type CmsPageProps = { workspaceId?: string };

const CMS_SHELL_PATH = '/website-assets/cms/studio.html';

/**
 * Parked CMS host. The CMS authoring implementation remains in app/pages/cms for
 * the dedicated CMS pass; this route deliberately has no CMS-specific workspace API.
 */
export default function CmsPage({ workspaceId }: CmsPageProps) {
  const location = useLocation();
  const src = useMemo(() => {
    const params = new URLSearchParams();
    if (workspaceId?.trim()) params.set('workspace', workspaceId.trim());
    params.set('return_to', `${location.pathname}${location.search}`);
    return `${CMS_SHELL_PATH}?${params.toString()}`;
  }, [location.pathname, location.search, workspaceId]);

  return (
    <iframe
      title="Inner Animal Media CMS"
      src={src}
      className="block h-full min-h-0 w-full border-0 bg-[var(--dashboard-canvas)]"
      sandbox="allow-same-origin"
    />
  );
}
