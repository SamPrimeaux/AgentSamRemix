import React, { useEffect, useMemo } from 'react';

export type StudioCmsPanel = 'pages' | 'sections' | 'templates' | 'imports' | 'theme';

type Props = {
  projectSlug: string;
  pageId?: string | null;
  initialPanel: StudioCmsPanel;
  workspaceId?: string;
  sites?: Array<{ slug: string; name?: string; domain?: string | null; logo_url?: string | null }>;
  onSiteChange?: (slug: string) => void;
  /** Called when Studio requests navigation back out of the iframe (e.g. "Overview" exit). */
  onNavigatePath?: (path: string) => void;
};

/**
 * Hosts Studio CMS in an isolated iframe bundle (own React).
 * Avoids sharing dashboard vendor-react.js — Mac vs CF Builds races were crashing
 * the editor after paint when chunk export maps diverged.
 */
export function StudioCmsHost({
  projectSlug,
  pageId,
  initialPanel,
  workspaceId,
  onSiteChange,
  onNavigatePath,
}: Props) {
  const src = useMemo(() => {
    const params = new URLSearchParams();
    params.set('site', projectSlug);
    params.set('panel', initialPanel);
    if (pageId) params.set('page', pageId);
    if (workspaceId) params.set('workspace', workspaceId);
    params.set('parent_origin', window.location.origin);
    return `/static/dashboard/app/cms/studio-cms-shell.html?${params.toString()}`;
  }, [projectSlug, pageId, initialPanel, workspaceId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'iam-studio-cms-site' && typeof data.slug === 'string') {
        onSiteChange?.(data.slug);
        return;
      }
      if (data.type === 'iam-studio-cms-navigate' && typeof data.path === 'string') {
        onNavigatePath?.(data.path);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSiteChange, onNavigatePath]);

  return (
    <div className="studio-cms-native-host h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[#F9F7F2]">
      <iframe
        title="Studio CMS"
        src={src}
        className="block h-full w-full border-0"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
