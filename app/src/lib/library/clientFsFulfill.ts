/**
 * Browser FSA bridge — fulfill Agent Sam client_fs_request via IndexedDB directory handle.
 */
import {
  loadPersistedLocalDirectoryHandle,
  queryLocalReadPermission,
  resolveLocalSubdirectoryHandle,
} from './localHandleStore';
import { LOCAL_TREE_SKIP_DIR_NAMES, readLocalDirectoryEntries } from '../localFileTree';
import { searchConnectedLocalFiles } from '../searchConnectedLocalFiles';

export type ClientFsRequestPayload = {
  call_id?: string;
  callId?: string;
  path?: string;
  operation?: string;
  content?: string | null;
  query?: string | null;
  create_dirs?: boolean | number | string;
  createDirs?: boolean | number | string;
  conversation_id?: string;
  conversationId?: string;
};

type SearchMatch = { path: string; line: number | null; text: string };

const SEARCH_CONTENT_MAX_FILES = 80;
const SEARCH_CONTENT_MAX_BYTES = 256_000;
const SEARCH_CONTENT_MAX_MATCHES = 40;
const SEARCH_CONTENT_MAX_DEPTH = 8;

/** Strip connected-folder basename if the model prefixed it (tree used to include root.name). */
function normalizeRelPathUnderRoot(path: string, rootName: string): string {
  let p = String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
  const root = String(rootName || '').trim();
  if (root && (p === root || p.startsWith(`${root}/`))) {
    p = p === root ? '' : p.slice(root.length + 1);
  }
  return p;
}

function splitPath(path: string): { dir: string; name: string } {
  const cleaned = String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (!parts.length) return { dir: '', name: '' };
  const name = parts.pop() || '';
  return { dir: parts.join('/'), name };
}

function wantCreateDirs(evt: ClientFsRequestPayload): boolean {
  // Default true for agent writes — omit/false-only opt-out.
  if (
    evt.create_dirs === false ||
    evt.create_dirs === 0 ||
    evt.create_dirs === '0' ||
    evt.createDirs === false ||
    evt.createDirs === 0 ||
    evt.createDirs === '0'
  ) {
    return false;
  }
  return true;
}

async function ensureReadWrite(root: FileSystemDirectoryHandle): Promise<boolean> {
  const h = root as FileSystemDirectoryHandle & {
    queryPermission?: (o: { mode: string }) => Promise<string>;
    requestPermission?: (o: { mode: string }) => Promise<string>;
  };
  if (typeof h.queryPermission !== 'function') return true;
  let state = await h.queryPermission({ mode: 'readwrite' });
  if (state === 'granted') return true;
  if (typeof h.requestPermission !== 'function') {
    const read = await queryLocalReadPermission(root);
    return read === 'granted' || read === 'unsupported';
  }
  state = await h.requestPermission({ mode: 'readwrite' });
  return state === 'granted';
}

/**
 * Content substring scan under Local (Cursor Grep-lite). Complements filename Glob hits.
 */
async function searchLocalFileContents(
  root: FileSystemDirectoryHandle,
  query: string,
  pathPrefix: string,
): Promise<SearchMatch[]> {
  const needle = String(query || '');
  if (!needle) return [];
  const prefix = String(pathPrefix || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/$/, '');
  const start =
    prefix && prefix !== '.'
      ? await resolveLocalSubdirectoryHandle(root, prefix)
      : root;
  if (!start) return [];

  const matches: SearchMatch[] = [];
  const queue: { handle: FileSystemDirectoryHandle; prefix: string; depth: number }[] = [
    { handle: start, prefix, depth: 0 },
  ];
  let filesSeen = 0;

  while (queue.length && matches.length < SEARCH_CONTENT_MAX_MATCHES && filesSeen < SEARCH_CONTENT_MAX_FILES) {
    const cur = queue.shift();
    if (!cur) break;
    let children;
    try {
      children = await readLocalDirectoryEntries(cur.handle);
    } catch {
      continue;
    }
    for (const child of children) {
      if (matches.length >= SEARCH_CONTENT_MAX_MATCHES) break;
      const rel = cur.prefix ? `${cur.prefix}/${child.name}` : child.name;
      if (child.kind === 'directory') {
        if (cur.depth >= SEARCH_CONTENT_MAX_DEPTH) continue;
        if (LOCAL_TREE_SKIP_DIR_NAMES.has(child.name)) continue;
        if (child.name.startsWith('.') && child.name !== '.agents' && child.name !== '.cursor') {
          continue;
        }
        queue.push({
          handle: child.handle as FileSystemDirectoryHandle,
          prefix: rel,
          depth: cur.depth + 1,
        });
        continue;
      }
      filesSeen += 1;
      if (filesSeen > SEARCH_CONTENT_MAX_FILES) break;
      try {
        const file = await (child.handle as FileSystemFileHandle).getFile();
        if (file.size > SEARCH_CONTENT_MAX_BYTES) continue;
        const type = String(file.type || '');
        if (type && !type.startsWith('text/') && !/json|javascript|xml|svg|markdown|csv/.test(type)) {
          // Still try common source extensions with empty type.
          if (!/\.(md|txt|json|js|ts|tsx|jsx|css|html|sql|toml|yml|yaml|mjs|cjs|py|rs|go)$/i.test(child.name)) {
            continue;
          }
        }
        const text = await file.text();
        if (!text.includes(needle)) continue;
        const lines = text.replace(/\r\n/g, '\n').split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].includes(needle)) continue;
          matches.push({
            path: rel,
            line: i + 1,
            text: lines[i].trim().slice(0, 500),
          });
          if (matches.length >= SEARCH_CONTENT_MAX_MATCHES) break;
        }
      } catch {
        /* skip unreadable */
      }
    }
  }
  return matches;
}

/**
 * Execute a local FSA op and POST result to /api/agent/fs/fulfill.
 */
export async function fulfillClientFsRequest(
  evt: ClientFsRequestPayload,
  opts?: { conversationId?: string | null },
): Promise<void> {
  const callId = String(evt.call_id || evt.callId || '').trim();
  const conversationId = String(
    opts?.conversationId || evt.conversation_id || evt.conversationId || '',
  ).trim();
  if (!callId || !conversationId) return;

  const operation = String(evt.operation || 'read').toLowerCase();
  const pathRaw = String(evt.path || '').trim();
  const query = String(evt.query || '').trim();
  let path = pathRaw;
  let result: Record<string, unknown>;

  try {
    const root = await loadPersistedLocalDirectoryHandle();
    if (!root) {
      result = {
        ok: false,
        error: 'local_folder_not_connected',
        hint: 'Connect a local folder in Computers / Connections, then retry.',
        path: pathRaw,
        operation,
      };
    } else {
      path = normalizeRelPathUnderRoot(pathRaw, root.name);
      const okPerm = await ensureReadWrite(root);
      if (!okPerm) {
        result = {
          ok: false,
          error: 'local_folder_permission_denied',
          hint: 'Click Reconnect folder to grant read/write permission.',
          path,
          operation,
          root_name: root.name,
        };
      } else if (operation === 'search') {
        if (!query) {
          result = {
            ok: false,
            error: 'query_required',
            path,
            operation: 'search',
            root_name: root.name,
          };
        } else {
          const pathHits = await searchConnectedLocalFiles(query);
          const pathMatches: SearchMatch[] = (pathHits.hits || []).map((h) => ({
            path: h.path,
            line: null,
            text: `(path) ${h.name}`,
          }));
          const contentMatches = await searchLocalFileContents(root, query, path);
          const seen = new Set<string>();
          const hits: SearchMatch[] = [];
          for (const m of [...pathMatches, ...contentMatches]) {
            const key = `${m.path}:${m.line ?? 'p'}:${m.text.slice(0, 40)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            hits.push(m);
            if (hits.length >= SEARCH_CONTENT_MAX_MATCHES) break;
          }
          result = {
            ok: true,
            path: path || '.',
            operation: 'search',
            lane: 'client_fs',
            root_name: root.name,
            query,
            hits,
            matches: hits,
            count: hits.length,
          };
        }
      } else if (operation === 'list') {
        const dir = await resolveLocalSubdirectoryHandle(root, path);
        if (!dir) {
          result = { ok: false, error: 'path_not_found', path, operation, root_name: root.name };
        } else {
          const entries = await readLocalDirectoryEntries(dir);
          result = {
            ok: true,
            path,
            operation: 'list',
            root_name: root.name,
            entries: entries.map((e) => ({
              name: e.name,
              kind: e.kind,
              path: path ? `${path.replace(/\/$/, '')}/${e.name}` : e.name,
            })),
          };
        }
      } else if (operation === 'write') {
        const { dir, name } = splitPath(path);
        if (!name) {
          result = { ok: false, error: 'path_required', path, operation, root_name: root.name };
        } else {
          const createDirs = wantCreateDirs(evt);
          const parent = dir
            ? await resolveLocalSubdirectoryHandle(root, dir, { create: createDirs })
            : root;
          if (!parent) {
            result = {
              ok: false,
              error: 'parent_not_found',
              path,
              operation,
              root_name: root.name,
              hint: `Path is relative to the connected Local folder ("${root.name}"), not the PTY workspace_root.`,
            };
          } else {
            const fileHandle = await parent.getFileHandle(name, { create: true });
            const writtenText = evt.content != null ? String(evt.content) : '';
            const writable = await fileHandle.createWritable();
            await writable.write(writtenText);
            await writable.close();
            result = {
              ok: true,
              path,
              operation: 'write',
              lane: 'client_fs',
              root_name: root.name,
              bytes: writtenText.length,
            };
            // Refresh open Monaco tab (same browser) — collab patch path is unified-diff only.
            try {
              window.dispatchEvent(
                new CustomEvent('iam:local_fs_file_written', {
                  detail: {
                    path,
                    content: writtenText,
                    root_name: root.name,
                  },
                }),
              );
            } catch {
              /* ignore */
            }
          }
        }
      } else {
        const { dir, name } = splitPath(path);
        if (!name) {
          result = {
            ok: false,
            error: 'path_required',
            path,
            operation: 'read',
            root_name: root.name,
          };
        } else {
          const parent = await resolveLocalSubdirectoryHandle(root, dir);
          if (!parent) {
            result = {
              ok: false,
              error: 'path_not_found',
              path,
              operation: 'read',
              root_name: root.name,
              hint: `Paths are relative to Local folder "${root.name}". If that folder is a parent (e.g. agent-sandboxes), include the child prefix (e.g. fs-smoke-lab/MARKER.txt) or reconnect Local to the child folder.`,
            };
          } else {
            const fileHandle = await parent.getFileHandle(name);
            const file = await fileHandle.getFile();
            const text = await file.text();
            result = {
              ok: true,
              path,
              operation: 'read',
              root_name: root.name,
              content: text.slice(0, 200_000),
              truncated: text.length > 200_000,
              size: text.length,
            };
          }
        }
      }
    }
  } catch (e) {
    result = {
      ok: false,
      error: e instanceof Error ? e.message : 'client_fs_failed',
      path,
      operation,
    };
  }

  await fetch('/api/agent/fs/fulfill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ callId, conversationId, result }),
  }).catch(() => {});
}
