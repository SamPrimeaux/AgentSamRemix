import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useCmsWorkspaceContext, normalizeCmsSitesList } from '../../hooks/useCmsWorkspaceContext';
import { buildCmsPath, buildCmsHubPath, parseCmsRoute, readStoredCmsProjectSlug } from './cmsRoute';
import { CmsHubPage } from './CmsHubPage';
import { CmsShellLayout, type CmsShellNav } from './CmsShellLayout';
import { SiteDeployWizard } from './SiteDeployWizard';
import { CmsSiteLauncherGrid } from './CmsSiteLauncherGrid';
import { useWorkspace } from '../../src/context/WorkspaceContext';
import { StudioCmsHost, type StudioCmsPanel } from './studio/StudioCmsHost';
import './cmsShell.css';

type CmsPageProps = {
  workspaceId?: string;
};

export default function CmsPage({ workspaceId }: CmsPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const { workspaceId: ctxWorkspaceId } = useWorkspace();
  const activeWorkspaceId = workspaceId || ctxWorkspaceId || null;

  const parsed = useMemo(
    () => parseCmsRoute(location.pathname, searchParams),
    [location.pathname, searchParams],
  );

  const storedSiteSlug = useMemo(
    () => readStoredCmsProjectSlug(activeWorkspaceId),
    [activeWorkspaceId],
  );
  /** Hub (/dashboard/cms) must not inherit persisted site — only explicit ?site= in URL. */
  const contextSiteSlug =
    parsed.view === 'sites' || parsed.view === 'hub'
      ? parsed.siteSlug || null
      : parsed.siteSlug || storedSiteSlug;
  const effectiveSiteSlug = contextSiteSlug;

  const { context, loading, error, persistSite, reload: load } = useCmsWorkspaceContext({
    workspaceId: activeWorkspaceId,
    siteSlug: contextSiteSlug,
    enabled: true,
  });

  const handleDeployed = useCallback(
    (slug: string) => {
      setWizardOpen(false);
      void persistSite(slug).then(() => {
        navigate(
          buildCmsPath({
            panel: 'pages',
            siteSlug: slug,
          }),
          { replace: true },
        );
        void load();
      });
    },
    [load, navigate, persistSite],
  );

  const isHubView = parsed.view === 'sites' || parsed.view === 'hub';

  useEffect(() => {
    if (parsed.legacy && parsed.legacyTarget) {
      navigate(parsed.legacyTarget, { replace: true });
    }
  }, [parsed, navigate]);

  useEffect(() => {
    if (isHubView || loading || !context?.project_slug || parsed.siteSlug) return;
    navigate(
      buildCmsPath({
        panel: parsed.panel,
        pageId: parsed.pageId,
        siteSlug: context.project_slug,
      }),
      { replace: true },
    );
  }, [isHubView, parsed.panel, parsed.pageId, parsed.siteSlug, loading, context?.project_slug, navigate]);

  const handleSelectSite = useCallback(
    async (slug: string, path: string) => {
      await persistSite(slug);
      const deepLink = /\/pages|theme-editor|online-store|templates|imports/.test(path);
      navigate(deepLink ? path : buildCmsHubPath(slug), { replace: true });
    },
    [navigate, persistSite],
  );

  const cmsNavigatePath = useCallback(
    (path: string, opts?: { replace?: boolean }) => {
      navigate(path, opts);
    },
    [navigate],
  );

  const studioProjectSlug = context?.project_slug || effectiveSiteSlug || null;
  const studioPanel =
    parsed.view === 'theme-editor'
      ? 'theme-editor'
      : parsed.panel || 'pages';

  const sitesList = useMemo(() => normalizeCmsSitesList(context?.sites), [context?.sites]);

  const needsSitePick =
    !isHubView &&
    !loading &&
    !context?.project_slug &&
    !effectiveSiteSlug &&
    sitesList.length !== 1;

  const siteCount = sitesList.length;

  const hubSiteSlug = useMemo(() => {
    if (parsed.siteSlug) return parsed.siteSlug;
    if (!sitesList.length) return null;

    if (context?.is_operator_hub) {
      const candidates = [
        context.workspace_slug,
        context.project_slug,
        storedSiteSlug,
      ]
        .map((s) => (s != null ? String(s).trim() : ''))
        .filter(Boolean);
      for (const slug of candidates) {
        if (sitesList.some((s) => s.slug === slug)) return slug;
      }
      const featured = [...sitesList].sort(
        (a, b) => (Number(b.hub_priority) || 0) - (Number(a.hub_priority) || 0),
      );
      return featured[0]?.slug || null;
    }

    if (context?.project_slug && sitesList.some((s) => s.slug === context.project_slug)) {
      return context.project_slug;
    }
    if (storedSiteSlug && sitesList.some((s) => s.slug === storedSiteSlug)) return storedSiteSlug;
    if (sitesList.length === 1) return sitesList[0].slug;
    return null;
  }, [
    parsed.siteSlug,
    context?.is_operator_hub,
    context?.workspace_slug,
    context?.project_slug,
    storedSiteSlug,
    sitesList,
  ]);

  const shellSiteSlug =
    studioProjectSlug || hubSiteSlug || effectiveSiteSlug || context?.project_slug || '';
  const shellSite = useMemo(
    () => sitesList.find((s) => s.slug === shellSiteSlug) || null,
    [sitesList, shellSiteSlug],
  );
  const shellActiveNav: CmsShellNav = isHubView
    ? 'hub'
    : parsed.panel === 'templates'
      ? 'templates'
      : parsed.panel === 'theme-editor'
        ? 'theme-editor'
        : parsed.panel === 'online-store'
          ? 'online-store'
          : parsed.panel === 'imports'
            ? 'imports'
            : 'pages';

  const nativeStudioPanel: StudioCmsPanel | null =
    parsed.panel === 'pages' || parsed.panel === 'media'
      ? 'pages'
      : parsed.panel === 'online-store'
        ? 'sections'
        : parsed.panel === 'theme-editor'
          ? 'theme'
          : parsed.panel === 'templates'
            ? 'templates'
            : parsed.panel === 'imports'
              ? 'imports'
              : null;
  const isNativeStudioRoute = !isHubView && Boolean(nativeStudioPanel) && Boolean(studioProjectSlug);
  const isHubShellRoute = isHubView && Boolean(hubSiteSlug);

  return (
    <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden bg-[#F9F7F2] iam-agentsam-cms-host h-full">
      {needsSitePick ? (
        <div className="iam-cms-shell iam-cms-hub-page flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center overflow-auto">
          <div className="max-w-lg w-full">
            <h2 className="iam-cms-hub-page__heading">Choose a CMS site</h2>
            <p className="mt-2 text-sm iam-cms-muted">
              {loading
                ? 'Loading sites for this workspace…'
                : error
                  ? `Could not load CMS sites (${error}). Retry or pick a site below if listed.`
                  : siteCount > 0
                    ? `${context?.ui_label || 'Your workspace'} — pick a site to open the CMS editor.`
                    : `No CMS sites are configured for ${context?.ui_label || 'this workspace'} yet.`}
            </p>
            {error ? (
              <button
                type="button"
                className="mt-4 rounded-md border border-[var(--dashboard-border)] px-3 py-2 text-sm hover:bg-[var(--bg-hover)]"
                onClick={() => {
                  void load();
                }}
              >
                Retry
              </button>
            ) : null}
            {sitesList.length > 0 ? (
              <div className="mt-6 flex justify-center">
                <CmsSiteLauncherGrid
                  sites={sitesList}
                  onSelectSite={(site) => {
                    void handleSelectSite(site.slug, buildCmsHubPath(site.slug));
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {!needsSitePick && isHubShellRoute ? (
        <CmsShellLayout
          siteSlug={hubSiteSlug || shellSiteSlug}
          site={shellSite}
          sites={sitesList}
          context={context}
          activeNav="hub"
          hubMinimal
          showComposeBar={false}
          onSelectSite={handleSelectSite}
          onOpenDeployWizard={() => setWizardOpen(true)}
        >
          <CmsHubPage
            context={context ? { ...context, sites: sitesList } : null}
            sites={sitesList}
            activeSiteSlug={hubSiteSlug}
            loading={loading}
            error={error}
            onRetry={() => {
              void load();
            }}
            onSelectSite={handleSelectSite}
            onNavigate={cmsNavigatePath}
            onOpenDeployWizard={() => setWizardOpen(true)}
          />
        </CmsShellLayout>
      ) : null}
      {!needsSitePick && isHubView && !hubSiteSlug ? (
        <CmsHubPage
          context={context ? { ...context, sites: sitesList } : null}
          sites={sitesList}
          activeSiteSlug={hubSiteSlug}
          loading={loading}
          error={error}
          onRetry={() => {
            void load();
          }}
          onSelectSite={handleSelectSite}
          onNavigate={cmsNavigatePath}
          onOpenDeployWizard={() => setWizardOpen(true)}
        />
      ) : null}
      {!needsSitePick && isNativeStudioRoute && studioProjectSlug && nativeStudioPanel ? (
        <StudioCmsHost
          projectSlug={studioProjectSlug}
          pageId={parsed.pageId}
          initialPanel={nativeStudioPanel}
          workspaceId={activeWorkspaceId || context?.workspace_id || ''}
          sites={sitesList}
          onSiteChange={(slug) => {
            void handleSelectSite(
              slug,
              buildCmsPath({ panel: parsed.panel, siteSlug: slug }),
            );
          }}
          onNavigatePath={cmsNavigatePath}
        />
      ) : null}
      {wizardOpen ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl h-[min(80vh,820px)] rounded-2xl overflow-hidden shadow-2xl bg-[#fafaf7] ring-1 ring-stone-300/80">
            <SiteDeployWizard
              workspaceId={activeWorkspaceId || context?.workspace_id || ''}
              onClose={() => setWizardOpen(false)}
              onDeployed={handleDeployed}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// NOTE: Studio's "Overview" exit posts { type: 'iam-studio-cms-navigate', path }
// which StudioCmsHost listens for and forwards here via onNavigatePath=cmsNavigatePath.
