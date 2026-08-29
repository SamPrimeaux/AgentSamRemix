/**
 * Persist Monaco / agent buffers into the connected Local FSA folder.
 * Used when Save has a relative path but no FileSystemFileHandle yet.
 */
import {
  loadPersistedLocalDirectoryHandle,
  resolveLocalSubdirectoryHandle,
} from './localHandleStore';

export type WriteConnectedLocalResult =
  | {
      ok: true;
      handle: FileSystemFileHandle;
      workspacePath: string;
      rootName: string;
      bytes: number;
    }
  | { ok: false; error: string; hint?: string };

type HandleWithPermission = FileSystemDirectoryHandle & {
  queryPermission?: (o: { mode: string }) => Promise<string>;
  requestPermission?: (o: { mode: string }) => Promise<string>;
};

/** Query-only — safe to call outside a user gesture (no prompt). */
async function hasReadWritePermission(root: FileSystemDirectoryHandle): Promise<boolean> {
  const h = root as HandleWithPermission;
  if (typeof h.queryPermission !== 'function') return true;
  const state = await h.queryPermission({ mode: 'readwrite' });
  return state === 'granted';
}

async function ensureReadWrite(root: FileSystemDirectoryHandle): Promise<boolean> {
  const h = root as HandleWithPermission;
  if (typeof h.queryPermission !== 'function') return true;
  let state = await h.queryPermission({ mode: 'readwrite' });
  if (state === 'granted') return true;
  if (typeof h.requestPermission !== 'function') return false;
  // Must run under Save click (user activation).
  state = await h.requestPermission({ mode: 'readwrite' });
  return state === 'granted';
}

/**
 * Normalize ActiveFile workspacePath/name into a path relative to the Local root.
 * Strips plan/agent-draft prefixes so Save can land on disk.
 */
export function localSaveRelPath(input: {
  workspacePath?: string | null;
  name?: string | null;
  /** Connected Local folder basename — strip if path still includes it. */
  rootName?: string | null;
}): string | null {
  let wp = String(input.workspacePath || '').trim();
  if (wp.startsWith('agent-draft:')) {
    // agent-draft:<planId>:<rel/path>
    const rest = wp.slice('agent-draft:'.length);
    const colon = rest.indexOf(':');
    wp = colon >= 0 ? rest.slice(colon + 1) : '';
  }
  if (
    wp.startsWith('mcp_tool:') ||
    wp.startsWith('plan_d1:') ||
    wp.startsWith('plan:') ||
    wp.startsWith('r2://') ||
    wp.startsWith('github://')
  ) {
    return null;
  }
  wp = wp
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
  const root = String(input.rootName || '').trim();
  if (root && (wp === root || wp.startsWith(`${root}/`))) {
    wp = wp === root ? '' : wp.slice(root.length + 1);
  }
  if (!wp || wp.includes('..')) {
    const name = String(input.name || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!name || name.includes('..') || name.includes('/')) return null;
    return name;
  }
  if (wp.split('/').some((p) => p === '..' || p === '')) return null;
  return wp;
}

export async function writeConnectedLocalFile(
  relPath: string,
  content: string,
  opts?: {
    createDirs?: boolean;
    /**
     * When true, never calls requestPermission (which prompts / needs a user
     * gesture) — only writes if readwrite access is already granted. Use for
     * background/auto-save paths triggered outside a click handler (e.g. SSE
     * plan materialize); soft no-op on 'local_folder_permission_denied'.
     */
    requireExistingPermission?: boolean;
  },
): Promise<WriteConnectedLocalResult> {
  const path = localSaveRelPath({ workspacePath: relPath, name: relPath.split('/').pop() });
  if (!path) {
    return {
      ok: false,
      error: 'invalid_local_path',
      hint: 'Path must be relative to the connected Local folder (no ..).',
    };
  }

  const root = await loadPersistedLocalDirectoryHandle();
  if (!root) {
    return {
      ok: false,
      error: 'local_folder_not_connected',
      hint: 'Connect a Local folder in Files, then Save again.',
    };
  }

  const okPerm = opts?.requireExistingPermission
    ? await hasReadWritePermission(root)
    : await ensureReadWrite(root);
  if (!okPerm) {
    return {
      ok: false,
      error: 'local_folder_permission_denied',
      hint: 'Click Reconnect on Local to grant read/write, then Save again.',
    };
  }

  const parts = path.split('/').filter(Boolean);
  const name = parts.pop() || '';
  if (!name) {
    return { ok: false, error: 'path_required' };
  }
  const dir = parts.join('/');
  const createDirs = opts?.createDirs !== false;
  const parent = dir
    ? await resolveLocalSubdirectoryHandle(root, dir, { create: createDirs })
    : root;
  if (!parent) {
    return {
      ok: false,
      error: 'parent_not_found',
      hint: `Could not create/open "${dir}" under Local folder "${root.name}".`,
    };
  }

  try {
    const fileHandle = await parent.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content ?? '');
    await writable.close();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('iam:local_fs_file_written', {
          detail: { path, rootName: root.name, bytes: String(content ?? '').length },
        }),
      );
    }
    return {
      ok: true,
      handle: fileHandle,
      workspacePath: path,
      rootName: root.name,
      bytes: String(content ?? '').length,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'local_write_failed',
    };
  }
}
