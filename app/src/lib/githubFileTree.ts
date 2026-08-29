/**
 * GitHub repo file tree — lazy-load dirs, flat visible rows for VirtualizedFileTree.
 * Parallel to localFileTree.ts but backed by GitHub Contents API instead of FSAPI handles.
 */

export const GITHUB_TREE_ROW_HEIGHT_PX = 28;

export interface GithubFileNode {
  name: string;
  kind: 'file' | 'directory';
  /** Full path within the repo (e.g. "src/lib/foo.ts"). */
  path: string;
  sha?: string;
  size?: number;
  isOpen?: boolean;
  loading?: boolean;
  children?: GithubFileNode[];
}

export type GithubFileTreeRow =
  | { type: 'entry'; id: string; node: GithubFileNode; depth: number }
  | { type: 'loading'; id: string; depth: number; label: string }
  | { type: 'empty'; id: string; depth: number; label: string };

export function flattenVisibleGithubTree(
  node: GithubFileNode,
  depth = 0,
): GithubFileTreeRow[] {
  const rows: GithubFileTreeRow[] = [{ type: 'entry', id: node.path || node.name, node, depth }];

  if (node.kind !== 'directory' || !node.isOpen) return rows;

  if (node.loading) {
    rows.push({ type: 'loading', id: `${node.path}/__loading__`, depth: depth + 1, label: 'Loading…' });
    return rows;
  }

  if (!node.children?.length) {
    rows.push({ type: 'empty', id: `${node.path}/__empty__`, depth: depth + 1, label: '(empty)' });
    return rows;
  }

  for (const child of node.children) {
    rows.push(...flattenVisibleGithubTree(child, depth + 1));
  }
  return rows;
}

/** Immutably set a node's properties by path in the tree. */
export function mapGithubNodeByPath(
  node: GithubFileNode,
  targetPath: string,
  fn: (n: GithubFileNode) => GithubFileNode,
): GithubFileNode {
  if (node.path === targetPath) return fn({ ...node });
  if (!node.children?.length) return node;
  let changed = false;
  const next = node.children.map((ch) => {
    const nc = mapGithubNodeByPath(ch, targetPath, fn);
    if (nc !== ch) changed = true;
    return nc;
  });
  return changed ? { ...node, children: next } : node;
}

export function sortGithubChildren(nodes: GithubFileNode[]): GithubFileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
