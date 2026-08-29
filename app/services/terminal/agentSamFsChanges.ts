/**
 * AgentSamFilesystem Changes mode — pure status overlay helpers (no Merkle).
 * Rollback: D1/session `agent_sam_fs_modes_v1` OFF hides all mode chrome; this module is inert when unused.
 * Changes SSOT = GitHub compare_commits only — never D1 `change_sets` / `change_set_pending`.
 */

export type FsChangeState = 'modified' | 'added' | 'deleted' | 'renamed' | 'unchanged';

export type FsChangeEntry = {
  path: string;
  state: FsChangeState;
  /** Raw git/GitHub status token (e.g. "M", "A", "renamed"). */
  statusRaw?: string;
  /** Optional short hash placeholder (blob sha / compare sha). */
  hashShort?: string | null;
  previousPath?: string | null;
  staged?: boolean;
};

export type FsChangeScope = {
  kind: 'fs_change_scope';
  path: string;
  state: FsChangeState;
  baseline: string;
  current_root: string;
  previous_root: string;
  changed_paths: string[];
};

export type AgentGitStatusFilesPayload = {
  status?: string;
  branch?: string | null;
  repo_full_name?: string | null;
  default_branch?: string | null;
  staged?: Array<{ path?: string; status?: string }>;
  unstaged?: Array<{ path?: string; status?: string }>;
  /** Optional GitHub compare files (filename + status). */
  files?: Array<{
    path?: string;
    filename?: string;
    status?: string;
    sha?: string | null;
    previous_filename?: string | null;
    previous_path?: string | null;
    /** Rejected in V1 Changes — Accept/Reject staging is not git dirty. */
    source?: string | null;
  }>;
};

/** Sources that may drive Changes via GitHub compare (open `repo=`). */
export const FS_CHANGES_GITHUB_SOURCES = new Set(['github']);

export function isFsChangesGithubSource(source: string | null | undefined): boolean {
  return FS_CHANGES_GITHUB_SOURCES.has(String(source || '').trim());
}

export type FsInspectionWidthBand = 'narrow' | 'medium' | 'wide';

export const FS_CHANGE_GLYPH: Record<FsChangeState, string> = {
  modified: '●',
  added: '+',
  deleted: '−',
  renamed: '→',
  unchanged: ' ',
};

export const FS_CHANGE_SCOPE_EVENT = 'iam-fs-change-scope';

let latestFsChangeScope: FsChangeScope | null = null;

export function getLatestFsChangeScope(): FsChangeScope | null {
  return latestFsChangeScope;
}

export function clearLatestFsChangeScope(): void {
  latestFsChangeScope = null;
}

/** Publish selected change scope into Agent Sam chat context (thin CustomEvent bus). */
export function publishFsChangeScope(scope: FsChangeScope): void {
  latestFsChangeScope = scope;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FS_CHANGE_SCOPE_EVENT, { detail: scope }));
  window.dispatchEvent(
    new CustomEvent('iam:agent-context-attach', { detail: { fs_change_scope: scope } }),
  );
}

export function mapStatusTokenToState(raw: string | null | undefined): FsChangeState {
  const original = String(raw || '').trim();
  if (!original) return 'unchanged';
  const lower = original.toLowerCase();
  const upper = original.toUpperCase();

  if (lower.includes('renamed') || lower === 'renamed' || /^r\b/i.test(original) || upper.startsWith('R')) {
    return 'renamed';
  }
  if (
    lower === 'deleted' ||
    lower === 'removed' ||
    lower === 'd' ||
    /^d\b/i.test(original) ||
    (upper.includes('D') && !/[MA?]/.test(upper.replace(/D/g, '')))
  ) {
    return 'deleted';
  }
  if (
    lower === 'added' ||
    lower === 'new' ||
    lower === 'untracked' ||
    lower === 'a' ||
    upper.includes('A') ||
    upper.includes('?')
  ) {
    return 'added';
  }
  if (lower === 'modified' || lower === 'changed' || lower === 'm' || upper.includes('M')) {
    return 'modified';
  }
  return 'modified';
}

function shortHash(sha: string | null | undefined): string | null {
  const t = String(sha || '').trim();
  if (!t) return null;
  return t.length >= 7 ? t.slice(0, 7) : t;
}

function upsertChange(
  map: Map<string, FsChangeEntry>,
  path: string,
  statusRaw: string,
  extras?: Partial<FsChangeEntry>,
): void {
  const cleaned = String(path || '').trim().replace(/^\.\//, '');
  if (!cleaned) return;
  const state = mapStatusTokenToState(statusRaw);
  if (state === 'unchanged') return;
  const prev = map.get(cleaned);
  const next: FsChangeEntry = {
    path: cleaned,
    state: prev?.state === 'modified' && state === 'added' ? 'modified' : state,
    statusRaw: statusRaw || prev?.statusRaw,
    hashShort: extras?.hashShort ?? prev?.hashShort ?? null,
    previousPath: extras?.previousPath ?? prev?.previousPath ?? null,
    staged: extras?.staged ?? prev?.staged,
  };
  if (prev && prev.state !== next.state) {
    // Prefer deleted/renamed over modified when both present; else keep stronger dirty signal.
    const rank: Record<FsChangeState, number> = {
      deleted: 4,
      renamed: 3,
      added: 2,
      modified: 1,
      unchanged: 0,
    };
    if (rank[prev.state] > rank[next.state]) {
      next.state = prev.state;
    }
  }
  map.set(cleaned, next);
}

/** Normalize SourcePanel / GitHub compare shaped status JSON into a path→change map. */
export function buildFsChangeMapFromStatus(payload: AgentGitStatusFilesPayload | null | undefined): Map<string, FsChangeEntry> {
  const map = new Map<string, FsChangeEntry>();
  if (!payload || typeof payload !== 'object') return map;

  for (const item of payload.staged || []) {
    if (!item || typeof item !== 'object') continue;
    upsertChange(map, String(item.path || ''), String(item.status || 'M'), { staged: true });
  }
  for (const item of payload.unstaged || []) {
    if (!item || typeof item !== 'object') continue;
    upsertChange(map, String(item.path || ''), String(item.status || 'M'), { staged: false });
  }
  for (const item of payload.files || []) {
    if (!item || typeof item !== 'object') continue;
    // Defense in depth: never paint Accept/Reject staging as git Changes.
    if (String(item.source || '').trim() === 'change_set_pending') continue;
    const path = String(item.path || item.filename || '').trim();
    upsertChange(map, path, String(item.status || 'modified'), {
      hashShort: shortHash(item.sha),
      previousPath: item.previous_path || item.previous_filename || null,
    });
  }
  return map;
}

export function fsChangeEntriesSorted(map: Map<string, FsChangeEntry>): FsChangeEntry[] {
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Paths that should stay visible in Changes mode (dirty files + ancestor dirs). */
export function buildVisibleChangePathSet(
  changes: Map<string, FsChangeEntry>,
  opts?: { includeUnchanged?: boolean },
): Set<string> {
  const visible = new Set<string>();
  if (opts?.includeUnchanged) return visible;
  for (const path of changes.keys()) {
    visible.add(path);
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      visible.add(parts.slice(0, i).join('/'));
    }
  }
  return visible;
}

/**
 * Strip optional connected-folder root name so local tree ids match git-relative paths.
 * e.g. root "inneranimalmedia" + id "inneranimalmedia/src/a.js" → "src/a.js"
 */
export function toRepoRelativePath(treePath: string, rootFolderName?: string | null): string {
  const p = String(treePath || '').replace(/^\.\//, '').replace(/^\/+/, '');
  const root = String(rootFolderName || '').trim();
  if (root && (p === root || p.startsWith(`${root}/`))) {
    return p === root ? '' : p.slice(root.length + 1);
  }
  return p;
}

export function lookupChangeForTreePath(
  changes: Map<string, FsChangeEntry>,
  treePath: string,
  rootFolderName?: string | null,
): FsChangeEntry | undefined {
  const rel = toRepoRelativePath(treePath, rootFolderName);
  if (changes.has(treePath)) return changes.get(treePath);
  if (rel && changes.has(rel)) return changes.get(rel);
  return undefined;
}

/** Filter virtualized local rows for Changes mode — keep dirty + ancestors; drop empty/loading under clean dirs. */
export function filterLocalRowsForChangesMode<
  T extends { type: string; id?: string; pathPrefix?: string; node?: { name: string; kind: string } },
>(
  rows: T[],
  changes: Map<string, FsChangeEntry>,
  rootFolderName?: string | null,
  opts?: { collapseUnchanged?: boolean },
): T[] {
  const collapse = opts?.collapseUnchanged !== false;
  if (!collapse) return rows;
  const visible = buildVisibleChangePathSet(changes);
  if (visible.size === 0) return [];

  return rows.filter((row) => {
    if (row.type === 'loading' || row.type === 'empty') {
      const parent = String(row.id || '')
        .replace(/\/__(loading|empty)__$/, '');
      const rel = toRepoRelativePath(parent, rootFolderName);
      return visible.has(parent) || (rel ? visible.has(rel) : false);
    }
    if (row.type !== 'entry' || !row.id) return false;
    const rel = toRepoRelativePath(row.id, rootFolderName);
    if (visible.has(row.id) || (rel && visible.has(rel))) return true;
    // Directory that prefixes a dirty path
    if (row.node?.kind === 'directory') {
      const prefix = rel || row.id;
      for (const p of visible) {
        if (p.startsWith(`${prefix}/`)) return true;
      }
    }
    return false;
  });
}

export function resolveInspectionWidthBand(widthPx: number): FsInspectionWidthBand {
  if (widthPx >= 360) return 'wide';
  if (widthPx >= 240) return 'medium';
  return 'narrow';
}

export function buildFsChangeScope(args: {
  path: string;
  state: FsChangeState;
  baseline?: string | null;
  currentRoot?: string;
  previousRoot?: string;
  changedPaths: string[];
}): FsChangeScope {
  const baseline = args.baseline != null ? String(args.baseline).trim() : '';
  if (!baseline) {
    throw new Error('github_default_branch_unresolved');
  }
  return {
    kind: 'fs_change_scope',
    path: args.path,
    state: args.state,
    baseline,
    current_root: args.currentRoot || '',
    previous_root: args.previousRoot || '',
    changed_paths: args.changedPaths.slice(0, 200),
  };
}

export function glyphForChangeState(state: FsChangeState): string {
  return FS_CHANGE_GLYPH[state] || ' ';
}
