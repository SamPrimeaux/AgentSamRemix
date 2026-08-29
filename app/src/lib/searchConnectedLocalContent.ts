/**
 * Workspace text search under the connected File System Access folder.
 * Powers Cmd+K `#` (Search for text) — browser-side, not Monaco find-in-file.
 */
import {
  LOCAL_TREE_SKIP_DIR_NAMES,
  readLocalDirectoryEntries,
} from './localFileTree';
import {
  loadPersistedLocalDirectoryHandle,
  queryLocalReadPermission,
} from './library/localHandleStore';

export type ConnectedContentHit = {
  path: string;
  name: string;
  rootName: string;
  line: number;
  column: number;
  preview: string;
};

const MAX_HITS = 40;
const MAX_DIRS = 400;
const MAX_DEPTH = 8;
const MAX_FILES_SCANNED = 600;
const MAX_FILE_BYTES = 400_000;

const TEXT_EXT = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'json',
  'jsonc',
  'md',
  'mdx',
  'txt',
  'css',
  'scss',
  'less',
  'html',
  'htm',
  'svg',
  'xml',
  'yml',
  'yaml',
  'toml',
  'sql',
  'sh',
  'bash',
  'zsh',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'vue',
  'svelte',
  'astro',
  'env',
  'gitignore',
  'dockerignore',
  'editorconfig',
  'conf',
  'ini',
  'csv',
  'tsv',
]);

function extOf(name: string): string {
  const base = name.split('/').pop() || name;
  if (base.startsWith('.') && !base.slice(1).includes('.')) {
    return base.slice(1).toLowerCase(); // .gitignore → gitignore
  }
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i + 1).toLowerCase() : '';
}

function isSearchableFile(name: string): boolean {
  const ext = extOf(name);
  if (TEXT_EXT.has(ext)) return true;
  // Extensionless common roots
  const lower = name.toLowerCase();
  return (
    lower === 'dockerfile' ||
    lower === 'makefile' ||
    lower === 'license' ||
    lower.endsWith('/dockerfile') ||
    lower.endsWith('/makefile')
  );
}

/**
 * Case-insensitive substring search across connected local text files.
 */
export async function searchConnectedLocalContent(
  searchTerm: string,
): Promise<{
  hits: ConnectedContentHit[];
  connected: boolean;
  permission: string;
  scanned: number;
}> {
  const needle = String(searchTerm || '').trim();
  if (!needle || needle.length < 2) {
    return { hits: [], connected: false, permission: 'none', scanned: 0 };
  }

  const root = await loadPersistedLocalDirectoryHandle();
  if (!root) {
    return { hits: [], connected: false, permission: 'none', scanned: 0 };
  }
  const perm = await queryLocalReadPermission(root);
  if (perm !== 'granted' && perm !== 'unsupported') {
    return { hits: [], connected: true, permission: perm, scanned: 0 };
  }

  const needleLc = needle.toLowerCase();
  const rootName = root.name || 'local';
  const hits: ConnectedContentHit[] = [];
  const queue: { handle: FileSystemDirectoryHandle; prefix: string; depth: number }[] = [
    { handle: root, prefix: '', depth: 0 },
  ];
  let dirsVisited = 0;
  let scanned = 0;

  while (
    queue.length &&
    hits.length < MAX_HITS &&
    dirsVisited < MAX_DIRS &&
    scanned < MAX_FILES_SCANNED
  ) {
    const cur = queue.shift();
    if (!cur) break;
    dirsVisited += 1;
    let children;
    try {
      children = await readLocalDirectoryEntries(cur.handle);
    } catch {
      continue;
    }
    for (const child of children) {
      if (hits.length >= MAX_HITS) break;
      const path = cur.prefix ? `${cur.prefix}/${child.name}` : child.name;
      if (child.kind === 'directory') {
        if (cur.depth >= MAX_DEPTH) continue;
        if (LOCAL_TREE_SKIP_DIR_NAMES.has(child.name)) continue;
        if (child.name.startsWith('.') && child.name !== '.agents' && child.name !== '.cursor') {
          continue;
        }
        queue.push({
          handle: child.handle as FileSystemDirectoryHandle,
          prefix: path,
          depth: cur.depth + 1,
        });
        continue;
      }
      if (!isSearchableFile(child.name)) continue;
      scanned += 1;
      try {
        const file = await (child.handle as FileSystemFileHandle).getFile();
        if (file.size > MAX_FILE_BYTES) continue;
        // Skip likely binary
        if (file.type && !/^(text\/|application\/(json|javascript|xml|typescript)|image\/svg)/i.test(file.type) && file.type !== '') {
          if (!/^application\/octet-stream$/i.test(file.type) && file.type.length > 0) {
            // allow empty type; reject known non-text
            if (/^(image|audio|video|font)\//i.test(file.type)) continue;
          }
        }
        const text = await file.text();
        if (!text || text.includes('\0')) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const idx = line.toLowerCase().indexOf(needleLc);
          if (idx < 0) continue;
          const preview = line.trim().slice(0, 160);
          hits.push({
            path,
            name: child.name,
            rootName,
            line: i + 1,
            column: idx + 1,
            preview,
          });
          if (hits.length >= MAX_HITS) break;
        }
      } catch {
        /* unreadable */
      }
    }
  }

  return { hits, connected: true, permission: String(perm), scanned };
}
