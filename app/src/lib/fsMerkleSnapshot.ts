import {
  buildFsMerkleSnapshot as buildCoreSnapshot,
  compareFsMerkleSnapshots as compareCoreSnapshots,
  explainFsMerkleDiff as explainCoreDiff,
  FS_MERKLE_VERSION,
  MERKLE_HASH_DOMAINS,
} from '../core/fs-merkle-snapshot.js';
import {
  adaptFsMerkleComparisonToRows as adaptCoreRows,
  buildFsChangeScopePayload as buildCoreScope,
} from '../core/fs-merkle-snapshot-adapter.js';
import {
  canUseFsMerkleSnapshot as canUseCapability,
  FS_MERKLE_SNAPSHOT_CAPABILITY as CAPABILITY_CONST,
  type FsMerkleCapabilityInput,
} from './fsMerkleCapability';

export type FsMerkleSource = 'github' | 'local';
export type FsMerkleHashDomain = 'git_blob_sha1' | 'git_blob_sha256' | 'raw_sha256';
export type FsMerkleNodeKind = 'file' | 'directory';
export type FsMerkleChangeState = 'added' | 'modified' | 'deleted';

export type FsMerkleFileInput =
  | { kind: 'file'; path: string; bytes: string | Uint8Array | ArrayBuffer; trustedGitBlobSha?: never }
  | { kind: 'file'; path: string; trustedGitBlobSha: string; bytes?: never };

export interface FsMerkleNode {
  name: string;
  path: string;
  kind: FsMerkleNodeKind;
  hash: string;
  hashAlgorithm: 'sha256' | 'git-blob';
  children?: FsMerkleNode[];
  childCount?: number;
}

export interface FsMerkleSnapshot {
  version: typeof FS_MERKLE_VERSION;
  reference: string;
  leafHashDomain?: FsMerkleHashDomain;
  rootHash: string;
  root: FsMerkleNode & { kind: 'directory'; children: FsMerkleNode[] };
  nodes: FsMerkleNode[];
}

export interface FsMerkleChangedPath {
  path: string;
  kind: FsMerkleNodeKind;
  state: FsMerkleChangeState;
  currentHash: string | null;
  baselineHash: string | null;
}

export interface FsMerkleComparison {
  version: typeof FS_MERKLE_VERSION;
  currentReference: string;
  baselineReference: string;
  currentRoot: string;
  baselineRoot: string;
  leafHashDomain?: FsMerkleHashDomain | null;
  equal: boolean;
  comparedNodeCount: number;
  changedPaths: FsMerkleChangedPath[];
  unchangedCollapsedHints: string[];
}

export interface GithubFsMerkleSourcePayload {
  source: 'github';
  repository: string;
  reference: string;
  resolvedGitTreeSha: string;
  entries: Extract<FsMerkleFileInput, { trustedGitBlobSha: string }>[];
}

export interface GithubFsMerkleComparisonResult {
  source: 'github';
  repository: string;
  current: FsMerkleSnapshot;
  baseline: FsMerkleSnapshot;
  comparison: FsMerkleComparison;
}

/** Re-export FS modes flag key from sessionStorageKeys SSOT (do not redeclare). */
export { AGENT_SAM_FS_MODES_FLAG_KEY } from './sessionStorageKeys';

export const FS_MERKLE_SNAPSHOT_CAPABILITY = CAPABILITY_CONST;
export { MERKLE_HASH_DOMAINS };

export type FsMerkleSnapshotRowState = FsMerkleChangeState | 'unchanged';

/** Flat Snapshot list row for VirtualizedFileTree-style consumers (Swarm A). */
export interface FsMerkleSnapshotRow {
  id: string;
  path: string;
  name: string;
  kind: FsMerkleNodeKind;
  depth: number;
  state: FsMerkleSnapshotRowState;
  currentHash: string | null;
  baselineHash: string | null;
  /** True when this directory hash matches baseline — children stay collapsed. */
  collapsedUnchanged: boolean;
}

export interface FsMerkleCompareResult {
  current: FsMerkleSnapshot;
  baseline: FsMerkleSnapshot;
  comparison: FsMerkleComparison;
}

export interface FsChangeScopePayload {
  kind: 'fs_change_scope';
  path: string;
  state: FsMerkleSnapshotRowState;
  baseline: string;
  current_root: string;
  previous_root: string;
  changed_paths: string[];
}

export type { FsMerkleCapabilityInput };

/**
 * Snapshot availability:
 * - no args → capability live (Swarm A tab chrome)
 * - github/react → requires repository slug
 * - local → requires connected FSA directory handle
 */
export function canUseFsMerkleSnapshot(input?: FsMerkleCapabilityInput): boolean {
  return canUseCapability(input);
}

export async function buildFsMerkleSnapshot(input: {
  reference: string;
  entries: FsMerkleFileInput[];
  leafHashDomain?: FsMerkleHashDomain;
}): Promise<FsMerkleSnapshot> {
  return await buildCoreSnapshot(input) as FsMerkleSnapshot;
}

export function compareFsMerkleSnapshots(
  current: FsMerkleSnapshot,
  baseline: FsMerkleSnapshot,
): FsMerkleComparison {
  return compareCoreSnapshots(current, baseline) as FsMerkleComparison;
}

export function explainFsMerkleDiff(
  comparison: FsMerkleComparison,
  path = '',
) {
  return explainCoreDiff(comparison, path);
}

/**
 * Build + compare two acquired trees. Prefer this for fixture / react-local
 * entries; use `loadGithubFsMerkleComparison` for GitHub refs.
 */
export async function buildFsMerkleCompare(input: {
  current: { reference: string; entries: FsMerkleFileInput[]; leafHashDomain?: FsMerkleHashDomain };
  baseline: { reference: string; entries: FsMerkleFileInput[]; leafHashDomain?: FsMerkleHashDomain };
}): Promise<FsMerkleCompareResult> {
  const [current, baseline] = await Promise.all([
    buildFsMerkleSnapshot(input.current),
    buildFsMerkleSnapshot(input.baseline),
  ]);
  return {
    current,
    baseline,
    comparison: compareFsMerkleSnapshots(current, baseline),
  };
}

export function adaptFsMerkleComparisonToRows(
  result: FsMerkleCompareResult,
  options?: { collapseUnchanged?: boolean },
): FsMerkleSnapshotRow[] {
  return adaptCoreRows(result, options) as FsMerkleSnapshotRow[];
}

export function buildFsChangeScopePayload(input: {
  path: string;
  state: FsMerkleSnapshotRowState;
  comparison: FsMerkleComparison;
  descendantPaths?: string[];
}): FsChangeScopePayload {
  return buildCoreScope(input) as FsChangeScopePayload;
}

/** Minimal Snapshot list adapter for Swarm A — list persisted snapshots. */
export async function listFsMerkleSnapshots(input: {
  workspaceId: string;
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<Array<{
  snapshot_id: string;
  root_hash: string;
  source: string;
  leaf_hash_domain: string;
  resolved_commit_sha: string | null;
  reference_label: string | null;
  created_at: number;
}>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const qs = new URLSearchParams();
  if (input.workspaceId) qs.set('workspace_id', input.workspaceId);
  if (input.limit) qs.set('limit', String(input.limit));
  const res = await fetchImpl(`/api/agent/merkle/list?${qs}`, { credentials: 'same-origin' });
  const body = await res.json().catch(() => ({})) as {
    ok?: boolean;
    error?: string;
    snapshots?: Array<Record<string, unknown>>;
  };
  if (!res.ok || !body.ok) throw new Error(body.error || `merkle_list_failed:${res.status}`);
  return (body.snapshots || []) as Array<{
    snapshot_id: string;
    root_hash: string;
    source: string;
    leaf_hash_domain: string;
    resolved_commit_sha: string | null;
    reference_label: string | null;
    created_at: number;
  }>;
}

const githubSnapshotCache = new Map<string, Promise<FsMerkleSnapshot>>();

async function fetchGithubMerkleSource(
  repository: string,
  reference: string,
  fetchImpl: typeof fetch,
): Promise<GithubFsMerkleSourcePayload> {
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new Error(`fs_merkle_invalid_repository:${repository}`);
  const query = new URLSearchParams({ ref: reference });
  const response = await fetchImpl(
    `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/merkle-tree?${query}`,
    { credentials: 'same-origin' },
  );
  const body = await response.json().catch(() => ({})) as Partial<GithubFsMerkleSourcePayload> & { error?: string };
  if (!response.ok) throw new Error(body.error || `github_merkle_source_failed:${response.status}`);
  if (body.source !== 'github' || !body.resolvedGitTreeSha || !Array.isArray(body.entries)) {
    throw new Error('github_merkle_source_invalid_response');
  }
  return body as GithubFsMerkleSourcePayload;
}

function buildCachedGithubSnapshot(source: GithubFsMerkleSourcePayload): Promise<FsMerkleSnapshot> {
  const key = `${source.repository}\0${source.reference}\0${source.resolvedGitTreeSha}`;
  const existing = githubSnapshotCache.get(key);
  if (existing) return existing;
  const built = buildFsMerkleSnapshot({
    reference: source.reference,
    entries: source.entries,
    leafHashDomain: 'git_blob_sha1',
  });
  githubSnapshotCache.set(key, built);
  built.catch(() => githubSnapshotCache.delete(key));
  return built;
}

/**
 * Same source as Changes (`/api/agent/git/status` → `default_branch`).
 * Fail loud when GitHub omits it — never invent `main`.
 */
async function resolveGithubRepoDefaultBranch(
  repository: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const qs = new URLSearchParams({ repo: repository });
  const response = await fetchImpl(`/api/agent/git/status?${qs}`, {
    credentials: 'same-origin',
  });
  const body = (await response.json().catch(() => ({}))) as {
    default_branch?: string | null;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || `github_default_branch_status_failed:${response.status}`);
  }
  const branch = body.default_branch != null ? String(body.default_branch).trim() : '';
  if (!branch) throw new Error(`github_default_branch_unresolved:${repository}`);
  return branch;
}

/**
 * Acquires and compares two real GitHub refs.
 * currentRef defaults to HEAD; baselineRef defaults to the repo default_branch
 * (same resolution path as Changes). Missing default_branch fails loud.
 */
export async function loadGithubFsMerkleComparison(input: {
  repository: string;
  currentRef?: string;
  baselineRef?: string;
  fetchImpl?: typeof fetch;
}): Promise<GithubFsMerkleComparisonResult> {
  const repository = input.repository.trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error(`fs_merkle_invalid_repository:${input.repository}`);
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const currentRef = input.currentRef?.trim() || 'HEAD';
  const explicitBaseline = input.baselineRef?.trim() || '';
  const baselineRef =
    explicitBaseline || (await resolveGithubRepoDefaultBranch(repository, fetchImpl));
  const [currentSource, baselineSource] = await Promise.all([
    fetchGithubMerkleSource(repository, currentRef, fetchImpl),
    fetchGithubMerkleSource(repository, baselineRef, fetchImpl),
  ]);
  const [current, baseline] = await Promise.all([
    buildCachedGithubSnapshot(currentSource),
    buildCachedGithubSnapshot(baselineSource),
  ]);
  return {
    source: 'github',
    repository,
    current,
    baseline,
    comparison: compareFsMerkleSnapshots(current, baseline),
  };
}

export { FS_MERKLE_VERSION };
