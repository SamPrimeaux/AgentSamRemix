/**
 * Merkle snapshot persistence — R2 document SSOT + thin D1 index.
 * Prefer AUTORAG_BUCKET; fall back to ASSETS. No Merkle-node schema in D1.
 */

import { normalizeMerkleHashDomain } from './fs-merkle-snapshot.js';

const R2_PREFIX = 'fs-merkle-snapshots';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function r2Binding(env) {
  return env?.AUTORAG_BUCKET || env?.ASSETS || env?.R2 || null;
}

function r2Key(workspaceId, snapshotId) {
  return `${R2_PREFIX}/${workspaceId}/${snapshotId}.json`;
}

function newSnapshotId() {
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
  return `mrs_${Date.now().toString(36)}_${hex}`;
}

/**
 * Serialize a built snapshot for R2 (full tree + manifest).
 * @param {object} snapshot
 * @param {object} manifest
 */
export function serializeMerkleSnapshotDocument(snapshot, manifest = {}) {
  return {
    version: snapshot.version,
    snapshot_id: manifest.snapshot_id,
    workspace_id: manifest.workspace_id,
    source: manifest.source,
    leaf_hash_domain: snapshot.leafHashDomain || manifest.leaf_hash_domain,
    reference: snapshot.reference,
    root_hash: snapshot.rootHash,
    resolved_commit_sha: manifest.resolved_commit_sha || null,
    resolved_tree_sha: manifest.resolved_tree_sha || null,
    repository: manifest.repository || null,
    ignore_profile_hash: manifest.ignore_profile_hash || null,
    created_at: manifest.created_at || Math.floor(Date.now() / 1000),
    root: snapshot.root,
    nodes: snapshot.nodes,
  };
}

/**
 * Persist snapshot body to R2 and thin index row to D1.
 * @param {any} env
 * @param {{
 *   workspaceId: string,
 *   source: string,
 *   snapshot: object,
 *   resolvedCommitSha?: string|null,
 *   resolvedTreeSha?: string|null,
 *   repository?: string|null,
 *   ignoreProfileHash?: string|null,
 *   snapshotId?: string|null,
 * }} input
 */
export async function persistFsMerkleSnapshot(env, input) {
  const workspaceId = trim(input.workspaceId);
  if (!workspaceId) throw new Error('fs_merkle_workspace_required');
  const snapshot = input.snapshot;
  if (!snapshot?.rootHash || !snapshot?.root) throw new Error('fs_merkle_snapshot_required');
  const leafDomain = normalizeMerkleHashDomain(
    snapshot.leafHashDomain || input.leafHashDomain || 'raw_sha256',
  );
  const r2 = r2Binding(env);
  if (!r2?.put) throw new Error('fs_merkle_r2_unavailable');
  if (!env?.DB) throw new Error('fs_merkle_d1_unavailable');

  const snapshotId = trim(input.snapshotId) || newSnapshotId();
  const createdAt = Math.floor(Date.now() / 1000);
  const doc = serializeMerkleSnapshotDocument(snapshot, {
    snapshot_id: snapshotId,
    workspace_id: workspaceId,
    source: trim(input.source) || 'unknown',
    leaf_hash_domain: leafDomain,
    resolved_commit_sha: input.resolvedCommitSha ? trim(input.resolvedCommitSha) : null,
    resolved_tree_sha: input.resolvedTreeSha ? trim(input.resolvedTreeSha) : null,
    repository: input.repository ? trim(input.repository) : null,
    ignore_profile_hash: input.ignoreProfileHash ? trim(input.ignoreProfileHash) : null,
    created_at: createdAt,
  });

  const key = r2Key(workspaceId, snapshotId);
  await r2.put(key, JSON.stringify(doc), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      root_hash: snapshot.rootHash,
      leaf_hash_domain: leafDomain,
      source: doc.source,
    },
  });

  await env.DB.prepare(
    `INSERT INTO agentsam_fs_merkle_snapshots (
       snapshot_id, workspace_id, root_hash, created_at, source,
       leaf_hash_domain, resolved_commit_sha, resolved_tree_sha,
       repository, r2_key, ignore_profile_hash, reference_label
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(snapshot_id) DO UPDATE SET
       root_hash = excluded.root_hash,
       source = excluded.source,
       leaf_hash_domain = excluded.leaf_hash_domain,
       resolved_commit_sha = excluded.resolved_commit_sha,
       resolved_tree_sha = excluded.resolved_tree_sha,
       repository = excluded.repository,
       r2_key = excluded.r2_key,
       ignore_profile_hash = excluded.ignore_profile_hash,
       reference_label = excluded.reference_label`,
  )
    .bind(
      snapshotId,
      workspaceId,
      snapshot.rootHash,
      createdAt,
      doc.source,
      leafDomain,
      doc.resolved_commit_sha,
      doc.resolved_tree_sha,
      doc.repository,
      key,
      doc.ignore_profile_hash,
      snapshot.reference || null,
    )
    .run();

  return {
    snapshot_id: snapshotId,
    root_hash: snapshot.rootHash,
    leaf_hash_domain: leafDomain,
    r2_key: key,
    created_at: createdAt,
    document: doc,
  };
}

/** Load full snapshot document from R2 via D1 index. */
export async function loadFsMerkleSnapshot(env, { workspaceId, snapshotId }) {
  const wid = trim(workspaceId);
  const sid = trim(snapshotId);
  if (!wid || !sid) throw new Error('fs_merkle_snapshot_id_required');
  if (!env?.DB) throw new Error('fs_merkle_d1_unavailable');
  const row = await env.DB.prepare(
    `SELECT snapshot_id, workspace_id, root_hash, created_at, source,
            leaf_hash_domain, resolved_commit_sha, resolved_tree_sha,
            repository, r2_key, ignore_profile_hash, reference_label
     FROM agentsam_fs_merkle_snapshots
     WHERE snapshot_id = ? AND workspace_id = ?
     LIMIT 1`,
  )
    .bind(sid, wid)
    .first();
  if (!row) throw new Error('fs_merkle_snapshot_not_found');

  const r2 = r2Binding(env);
  if (!r2?.get) throw new Error('fs_merkle_r2_unavailable');
  const obj = await r2.get(String(row.r2_key));
  if (!obj) throw new Error('fs_merkle_snapshot_r2_missing');
  const document = await obj.json();
  return {
    index: row,
    document,
    snapshot: {
      version: document.version,
      reference: document.reference || row.reference_label,
      leafHashDomain: document.leaf_hash_domain || row.leaf_hash_domain,
      rootHash: document.root_hash || row.root_hash,
      root: document.root,
      nodes: document.nodes || [],
    },
  };
}

/** Thin index list for Snapshot UI (no R2 prefix scan). */
export async function listFsMerkleSnapshots(env, { workspaceId, limit = 40 }) {
  const wid = trim(workspaceId);
  if (!wid) throw new Error('fs_merkle_workspace_required');
  if (!env?.DB) throw new Error('fs_merkle_d1_unavailable');
  const lim = Math.min(100, Math.max(1, Number(limit) || 40));
  const { results } = await env.DB.prepare(
    `SELECT snapshot_id, workspace_id, root_hash, created_at, source,
            leaf_hash_domain, resolved_commit_sha, resolved_tree_sha,
            repository, reference_label
     FROM agentsam_fs_merkle_snapshots
     WHERE workspace_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(wid, lim)
    .all();
  return results || [];
}

export async function deleteFsMerkleSnapshot(env, { workspaceId, snapshotId }) {
  const loaded = await loadFsMerkleSnapshot(env, { workspaceId, snapshotId }).catch(() => null);
  if (loaded?.index?.r2_key) {
    const r2 = r2Binding(env);
    await r2?.delete?.(String(loaded.index.r2_key)).catch(() => null);
  }
  await env.DB.prepare(
    `DELETE FROM agentsam_fs_merkle_snapshots WHERE snapshot_id = ? AND workspace_id = ?`,
  )
    .bind(trim(snapshotId), trim(workspaceId))
    .run();
  return { ok: true, snapshot_id: trim(snapshotId) };
}

export { r2Key as merkleSnapshotR2Key };
