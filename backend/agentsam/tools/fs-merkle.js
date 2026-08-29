/**
 * Catalog handlers for filesystem + merkle tools (Slice 3 / 4).
 */

import {
  filesystemWalk,
  filesystemStatMany,
  filesystemHashMany,
  filesystemGitStatus,
  merkleBuildExecOsGit,
} from '../../http/agentsam/routes/execos-merkle-runtime.js';
import {
  merkleBuildGithub,
  merkleBuildFromEntries,
  merkleGet,
  merkleCompare,
  merkleExplain,
  merkleList,
  merkleDelete,
} from '../../http/agentsam/routes/fs-merkle-runtime.js';

function sessionIds(params) {
  const s = params?.session && typeof params.session === 'object' ? params.session : {};
  return {
    workspaceId:
      String(params.workspace_id || s.workspace_id || s.workspaceId || '').trim() || null,
    userId: String(params.user_id || s.user_id || s.userId || '').trim() || null,
  };
}

export const handlers = {
  async agentsam_filesystem_walk(params, env) {
    const { workspaceId } = sessionIds(params);
    return filesystemWalk(env, { ...params, workspaceId });
  },

  async agentsam_filesystem_stat_many(params, env) {
    const { workspaceId } = sessionIds(params);
    return filesystemStatMany(env, { ...params, workspaceId });
  },

  async agentsam_filesystem_hash_many(params, env) {
    const { workspaceId } = sessionIds(params);
    return filesystemHashMany(env, { ...params, workspaceId });
  },

  async agentsam_filesystem_git_status(params, env) {
    const { workspaceId } = sessionIds(params);
    return filesystemGitStatus(env, { ...params, workspaceId });
  },

  async agentsam_merkle_build(params, env) {
    const { workspaceId } = sessionIds(params);
    const source = String(params.source || 'github').trim().toLowerCase();
    if (source === 'github') {
      const token = String(params.github_token || params.token || '').trim();
      return merkleBuildGithub(env, {
        workspaceId,
        token,
        repository: params.repository || params.repo,
        reference: params.reference || params.ref || 'HEAD',
        persist: params.persist !== false,
      });
    }
    if (source === 'execos' || source === 'local_host') {
      return merkleBuildExecOsGit(env, { ...params, workspaceId });
    }
    if (Array.isArray(params.entries)) {
      return merkleBuildFromEntries(env, {
        workspaceId,
        source,
        reference: params.reference,
        entries: params.entries,
        leafHashDomain: params.leaf_hash_domain || params.leafHashDomain,
        resolvedCommitSha: params.resolved_commit_sha,
        resolvedTreeSha: params.resolved_tree_sha,
        repository: params.repository,
        ignoreProfileHash: params.ignore_profile_hash,
      });
    }
    return { ok: false, error: 'merkle_build_source_unsupported', status: 400 };
  },

  async agentsam_merkle_get(params, env) {
    const { workspaceId } = sessionIds(params);
    return merkleGet(env, {
      workspaceId,
      snapshotId: params.snapshot_id || params.snapshotId,
      path: params.path || '',
    });
  },

  async agentsam_merkle_compare(params, env) {
    const { workspaceId } = sessionIds(params);
    return merkleCompare(env, {
      workspaceId,
      currentSnapshotId: params.current_snapshot_id || params.head_snapshot_id,
      baselineSnapshotId: params.baseline_snapshot_id || params.base_snapshot_id,
    });
  },

  async agentsam_merkle_explain(params, env) {
    const { workspaceId } = sessionIds(params);
    return merkleExplain(env, {
      workspaceId,
      currentSnapshotId: params.current_snapshot_id || params.head_snapshot_id,
      baselineSnapshotId: params.baseline_snapshot_id || params.base_snapshot_id,
      path: params.path || '',
    });
  },

  async agentsam_merkle_delete(params, env) {
    const { workspaceId } = sessionIds(params);
    return merkleDelete(env, {
      workspaceId,
      snapshotId: params.snapshot_id || params.snapshotId,
    });
  },

  async agentsam_merkle_list(params, env) {
    const { workspaceId } = sessionIds(params);
    return merkleList(env, { workspaceId, limit: params.limit });
  },
};
