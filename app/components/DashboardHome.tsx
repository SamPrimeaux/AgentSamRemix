import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Sparkles,
  Plus,
  ArrowRight,
  Pencil,
  PenLine,
  Layers,
  Code2,
  Rocket,
  type LucideIcon,
} from 'lucide-react';
import { startNewAgentChat } from '../lib/openAgentConversation';
import { fetchProjectsList, type OverviewProject } from '../client-api/projects';
import { readIamProjectsCache, writeIamProjectsCache } from '../src/iamProjectsCache';
import { cfImageVariants, cfHeroWallpaper, projectAccentHue, projectInitials } from '../src/lib/projectBranding';
import {
  fetchDashboardHomeTiles,
  saveDashboardHomeTiles,
  type DashboardHomeTile,
} from '../client-api/home';
import { fetchConnectTiles, saveConnectTiles, type ConnectTile } from '../client-api/connectTiles';
import { StartProjectWizard } from './projects/StartProjectWizard';
import { AppIcon } from './ui/AppIcon';
import {
  HomeTileEditor,
  loadHomeLayoutDraft,
  saveHomeLayoutDraft,
} from './home/HomeTileEditor';
import { ConnectIconEditor } from './home/ConnectIconEditor';
import { ConnectCatalogSheet } from './home/ConnectCatalogSheet';
import { AISpendDonut } from './home/AISpendDonut';
import { RoutingRecentActivity } from './home/RoutingRecentActivity';
import { useWorkspace } from '../src/context/WorkspaceContext';
import './ui/AppIcon.css';
import './home/HomeTileEditor.css';
import './home/ConnectCatalogSheet.css';
import './DashboardHome.css';

/** Fallback when D1 `home_hero` tile is missing — update via dashboard_home_tiles.image_url. */
const DEFAULT_HOME_HERO_IMAGE =
  'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/cb28eb31-cdf8-4e80-7969-1952d96d9600/public';
const HOME_HERO_TILE_KEY = 'home_hero';

const CREATION_WORKFLOW: { id: string; label: string; path: string; icon: LucideIcon }[] = [
  { id: 'design', label: 'Design', path: '/dashboard/draw', icon: PenLine },
  { id: 'model', label: 'Model', path: '/dashboard/designstudio', icon: Box },
  { id: 'assets', label: 'Assets', path: '/dashboard/artifacts', icon: Layers },
  { id: 'prototype', label: 'Prototype', path: '/dashboard/cms', icon: Code2 },
  { id: 'deploy', label: 'Deploy', path: '/dashboard/workflows', icon: Rocket },
];

const FALLBACK_QUICK_TILES: DashboardHomeTile[] = [
  {
    id: 'fallback_agent',
    tile_key: 'agent_sam',
    title: 'Agent Sam',
    cta_label: 'Chat',
    path: '/dashboard/agent',
    image_url: 'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/b5557284-485e-4305-2c5a-49c6acf99a00/public',
    tile_size: 'lg',
    sort_order: 10,
    is_enabled: true,
  },
  {
    id: 'fallback_studio',
    tile_key: 'design_studio',
    title: 'Design Studio',
    cta_label: 'Build',
    path: '/dashboard/designstudio',
    image_url: 'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/b5557284-485e-4305-2c5a-49c6acf99a00/public',
    tile_size: 'lg',
    sort_order: 20,
    is_enabled: true,
  },
  {
    id: 'fallback_database',
    tile_key: 'database',
    title: 'Database',
    cta_label: 'Inspect',
    path: '/dashboard/database',
    image_url: 'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/c2eec95d-98c4-48ed-0394-45ae2f632300/public',
    tile_size: 'lg',
    sort_order: 30,
    is_enabled: true,
  },
  {
    id: 'fallback_cms',
    tile_key: 'cms_suite',
    title: 'CMS Suite',
    cta_label: 'Edit',
    path: '/dashboard/cms',
    image_url: 'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/b1d0bd36-0f88-4301-4e68-7e8d5e255b00/public',
    tile_size: 'lg',
    sort_order: 40,
    is_enabled: true,
  },
];

function projectHref(project: OverviewProject) {
  return `/dashboard/projects/${encodeURIComponent(project.id)}`;
}

function projectUpdatedLabel(project: OverviewProject) {
  if (project.lastDeploy && project.lastDeploy !== '—') return `Updated ${project.lastDeploy}`;
  if (project.dueDate && project.dueDate !== '—') return `Due ${project.dueDate}`;
  return 'Recently active';
}

export function DashboardHome() {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const [quickTiles, setQuickTiles] = useState<DashboardHomeTile[]>(FALLBACK_QUICK_TILES);
  const [quickTilesBaseline, setQuickTilesBaseline] = useState<DashboardHomeTile[]>(FALLBACK_QUICK_TILES);
  const [recentProjects, setRecentProjects] = useState<OverviewProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editingTileKey, setEditingTileKey] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [connectTiles, setConnectTiles] = useState<ConnectTile[]>([]);
  const [connectTilesBaseline, setConnectTilesBaseline] = useState<ConnectTile[]>([]);
  const [catalogAvailable, setCatalogAvailable] = useState<ConnectTile[]>([]);
  const [connectCatalogOpen, setConnectCatalogOpen] = useState(false);
  const [editingConnectKey, setEditingConnectKey] = useState<string | null>(null);
  const [startProjectOpen, setStartProjectOpen] = useState(false);

  const refreshConnectTiles = useCallback(async () => {
    const res = await fetchConnectTiles('home');
    if (!res.ok) return;
    const tiles = res.tiles || [];
    setConnectTiles(tiles);
    setConnectTilesBaseline(tiles.map((t) => ({ ...t })));
    setCatalogAvailable(res.catalog_available || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchConnectTiles('home');
      if (cancelled || !res.ok) return;
      const tiles = res.tiles || [];
      setConnectTiles(tiles);
      setConnectTilesBaseline(tiles.map((t) => ({ ...t })));
      setCatalogAvailable(res.catalog_available || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchDashboardHomeTiles(workspaceId);
      if (cancelled) return;
      if (res.ok && res.tiles?.length) {
        setQuickTiles(res.tiles);
        setQuickTilesBaseline(res.tiles);
      } else if (workspaceId) {
        const draft = loadHomeLayoutDraft(workspaceId);
        if (draft?.length) setQuickTiles(draft);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    const cached = readIamProjectsCache(workspaceId);
    if (cached?.projects?.length) {
      setRecentProjects(cached.projects.slice(0, 4));
      setProjectsLoading(false);
    } else {
      setProjectsLoading(true);
    }
    void (async () => {
      const fast = await fetchProjectsList(workspaceId);
      if (cancelled) return;
      if (fast.ok && fast.projects.length) {
        const sorted = [...fast.projects].sort((a, b) => {
          const pa = Number(a.priority_num) || 0;
          const pb = Number(b.priority_num) || 0;
          if (pb !== pa) return pb - pa;
          return a.name.localeCompare(b.name);
        });
        const slice = sorted.slice(0, 4);
        setRecentProjects(slice);
        if (workspaceId) writeIamProjectsCache(workspaceId, fast.projects);
        setProjectsLoading(false);
      } else if (!cached?.projects?.length) {
        setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const enterEditMode = useCallback(() => {
    setQuickTilesBaseline(quickTiles.map((t) => ({ ...t })));
    setConnectTilesBaseline(connectTiles.map((t) => ({ ...t })));
    setSaveError(null);
    setEditMode(true);
  }, [quickTiles, connectTiles]);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setEditingTileKey(null);
    setEditingConnectKey(null);
  }, []);

  const saveLayout = useCallback(async () => {
    setSaveBusy(true);
    setSaveError(null);
    if (workspaceId?.trim()) {
      saveHomeLayoutDraft(workspaceId, quickTiles);
      const res = await saveDashboardHomeTiles(workspaceId, quickTiles);
      if (!res.ok) {
        setSaveBusy(false);
        setSaveError(res.error || 'Save failed — kept local draft');
        return;
      }
      if (res.tiles?.length) {
        setQuickTiles(res.tiles);
        setQuickTilesBaseline(res.tiles);
      }
      if (connectTiles.length) {
        const connectRes = await saveConnectTiles(
          'home',
          connectTiles.map((t) => ({
            provider_key: t.provider_key,
            sort_order: t.sort_order,
            show_on_home: t.show_on_home ?? true,
            show_on_workspace: t.show_on_workspace ?? false,
            icon_scale: t.icon_scale ?? 1,
            icon_bg: t.icon_bg ?? null,
            custom_icon_url: t.custom_icon_url ?? null,
          })),
        );
        if (!connectRes.ok) {
          setSaveBusy(false);
          setSaveError(connectRes.error || 'Connect icons failed to save');
          return;
        }
        if (connectRes.tiles?.length) {
          setConnectTiles(connectRes.tiles);
          setConnectTilesBaseline(connectRes.tiles.map((t) => ({ ...t })));
        }
      }
    } else {
      saveHomeLayoutDraft('local', quickTiles);
    }
    setSaveBusy(false);
    exitEditMode();
  }, [workspaceId, quickTiles, connectTiles, exitEditMode]);

  const resetLayout = useCallback(() => {
    setQuickTiles(quickTilesBaseline.map((t) => ({ ...t })));
    setConnectTiles(connectTilesBaseline.map((t) => ({ ...t })));
    setEditingTileKey(null);
    setEditingConnectKey(null);
  }, [quickTilesBaseline, connectTilesBaseline]);

  const updateTile = useCallback((tileKey: string, patch: Partial<DashboardHomeTile>) => {
    setQuickTiles((prev) =>
      prev.map((t) => (t.tile_key === tileKey ? { ...t, ...patch } : t)),
    );
  }, []);

  const editingTile = useMemo(
    () => quickTiles.find((t) => t.tile_key === editingTileKey) || null,
    [quickTiles, editingTileKey],
  );

  const quickGrid = useMemo(
    () =>
      quickTiles
        .filter((t) => t.is_enabled && t.tile_key !== HOME_HERO_TILE_KEY)
        .sort((a, b) => a.sort_order - b.sort_order),
    [quickTiles],
  );

  const homeHeroWallpaper = useMemo(() => {
    const heroTile = quickTiles.find((t) => t.tile_key === HOME_HERO_TILE_KEY && t.is_enabled);
    const url = (heroTile?.image_url || DEFAULT_HOME_HERO_IMAGE).trim();
    return cfHeroWallpaper(url || DEFAULT_HOME_HERO_IMAGE);
  }, [quickTiles]);

  const editingConnectTile = useMemo(
    () => connectTiles.find((t) => t.provider_key === editingConnectKey) || null,
    [connectTiles, editingConnectKey],
  );

  const updateConnectTile = useCallback((providerKey: string, next: ConnectTile) => {
    setConnectTiles((prev) =>
      prev.map((t) => (t.provider_key === providerKey ? next : t)),
    );
  }, []);

  const openConnectTile = useCallback((tile: ConnectTile) => {
    if (tile.connected) return;
    if (!tile.connect_url) {
      setConnectCatalogOpen(true);
      return;
    }
    window.location.href = tile.connect_url;
  }, []);

  return (
    <main className={`iam-home ${editMode ? 'iam-home-edit-mode' : ''}`} aria-label="Dashboard home">
      {/* Wallpaper band — outside shell so it is never an inset card. */}
      <section className="iam-home-hero-studio" aria-labelledby="home-title">
        <div className="iam-home-hero-studio__wallpaper" aria-hidden>
          <picture>
            <source media="(min-width: 1100px)" srcSet={homeHeroWallpaper.hero} />
            <source media="(min-width: 640px)" srcSet={homeHeroWallpaper.public} />
            <img
              src={homeHeroWallpaper.public}
              srcSet={`${homeHeroWallpaper.small} 640w, ${homeHeroWallpaper.public} 1280w, ${homeHeroWallpaper.hero} 1920w`}
              sizes="100vw"
              alt=""
              className="iam-home-hero-studio__wallpaper-img"
              loading="eager"
              decoding="async"
              fetchPriority="high"
            />
          </picture>
          <div className="iam-home-hero-studio__scrim" />
        </div>
        <div className="iam-home-hero-studio__copy">
          <p className="iam-home-hero-studio__eyebrow">Design Studio</p>
          <h1 id="home-title" className="iam-home-hero-studio__title">
            Design<span className="iam-home-hero-studio__dot">.</span>
            <br />
            Create<span className="iam-home-hero-studio__dot">.</span>
            <br />
            Ship<span className="iam-home-hero-studio__dot">.</span>
          </h1>
          <p className="iam-home-hero-studio__sub">
            Build interfaces, products, and digital assets. Generate. Refine. Deploy.
          </p>
          <div className="iam-home-hero-studio__actions">
            <button
              type="button"
              className="iam-home-hero-studio__cta"
              onClick={() => startNewAgentChat({ stayOnPage: true })}
            >
              <Sparkles size={16} strokeWidth={1.85} aria-hidden />
              Ask Agent Sam
            </button>
            <button
              type="button"
              className="iam-home-hero-studio__cta-secondary"
              onClick={() => navigate('/dashboard/designstudio')}
            >
              Continue in Design Studio
              <ArrowRight size={16} strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
        <nav className="iam-home-hero-studio__workflow" aria-label="Creation workflow">
          {CREATION_WORKFLOW.map((step) => {
            const Icon = step.icon;
            return (
              <button
                key={step.id}
                type="button"
                className="iam-home-hero-studio__workflow-step"
                onClick={() => navigate(step.path)}
              >
                <span className="iam-home-hero-studio__workflow-icon" aria-hidden>
                  <Icon size={18} strokeWidth={1.6} />
                </span>
                <span>{step.label}</span>
              </button>
            );
          })}
        </nav>
      </section>

      <section className="iam-home-shell">
        <section className="iam-home-section" aria-labelledby="recent-title">
          <div className="iam-section-head">
            <div>
              <h2 id="recent-title">Recent projects</h2>
              <p>Your workspace — not shared across tenants.</p>
            </div>
            <button type="button" onClick={() => navigate('/dashboard/projects')}>View all</button>
          </div>
          <div className="iam-project-lane">
            {projectsLoading ? (
              <div className="iam-project-loading">Loading projects…</div>
            ) : recentProjects.length === 0 ? (
              <div className="iam-project-loading">No projects yet — create one to see it here.</div>
            ) : (
              recentProjects.map((project) => {
                const cover = cfImageVariants(project.cover_image_url);
                const hue = projectAccentHue(project.id);
                return (
                  <button
                    key={project.id}
                    type="button"
                    className="iam-project-card iam-project-card--dynamic"
                    onClick={() => navigate(projectHref(project))}
                  >
                    <span className="iam-project-cover">
                      {cover.src ? (
                        <img src={cover.src} srcSet={cover.srcSet} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <span
                          className="iam-project-cover-fallback"
                          style={{ background: `linear-gradient(135deg, hsl(${hue} 42% 32%), hsl(${hue} 28% 18%))` }}
                          aria-hidden
                        >
                          {projectInitials(project.name)}
                        </span>
                      )}
                    </span>
                    <strong>{project.name}</strong>
                    <small>{projectUpdatedLabel(project)}</small>
                  </button>
                );
              })
            )}
            <button type="button" className="iam-project-card iam-project-card--new" onClick={() => setStartProjectOpen(true)}>
              <span><Plus size={22} strokeWidth={1.75} aria-hidden /></span>
              <strong>New project</strong>
              <small>Guided stack + kanban setup</small>
            </button>
          </div>
        </section>

        <section className={`iam-home-section iam-home-section--quick${editMode ? ' iam-home-section--editing' : ''}`} aria-labelledby="quick-starts-title">
          <div className="iam-section-head">
            <div>
              <h2 id="quick-starts-title">Creation tools</h2>
              <p>Jump into Draw, Design Studio, CMS, and more.</p>
            </div>
            <div className="iam-section-actions">
              {!editMode ? (
                <button type="button" className="iam-section-icon-btn" onClick={enterEditMode} title="Customize home icons">
                  <Pencil size={14} strokeWidth={1.75} aria-hidden />
                  <span>Customize icons</span>
                </button>
              ) : null}
              <button type="button" onClick={() => navigate('/dashboard/agent')}>See all</button>
            </div>
          </div>
          {editMode ? (
            <div className="iam-home-edit-banner">
              <span>
                <strong>Edit mode</strong> — tap any creation or connect icon. Scale, background, and drop-in upload. Canonical prefs also live in Settings → Integrations.
              </span>
              <div className="iam-home-edit-actions">
                <button type="button" onClick={resetLayout}>Reset</button>
                <button type="button" onClick={exitEditMode}>Cancel</button>
                <button type="button" className="primary" disabled={saveBusy} onClick={() => void saveLayout()}>
                  {saveBusy ? 'Saving…' : 'Save layout'}
                </button>
              </div>
            </div>
          ) : null}
          {saveError ? <p className="iam-home-customize-error">{saveError}</p> : null}
          <div className="iam-app-icon-grid iam-app-icon-grid--products">
            {quickGrid.map((tile) => (
              <AppIcon
                key={tile.id || tile.tile_key}
                title={tile.title}
                imageUrl={tile.image_url}
                size="md"
                artScale={tile.icon_scale ?? 1}
                backgroundColor={tile.icon_bg}
                presentation="app"
                subtitle={tile.cta_label}
                editable={editMode}
                editActive={editMode && editingTileKey === tile.tile_key}
                onPress={() => {
                  if (editMode) {
                    setEditingTileKey(tile.tile_key);
                    setEditingConnectKey(null);
                    return;
                  }
                  navigate(tile.path);
                }}
                onEdit={() => setEditingTileKey(tile.tile_key)}
              />
            ))}
          </div>
        </section>

        <section className={`iam-home-section${editMode ? ' iam-home-section--editing' : ''}`} aria-labelledby="connect-context-title">
          <div className="iam-section-head">
            <div>
              <h2 id="connect-context-title">Connect context</h2>
              <p>OAuth and services — tap to connect, or customize icons in edit mode.</p>
            </div>
            <button type="button" onClick={() => setConnectCatalogOpen(true)}>Add app</button>
          </div>
          <div className="iam-app-icon-grid">
            {(connectTiles.length ? connectTiles : []).map((tile) => (
              <AppIcon
                key={tile.provider_key}
                title={tile.title}
                providerKey={tile.provider_key}
                iconSlug={tile.icon_slug}
                imageUrl={tile.icon_url}
                registryIconUrl={tile.custom_icon_url}
                size="md"
                artScale={tile.icon_scale ?? 1}
                backgroundColor={tile.icon_bg}
                status={tile.issue === 'error' ? 'error' : tile.issue === 'warning' ? 'warning' : null}
                subtitle={
                  tile.issue === 'error'
                    ? 'Reconnect'
                    : tile.issue === 'warning'
                      ? 'Issue'
                      : tile.connected
                        ? tile.account_display || 'Connected'
                        : 'Connect'
                }
                editable={editMode}
                editActive={editMode && editingConnectKey === tile.provider_key}
                onPress={() => {
                  if (editMode) {
                    setEditingConnectKey(tile.provider_key);
                    setEditingTileKey(null);
                    return;
                  }
                  openConnectTile(tile);
                }}
                onEdit={() => {
                  setEditingConnectKey(tile.provider_key);
                  setEditingTileKey(null);
                }}
              />
            ))}
            {!editMode ? (
              <article className="iam-app-icon-wrap iam-app-icon-wrap--md iam-app-icon-wrap--add">
                <button
                  type="button"
                  className="iam-app-icon-shell iam-app-icon-shell--app"
                  aria-label="Connect app"
                  onClick={() => setConnectCatalogOpen(true)}
                >
                  <span className="iam-app-icon-fallback">+</span>
                </button>
                <p className="iam-app-icon-label">Connect app</p>
                <p className="iam-app-icon-sub">Add integration</p>
              </article>
            ) : null}
          </div>
        </section>

        <ConnectCatalogSheet
          open={connectCatalogOpen}
          options={catalogAvailable}
          onClose={() => setConnectCatalogOpen(false)}
          onConnected={() => void refreshConnectTiles()}
        />

        <section className="iam-home-section" aria-labelledby="ai-spend-title">
          <h2 id="ai-spend-title" className="sr-only">AI spend</h2>
          <AISpendDonut />
        </section>

        <section className="iam-home-section" aria-labelledby="routing-recent-title">
          <div className="iam-section-head">
            <div>
              <h2 id="routing-recent-title">Recent activity</h2>
              <p>Routing decisions and notifications — inspect what you missed.</p>
            </div>
          </div>
          <RoutingRecentActivity />
        </section>
      </section>

      {editingTile ? (
        <HomeTileEditor
          tile={editingTile}
          workspaceId={workspaceId}
          onChange={(next) => updateTile(editingTile.tile_key, next)}
          onClose={() => setEditingTileKey(null)}
          onReset={() => {
            const base = quickTilesBaseline.find((t) => t.tile_key === editingTile.tile_key);
            if (base) updateTile(editingTile.tile_key, { ...base });
          }}
        />
      ) : null}

      {editingConnectTile ? (
        <ConnectIconEditor
          tile={editingConnectTile}
          workspaceId={workspaceId}
          onChange={(next) => updateConnectTile(editingConnectTile.provider_key, next)}
          onClose={() => setEditingConnectKey(null)}
          onReset={() => {
            const base = connectTilesBaseline.find((t) => t.provider_key === editingConnectTile.provider_key);
            if (base) updateConnectTile(editingConnectTile.provider_key, { ...base });
          }}
        />
      ) : null}

      <StartProjectWizard
        open={startProjectOpen}
        onClose={() => setStartProjectOpen(false)}
        onCreated={(id) => {
          setStartProjectOpen(false);
          if (id) navigate(`/dashboard/projects/${encodeURIComponent(id)}`);
          else navigate('/dashboard/projects');
        }}
      />
    </main>
  );
}

export default DashboardHome;
