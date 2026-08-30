import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AudioLines,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderKanban,
  Globe,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Plus,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import type { ConnectorCatalogRow } from '../../client-api/connectorsCatalog';
import { resolveIntegrationIconUrl } from '../../src/lib/resolveIntegrationIconUrl';
import type { ChatComposerSource } from './composer/types';
import { WEB_SEARCH_SOURCE, WEB_SEARCH_SOURCE_ID, SANDBOX_AGENT_SOURCE_ID } from './composer/types';
import { GithubContextLane } from './GithubContextLane';
import type { ExecLane } from '../../src/lib/execLane';
import { EXEC_LANE_LABELS, EXEC_LANE_DESCRIPTIONS } from '../../src/lib/execLane';
import { openIntegrationOAuthPopup } from '../../src/lib/integrationOAuthPopup';
import {
  connectorComposerSource,
  isConnectorSessionEnabled,
} from '../../src/lib/connectorComposerSource';
import {
  readSessionEnabledConnectors,
  toggleSessionConnector,
  readSessionEnabledTools,
  toggleSessionTool,
  seedSessionToolsForProvider,
  isSessionToolEnabled,
  readSessionProject,
  writeSessionProject,
  type SessionProject,
} from '../../src/lib/freshChatSession';
import { setPendingProjectBind } from '../../lib/pendingProjectBind';
import { useConnectorsCatalog } from './hooks/useConnectorsCatalog';
import { AppIcon, type AppIconStatus } from '../ui/AppIcon';
import {
  loadVoicePrefs,
  REALTIME_VOICE_OPTIONS,
  saveVoicePrefs,
  VOICE_PERSONAS,
  type RealtimeVoiceId,
  type VoicePersonaId,
  type VoicePrefs,
} from './composer/voiceOptions';
import '../ui/AppIcon.css';

export type ContextHubLane =
  | 'hub'
  | 'github'
  | 'connectors'
  | 'connector_detail'
  | 'tool_access'
  | 'voice'
  | 'project';

export type ContextHubDrawerProps = {
  open: boolean;
  onClose: () => void;
  initialLane?: ContextHubLane;
  workspaceId: string | null | undefined;
  githubRepoContext: string | null;
  githubFilePath?: string | null;
  pinnedLabel?: string;
  onClearPinned?: () => void;
  onSelectRepo: (fullName: string) => void;
  onSelectFile?: (
    repo: string,
    path: string,
    branch: string,
    meta?: { content?: string | null; contentSha?: string | null; contentTruncated?: boolean },
  ) => void;
  onBrowseFiles?: (fullName: string) => void;
  activeSourceIds: Set<string>;
  webSearchAllowed: boolean;
  sandboxAgentAllowed?: boolean;
  onUploadFile: () => void;
  onUploadImage: () => void;
  onToggleWebSearch: () => void;
  onToggleSandboxAgent?: () => void;
  onToggleSource: (source: ChatComposerSource, enabled: boolean) => void;
  execLane: ExecLane | null;
  onExecLaneChange: (lane: ExecLane) => void;
  focusConnectorKey?: string | null;
  onSessionContextChange?: () => void;
};

type ProjectOption = { id: string; name: string; chat_project_id?: string | null };

const SOURCE_TILES = [
  {
    id: 'local',
    label: 'Local',
    icon: HardDrive,
    accent: 'var(--solar-cyan)',
    lane: 'hub' as const,
    action: 'files' as const,
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    lane: 'connectors' as const,
    focusProvider: 'cloudflare_oauth',
  },
  {
    id: 'github',
    label: 'GitHub',
    lane: 'github' as const,
    focusProvider: 'github',
  },
  {
    id: 'drive',
    label: 'Drive',
    lane: 'connectors' as const,
    focusProvider: 'google_drive',
  },
] as const;

function sourceTileIconUrl(
  tile: (typeof SOURCE_TILES)[number],
  connectors: ConnectorCatalogRow[],
): string | null {
  const providerKey =
    'focusProvider' in tile && tile.focusProvider ? String(tile.focusProvider) : tile.id;
  const row = connectors.find((c) => c.provider_key === providerKey);
  return resolveIntegrationIconUrl(row?.provider_key || providerKey, row?.icon_url, row?.icon_slug);
}

function iconStatusForConnector(row: ConnectorCatalogRow): AppIconStatus | null {
  if (row.issue === 'error') return 'error';
  if (row.issue === 'warning') return 'warning';
  return row.connected ? 'ok' : null;
}

function connectorSubtitle(row: ConnectorCatalogRow): string {
  if (row.connected && row.account_display) return row.account_display;
  if (row.tool_count > 0) return `${row.tool_count} tool${row.tool_count === 1 ? '' : 's'}`;
  return row.kind === 'mcp_remote' ? 'MCP OAuth' : 'OAuth API';
}

export function ContextHubDrawer({
  open,
  onClose,
  initialLane = 'hub',
  workspaceId,
  githubRepoContext,
  githubFilePath = null,
  pinnedLabel,
  onClearPinned,
  onSelectRepo,
  onSelectFile,
  onBrowseFiles,
  activeSourceIds,
  webSearchAllowed,
  sandboxAgentAllowed = true,
  onUploadFile,
  onUploadImage,
  onToggleWebSearch,
  onToggleSandboxAgent,
  onToggleSource,
  execLane,
  onExecLaneChange,
  focusConnectorKey = null,
  onSessionContextChange,
}: ContextHubDrawerProps) {
  const [lane, setLane] = useState<ContextHubLane>(initialLane);
  const [connectorFilter, setConnectorFilter] = useState('');
  const [connectBusy, setConnectBusy] = useState<string | null>(null);
  const [selectedConnectorKey, setSelectedConnectorKey] = useState<string | null>(null);
  const [detailTools, setDetailTools] = useState<
    { tool_key: string; label: string; description: string | null; enabled: boolean }[]
  >([]);
  const [detailToolsLoading, setDetailToolsLoading] = useState(false);
  const [sessionConnectorKeys, setSessionConnectorKeys] = useState<Set<string>>(
    () => new Set(readSessionEnabledConnectors()),
  );
  const [sessionToolsRevision, setSessionToolsRevision] = useState(0);
  const [sessionProject, setSessionProject] = useState<SessionProject>(() => readSessionProject());
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectFilter, setProjectFilter] = useState('');
  const [voicePrefs, setVoicePrefs] = useState<VoicePrefs>(() => loadVoicePrefs());

  const { loading: catalogLoading, connectors, connectedCount, refresh, loadTools } =
    useConnectorsCatalog(workspaceId);

  useEffect(() => {
    if (open) {
      setLane(initialLane);
      setSessionConnectorKeys(new Set(readSessionEnabledConnectors()));
      setSessionProject(readSessionProject());
      setVoicePrefs(loadVoicePrefs());
      if (focusConnectorKey?.trim()) {
        setSelectedConnectorKey(focusConnectorKey.trim());
        if (initialLane === 'connectors') setLane('connector_detail');
      }
    }
  }, [open, initialLane, focusConnectorKey]);

  useEffect(() => {
    saveVoicePrefs(voicePrefs);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('iam:composer-voice-prefs-changed'));
    }
  }, [voicePrefs]);

  useEffect(() => {
    if (!open || lane !== 'project') return;
    setProjectsLoading(true);
    void fetch('/api/projects', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : rows?.projects || [];
        setProjects(
          list
            .map((p: ProjectOption) => ({
              id: String(p.id || '').trim(),
              name: String(p.name || 'Project').trim(),
              chat_project_id: p.chat_project_id ? String(p.chat_project_id).trim() : null,
            }))
            .filter((p: ProjectOption) => p.id),
        );
      })
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoading(false));
  }, [open, lane]);

  useEffect(() => {
    if (!open) {
      setLane('hub');
      setConnectorFilter('');
      setSelectedConnectorKey(null);
      setDetailTools([]);
    }
  }, [open]);

  useEffect(() => {
    const onOAuth = () => void refresh();
    window.addEventListener('iam_oauth_done', onOAuth);
    window.addEventListener('oauth_success', onOAuth);
    return () => {
      window.removeEventListener('iam_oauth_done', onOAuth);
      window.removeEventListener('oauth_success', onOAuth);
    };
  }, [refresh]);

  const selectedConnector = useMemo(
    () => connectors.find((c) => c.provider_key === selectedConnectorKey) || null,
    [connectors, selectedConnectorKey],
  );

  const filteredConnectors = useMemo(() => {
    const q = connectorFilter.trim().toLowerCase();
    if (!q) return connectors;
    return connectors.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.provider_key.toLowerCase().includes(q) ||
        (c.account_display || '').toLowerCase().includes(q),
    );
  }, [connectors, connectorFilter]);

  const openConnectorDetail = useCallback(
    async (row: ConnectorCatalogRow) => {
      setSelectedConnectorKey(row.provider_key);
      setLane('connector_detail');
      setDetailToolsLoading(true);
      try {
        const tools = await loadTools(row.provider_key);
        setDetailTools(tools);
      } finally {
        setDetailToolsLoading(false);
      }
    },
    [loadTools],
  );

  const toggleConnectorForSession = useCallback(
    (row: ConnectorCatalogRow, enabled: boolean, allToolKeys: string[] = []) => {
      if (row.provider_key === 'web_search') {
        onToggleSource(WEB_SEARCH_SOURCE, enabled);
        const next = toggleSessionConnector('web_search', enabled);
        setSessionConnectorKeys(new Set(next));
        if (enabled && allToolKeys.length) seedSessionToolsForProvider('web_search', allToolKeys);
        setSessionToolsRevision((n) => n + 1);
        onSessionContextChange?.();
        return;
      }
      const src = connectorComposerSource(row);
      onToggleSource(src, enabled);
      const next = toggleSessionConnector(row.provider_key, enabled);
      setSessionConnectorKeys(new Set(next));
      if (enabled && allToolKeys.length) seedSessionToolsForProvider(row.provider_key, allToolKeys);
      setSessionToolsRevision((n) => n + 1);
      onSessionContextChange?.();
    },
    [onToggleSource, onSessionContextChange],
  );

  const bumpToolToggle = useCallback(
    (providerKey: string, toolKey: string, enabled: boolean) => {
      toggleSessionTool(providerKey, toolKey, enabled);
      if (enabled && !sessionConnectorKeys.has(providerKey)) {
        setSessionConnectorKeys(new Set(toggleSessionConnector(providerKey, true)));
      }
      setSessionToolsRevision((n) => n + 1);
      onSessionContextChange?.();
    },
    [sessionConnectorKeys, onSessionContextChange],
  );

  const filteredProjects = useMemo(() => {
    const q = projectFilter.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, projectFilter]);

  if (!open || typeof document === 'undefined') return null;

  const closeAll = () => onClose();

  /**
   * iOS Safari cancels `<input type="file">.click()` when the opening sheet
   * unmounts in the same turn. Keep the hub mounted briefly after the click.
   */
  const openPickerThenClose = (openPicker: () => void) => {
    openPicker();
    window.setTimeout(() => closeAll(), 400);
  };

  const runOAuthConnect = async (row: ConnectorCatalogRow, forceReauth = false) => {
    if (!forceReauth && row.connected) return;
    if (!row.connect_url) return;
    const url = row.connect_url;
    if (!url.startsWith('/')) {
      setConnectBusy(row.provider_key);
      try {
        const result = await openIntegrationOAuthPopup(url, row.provider_key);
        if (result.ok) await refresh();
      } finally {
        setConnectBusy(null);
      }
      return;
    }
    setConnectBusy(row.provider_key);
    try {
      const result = await openIntegrationOAuthPopup(url, row.provider_key);
      if (result.ok) await refresh();
    } finally {
      setConnectBusy(null);
    }
  };

  const hubHeaderTitle =
    lane === 'github'
      ? 'GitHub'
      : lane === 'connectors'
        ? 'Connectors'
        : lane === 'connector_detail'
          ? selectedConnector?.title || 'Connector'
          : lane === 'project'
            ? 'Add to project'
          : lane === 'tool_access'
            ? 'Tool access'
          : lane === 'voice'
            ? 'Voice'
            : 'Add to context';

  const sheet = (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[118] bg-black/45"
        aria-label="Close context hub"
        onClick={closeAll}
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[119] flex flex-col rounded-t-2xl border-t border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] shadow-[0_-8px_32px_rgba(0,0,0,0.35)]"
        style={{
          height: 'min(92dvh, calc(100dvh - env(safe-area-inset-top, 0px) - 1.5rem))',
          maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 1.5rem)',
          paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Context hub"
      >
        <div className="flex shrink-0 flex-col items-center pt-2 pb-1">
          <div className="h-1.5 w-10 rounded-full bg-[var(--dashboard-border)]" aria-hidden />
        </div>

        {lane !== 'github' ? (
          <div className="shrink-0 flex items-center justify-between gap-2 border-b border-[var(--dashboard-border)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              {lane === 'connector_detail' ? (
                <button
                  type="button"
                  aria-label="Back to connectors"
                  onClick={() => setLane('connectors')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--dashboard-muted)] hover:bg-[var(--bg-hover)]"
                >
                  <ChevronLeft size={18} />
                </button>
              ) : null}
              <div className="min-w-0">
                <h2 className="truncate text-[15px] font-semibold text-[var(--dashboard-text)]">
                  {hubHeaderTitle}
                </h2>
                {lane === 'hub' ? (
                  <p className="text-[11px] text-[var(--dashboard-muted)]">Files, sources, and execution lane</p>
                ) : lane === 'connectors' ? (
                  <p className="text-[11px] text-[var(--dashboard-muted)]">
                    Same spine as Settings — {connectedCount} connected
                  </p>
                ) : lane === 'connector_detail' && selectedConnector ? (
                  <p className="truncate text-[11px] text-[var(--dashboard-muted)]">
                    {selectedConnector.kind === 'mcp_remote'
                      ? 'MCP OAuth — Cursor / Claude / ChatGPT parity'
                      : selectedConnector.kind === 'capability'
                        ? 'Platform capability'
                        : 'OAuth-connected API tools'}
                  </p>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={closeAll}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--dashboard-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--dashboard-text)]"
            >
              <X size={18} />
            </button>
          </div>
        ) : null}

        {lane === 'hub' ? (
          <div className="min-h-0 flex-1 overflow-y-auto chat-hide-scroll px-4 pb-4">
            {pinnedLabel ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--solar-cyan)]/30 bg-[var(--scene-bg)] px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--dashboard-text)]">{pinnedLabel}</span>
                {onClearPinned ? (
                  <button
                    type="button"
                    aria-label="Clear pinned context"
                    onClick={onClearPinned}
                    className="shrink-0 rounded-md p-1 text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => openPickerThenClose(onUploadFile)}
                className="flex items-center gap-2 rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-3 py-3 text-left text-[13px] text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)] touch-manipulation"
              >
                <Paperclip size={16} className="shrink-0 text-[var(--dashboard-muted)]" />
                Add files
              </button>
              <button
                type="button"
                onClick={() => openPickerThenClose(onUploadImage)}
                className="flex items-center gap-2 rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-3 py-3 text-left text-[13px] text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)] touch-manipulation"
              >
                <ImageIcon size={16} className="shrink-0 text-[var(--dashboard-muted)]" />
                Image
              </button>
            </div>

            <p className="mt-5 mb-2 text-[9px] font-bold uppercase tracking-widest text-[var(--dashboard-muted)]">
              Voice
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('iam:composer-voice-toggle'));
                  closeAll();
                }}
                className="flex items-center gap-2 rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-3 py-3 text-left text-[13px] text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)] touch-manipulation"
              >
                <AudioLines size={16} className="shrink-0 text-[var(--dashboard-muted)]" />
                Voice with Sam
              </button>
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('iam:composer-dictation-toggle'));
                  closeAll();
                }}
                className="flex items-center gap-2 rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-3 py-3 text-left text-[13px] text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)] touch-manipulation"
              >
                <Mic size={16} className="shrink-0 text-[var(--dashboard-muted)]" />
                Dictate
              </button>
            </div>
            <button
              type="button"
              onClick={() => setLane('voice')}
              className="mt-2 flex w-full items-center justify-between rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-3 py-2.5 text-left hover:bg-[var(--bg-hover)]"
            >
              <span className="inline-flex items-center gap-2 text-[12px] text-[var(--dashboard-text)]">
                <Settings2 size={14} className="text-[var(--dashboard-muted)]" />
                Voice settings
              </span>
              <ChevronRight size={15} className="text-[var(--dashboard-muted)]" />
            </button>

            <p className="mt-5 mb-2 text-[9px] font-bold uppercase tracking-widest text-[var(--dashboard-muted)]">
              Sources
            </p>
            <div className="grid grid-cols-4 gap-2">
              {SOURCE_TILES.map((tile) => (
                <button
                  key={tile.id}
                  type="button"
                  onClick={() => {
                    if ('action' in tile && tile.action === 'files') {
                      openPickerThenClose(onUploadFile);
                      return;
                    }
                    if (tile.lane === 'github') {
                      setLane('github');
                      return;
                    }
                    setLane('connectors');
                    if ('focusProvider' in tile && tile.focusProvider) {
                      setSelectedConnectorKey(tile.focusProvider);
                    }
                  }}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-1 py-3 hover:bg-[var(--bg-hover)]"
                >
                  {'icon' in tile && tile.icon ? (
                    <tile.icon size={22} style={{ color: 'accent' in tile ? tile.accent : undefined }} />
                  ) : sourceTileIconUrl(tile, connectors) ? (
                    <img
                      src={sourceTileIconUrl(tile, connectors)!}
                      alt=""
                      className="h-6 w-6 object-contain rounded-md"
                    />
                  ) : (
                    <HardDrive size={22} style={{ color: 'var(--solar-cyan)' }} />
                  )}
                  <span className="text-[10px] font-medium text-[var(--dashboard-text)]">{tile.label}</span>
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-1 rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] p-1">
              {webSearchAllowed ? (
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] hover:bg-[var(--bg-hover)]"
                  onClick={onToggleWebSearch}
                >
                  <span className="inline-flex items-center gap-2 text-[var(--dashboard-text)]">
                    <Globe size={15} className="text-[var(--dashboard-muted)]" />
                    Web search
                  </span>
                  {activeSourceIds.has(WEB_SEARCH_SOURCE_ID) ? (
                    <Check size={15} className="text-[var(--solar-cyan)]" />
                  ) : null}
                </button>
              ) : null}
              {sandboxAgentAllowed && onToggleSandboxAgent ? (
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] hover:bg-[var(--bg-hover)]"
                  onClick={onToggleSandboxAgent}
                >
                  <span className="inline-flex items-center gap-2 text-[var(--dashboard-text)]">
                    <Box size={15} className="text-[var(--dashboard-muted)]" />
                    Remote sandbox
                  </span>
                  {activeSourceIds.has(SANDBOX_AGENT_SOURCE_ID) ? (
                    <Check size={15} className="text-[var(--solar-cyan)]" />
                  ) : null}
                </button>
              ) : null}
            </div>

            {execLane ? (
            <button
              type="button"
              onClick={() => setLane('tool_access')}
              className="mt-3 flex w-full items-center justify-between rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-3 py-3 text-left hover:bg-[var(--bg-hover)]"
            >
              <span className="text-[13px] text-[var(--dashboard-text)]">
                Run on: <span className="font-medium text-[var(--solar-cyan)]">{EXEC_LANE_LABELS[execLane]}</span>
              </span>
              <ChevronRight size={16} className="text-[var(--dashboard-muted)]" />
            </button>
            ) : null}

            <button
              type="button"
              onClick={() => setLane('project')}
              className="mt-2 flex w-full items-center justify-between rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-3 py-3 text-left hover:bg-[var(--bg-hover)]"
            >
              <span className="inline-flex items-center gap-2 text-[13px] text-[var(--dashboard-text)]">
                <FolderKanban size={15} className="text-[var(--dashboard-muted)]" />
                Add to project
                <span className="text-[11px] text-[var(--dashboard-muted)]">
                  {sessionProject?.name || 'None'}
                </span>
              </span>
              <ChevronRight size={16} className="text-[var(--dashboard-muted)]" />
            </button>

            <button
              type="button"
              onClick={() => setLane('connectors')}
              className="mt-2 flex w-full items-center justify-between rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-3 py-3 text-left hover:bg-[var(--bg-hover)]"
            >
              <span className="text-[13px] text-[var(--dashboard-text)]">
                Connectors &amp; apps
                {connectedCount > 0 ? (
                  <span className="ml-1.5 text-[11px] text-[var(--dashboard-muted)]">({connectedCount})</span>
                ) : null}
              </span>
              <ChevronRight size={16} className="text-[var(--dashboard-muted)]" />
            </button>
          </div>
        ) : null}

        {lane === 'github' ? (
          <GithubContextLane
            embedded
            workspaceId={workspaceId}
            githubRepoContext={githubRepoContext}
            onSelectRepo={onSelectRepo}
            onSelectFile={onSelectFile}
            onBrowseFiles={onBrowseFiles}
            onClose={closeAll}
            onBackToHub={() => setLane('hub')}
            onOAuthConnected={() => void refresh()}
          />
        ) : null}

        {lane === 'tool_access' && execLane ? (
          <div className="min-h-0 flex-1 overflow-y-auto chat-hide-scroll px-4 py-3">
            <p className="mb-3 text-[12px] text-[var(--dashboard-muted)]">
              Matches the terminal dock Local / VM / Sandbox control. The worker will not invent a lane.
            </p>
            <div className="space-y-2">
              {(['remote', 'local', 'sandbox'] as ExecLane[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    onExecLaneChange(opt);
                    setLane('hub');
                  }}
                  className={`flex w-full flex-col gap-1 rounded-xl border px-3 py-3 text-left ${
                    execLane === opt
                      ? 'border-[var(--solar-cyan)]/50 bg-[var(--scene-bg)] ring-1 ring-[var(--solar-cyan)]/30'
                      : 'border-[var(--dashboard-border)] bg-[var(--scene-bg)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <span className="flex w-full items-center justify-between text-[13px] text-[var(--dashboard-text)]">
                    {EXEC_LANE_LABELS[opt]}
                    {execLane === opt ? <Check size={15} className="text-[var(--solar-cyan)]" /> : null}
                  </span>
                  <span className="text-[11px] text-[var(--dashboard-muted)]">{EXEC_LANE_DESCRIPTIONS[opt]}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setLane('hub')}
              className="mt-4 w-full rounded-xl border border-[var(--dashboard-border)] py-2.5 text-[12px] text-[var(--dashboard-muted)]"
            >
              Back
            </button>
          </div>
        ) : null}

        {lane === 'voice' ? (
          <div className="min-h-0 flex-1 overflow-y-auto chat-hide-scroll px-4 py-3">
            <p className="mb-3 text-[12px] leading-relaxed text-[var(--dashboard-muted)]">
              Voice sessions start from the + drawer. While one is active, only its stop/status affordance appears in the composer.
            </p>
            <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-[var(--dashboard-muted)]">
              Persona
            </p>
            <div className="space-y-2">
              {VOICE_PERSONAS.map((persona) => (
                <button
                  key={persona.id}
                  type="button"
                  onClick={() =>
                    setVoicePrefs((prev) => ({ ...prev, personaId: persona.id as VoicePersonaId }))
                  }
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left ${
                    voicePrefs.personaId === persona.id
                      ? 'border-[var(--solar-cyan)]/50 bg-[var(--scene-bg)] ring-1 ring-[var(--solar-cyan)]/20'
                      : 'border-[var(--dashboard-border)] bg-[var(--scene-bg)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-[var(--dashboard-text)]">{persona.label}</span>
                    <span className="block text-[11px] text-[var(--dashboard-muted)]">{persona.blurb}</span>
                  </span>
                  {voicePrefs.personaId === persona.id ? <Check size={15} className="shrink-0 text-[var(--solar-cyan)]" /> : null}
                </button>
              ))}
            </div>

            <p className="mt-5 mb-2 text-[9px] font-bold uppercase tracking-widest text-[var(--dashboard-muted)]">
              Voice
            </p>
            <div className="grid grid-cols-3 gap-2">
              {REALTIME_VOICE_OPTIONS.map((voice) => (
                <button
                  key={voice.id}
                  type="button"
                  title={voice.blurb}
                  onClick={() =>
                    setVoicePrefs((prev) => ({ ...prev, voiceId: voice.id as RealtimeVoiceId }))
                  }
                  className={`rounded-xl border px-2 py-2.5 text-[11px] font-medium ${
                    voicePrefs.voiceId === voice.id
                      ? 'border-[var(--solar-cyan)]/50 bg-[var(--scene-bg)] text-[var(--solar-cyan)] ring-1 ring-[var(--solar-cyan)]/20'
                      : 'border-[var(--dashboard-border)] bg-[var(--scene-bg)] text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {voice.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setLane('hub')}
              className="mt-5 w-full rounded-xl border border-[var(--dashboard-border)] py-2.5 text-[12px] text-[var(--dashboard-muted)] hover:bg-[var(--bg-hover)]"
            >
              Back
            </button>
          </div>
        ) : null}

        {lane === 'connectors' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 px-4 pb-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--dashboard-muted)]" />
                <input
                  type="search"
                  value={connectorFilter}
                  onChange={(e) => setConnectorFilter(e.target.value)}
                  placeholder="Search connectors"
                  className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[var(--scene-bg)] py-2 pl-8 pr-3 text-[13px] outline-none focus:border-[var(--solar-cyan)]"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto chat-hide-scroll px-4 pb-2">
              {catalogLoading ? (
                <div className="flex items-center gap-2 px-1 py-6 text-[12px] text-[var(--dashboard-muted)]">
                  <Loader2 size={14} className="animate-spin" />
                  Loading connectors…
                </div>
              ) : filteredConnectors.length === 0 ? (
                <p className="px-1 py-6 text-[12px] text-[var(--dashboard-muted)]">No matches</p>
              ) : (
                <ul className="space-y-1">
                  {filteredConnectors.map((row) => {
                    const enabled = isConnectorSessionEnabled(row, sessionConnectorKeys, activeSourceIds);
                    const busy = connectBusy === row.provider_key;
                    return (
                      <li key={row.provider_key}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (!row.connected && row.connect_url) {
                              void runOAuthConnect(row);
                              return;
                            }
                            void openConnectorDetail(row);
                          }}
                          className="flex w-full items-center gap-3 rounded-xl border border-transparent px-2 py-2 text-left hover:border-[var(--dashboard-border)] hover:bg-[var(--bg-hover)]/60 disabled:opacity-60"
                        >
                          <AppIcon
                            title={row.title}
                            iconSlug={row.icon_slug}
                            imageUrl={row.icon_url}
                            size="sm"
                            status={iconStatusForConnector(row)}
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--dashboard-text)]">
                            {row.title}
                          </span>
                          {row.tool_count > 0 ? (
                            <span className="shrink-0 text-[12px] text-[var(--dashboard-muted)]">
                              ({row.tool_count})
                            </span>
                          ) : null}
                          {enabled ? (
                            <Check size={14} className="shrink-0 text-[var(--solar-cyan)]" />
                          ) : busy ? (
                            <Loader2 size={14} className="shrink-0 animate-spin text-[var(--solar-cyan)]" />
                          ) : !row.connected ? (
                            <span className="shrink-0 text-[10px] text-amber-300/90">Connect</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button
                type="button"
                className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] text-[var(--dashboard-muted)] hover:bg-[var(--bg-hover)]"
                onClick={() => {
                  window.location.href = '/dashboard/settings/integrations';
                }}
              >
                <Plus size={14} />
                Connect more in Settings
              </button>
              <button
                type="button"
                onClick={() => setLane('hub')}
                className="mt-2 w-full rounded-xl border border-[var(--dashboard-border)] py-2.5 text-[12px] text-[var(--dashboard-muted)]"
              >
                Back
              </button>
            </div>
          </div>
        ) : null}

        {lane === 'connector_detail' && selectedConnector ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto chat-hide-scroll px-4 pb-4">
            {(() => {
              const allToolKeys = detailTools.map((t) => t.tool_key);
              void sessionToolsRevision;
              return (
                <>
            <div className="mt-2 flex items-start gap-3 rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] p-3">
              <AppIcon
                title={selectedConnector.title}
                iconSlug={selectedConnector.icon_slug}
                imageUrl={selectedConnector.icon_url}
                size="lg"
                subtitle={connectorSubtitle(selectedConnector)}
                status={iconStatusForConnector(selectedConnector)}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-[var(--dashboard-muted)]">
                  {selectedConnector.connected
                    ? selectedConnector.account_display || 'Connected'
                    : 'Not connected — authorize to unlock tools'}
                </p>
                {selectedConnector.note ? (
                  <p className="mt-1 text-[11px] text-[var(--dashboard-muted)]">{selectedConnector.note}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {!selectedConnector.connected && selectedConnector.connect_url ? (
                    <button
                      type="button"
                      disabled={connectBusy === selectedConnector.provider_key}
                      onClick={() => void runOAuthConnect(selectedConnector)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--solar-cyan)] px-3 py-1.5 text-[12px] font-medium text-black disabled:opacity-60"
                    >
                      {connectBusy === selectedConnector.provider_key ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <ExternalLink size={13} />
                      )}
                      Connect
                    </button>
                  ) : null}
                  {selectedConnector.connected ? (
                    <button
                      type="button"
                      onClick={() => {
                        const on = isConnectorSessionEnabled(
                          selectedConnector,
                          sessionConnectorKeys,
                          activeSourceIds,
                        );
                        toggleConnectorForSession(selectedConnector, !on, allToolKeys);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--dashboard-border)] px-3 py-1.5 text-[12px] text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)]"
                    >
                      {isConnectorSessionEnabled(selectedConnector, sessionConnectorKeys, activeSourceIds) ? (
                        <>
                          <Check size={13} className="text-[var(--solar-cyan)]" />
                          Enabled this chat
                        </>
                      ) : (
                        'Enable for this chat'
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = selectedConnector.settings_path;
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--dashboard-border)] px-3 py-1.5 text-[12px] text-[var(--dashboard-muted)] hover:bg-[var(--bg-hover)]"
                  >
                    <Settings2 size={13} />
                    Settings
                  </button>
                </div>
              </div>
            </div>

            <p className="mt-4 mb-2 text-[9px] font-bold uppercase tracking-widest text-[var(--dashboard-muted)]">
              Tools ({selectedConnector.tool_count})
            </p>
            {detailToolsLoading ? (
              <div className="flex items-center gap-2 py-4 text-[12px] text-[var(--dashboard-muted)]">
                <Loader2 size={14} className="animate-spin" />
                Loading tools…
              </div>
            ) : detailTools.length === 0 ? (
              <p className="py-2 text-[12px] text-[var(--dashboard-muted)]">
                {selectedConnector.tools_preview.length
                  ? selectedConnector.tools_preview.map((t) => t.label).join(', ')
                  : 'No tools registered for this connector yet.'}
              </p>
            ) : (
              <ul className="space-y-1 rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] p-2">
                {detailTools.slice(0, 40).map((tool) => {
                  const on = isSessionToolEnabled(
                    selectedConnector.provider_key,
                    tool.tool_key,
                    allToolKeys,
                  );
                  return (
                    <li key={tool.tool_key}>
                      <button
                        type="button"
                        onClick={() =>
                          bumpToolToggle(selectedConnector.provider_key, tool.tool_key, !on)
                        }
                        className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-[var(--bg-hover)]/50"
                      >
                        <span className="mt-0.5 shrink-0">
                          {on ? (
                            <Check size={14} className="text-[var(--solar-cyan)]" />
                          ) : (
                            <span className="inline-block h-3.5 w-3.5 rounded border border-[var(--dashboard-border)]" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-medium text-[var(--dashboard-text)]">
                            {tool.label}
                          </span>
                          {tool.description ? (
                            <span className="mt-0.5 block line-clamp-2 text-[11px] text-[var(--dashboard-muted)]">
                              {tool.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {detailTools.length > 40 ? (
                  <li className="px-2 py-1 text-[10px] text-[var(--dashboard-muted)]">
                    +{detailTools.length - 40} more in MCP catalog
                  </li>
                ) : null}
              </ul>
            )}

            {selectedConnector.connect_url?.startsWith('/') ? (
              <button
                type="button"
                disabled={connectBusy === selectedConnector.provider_key}
                onClick={() => void runOAuthConnect(selectedConnector, true)}
                className="mt-3 text-[11px] text-[var(--dashboard-muted)] underline-offset-2 hover:underline disabled:opacity-50"
              >
                Re-authorize OAuth
              </button>
            ) : null}
                </>
              );
            })()}
          </div>
        ) : null}

        {lane === 'project' ? (
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            <div className="relative mb-2">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--dashboard-muted)]" />
              <input
                type="search"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                placeholder="Search projects"
                className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[var(--scene-bg)] py-2 pl-8 pr-3 text-[13px] outline-none focus:border-[var(--solar-cyan)]"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto chat-hide-scroll">
              <button
                type="button"
                onClick={() => {
                  writeSessionProject(null);
                  setPendingProjectBind({ kind: 'clear' });
                  setSessionProject(null);
                  onSessionContextChange?.();
                  setLane('hub');
                }}
                className={`mb-2 flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-[13px] ${
                  !sessionProject
                    ? 'border-[var(--solar-cyan)]/50 bg-[var(--scene-bg)] ring-1 ring-[var(--solar-cyan)]/30'
                    : 'border-[var(--dashboard-border)] bg-[var(--scene-bg)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <span className="text-[var(--dashboard-text)]">None</span>
                {!sessionProject ? <Check size={15} className="text-[var(--solar-cyan)]" /> : null}
              </button>
              {projectsLoading ? (
                <div className="flex items-center gap-2 py-4 text-[12px] text-[var(--dashboard-muted)]">
                  <Loader2 size={14} className="animate-spin" />
                  Loading projects…
                </div>
              ) : filteredProjects.length === 0 ? (
                <p className="py-4 text-[12px] text-[var(--dashboard-muted)]">No projects found</p>
              ) : (
                <ul className="space-y-1">
                  {filteredProjects.map((p) => {
                    const active =
                      sessionProject?.id === p.id ||
                      (p.chat_project_id && sessionProject?.id === p.chat_project_id);
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            const resolved = p.chat_project_id || p.id;
                            const next = { id: resolved, name: p.name };
                            writeSessionProject(next);
                            setPendingProjectBind({
                              kind: 'set',
                              projectId: resolved,
                              source: 'context_hub',
                            });
                            setSessionProject(next);
                            onSessionContextChange?.();
                            setLane('hub');
                          }}
                          className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-[13px] ${
                            active
                              ? 'border-[var(--solar-cyan)]/50 bg-[var(--scene-bg)] ring-1 ring-[var(--solar-cyan)]/30'
                              : 'border-[var(--dashboard-border)] bg-[var(--scene-bg)] hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          <span className="truncate text-[var(--dashboard-text)]">{p.name}</span>
                          {active ? <Check size={15} className="shrink-0 text-[var(--solar-cyan)]" /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <button
              type="button"
              onClick={() => setLane('hub')}
              className="mt-3 w-full rounded-xl border border-[var(--dashboard-border)] py-2.5 text-[12px] text-[var(--dashboard-muted)]"
            >
              Back
            </button>
          </div>
        ) : null}
      </div>
    </>
  );

  return createPortal(sheet, document.body);
}
