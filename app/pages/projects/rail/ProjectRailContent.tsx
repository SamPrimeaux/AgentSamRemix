/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Project detail right-rail sections + overlays peeled from ProjectDetailPage.tsx.
 * Mechanical move only — host still owns state/handlers and aside/sheet chrome.
 */
import React, { useMemo } from 'react';
import {
  ExternalLink,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { cfImageVariants, projectAccentHue } from '../../../src/lib/projectBranding';
import type { AgentTodo, TasksInsightsPayload } from '../../launch-desk/ops-desk-types';
import { ProjectQuickStats, type ProjectStatsMetric, type ProjectStatsPeriod } from '../ProjectQuickStats';
import {
  isProjectImageFile,
  type BrandTokens,
  type ProjectFileRef,
  type ProjectStorageScope,
} from '../projectDetailMeta';
import { PROJECT_MEMORY_PLACEHOLDER } from '../projectMemoryTemplate';
import {
  storagePrefSummary,
  type ProjectStoragePref,
  type ProjectWorkContextBindings,
} from '../projectStoragePreferences';
import { ProjectStorageDropdown } from '../ProjectStorageDropdown';
import { CodeIndexPanel } from '../code-index/CodeIndexPanel';
import type { ProjectCodeIndexApi } from '../code-index/useProjectCodeIndex';
import {
  RailEditorModal,
  RailPreviewCard,
  RailSection,
  type RailEditorKind,
} from './ProjectRailEditors';

/** Minimal project shape used by rail JSX (avoid importing host page). */
export type ProjectRailProject = {
  id: string;
  name: string;
  client_id?: string | null;
};

export type ProjectRailClientContact = {
  client_name?: string | null;
  payment_notes?: string | null;
  client_id?: string | null;
};

export type ProjectRailTodosState = {
  items: AgentTodo[];
  loading: boolean;
};

export type ProjectRailTimerState = {
  loading: boolean;
  running: boolean;
  minutesToday: number;
  busy: boolean;
};

export type ProjectRailContentProps = {
  project: ProjectRailProject | null;
  projectId: string | undefined;
  isMobile: boolean;

  // quick stats
  projectTodos: ProjectRailTodosState;
  tasksInsights: TasksInsightsPayload | null;
  timerState: ProjectRailTimerState;
  statsMetric: ProjectStatsMetric;
  statsPeriod: ProjectStatsPeriod;
  onStatsMetricChange: (m: ProjectStatsMetric) => void;
  onStatsPeriodChange: (p: ProjectStatsPeriod) => void;
  refreshing: boolean;
  onRefreshProjectContext: () => void;
  onToggleProjectTimer: () => void;
  onOpenProjectTasks: () => void;
  onOpenProjectCalendar: () => void;
  clientContact: ProjectRailClientContact | null;

  // code index
  codeIndexApi: ProjectCodeIndexApi;

  // brand / storage
  brandAssets: ProjectFileRef[];
  brandTokens: BrandTokens;
  onBrandTokensChange: React.Dispatch<React.SetStateAction<BrandTokens>>;
  brandLoading: boolean;
  brandUploading: boolean;
  brandDragOver: boolean;
  onBrandDragOverChange: (over: boolean) => void;
  brandDragDepthRef: React.MutableRefObject<number>;
  brandInputRef: React.RefObject<HTMLInputElement | null>;
  storageScope: ProjectStorageScope | null;
  storagePref: ProjectStoragePref | null;
  storageDraft: ProjectStoragePref;
  storageBusy: boolean;
  storageMenuOpen: boolean;
  storageAdvancedOpen: boolean;
  storageAnchorRef: React.RefObject<HTMLDivElement | null>;
  workContextBindings: ProjectWorkContextBindings | null;
  onStorageAdvancedOpenChange: (open: boolean) => void;
  onStorageDraftChange: (next: ProjectStoragePref) => void;
  onToggleStorageMenu: () => void;
  onCloseStorageMenu: () => void;
  onSaveStoragePrefFromMenu: () => void;
  onOpenBrandAssetBrowser: () => void;
  onAppendBrandAssets: (files: FileList | File[] | null) => void;
  onPersistProjectMeta: (patch: Record<string, unknown>) => Promise<boolean>;
  onToast: (message: string) => void;

  // cover
  coverUrl: string | null;
  coverUploading: boolean;
  coverInputRef: React.RefObject<HTMLInputElement | null>;
  onCoverPick: (files: FileList | null) => void;

  // memory / instructions
  memory: string;
  memSaved: boolean;
  memBusy: boolean;
  memDraft: string;
  onMemDraftChange: (value: string) => void;
  onSaveMemoryFromModal: () => void;
  instructions: string;
  instrSaved: boolean;
  instrBusy: boolean;
  instrDraft: string;
  onInstrDraftChange: (value: string) => void;
  onSaveInstructionsFromModal: () => void;

  // files
  projectFiles: ProjectFileRef[];
  fileUploading: boolean;
  fileDragOver: boolean;
  onFileDragOverChange: (over: boolean) => void;
  fileDragDepthRef: React.MutableRefObject<number>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onAppendProjectFiles: (files: FileList | File[] | null) => void;

  // rail editor + preview
  railEditor: RailEditorKind | null;
  onOpenRailEditor: (kind: RailEditorKind) => void;
  onCloseRailEditor: () => void;
  previewImage: ProjectFileRef | null;
  onPreviewImageChange: (file: ProjectFileRef | null) => void;
};

function filesDropZone(
  props: Pick<
    ProjectRailContentProps,
    | 'fileDragOver'
    | 'onFileDragOverChange'
    | 'fileDragDepthRef'
    | 'fileUploading'
    | 'fileInputRef'
    | 'onAppendProjectFiles'
  >,
  className = '',
) {
  const {
    fileDragOver,
    onFileDragOverChange,
    fileDragDepthRef,
    fileUploading,
    fileInputRef,
    onAppendProjectFiles,
  } = props;
  return (
    <div
      className={`cpd-files-drop${fileDragOver ? ' cpd-files-drop--over' : ''}${className ? ` ${className}` : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        fileDragDepthRef.current += 1;
        onFileDragOverChange(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
        if (fileDragDepthRef.current === 0) onFileDragOverChange(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        fileDragDepthRef.current = 0;
        onFileDragOverChange(false);
        void onAppendProjectFiles(e.dataTransfer.files);
      }}
    >
      <FolderOpen size={24} strokeWidth={1} className="cpd-files-icon" />
      <p className="cpd-files-text">
        Drop images, PDFs, or docs here — attached to this project for Agent Sam and your team.
      </p>
      <button
        type="button"
        className="cpd-rail-empty-btn"
        disabled={fileUploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {fileUploading ? 'Uploading…' : 'Choose files'}
      </button>
    </div>
  );
}

function filesGallery(
  imageFiles: ProjectFileRef[],
  onPreviewImageChange: (file: ProjectFileRef | null) => void,
) {
  return imageFiles.length > 0 ? (
    <div className="cpd-files-gallery" role="list" aria-label="Project images">
      {imageFiles.map((f) => {
        const variants = cfImageVariants(f.url);
        return (
          <button
            key={`${f.url}-${f.name}`}
            type="button"
            className="cpd-files-thumb"
            role="listitem"
            title={f.name}
            onClick={() => onPreviewImageChange(f)}
          >
            <img
              src={variants.src}
              srcSet={variants.srcSet}
              alt={f.name}
              loading="lazy"
              draggable={false}
            />
          </button>
        );
      })}
    </div>
  ) : null;
}

function filesDocList(documentFiles: ProjectFileRef[]) {
  return documentFiles.length > 0 ? (
    <ul className="cpd-files-list">
      {documentFiles.map((f) => (
        <li key={`${f.url}-${f.name}`}>
          <FileText size={14} strokeWidth={1.75} aria-hidden className="cpd-files-doc-icon" />
          <a href={f.url} target="_blank" rel="noreferrer noopener">
            {f.name}
          </a>
          <ExternalLink size={12} aria-hidden />
        </li>
      ))}
    </ul>
  ) : null;
}

function brandDropZone(
  props: Pick<
    ProjectRailContentProps,
    | 'brandDragOver'
    | 'onBrandDragOverChange'
    | 'brandDragDepthRef'
    | 'brandUploading'
    | 'brandInputRef'
    | 'onAppendBrandAssets'
    | 'storageScope'
  >,
  className = '',
) {
  const {
    brandDragOver,
    onBrandDragOverChange,
    brandDragDepthRef,
    brandUploading,
    brandInputRef,
    onAppendBrandAssets,
    storageScope,
  } = props;
  return (
    <div
      className={`cpd-files-drop cpd-brand-drop${brandDragOver ? ' cpd-files-drop--over' : ''}${className ? ` ${className}` : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        brandDragDepthRef.current += 1;
        onBrandDragOverChange(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        brandDragDepthRef.current = Math.max(0, brandDragDepthRef.current - 1);
        if (brandDragDepthRef.current === 0) onBrandDragOverChange(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        brandDragDepthRef.current = 0;
        onBrandDragOverChange(false);
        void onAppendBrandAssets(e.dataTransfer.files);
      }}
    >
      <Palette size={24} strokeWidth={1} className="cpd-files-icon" />
      <p className="cpd-files-text">
        Drop logos, icons, or color swatches — stored in{' '}
        <span className="cpd-quick-stat-mono">{storageScope?.bucket || 'project R2'}</span>
        {storageScope?.prefix ? ` · ${storageScope.prefix}` : ''}.
      </p>
      <button
        type="button"
        className="cpd-rail-empty-btn"
        disabled={brandUploading}
        onClick={() => brandInputRef.current?.click()}
      >
        {brandUploading ? 'Uploading…' : 'Choose brand images'}
      </button>
    </div>
  );
}

function brandGallery(
  brandAssets: ProjectFileRef[],
  onPreviewImageChange: (file: ProjectFileRef | null) => void,
) {
  return brandAssets.length > 0 ? (
    <div className="cpd-files-gallery cpd-brand-gallery" role="list" aria-label="Brand assets">
      {brandAssets.map((f) => {
        const variants = cfImageVariants(f.url);
        return (
          <button
            key={`${f.url}-${f.name}`}
            type="button"
            className="cpd-files-thumb"
            role="listitem"
            title={f.name}
            onClick={() => onPreviewImageChange(f)}
          >
            <img src={variants.src} srcSet={variants.srcSet} alt={f.name} loading="lazy" draggable={false} />
          </button>
        );
      })}
    </div>
  ) : null;
}

/** Former `railContent` — host mounts inside desktop aside or mobile sheet body. */
export function ProjectRailSections(props: ProjectRailContentProps): React.JSX.Element {
  const {
    project,
    projectId,
    isMobile,
    projectTodos,
    tasksInsights,
    timerState,
    statsMetric,
    statsPeriod,
    onStatsMetricChange,
    onStatsPeriodChange,
    refreshing,
    onRefreshProjectContext,
    onToggleProjectTimer,
    onOpenProjectTasks,
    onOpenProjectCalendar,
    codeIndexApi,
    brandAssets,
    brandTokens,
    brandLoading,
    brandUploading,
    brandDragOver,
    onBrandDragOverChange,
    brandDragDepthRef,
    brandInputRef,
    storageScope,
    storagePref,
    storageDraft,
    storageBusy,
    storageMenuOpen,
    storageAdvancedOpen,
    storageAnchorRef,
    workContextBindings,
    onStorageAdvancedOpenChange,
    onStorageDraftChange,
    onToggleStorageMenu,
    onCloseStorageMenu,
    onSaveStoragePrefFromMenu,
    onOpenBrandAssetBrowser,
    onAppendBrandAssets,
    coverUrl,
    coverUploading,
    memory,
    memSaved,
    instructions,
    instrSaved,
    projectFiles,
    fileUploading,
    onOpenRailEditor,
    onPreviewImageChange,
  } = props;

  const imageFiles = useMemo(
    () => projectFiles.filter((f) => isProjectImageFile(f)),
    [projectFiles],
  );
  const documentFiles = useMemo(
    () => projectFiles.filter((f) => !isProjectImageFile(f)),
    [projectFiles],
  );

  const brandPrimary = brandTokens.primary_color?.trim();
  const brandAccent = brandTokens.accent_color?.trim() || `hsl(${projectAccentHue(project?.id || '')} 62% 48%)`;
  const railDefaultOpen = !isMobile;

  return (
    <>
      <RailSection
        title="Quick stats"
        defaultOpen={railDefaultOpen}
        action={
          <div className="cpd-rail-actions">
            <button
              type="button"
              className="cpd-icon-btn"
              title="Refresh project context"
              disabled={refreshing}
              onClick={() => void onRefreshProjectContext()}
            >
              <RefreshCw size={13} strokeWidth={1.5} className={refreshing ? 'cpd-spin' : undefined} />
            </button>
            <button
              type="button"
              className="cpd-icon-btn"
              title="Expand stats"
              onClick={() => onOpenRailEditor('stats')}
            >
              <ExternalLink size={13} strokeWidth={1.5} />
            </button>
          </div>
        }
      >
        <ProjectQuickStats
          compact
          todos={projectTodos.items}
          todosLoading={projectTodos.loading}
          tasksInsights={tasksInsights}
          timerRunning={timerState.running}
          timerBusy={timerState.busy}
          timerMinutesToday={timerState.minutesToday}
          onToggleTimer={() => void onToggleProjectTimer()}
          onOpenTasks={onOpenProjectTasks}
          onOpenCalendar={onOpenProjectCalendar}
          metric={statsMetric}
          onMetricChange={onStatsMetricChange}
          period={statsPeriod}
          onPeriodChange={onStatsPeriodChange}
        />
      </RailSection>

      <CodeIndexPanel
        projectId={projectId}
        defaultOpen={railDefaultOpen}
        {...codeIndexApi}
      />

      <RailSection
        title="Brand assets"
        defaultOpen={false}
        action={
          <div className="cpd-rail-actions cpd-rail-actions--storage">
            <div className="cpd-storage-anchor" ref={storageAnchorRef}>
              <button
                type="button"
                className={`cpd-icon-btn${storageMenuOpen ? ' cpd-icon-btn--active' : ''}`}
                title="Project storage"
                aria-expanded={storageMenuOpen}
                aria-haspopup="dialog"
                onClick={() => void onToggleStorageMenu()}
              >
                <FolderOpen size={13} strokeWidth={1.5} />
              </button>
              <ProjectStorageDropdown
                open={storageMenuOpen}
                isMobile={isMobile}
                anchorRef={storageAnchorRef}
                scope={storageScope}
                bindings={workContextBindings}
                pref={storagePref}
                draft={storageDraft}
                busy={storageBusy}
                advancedOpen={storageAdvancedOpen}
                onAdvancedOpenChange={onStorageAdvancedOpenChange}
                onDraftChange={onStorageDraftChange}
                onClose={onCloseStorageMenu}
                onSave={onSaveStoragePrefFromMenu}
                onOpenAssetBrowser={() => {
                  onCloseStorageMenu();
                  onOpenBrandAssetBrowser();
                }}
              />
            </div>
            <button
              type="button"
              className="cpd-icon-btn"
              title="Open asset browser"
              onClick={onOpenBrandAssetBrowser}
            >
              <ExternalLink size={13} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="cpd-icon-btn"
              title="Manage brand assets"
              disabled={brandUploading}
              onClick={() => brandInputRef.current?.click()}
            >
              <Plus size={14} strokeWidth={1.5} />
            </button>
          </div>
        }
      >
        <div
          className={`cpd-brand-rail${brandDragOver ? ' cpd-brand-rail--over' : ''}`}
          onDragEnter={(e) => {
            e.preventDefault();
            brandDragDepthRef.current += 1;
            onBrandDragOverChange(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={() => {
            brandDragDepthRef.current = Math.max(0, brandDragDepthRef.current - 1);
            if (brandDragDepthRef.current === 0) onBrandDragOverChange(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            brandDragDepthRef.current = 0;
            onBrandDragOverChange(false);
            void onAppendBrandAssets(e.dataTransfer.files);
          }}
        >
          <div className="cpd-brand-swatches" aria-hidden>
            <span className="cpd-brand-swatch" style={{ background: brandPrimary || brandAccent }} />
            <span className="cpd-brand-swatch cpd-brand-swatch--muted" style={{ background: brandAccent }} />
          </div>
          {brandLoading ? (
            <p className="cpd-rail-preview-empty">Loading…</p>
          ) : brandAssets.length > 0 ? (
            <div className="cpd-rail-files-mini cpd-brand-rail-grid">
              {brandAssets.slice(0, 6).map((f) => (
                <button key={f.url} type="button" className="cpd-brand-rail-thumb" onClick={() => onPreviewImageChange(f)}>
                  <img src={cfImageVariants(f.url).src} alt={f.name} />
                </button>
              ))}
            </div>
          ) : (
            <p className="cpd-rail-preview-empty">Drop logos & icons here</p>
          )}
          <span className="cpd-rail-preview-foot">
            {storageScope
              ? `${storagePrefSummary(storageScope, storagePref)} · drop to upload`
              : 'Loading storage…'}
          </span>
        </div>
      </RailSection>

      <RailSection
        title="Cover"
        defaultOpen={false}
        action={
          <button
            type="button"
            className="cpd-icon-btn"
            title="Set cover photo"
            disabled={coverUploading}
            onClick={() => onOpenRailEditor('cover')}
          >
            <ImageIcon size={14} strokeWidth={1.5} />
          </button>
        }
      >
        <button type="button" className="cpd-rail-preview cpd-rail-preview--cover" onClick={() => onOpenRailEditor('cover')}>
          {coverUrl ? (
            <img src={cfImageVariants(coverUrl).src} alt="" className="cpd-rail-cover-thumb" />
          ) : (
            <p className="cpd-rail-preview-empty">Set cover for home & grid previews</p>
          )}
          <span className="cpd-rail-preview-foot">{coverUrl ? 'Click to preview & change' : 'Click to add cover'}</span>
        </button>
      </RailSection>

      <RailSection
        title="Saved context"
        defaultOpen={railDefaultOpen}
        badge={<span className="cpd-rail-badge">Manual</span>}
        action={
          <button
            type="button"
            className="cpd-icon-btn"
            title="Edit saved context"
            onClick={() => onOpenRailEditor('memory')}
          >
            <Pencil size={13} strokeWidth={1.5} />
          </button>
        }
      >
        <RailPreviewCard
          emptyLabel="Optional project context — attach when useful, never injected just because this project is open."
          preview={memory}
          saved={memSaved}
          onOpen={() => onOpenRailEditor('memory')}
        />
      </RailSection>

      <RailSection
        title="Instructions"
        defaultOpen={railDefaultOpen}
        action={
          <button
            type="button"
            className="cpd-icon-btn"
            title="Edit instructions"
            onClick={() => onOpenRailEditor('instructions')}
          >
            <Pencil size={14} strokeWidth={1.5} />
          </button>
        }
      >
        <RailPreviewCard
          emptyLabel="Add instructions to tailor Agent Sam responses…"
          preview={instructions}
          saved={instrSaved}
          onOpen={() => onOpenRailEditor('instructions')}
        />
      </RailSection>

      <RailSection
        title="Files"
        defaultOpen={false}
        action={
          <button
            type="button"
            className="cpd-icon-btn"
            title="Manage files"
            disabled={fileUploading}
            onClick={() => onOpenRailEditor('files')}
          >
            <Plus size={14} strokeWidth={1.5} />
          </button>
        }
      >
        <button type="button" className="cpd-rail-preview" onClick={() => onOpenRailEditor('files')}>
          {projectFiles.length > 0 ? (
            <>
              <p className="cpd-rail-preview-text">
                {projectFiles.length} file{projectFiles.length === 1 ? '' : 's'} attached
                {documentFiles.length > 0 ? ` · ${documentFiles.length} doc${documentFiles.length === 1 ? '' : 's'}` : ''}
                {imageFiles.length > 0 ? ` · ${imageFiles.length} image${imageFiles.length === 1 ? '' : 's'}` : ''}
              </p>
              {imageFiles.length > 0 ? (
                <div className="cpd-rail-files-mini">
                  {imageFiles.slice(0, 4).map((f) => (
                    <img key={f.url} src={cfImageVariants(f.url).src} alt="" />
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="cpd-rail-preview-empty">Drop images, PDFs, or docs for Agent Sam…</p>
          )}
          <span className="cpd-rail-preview-foot">Click to manage files</span>
        </button>
      </RailSection>
    </>
  );
}

/** RailEditorModals + lightbox + brand/cover/file hidden inputs — always mounted by host. */
export function ProjectRailOverlays(props: ProjectRailContentProps): React.JSX.Element {
  const {
    project,
    isMobile,
    projectTodos,
    tasksInsights,
    timerState,
    statsMetric,
    statsPeriod,
    onStatsMetricChange,
    onStatsPeriodChange,
    onToggleProjectTimer,
    onOpenProjectTasks,
    onOpenProjectCalendar,
    clientContact,
    brandAssets,
    brandTokens,
    onBrandTokensChange,
    brandUploading,
    brandDragOver,
    onBrandDragOverChange,
    brandDragDepthRef,
    brandInputRef,
    storageScope,
    onOpenBrandAssetBrowser,
    onAppendBrandAssets,
    onPersistProjectMeta,
    onToast,
    coverUrl,
    coverUploading,
    coverInputRef,
    onCoverPick,
    memBusy,
    memDraft,
    onMemDraftChange,
    onSaveMemoryFromModal,
    instrBusy,
    instrDraft,
    onInstrDraftChange,
    onSaveInstructionsFromModal,
    projectFiles,
    fileUploading,
    fileDragOver,
    onFileDragOverChange,
    fileDragDepthRef,
    fileInputRef,
    onAppendProjectFiles,
    railEditor,
    onCloseRailEditor,
    previewImage,
    onPreviewImageChange,
  } = props;

  const imageFiles = useMemo(
    () => projectFiles.filter((f) => isProjectImageFile(f)),
    [projectFiles],
  );
  const documentFiles = useMemo(
    () => projectFiles.filter((f) => !isProjectImageFile(f)),
    [projectFiles],
  );

  const dropZoneProps = {
    fileDragOver,
    onFileDragOverChange,
    fileDragDepthRef,
    fileUploading,
    fileInputRef,
    onAppendProjectFiles,
  };
  const brandDropProps = {
    brandDragOver,
    onBrandDragOverChange,
    brandDragDepthRef,
    brandUploading,
    brandInputRef,
    onAppendBrandAssets,
    storageScope,
  };

  return (
    <>
      <RailEditorModal
        open={railEditor === 'memory'}
        isMobile={isMobile}
        title="Edit saved project context"
        mobileTitle="Saved context"
        subtitle="Optional human context for facts, decisions, constraints, or blockers that live sources cannot reliably infer. Project scope alone does not inject it."
        saving={memBusy}
        saveLabel="Save context"
        onClose={onCloseRailEditor}
        onSave={() => void onSaveMemoryFromModal()}
      >
        <textarea
          className={`cpd-editor-textarea${isMobile ? ' cpd-editor-textarea--sheet' : ''}`}
          autoFocus
          value={memDraft}
          onChange={(e) => onMemDraftChange(e.target.value)}
          placeholder={PROJECT_MEMORY_PLACEHOLDER}
        />
      </RailEditorModal>

      <RailEditorModal
        open={railEditor === 'instructions'}
        isMobile={isMobile}
        title="Set project instructions"
        mobileTitle="Instructions"
        subtitle="Per-project instructions sync to agentsam_rules_document as rule_{project_id}_runtimecontract. Workspace bindings stay shared; only rules and memory are scoped here."
        saving={instrBusy}
        saveLabel="Save instructions"
        onClose={onCloseRailEditor}
        onSave={() => void onSaveInstructionsFromModal()}
      >
        <textarea
          className={`cpd-editor-textarea${isMobile ? ' cpd-editor-textarea--sheet' : ''}`}
          autoFocus
          value={instrDraft}
          onChange={(e) => onInstrDraftChange(e.target.value)}
          placeholder="AGENTSAM.md required — read before any code, CMS, or deploy work…"
        />
      </RailEditorModal>

      <RailEditorModal
        open={railEditor === 'cover'}
        isMobile={isMobile}
        title="Project cover"
        mobileTitle="Cover"
        subtitle="Shown on the projects grid and home preview for this build."
        showSave={false}
        onClose={onCloseRailEditor}
      >
        <div className="cpd-editor-cover">
          {coverUrl ? (
            <img src={cfImageVariants(coverUrl).src} alt="" className="cpd-editor-cover-img" />
          ) : (
            <div className="cpd-editor-cover-empty">No cover image yet</div>
          )}
          <button
            type="button"
            className="cpd-btn cpd-btn--primary"
            disabled={coverUploading}
            onClick={() => coverInputRef.current?.click()}
          >
            {coverUploading ? 'Uploading…' : coverUrl ? 'Change cover photo' : 'Upload cover photo'}
          </button>
        </div>
      </RailEditorModal>

      <RailEditorModal
        open={railEditor === 'files'}
        isMobile={isMobile}
        title="Project files"
        mobileTitle="Files"
        subtitle="Images, PDFs, and docs attached for Agent Sam and your team."
        showSave={false}
        onClose={onCloseRailEditor}
      >
        {filesDropZone(dropZoneProps, 'cpd-files-drop--modal')}
        {filesGallery(imageFiles, onPreviewImageChange)}
        {filesDocList(documentFiles)}
      </RailEditorModal>

      <RailEditorModal
        open={railEditor === 'stats'}
        isMobile={isMobile}
        title="Quick stats"
        mobileTitle="Stats"
        subtitle={`${project?.name || 'Project'} · ${clientContact?.client_name || project?.client_id || ''}`}
        showSave={false}
        onClose={onCloseRailEditor}
      >
        <ProjectQuickStats
          todos={projectTodos.items}
          todosLoading={projectTodos.loading}
          tasksInsights={tasksInsights}
          timerRunning={timerState.running}
          timerBusy={timerState.busy}
          timerMinutesToday={timerState.minutesToday}
          onToggleTimer={() => void onToggleProjectTimer()}
          onOpenTasks={() => { onCloseRailEditor(); onOpenProjectTasks(); }}
          onOpenCalendar={() => { onCloseRailEditor(); onOpenProjectCalendar(); }}
          metric={statsMetric}
          onMetricChange={onStatsMetricChange}
          period={statsPeriod}
          onPeriodChange={onStatsPeriodChange}
        />
        {clientContact?.payment_notes ? (
          <p className="cpd-insights-contact">{clientContact.payment_notes}</p>
        ) : null}
      </RailEditorModal>

      <RailEditorModal
        open={railEditor === 'brand'}
        isMobile={isMobile}
        title="Brand assets"
        mobileTitle="Brand"
        subtitle={
          storageScope
            ? `Uploads go to ${storageScope.bucket} · ${storageScope.prefix}`
            : 'Logos, icons, and color references for this project.'
        }
        showSave={false}
        onClose={onCloseRailEditor}
      >
        <div className="cpd-brand-token-row">
          <label className="cpd-brand-token-field">
            <span>Primary</span>
            <input
              type="color"
              value={brandTokens.primary_color || '#22d3ee'}
              onChange={(e) => onBrandTokensChange((t) => ({ ...t, primary_color: e.target.value }))}
            />
          </label>
          <label className="cpd-brand-token-field">
            <span>Accent</span>
            <input
              type="color"
              value={brandTokens.accent_color || '#6366f1'}
              onChange={(e) => onBrandTokensChange((t) => ({ ...t, accent_color: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="cpd-btn cpd-btn--ghost sm"
            onClick={async () => {
              if (!project) return;
              const ok = await onPersistProjectMeta({
                brand_tokens: { ...brandTokens, verified_at: Date.now() },
              });
              if (ok) onToast('Brand colors saved');
            }}
          >
            Save colors
          </button>
        </div>
        {brandDropZone(brandDropProps, 'cpd-files-drop--modal')}
        {brandGallery(brandAssets, onPreviewImageChange)}
        <button type="button" className="cpd-btn cpd-btn--ghost cpd-brand-browser-link" onClick={onOpenBrandAssetBrowser}>
          <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
          Open full asset browser
        </button>
      </RailEditorModal>

      <input
        ref={brandInputRef}
        type="file"
        accept="image/*"
        multiple
        className="cpd-hidden-input"
        onChange={(e) => void onAppendBrandAssets(e.target.files)}
      />

      {previewImage ? (
        <div
          className="cpd-lightbox"
          role="dialog"
          aria-label={previewImage.name}
          onClick={() => onPreviewImageChange(null)}
        >
          <button
            type="button"
            className="cpd-lightbox-close"
            aria-label="Close"
            onClick={() => onPreviewImageChange(null)}
          >
            <X size={20} />
          </button>
          <img
            src={cfImageVariants(previewImage.url).src}
            alt={previewImage.name}
            className="cpd-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="cpd-lightbox-caption">{previewImage.name}</p>
        </div>
      ) : null}

      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void onCoverPick(e.target.files)}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => void onAppendProjectFiles(e.target.files)}
      />
    </>
  );
}
