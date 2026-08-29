import {
  FS_SOURCE_ICON_META,
  type FsSourceIconId,
} from './fsSourceIcons';
import {
  AGENT_SAM_FS_INSPECTION_WIDTH_KEY,
  AGENT_SAM_FS_MODES_FLAG_KEY,
  AGENT_SAM_FS_SOURCE_STORAGE_KEY,
} from './sessionStorageKeys';

export {
  AGENT_SAM_FS_INSPECTION_WIDTH_KEY,
  AGENT_SAM_FS_MODES_FLAG_KEY,
  AGENT_SAM_FS_SOURCE_STORAGE_KEY,
} from './sessionStorageKeys';

/** Unified file browser source — one tab, one tree/list surface per source. */
export type AgentSamFsSource = FsSourceIconId;

export const AGENT_SAM_FS_SOURCES: {
  id: AgentSamFsSource;
  label: string;
  title: string;
}[] = (['local', 'github', 'r2', 'drive', 'container'] as const).map((id) => ({
  id,
  label: FS_SOURCE_ICON_META[id].label,
  title: FS_SOURCE_ICON_META[id].title,
}));

export type AgentSamFsPaneMode = 'files' | 'changes' | 'snapshot';

const VALID_SOURCES = new Set<string>(AGENT_SAM_FS_SOURCES.map((s) => s.id));

const MODES_ON = new Set(['on', '1', 'true', 'yes']);

/** Map retired `react` tab → `github` (same backend; pin expands in GitHub tab). */
export function normalizeAgentSamFsSource(raw: string | null | undefined): AgentSamFsSource | null {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'react') return 'github';
  if (VALID_SOURCES.has(s)) return s as AgentSamFsSource;
  return null;
}

export function loadPersistedAgentSamFsSource(): AgentSamFsSource | null {
  try {
    const raw = localStorage.getItem(AGENT_SAM_FS_SOURCE_STORAGE_KEY);
    const normalized = normalizeAgentSamFsSource(raw);
    if (normalized && raw === 'react') {
      try {
        localStorage.setItem(AGENT_SAM_FS_SOURCE_STORAGE_KEY, 'github');
      } catch {
        /* ignore */
      }
    }
    return normalized;
  } catch {
    /* private mode */
  }
  return null;
}

export function persistAgentSamFsSource(source: AgentSamFsSource): void {
  try {
    localStorage.setItem(AGENT_SAM_FS_SOURCE_STORAGE_KEY, source);
  } catch {
    /* ignore */
  }
}

/**
 * True when session/D1 `feature_flags.agent_sam_fs_modes_v1` is truthy
 * (true / 1 / 'on' / 'true' / 'yes'). Absent or falsy = OFF (Files v1).
 */
export function isAgentSamFsModesEnabled(
  featureFlags?: Record<string, unknown> | null,
): boolean {
  if (!featureFlags || typeof featureFlags !== 'object') return false;
  const raw = featureFlags[AGENT_SAM_FS_MODES_FLAG_KEY];
  if (raw == null || raw === '') return false;
  if (raw === true || raw === 1) return true;
  return MODES_ON.has(String(raw).trim().toLowerCase());
}

export function loadPersistedFsInspectionWidth(): number | null {
  try {
    const raw = localStorage.getItem(AGENT_SAM_FS_INSPECTION_WIDTH_KEY);
    if (!raw) return null;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 120 && n <= 900) return n;
  } catch {
    /* ignore */
  }
  return null;
}

export function persistFsInspectionWidth(widthPx: number): void {
  try {
    if (!Number.isFinite(widthPx)) return;
    localStorage.setItem(AGENT_SAM_FS_INSPECTION_WIDTH_KEY, String(Math.round(widthPx)));
  } catch {
    /* ignore */
  }
}

export function fsSourceIconId(source: AgentSamFsSource): FsSourceIconId {
  return source;
}

/** Event name — Files rail publishes the live bind; chat/greeting consume only this. */
export const IAM_FILES_SOURCE_CONTEXT_EVENT = 'iam_files_source_context';

/** Request event — consumers dispatch to ask Files rail to re-publish current context. */
export const IAM_FILES_SOURCE_CONTEXT_REQUEST_EVENT = 'iam_files_source_context_request';

/**
 * Select/focus an R2 bucket in the Files pane (detail: `{ bucket?: string }`).
 * Upstream `iam:palette-open-r2` opens the Files activity then re-dispatches this.
 */
export const IAM_PALETTE_OPEN_R2 = 'iam-palette-open-r2';

/** Request to open Files → R2 (may navigate/shell first; then emits IAM_PALETTE_OPEN_R2). */
export const IAM_PALETTE_OPEN_R2_REQUEST = 'iam:palette-open-r2';

/**
 * Live Files-rail bind. One source → one path. No ambient D1 github_repo invent.
 * github_repo / local_folder / r2_* are filled only for the active source.
 */
export type AgentSamFsSourceContext = {
  source: AgentSamFsSource;
  /** Chrome / greeting label derived from this source's real bind. */
  label: string;
  /** Canonical bind for the active source (folder name, owner/repo, r2://bucket/prefix, …). */
  source_path: string | null;
  github_repo: string | null;
  local_folder: string | null;
  has_local_handle: boolean;
  r2_bucket: string | null;
  r2_prefix: string | null;
};

export function buildAgentSamFsSourceContext(input: {
  source: AgentSamFsSource;
  localFolder?: string | null;
  hasLocalHandle?: boolean;
  /** Open/expanded GitHub owner/repo — only when source is github. */
  githubRepo?: string | null;
  r2Bucket?: string | null;
  r2Prefix?: string | null;
}): AgentSamFsSourceContext {
  const source = input.source;
  const localFolder = String(input.localFolder || '').trim() || null;
  const hasLocalHandle = Boolean(input.hasLocalHandle);
  const githubRepo = String(input.githubRepo || '').trim() || null;
  const r2Bucket = String(input.r2Bucket || '').trim() || null;
  const r2Prefix = String(input.r2Prefix || '').trim() || null;

  if (source === 'local') {
    const path = localFolder;
    return {
      source,
      label: path ? `${path} (local)` : 'Local folder',
      source_path: path,
      github_repo: null,
      local_folder: path,
      has_local_handle: hasLocalHandle,
      r2_bucket: null,
      r2_prefix: null,
    };
  }
  if (source === 'github') {
    return {
      source,
      label: githubRepo || 'GitHub (no repo open)',
      source_path: githubRepo,
      github_repo: githubRepo,
      local_folder: null,
      has_local_handle: false,
      r2_bucket: null,
      r2_prefix: null,
    };
  }
  if (source === 'r2') {
    const path = r2Bucket ? (r2Prefix ? `r2://${r2Bucket}/${r2Prefix}` : `r2://${r2Bucket}`) : null;
    return {
      source,
      label: path || 'R2',
      source_path: path,
      github_repo: null,
      local_folder: null,
      has_local_handle: false,
      r2_bucket: r2Bucket,
      r2_prefix: r2Prefix,
    };
  }
  if (source === 'drive') {
    return {
      source,
      label: 'Google Drive',
      source_path: 'drive',
      github_repo: null,
      local_folder: null,
      has_local_handle: false,
      r2_bucket: null,
      r2_prefix: null,
    };
  }
  if (source === 'container') {
    return {
      source,
      label: 'Sandbox',
      source_path: 'container',
      github_repo: null,
      local_folder: null,
      has_local_handle: false,
      r2_bucket: null,
      r2_prefix: null,
    };
  }
  return {
    source,
    label: 'Files',
    source_path: null,
    github_repo: null,
    local_folder: null,
    has_local_handle: false,
    r2_bucket: null,
    r2_prefix: null,
  };
}
