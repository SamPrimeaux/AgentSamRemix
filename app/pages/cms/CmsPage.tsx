import React, { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import CmsTemplateLibraryPage from './CmsTemplateLibraryPage';

type CmsPageProps = { workspaceId?: string };

const CMS_SHELL_PATH = '/website-assets/cms/studio.html';

/**
 * CMS front door + parked authoring host.
 *
 * The reusable template/component library is active at the CMS root and Templates route. Existing
 * authoring/editor routes still use the intentionally disconnected presentation shell until the
 * CMS API pass reconnects them; this keeps UI modernization independent from old workspace logic.
 */
export default function CmsPage({ workspaceId }: CmsPageProps) {
  const location = useLocation();
  const libraryRoute = location.pathname === '/dashboard/cms' || location.pathname === '/dashboard/cms/templates';

  const src = useMemo(() => {
    const params = new URLSearchParams();
    if (workspaceId?.trim()) params.set('workspace', workspaceId.trim());
    params.set('return_to', `${location.pathname}${location.search}`);
    return `${CMS_SHELL_PATH}?${params.toString()}`;
  }, [location.pathname, location.search, workspaceId]);

  if (libraryRoute) {
    return <CmsTemplateLibraryPage initialView={location.pathname.endsWith('/templates') ? 'templates' : 'overview'} />;
  }

  return (
    <iframe
      title="Inner Animal Media CMS"
      src={src}
      className="block h-full min-h-0 w-full border-0 bg-[var(--dashboard-canvas)]"
      sandbox="allow-same-origin"
    />
  );
}
