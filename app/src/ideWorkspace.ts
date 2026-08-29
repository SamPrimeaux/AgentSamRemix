/**
 * Persisted IDE workspace context — drives the bottom status bar and future Git/terminal wiring.
 * Local folder (File System Access API) overrides a pinned welcome workspace.
 * State syncs to D1 via GET/PUT /api/agent/workspace/:conversationId when a chat thread is active.
 */

import type { ActiveFile } from '../types';

export type IdeWorkspaceSnapshot =
  | { source: 'none' }
  | { source: 'local'; folderName: string }
  | { source: 'pinned'; name: string; pathHint: string };

export const IDE_PERSIST_VERSION = 1;
export const MAX_RECENT_FILES = 24;
const SNAPSHOT_CAP = 12000;

export type RecentFileSource = 'local' | 'github' | 'r2' | 'drive' | 'buffer';

/** Persisted recent-opened file metadata + capped snapshots for preview / diff in Workspace explorer. */
export type RecentFileEntry = {
  id: string;
  name: string;
  openedAt: number;
  /** Human-readable path or label */
  label: string;
  source: RecentFileSource;
  previewOneLine: string;
  snapshotOriginal: string | null;
  snapshotWorking: string;
  githubRepo?: string;
  githubPath?: string;
  githubBranch?: string;
  r2Key?: string;
  r2Bucket?: string;
  driveFileId?: string;
  workspacePath?: string;
};

/** Running local dev server detected from PTY stdout (Vite / Next / etc.). */
export type DevServerState = {
  port: number;
  url: string;
  updatedAt: number;
};

/** Full bundle stored in agent_workspace_state.state_json for the IDE shell. */
export type IdePersistedBundle = {
  v: number;
  ideWorkspace: IdeWorkspaceSnapshot;
  gitBranch: string;
  recentFiles: RecentFileEntry[];
  devServer?: DevServerState | null;
};

/** Live Agent Sam workbench context (chat payload + IDE child surfaces). */
export type AgentWorkspaceContextPacket = {
  activeTab: string;
  browserUrl: string | null;
  openFiles: string[];
  plan_id: string | null;
  workflow_run_id: string | null;
  /** Current dashboard pathname (ambient, no composer UI). */
  dashboard_path?: string | null;
  dashboard_route_key?: string | null;
  /** Serialized IDE workspace snapshot label/source. */
  ide_workspace?: IdeWorkspaceSnapshot | null;
  dev_server_url?: string | null;
  active_file?: string | null;
  /** Last N terminal output lines from the workbench shell. */
  terminal_tail?: string[] | null;
  /** Latest BrowserView surface metadata (URL, route, viewport). */
  browser_surface?: Record<string, unknown> | null;
  /** DOM pick from BrowserView — silent attach only (no composer tokens). */
  picked_element?: Record<string, unknown> | null;
  project_slug?: string | null;
  page_id?: string | null;
  studio_panel?: string | null;
  live_session_id?: string | null;
  collab_room?: string | null;
  bootstrap_cache_key?: string | null;
  preview_url?: string | null;
  public_domain?: string | null;
  cms_hosting?: string | null;
  api_profile?: string | null;
  capabilities?: string[] | null;
  r2_bucket?: string | null;
  r2_key?: string | null;
  /** Code-proven CMS spine for Working On app (buckets/keys/conventions). */
  agent_site_context?: Record<string, unknown> | null;
  d1_database_id?: string | null;
  /** Active IAM workspace id — session anchor (Cursor-style opened workspace). */
  workspace_id?: string | null;
  /** Primary source lane: github | r2 | local | mixed | general */
  workspace_source?: string | null;
  /** D1-bound GitHub repo for this workspace (default scope, overridable per turn). */
  github_repo?: string | null;
  /** D1-bound R2 prefix for this workspace. */
  r2_prefix?: string | null;
  /** PTY / local root when workspace is filesystem-scoped. */
  root_path?: string | null;
};

export function defaultIdeBundle(): IdePersistedBundle {
  return {
    v: IDE_PERSIST_VERSION,
    ideWorkspace: { source: 'none' },
    gitBranch: 'main',
    recentFiles: [],
    devServer: null,
  };
}

function safeParseDevServer(raw: unknown): DevServerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as DevServerState;
  const port = Number(o.port);
  const url = typeof o.url === 'string' ? o.url.trim() : '';
  const updatedAt = Number(o.updatedAt);
  if (!Number.isFinite(port) || port < 1 || !url.startsWith('http')) return null;
  return { port, url, updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now() };
}

function truncateSnapshot(s: string, max = SNAPSHOT_CAP): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '\n/* … truncated … */';
}

function recentFileId(f: ActiveFile): string {
  if (f.githubRepo && f.githubPath) return `gh:${f.githubRepo}:${f.githubPath}`;
  if (f.r2Bucket && f.r2Key) return `r2:${f.r2Bucket}:${f.r2Key}`;
  if (f.driveFileId) return `gdrive:${f.driveFileId}`;
  if (f.workspacePath) return `local:${f.workspacePath}`;
  return `name:${f.name}`;
}

function recentFileLabel(f: ActiveFile): string {
  if (f.githubRepo && f.githubPath) return `${f.githubRepo}/${f.githubPath}`;
  if (f.r2Bucket && f.r2Key) return `${f.r2Bucket}/${f.r2Key}`;
  if (f.workspacePath) return f.workspacePath;
  return f.name;
}

function recentSource(f: ActiveFile): RecentFileSource {
  if (f.githubRepo) return 'github';
  if (f.r2Key) return 'r2';
  if (f.driveFileId) return 'drive';
  if (f.workspacePath || f.handle) return 'local';
  return 'buffer';
}

function minifyOneLine(s: string, maxLen: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  if (one.length <= maxLen) return one || '(empty)';
  return one.slice(0, maxLen - 1) + '…';
}

function safeParseWorkspace(raw: unknown): IdeWorkspaceSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as IdeWorkspaceSnapshot;
  if (o.source === 'none' || o.source === 'local' || o.source === 'pinned') return o;
  return null;
}

function isRecentEntry(x: unknown): x is RecentFileEntry {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as RecentFileEntry).id === 'string' &&
    typeof (x as RecentFileEntry).name === 'string' &&
    typeof (x as RecentFileEntry).openedAt === 'number'
  );
}

export function parsePersistedBundle(raw: unknown): IdePersistedBundle | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const ideWorkspace = safeParseWorkspace(o.ideWorkspace);
  const gitBranch = typeof o.gitBranch === 'string' && o.gitBranch.trim() ? o.gitBranch.trim() : null;
  const rf = o.recentFiles;
  let recentFiles: RecentFileEntry[] = [];
  if (Array.isArray(rf)) {
    recentFiles = rf.filter(isRecentEntry).slice(0, MAX_RECENT_FILES);
  }
  if (!ideWorkspace || !gitBranch) return null;
  return {
    v: typeof o.v === 'number' ? o.v : IDE_PERSIST_VERSION,
    ideWorkspace,
    gitBranch,
    recentFiles,
    devServer: safeParseDevServer(o.devServer),
  };
}

/** Optional headers when the client holds a session id (Worker also accepts HttpOnly `session` cookie). */
export function workspaceFetchHeaders(sessionId?: string | null): HeadersInit {
  const h: Record<string, string> = { Accept: 'application/json' };
  const sid = sessionId?.trim();
  if (sid) h['x-session-id'] = sid;
  return h;
}

/**
 * Load persisted IDE state for the active agent chat conversation.
 * No-op (defaults) when conversationId is empty or the request fails.
 */
export async function hydrateIdeFromApi(
  conversationId: string,
  init?: { sessionId?: string | null; signal?: AbortSignal },
): Promise<IdePersistedBundle> {
  const defaults = defaultIdeBundle();
  const id = conversationId?.trim();
  if (!id) return defaults;

  try {
    const r = await fetch(`/api/agent/workspace/${encodeURIComponent(id)}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: workspaceFetchHeaders(init?.sessionId),
      signal: init?.signal,
    });
    if (r.status === 401 || r.status === 403) return defaults;
    if (!r.ok) return defaults;
    const row = (await r.json()) as { state_json?: string };
    const rawStr = row?.state_json;
    if (typeof rawStr !== 'string' || !rawStr.trim()) return defaults;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawStr) as unknown;
    } catch {
      return defaults;
    }
    const b = parsePersistedBundle(parsed);
    return b ?? defaults;
  } catch {
    return defaults;
  }
}

/** Write IDE bundle for this conversation (requires auth cookie or x-session-id). */
export async function persistIdeToApi(
  conversationId: string,
  bundle: IdePersistedBundle,
  init?: { sessionId?: string | null; signal?: AbortSignal },
): Promise<void> {
  const id = conversationId?.trim();
  if (!id) return;

  const body = JSON.stringify({ state: bundle });
  try {
    await fetch(`/api/agent/workspace/${encodeURIComponent(id)}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        ...workspaceFetchHeaders(init?.sessionId),
        'Content-Type': 'application/json',
      },
      body,
      signal: init?.signal,
    });
  } catch {
    /* offline / abort */
  }
}

/** Skip editor boot auto-open for generated/local scrap (e.g. d1_table_counts.py output). */
export function shouldAutoOpenRecentOnEditorBoot(entry: RecentFileEntry): boolean {
  const name = String(entry.name || '').trim();
  if (!name) return false;
  if (/^db_table_counts(\.(md|csv|txt))?$/i.test(name)) return false;
  if (/^\.env(\.|$)/i.test(name)) return false;
  const hasDurableSource = Boolean(
    entry.githubRepo || entry.r2Key || entry.driveFileId,
  );
  if (!hasDurableSource && (entry.source === 'local' || entry.source === 'buffer')) {
    return false;
  }
  return true;
}

export function buildRecentEntryFromActiveFile(file: ActiveFile): RecentFileEntry {
  const orig =
    file.originalContent !== undefined ? truncateSnapshot(file.originalContent) : null;
  const work = truncateSnapshot(file.content);
  return {
    id: recentFileId(file),
    name: file.name,
    openedAt: Date.now(),
    label: recentFileLabel(file),
    source: recentSource(file),
    previewOneLine: minifyOneLine(file.content, 160),
    snapshotOriginal: orig,
    snapshotWorking: work,
    githubRepo: file.githubRepo,
    githubPath: file.githubPath,
    githubBranch: file.githubBranch,
    r2Key: file.r2Key,
    r2Bucket: file.r2Bucket,
    driveFileId: file.driveFileId,
    workspacePath: file.workspacePath,
  };
}

/** Record or refresh recent files list (metadata only; no FileSystemFileHandle). */
export function mergeRecentFromActiveFile(prev: RecentFileEntry[], file: ActiveFile): RecentFileEntry[] {
  const entry = buildRecentEntryFromActiveFile(file);
  return [entry, ...prev.filter((e) => e.id !== entry.id)].slice(0, MAX_RECENT_FILES);
}

/** Line-level diff stats for UI badges (no external deps). */
export function diffLineStats(a: string, b: string): { added: number; removed: number } {
  const la = a.split('\n');
  const lb = b.split('\n');
  const setB = new Set(lb);
  const setA = new Set(la);
  let removed = 0;
  for (const line of la) {
    if (!setB.has(line)) removed++;
  }
  let added = 0;
  for (const line of lb) {
    if (!setA.has(line)) added++;
  }
  return { added, removed };
}

export function formatWorkspaceStatusLine(ws: IdeWorkspaceSnapshot): string {
  if (ws.source === 'none') return 'No workspace';
  if (ws.source === 'local') return `${ws.folderName} (local disk)`;
  return `${ws.name} — ${ws.pathHint}`;
}
