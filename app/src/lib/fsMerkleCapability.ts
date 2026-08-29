/**
 * Merkle Snapshot capability export for Swarm A mode chrome.
 * Honest: github when repository is known; local when FSA handle is connected.
 */

export type FsMerkleCapabilityInput = {
  source?: string | null;
  repository?: string | null;
  /** True when the Files rail has an active FileSystemDirectoryHandle. */
  hasLocalDirectoryHandle?: boolean | null;
};

/**
 * Capability present for Snapshot tab chrome (Swarm A gates on this + modes flag).
 * No-arg form = Snapshot data lane is shipped (true).
 * With source context = whether a build can actually run for that source.
 */
export function canUseFsMerkleSnapshot(input?: FsMerkleCapabilityInput): boolean {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') return false;

  // No context → capability module is live (A shows Snapshot tab when modes ON).
  if (!input || input.source == null || input.source === '') return true;

  const source = String(input.source).trim().toLowerCase();
  if (source === 'github') {
    const repo = input.repository != null ? String(input.repository).trim() : '';
    return /^[^/\s]+\/[^/\s]+$/.test(repo);
  }
  if (source === 'local') {
    return input.hasLocalDirectoryHandle === true;
  }
  // R2 / drive / container — not Snapshot sources in V1.
  return false;
}

export const FS_MERKLE_SNAPSHOT_CAPABILITY = Object.freeze({
  version: 'fs-merkle-v1' as const,
  sources: ['github', 'local'] as const,
  supportsWorkingTree: true,
  supportsRefComparison: true,
  supportsLocalFsa: true,
  apis: [
    '/api/agent/merkle/build',
    '/api/agent/merkle/get',
    '/api/agent/merkle/compare',
    '/api/agent/merkle/explain',
    '/api/agent/merkle/list',
    '/api/agent/merkle/delete',
  ] as const,
});
