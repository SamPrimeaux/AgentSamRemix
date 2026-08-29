import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera,
  FileText,
  FolderOpen,
  Github,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  X,
} from 'lucide-react';
import type { OverviewProject } from '../../../client-api/projects';
import { updateProject } from '../../../client-api/projects';
import { cfImageVariants, projectAccentHue, projectInitials } from '../../lib/projectBranding';
import { uploadProjectR2File, uploadProjectTextFile } from '../../lib/projectR2Upload';
import {
  chatAssignProjectId,
  chatProjectIdForSession,
  fetchAgentSessions,
} from '../../../client-api/agentSessions';
import {
  chatsListRelativeTime,
  conversationIdFromSession,
  sessionDisplayTitle,
  type AgentSessionRow,
} from '../../../agentSessionsCatalog';
import { patchAgentSession } from '../../../hooks/useAgentChatSessions';
import { openAgentConversation } from '../../../lib/openAgentConversation';
import WorkspaceKanban from '../kanban/WorkspaceKanban';
import { useWorkspace } from '../../context/WorkspaceContext';
import { ProjectHealthDonut } from '../projects/ProjectHealthDonut';
import { ProjectQuickCreateMenu } from './ProjectQuickCreateMenu';

type ProjectTab = 'overview' | 'tasks';

type Props = {
  project: OverviewProject;
  onBack: () => void;
  onToast?: (msg: string) => void;
  onRefresh?: () => void;
};

function IconButton({
  label,
  onClick,
  children,
  className = '',
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={`lib-proj-icon-btn ${className}`}>
      {children}
    </button>
  );
}

function AddChatsModal({
  project,
  onClose,
  onAssigned,
}: {
  project: OverviewProject;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sessions, setSessions] = useState<AgentSessionRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const rows = await fetchAgentSessions({ limit: 200, workspaceId: project.workspace_id });
      if (cancelled) return;
      setSessions(rows.filter((s) => !chatProjectIdForSession(s, project.id, project.chat_project_id)));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => sessionDisplayTitle(s).toLowerCase().includes(q));
  }, [sessions, query]);

  const assignSelected = async () => {
    if (!selected.size || busy) return;
    setBusy(true);
    try {
      const pid = chatAssignProjectId(project.id, project.chat_project_id);
      await Promise.all([...selected].map((id) => patchAgentSession(id, { project_id: pid })));
      onAssigned();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lib-proj-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lib-proj-modal" role="dialog" aria-labelledby="add-chats-title">
        <div className="lib-proj-modal-head">
          <h2 id="add-chats-title">Add chats to {project.name}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="lib-proj-modal-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search past chats…"
            autoFocus
          />
        </div>
        {loading ? (
          <p className="lib-project-muted lib-proj-modal-empty">
            <Loader2 size={16} className="animate-spin inline mr-2" />
            Loading chats…
          </p>
        ) : filtered.length === 0 ? (
          <p className="lib-project-muted lib-proj-modal-empty">No unassigned chats match.</p>
        ) : (
          <ul className="lib-proj-add-chat-list">
            {filtered.map((s) => {
              const id = conversationIdFromSession(s);
              if (!id) return null;
              const checked = selected.has(id);
              return (
                <li key={id}>
                  <label className="lib-proj-add-chat-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                    />
                    <span className="lib-proj-add-chat-title">{sessionDisplayTitle(s)}</span>
                    <span className="lib-proj-add-chat-time">{chatsListRelativeTime(s)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="lib-proj-modal-actions">
          <button type="button" className="lib-proj-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="lib-proj-btn primary"
            disabled={!selected.size || busy}
            onClick={() => void assignSelected()}
          >
            {busy ? 'Adding…' : `Add ${selected.size || ''} chat${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function DonutLegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--dashboard-muted, #94A3B8)' }}>{label}</span>
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--dashboard-text, #E2E8F0)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

export function LibraryProjectDetail({ project, onBack, onToast, onRefresh }: Props) {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const [tab, setTab] = useState<ProjectTab>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editStatus, setEditStatus] = useState(project.status_raw || project.status || 'development');
  const [editPriority, setEditPriority] = useState(String(project.priority_num ?? 50));
  const [editCover, setEditCover] = useState(project.cover_image_url || '');
  const [editSaving, setEditSaving] = useState(false);
  const [addFileOpen, setAddFileOpen] = useState(false);
  const [addChatsOpen, setAddChatsOpen] = useState(false);
  const [chats, setChats] = useState<AgentSessionRow[]>([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [instructions, setInstructions] = useState(project.description || '');
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [fileUploading, setFileUploading] = useState(false);
  const [projectFiles, setProjectFiles] = useState<{ name: string; url: string }[]>([]);
  const [textModalOpen, setTextModalOpen] = useState(false);
  const [textTitle, setTextTitle] = useState('');
  const [textContent, setTextContent] = useState('');
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [githubUrl, setGithubUrl] = useState('');
  const [driveModalOpen, setDriveModalOpen] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadChats = useCallback(async () => {
    setChatsLoading(true);
    try {
      const rows = await fetchAgentSessions({
        limit: 100,
        projectId: project.id,
        workspaceId: project.workspace_id,
      });
      setChats(rows);
    } finally {
      setChatsLoading(false);
    }
  }, [project.id, project.workspace_id]);

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  const openChat = (s: AgentSessionRow) => {
    const id = conversationIdFromSession(s);
    if (!id) return;
    openAgentConversation({ id, title: sessionDisplayTitle(s), force: true });
  };

  const saveCoverUrl = async (coverUrl: string) => {
    const meta = JSON.stringify({ cover_image_url: coverUrl });
    const tags = [...(project.tags || []).filter((t) => !String(t).startsWith('cover:')), `cover:${coverUrl}`];
    const res = await updateProject(project.id, { metadata_json: meta, tags_json: tags });
    if (!res.ok) {
      onToast?.(res.error || 'Failed to update cover');
      return false;
    }
    onToast?.('Cover updated');
    onRefresh?.();
    return true;
  };

  const handleCoverPick = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      onToast?.('Choose an image file');
      return;
    }
    setCoverUploading(true);
    try {
      const out = await uploadProjectR2File(project.id, file, 'cover');
      if (!out.ok || !out.url) {
        onToast?.(out.error || 'Cover upload failed');
        return;
      }
      await saveCoverUrl(out.url);
    } finally {
      setCoverUploading(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    setFileUploading(true);
    try {
      for (const file of list) {
        const out = await uploadProjectR2File(project.id, file, 'files');
        if (!out.ok || !out.url) {
          onToast?.(out.error || `Upload failed: ${file.name}`);
          break;
        }
        setProjectFiles((prev) => [{ name: file.name, url: out.url! }, ...prev]);
      }
      onToast?.('File uploaded');
      setAddFileOpen(false);
    } finally {
      setFileUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const submitTextFile = async () => {
    const title = textTitle.trim();
    const content = textContent.trim();
    if (!title || !content) return;
    setFileUploading(true);
    try {
      const out = await uploadProjectTextFile(project.id, title, content);
      if (!out.ok || !out.url) {
        onToast?.(out.error || 'Could not save text');
        return;
      }
      setProjectFiles((prev) => [{ name: `${title}.txt`, url: out.url! }, ...prev]);
      onToast?.('Text saved to project files');
      setTextModalOpen(false);
      setTextTitle('');
      setTextContent('');
      setAddFileOpen(false);
    } finally {
      setFileUploading(false);
    }
  };

  const submitGithubLink = async () => {
    const url = githubUrl.trim();
    if (!url) return;
    setFileUploading(true);
    try {
      const out = await uploadProjectTextFile(project.id, 'github-link', `GitHub reference\n${url}`);
      if (!out.ok) {
        onToast?.(out.error || 'Could not save GitHub link');
        return;
      }
      setProjectFiles((prev) => [{ name: 'GitHub link', url: url }, ...prev]);
      onToast?.('GitHub link saved');
      setGithubModalOpen(false);
      setGithubUrl('');
      setAddFileOpen(false);
    } finally {
      setFileUploading(false);
    }
  };

  const saveInstructions = async () => {
    setSavingInstructions(true);
    try {
      const res = await updateProject(project.id, { description: instructions.trim() });
      if (!res.ok) {
        onToast?.(res.error || 'Failed to save instructions');
        return;
      }
      onToast?.('Instructions saved');
      onRefresh?.();
    } finally {
      setSavingInstructions(false);
    }
  };

  const saveEdit = async () => {
    const name = editName.trim();
    if (!name) return;
    setEditSaving(true);
    try {
      const priority = Number(editPriority);
      const tags = [...(project.tags || []).filter((t) => !String(t).startsWith('cover:'))];
      const coverUrl = editCover.trim();
      if (coverUrl) tags.push(`cover:${coverUrl}`);
      const res = await updateProject(project.id, {
        name,
        status: editStatus,
        priority: Number.isFinite(priority) ? priority : undefined,
        tags_json: tags,
        ...(coverUrl
          ? { metadata_json: JSON.stringify({ cover_image_url: coverUrl }) }
          : {}),
      });
      if (!res.ok) {
        onToast?.(res.error || 'Failed to update project');
        return;
      }
      onToast?.('Project updated');
      setEditOpen(false);
      onRefresh?.();
    } finally {
      setEditSaving(false);
    }
  };

  const archiveProject = async () => {
    if (!window.confirm(`Archive "${project.name}"? It will hide from the default project list.`)) return;
    const res = await updateProject(project.id, { status: 'archived' });
    if (!res.ok) {
      onToast?.(res.error || 'Failed to archive');
      return;
    }
    onToast?.('Project archived');
    onBack();
    onRefresh?.();
  };

  const updatedLabel = project.lastDeploy && project.lastDeploy !== '—' ? project.lastDeploy : project.dueDate;
  const cover = cfImageVariants(project.cover_image_url);
  const hue = projectAccentHue(project.id);

  return (
    <div className="lib-proj-detail">
      <button type="button" className="lib-proj-back" onClick={onBack}>
        ← All projects
      </button>

      <div
        className={`lib-proj-detail-hero${coverUploading ? ' is-uploading' : ''}`}
        style={cover.src ? undefined : { background: `linear-gradient(135deg, hsl(${hue} 52% 42%), hsl(${(hue + 40) % 360} 48% 32%))` }}
        role="button"
        tabIndex={0}
        aria-label="Change cover image"
        onClick={() => coverInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') coverInputRef.current?.click();
        }}
      >
        {cover.src ? (
          <img src={cover.src} srcSet={cover.srcSet} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="lib-proj-detail-hero-initials">{projectInitials(project.name)}</span>
        )}
        <span className="lib-proj-detail-hero-overlay">
          {coverUploading ? <Loader2 size={20} className="animate-spin" /> : <Camera size={18} />}
          {coverUploading ? 'Uploading…' : 'Change cover'}
        </span>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="lib-proj-hidden-input"
          onChange={(e) => void handleCoverPick(e.target.files)}
        />
      </div>

      <div className="lib-proj-detail-head">
        <div>
          <h1>{project.name}</h1>
          <p>{project.description || project.stage || 'No description yet.'}</p>
        </div>
        <div className="lib-proj-detail-actions">
          <IconButton label="More" onClick={() => setMenuOpen((v) => !v)}>
            <MoreHorizontal size={18} />
          </IconButton>
          {menuOpen ? (
            <div className="lib-proj-menu" onMouseLeave={() => setMenuOpen(false)}>
              <button type="button" onClick={() => { setEditOpen(true); setEditCover(project.cover_image_url || ''); setMenuOpen(false); }}>
                Edit project
              </button>
              <button type="button" onClick={() => void saveInstructions()}>
                Save instructions
              </button>
              <button type="button" className="danger" onClick={() => void archiveProject()}>
                Archive project
              </button>
            </div>
          ) : null}
          <button type="button" className="lib-proj-btn outline">
            Share
          </button>
        </div>
      </div>

      <div className="lib-proj-tabs" role="tablist" aria-label="Project sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'overview'}
          className={tab === 'overview' ? 'active' : ''}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'tasks'}
          className={tab === 'tasks' ? 'active' : ''}
          onClick={() => setTab('tasks')}
        >
          Tasks
        </button>
      </div>

      {tab === 'tasks' ? (
        <div className="lib-proj-tasks-pane">
          <WorkspaceKanban
            workspaceId={project.workspace_id || workspaceId}
            projectId={project.id}
            variant="light"
          />
        </div>
      ) : (
      <div className="lib-proj-detail-grid">
        <div className="lib-proj-detail-main">
          <div className="lib-proj-composer">
            <p>How can I help you on this project?</p>
            <ProjectQuickCreateMenu
              projectId={project.id}
              projectName={project.name}
              workspaceId={project.workspace_id || workspaceId}
              onCreated={(kind) => {
                const labels: Record<string, string> = {
                  task: 'Task created',
                  note: 'Note saved',
                  meeting: 'Meeting scheduled',
                  plan: 'Plan item created',
                };
                onToast?.(labels[kind] || 'Created');
                if (kind === 'task') setTab('tasks');
              }}
            />
          </div>

          <div className="lib-proj-chat-toolbar">
            <span className="lib-proj-chat-count">
              {chatsLoading ? 'Loading chats…' : `${chats.length} chat${chats.length === 1 ? '' : 's'}`}
            </span>
            <button type="button" className="lib-proj-btn ghost sm" onClick={() => setAddChatsOpen(true)}>
              Add existing chats
            </button>
          </div>

          <ul className="lib-proj-chat-list">
            {chats.map((c) => {
              const id = conversationIdFromSession(c);
              if (!id) return null;
              return (
                <li key={id}>
                  <button type="button" className="lib-proj-chat-row" onClick={() => openChat(c)}>
                    <span>{sessionDisplayTitle(c)}</span>
                    <span>{chatsListRelativeTime(c)}</span>
                  </button>
                </li>
              );
            })}
            {!chatsLoading && chats.length === 0 ? (
              <li className="lib-project-muted lib-proj-chat-empty">
                No chats in this project yet. Use <strong>Add existing chats</strong> or start a new one.
              </li>
            ) : null}
          </ul>
        </div>

        <aside className="lib-proj-detail-side">
          <section className="lib-proj-card">
            <div className="lib-proj-card-head">
              <h3>Health</h3>
              <span className="lib-proj-pill">Live</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
              <ProjectHealthDonut
                taskRatio={project.totalTasks > 0 ? project.completedTasks / project.totalTasks : 0}
                healthScore={project.health ?? 0}
                budgetRatio={project.budgetTotal > 0 ? project.budgetUsed / project.budgetTotal : 0}
                accentColor={`hsl(${hue} 65% 55%)`}
                size={80}
                label={true}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <DonutLegendRow color={`hsl(${hue} 65% 55%)`} label="Tasks" value={project.totalTasks > 0 ? `${project.completedTasks}/${project.totalTasks}` : '—'} />
                  <DonutLegendRow color="#6366F1" label="Health" value={project.health > 0 ? `${Math.round(project.health)}%` : '—'} />
                  <DonutLegendRow color="#EC4899" label="Budget" value={project.budgetTotal > 0 ? `${Math.round((project.budgetUsed / project.budgetTotal) * 100)}%` : '—'} />
                </div>
              </div>
            </div>
            <p>
              {project.description
                ? project.description.slice(0, 180)
                : 'Purpose and context for this project — add a description when creating the project.'}
            </p>
            <p className="lib-proj-card-meta">Updated {updatedLabel || 'recently'}</p>
          </section>

          <section className="lib-proj-card">
            <div className="lib-proj-card-head">
              <h3>Instructions</h3>
              <IconButton label="Save instructions" onClick={() => void saveInstructions()}>
                <Plus size={14} />
              </IconButton>
            </div>
            <textarea
              className="lib-proj-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Add instructions to tailor Agent Sam responses for this project…"
              rows={4}
            />
            {savingInstructions ? <p className="lib-proj-card-meta">Saving…</p> : null}
          </section>

          <section className="lib-proj-card relative">
            <div className="lib-proj-card-head">
              <h3>Files</h3>
              <IconButton label="Add file" onClick={() => setAddFileOpen((v) => !v)}>
                <Plus size={14} />
              </IconButton>
            </div>
            {addFileOpen ? (
              <div className="lib-proj-add-file-menu">
                {[
                  {
                    icon: <Paperclip size={16} />,
                    label: 'Upload from device',
                    onClick: () => fileInputRef.current?.click(),
                  },
                  {
                    icon: <FileText size={16} />,
                    label: 'Add text content',
                    onClick: () => setTextModalOpen(true),
                  },
                  {
                    icon: <Github size={16} />,
                    label: 'GitHub',
                    onClick: () => setGithubModalOpen(true),
                  },
                  {
                    icon: <FolderOpen size={16} />,
                    label: 'Drive',
                    onClick: () => setDriveModalOpen(true),
                  },
                ].map((it) => (
                  <button key={it.label} type="button" className="lib-proj-add-file-item" onClick={it.onClick}>
                    <span>{it.icon}</span>
                    {it.label}
                  </button>
                ))}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="lib-proj-hidden-input"
                  onChange={(e) => void handleFileUpload(e.target.files)}
                />
              </div>
            ) : null}
            {fileUploading ? <p className="lib-proj-card-meta">Uploading…</p> : null}
            {projectFiles.length ? (
              <ul className="lib-proj-files-list">
                {projectFiles.map((f) => (
                  <li key={f.url}>
                    <a href={f.url} target="_blank" rel="noopener noreferrer">
                      {f.name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="lib-proj-files-empty">
                <p>Add PDFs, documents, or other text to reference in this project.</p>
                <button type="button" className="lib-proj-btn ghost sm" onClick={() => navigate('/dashboard/artifacts')}>
                  Open Library
                </button>
              </div>
            )}
          </section>
        </aside>
      </div>
      )}

      {editOpen ? (
        <div className="lib-proj-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setEditOpen(false)}>
          <div className="lib-proj-modal" role="dialog" aria-labelledby="edit-project-title">
            <div className="lib-proj-modal-head">
              <h2 id="edit-project-title">Edit project</h2>
              <IconButton label="Close" onClick={() => setEditOpen(false)}>
                <X size={18} />
              </IconButton>
            </div>
            <label className="lib-proj-edit-field">
              Name
              <input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </label>
            <label className="lib-proj-edit-field">
              Status
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                {['discovery', 'design', 'development', 'qa', 'staging', 'production', 'maintenance', 'archived'].map(
                  (s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="lib-proj-edit-field">
              Priority (0–100)
              <input
                type="number"
                min={0}
                max={100}
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value)}
              />
            </label>
            <label className="lib-proj-edit-field">
              Cover image URL
              <input
                value={editCover}
                onChange={(e) => setEditCover(e.target.value)}
                placeholder="https://imagedelivery.net/… or any image URL"
              />
            </label>
            <div className="lib-proj-modal-actions">
              <button type="button" className="lib-proj-btn ghost" onClick={() => setEditOpen(false)}>
                Cancel
              </button>
              <button type="button" className="lib-proj-btn primary" disabled={editSaving} onClick={() => void saveEdit()}>
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {addChatsOpen ? (
        <AddChatsModal
          project={project}
          onClose={() => setAddChatsOpen(false)}
          onAssigned={() => {
            onToast?.('Chats added to project');
            void loadChats();
            onRefresh?.();
          }}
        />
      ) : null}

      {textModalOpen ? (
        <div className="lib-proj-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setTextModalOpen(false)}>
          <div className="lib-proj-modal" role="dialog" aria-labelledby="add-text-title">
            <div className="lib-proj-modal-head">
              <h2 id="add-text-title">Add text content</h2>
              <IconButton label="Close" onClick={() => setTextModalOpen(false)}>
                <X size={18} />
              </IconButton>
            </div>
            <label className="lib-proj-edit-field">
              Title
              <input value={textTitle} onChange={(e) => setTextTitle(e.target.value)} autoFocus />
            </label>
            <label className="lib-proj-edit-field">
              Content
              <textarea rows={6} value={textContent} onChange={(e) => setTextContent(e.target.value)} />
            </label>
            <div className="lib-proj-modal-actions">
              <button type="button" className="lib-proj-btn ghost" onClick={() => setTextModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="lib-proj-btn primary"
                disabled={!textTitle.trim() || !textContent.trim() || fileUploading}
                onClick={() => void submitTextFile()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {githubModalOpen ? (
        <div className="lib-proj-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setGithubModalOpen(false)}>
          <div className="lib-proj-modal" role="dialog" aria-labelledby="github-link-title">
            <div className="lib-proj-modal-head">
              <h2 id="github-link-title">Link GitHub repository</h2>
              <IconButton label="Close" onClick={() => setGithubModalOpen(false)}>
                <X size={18} />
              </IconButton>
            </div>
            <label className="lib-proj-edit-field">
              Repository URL
              <input
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/org/repo"
                autoFocus
              />
            </label>
            <div className="lib-proj-modal-actions">
              <button type="button" className="lib-proj-btn ghost" onClick={() => setGithubModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="lib-proj-btn primary"
                disabled={!githubUrl.trim() || fileUploading}
                onClick={() => void submitGithubLink()}
              >
                Save link
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {driveModalOpen ? (
        <div className="lib-proj-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setDriveModalOpen(false)}>
          <div className="lib-proj-modal" role="dialog" aria-labelledby="drive-link-title">
            <div className="lib-proj-modal-head">
              <h2 id="drive-link-title">Google Drive</h2>
              <IconButton label="Close" onClick={() => setDriveModalOpen(false)}>
                <X size={18} />
              </IconButton>
            </div>
            <p className="lib-project-muted">Browse and attach Drive files from the Library artifacts view.</p>
            <div className="lib-proj-modal-actions">
              <button type="button" className="lib-proj-btn ghost" onClick={() => setDriveModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="lib-proj-btn primary"
                onClick={() => {
                  setDriveModalOpen(false);
                  navigate('/dashboard/artifacts');
                }}
              >
                Open Library
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default LibraryProjectDetail;
