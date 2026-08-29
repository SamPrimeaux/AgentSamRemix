/** Local workspace file tree — lazy dirs + flat rows for virtual scroll. */

export const LOCAL_TREE_SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.cache',
  '.turbo',
]);

export const LOCAL_TREE_ROW_HEIGHT_PX = 28;

export interface LocalFileNode {
  name: string;
  kind: 'file' | 'directory';
  handle: FileSystemHandle;
  children?: LocalFileNode[];
  isOpen?: boolean;
  loading?: boolean;
}

export type LocalFileTreeRow =
  | {
      type: 'entry';
      id: string;
      node: LocalFileNode;
      depth: number;
      pathPrefix: string;
    }
  | {
      type: 'loading';
      id: string;
      depth: number;
      label: string;
    }
  | {
      type: 'empty';
      id: string;
      depth: number;
      label: string;
    };

export function nodePathFromParts(pathPrefix: string, name: string): string {
  return pathPrefix ? `${pathPrefix}/${name}` : name;
}

/**
 * Paths under the connected folder are relative to the FSA root handle.
 * The root row keeps `id = root.name` for display; children do NOT prefix that name
 * (so open/Save/agent tools use `transport-proof.txt`, not `agent-sandboxes/transport-proof.txt`).
 */
export function findLocalNodeByPath(
  current: LocalFileNode,
  targetPath: string,
  pathPrefix = '',
  isRoot = true,
): LocalFileNode | null {
  const target = String(targetPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');

  if (isRoot) {
    if (!target || target === '.' || target === current.name) return current;
    if (!current.children?.length) return null;
    for (const child of current.children) {
      const found = findLocalNodeByPath(child, target, '', false);
      if (found) return found;
    }
    return null;
  }

  const currentPath = nodePathFromParts(pathPrefix, current.name);
  if (currentPath === target) return current;
  if (!current.children?.length) return null;
  for (const child of current.children) {
    const found = findLocalNodeByPath(child, target, currentPath, false);
    if (found) return found;
  }
  return null;
}

export function mapLocalNodeByPath(
  node: LocalFileNode,
  targetPath: string,
  pathPrefix: string,
  fn: (n: LocalFileNode) => LocalFileNode,
  isRoot = true,
): LocalFileNode {
  const target = String(targetPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');

  if (isRoot) {
    if (!target || target === '.' || target === node.name) return fn({ ...node });
    if (!node.children?.length) return node;
    let changed = false;
    const nextChildren = node.children.map((ch) => {
      const nc = mapLocalNodeByPath(ch, target, '', fn, false);
      if (nc !== ch) changed = true;
      return nc;
    });
    if (!changed) return node;
    return { ...node, children: nextChildren };
  }

  const currentPath = nodePathFromParts(pathPrefix, node.name);
  if (currentPath === target) return fn({ ...node });
  if (!node.children?.length) return node;
  let changed = false;
  const nextChildren = node.children.map((ch) => {
    const nc = mapLocalNodeByPath(ch, target, currentPath, fn, false);
    if (nc !== ch) changed = true;
    return nc;
  });
  if (!changed) return node;
  return { ...node, children: nextChildren };
}

/** Visible rows only (expanded branches); safe for 10k+ total files when most are collapsed. */
export function flattenVisibleLocalFileTree(
  node: LocalFileNode,
  depth = 0,
  pathPrefix = '',
  isRoot = true,
): LocalFileTreeRow[] {
  // Root: display id = folder name; children paths start empty (FSA-relative).
  const nodePath = isRoot ? node.name : nodePathFromParts(pathPrefix, node.name);
  const rows: LocalFileTreeRow[] = [
    { type: 'entry', id: nodePath, node, depth, pathPrefix: isRoot ? '' : pathPrefix },
  ];

  if (node.kind !== 'directory' || !node.isOpen) return rows;

  if (node.loading) {
    rows.push({
      type: 'loading',
      id: `${nodePath}/__loading__`,
      depth: depth + 1,
      label: 'Loading…',
    });
    return rows;
  }

  if (!node.children?.length) {
    rows.push({
      type: 'empty',
      id: `${nodePath}/__empty__`,
      depth: depth + 1,
      label: '(empty)',
    });
    return rows;
  }

  const childPrefix = isRoot ? '' : nodePath;
  for (const child of node.children) {
    rows.push(...flattenVisibleLocalFileTree(child, depth + 1, childPrefix, false));
  }
  return rows;
}

export async function readLocalDirectoryEntries(
  dirHandle: FileSystemDirectoryHandle,
): Promise<LocalFileNode[]> {
  const entries: LocalFileNode[] = [];
  for await (const entry of dirHandle.values()) {
    if (LOCAL_TREE_SKIP_DIR_NAMES.has(entry.name)) continue;
    entries.push({
      name: entry.name,
      kind: entry.kind === 'directory' ? 'directory' : 'file',
      handle: entry,
      isOpen: false,
    });
  }
  return entries.sort((a, b) => {
    if (a.kind === b.kind) return a.name.localeCompare(b.name);
    return a.kind === 'directory' ? -1 : 1;
  });
}
