import React from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type { CmsWorkspaceContext } from '../../hooks/useCmsWorkspaceContext';
import { CmsSiteLauncherGrid } from './CmsSiteLauncherGrid';
import { buildCmsHubPath } from './cmsRoute';
import './cmsShell.css';

type Props = {
  context: CmsWorkspaceContext | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectSite: (slug: string, path: string) => void | Promise<void>;
  onOpenDeployWizard: () => void;
};

export function CmsSitesHub({
  context,
  loading,
  error,
  onRetry,
  onSelectSite,
  onOpenDeployWizard,
}: Props) {
  const sites = context?.sites || [];
  const label = context?.ui_label || context?.workspace_name || 'Your workspace';

  return (
    <div className="iam-cms-shell iam-cms-sites-hub">
      <header className="iam-cms-shell__top">
        <div className="iam-cms-shell__bar">
          <div className="iam-cms-shell__brand">
            <div className="iam-cms-shell__title-wrap">
              <p className="iam-cms-shell__kicker">CMS</p>
              <h1 className="iam-cms-shell__title">Choose a site</h1>
              <p className="iam-cms-shell__domain">{label}</p>
            </div>
          </div>
          <div className="iam-cms-shell__actions">
            <button type="button" className="iam-cms-shell__nav-link" onClick={() => onRetry()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden />
              Refresh
            </button>
            <button type="button" className="iam-cms-shell__agent-btn" onClick={onOpenDeployWizard}>
              <Plus size={14} strokeWidth={1.75} aria-hidden />
              New site
            </button>
          </div>
        </div>
      </header>

      <div className="iam-cms-shell__body iam-cms-sites-hub__body">
        {loading ? (
          <div className="iam-cms-loading">Loading CMS sites…</div>
        ) : error ? (
          <div className="iam-cms-empty-card">
            <p className="font-medium text-[var(--text-heading)]">Could not load CMS sites</p>
            <p className="mt-1 text-sm text-muted">{error}</p>
            <button type="button" className="iam-cms-shell__nav-link mt-4" onClick={() => onRetry()}>
              Retry
            </button>
          </div>
        ) : sites.length === 0 ? (
          <div className="iam-cms-empty-card">
            <p className="text-sm text-muted">No CMS sites are configured for this workspace yet.</p>
            <button type="button" className="iam-cms-shell__agent-btn mt-4" onClick={onOpenDeployWizard}>
              Deploy your first site
            </button>
          </div>
        ) : (
          <>
            <p className="iam-cms-sites-hub__lead">
              Open a site command center — content, theme, and Agent Sam in one shell.
            </p>
            <CmsSiteLauncherGrid
              sites={sites}
              onSelectSite={(site) => {
                void onSelectSite(site.slug, buildCmsHubPath(site.slug));
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
