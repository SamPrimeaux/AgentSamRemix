/**
 * Project detail host — layout composition only.
 * Data: hooks/useProjectData.ts · Rail: rail/ProjectRailContent.tsx · Composer: composer/ProjectComposerPanel.tsx
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckSquare,
  Image as ImageIcon,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Share2,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { ProjectShareModal } from '../../components/projects/ProjectShareModal';
import { useWorkspace } from '../../src/context/WorkspaceContext';
import { ProjectComposerPanel } from './composer/ProjectComposerPanel';
import { CSS } from './projectDetailPage.styles';
import { useProjectData, type Project } from './hooks/useProjectData';
import {
  ProjectRailOverlays,
  ProjectRailSections,
  type ProjectRailContentProps,
} from './rail/ProjectRailContent';
import { SkeletonRow, useIsMobile } from './rail/ProjectRailEditors';

export type { Project };

interface ChatSession {
  conversation_id?: string;
  id?: string;
  title?: string;
  updated_at?: number | string;
  last_turn_status?: string;
  project_id?: string;
}

function relTime(raw?: number | string): string {
  if (!raw) return '';
  const ts = typeof raw === 'number' ? raw * 1000 : Date.parse(String(raw));
  if (Number.isNaN(ts)) return String(raw);
  const diff = Date.now() - ts;
  const d = Math.floor(diff / 86_400_000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 1) return `${Math.floor(d / 7)}w ago`;
  return mo === 1 ? '1 month ago' : `${mo} months ago`;
}

function buildRailProps(
  d: ReturnType<typeof useProjectData>,
  opts: { projectId: string | undefined; isMobile: boolean },
): ProjectRailContentProps {
  return {
    project: d.project,
    projectId: opts.projectId,
    isMobile: opts.isMobile,
    projectTodos: d.projectTodos,
    tasksInsights: d.tasksInsights,
    timerState: d.timerState,
    statsMetric: d.statsMetric,
    statsPeriod: d.statsPeriod,
    onStatsMetricChange: d.setStatsMetric,
    onStatsPeriodChange: d.setStatsPeriod,
    refreshing: d.refreshing,
    onRefreshProjectContext: () => void d.refreshProjectContext(),
    onToggleProjectTimer: () => void d.toggleProjectTimer(),
    onOpenProjectTasks: d.openProjectTasks,
    onOpenProjectCalendar: d.openProjectCalendar,
    clientContact: d.clientContact,
    codeIndexApi: d.codeIndexApi,
    brandAssets: d.brandAssets,
    brandTokens: d.brandTokens,
    onBrandTokensChange: d.setBrandTokens,
    brandLoading: d.brandLoading,
    brandUploading: d.brandUploading,
    brandDragOver: d.brandDragOver,
    onBrandDragOverChange: d.setBrandDragOver,
    brandDragDepthRef: d.brandDragDepthRef,
    brandInputRef: d.brandInputRef,
    storageScope: d.storageScope,
    storagePref: d.storagePref,
    storageDraft: d.storageDraft,
    storageBusy: d.storageBusy,
    storageMenuOpen: d.storageMenuOpen,
    storageAdvancedOpen: d.storageAdvancedOpen,
    storageAnchorRef: d.storageAnchorRef,
    workContextBindings: d.workContextBindings,
    onStorageAdvancedOpenChange: d.setStorageAdvancedOpen,
    onStorageDraftChange: d.setStorageDraft,
    onToggleStorageMenu: () => void d.toggleStorageMenu(),
    onCloseStorageMenu: d.closeStorageMenu,
    onSaveStoragePrefFromMenu: () => void d.saveStoragePrefFromMenu(),
    onOpenBrandAssetBrowser: d.openBrandAssetBrowser,
    onAppendBrandAssets: (files) => void d.appendBrandAssets(files),
    onPersistProjectMeta: d.persistProjectMeta,
    onToast: d.setToast,
    coverUrl: d.coverUrl,
    coverUploading: d.coverUploading,
    coverInputRef: d.coverInputRef,
    onCoverPick: (files) => void d.handleCoverPick(files),
    memory: d.memory,
    memSaved: d.memSaved,
    memBusy: d.memBusy,
    memDraft: d.memDraft,
    onMemDraftChange: d.setMemDraft,
    onSaveMemoryFromModal: () => void d.saveMemoryFromModal(),
    instructions: d.instructions,
    instrSaved: d.instrSaved,
    instrBusy: d.instrBusy,
    instrDraft: d.instrDraft,
    onInstrDraftChange: d.setInstrDraft,
    onSaveInstructionsFromModal: () => void d.saveInstructionsFromModal(),
    projectFiles: d.projectFiles,
    fileUploading: d.fileUploading,
    fileDragOver: d.fileDragOver,
    onFileDragOverChange: d.setFileDragOver,
    fileDragDepthRef: d.fileDragDepthRef,
    fileInputRef: d.fileInputRef,
    onAppendProjectFiles: (files) => void d.appendProjectFiles(files),
    railEditor: d.railEditor,
    onOpenRailEditor: d.openRailEditor,
    onCloseRailEditor: d.closeRailEditor,
    previewImage: d.previewImage,
    onPreviewImageChange: d.setPreviewImage,
  };
}

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { workspaceId, sessionUserId, switchWorkspace, persistGithubRepo } = useWorkspace();
  const isMobile = useIsMobile();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [railOpen, setRailOpen] = useState(false);

  const d = useProjectData({
    projectId,
    workspaceId,
    sessionUserId,
    switchWorkspace,
    persistGithubRepo,
    navigate,
    isMobile,
    railOpen,
    setRailOpen,
  });

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const railProps = buildRailProps(d, { projectId, isMobile });

  if (d.loadingProject) {
    return (
      <div className="cpd-root">
        <style>{CSS}</style>
        <div className="cpd-left">
          <div className="cpd-back-row">
            <div className="cpd-skel" style={{ height: 13, width: 100 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '20px 0' }}>
            <div className="cpd-skel" style={{ height: 28, width: '50%' }} />
            <div className="cpd-skel" style={{ height: 13, width: '70%' }} />
            <div className="cpd-skel" style={{ height: 13, width: '45%' }} />
          </div>
        </div>
        {!isMobile && (
          <div className="cpd-right">
            <div className="cpd-skel" style={{ height: 80, width: '100%', borderRadius: 10 }} />
          </div>
        )}
      </div>
    );
  }

  if (!d.project) return null;
  const project = d.project;

  return (
    <div className="cpd-root">
      <style>{CSS}</style>

      <div className="cpd-left">
        <div className="cpd-back-row">
          <button
            type="button"
            className="cpd-back"
            onClick={() => navigate('/dashboard/projects')}
          >
            <ArrowLeft size={13} strokeWidth={1.5} />
            All projects
          </button>
          {isMobile && (
            <button
              type="button"
              className="cpd-details-toggle"
              onClick={() => setRailOpen(true)}
            >
              Details
            </button>
          )}
        </div>

        <div className="cpd-title-section">
          {d.renaming ? (
            <div className="cpd-rename-row">
              <input
                autoFocus
                className="cpd-rename-input"
                value={d.renameDraft}
                onChange={(e) => d.setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void d.saveRename();
                  if (e.key === 'Escape') d.setRenaming(false);
                }}
              />
              <button
                type="button"
                className="cpd-icon-btn"
                disabled={d.renameBusy}
                onClick={() => void d.saveRename()}
              >
                {d.renameBusy ? '...' : 'Save'}
              </button>
              <button type="button" className="cpd-icon-btn" onClick={() => d.setRenaming(false)}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="cpd-title-row">
              <h1 className="cpd-title">{project.name}</h1>
              <div className="cpd-title-actions">
                <button
                  type="button"
                  className="cpd-icon-btn"
                  title="Refresh project context (memory, tasks, assets)"
                  disabled={d.refreshing}
                  onClick={() => void d.refreshProjectContext()}
                >
                  <RefreshCw size={15} strokeWidth={1.5} className={d.refreshing ? 'cpd-spin' : undefined} />
                </button>
                <div ref={menuRef} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className="cpd-icon-btn"
                    title="More options"
                    onClick={() => setMenuOpen((v) => !v)}
                  >
                    <MoreHorizontal size={16} strokeWidth={1.5} />
                  </button>
                  {menuOpen && (
                    <div className="cpd-menu">
                      <button
                        type="button"
                        className="cpd-menu-item"
                        onClick={() => { d.openProjectTasks(); setMenuOpen(false); }}
                      >
                        <CheckSquare size={13} />
                        View tasks
                      </button>
                      <button
                        type="button"
                        className="cpd-menu-item"
                        onClick={() => { d.coverInputRef.current?.click(); setMenuOpen(false); }}
                      >
                        <ImageIcon size={13} />
                        Set cover photo
                      </button>
                      <button
                        type="button"
                        className="cpd-menu-item"
                        onClick={() => { d.setRenaming(true); setMenuOpen(false); }}
                      >
                        <Pencil size={13} />
                        Rename project
                      </button>
                      <button
                        type="button"
                        className="cpd-menu-item"
                        onClick={() => { d.setShareOpen(true); setMenuOpen(false); }}
                      >
                        <Share2 size={13} />
                        Share
                      </button>
                      <button
                        type="button"
                        className="cpd-menu-item cpd-menu-item--danger"
                        onClick={() => { d.setDeleteOpen(true); setMenuOpen(false); }}
                      >
                        <Trash2 size={13} />
                        Delete project
                      </button>
                    </div>
                  )}
                </div>
                <button type="button" className="cpd-icon-btn" title="Star project">
                  <Star size={16} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="cpd-left-scroll">
          <ProjectComposerPanel
            workspaceId={workspaceId}
            sessionUserId={sessionUserId}
            project={project}
            projectChatId={d.projectChatId}
            memory={d.memory}
            instructions={d.instructions}
            loadChats={d.loadChats}
          />

          <div className="cpd-chat-section">
            {d.loadingChats ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : d.chats.length === 0 ? (
              <div className="cpd-chat-empty">
                No chats in this project yet. Start one above — Agent Sam opens full-screen with this project linked.
              </div>
            ) : (
              <ul className="cpd-chat-list">
                {d.chats.map((s: ChatSession) => {
                  const id = s.conversation_id ?? s.id ?? '';
                  const incomplete =
                    s.last_turn_status === 'interrupted' ||
                    s.last_turn_status === 'failed' ||
                    s.last_turn_status === 'done_no_token';
                  return (
                    <li key={id} className="cpd-chat-row group">
                      <button
                        type="button"
                        className="cpd-chat-btn"
                        onClick={() => d.resumeChat(s)}
                      >
                        <span className="cpd-chat-title">{s.title || 'Untitled chat'}</span>
                        {incomplete && (
                          <span className="cpd-chat-badge cpd-chat-badge--err">Incomplete</span>
                        )}
                      </button>
                      <span className="cpd-chat-time">
                        Last message {relTime(s.updated_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {!isMobile && (
        <aside className="cpd-right">
          <ProjectRailSections {...railProps} />
        </aside>
      )}

      {isMobile && railOpen && (
        <>
          <div
            className="cpd-sheet-backdrop"
            onClick={() => setRailOpen(false)}
          />
          <div className="cpd-sheet">
            <div className="cpd-sheet-header">
              <span className="cpd-sheet-title">Project Details</span>
              <button
                type="button"
                className="cpd-icon-btn"
                onClick={() => setRailOpen(false)}
                aria-label="Close"
              >
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>
            <div className="cpd-sheet-body">
              <ProjectRailSections {...railProps} />
            </div>
          </div>
        </>
      )}

      <ProjectShareModal
        project={project && d.shareOpen ? { id: project.id, name: project.name } : null}
        onClose={() => d.setShareOpen(false)}
        onToast={d.setToast}
      />

      <ProjectRailOverlays {...railProps} />

      {d.deleteOpen && project && (
        <div
          className="cpd-modal-backdrop"
          role="presentation"
          onClick={() => !d.deleteBusy && d.setDeleteOpen(false)}
        >
          <div
            className="cpd-modal"
            role="dialog"
            aria-labelledby="cpd-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="cpd-delete-title" className="cpd-modal-title">Delete project</h2>
            <p className="cpd-modal-body">
              <strong>{project.name}</strong>
              {project.workspace_id ? (
                <span className="cpd-modal-meta"> · {project.workspace_id}</span>
              ) : null}
            </p>
            <p className="cpd-modal-hint">
              This permanently removes the project and its memory, files metadata, and collaborators. This cannot be undone.
            </p>
            <div className="cpd-modal-actions">
              <button
                type="button"
                className="cpd-btn cpd-btn--danger"
                disabled={d.deleteBusy}
                onClick={() => void d.submitDelete()}
              >
                {d.deleteBusy ? 'Deleting…' : 'Delete project'}
              </button>
              <button
                type="button"
                className="cpd-btn"
                disabled={d.deleteBusy}
                onClick={() => d.setDeleteOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {d.toast && <div className="cpd-toast" role="status">{d.toast}</div>}
    </div>
  );
}
