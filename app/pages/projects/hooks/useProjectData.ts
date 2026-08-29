/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Project detail data layer peeled from ProjectDetailPage.tsx (load/save/rail state).
 * Mechanical move only — no behavior change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { deleteProject, fetchProjectMemory, updateProject, updateProjectMemory } from '../../../client-api/projects';
import { uploadProjectBrandAsset, uploadProjectR2File } from '../../../src/lib/projectR2Upload';
import {
  fetchClientProjects,
  fetchTasksInsights,
  fetchTodos,
  postActivityHeartbeat,
  postProjectTimer,
  type AgentTodo,
  type TasksInsightsPayload,
} from '../../launch-desk/ops-desk-types';
import type { ProjectStatsMetric, ProjectStatsPeriod } from '../ProjectQuickStats';
import {
  activateProjectWorkContext,
  readExecutionWorkspaceId,
} from '../../../src/lib/activateProjectWorkContext';
import { chatGithubContextStorageKey } from '../../../components/ChatAssistant/types';
import {
  brandAssetBrowserUrl,
  brandAssetsFromMeta,
  brandTokensFromMeta,
  coverFromMeta,
  listProjectBrandAssetsFromR2,
  mergeBrandAssetLists,
  parseProjectMeta,
  projectFilesFromMeta,
  resolveProjectStorageScope,
  type BrandTokens,
  type ProjectFileRef,
  type ProjectStorageScope,
} from '../projectDetailMeta';
import { defaultProjectMemoryDraft } from '../projectMemoryTemplate';
import {
  fetchProjectWorkContextBindings,
  readProjectStoragePref,
  writeProjectStoragePref,
  type ProjectStoragePref,
  type ProjectWorkContextBindings,
} from '../projectStoragePreferences';
import { useProjectCodeIndex } from '../code-index/useProjectCodeIndex';
import { resumeAgentChatSession } from '../../../lib/openAgentConversation';
import { writeSessionProject } from '../../../src/lib/freshChatSession';
import { IAM_AGENT_CHAT_CONVERSATION_CHANGE } from '../../../agentChatConstants';
import type { RailEditorKind } from '../rail/ProjectRailEditors';

export interface Project {
  id: string;
  name: string;
  description?: string;
  status?: string;
  status_raw?: string;
  priority?: number;
  priority_num?: number;
  project_type?: string;
  health?: number;
  progress?: number;
  activeTasks?: number;
  totalTasks?: number;
  completedTasks?: number;
  chat_project_id?: string | null;
  workspace_id?: string | null;
  client_id?: string | null;
  domain?: string | null;
  worker_id?: string | null;
  metadata_json?: string | null;
  cover_image_url?: string | null;
  r2_buckets?: string | null;
}

interface ProjectTimerState {
  loading: boolean;
  running: boolean;
  minutesToday: number;
  busy: boolean;
}

interface ClientContactRow {
  client_name?: string | null;
  payment_notes?: string | null;
  client_id?: string | null;
}

interface ProjectTaskStats {
  open: number;
  loading: boolean;
}

interface ProjectTodosState {
  items: AgentTodo[];
  loading: boolean;
}

export interface ChatSession {
  conversation_id?: string;
  id?: string;
  title?: string;
  updated_at?: number | string;
  last_turn_status?: string;
  project_id?: string;
}

export type UseProjectDataParams = {
  projectId: string | undefined;
  workspaceId: string | null | undefined;
  sessionUserId: string | null | undefined;
  switchWorkspace: (
    id: string,
    meta?: { displayName?: string; slug?: string; github_repo?: string | null; sync?: boolean },
  ) => Promise<void>;
  persistGithubRepo: (repoFullName: string, workspaceIdOverride?: string | null) => Promise<void>;
  navigate: NavigateFunction;
  isMobile: boolean;
  railOpen: boolean;
  setRailOpen: (open: boolean) => void;
};

export function useProjectData({
  projectId,
  workspaceId,
  sessionUserId,
  switchWorkspace,
  persistGithubRepo,
  navigate,
  isMobile,
  railOpen,
  setRailOpen,
}: UseProjectDataParams) {
  const activateRef = useRef<string | null>(null);

  const [executionWorkspaceId, setExecutionWorkspaceId] = useState<string | null>(() => readExecutionWorkspaceId());
  const [project, setProject] = useState<Project | null>(null);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [loadingProject, setLoadingProject] = useState(true);
  const [loadingChats, setLoadingChats] = useState(true);

  // rename
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  // right rail edit states
  const [instructions, setInstructions] = useState('');
  const [instrSaved, setInstrSaved] = useState(false);
  const [instrBusy, setInstrBusy] = useState(false);
  const [memory, setMemory] = useState('');
  const [memSaved, setMemSaved] = useState(false);
  const [memBusy, setMemBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const onCodeIndexToast = useCallback((message: string) => {
    setToast(message);
  }, []);
  const codeIndexApi = useProjectCodeIndex({ projectId, onToast: onCodeIndexToast });
  const { loadCodeIndex } = codeIndexApi;
  const [projectFiles, setProjectFiles] = useState<ProjectFileRef[]>([]);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [fileUploading, setFileUploading] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [previewImage, setPreviewImage] = useState<ProjectFileRef | null>(null);
  const [taskStats, setTaskStats] = useState<ProjectTaskStats>({ open: 0, loading: true });
  const [projectTodos, setProjectTodos] = useState<ProjectTodosState>({ items: [], loading: true });
  const [tasksInsights, setTasksInsights] = useState<TasksInsightsPayload | null>(null);
  const [statsMetric, setStatsMetric] = useState<ProjectStatsMetric>('time');
  const [statsPeriod, setStatsPeriod] = useState<ProjectStatsPeriod>('week');
  const [timerState, setTimerState] = useState<ProjectTimerState>({
    loading: true,
    running: false,
    minutesToday: 0,
    busy: false,
  });
  const [brandAssets, setBrandAssets] = useState<ProjectFileRef[]>([]);
  const [brandTokens, setBrandTokens] = useState<BrandTokens>({});
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandUploading, setBrandUploading] = useState(false);
  const [brandDragOver, setBrandDragOver] = useState(false);
  const [storageScope, setStorageScope] = useState<ProjectStorageScope | null>(null);
  const [storagePref, setStoragePref] = useState<ProjectStoragePref | null>(null);
  const [storageDraft, setStorageDraft] = useState<ProjectStoragePref>({ source: 'auto' });
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageMenuOpen, setStorageMenuOpen] = useState(false);
  const [storageAdvancedOpen, setStorageAdvancedOpen] = useState(false);
  const [workContextBindings, setWorkContextBindings] = useState<ProjectWorkContextBindings | null>(null);
  const storageAnchorRef = useRef<HTMLDivElement | null>(null);
  const [clientContact, setClientContact] = useState<ClientContactRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [railEditor, setRailEditor] = useState<RailEditorKind | null>(null);
  const [memDraft, setMemDraft] = useState('');
  const [instrDraft, setInstrDraft] = useState('');
  const brandDragDepthRef = useRef(0);
  const brandInputRef = useRef<HTMLInputElement>(null);
  const fileDragDepthRef = useRef(0);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── load project ──
  const loadProject = useCallback(async () => {
    if (!projectId) return;
    setLoadingProject(true);
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        credentials: 'same-origin',
      });
      if (!r.ok) { navigate('/dashboard/projects', { replace: true }); return; }
      const data = await r.json();
      const p: Project = data.project ?? data;
      setProject(p);
      setRenameDraft(p.name ?? '');
      setProjectFiles(projectFilesFromMeta(p.metadata_json));
      setCoverUrl(p.cover_image_url || coverFromMeta(p.metadata_json));
      setBrandTokens(brandTokensFromMeta(p.metadata_json));
      const pref = readProjectStoragePref(p.id);
      setStoragePref(pref);
      const bindings = await fetchProjectWorkContextBindings(p.id);
      setWorkContextBindings(bindings);
      setStorageScope(
        resolveProjectStorageScope(p, { pref, bindings: bindings ?? undefined }),
      );

      if (activateRef.current !== projectId) {
        activateRef.current = projectId;
        void activateProjectWorkContext(p.id, p.name || p.id, {
          switchWorkspace,
          persistGithubRepo,
          currentWorkspaceId: workspaceId,
          githubContextStorageKey: chatGithubContextStorageKey(
            sessionUserId,
            p.workspace_id || workspaceId,
            '',
          ),
        }).then((res) => {
          if (res.ok && res.executionWorkspaceId) {
            setExecutionWorkspaceId(res.executionWorkspaceId);
          }
        });
      }
    } catch {
      navigate('/dashboard/projects', { replace: true });
    } finally {
      setLoadingProject(false);
    }
  }, [projectId, navigate, switchWorkspace, persistGithubRepo, workspaceId, sessionUserId]);

  // ── load chats ──
  const loadChats = useCallback(async () => {
    if (!projectId) return;
    setLoadingChats(true);
    try {
      const ws =
        executionWorkspaceId ||
        project?.workspace_id ||
        workspaceId ||
        readExecutionWorkspaceId();
      const params = new URLSearchParams({ limit: '200', project_id: projectId });
      if (ws) params.set('workspace_id', ws);
      const r = await fetch(`/api/agent/sessions?${params}`, { credentials: 'same-origin' });
      const rows: ChatSession[] = r.ok ? await r.json() : [];
      setChats(rows);
    } catch {
      setChats([]);
    } finally {
      setLoadingChats(false);
    }
  }, [projectId, executionWorkspaceId, project?.workspace_id, workspaceId]);

  useEffect(() => { void loadProject(); }, [loadProject]);
  useEffect(() => { void loadChats(); }, [loadChats]);

  useEffect(() => {
    const onConv = () => {
      void loadChats();
      window.setTimeout(() => void loadChats(), 1200);
      window.setTimeout(() => void loadChats(), 3200);
    };
    window.addEventListener(IAM_AGENT_CHAT_CONVERSATION_CHANGE, onConv);
    return () => window.removeEventListener(IAM_AGENT_CHAT_CONVERSATION_CHANGE, onConv);
  }, [loadChats]);

  const loadMemory = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetchProjectMemory(projectId);
      if (res.ok) {
        setMemory(res.memory ?? '');
        setInstructions(res.instructions ?? '');
        setMemSaved(true);
        setInstrSaved(true);
      }
    } catch {
      /* optional */
    }
  }, [projectId]);

  useEffect(() => { void loadMemory(); }, [loadMemory]);

  const loadTaskStats = useCallback(async () => {
    if (!projectId) return;
    setTaskStats((s) => ({ ...s, loading: true }));
    setProjectTodos((s) => ({ ...s, loading: true }));
    try {
      const todos = await fetchTodos({ projectId });
      setProjectTodos({ items: todos, loading: false });
      setTaskStats({ open: todos.length, loading: false });
      const insights = await fetchTasksInsights(new Date(), projectId);
      setTasksInsights(insights);
    } catch {
      setProjectTodos({ items: [], loading: false });
      setTaskStats({ open: 0, loading: false });
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void loadTaskStats();
  }, [projectId, loadTaskStats]);

  const loadTimerState = useCallback(async () => {
    if (!projectId) return;
    setTimerState((s) => ({ ...s, loading: true }));
    try {
      const data = await fetchTasksInsights(new Date(), projectId);
      setTimerState({
        loading: false,
        running: Boolean(data.project_active_tracking),
        minutesToday: Number(data.project_today_minutes || 0),
        busy: false,
      });
    } catch {
      setTimerState((s) => ({ ...s, loading: false }));
    }
  }, [projectId]);

  useEffect(() => {
    void loadTimerState();
  }, [loadTimerState]);

  useEffect(() => {
    if (!timerState.running || !projectId) return;
    const tick = window.setInterval(() => {
      void postActivityHeartbeat({ project_id: projectId, surface: 'project_detail' }).catch(() => null);
      void loadTimerState();
    }, 60_000);
    return () => window.clearInterval(tick);
  }, [timerState.running, projectId, loadTimerState]);

  const loadBrandAssets = useCallback(async () => {
    if (!project) return;
    setBrandLoading(true);
    try {
      const scope = resolveProjectStorageScope(project);
      setStorageScope(scope);
      const fromR2 = await listProjectBrandAssetsFromR2(scope);
      const fromMeta = brandAssetsFromMeta(project.metadata_json);
      setBrandAssets(mergeBrandAssetLists(fromR2, fromMeta));
    } catch {
      setBrandAssets(brandAssetsFromMeta(project.metadata_json));
    } finally {
      setBrandLoading(false);
    }
  }, [project]);

  useEffect(() => {
    if (!project) return;
    void loadBrandAssets();
  }, [project, loadBrandAssets]);

  const loadClientContact = useCallback(async () => {
    const clientId = project?.client_id?.trim();
    if (!clientId) {
      setClientContact(null);
      return;
    }
    try {
      const clients = await fetchClientProjects();
      const row = clients.find((c) => String(c.client_id || '') === clientId);
      setClientContact(
        row
          ? {
              client_name: row.client_name,
              payment_notes: row.payment_notes,
              client_id: row.client_id,
            }
          : { client_id: clientId },
      );
    } catch {
      setClientContact({ client_id: clientId });
    }
  }, [project?.client_id]);

  useEffect(() => {
    void loadClientContact();
  }, [loadClientContact]);

  const refreshProjectContext = async () => {
    if (!project || refreshing) return;
    setRefreshing(true);
    try {
      activateRef.current = null;
      await Promise.all([
        loadProject(),
        loadMemory(),
        loadChats(),
        loadTaskStats(),
        loadTimerState(),
        loadBrandAssets(),
        loadClientContact(),
        loadCodeIndex(),
      ]);
      setToast('Project context refreshed');
    } finally {
      setRefreshing(false);
    }
  };

  const toggleProjectTimer = async () => {
    if (!project || timerState.busy) return;
    setTimerState((s) => ({ ...s, busy: true }));
    try {
      const action = timerState.running ? 'stop' : 'start';
      const res = await postProjectTimer({ action, project_id: project.id });
      if (!res.ok) {
        setToast(res.error || 'Timer update failed');
        return;
      }
      await loadTimerState();
      setToast(action === 'start' ? 'Timer started' : 'Timer stopped');
    } finally {
      setTimerState((s) => ({ ...s, busy: false }));
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!previewImage && !railEditor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (previewImage) setPreviewImage(null);
        else if (railEditor) setRailEditor(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewImage, railEditor]);

  useEffect(() => {
    const lockScroll = Boolean(railEditor || (isMobile && railOpen));
    document.body.style.overflow = lockScroll ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [railEditor, isMobile, railOpen]);

  const openRailEditor = (kind: RailEditorKind) => {
    if (kind === 'memory') {
      setMemDraft(
        memory.trim()
          ? memory
          : defaultProjectMemoryDraft(project?.name, project?.id),
      );
    }
    if (kind === 'instructions') setInstrDraft(instructions);
    setRailEditor(kind);
    if (isMobile) setRailOpen(false);
  };

  const closeRailEditor = () => setRailEditor(null);

  // ── save rename ──
  const saveRename = async () => {
    if (!project || renameBusy) return;
    const name = renameDraft.trim();
    if (!name || name === project.name) { setRenaming(false); return; }
    setRenameBusy(true);
    try {
      await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setRenaming(false);
      await loadProject();
    } finally {
      setRenameBusy(false);
    }
  };

  const saveMemory = async (nextMemory?: string) => {
    if (!project || memBusy) return false;
    const value = nextMemory !== undefined ? nextMemory : memory;
    setMemBusy(true);
    try {
      const res = await updateProjectMemory(project.id, { memory: value });
      if (res.ok) {
        setMemory(value);
        setMemSaved(true);
        return true;
      }
      setToast(res.error || 'Failed to save memory');
      return false;
    } finally {
      setMemBusy(false);
    }
  };

  const saveInstructions = async (nextInstructions?: string) => {
    if (!project || instrBusy) return false;
    const value = nextInstructions !== undefined ? nextInstructions : instructions;
    setInstrBusy(true);
    try {
      const res = await updateProjectMemory(project.id, { instructions: value });
      if (res.ok) {
        setInstructions(value);
        setInstrSaved(true);
        const sync = res.runtime_contract_sync;
        if (sync?.ok) {
          const key = sync.rule_key || 'runtime contract';
          setToast(sync.unchanged ? `Instructions saved · ${key} unchanged` : `Instructions saved · synced ${key}`);
        } else if (sync && !sync.ok) {
          setToast(`Saved instructions; rule sync failed: ${sync.error || 'unknown'}`);
        } else {
          setToast('Instructions saved');
        }
        return true;
      }
      setToast(res.error || 'Failed to save instructions');
      return false;
    } finally {
      setInstrBusy(false);
    }
  };

  const saveMemoryFromModal = async () => {
    const ok = await saveMemory(memDraft);
    if (ok) closeRailEditor();
  };

  const toggleStorageMenu = async () => {
    if (storageMenuOpen) {
      closeStorageMenu();
      return;
    }
    if (!project?.id) return;
    setStorageDraft(storagePref ?? { source: 'auto' });
    setStorageAdvancedOpen(false);
    setStorageMenuOpen(true);
    const bindings = await fetchProjectWorkContextBindings(project.id);
    setWorkContextBindings(bindings);
    setStorageScope(
      resolveProjectStorageScope(project, {
        pref: storagePref,
        bindings: bindings ?? undefined,
      }),
    );
  };

  const closeStorageMenu = () => {
    setStorageMenuOpen(false);
    setStorageAdvancedOpen(false);
  };

  const saveStoragePrefFromMenu = async () => {
    if (!project?.id || storageBusy) return;
    setStorageBusy(true);
    try {
      writeProjectStoragePref(project.id, storageDraft);
      setStoragePref({ ...storageDraft });
      const bindings = await fetchProjectWorkContextBindings(project.id);
      setWorkContextBindings(bindings);
      setStorageScope(
        resolveProjectStorageScope(project, {
          pref: storageDraft,
          bindings: bindings ?? undefined,
        }),
      );
      setToast('Storage preferences saved (this browser)');
      closeStorageMenu();
    } finally {
      setStorageBusy(false);
    }
  };

  const saveInstructionsFromModal = async () => {
    const ok = await saveInstructions(instrDraft);
    if (ok) closeRailEditor();
  };

  const persistProjectMeta = async (patch: Record<string, unknown>) => {
    if (!project) return false;
    const meta = { ...parseProjectMeta(project.metadata_json), ...patch };
    const res = await updateProject(project.id, { metadata_json: JSON.stringify(meta) });
    if (!res.ok) {
      setToast(res.error || 'Update failed');
      return false;
    }
    setProject((prev) => (prev ? { ...prev, metadata_json: JSON.stringify(meta) } : prev));
    return true;
  };

  const saveCoverUrl = async (url: string) => {
    const ok = await persistProjectMeta({ cover_image_url: url });
    if (ok) {
      setCoverUrl(url);
      setToast('Cover updated — home preview will use this image');
    }
  };

  const handleCoverPick = async (files: FileList | null) => {
    if (!project) return;
    const file = files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      setToast('Choose an image file');
      return;
    }
    setCoverUploading(true);
    try {
      const out = await uploadProjectR2File(
        project.id,
        file,
        'cover',
        project.workspace_id || workspaceId,
      );
      if (!out.ok || !out.url) {
        setToast(out.error || 'Cover upload failed');
        return;
      }
      await saveCoverUrl(out.url);
    } finally {
      setCoverUploading(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  const appendProjectFiles = async (files: FileList | File[] | null) => {
    if (!project) return;
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    const wsForUpload = (project.workspace_id || workspaceId || '').trim() || null;
    const scope = resolveProjectStorageScope(project);
    const useClientStorage = scope.source === 'client_r2';
    setFileUploading(true);
    try {
      const added: ProjectFileRef[] = [];
      for (const file of list) {
        const out = await uploadProjectR2File(project.id, file, 'files', wsForUpload, {
          bucket: useClientStorage ? scope.bucket : undefined,
          keyPrefix: useClientStorage ? `projects/${project.id}/files/` : undefined,
          forceR2: useClientStorage,
        });
        if (!out.ok || !out.url) {
          setToast(out.error || `Upload failed: ${file.name}`);
          break;
        }
        added.push({
          name: file.name,
          url: out.url,
          uploaded_at: Date.now(),
          kind: file.type.startsWith('image/') ? 'image' : 'document',
          r2_bucket: out.key ? scope.bucket : undefined,
          r2_key: out.key,
        });
      }
      if (!added.length) return;
      const next = [...added, ...projectFiles];
      const ok = await persistProjectMeta({ project_files: next });
      if (ok) {
        setProjectFiles(next);
        setToast(added.length === 1 ? 'File added' : `${added.length} files added`);
      }
    } finally {
      setFileUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openProjectTasks = () => {
    if (!project) return;
    const clientId = project.client_id?.trim();
    if (clientId) {
      navigate(`/dashboard/collaborate?seg=tickets&client=${encodeURIComponent(clientId)}`);
      return;
    }
    navigate(`/dashboard/collaborate?seg=tickets&project=${encodeURIComponent(project.id)}`);
  };

  const openProjectCalendar = () => {
    if (!project) return;
    const clientId = project.client_id?.trim();
    if (clientId) {
      navigate(`/dashboard/collaborate?seg=calendar&client=${encodeURIComponent(clientId)}`);
      return;
    }
    navigate(`/dashboard/collaborate?seg=calendar&project=${encodeURIComponent(project.id)}`);
  };

  const openBrandAssetBrowser = () => {
    if (!project) return;
    const scope = storageScope || resolveProjectStorageScope(project);
    navigate(brandAssetBrowserUrl(scope));
  };

  const appendBrandAssets = async (files: FileList | File[] | null) => {
    if (!project) return;
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    const scope = storageScope || resolveProjectStorageScope(project);
    setBrandUploading(true);
    try {
      const added: ProjectFileRef[] = [];
      for (const file of list) {
        if (!file.type.startsWith('image/')) {
          setToast('Brand assets must be images (PNG, SVG, WebP…)');
          continue;
        }
        const out = await uploadProjectBrandAsset(file, scope);
        if (!out.ok || !out.url) {
          setToast(out.error || `Upload failed: ${file.name}`);
          break;
        }
        added.push({
          name: file.name,
          url: out.url,
          uploaded_at: Date.now(),
          kind: 'image',
          r2_bucket: scope.bucket,
          r2_key: out.key,
        });
      }
      if (!added.length) return;
      const metaAssets = brandAssetsFromMeta(project.metadata_json);
      const nextMetaAssets = [...added, ...metaAssets].slice(0, 24);
      await persistProjectMeta({ brand_assets: nextMetaAssets });
      setBrandAssets(mergeBrandAssetLists([...added, ...brandAssets], nextMetaAssets));
      setToast(added.length === 1 ? 'Brand asset added' : `${added.length} brand assets added`);
      void loadBrandAssets();
    } finally {
      setBrandUploading(false);
      if (brandInputRef.current) brandInputRef.current.value = '';
    }
  };

  const submitDelete = async () => {
    if (!project?.id || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const res = await deleteProject(project.id);
      if (res.ok) {
        navigate('/dashboard/projects', { replace: true });
        return;
      }
      setToast(res.error || 'Delete failed');
      setDeleteOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  // ── project-scoped chat (stay on page — context via attachments + project memory) ──
  const projectChatId = project?.id || projectId || '';

  const resumeChat = (s: ChatSession) => {
    const id = s.conversation_id ?? s.id ?? '';
    if (!id || !project) return;
    writeSessionProject({ id: projectChatId, name: project.name }, { explicit: false });
    resumeAgentChatSession({ id, title: s.title || 'Chat', force: true });
  };

  return {
    project,
    setProject,
    chats,
    loadingProject,
    loadingChats,
    renaming,
    setRenaming,
    renameDraft,
    setRenameDraft,
    renameBusy,
    instructions,
    instrSaved,
    instrBusy,
    memory,
    memSaved,
    memBusy,
    shareOpen,
    setShareOpen,
    deleteOpen,
    setDeleteOpen,
    deleteBusy,
    toast,
    setToast,
    codeIndexApi,
    projectFiles,
    coverUrl,
    fileUploading,
    coverUploading,
    fileDragOver,
    setFileDragOver,
    previewImage,
    setPreviewImage,
    taskStats,
    projectTodos,
    tasksInsights,
    statsMetric,
    setStatsMetric,
    statsPeriod,
    setStatsPeriod,
    timerState,
    brandAssets,
    brandTokens,
    setBrandTokens,
    brandLoading,
    brandUploading,
    brandDragOver,
    setBrandDragOver,
    storageScope,
    storagePref,
    storageDraft,
    setStorageDraft,
    storageBusy,
    storageMenuOpen,
    storageAdvancedOpen,
    setStorageAdvancedOpen,
    workContextBindings,
    storageAnchorRef,
    clientContact,
    refreshing,
    railEditor,
    memDraft,
    setMemDraft,
    instrDraft,
    setInstrDraft,
    brandDragDepthRef,
    brandInputRef,
    fileDragDepthRef,
    coverInputRef,
    fileInputRef,
    executionWorkspaceId,
    loadProject,
    loadChats,
    loadMemory,
    loadTaskStats,
    loadTimerState,
    loadBrandAssets,
    loadClientContact,
    refreshProjectContext,
    toggleProjectTimer,
    openRailEditor,
    closeRailEditor,
    saveRename,
    saveMemory,
    saveInstructions,
    saveMemoryFromModal,
    saveInstructionsFromModal,
    toggleStorageMenu,
    closeStorageMenu,
    saveStoragePrefFromMenu,
    persistProjectMeta,
    saveCoverUrl,
    handleCoverPick,
    appendProjectFiles,
    openProjectTasks,
    openProjectCalendar,
    openBrandAssetBrowser,
    appendBrandAssets,
    submitDelete,
    projectChatId,
    resumeChat,
  };
}
