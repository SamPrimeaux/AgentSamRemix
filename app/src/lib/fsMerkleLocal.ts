/**
 * Chromium File System Access → fs-merkle-v1 Snapshot inputs (Slice 3b).
 * Reuses the connected local FSA directory handle — no second picker.
 */

import { LOCAL_TREE_SKIP_DIR_NAMES } from './localFileTree';
import {
  buildFsMerkleSnapshot,
  type FsMerkleFileInput,
  type FsMerkleSnapshot,
} from './fsMerkleSnapshot';

export type LocalMerkleHashMode = 'git_blob_sha1' | 'raw_sha256';

export type LocalMerkleWalkLimits = {
  maxFiles?: number;
  maxDepth?: number;
  maxSingleFileBytes?: number;
  skipDirNames?: Set<string>;
};

const DEFAULT_LIMITS: Required<LocalMerkleWalkLimits> = {
  maxFiles: 20_000,
  maxDepth: 32,
  maxSingleFileBytes: 32 * 1024 * 1024,
  skipDirNames: LOCAL_TREE_SKIP_DIR_NAMES,
};

function asHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function gitBlobSha1(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const combined = new Uint8Array(header.byteLength + bytes.byteLength);
  combined.set(header, 0);
  combined.set(bytes, header.byteLength);
  return asHex(await crypto.subtle.digest('SHA-1', combined));
}

async function rawSha256(bytes: Uint8Array): Promise<string> {
  return asHex(await crypto.subtle.digest('SHA-256', bytes));
}

/**
 * Walk a FileSystemDirectoryHandle into Merkle file inputs.
 */
export async function walkLocalDirectoryHandle(
  root: FileSystemDirectoryHandle,
  options: {
    hashMode?: LocalMerkleHashMode;
    limits?: LocalMerkleWalkLimits;
  } = {},
): Promise<{
  entries: FsMerkleFileInput[];
  leafHashDomain: LocalMerkleHashMode;
  truncated: boolean;
  fileCount: number;
}> {
  if (!root || root.kind !== 'directory') {
    throw new Error('local_merkle_directory_handle_required');
  }
  if (typeof crypto?.subtle?.digest !== 'function') {
    throw new Error('local_merkle_webcrypto_unavailable');
  }

  const hashMode = options.hashMode || 'git_blob_sha1';
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const skip = limits.skipDirNames || DEFAULT_LIMITS.skipDirNames;
  const entries: FsMerkleFileInput[] = [];
  let truncated = false;

  const visit = async (
    dir: FileSystemDirectoryHandle,
    prefix: string,
    depth: number,
  ): Promise<void> => {
    if (truncated) return;
    if (depth > limits.maxDepth) return;
    for await (const entry of dir.values()) {
      if (truncated) return;
      if (skip.has(entry.name)) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        await visit(entry as FileSystemDirectoryHandle, path, depth + 1);
        continue;
      }
      if (entry.kind !== 'file') continue;
      if (entries.length >= limits.maxFiles) {
        truncated = true;
        return;
      }
      const file = await (entry as FileSystemFileHandle).getFile();
      if (file.size > limits.maxSingleFileBytes) continue;
      const buf = new Uint8Array(await file.arrayBuffer());
      if (hashMode === 'git_blob_sha1') {
        const sha = await gitBlobSha1(buf);
        entries.push({ kind: 'file', path, trustedGitBlobSha: sha });
      } else {
        entries.push({ kind: 'file', path, bytes: buf });
      }
    }
  };

  await visit(root, '', 0);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    entries,
    leafHashDomain: hashMode,
    truncated,
    fileCount: entries.length,
  };
}

/** Build an in-browser Snapshot from the connected FSA handle. */
export async function buildLocalFsMerkleSnapshot(
  root: FileSystemDirectoryHandle,
  options: {
    reference?: string;
    hashMode?: LocalMerkleHashMode;
    limits?: LocalMerkleWalkLimits;
  } = {},
): Promise<{
  snapshot: FsMerkleSnapshot;
  leafHashDomain: LocalMerkleHashMode;
  truncated: boolean;
  fileCount: number;
}> {
  const walked = await walkLocalDirectoryHandle(root, {
    hashMode: options.hashMode,
    limits: options.limits,
  });
  const snapshot = await buildFsMerkleSnapshot({
    reference: options.reference || root.name || 'local',
    entries: walked.entries,
    leafHashDomain: walked.leafHashDomain,
  });
  return {
    snapshot,
    leafHashDomain: walked.leafHashDomain,
    truncated: walked.truncated,
    fileCount: walked.fileCount,
  };
}

/**
 * Persist a local Snapshot via Worker API (entries already hashed client-side).
 */
export async function persistLocalFsMerkleSnapshot(input: {
  workspaceId: string;
  reference?: string;
  entries: FsMerkleFileInput[];
  leafHashDomain: LocalMerkleHashMode;
  fetchImpl?: typeof fetch;
}): Promise<{ snapshot_id: string; root_hash: string; leaf_hash_domain: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl('/api/agent/merkle/build', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(input.workspaceId ? { 'X-IAM-Workspace-Id': input.workspaceId } : {}),
    },
    body: JSON.stringify({
      source: 'local',
      workspace_id: input.workspaceId,
      reference: input.reference || 'local',
      leaf_hash_domain: input.leafHashDomain,
      entries: input.entries,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    snapshot_id?: string;
    root_hash?: string;
    leaf_hash_domain?: string;
  };
  if (!res.ok || !body.ok || !body.snapshot_id || !body.root_hash) {
    throw new Error(body.error || `local_merkle_persist_failed:${res.status}`);
  }
  return {
    snapshot_id: body.snapshot_id,
    root_hash: body.root_hash,
    leaf_hash_domain: body.leaf_hash_domain || input.leafHashDomain,
  };
}
