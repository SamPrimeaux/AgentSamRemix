const FS_MERKLE_VERSION = 'fs-merkle-v1';
const FULL_GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** @typedef {'git_blob_sha1' | 'git_blob_sha256' | 'raw_sha256'} MerkleHashDomain */

export const MERKLE_HASH_DOMAINS = Object.freeze([
  'git_blob_sha1',
  'git_blob_sha256',
  'raw_sha256',
]);

/**
 * @param {unknown} value
 * @returns {MerkleHashDomain}
 */
export function normalizeMerkleHashDomain(value) {
  const domain = typeof value === 'string' ? value.trim() : '';
  if (!MERKLE_HASH_DOMAINS.includes(domain)) {
    throw new Error(`fs_merkle_invalid_hash_domain:${String(value)}`);
  }
  return /** @type {MerkleHashDomain} */ (domain);
}

/**
 * Infer leaf domain from entry content mode when caller omits leafHashDomain.
 * @param {Array<{ trustedGitBlobSha?: string, bytes?: unknown }>} entries
 * @returns {MerkleHashDomain}
 */
export function inferLeafHashDomain(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return 'raw_sha256';
  const hasGit = entries.some((e) => e && Object.hasOwn(e, 'trustedGitBlobSha'));
  const hasBytes = entries.some((e) => e && Object.hasOwn(e, 'bytes'));
  if (hasGit && !hasBytes) return 'git_blob_sha1';
  if (hasBytes && !hasGit) return 'raw_sha256';
  throw new Error('fs_merkle_mixed_leaf_content_modes');
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertReference(reference) {
  if (typeof reference !== 'string' || !reference.trim()) {
    throw new Error('fs_merkle_reference_required');
  }
  return reference.trim();
}

function normalizePath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.endsWith('/')) {
    throw new Error(`fs_merkle_invalid_path:${String(path)}`);
  }
  if (path.includes('\\') || path.includes('\0')) {
    throw new Error(`fs_merkle_invalid_path:${path}`);
  }
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`fs_merkle_invalid_path:${path}`);
  }
  return parts.join('/');
}

function normalizeTrustedGitBlobSha(value) {
  if (typeof value !== 'string') throw new Error('fs_merkle_invalid_git_blob_sha');
  const sha = value.toLowerCase();
  if (!FULL_GIT_OBJECT_ID.test(sha)) throw new Error(`fs_merkle_invalid_git_blob_sha:${value}`);
  return sha;
}

function asBytes(content) {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return Uint8Array.from(content);
  if (content instanceof ArrayBuffer) return new Uint8Array(content.slice(0));
  throw new Error('fs_merkle_file_bytes_required');
}

export async function sha256Hex(content) {
  if (!globalThis.crypto?.subtle) throw new Error('fs_merkle_webcrypto_unavailable');
  const bytes = asBytes(content);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Canonical V1 directory serialization. Property order is fixed and child order
 * uses direct code-unit comparison (never locale-dependent comparison).
 */
export function canonicalMerkleDirectoryJson(children) {
  if (!Array.isArray(children)) throw new Error('fs_merkle_children_array_required');
  const normalized = children.map((child) => {
    if (!child || typeof child.name !== 'string' || !child.name || child.name.includes('/')) {
      throw new Error('fs_merkle_invalid_child_name');
    }
    const hash = String(child.hash || '').toLowerCase();
    if (!FULL_GIT_OBJECT_ID.test(hash)) throw new Error(`fs_merkle_invalid_child_hash:${child.name}`);
    return { name: child.name, hash };
  }).sort((a, b) => compareText(a.name, b.name));

  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i - 1].name === normalized[i].name) {
      throw new Error(`fs_merkle_duplicate_child:${normalized[i].name}`);
    }
  }
  return JSON.stringify(normalized);
}

function newDirectory(name, path) {
  return { name, path, kind: 'directory', hash: '', hashAlgorithm: 'sha256', children: [] };
}

function findChild(directory, name) {
  return directory.children.find((child) => child.name === name);
}

async function insertFile(root, rawEntry) {
  if (!rawEntry || rawEntry.kind !== 'file') throw new Error('fs_merkle_file_entry_required');
  const path = normalizePath(rawEntry.path);
  const hasBytes = Object.hasOwn(rawEntry, 'bytes');
  const hasGitSha = Object.hasOwn(rawEntry, 'trustedGitBlobSha');
  if (hasBytes === hasGitSha) throw new Error(`fs_merkle_file_content_ambiguous:${path}`);

  const parts = path.split('/');
  let directory = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const name = parts[i];
    const directoryPath = parts.slice(0, i + 1).join('/');
    const existing = findChild(directory, name);
    if (existing?.kind === 'file') throw new Error(`fs_merkle_path_conflict:${directoryPath}`);
    if (existing) {
      directory = existing;
    } else {
      const created = newDirectory(name, directoryPath);
      directory.children.push(created);
      directory = created;
    }
  }

  const name = parts.at(-1);
  if (findChild(directory, name)) throw new Error(`fs_merkle_duplicate_path:${path}`);
  const hash = hasGitSha
    ? normalizeTrustedGitBlobSha(rawEntry.trustedGitBlobSha)
    : await sha256Hex(rawEntry.bytes);
  directory.children.push({
    name,
    path,
    kind: 'file',
    hash,
    hashAlgorithm: hasGitSha ? 'git-blob' : 'sha256',
  });
}

async function hashDirectory(directory) {
  directory.children.sort((a, b) => compareText(a.name, b.name));
  for (const child of directory.children) {
    if (child.kind === 'directory') await hashDirectory(child);
  }
  directory.hash = await sha256Hex(canonicalMerkleDirectoryJson(directory.children));
}

function flattenTree(root) {
  const nodes = [];
  const visit = (node) => {
    nodes.push({
      name: node.name,
      path: node.path,
      kind: node.kind,
      hash: node.hash,
      hashAlgorithm: node.hashAlgorithm,
      ...(node.kind === 'directory' ? { childCount: node.children.length } : {}),
    });
    if (node.kind === 'directory') node.children.forEach(visit);
  };
  visit(root);
  return nodes;
}

/**
 * Build a deterministic content-addressed tree from acquired file bytes or
 * trusted full-length Git blob object IDs.
 * Directory serialization stays fs-merkle-v1 (do not change).
 */
export async function buildFsMerkleSnapshot({ reference, entries, leafHashDomain }) {
  const normalizedReference = assertReference(reference);
  if (!Array.isArray(entries)) throw new Error('fs_merkle_entries_array_required');
  const domain = leafHashDomain != null
    ? normalizeMerkleHashDomain(leafHashDomain)
    : inferLeafHashDomain(entries);
  const root = newDirectory('', '');
  const sortedEntries = [...entries].sort((a, b) => compareText(String(a?.path), String(b?.path)));
  for (const entry of sortedEntries) await insertFile(root, entry);
  await hashDirectory(root);
  return {
    version: FS_MERKLE_VERSION,
    reference: normalizedReference,
    leafHashDomain: domain,
    rootHash: root.hash,
    root,
    nodes: flattenTree(root),
  };
}

function changedEntry(path, state, current, baseline) {
  return {
    path,
    kind: current?.kind ?? baseline?.kind,
    state,
    currentHash: current?.hash ?? null,
    baselineHash: baseline?.hash ?? null,
  };
}

function compareChildren(current, baseline, output) {
  output.comparedNodeCount += 1;
  if (current && baseline && current.kind === baseline.kind && current.hash === baseline.hash) {
    output.unchangedCollapsedHints.push(current.path);
    return;
  }

  const path = current?.path ?? baseline?.path ?? '';
  if (!current || !baseline) {
    const node = current ?? baseline;
    const state = current ? 'added' : 'deleted';
    output.changedPaths.push(changedEntry(path, state, current, baseline));
    if (node.kind === 'directory') {
      for (const child of node.children) {
        compareChildren(current ? child : null, baseline ? child : null, output);
      }
    }
    return;
  }

  output.changedPaths.push(changedEntry(path, 'modified', current, baseline));
  if (current.kind !== baseline.kind) {
    if (current.kind === 'directory') {
      for (const child of current.children) compareChildren(child, null, output);
    }
    if (baseline.kind === 'directory') {
      for (const child of baseline.children) compareChildren(null, child, output);
    }
    return;
  }
  if (current.kind === 'file') return;

  const currentChildren = new Map(current.children.map((child) => [child.name, child]));
  const baselineChildren = new Map(baseline.children.map((child) => [child.name, child]));
  const childNames = [...new Set([...currentChildren.keys(), ...baselineChildren.keys()])]
    .sort(compareText);
  for (const name of childNames) {
    compareChildren(currentChildren.get(name) ?? null, baselineChildren.get(name) ?? null, output);
  }
}

/**
 * Refuse cross-domain compare (no silent fake diff).
 * @returns {{ error: 'merkle_incompatible_hash_domain', base_domain: string, head_domain: string } | null}
 */
export function merkleIncompatibleHashDomainError(current, baseline) {
  const head = current?.leafHashDomain || current?.leaf_hash_domain || null;
  const base = baseline?.leafHashDomain || baseline?.leaf_hash_domain || null;
  if (!head || !base) return null;
  if (head === base) return null;
  return {
    error: 'merkle_incompatible_hash_domain',
    base_domain: String(base),
    head_domain: String(head),
  };
}

/** Compare two built snapshots, pruning traversal immediately at equal hashes. */
export function compareFsMerkleSnapshots(current, baseline) {
  if (current?.version !== FS_MERKLE_VERSION || baseline?.version !== FS_MERKLE_VERSION) {
    throw new Error('fs_merkle_snapshot_version_mismatch');
  }
  if (!current.root || !baseline.root) throw new Error('fs_merkle_snapshot_root_required');
  const domainErr = merkleIncompatibleHashDomainError(current, baseline);
  if (domainErr) {
    const err = new Error(domainErr.error);
    err.code = domainErr.error;
    err.base_domain = domainErr.base_domain;
    err.head_domain = domainErr.head_domain;
    throw err;
  }
  const output = {
    version: FS_MERKLE_VERSION,
    currentReference: current.reference,
    baselineReference: baseline.reference,
    currentRoot: current.rootHash,
    baselineRoot: baseline.rootHash,
    leafHashDomain: current.leafHashDomain || baseline.leafHashDomain || null,
    equal: current.rootHash === baseline.rootHash,
    comparedNodeCount: 0,
    changedPaths: [],
    unchangedCollapsedHints: [],
  };
  compareChildren(current.root, baseline.root, output);
  return output;
}

/**
 * Explain why a folder (or root) changed — V1 honest subset.
 * Does not claim pure-rename / moved-same-content.
 */
export function explainFsMerkleDiff(comparison, path = '') {
  if (!comparison?.changedPaths) throw new Error('fs_merkle_explain_comparison_required');
  const scoped = String(path || '');
  const under = comparison.changedPaths.filter((change) => {
    if (!scoped) return true;
    return change.path === scoped || change.path.startsWith(`${scoped}/`);
  });
  const counts = { added: 0, modified: 0, deleted: 0 };
  for (const change of under) {
    if (change.state === 'added') counts.added += 1;
    else if (change.state === 'modified') counts.modified += 1;
    else if (change.state === 'deleted') counts.deleted += 1;
  }
  return {
    version: FS_MERKLE_VERSION,
    path: scoped,
    equal: under.length === 0,
    current_root: comparison.currentRoot,
    previous_root: comparison.baselineRoot,
    counts,
    changed_paths: under,
    limitations: [
      'v1_no_pure_rename_detection',
      'v1_no_permission_or_symlink_states',
      'v1_no_empty_directory_tracking',
    ],
  };
}

export { FS_MERKLE_VERSION };
