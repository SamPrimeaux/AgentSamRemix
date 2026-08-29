import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, ExternalLink, Plus } from 'lucide-react';
import type { CmsWorkspaceContext, CmsWorkspaceSite } from '../../hooks/useCmsWorkspaceContext';
import type { CmsBootstrapData } from '../../src/types/cms';
import { buildCmsHubPath, buildCmsPath } from './cmsRoute';
import { resolveStorefrontUrl, storefrontDisplayHost } from '../../lib/cmsStorefrontUrl';
import { CmsIntegrationsStrip } from './CmsIntegrationsStrip';
import { CmsHubImportStrip } from './CmsHubImportStrip';
import { CmsSiteStructurePanel } from './CmsSiteStructurePanel';
import { CmsSiteSwitcher } from './CmsSiteSwitcher';
import { useCmsConnectedIntegrations } from './useCmsConnectedIntegrations';
import { useCmsLinkedProject } from './useCmsLinkedProject';
import { AppIcon } from '../../components/ui/AppIcon';
import { updateProject } from '../../client-api/projects';
import { cfImageVariants, projectAccentHue } from '../../src/lib/projectBranding';
import { parseProjectMeta } from '../projects/projectDetailMeta';
import { uploadProjectR2File } from '../../src/lib/projectR2Upload';
import './cmsShell.css';

export type CmsDashboardSetupMode = 'loading' | 'active' | 'deploy' | 'pick-site';

type ActivityRow = {
  id?: string;
  action?: string;
  resource_type?: string;
  resource_id?: string;
  created_at?: number | string;
  details?: string | Record<string, unknown>;
};

type Props = {
  siteSlug: string | null;
  setupMode: CmsDashboardSetupMode;
  site?: CmsWorkspaceSite | null;
  sites?: CmsWorkspaceSite[];
  context?: CmsWorkspaceContext | null;
  onNavigate: (path: string) => void;
  onSelectSite?: (slug: string, path: string) => void | Promise<void>;
  onOpenDeployWizard?: () => void;
};

function formatWhen(value: unknown): string {
  if (value == null || value === '') return 'Recently';
  const n = Number(value);
  const d = Number.isFinite(n) && n > 100000 ? new Date(n * 1000) : new Date(String(value));
  if (Number.isNaN(d.getTime())) return 'Recently';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function activityLabel(row: ActivityRow): string {
  const action = String(row.action || 'update').replace(/_/g, ' ');
  const type = String(row.resource_type || '').replace(/_/g, ' ');
  let detail = '';
  if (row.details) {
    try {
      const parsed =
        typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
      detail =
        String(parsed.section_name || parsed.route_path || parsed.template_id || '').trim();
    } catch {
      detail = typeof row.details === 'string' ? row.details.slice(0, 48) : '';
    }
  }
  const parts = [action, type, detail || row.resource_id].filter(Boolean);
  return parts.join(' · ');
}

function activityStatus(row: ActivityRow): 'published' | 'draft' {
  const action = String(row.action || '').toLowerCase();
  if (action.includes('publish') || action.includes('deploy')) return 'published';
  return 'draft';
}

function SkeletonBlock({
  width,
  height,
  style,
}: {
  width?: string | number;
  height?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="iam-cms-skeleton__block"
      style={{ width: width ?? '100%', height: height ?? 12, ...style }}
    />
  );
}

function ModuleCardSkeleton() {
  return (
    <div className="iam-cms-card iam-cms-module iam-cms-module--skeleton" aria-hidden>
      <SkeletonBlock width="55%" height={12} style={{ marginBottom: 10 }} />
      <SkeletonBlock height={10} style={{ marginBottom: 6 }} />
      <SkeletonBlock width="40%" height={10} />
    </div>
  );
}

function ActiveSiteSkeleton() {
  return (
    <section className="iam-cms-card iam-cms-site-hero iam-cms-site-hero--skeleton" aria-hidden>
      <SkeletonBlock width={100} height={10} style={{ marginBottom: 12 }} />
      <SkeletonBlock width="60%" height={24} style={{ marginBottom: 8 }} />
      <SkeletonBlock width="45%" height={12} style={{ marginBottom: 18 }} />
      <div className="iam-cms-site-hero__stats">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="iam-cms-stat">
            <SkeletonBlock height={10} />
            <SkeletonBlock height={18} style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <SkeletonBlock width={120} height={40} />
        <SkeletonBlock width={100} height={40} />
      </div>
    </section>
  );
}

function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="iam-cms-panel-skeleton" aria-hidden>
      <SkeletonBlock width="45%" height={12} style={{ margin: '14px 16px 12px' }} />
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonBlock key={i} height={28} style={{ margin: '0 16px 8px' }} />
      ))}
    </div>
  );
}

export function CmsDashboard({
  siteSlug,
  setupMode,
  site,
  sites = [],
  context,
  onNavigate,
  onSelectSite,
  onOpenDeployWizard,
}: Props) {
  const [structureOpen, setStructureOpen] = useState(false);
  const [iconUploading, setIconUploading] = useState(false);
  const [localIconUrl, setLocalIconUrl] = useState<string | null>(null);
  const [boot, setBoot] = useState<CmsBootstrapData | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [bootLoading, setBootLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  const hasActiveSite = setupMode === 'active' && Boolean(siteSlug);

  const {
    items: connectedIntegrations,
    loading: integrationsLoading,
    error: integrationsError,
    refresh: refreshIntegrations,
    connectedCount,
  } = useCmsConnectedIntegrations(true);
  const { project: linkedProject, refresh: refreshLinkedProject } = useCmsLinkedProject(
    siteSlug || '',
    hasActiveSite,
  );

  const loadSiteData = useCallback(async () => {
    if (!siteSlug || !hasActiveSite) {
      setBoot(null);
      setActivity([]);
      setBootLoading(false);
      setActivityLoading(false);
      return;
    }
    setBootLoading(true);
    setActivityLoading(true);
    setBootError(null);
    try {
      const q = new URLSearchParams({ project_slug: siteSlug });
      const actQ = new URLSearchParams({ project_slug: siteSlug });
      const [bootRes, actRes] = await Promise.all([
        fetch(`/api/cms/bootstrap?${q}`, { credentials: 'include', cache: 'no-store' }),
        fetch(`/api/cms/activity?${actQ}`, { credentials: 'include', cache: 'no-store' }),
      ]);
      const bootJson = (await bootRes.json()) as CmsBootstrapData & { error?: string };
      if (!bootRes.ok) throw new Error(bootJson.error || `Bootstrap HTTP ${bootRes.status}`);
      setBoot(bootJson);
      if (actRes.ok) {
        const actJson = (await actRes.json()) as { activity?: ActivityRow[] };
        setActivity(Array.isArray(actJson.activity) ? actJson.activity.slice(0, 8) : []);
      } else {
        setActivity([]);
      }
    } catch (e) {
      setBootError(e instanceof Error ? e.message : 'Failed to load CMS overview');
      setBoot(null);
      setActivity([]);
    } finally {
      setBootLoading(false);
      setActivityLoading(false);
    }
  }, [siteSlug, hasActiveSite]);

  useEffect(() => {
    void loadSiteData();
  }, [loadSiteData]);

  useEffect(() => {
    setLocalIconUrl(null);
  }, [siteSlug, linkedProject?.cover_image_url]);

  const pages = boot?.pages || [];
  const themes = boot?.themes || [];
  const assets = boot?.assets_3d || boot?.assets || [];
  const imports = boot?.imports || [];
  const navMenus = boot?.nav_menus || [];
  const sections = boot?.sections || Object.values(boot?.sections_by_page || {}).flat();
  const drafts = pages.filter((p) => String(p.status || '').toLowerCase() === 'draft').length;

  const collectionCount = useMemo(() => {
    const sectionTypes = new Set(
      sections.map((s) => String((s as { section_type?: string }).section_type || '').trim()).filter(Boolean),
    );
    if (sectionTypes.size > 0) return sectionTypes.size;
    return navMenus.length;
  }, [sections, navMenus.length]);

  const settingsCount = themes.length + navMenus.length;

  const storefrontUrl = useMemo(
    () =>
      siteSlug
        ? resolveStorefrontUrl({
            projectSlug: siteSlug,
            siteDomain: site?.domain,
            publicDomain: context?.public_domain,
          })
        : null,
    [siteSlug, site?.domain, context?.public_domain],
  );

  const siteIconUrl =
    localIconUrl ||
    linkedProject?.cover_image_url ||
    site?.logo_url ||
    null;
  const siteDisplayName = site?.name || context?.project_name || siteSlug || 'Your site';

  const handleIconDrop = useCallback(
    async (file: File) => {
      if (!linkedProject?.id) return;
      setIconUploading(true);
      try {
        const out = await uploadProjectR2File(
          linkedProject.id,
          file,
          'cover',
          context?.workspace_id || undefined,
        );
        if (!out.ok || !out.url) throw new Error(out.error || 'Upload failed');
        const meta = { ...parseProjectMeta(linkedProject.metadata_json), cover_image_url: out.url };
        const res = await updateProject(linkedProject.id, {
          metadata_json: JSON.stringify(meta),
        });
        if (!res.ok) throw new Error(res.error || 'Could not save project icon');
        setLocalIconUrl(out.url);
        void refreshLinkedProject();
      } catch (e) {
        console.error(e);
      } finally {
        setIconUploading(false);
      }
    },
    [linkedProject, context?.workspace_id, refreshLinkedProject],
  );

  const guardNavigate = useCallback(
    (path: string) => {
      if (setupMode === 'deploy' || setupMode === 'pick-site') {
        onOpenDeployWizard?.();
        return;
      }
      if (!siteSlug) return;
      onNavigate(path);
    },
    [setupMode, siteSlug, onNavigate, onOpenDeployWizard],
  );

  const modules = useMemo(
    () => [
      {
        id: 'content',
        title: 'Content',
        desc: 'Create, organize, and publish content across your site.',
        sub: hasActiveSite && !bootLoading ? `${drafts} draft${drafts === 1 ? '' : 's'}` : '—',
        path: siteSlug ? buildCmsPath({ panel: 'pages', siteSlug }) : '',
        cta: 'Manage content →',
      },
      {
        id: 'media',
        title: 'Media',
        desc: 'Manage images, videos, and files in your media library.',
        sub: hasActiveSite && !bootLoading ? `${assets.length} asset${assets.length === 1 ? '' : 's'}` : '—',
        path: siteSlug ? buildCmsPath({ panel: 'media', siteSlug }) : '',
        cta: 'Open media library →',
      },
      {
        id: 'structure',
        title: 'Structure',
        desc: 'Organize your site structure, menus, and navigation.',
        sub: hasActiveSite && !bootLoading ? `${collectionCount} menu${collectionCount === 1 ? '' : 's'}` : '—',
        action: 'structure' as const,
        cta: 'View structure →',
      },
      {
        id: 'settings',
        title: 'Settings',
        desc: 'Configure your site settings, domains, and preferences.',
        sub: hasActiveSite && !bootLoading ? `${settingsCount} setting${settingsCount === 1 ? '' : 's'}` : '—',
        path: siteSlug ? buildCmsPath({ panel: 'online-store', siteSlug }) : '',
        cta: 'Site settings →',
      },
    ],
    [hasActiveSite, bootLoading, drafts, assets.length, collectionCount, settingsCount, siteSlug],
  );

  const quickActions = useMemo(
    () => [
      { label: 'Create new page', path: siteSlug ? `${buildCmsPath({ panel: 'pages', siteSlug })}&create=1` : '' },
      { label: 'Browse templates', path: siteSlug ? buildCmsPath({ panel: 'templates', siteSlug }) : '' },
      { label: 'Upload media', path: siteSlug ? buildCmsPath({ panel: 'media', siteSlug }) : '' },
      { label: 'Import theme', action: 'import' as const },
      { label: 'Manage redirects', path: siteSlug ? buildCmsPath({ panel: 'pages', siteSlug }) : '' },
    ],
    [siteSlug],
  );

  const showHeroSkeleton = setupMode === 'loading' || (hasActiveSite && bootLoading);
  const showModuleSkeleton = setupMode === 'loading' || (hasActiveSite && bootLoading);

  const renderActiveSiteCard = () => {
    if (showHeroSkeleton) return <ActiveSiteSkeleton />;

    if (setupMode === 'deploy') {
      return (
        <section className="iam-cms-card iam-cms-site-hero iam-cms-site-hero--setup">
          <div className="iam-cms-site-hero__head">
            <div>
              <p className="iam-cms-site-hero__suite">Active site</p>
              <h2 className="iam-cms-site-hero__name">Setup your site</h2>
              <p className="iam-cms-site-hero__meta">
                Deploy a CMS site for {context?.ui_label || 'this workspace'} to manage content, media, theme, and
                storefront — or refresh if customer builds should already appear here.
              </p>
            </div>
            <CmsSiteSwitcher
              sites={sites}
              activeSlug={siteSlug}
              size="sm"
              onSelect={(slug) => {
                if (onSelectSite) void onSelectSite(slug, buildCmsHubPath(slug));
              }}
              onNewSite={onOpenDeployWizard}
            />
          </div>
          <div className="iam-cms-site-hero__stats" aria-label="Site readiness">
            <div className="iam-cms-stat">
              <div className="iam-cms-stat__label">Pages</div>
              <div className="iam-cms-stat__value">—</div>
            </div>
            <div className="iam-cms-stat">
              <div className="iam-cms-stat__label">Collections</div>
              <div className="iam-cms-stat__value">—</div>
            </div>
            <div className="iam-cms-stat">
              <div className="iam-cms-stat__label">Integrations</div>
              <div className="iam-cms-stat__value">—</div>
            </div>
            <div className="iam-cms-stat">
              <div className="iam-cms-stat__label">Theme</div>
              <div className="iam-cms-stat__value">—</div>
            </div>
          </div>
          <div className="iam-cms-site-hero__actions">
            <button
              type="button"
              className="iam-cms-btn iam-cms-btn--primary"
              onClick={() => onOpenDeployWizard?.()}
            >
              New site
              <ArrowRight size={16} strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              className="iam-cms-btn"
              onClick={() => onOpenDeployWizard?.()}
            >
              Import theme
            </button>
          </div>
        </section>
      );
    }

    if (setupMode === 'pick-site') {
      return (
        <section className="iam-cms-card iam-cms-site-hero iam-cms-site-hero--setup">
          <div className="iam-cms-site-hero__head">
            <div>
              <p className="iam-cms-site-hero__suite">Active site</p>
              <h2 className="iam-cms-site-hero__name">Choose a site</h2>
              <p className="iam-cms-site-hero__meta">Pick which CMS site to open.</p>
            </div>
            <CmsSiteSwitcher
              sites={sites}
              activeSlug={siteSlug}
              size="sm"
              onSelect={(slug) => {
                if (onSelectSite) void onSelectSite(slug, buildCmsHubPath(slug));
              }}
              onNewSite={onOpenDeployWizard}
            />
          </div>
          <div className="iam-cms-site-picker">
            {sites.map((row) => (
              <button
                key={row.slug}
                type="button"
                className="iam-cms-site-picker__btn"
                onClick={() => {
                  if (onSelectSite) void onSelectSite(row.slug, buildCmsHubPath(row.slug));
                }}
              >
                <span className="iam-cms-site-picker__name">{row.name || row.slug}</span>
                <span className="iam-cms-site-picker__slug">{row.domain || row.slug}</span>
              </button>
            ))}
          </div>
          {onOpenDeployWizard ? (
            <div className="iam-cms-site-hero__actions">
              <button type="button" className="iam-cms-btn" onClick={() => onOpenDeployWizard()}>
                <Plus size={14} aria-hidden />
                Deploy new site
              </button>
            </div>
          ) : null}
        </section>
      );
    }

    if (bootError) {
      return (
        <section className="iam-cms-card iam-cms-site-hero">
          <p className="iam-cms-site-hero__meta">{bootError}</p>
          <button type="button" className="iam-cms-btn" onClick={() => void loadSiteData()}>
            Retry
          </button>
        </section>
      );
    }

    return (
      <section className="iam-cms-card iam-cms-site-hero">
        <div className="iam-cms-site-hero__head">
          <div className="iam-cms-site-hero__identity">
            <AppIcon
              title={siteDisplayName}
              imageUrl={cfImageVariants(siteIconUrl).src || undefined}
              backgroundColor={
                siteIconUrl ? undefined : `hsl(${projectAccentHue(linkedProject?.id || siteSlug || 'cms')} 42% 38%)`
              }
              size="lg"
              editable={Boolean(linkedProject?.id)}
              disabled={iconUploading}
              onImageDrop={linkedProject?.id ? handleIconDrop : undefined}
            />
            <div>
              <p className="iam-cms-site-hero__suite">Active site · CMS Suite</p>
              <h2 className="iam-cms-site-hero__name">{siteDisplayName}</h2>
              <p className="iam-cms-site-hero__meta">
                {storefrontDisplayHost(storefrontUrl) || siteSlug}
                {drafts ? ` · ${drafts} draft${drafts === 1 ? '' : 's'}` : ''}
              </p>
            </div>
          </div>
          <div className="iam-cms-site-hero__head-actions">
            <span className="iam-cms-site-hero__live">
              <i aria-hidden />
              Live
            </span>
            {onSelectSite ? (
              <CmsSiteSwitcher
                sites={sites}
                activeSlug={siteSlug}
                size="sm"
                onSelect={(slug) => {
                  void onSelectSite(slug, buildCmsHubPath(slug));
                }}
                onNewSite={onOpenDeployWizard}
              />
            ) : null}
          </div>
        </div>
        <div className="iam-cms-site-hero__stats" aria-label="Site readiness">
          <div className="iam-cms-stat">
            <div className="iam-cms-stat__label">Pages</div>
            <div className="iam-cms-stat__value">{pages.length}</div>
          </div>
          <div className="iam-cms-stat">
            <div className="iam-cms-stat__label">Collections</div>
            <div className="iam-cms-stat__value">{collectionCount}</div>
          </div>
          <div className="iam-cms-stat">
            <div className="iam-cms-stat__label">Integrations</div>
            <div className="iam-cms-stat__value">{connectedCount}</div>
          </div>
          <div className="iam-cms-stat">
            <div className="iam-cms-stat__label">Theme</div>
            <div className="iam-cms-stat__value">{themes.length}</div>
          </div>
        </div>
        <div className="iam-cms-site-hero__actions">
          <button
            type="button"
            className="iam-cms-btn iam-cms-btn--primary"
            onClick={() => siteSlug && onNavigate(buildCmsPath({ panel: 'theme-editor', siteSlug }))}
          >
            Open CMS
            <ArrowRight size={16} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className="iam-cms-btn"
            onClick={() => siteSlug && onNavigate(buildCmsPath({ panel: 'pages', siteSlug }))}
          >
            Edit site
          </button>
          {storefrontUrl ? (
            <a className="iam-cms-btn" href={storefrontUrl} target="_blank" rel="noopener noreferrer">
              View site
              <ExternalLink size={14} strokeWidth={2} aria-hidden />
            </a>
          ) : null}
        </div>
        <div className="iam-cms-site-hero__footer">
          {siteSlug ? <CmsHubImportStrip projectSlug={siteSlug} compact /> : null}
          {onOpenDeployWizard ? (
            <button type="button" className="iam-cms-site-hero__footer-link" onClick={() => onOpenDeployWizard()}>
              <Plus size={14} aria-hidden />
              New site
            </button>
          ) : null}
        </div>
      </section>
    );
  };

  return (
    <div className="iam-cms-dashboard">
      <div className="iam-cms-dashboard__hero">
        {renderActiveSiteCard()}

        <div className="iam-cms-modules">
          {showModuleSkeleton
            ? [1, 2, 3, 4].map((n) => <ModuleCardSkeleton key={n} />)
            : modules.map((m) =>
                'action' in m && m.action === 'structure' ? (
                  <button
                    key={m.id}
                    type="button"
                    className={`iam-cms-card iam-cms-module${structureOpen ? ' is-active' : ''}${setupMode !== 'active' ? ' is-muted' : ''}`}
                    onClick={() => {
                      if (setupMode !== 'active') {
                        onOpenDeployWizard?.();
                        return;
                      }
                      setStructureOpen((v) => !v);
                    }}
                  >
                    <h3 className="iam-cms-module__title">{m.title}</h3>
                    <p className="iam-cms-module__desc">{m.desc}</p>
                    <p className="iam-cms-module__sub">{m.sub}</p>
                    <span className="iam-cms-module__cta">{m.cta}</span>
                  </button>
                ) : (
                  <button
                    key={m.id}
                    type="button"
                    className={`iam-cms-card iam-cms-module${setupMode !== 'active' ? ' is-muted' : ''}`}
                    onClick={() => guardNavigate((m as { path: string }).path)}
                  >
                    <h3 className="iam-cms-module__title">{m.title}</h3>
                    <p className="iam-cms-module__desc">{m.desc}</p>
                    <p className="iam-cms-module__sub">{m.sub}</p>
                    <span className="iam-cms-module__cta">{m.cta}</span>
                  </button>
                ),
              )}
        </div>
      </div>

      {structureOpen && siteSlug && setupMode === 'active' ? (
        <CmsSiteStructurePanel
          siteSlug={siteSlug}
          context={context}
          pageCount={pages.length}
          themeCount={themes.length}
          importCount={imports.length}
        />
      ) : null}

      <div className="iam-cms-dashboard__grid iam-cms-dashboard__grid--two">
        <section className="iam-cms-card">
          <div className="iam-cms-panel-head">Recent activity</div>
          {setupMode === 'loading' || (hasActiveSite && activityLoading) ? (
            <PanelSkeleton rows={5} />
          ) : activity.length ? (
            <ul className="iam-cms-activity">
              {activity.map((row, i) => {
                const status = activityStatus(row);
                return (
                  <li key={row.id || i}>
                    <span className="iam-cms-activity__action">{activityLabel(row)}</span>
                    <span className="iam-cms-activity__meta">
                      <span className={`iam-cms-activity__tag is-${status}`}>
                        {status === 'published' ? 'Published' : 'Draft'}
                      </span>
                      <span className="iam-cms-activity__when">{formatWhen(row.created_at)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="iam-cms-site-hero__meta" style={{ padding: '16px' }}>
              {setupMode === 'deploy'
                ? 'Activity will appear here after you deploy a site.'
                : setupMode === 'pick-site'
                  ? 'Choose a site to see recent edits and publishes.'
                  : pages.length
                    ? `${pages.length} page${pages.length === 1 ? '' : 's'} on this site — edits will appear here.`
                    : 'No recent activity logged yet.'}
            </p>
          )}
        </section>

        <section className="iam-cms-card">
          <div className="iam-cms-panel-head">Quick actions</div>
          {setupMode === 'loading' ? (
            <PanelSkeleton rows={5} />
          ) : (
            <ul className="iam-cms-quick">
              {quickActions.map((a) => (
                <li key={a.label}>
                  <button
                    type="button"
                    onClick={() => {
                      if (setupMode !== 'active') {
                        onOpenDeployWizard?.();
                        return;
                      }
                      if ('action' in a && a.action === 'import') {
                        document
                          .querySelector('.iam-cms-import-strip')
                          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        return;
                      }
                      if ('path' in a && a.path) onNavigate(a.path);
                    }}
                  >
                    {a.label}
                    <ArrowRight size={14} strokeWidth={2} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <CmsIntegrationsStrip
        items={connectedIntegrations}
        loading={setupMode === 'loading' || integrationsLoading}
        error={integrationsError}
        onRetry={() => {
          void refreshIntegrations();
        }}
      />

      {context && setupMode === 'active' ? (
        <div className="iam-cms-runtime iam-cms-muted">
          Hosting profile: {context.cms_hosting || 'platform'}
          {context.bridge_supported ? ' · bridge' : ''}
          {imports.length ? ` · ${imports.length} import${imports.length === 1 ? '' : 's'}` : ''}
        </div>
      ) : null}
    </div>
  );
}

export default CmsDashboard;
