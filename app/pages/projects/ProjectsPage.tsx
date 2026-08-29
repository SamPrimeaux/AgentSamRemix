import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Camera,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  deleteProject,
  fetchProjectsList,
  setProjectPinned,
  updateProject,
  type OverviewProject,
} from '../../client-api/projects';
import { ProjectShareModal } from '../../components/projects/ProjectShareModal';

// ─── types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  description?: string;
  status?: string;
  status_raw?: string;
  priority?: string;
  priority_num?: number;
  project_type?: string;
  health?: number;
  progress?: number;
  progress_source?: string | null;
  github_repo?: string | null;
  code_index?: OverviewProject['code_index'];
  activeTasks?: number;
  totalTasks?: number;
  chat_project_id?: string | null;
  cover_image_url?: string | null;
  dueDate?: string;
  workspace_id?: string | null;
  is_pinned?: boolean;
}

function fromOverviewRow(p: OverviewProject): Project {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status_raw || p.status,
    status_raw: p.status_raw,
    priority: p.priority,
    priority_num: p.priority_num,
    project_type: p.project_type,
    health: p.health,
    progress: p.progress,
    progress_source: p.progress_source ?? null,
    github_repo: p.github_repo ?? null,
    code_index: p.code_index ?? null,
    activeTasks: p.activeTasks,
    totalTasks: p.totalTasks,
    chat_project_id: p.chat_project_id,
    cover_image_url: p.cover_image_url,
    dueDate: p.dueDate,
    workspace_id: p.workspace_id,
    is_pinned: p.is_pinned === true,
  };
}

// ─── constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  production: '#4ade80',
  active:     '#4ade80',
  development:'#22d3ee',
  design:     '#22d3ee',
  staging:    '#fbbf24',
  review:     '#fbbf24',
  discovery:  '#94a3b8',
  planning:   '#94a3b8',
  blocked:    '#f87171',
  archived:   '#475569',
  complete:   '#475569',
};

const STATUS_LABELS: Record<string, string> = {
  production: 'Production',
  active:     'Active',
  development:'In Development',
  design:     'Design',
  staging:    'Staging',
  review:     'Review',
  discovery:  'Discovery',
  planning:   'Planning',
  blocked:    'Blocked',
  archived:   'Archived',
  complete:   'Complete',
};

type TabFilter = 'mine' | 'recent' | 'shared' | 'archived' | 'starred';

const TABS: { key: TabFilter; label: string }[] = [
  { key: 'mine',     label: 'My Projects' },
  { key: 'recent',   label: 'Recent' },
  { key: 'shared',   label: 'Shared' },
  { key: 'archived', label: 'Archived' },
  { key: 'starred',  label: 'Starred' },
];

// ─── helpers ─────────────────────────────────────────────────────────────────

function avatarInitials(name: string): string {
  const parts = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(id: string): string {
  const colors = ['#6366f1','#8b5cf6','#ec4899','#22d3ee','#10b981','#f59e0b','#ef4444'];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i);
  return colors[Math.abs(hash) % colors.length];
}

// ─── skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="pj-card pj-card--skeleton" aria-hidden="true">
      <div className="pj-card-cover pj-card-cover--skel" />
      <div className="pj-card-body">
        <div className="pj-card-head">
          <div className="skel skel-title" />
        </div>
        <div className="skel skel-sub" />
        <div className="pj-card-progress-wrap">
          <div className="skel skel-bar" />
        </div>
        <div className="pj-card-foot">
          <div className="skel skel-avatar" />
        </div>
      </div>
    </div>
  );
}

// ─── card menu ───────────────────────────────────────────────────────────────

function CardMenu({
  project,
  isOpen,
  onToggle,
  onClose,
  onStar,
  onRename,
  onShare,
  onDelete,
  placement = 'cover',
}: {
  project: Project;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onStar: () => void;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
  placement?: 'cover' | 'head';
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setDropPos(null);
      return;
    }
    const update = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setDropPos({
        top: r.bottom + 4,
        right: Math.max(8, window.innerWidth - r.right),
      });
    };
    update();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || dropRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [isOpen, onClose]);

  const menu = isOpen && dropPos
    ? createPortal(
        <div
          ref={dropRef}
          className="pj-menu-drop pj-menu-drop--portal"
          role="menu"
          style={{ top: dropPos.top, right: dropPos.right }}
        >
          <button type="button" role="menuitem" className="pj-menu-item" onClick={(e) => { e.stopPropagation(); onStar(); }}>
            <Star size={13} fill={project.is_pinned ? 'currentColor' : 'none'} />
            {project.is_pinned ? 'Unstar' : 'Star'}
          </button>
          <button type="button" role="menuitem" className="pj-menu-item" onClick={(e) => { e.stopPropagation(); onRename(); }}>
            <Pencil size={13} /> Rename
          </button>
          <button type="button" role="menuitem" className="pj-menu-item" onClick={(e) => { e.stopPropagation(); onShare(); }}>
            <Share2 size={13} /> Share / Invite
          </button>
          <div className="pj-menu-divider" />
          <button type="button" role="menuitem" className="pj-menu-item pj-menu-item--danger" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <Trash2 size={13} /> Delete
          </button>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={`pj-menu pj-menu--${placement}`} ref={wrapRef}>
      <button
        type="button"
        className="pj-menu-btn"
        ref={btnRef}
        aria-label={`Options for ${project.name}`}
        aria-expanded={isOpen}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
      >
        <MoreHorizontal size={15} />
      </button>
      {menu}
    </div>
  );
}

// ─── project card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  menuOpen,
  onOpen,
  onMenuToggle,
  onMenuClose,
  onStar,
  onRename,
  onShare,
  onDelete,
}: {
  project: Project;
  menuOpen: boolean;
  onOpen: () => void;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onStar: () => void;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const statusColor = STATUS_COLORS[project.status ?? ''] ?? '#94a3b8';
  const indexing = Boolean(project.code_index?.run_id) || project.progress_source === 'code_index';
  const pct = Math.min(100, Math.max(0, project.progress ?? 0));
  const initials = avatarInitials(project.workspace_id?.replace(/^ws_/, '') || project.name);
  const avatarBg = avatarColor(project.id);

  return (
    <div className={`pj-card${project.status === 'archived' ? ' pj-card--archived' : ''}${project.is_pinned ? ' pj-card--pinned' : ''}${indexing ? ' pj-card--indexing' : ''}`}>
      {/* cover image */}
      <div
        className="pj-card-cover"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }}}
        aria-label={`Open ${project.name}`}
      >
        {project.cover_image_url ? (
          <img src={project.cover_image_url} alt="" className="pj-card-cover-img" draggable={false} />
        ) : (
          <div className="pj-card-cover-placeholder">
            <Camera size={18} className="pj-card-cover-icon" aria-hidden />
          </div>
        )}
        {/* status strip */}
        <div className="pj-card-status-strip" style={{ background: statusColor }} />
        {/* three-dot menu — frosted overlay on cover (desktop / stacked layout) */}
        <CardMenu
          project={project}
          isOpen={menuOpen}
          onToggle={onMenuToggle}
          onClose={onMenuClose}
          onStar={onStar}
          onRename={onRename}
          onShare={onShare}
          onDelete={onDelete}
          placement="cover"
        />
        {project.is_pinned && (
          <span className="pj-card-star-badge" aria-label="Starred">
            <Star size={11} fill="currentColor" />
          </span>
        )}
      </div>

      {/* card body */}
      <div
        className="pj-card-body"
        role="button"
        tabIndex={-1}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      >
        <div className="pj-card-head">
          <div className="pj-card-name">{project.name}</div>
          <CardMenu
            project={project}
            isOpen={menuOpen}
            onToggle={onMenuToggle}
            onClose={onMenuClose}
            onStar={onStar}
            onRename={onRename}
            onShare={onShare}
            onDelete={onDelete}
            placement="head"
          />
        </div>
        <div className="pj-card-type">{project.project_type || 'project'}</div>

        <div className="pj-card-progress-wrap">
          <div className="pj-card-progress-track">
            <div
              className={`pj-card-progress-fill${indexing ? ' pj-card-progress-fill--index' : ''}`}
              style={{ width: pct > 0 ? `${pct}%` : '0%' }}
              title={
                indexing
                  ? [
                      project.code_index?.label || `Code index ${pct}%`,
                      project.code_index?.stage || null,
                      project.code_index?.github_repo || null,
                      project.code_index?.skipped_unchanged
                        ? `${project.code_index.skipped_unchanged} unchanged skipped`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : undefined
              }
            />
          </div>
          <span className={`pj-card-progress-pct${indexing ? ' pj-card-progress-pct--index' : ''}`}>
            {indexing
              ? project.code_index?.label || `idx ${pct}%`
              : `${pct}%`}
          </span>
        </div>

        <div className="pj-card-foot">
          <div className="pj-avatar-cluster">
            <div
              className="pj-avatar"
              style={{ background: avatarBg }}
              title={project.workspace_id?.replace(/^ws_/, '') || project.name}
            >
              {initials}
            </div>
            <span className="pj-avatar-more">+2 more</span>
          </div>
          <span className="pj-card-status-label" style={{ color: statusColor }}>
            {STATUS_LABELS[project.status ?? ''] ?? project.status_raw ?? ''}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabFilter>('mine');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newBusy, setNewBusy] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [shareTarget, setShareTarget] = useState<Project | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    const soft = opts?.soft === true;
    if (!soft) setLoading(true);
    try {
      const res = await fetchProjectsList({
        scope: 'tenant',
        includeArchived: true,
      });
      if (!res.ok) {
        if (!soft) setProjects([]);
        return;
      }
      setProjects(res.projects.map(fromOverviewRow));
    } catch {
      if (!soft) setProjects([]);
    } finally {
      if (!soft) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Soft poll while any card is indexing — 8s, not the tight per-project cadence.
  useEffect(() => {
    const anyIndexing = projects.some(
      (p) => p.code_index?.run_id || p.progress_source === 'code_index',
    );
    if (!anyIndexing) return undefined;
    const id = window.setInterval(() => void load({ soft: true }), 8000);
    return () => window.clearInterval(id);
  }, [projects, load]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = [...projects];

    if (activeTab === 'starred')  list = list.filter((p) => p.is_pinned);
    if (activeTab === 'archived') list = list.filter((p) => p.status === 'archived' || p.status_raw === 'archived');
    if (activeTab === 'mine')     list = list.filter((p) => p.status !== 'archived' && p.status_raw !== 'archived');

    if (q) {
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        (p.project_type ?? '').toLowerCase().includes(q) ||
        (p.workspace_id ?? '').toLowerCase().includes(q),
      );
    }

    list.sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return (b.priority_num ?? 0) - (a.priority_num ?? 0);
    });

    return list;
  }, [projects, query, activeTab]);

  const createProject = async () => {
    const name = newName.trim();
    if (!name || newBusy) return;
    setNewBusy(true);
    try {
      const r = await fetch('/api/projects', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: newDesc.trim() || null }),
      });
      if (r.ok) { setCreating(false); setNewName(''); setNewDesc(''); await load(); }
    } finally { setNewBusy(false); }
  };

  const handleStar = async (p: Project) => {
    setMenuOpenId(null);
    const next = !p.is_pinned;
    setProjects((prev) => prev.map((row) => (row.id === p.id ? { ...row, is_pinned: next } : row)));
    const res = await setProjectPinned(p.id, next);
    if (!res.ok) { setToast(res.error || 'Failed to update star'); await load(); }
  };

  const openRename = (p: Project) => { setMenuOpenId(null); setRenameTarget(p); setRenameValue(p.name); };

  const submitRename = async () => {
    if (!renameTarget || renameBusy) return;
    const name = renameValue.trim();
    if (!name) return;
    setRenameBusy(true);
    try {
      const res = await updateProject(renameTarget.id, { name });
      if (res.ok) { setRenameTarget(null); setRenameValue(''); await load(); setToast('Project renamed'); }
      else setToast(res.error || 'Rename failed');
    } finally { setRenameBusy(false); }
  };

  const openShare  = (p: Project) => { setMenuOpenId(null); setShareTarget(p); };
  const openDelete = (p: Project) => { setMenuOpenId(null); setDeleteTarget(p); };

  const submitDelete = async () => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const res = await deleteProject(deleteTarget.id);
      if (res.ok) { setDeleteTarget(null); await load(); setToast('Project deleted'); }
      else setToast(res.error || 'Delete failed');
    } finally { setDeleteBusy(false); }
  };

  return (
    <div className="pj-root">
      <style>{PROJECTS_CSS}</style>

      <header className="pj-header">
        <div className="pj-header-top">
          <h1 className="pj-title">Projects</h1>
          <div className="pj-header-actions">
            <button
              type="button"
              className="pj-search-btn"
              aria-label="Search projects"
              onClick={() => {
                const wrap = searchRef.current?.parentElement;
                if (wrap) wrap.classList.add('pj-search-wrap--visible');
                searchRef.current?.focus();
              }}
            >
              <Search size={16} />
            </button>
            <button type="button" className="pj-new-btn" onClick={() => setCreating(true)}>
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="pj-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeTab === t.key}
              className={`pj-tab${activeTab === t.key ? ' pj-tab--active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={`pj-search-wrap${query ? ' pj-search-wrap--visible' : ''}`}>
          <Search size={14} className="pj-search-icon" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects..."
            className="pj-search-input"
            onFocus={(e) => e.currentTarget.parentElement?.classList.add('pj-search-wrap--visible')}
            onBlur={(e) => {
              if (!query) e.currentTarget.parentElement?.classList.remove('pj-search-wrap--visible');
            }}
          />
          {query && (
            <button type="button" className="pj-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={13} />
            </button>
          )}
        </div>
      </header>

      {creating && (
        <div className="pj-create-bar">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Project name"
            className="pj-create-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createProject();
              if (e.key === 'Escape') { setCreating(false); setNewName(''); setNewDesc(''); }
            }}
          />
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="pj-create-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createProject();
              if (e.key === 'Escape') { setCreating(false); setNewName(''); setNewDesc(''); }
            }}
          />
          <div className="pj-create-actions">
            <button
              type="button"
              className="pj-btn pj-btn--primary"
              disabled={!newName.trim() || newBusy}
              onClick={() => void createProject()}
            >
              {newBusy ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              className="pj-btn"
              onClick={() => { setCreating(false); setNewName(''); setNewDesc(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="pj-body">
        {loading ? (
          <div className="pj-grid">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : !filtered.length ? (
          <div className="pj-empty">
            <FolderOpen size={32} className="pj-empty-icon" />
            <p className="pj-empty-text">
              {query
                ? 'No projects match your search.'
                : activeTab === 'starred'
                  ? 'Star a project to see it here.'
                  : activeTab === 'archived'
                    ? 'No archived projects.'
                    : 'No projects yet.'}
            </p>
            {!query && activeTab === 'mine' && (
              <button type="button" className="pj-btn pj-btn--primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> New project
              </button>
            )}
          </div>
        ) : (
          <div className="pj-grid">
            {filtered.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                menuOpen={menuOpenId === p.id}
                onOpen={() => navigate(`/dashboard/projects/${encodeURIComponent(p.id)}`)}
                onMenuToggle={() => setMenuOpenId((cur) => (cur === p.id ? null : p.id))}
                onMenuClose={() => setMenuOpenId(null)}
                onStar={() => void handleStar(p)}
                onRename={() => openRename(p)}
                onShare={() => openShare(p)}
                onDelete={() => openDelete(p)}
              />
            ))}
          </div>
        )}
      </div>

      {renameTarget && (
        <div className="pj-modal-backdrop" role="presentation" onClick={() => !renameBusy && setRenameTarget(null)}>
          <div className="pj-modal" role="dialog" aria-labelledby="pj-rename-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="pj-rename-title" className="pj-modal-title">Rename project</h2>
            <input
              autoFocus
              type="text"
              className="pj-create-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submitRename(); if (e.key === 'Escape') setRenameTarget(null); }}
            />
            <div className="pj-create-actions">
              <button type="button" className="pj-btn pj-btn--primary" disabled={!renameValue.trim() || renameBusy} onClick={() => void submitRename()}>
                {renameBusy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="pj-btn" disabled={renameBusy} onClick={() => setRenameTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="pj-modal-backdrop" role="presentation" onClick={() => !deleteBusy && setDeleteTarget(null)}>
          <div className="pj-modal" role="dialog" aria-labelledby="pj-delete-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="pj-delete-title" className="pj-modal-title">Delete "{deleteTarget.name}"?</h2>
            <p className="pj-modal-hint">This permanently removes the project and all associated data. This cannot be undone.</p>
            <div className="pj-create-actions">
              <button type="button" className="pj-btn pj-btn--danger" disabled={deleteBusy} onClick={() => void submitDelete()}>
                {deleteBusy ? 'Deleting…' : 'Delete project'}
              </button>
              <button type="button" className="pj-btn" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <ProjectShareModal
        project={shareTarget ? { id: shareTarget.id, name: shareTarget.name } : null}
        onClose={() => setShareTarget(null)}
        onToast={setToast}
      />

      {toast && <div className="pj-toast" role="status">{toast}</div>}
    </div>
  );
}

// ─── scoped CSS ───────────────────────────────────────────────────────────────

const PROJECTS_CSS = `
.pj-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  background: var(--dashboard-canvas);
  color: var(--color-main, #e2e8f0);
  overflow-y: auto;
}

.pj-header {
  flex-shrink: 0;
  padding: 28px 16px 0;
  max-width: 980px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

.pj-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.pj-title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0;
  line-height: 1;
}

.pj-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pj-search-btn,
.pj-new-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--dashboard-border);
  background: transparent;
  color: var(--color-main, #e2e8f0);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}

.pj-search-btn:hover,
.pj-new-btn:hover {
  background: var(--bg-hover, rgba(255,255,255,0.08));
  border-color: rgba(255,255,255,0.18);
}

.pj-new-btn {
  background: var(--color-main, #e2e8f0);
  color: var(--dashboard-canvas, #0d1117);
  border-color: transparent;
}

.pj-new-btn:hover {
  background: #fff;
  color: #0d1117;
}

.pj-tabs {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  margin-bottom: 16px;
  padding-bottom: 2px;
}

.pj-tabs::-webkit-scrollbar { display: none; }

.pj-tab {
  flex-shrink: 0;
  padding: 7px 14px;
  border-radius: 20px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-muted, #94a3b8);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}

.pj-tab:hover {
  background: var(--bg-hover, rgba(255,255,255,0.06));
  color: var(--color-main, #e2e8f0);
}

.pj-tab--active {
  background: var(--bg-elevated, rgba(255,255,255,0.1));
  border-color: rgba(255,255,255,0.14);
  color: var(--color-main, #e2e8f0);
  font-weight: 600;
}

.pj-search-wrap {
  position: relative;
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  transition: max-height 0.2s ease, opacity 0.15s ease, margin 0.2s ease;
  margin-bottom: 0;
}

.pj-search-wrap--visible {
  max-height: 48px;
  opacity: 1;
  margin-bottom: 12px;
}

.pj-search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-muted, #94a3b8);
  pointer-events: none;
}

.pj-search-input {
  width: 100%;
  padding: 9px 36px 9px 34px;
  border-radius: 10px;
  border: 1px solid var(--dashboard-border);
  background: var(--dashboard-panel, rgba(255,255,255,0.04));
  color: inherit;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}

.pj-search-input:focus { border-color: rgba(255,255,255,0.25); }
.pj-search-input::placeholder { color: var(--color-muted, #94a3b8); }

.pj-search-clear {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  background: var(--bg-hover, rgba(255,255,255,0.1));
  color: var(--color-muted, #94a3b8);
  cursor: pointer;
}

.pj-create-bar {
  max-width: 980px;
  margin: 0 auto 16px;
  padding: 0 16px;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pj-create-input {
  padding: 9px 12px;
  border-radius: 9px;
  border: 1px solid var(--dashboard-border);
  background: var(--dashboard-panel, rgba(255,255,255,0.04));
  color: inherit;
  font-size: 14px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
  transition: border-color 0.15s;
}

.pj-create-input:focus { border-color: rgba(255,255,255,0.3); }
.pj-create-input::placeholder { color: var(--color-muted, #94a3b8); }
.pj-create-actions { display: flex; gap: 8px; }

.pj-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--dashboard-border);
  background: transparent;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
  white-space: nowrap;
}

.pj-btn:hover:not(:disabled) { background: var(--bg-hover); }
.pj-btn:disabled { opacity: 0.4; cursor: default; }

.pj-btn--primary {
  background: var(--color-main, #e2e8f0);
  color: var(--dashboard-canvas, #0d1117);
  border-color: transparent;
  font-weight: 600;
}

.pj-btn--primary:hover:not(:disabled) { background: #fff; }

.pj-btn--danger {
  border-color: rgba(248,113,113,0.4);
  color: #f87171;
}

.pj-btn--danger:hover:not(:disabled) { background: rgba(248,113,113,0.12); }

.pj-body {
  flex: 1;
  padding: 0 16px 40px;
  max-width: 980px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

.pj-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.pj-card {
  border-radius: 14px;
  border: 1px solid var(--dashboard-border);
  background: var(--dashboard-panel, rgba(255,255,255,0.03));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.pj-card:hover {
  border-color: rgba(255,255,255,0.14);
  box-shadow: 0 4px 20px rgba(0,0,0,0.25);
}

.pj-card--archived { opacity: 0.65; }
.pj-card--pinned { border-color: rgba(251,191,36,0.28); }

.pj-card-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 16/9;
  background: var(--bg-elevated, rgba(255,255,255,0.04));
  cursor: pointer;
  overflow: hidden;
  flex-shrink: 0;
}

.pj-card-cover:focus-visible {
  outline: 2px solid rgba(255,255,255,0.4);
  outline-offset: -2px;
}

.pj-card-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.3s ease;
}

.pj-card:hover .pj-card-cover-img { transform: scale(1.02); }

.pj-card-cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pj-card-cover-icon {
  color: var(--color-muted, #94a3b8);
  opacity: 0.3;
}

.pj-card-status-strip {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  opacity: 0.8;
}

.pj-card-star-badge {
  position: absolute;
  bottom: 8px;
  left: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(0,0,0,0.5);
  color: #fbbf24;
  backdrop-filter: blur(4px);
}

.pj-card-body {
  padding: 12px 14px 13px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  cursor: pointer;
  flex: 1;
  min-width: 0;
}

.pj-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}

.pj-card-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pj-card-type {
  font-size: 11px;
  color: var(--color-muted, #94a3b8);
  letter-spacing: 0.01em;
  margin-bottom: 4px;
}

.pj-card-progress-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pj-card-progress-track {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: rgba(255,255,255,0.08);
  overflow: hidden;
}

.pj-card-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: rgba(255,255,255,0.35);
  transition: width 0.4s ease;
}
.pj-card-progress-fill--index {
  background: linear-gradient(90deg, rgba(34, 211, 238, 0.35), rgba(34, 211, 238, 0.95));
  box-shadow: 0 0 8px rgba(34, 211, 238, 0.35);
  animation: pj-index-pulse 1.6s ease-in-out infinite;
}
@keyframes pj-index-pulse {
  0%, 100% { opacity: 0.75; }
  50% { opacity: 1; }
}

.pj-card-progress-pct {
  white-space: nowrap;
  max-width: 9.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--color-muted, #94a3b8);
  flex-shrink: 0;
  min-width: 26px;
  text-align: right;
}
.pj-card-progress-pct--index {
  color: var(--solar-cyan, #22d3ee);
  min-width: 72px;
  max-width: 9.5rem;
  font-variant-numeric: tabular-nums;
}

.pj-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}

.pj-avatar-cluster {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.pj-avatar-more {
  display: none;
  font-size: 11px;
  color: var(--color-muted, #94a3b8);
  white-space: nowrap;
}

.pj-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #fff;
  border: 1.5px solid var(--dashboard-canvas, #0d1117);
  flex-shrink: 0;
  cursor: default;
  user-select: none;
}

.pj-card-status-label {
  font-size: 11px;
  font-weight: 500;
}

.pj-menu {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
}

.pj-menu--head {
  display: none;
}

.pj-menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(0,0,0,0.55);
  color: #fff;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: background 0.12s;
}

.pj-menu-btn:hover,
.pj-menu-btn[aria-expanded="true"] {
  background: rgba(0,0,0,0.75);
}

.pj-menu-drop {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 162px;
  padding: 4px;
  border-radius: 11px;
  border: 1px solid var(--dashboard-border);
  background: var(--bg-elevated, #151b27);
  box-shadow: 0 16px 40px rgba(0,0,0,0.5);
  z-index: 20;
}

.pj-menu-drop--portal {
  position: fixed;
  z-index: 10050;
}

.pj-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}

.pj-menu-item:hover { background: var(--bg-hover); }
.pj-menu-item--danger { color: #f87171; }
.pj-menu-item--danger:hover { background: rgba(248,113,113,0.12); }

.pj-menu-divider {
  height: 1px;
  background: var(--dashboard-border);
  margin: 3px 6px;
}

@media (max-width: 540px) {
  .pj-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .pj-body { padding: 0 12px 40px; }

  .pj-card {
    flex-direction: row;
    align-items: stretch;
    min-height: 108px;
  }

  .pj-card-cover {
    width: 92px;
    min-width: 92px;
    max-width: 92px;
    aspect-ratio: unset;
    height: auto;
    align-self: stretch;
    border-radius: 0;
  }

  .pj-card-cover-img,
  .pj-card-cover-placeholder {
    min-height: 100%;
    height: 100%;
  }

  .pj-card-cover--skel {
    aspect-ratio: unset;
    min-height: 108px;
  }

  .pj-card-status-strip {
    top: 0;
    bottom: 0;
    left: 0;
    right: auto;
    width: 2px;
    height: auto;
  }

  .pj-card-star-badge {
    bottom: 6px;
    left: 6px;
    width: 18px;
    height: 18px;
  }

  .pj-card-body {
    flex: 1;
    min-width: 0;
    padding: 10px 12px 10px 10px;
    justify-content: center;
    gap: 4px;
  }

  .pj-card-head .pj-card-name {
    font-size: 15px;
  }

  .pj-card-type {
    margin-bottom: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pj-card-progress-fill {
    background: #e07a5f;
  }

  .pj-card-foot {
    margin-top: 2px;
  }

  .pj-card-status-label {
    display: none;
  }

  .pj-menu--cover { display: none; }

  .pj-menu--head {
    display: block;
    position: relative;
    top: auto;
    right: auto;
    flex-shrink: 0;
  }

  .pj-menu--head .pj-menu-btn {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: none;
    background: transparent;
    backdrop-filter: none;
    color: var(--color-muted, #94a3b8);
  }

  .pj-menu--head .pj-menu-btn:hover,
  .pj-menu--head .pj-menu-btn[aria-expanded="true"] {
    background: var(--bg-hover, rgba(255,255,255,0.08));
    color: inherit;
  }

  .pj-avatar-more {
    display: inline;
  }
}

.pj-card--skeleton { pointer-events: none; }

.pj-card-cover--skel {
  aspect-ratio: 16/9;
  background: linear-gradient(90deg, var(--dashboard-border) 25%, rgba(255,255,255,0.06) 50%, var(--dashboard-border) 75%);
  background-size: 200% 100%;
  animation: pj-shimmer 1.4s ease-in-out infinite;
}

@keyframes pj-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.skel {
  border-radius: 4px;
  background: linear-gradient(90deg, var(--dashboard-border) 25%, rgba(255,255,255,0.06) 50%, var(--dashboard-border) 75%);
  background-size: 200% 100%;
  animation: pj-shimmer 1.4s ease-in-out infinite;
}

.skel-title { height: 14px; width: 55%; }
.skel-sub   { height: 11px; width: 35%; margin-bottom: 6px; }
.skel-bar   { height: 3px; width: 100%; border-radius: 2px; }
.skel-avatar { height: 24px; width: 24px; border-radius: 50%; }

.pj-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 72px 24px;
  text-align: center;
}

.pj-empty-icon { color: var(--color-muted, #94a3b8); opacity: 0.3; }
.pj-empty-text { font-size: 14px; color: var(--color-muted, #94a3b8); max-width: 240px; line-height: 1.5; }

.pj-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0,0,0,0.6);
}

.pj-modal {
  width: min(400px, 100%);
  padding: 22px;
  border-radius: 14px;
  border: 1px solid var(--dashboard-border);
  background: var(--bg-elevated, #151b27);
  box-shadow: 0 24px 56px rgba(0,0,0,0.5);
}

.pj-modal-title {
  margin: 0 0 14px;
  font-size: 16px;
  font-weight: 600;
}

.pj-modal-hint {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--color-muted, #94a3b8);
  line-height: 1.55;
}

.pj-toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1300;
  padding: 10px 18px;
  border-radius: 999px;
  border: 1px solid var(--dashboard-border);
  background: var(--bg-elevated, #151b27);
  font-size: 13px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  pointer-events: none;
  white-space: nowrap;
}

@media (min-width: 768px) {
  .pj-header { padding: 36px 24px 0; }
  .pj-body { padding: 0 24px 48px; }
  .pj-create-bar {
    padding: 0 24px;
    flex-direction: row;
    align-items: flex-start;
  }
  .pj-create-bar .pj-create-input { flex: 1; }
  .pj-create-bar .pj-create-actions { flex-shrink: 0; }
  .pj-title { font-size: 32px; }
}
`;
