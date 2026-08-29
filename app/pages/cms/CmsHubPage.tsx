import React, { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CmsWorkspaceContext, CmsWorkspaceSite } from '../../hooks/useCmsWorkspaceContext';
import { CmsDashboard, type CmsDashboardSetupMode } from './CmsDashboard';
import { CmsGuidedChatHero } from './CmsGuidedChatHero';
import { CmsSiteSwitcher } from './CmsSiteSwitcher';
import { buildCmsHubPath } from './cmsRoute';
import './cmsShell.css';

type Props = {
  context: CmsWorkspaceContext | null;
  sites: CmsWorkspaceSite[];
  activeSiteSlug: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectSite: (slug: string, path: string) => void | Promise<void>;
  onNavigate: (path: string) => void;
  onOpenDeployWizard: () => void;
};

export function CmsHubPage({
  context,
  sites,
  activeSiteSlug,
  loading,
  error,
  onRetry,
  onSelectSite,
  onNavigate,
  onOpenDeployWizard,
}: Props) {
  const resolvedSiteSlug = useMemo(() => {
    if (activeSiteSlug) return activeSiteSlug;
    const stored = sites.find((s) => s.slug === context?.project_slug);
    if (context?.project_slug && stored) return context.project_slug;
    if (sites.length === 1) return sites[0].slug;
    if (context?.is_operator_hub && sites.length > 0) {
      const candidates = [context.workspace_slug, context.project_slug]
        .map((s) => (s != null ? String(s).trim() : ''))
        .filter(Boolean);
      for (const slug of candidates) {
        if (sites.some((s) => s.slug === slug)) return slug;
      }
      const featured = [...sites].sort(
        (a, b) => (Number(b.hub_priority) || 0) - (Number(a.hub_priority) || 0),
      );
      return featured[0]?.slug || null;
    }
    return null;
  }, [
    activeSiteSlug,
    sites,
    context?.project_slug,
    context?.is_operator_hub,
    context?.workspace_slug,
  ]);

  const setupMode: CmsDashboardSetupMode = useMemo(() => {
    if (loading) return 'loading';
    if (sites.length === 0) return 'deploy';
    if (sites.length > 1 && !resolvedSiteSlug) return 'pick-site';
    if (resolvedSiteSlug) return 'active';
    return 'deploy';
  }, [loading, sites.length, resolvedSiteSlug]);

  const activeSite = useMemo(() => {
    const rows = Array.isArray(sites) ? sites : [];
    return rows.find((s) => s.slug === resolvedSiteSlug) || null;
  }, [sites, resolvedSiteSlug]);

  return (
    <div className="iam-cms-shell iam-cms-hub-page">
      <div className="iam-cms-hub-page__scroll">
        <CmsGuidedChatHero
          siteSlug={resolvedSiteSlug}
          siteName={activeSite?.name || context?.project_name}
        />

        <div className="iam-cms-hub-page__body">
          <div className="iam-cms-hub-page__toolbar iam-cms-hub-page__toolbar--compact">
            <CmsSiteSwitcher
              sites={sites}
              activeSlug={resolvedSiteSlug}
              size="sm"
              disabled={loading}
              onSelect={(slug) => {
                void onSelectSite(slug, buildCmsHubPath(slug));
              }}
              onNewSite={onOpenDeployWizard}
            />
            <div className="iam-cms-shell__actions">
              <button type="button" className="iam-cms-shell__nav-link" onClick={() => onRetry()} disabled={loading}>
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden />
                Refresh
              </button>
            </div>
          </div>

          {error ? (
            <div className="iam-cms-empty-card iam-cms-empty-card--inline">
              <p className="iam-cms-empty-card__title">Could not load workspace CMS context</p>
              <p className="iam-cms-muted">{error}</p>
              <button type="button" className="iam-cms-shell__nav-link mt-4" onClick={() => onRetry()}>
                Retry
              </button>
            </div>
          ) : null}

          <CmsDashboard
            siteSlug={resolvedSiteSlug}
            setupMode={setupMode}
            site={activeSite}
            sites={sites}
            context={context}
            onNavigate={onNavigate}
            onSelectSite={onSelectSite}
            onOpenDeployWizard={onOpenDeployWizard}
          />
        </div>
      </div>
    </div>
  );
}
