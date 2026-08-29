import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useLibraryWorkspace } from '../../lib/library/useLibraryWorkspace';
import type { LibraryItem, LibrarySource, SourceFilter } from '../../lib/library/types';
import { openDriveShareDialog } from '../../lib/library/googleDriveWidgets';
import { createSharedDrive, hasDriveManageScope } from '../../lib/library/sharedDriveApi';
import {
  createDriveFolder,
  deleteDriveFilePermanent,
  emptyDriveTrash,
  renameDriveFile,
  restoreDriveFile,
  trashDriveFile,
  uploadDriveFiles,
} from '../../lib/library/driveOpsApi';
import { LibraryConnectMenu } from './LibraryConnectMenu';
import { LibraryHomeLanes } from './LibraryHomeLanes';
import { LibraryProjectsSurface } from './LibraryProjectsSurface';
import { LibraryTicketsSurface } from './LibraryTicketsSurface';
import { LibraryFileDriveActions } from './LibraryFileDriveActions';
import { LibraryListView } from './LibraryListView';
import { LibrarySideRail } from './LibrarySideRail';
import { SharedDriveManagePanel } from './SharedDriveManagePanel';
import { LibraryFileIcon, LibraryThumb, sourceLabel } from './LibraryThumb';
import { NAV_DRIVE_VIEW, NAV_RAIL_MAP } from '../../lib/library/types';
import '../../styles/library.css';
import '../../styles/library-project-tabs.css';

const CONTEXT_ACTIONS = ['Open', 'Share', 'Rename', 'Download', 'Move to trash'] as const;

const NEW_MENU_ITEMS = [
  'New folder',
  'File upload',
  'Folder upload',
  'Google Docs',
] as const;

const NAV_ITEMS = [
  { key: 'home', label: 'Work', icon: 'home' },
  { key: 'projects', label: 'Projects', icon: 'projectFolder' },
  { key: 'tickets', label: 'Tickets', icon: 'tickets' },
  { key: 'artifacts', label: 'My artifacts', icon: 'artifacts' },
  { key: 'workspaces', label: 'R2 Storage', icon: 'workspaces' },
  { key: 'my-drive', label: 'Google Drive', icon: 'drive' },
  { key: 'shared', label: 'Shared drives', icon: 'shared' },
  { key: 'computers', label: 'Local folder', icon: 'computers' },
  { key: 'shared-with-me', label: 'Shared with me', icon: 'sharedWithMe' },
  { key: 'recent', label: 'Recent', icon: 'recent' },
  { key: 'starred', label: 'Starred', icon: 'starred' },
  { key: 'trash', label: 'Trash', icon: 'trash' },
] as const;

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, JSX.Element> = {
    home: <path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />,
    activity: (
      <>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    projectFolder: (
      <>
        <path d="M3 7h7l2 2h9v10H3z" />
        <path d="M12 11v4M10 13h4" />
      </>
    ),
    artifacts: (
      <>
        <path d="M4 5h16v14H4z" />
        <path d="M8 9h8M8 13h5" />
      </>
    ),
    tickets: (
      <>
        <path d="M4 5h16v4H4zM4 11h16v8H4z" />
        <path d="M8 14h5M8 17h8" />
      </>
    ),
    projects: (
      <>
        <path d="M4 5h16v14H4z" />
        <path d="M8 9h8M8 13h5" />
      </>
    ),
    workspaces: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
    drive: <path d="M3 7h7l2 2h9v10H3z" />,
    shared: (
      <>
        <path d="M3 7h7l2 2h9v10H3z" />
        <path d="M8 13h8" />
      </>
    ),
    computers: (
      <>
        <path d="M4 5h16v12H4zM8 21h8" />
      </>
    ),
    sharedWithMe: <path d="M16 11a4 4 0 1 0-8 0M4 20a8 8 0 0 1 16 0" />,
    recent: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    starred: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.8 6.4 21.2 7.5 15 3 10.6l6.2-.9Z" />,
    trash: (
      <>
        <path d="M4 7h16M9 7V5h6v2M6 7l1 14h10l1-14" />
      </>
    ),
    storage: <path d="M4 15a4 4 0 0 0 4 4h9a5 5 0 0 0 1-9.9A7 7 0 0 0 5.8 7.6 4.5 4.5 0 0 0 4 15Z" />,
  };
  return (
    <svg className="drive-icon" viewBox="0 0 24 24" aria-hidden>
      {paths[name]}
    </svg>
  );
}

function KebabButton() {
  return (
    <span className="kebab" role="presentation" aria-hidden>
      <svg className="drive-icon" viewBox="0 0 24 24">
        <path d="M12 6h.01M12 12h.01M12 18h.01" strokeWidth={3} />
      </svg>
    </span>
  );
}

function railForNavKey(key: string): string | undefined {
  return NAV_RAIL_MAP[key];
}

export function ArtifactsDriveShell() {
  const ws = useLibraryWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(true);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sourceFilterOpen, setSourceFilterOpen] = useState(false);
  const [railPanelOpen, setRailPanelOpen] = useState(false);
  const [manageDriveOpen, setManageDriveOpen] = useState(false);
  const [createDriveOpen, setCreateDriveOpen] = useState(false);
  const [newDriveName, setNewDriveName] = useState('');
  const [createDriveBusy, setCreateDriveBusy] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);

  const canManageSharedDrives = hasDriveManageScope(ws.driveStatus);
  const showSharedDriveTools = ws.driveView === 'shared-drives' || ws.driveView === 'shared-drive';
  const isProjectsRoute = location.pathname === '/dashboard/projects' || location.pathname.startsWith('/dashboard/projects/');
  const isArtifactsTicketsRoute =
    location.pathname === '/dashboard/artifacts/tickets' ||
    location.pathname.startsWith('/dashboard/artifacts/tickets/');
  const routeProjectMatch = location.pathname.match(/^\/dashboard\/projects\/([^/?#]+)/);
  const routeProjectId = routeProjectMatch?.[1] ? decodeURIComponent(routeProjectMatch[1]) : null;
  const isProjectsView = isProjectsRoute || ws.filters.rail === 'projects';
  const isTicketsView = !isProjectsView && (isArtifactsTicketsRoute || ws.filters.rail === 'tickets');
  const isHomeLanes = !isProjectsView && !isTicketsView && ws.filters.rail === 'all';
  const projectIdParam = isProjectsRoute ? routeProjectId : searchParams.get('project');

  const isMobileArtifactsNav = useCallback(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  }, []);

  const closeMobileSideNav = useCallback(() => {
    if (isMobileArtifactsNav()) setSideCollapsed(true);
  }, [isMobileArtifactsNav]);

  useEffect(() => {
    closeMobileSideNav();
  }, [location.pathname, location.search, closeMobileSideNav]);

  const openSourceLane = useCallback(
    (source: LibrarySource) => {
      if (source === 'artifacts') ws.setNavKey('artifacts');
      else if (source === 'drive') ws.setNavKey('my-drive');
      else if (source === 'r2') ws.setNavKey('workspaces');
      else if (source === 'local') ws.setNavKey('computers');
    },
    [ws],
  );
  const activeSharedDriveId = ws.sharedDriveId || ws.driveFolderStack[0]?.id || null;
  const activeSharedDriveName =
    ws.driveFolderStack[0]?.name ||
    ws.items.find((i) => i.metadata?.isSharedDriveRoot && i.nativeId === activeSharedDriveId)?.name ||
    ws.pageTitle;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);

  const openFileDetails = useCallback(
    (item: LibraryItem) => {
      setSelected(item);
      setDrawerOpen(true);
      showToast(`${item.name} selected`);
    },
    [showToast],
  );

  const handleItemClick = useCallback(
    (item: LibraryItem) => {
      setSelected(item);
      if (item.kind === 'folder') {
        ws.navigateIntoFolder(item);
        return;
      }
      openFileDetails(item);
    },
    [openFileDetails, ws],
  );

  const clearSessionFilter = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('session_id');
      return next;
    });
  }, [setSearchParams]);

  useEffect(() => {
    const onDocClick = () => {
      setNewMenuOpen(false);
      setContextMenu(null);
      setSourceFilterOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    const view = searchParams.get('view');
    if (view === 'projects' && location.pathname === '/dashboard/artifacts') {
      const pid = searchParams.get('project');
      navigate(
        pid ? `/dashboard/projects/${encodeURIComponent(pid)}` : '/dashboard/projects',
        { replace: true },
      );
      return;
    }
    if (isArtifactsTicketsRoute && ws.filters.rail !== 'tickets') {
      ws.setNavKey('tickets');
      return;
    }
    if (isProjectsRoute && ws.filters.rail !== 'projects') {
      ws.setNavKey('projects');
    } else if (view === 'projects' && ws.filters.rail !== 'projects') {
      ws.setNavKey('projects');
    }
  }, [searchParams, ws, location.pathname, navigate, isProjectsRoute, isArtifactsTicketsRoute]);

  const handleProjectChange = useCallback(
    (projectId: string | null) => {
      if (isProjectsRoute) {
        navigate(
          projectId ? `/dashboard/projects/${encodeURIComponent(projectId)}` : '/dashboard/projects',
        );
        return;
      }
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (projectId) next.set('project', projectId);
        else next.delete('project');
        next.set('view', 'projects');
        return next;
      });
    },
    [isProjectsRoute, navigate, setSearchParams],
  );

  const handleContextMenu = (e: MouseEvent, item: LibraryItem) => {
    e.preventDefault();
    setSelected(item);
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  const openSelected = useCallback(
    (item: LibraryItem) => {
      if (item.kind === 'folder') {
        ws.navigateIntoFolder(item);
        return;
      }
      if (item.rawUrl) {
        window.open(item.rawUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      openFileDetails(item);
    },
    [openFileDetails, ws],
  );

  const driveNeedsConnect =
    ws.filters.rail === 'drive' && ws.driveConnected === false && !ws.loading;
  const primaryError = ws.errors[0];

  const handleCreateSharedDrive = async () => {
    const name = newDriveName.trim();
    if (!name) return;
    if (!canManageSharedDrives) {
      ws.connectDriveForManage();
      return;
    }
    setCreateDriveBusy(true);
    try {
      const out = await createSharedDrive(name);
      if (!out.ok) {
        showToast(out.error || 'Could not create shared drive');
        return;
      }
      showToast(`Created "${out.drive?.name || name}"`);
      setCreateDriveOpen(false);
      setNewDriveName('');
      await ws.refresh();
    } finally {
      setCreateDriveBusy(false);
    }
  };

  const currentDriveParentId = () => {
    if (ws.driveFolderStack.length) return ws.driveFolderStack[ws.driveFolderStack.length - 1]?.id;
    if (ws.sharedDriveId) return ws.sharedDriveId;
    return 'root';
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!ws.driveConnected) {
      ws.connectDrive();
      return;
    }
    const out = await uploadDriveFiles(files, currentDriveParentId());
    if (!out.ok) showToast(out.error || 'Upload failed');
    else showToast(`Uploaded ${out.uploaded} file(s)`);
    await ws.refresh();
  };

  const handleDriveContextAction = async (action: string, item: LibraryItem) => {
    if (item.source !== 'drive') {
      showToast(`${action} — Drive files only`);
      return;
    }
    const fileId = item.nativeId;
    if (action === 'Rename') {
      const next = window.prompt('New name', item.name);
      if (!next?.trim() || next.trim() === item.name) return;
      const out = await renameDriveFile(fileId, next.trim());
      showToast(out.ok ? 'Renamed' : out.error || 'Rename failed');
      if (out.ok) await ws.refresh();
      return;
    }
    if (action === 'Move to trash') {
      if (!window.confirm(`Move "${item.name}" to trash?`)) return;
      const out = await trashDriveFile(fileId);
      showToast(out.ok ? 'Moved to trash' : out.error || 'Trash failed');
      if (out.ok) await ws.refresh();
      return;
    }
    if (action === 'Restore') {
      const out = await restoreDriveFile(fileId);
      showToast(out.ok ? 'Restored' : out.error || 'Restore failed');
      if (out.ok) await ws.refresh();
      return;
    }
    if (action === 'Delete forever') {
      if (!window.confirm(`Permanently delete "${item.name}"?`)) return;
      const out = await deleteDriveFilePermanent(fileId);
      showToast(out.ok ? 'Deleted permanently' : out.error || 'Delete failed');
      if (out.ok) await ws.refresh();
    }
  };

  return (
    <div
      className={`artifacts-drive-shell flex-1 min-h-0 min-w-0${railPanelOpen ? ' has-rail-panel' : ''}${manageDriveOpen ? ' has-shared-drive-panel' : ''}${sideCollapsed ? ' side-collapsed' : ''}`}
    >
      {!sideCollapsed ? (
        <button
          type="button"
          className="drive-side-backdrop"
          aria-label="Close menu"
          onClick={() => setSideCollapsed(true)}
        />
      ) : null}
      <div className="drive-app">
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void handleUploadFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <header className="topbar">
          <div className="brand">
            <button
              type="button"
              className="hamb"
              aria-label={sideCollapsed ? 'Open menu' : 'Close menu'}
              aria-expanded={!sideCollapsed}
              onClick={() => setSideCollapsed((v) => !v)}
            >
              <svg
                className={`hamb-icon${sideCollapsed ? '' : ' is-open'}`}
                viewBox="0 0 24 24"
                aria-hidden
              >
                <line className="hamb-bar hamb-bar-top" x1="4" y1="7" x2="20" y2="7" />
                <line className="hamb-bar hamb-bar-mid" x1="4" y1="12" x2="20" y2="12" />
                <line className="hamb-bar hamb-bar-bottom" x1="4" y1="17" x2="20" y2="17" />
              </svg>
            </button>
            <span className="drive-mark">
              <img
                className="drive-logo-img"
                src="https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/87aac7e9-d6c7-4a53-df89-605e8020e000/thumbnail"
                alt=""
                width={28}
                height={28}
                decoding="async"
              />
            </span>
            <span className="label">Work</span>
          </div>

          <label className="search">
            <svg className="drive-icon" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              placeholder="Search files across sources"
              value={ws.filters.query}
              onChange={(e) => ws.setQuery(e.target.value)}
            />
            <button type="button" className="tune" aria-label="Search options" onClick={() => void ws.refresh()}>
              <svg className="drive-icon" viewBox="0 0 24 24">
                <path d="M4 7h10M18 7h2M4 17h2M10 17h10M7 5v4M15 15v4" />
              </svg>
            </button>
          </label>

          <div />

          <div className="top-actions">
            <LibraryConnectMenu
              driveStatus={ws.driveStatus}
              localFolderName={ws.localFolderName}
              localNeedsReconnect={ws.localNeedsReconnect}
              onConnectDrive={ws.connectDrive}
              onDisconnectDrive={ws.disconnectDrive}
              onConnectLocal={ws.connectLocalFolder}
              onRefreshStatus={ws.refreshDriveStatus}
              onToast={showToast}
            />
            <button type="button" className="icon-btn" title="Refresh" onClick={() => void ws.refresh()}>
              <svg className="drive-icon" viewBox="0 0 24 24">
                <path d="M4 4v6h6M20 20v-6h-6" />
                <path d="M20 9a8 8 0 0 0-15-3M4 15a8 8 0 0 0 15 3" />
              </svg>
            </button>
          </div>
        </header>

        <div className="drive-body">
        <aside className="drive-side">
          <button
            type="button"
            className="new-btn"
            onClick={(e) => {
              e.stopPropagation();
              setNewMenuOpen((v) => !v);
            }}
          >
            <svg className="drive-icon" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>New</span>
          </button>

          <nav className="nav">
            {NAV_ITEMS.map((item) => {
              const rail = railForNavKey(item.key);
              const expectedDriveView = NAV_DRIVE_VIEW[item.key];
              const active =
                item.key === 'projects'
                  ? isProjectsRoute || (rail ? ws.filters.rail === rail : false)
                  : rail
                    ? ws.filters.rail === rail &&
                      (rail !== 'drive' || !expectedDriveView || ws.driveView === expectedDriveView)
                    : false;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`nav-item${active ? ' active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.key === 'computers') {
                      if (!ws.localFolderName) void ws.connectLocalFolder();
                      else ws.setNavKey(item.key);
                      closeMobileSideNav();
                      return;
                    }
                    if (item.key === 'projects') {
                      navigate('/dashboard/projects');
                      closeMobileSideNav();
                      return;
                    }
                    if (item.key === 'tickets') {
                      ws.setNavKey('tickets');
                      if (location.pathname !== '/dashboard/artifacts/tickets') {
                        navigate('/dashboard/artifacts/tickets');
                      }
                      closeMobileSideNav();
                      return;
                    }
                    if (rail) {
                      ws.setNavKey(item.key);
                      if (location.pathname.startsWith('/dashboard/artifacts/tickets')) {
                        navigate('/dashboard/artifacts');
                      }
                      closeMobileSideNav();
                    } else showToast(`${item.label} — coming soon`);
                  }}
                >
                  <NavIcon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              );
            })}

            <div className="storage">
              <NavIcon name="storage" />
              <div className="meter">
                <div className="bar" />
              </div>
              <small>
                {ws.filters.rail === 'artifacts'
                  ? 'ARTIFACTS · user/au_*'
                  : ws.storageLabel ?? (ws.r2Bucket ? `${ws.r2Bucket} · R2` : 'Storage')}
              </small>
            </div>
          </nav>
        </aside>

        <main
          className={`drive-main${isProjectsView || isTicketsView ? ' drive-main--projects' : ''}`}
        >
          {isProjectsView ? (
            <LibraryProjectsSurface
              onToast={showToast}
              initialProjectId={projectIdParam}
              onProjectChange={handleProjectChange}
            />
          ) : isTicketsView ? (
            <LibraryTicketsSurface onToast={showToast} />
          ) : (
            <>
          <div className="main-head">
            <div className="title">
              {ws.canNavigateUp ? (
                <button type="button" className="icon-btn title-back" onClick={ws.navigateUp} aria-label="Back">
                  ←
                </button>
              ) : null}
              {ws.pageTitle}{' '}
              <svg className="drive-icon title-chevron" viewBox="0 0 24 24">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
            <div className="view-tools">
              {ws.driveView === 'trash' && ws.driveConnected ? (
                <button
                  type="button"
                  className="lib-connect-action danger shared-drive-toolbar-btn"
                  onClick={() => {
                    if (!window.confirm('Empty Drive trash permanently?')) return;
                    void emptyDriveTrash().then((out) => {
                      showToast(out.ok ? 'Trash emptied' : out.error || 'Empty trash failed');
                      if (out.ok) void ws.refresh();
                    });
                  }}
                >
                  Empty trash
                </button>
              ) : null}
              {showSharedDriveTools && ws.driveConnected ? (
                <>
                  {ws.driveView === 'shared-drives' ? (
                    <button
                      type="button"
                      className="lib-connect-action primary shared-drive-toolbar-btn"
                      onClick={() => {
                        if (!canManageSharedDrives) {
                          ws.connectDriveForManage();
                          showToast('Reconnect Drive with manage access to create shared drives');
                          return;
                        }
                        setCreateDriveOpen(true);
                      }}
                    >
                      New shared drive
                    </button>
                  ) : null}
                  {ws.driveView === 'shared-drive' && activeSharedDriveId ? (
                    <button
                      type="button"
                      className="lib-connect-action shared-drive-toolbar-btn"
                      onClick={() => setManageDriveOpen(true)}
                    >
                      Manage
                    </button>
                  ) : null}
                </>
              ) : null}
              <div className="segmented">
                <button
                  type="button"
                  className={viewMode === 'list' ? 'active' : ''}
                  title="List"
                  onClick={() => setViewMode('list')}
                >
                  <svg className="drive-icon" viewBox="0 0 24 24">
                    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={viewMode === 'grid' ? 'active' : ''}
                  title="Grid"
                  onClick={() => setViewMode('grid')}
                >
                  <svg className="drive-icon" viewBox="0 0 24 24">
                    <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
                  </svg>
                </button>
              </div>
              <button type="button" className="icon-btn" title="Details" onClick={() => setDrawerOpen((v) => !v)}>
                <svg className="drive-icon" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 10v6M12 7h.01" />
                </svg>
              </button>
            </div>
          </div>

          <div className="filters">
            <button type="button" className="filter disabled">
              <svg className="drive-icon" viewBox="0 0 24 24">
                <path d="M4 7h7l2 2h7v9H4z" />
              </svg>{' '}
              {ws.items.length} items
            </button>
            <span className="filter-divider">|</span>
            <button
              type="button"
              className="filter"
              onClick={(e) => {
                e.stopPropagation();
                setSourceFilterOpen((v) => !v);
              }}
            >
              Source: {ws.filters.source === 'all' ? 'All' : sourceLabel(ws.filters.source)}{' '}
              <svg className="drive-icon" viewBox="0 0 24 24">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {sourceFilterOpen ? (
              <div className="new-menu open" style={{ left: 'auto', top: 'auto', position: 'absolute', zIndex: 35 }}>
                {(['all', 'artifacts', 'drive', 'r2', 'local'] as SourceFilter[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      ws.setSourceFilter(s);
                      setSourceFilterOpen(false);
                    }}
                  >
                    {s === 'all' ? 'All sources' : sourceLabel(s)}
                  </button>
                ))}
              </div>
            ) : null}
            <button type="button" className="filter" onClick={() => ws.setTypeFilter('all')}>
              Type: {ws.filters.type === 'all' ? 'All' : ws.filters.type}
            </button>
          </div>

          {ws.sessionId ? (
            <div className="lib-session-banner">
              <span>
                Chat session filter · <code>{ws.sessionId.slice(0, 12)}…</code>
              </span>
              <button type="button" className="close-x" onClick={clearSessionFilter} aria-label="Clear session filter">
                ×
              </button>
            </div>
          ) : null}

          {driveNeedsConnect && noticeVisible ? (
            <section className="notice">
              <div className="notice-icon">G</div>
              <div>
                <strong>Connect Google Drive</strong>
                <p>Authorize Drive to browse folders and files inside Work.</p>
              </div>
              <span className="spacer" />
              <button type="button" className="upgrade" onClick={ws.connectDrive}>
                Connect
              </button>
              <button type="button" className="close-x" onClick={() => setNoticeVisible(false)} aria-label="Dismiss">
                ×
              </button>
            </section>
          ) : null}

          {primaryError && !driveNeedsConnect ? (
            <div className="lib-error">
              {primaryError}
              {ws.filters.rail === 'local' ? (
                <button type="button" onClick={() => void ws.connectLocalFolder()}>
                  {ws.localNeedsReconnect ? 'Reconnect folder' : 'Choose local folder'}
                </button>
              ) : null}
            </div>
          ) : null}

          <section className={`drive-content${viewMode === 'list' ? ' list-view' : ''}`}>
            {ws.loading ? (
              <div className="lib-loading">Loading…</div>
            ) : isHomeLanes ? (
              <LibraryHomeLanes
                folders={ws.folders}
                files={ws.files}
                selectedId={selected?.id ?? null}
                onItemClick={handleItemClick}
                onContextMenu={handleContextMenu}
                onOpenSource={openSourceLane}
                driveConnected={ws.driveConnected}
                localFolderName={ws.localFolderName}
                onConnectDrive={ws.connectDrive}
                onConnectLocal={ws.connectLocalFolder}
              />
            ) : ws.folders.length === 0 && ws.files.length === 0 ? (
              <div className="lib-empty">
                No files found
                {ws.filters.rail === 'drive' && ws.driveConnected === false ? (
                  <>
                    {' '}
                    —{' '}
                    <button type="button" className="upgrade" style={{ display: 'inline', padding: '4px 12px' }} onClick={ws.connectDrive}>
                      Connect Drive
                    </button>
                  </>
                ) : null}
              </div>
            ) : viewMode === 'list' ? (
              <LibraryListView
                folders={ws.folders}
                files={ws.files}
                selectedId={selected?.id ?? null}
                onItemClick={handleItemClick}
                onContextMenu={handleContextMenu}
              />
            ) : (
              <>
                <div className="list-head">
                  <span>Name</span>
                  <span className="sort-dot">↓</span>
                </div>

                {ws.folders.length > 0 ? (
                  <div className="folder-grid">
                    {ws.folders.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`folder-card${selected?.id === item.id ? ' selected' : ''}`}
                        onClick={() => handleItemClick(item)}
                        onContextMenu={(e) => handleContextMenu(e, item)}
                      >
                        <LibraryFileIcon item={item} />
                        <span className="file-name">{item.name}</span>
                        <span className="lib-source-tag">{sourceLabel(item.source)}</span>
                        <KebabButton />
                      </button>
                    ))}
                  </div>
                ) : null}

                {ws.files.length > 0 ? (
                  <div className="file-grid">
                    {ws.files.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`file-card${selected?.id === item.id ? ' selected' : ''}`}
                        onClick={() => handleItemClick(item)}
                        onContextMenu={(e) => handleContextMenu(e, item)}
                      >
                        <div className="card-head">
                          <LibraryFileIcon item={item} />
                          <span className="file-name">{item.name}</span>
                          <KebabButton />
                        </div>
                        <LibraryThumb item={item} />
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </section>
            </>
          )}
        </main>

        <LibrarySideRail onPanelChange={setRailPanelOpen} />
        </div>
      </div>

      <aside className={`drawer${drawerOpen ? ' open' : ''}`}>
        <div className="drawer-head">
          <strong>{selected?.name ?? 'Details'}</strong>
          <button type="button" className="icon-btn" onClick={() => setDrawerOpen(false)} aria-label="Close">
            <svg className="drive-icon" viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="drawer-body">
          {selected ? (
            <>
              <div className="preview-box">{selected.kind === 'file' ? <LibraryThumb item={selected} /> : <LibraryFileIcon item={selected} />}</div>
              <div className="meta">
                <div className="meta-row">
                  <span>Source</span>
                  <strong>{sourceLabel(selected.source)}</strong>
                </div>
                <div className="meta-row">
                  <span>Type</span>
                  <strong>{selected.kind === 'folder' ? 'Folder' : selected.displayKind.toUpperCase()}</strong>
                </div>
                <div className="meta-row">
                  <span>Owner</span>
                  <strong>{selected.ownerName ?? '—'}</strong>
                </div>
                <div className="meta-row">
                  <span>Modified</span>
                  <strong>{selected.modifiedLabel ?? '—'}</strong>
                </div>
                {selected.rawUrl ? (
                  <div className="meta-row">
                    <span>URL</span>
                    <strong style={{ fontSize: 11, wordBreak: 'break-all' }}>{selected.rawUrl}</strong>
                  </div>
                ) : null}
              </div>
              <LibraryFileDriveActions
                item={selected}
                driveConnected={!!ws.driveConnected}
                onToast={showToast}
              />
              <button type="button" className="upgrade" style={{ marginTop: 12, width: '100%' }} onClick={() => openSelected(selected)}>
                Open
              </button>
            </>
          ) : null}
        </div>
      </aside>

      {manageDriveOpen && activeSharedDriveId ? (
        <SharedDriveManagePanel
          driveId={activeSharedDriveId}
          driveName={activeSharedDriveName}
          driveStatus={ws.driveStatus}
          onClose={() => setManageDriveOpen(false)}
          onUpdated={() => void ws.refresh()}
          onDeleted={() => {
            setManageDriveOpen(false);
            ws.setNavKey('shared');
            void ws.refresh();
          }}
          onToast={showToast}
        />
      ) : null}

      {createDriveOpen ? (
        <div className="shared-drive-modal-backdrop" onClick={() => setCreateDriveOpen(false)}>
          <div className="shared-drive-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create shared drive</h3>
            <p className="shared-drive-hint">Uses Google Drive API v3 with an idempotent request ID.</p>
            <label className="shared-drive-label" htmlFor="new-sd-name">
              Drive name
            </label>
            <input
              id="new-sd-name"
              className="shared-drive-input"
              value={newDriveName}
              onChange={(e) => setNewDriveName(e.target.value)}
              placeholder="Project Resources"
              disabled={createDriveBusy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateSharedDrive();
              }}
            />
            <div className="shared-drive-modal-actions">
              <button type="button" className="lib-connect-action muted" onClick={() => setCreateDriveOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="lib-connect-action primary"
                disabled={createDriveBusy || !newDriveName.trim()}
                onClick={() => void handleCreateSharedDrive()}
              >
                {createDriveBusy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className={`new-menu${newMenuOpen ? ' open' : ''}`} onClick={(e) => e.stopPropagation()}>
        {NEW_MENU_ITEMS.map((label) => (
          <button
            key={label}
            type="button"
            className="menu-item"
            onClick={() => {
              setNewMenuOpen(false);
              if (label === 'File upload') {
                uploadInputRef.current?.click();
                return;
              }
              if (label === 'New folder') {
                void (async () => {
                  const name = window.prompt('Folder name');
                  if (!name?.trim()) return;
                  const out = await createDriveFolder(name.trim(), currentDriveParentId());
                  showToast(out.ok ? 'Folder created' : out.error || 'Create folder failed');
                  if (out.ok) await ws.refresh();
                })();
                return;
              }
              showToast(`${label} — coming soon`);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {contextMenu ? (
        <div
          className="context-menu open"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {CONTEXT_ACTIONS.concat(ws.driveView === 'trash' ? (['Restore', 'Delete forever'] as const) : [])
            .filter((action, idx, arr) => arr.indexOf(action) === idx)
            .filter((action) => !(ws.driveView === 'trash' && action === 'Move to trash'))
            .map((action) => (
            <button
              key={action}
              type="button"
              className="menu-item"
              onClick={() => {
                const item = contextMenu.item;
                setContextMenu(null);
                if (action === 'Open') openSelected(item);
                else if (action === 'Download' && item.rawUrl) window.open(item.rawUrl, '_blank');
                else if (action === 'Share' && item.source === 'drive' && item.kind === 'file') {
                  void openDriveShareDialog(item.nativeId).catch((e) =>
                    showToast(e instanceof Error ? e.message : 'Share failed'),
                  );
                } else if (
                  item.source === 'drive' &&
                  ['Rename', 'Move to trash', 'Restore', 'Delete forever'].includes(action)
                ) {
                  void handleDriveContextAction(action, item);
                } else showToast(action);
              }}
            >
              {action}
            </button>
          ))}
        </div>
      ) : null}

      <div className={`toast${toast ? ' show' : ''}`}>{toast ?? 'Selected'}</div>
    </div>
  );
}

export default ArtifactsDriveShell;
