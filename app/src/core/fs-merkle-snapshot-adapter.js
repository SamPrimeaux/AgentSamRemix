/**
 * Thin Snapshot list + Agent Sam scope adapters for Swarm A.
 * Pure functions over compare results — no UI chrome.
 */

function changeStateByPath(comparison) {
  return new Map(comparison.changedPaths.map((change) => [change.path, change]));
}

/**
 * Adapts a Merkle compare result into width-agnostic Snapshot rows.
 * Unchanged directories from `unchangedCollapsedHints` stay collapsed (one row).
 * Deleted paths absent from the current tree are appended.
 */
export function adaptFsMerkleComparisonToRows(result, options = {}) {
  if (!result?.current?.root || !result?.comparison) {
    throw new Error('fs_merkle_adapter_result_required');
  }
  const collapseUnchanged = options.collapseUnchanged !== false;
  const byPath = changeStateByPath(result.comparison);
  const collapsed = new Set(
    collapseUnchanged ? result.comparison.unchangedCollapsedHints : [],
  );
  const rows = [];
  const emitted = new Set();

  const visit = (node, depth) => {
    const change = byPath.get(node.path);
    const isCollapsed = node.kind === 'directory' && collapsed.has(node.path);
    rows.push({
      id: node.path || '__root__',
      path: node.path,
      name: node.name || '/',
      kind: node.kind,
      depth,
      state: change?.state ?? 'unchanged',
      currentHash: change?.currentHash ?? node.hash,
      baselineHash: change?.baselineHash ?? (change ? null : node.hash),
      collapsedUnchanged: isCollapsed,
    });
    emitted.add(node.path);
    if (node.kind !== 'directory' || isCollapsed) return;
    for (const child of node.children ?? []) visit(child, depth + 1);
  };

  visit(result.current.root, 0);

  for (const change of result.comparison.changedPaths) {
    if (change.state !== 'deleted' || emitted.has(change.path)) continue;
    const parts = change.path.split('/');
    rows.push({
      id: change.path,
      path: change.path,
      name: parts.at(-1) || change.path,
      kind: change.kind,
      depth: parts.length,
      state: 'deleted',
      currentHash: null,
      baselineHash: change.baselineHash,
      collapsedUnchanged: false,
    });
    emitted.add(change.path);
  }

  return rows;
}

/** Thin Agent Sam attach payload for a selected Snapshot / Changes path. */
export function buildFsChangeScopePayload({ path, state, comparison, descendantPaths }) {
  if (!comparison?.currentRoot || !comparison?.baselineRoot) {
    throw new Error('fs_merkle_scope_comparison_required');
  }
  const scopedPath = typeof path === 'string' ? path : '';
  const changedUnder = comparison.changedPaths
    .map((change) => change.path)
    .filter((candidate) => {
      if (!scopedPath) return candidate !== '';
      return candidate === scopedPath || candidate.startsWith(`${scopedPath}/`);
    });
  return {
    kind: 'fs_change_scope',
    path: scopedPath,
    state,
    baseline: comparison.baselineReference,
    current_root: comparison.currentRoot,
    previous_root: comparison.baselineRoot,
    changed_paths: descendantPaths ?? changedUnder,
  };
}
