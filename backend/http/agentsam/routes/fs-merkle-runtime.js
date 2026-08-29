/**
 * Snapshot API orchestration: merkle_build / get / compare / explain.
 */

import {
  buildFsMerkleSnapshot,
  compareFsMerkleSnapshots,
  explainFsMerkleDiff,
  merkleIncompatibleHashDomainError,
  normalizeMerkleHashDomain,
  FS_MERKLE_VERSION,
} from '../../../../src/core/fs-merkle-snapshot.js';
import { fetchGithubMerkleSource } from '../../../../src/core/github-fs-merkle-source.js';
import {
  persistFsMerkleSnapshot,
  loadFsMerkleSnapshot,
  listFsMerkleSnapshots,
  deleteFsMerkleSnapshot,
} from '../../../../src/core/fs-merkle-persist.js';
import { resolveGitCommitShaForRef } from '../../../../src/core/fs-merkle-github-resolve.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function domainRefusePayload(err) {
  if (err?.code === 'merkle_incompatible_hash_domain' || err?.message === 'merkle_incompatible_hash_domain') {
    return {
      error: 'merkle_incompatible_hash_domain',
      base_domain: err.base_domain,
      head_domain: err.head_domain,
    };
  }
  const check = merkleIncompatibleHashDomainError(
    { leafHashDomain: err?.head_domain },
    { leafHashDomain: err?.base_domain },
  );
  return check;
}

/**
 * Build + persist a GitHub tip snapshot (Slice 2).
 */
export async function merkleBuildGithub(env, {
  workspaceId,
  token,
  repository,
  reference = 'HEAD',
  persist = true,
}) {
  const repo = trim(repository);
  const ref = trim(reference) || 'HEAD';
  const wid = trim(workspaceId);
  if (!wid) return { ok: false, error: 'workspace_required', status: 400 };
  if (!token) return { ok: false, error: 'github_token_required', status: 401 };
  if (!repo) return { ok: false, error: 'repository_required', status: 400 };

  let source;
  try {
    source = await fetchGithubMerkleSource({ token, repository: repo, reference: ref });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'github_merkle_fetch_failed';
    const client = /invalid_repository|reference_required|token_required/.test(message);
    return { ok: false, error: message, status: client ? 400 : 502 };
  }

  let resolvedCommitSha = null;
  try {
    resolvedCommitSha = await resolveGitCommitShaForRef({ token, repository: repo, reference: ref });
  } catch {
    resolvedCommitSha = null;
  }

  const snapshot = await buildFsMerkleSnapshot({
    reference: source.reference,
    entries: source.entries,
    leafHashDomain: 'git_blob_sha1',
  });

  if (!persist) {
    return {
      ok: true,
      status: 200,
      version: FS_MERKLE_VERSION,
      leaf_hash_domain: 'git_blob_sha1',
      root_hash: snapshot.rootHash,
      reference: snapshot.reference,
      resolved_commit_sha: resolvedCommitSha,
      resolved_tree_sha: source.resolvedGitTreeSha,
      repository: repo,
      snapshot,
    };
  }

  const saved = await persistFsMerkleSnapshot(env, {
    workspaceId: wid,
    source: 'github',
    snapshot,
    resolvedCommitSha,
    resolvedTreeSha: source.resolvedGitTreeSha,
    repository: repo,
  });

  return {
    ok: true,
    status: 200,
    version: FS_MERKLE_VERSION,
    snapshot_id: saved.snapshot_id,
    root_hash: saved.root_hash,
    leaf_hash_domain: saved.leaf_hash_domain,
    reference: snapshot.reference,
    resolved_commit_sha: resolvedCommitSha,
    resolved_tree_sha: source.resolvedGitTreeSha,
    repository: repo,
    created_at: saved.created_at,
  };
}

/**
 * Persist a client-built (FSA / react) snapshot body.
 */
export async function merkleBuildFromEntries(env, {
  workspaceId,
  source,
  reference,
  entries,
  leafHashDomain,
  resolvedCommitSha = null,
  resolvedTreeSha = null,
  repository = null,
  ignoreProfileHash = null,
}) {
  const wid = trim(workspaceId);
  if (!wid) return { ok: false, error: 'workspace_required', status: 400 };
  if (!Array.isArray(entries)) return { ok: false, error: 'entries_required', status: 400 };
  const domain = normalizeMerkleHashDomain(leafHashDomain || 'raw_sha256');
  const snapshot = await buildFsMerkleSnapshot({
    reference: trim(reference) || 'working',
    entries,
    leafHashDomain: domain,
  });
  const saved = await persistFsMerkleSnapshot(env, {
    workspaceId: wid,
    source: trim(source) || 'local',
    snapshot,
    resolvedCommitSha,
    resolvedTreeSha,
    repository,
    ignoreProfileHash,
  });
  return {
    ok: true,
    status: 200,
    version: FS_MERKLE_VERSION,
    snapshot_id: saved.snapshot_id,
    root_hash: saved.root_hash,
    leaf_hash_domain: saved.leaf_hash_domain,
    reference: snapshot.reference,
    created_at: saved.created_at,
  };
}

export async function merkleGet(env, { workspaceId, snapshotId, path = '' }) {
  try {
    const loaded = await loadFsMerkleSnapshot(env, { workspaceId, snapshotId });
    const scopedPath = trim(path);
    if (!scopedPath) {
      return {
        ok: true,
        status: 200,
        index: loaded.index,
        root_hash: loaded.snapshot.rootHash,
        leaf_hash_domain: loaded.snapshot.leafHashDomain,
        reference: loaded.snapshot.reference,
        nodes: loaded.snapshot.nodes,
        root: loaded.snapshot.root,
      };
    }
    const node = loaded.snapshot.nodes.find((n) => n.path === scopedPath);
    if (!node) return { ok: false, error: 'path_not_found', status: 404 };
    let children = [];
    if (node.kind === 'directory' && loaded.snapshot.root) {
      const visit = (dir) => {
        if (dir.path === scopedPath) {
          children = (dir.children || []).map((c) => ({
            name: c.name,
            path: c.path,
            kind: c.kind,
            hash: c.hash,
          }));
          return true;
        }
        if (dir.kind !== 'directory') return false;
        for (const child of dir.children || []) {
          if (visit(child)) return true;
        }
        return false;
      };
      visit(loaded.snapshot.root);
    }
    return {
      ok: true,
      status: 200,
      node,
      children,
      root_hash: loaded.snapshot.rootHash,
      leaf_hash_domain: loaded.snapshot.leafHashDomain,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'fs_merkle_get_failed';
    const status = /not_found|r2_missing/.test(message) ? 404 : 500;
    return { ok: false, error: message, status };
  }
}

export async function merkleCompare(env, { workspaceId, currentSnapshotId, baselineSnapshotId }) {
  try {
    const [current, baseline] = await Promise.all([
      loadFsMerkleSnapshot(env, { workspaceId, snapshotId: currentSnapshotId }),
      loadFsMerkleSnapshot(env, { workspaceId, snapshotId: baselineSnapshotId }),
    ]);
    try {
      const comparison = compareFsMerkleSnapshots(current.snapshot, baseline.snapshot);
      return {
        ok: true,
        status: 200,
        current_snapshot_id: trim(currentSnapshotId),
        baseline_snapshot_id: trim(baselineSnapshotId),
        comparison,
      };
    } catch (e) {
      const refuse = domainRefusePayload(e);
      if (refuse) return { ok: false, status: 409, ...refuse };
      throw e;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'fs_merkle_compare_failed';
    const status = /not_found|r2_missing/.test(message) ? 404 : 500;
    return { ok: false, error: message, status };
  }
}

export async function merkleExplain(env, { workspaceId, currentSnapshotId, baselineSnapshotId, path = '' }) {
  const cmp = await merkleCompare(env, { workspaceId, currentSnapshotId, baselineSnapshotId });
  if (!cmp.ok) return cmp;
  const explanation = explainFsMerkleDiff(cmp.comparison, path);
  return { ok: true, status: 200, ...explanation };
}

export async function merkleList(env, { workspaceId, limit }) {
  try {
    const rows = await listFsMerkleSnapshots(env, { workspaceId, limit });
    return { ok: true, status: 200, snapshots: rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'list_failed', status: 500 };
  }
}

export async function merkleDelete(env, { workspaceId, snapshotId }) {
  try {
    const out = await deleteFsMerkleSnapshot(env, { workspaceId, snapshotId });
    return { ok: true, status: 200, ...out };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'delete_failed';
    return { ok: false, error: message, status: /not_found/.test(message) ? 404 : 500 };
  }
}
