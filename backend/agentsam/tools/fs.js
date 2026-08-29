/**
 * Tool: FileSystem (fs)
 * Standardized CRUD operations for local and virtual workspace files.
 *
 * Repo scope for ignore patterns: runContext.connected_github_repo only
 * (stamped via ensureConnectedGithubRepoOnRunContext — no param-name chains).
 */

import { assertPathAllowedByIgnorePatterns } from '../../../src/core/auth.js';
import { ensureConnectedGithubRepoOnRunContext } from '../../../src/core/fs-container-workspace.js';

function identityFrom(params, runContext) {
  const user_id =
    params?.user_id ?? runContext?.userId ?? runContext?.user_id ?? runContext?.session?.user_id;
  const workspace_id =
    params?.workspace_id ??
    runContext?.workspaceId ??
    runContext?.workspace_id ??
    runContext?.session?.workspace_id;
  const tenant_id =
    params?.tenant_id ?? runContext?.tenantId ?? runContext?.tenant_id ?? runContext?.session?.tenant_id;
  return { user_id, workspace_id, tenant_id };
}

export const handlers = {
  /**
   * list_dir: Recursive directory scanner for workspace mapping.
   */
  async list_dir(params, env, runContext = {}) {
    const pathArg = params?.path ?? params?.directory ?? '.';
    const { user_id, workspace_id, tenant_id } = identityFrom(params, runContext);
    try {
      if (user_id && workspace_id) {
        const connected = await ensureConnectedGithubRepoOnRunContext(env, runContext, {
          workspaceId: workspace_id,
          userId: user_id,
          tenantId: tenant_id,
        });
        const ign = await assertPathAllowedByIgnorePatterns(
          env,
          user_id,
          connected,
          pathArg,
        );
        if (!ign.ok) return { error: ign.error };
        const { executeFsListDir } = await import('../../../src/core/fs-list-dir.js');
        const out = await executeFsListDir(
          env,
          { ...params, path: pathArg, user_id, workspace_id, tenant_id },
          runContext || {},
        );
        if (!out?.error && out?.ok !== false) return out;
        return { error: out.error || 'fs_list_dir_failed', ...out };
      }
      return { error: 'workspace_list_requires_user_context' };
    } catch (e) {
      return { error: `Failed to list directory: ${e.message}` };
    }
  },

  /**
   * read_file: PTY workspace read (inneranimalmedia clone on iam-pty). No public HTTP loopback.
   */
  async read_file(params, env, runContext = {}) {
    const path = params?.path != null ? String(params.path).trim() : '';
    const { user_id, workspace_id, tenant_id } = identityFrom(params, runContext);
    try {
      if (user_id && workspace_id && path) {
        const connected = await ensureConnectedGithubRepoOnRunContext(env, runContext, {
          workspaceId: workspace_id,
          userId: user_id,
          tenantId: tenant_id,
        });
        const ign = await assertPathAllowedByIgnorePatterns(env, user_id, connected, path);
        if (!ign.ok) return { error: ign.error };
        const { executeFsReadFile } = await import('../filesystem/read.js');
        const out = await executeFsReadFile(
          env,
          { path, user_id, workspace_id, tenant_id },
          runContext || {},
        );
        if (!out?.error) return out;
        return { error: out.error, ...out };
      }
      if (!path) return { error: 'path required' };
      return {
        error:
          'workspace_read_requires_user_context — connect workspace and ensure PTY repo is cloned',
      };
    } catch (e) {
      return { error: `Failed to read file: ${e.message}` };
    }
  },

  /**
   * write_file: Save content to a file.
   */
  async write_file(params, env, runContext = {}) {
    const path = params?.path != null ? String(params.path).trim() : '';
    const { user_id, workspace_id, tenant_id } = identityFrom(params, runContext);
    try {
      if (user_id && workspace_id && path) {
        const connected = await ensureConnectedGithubRepoOnRunContext(env, runContext, {
          workspaceId: workspace_id,
          userId: user_id,
          tenantId: tenant_id,
        });
        const ign = await assertPathAllowedByIgnorePatterns(env, user_id, connected, path);
        if (!ign.ok) return { error: ign.error };
        const { executeFsWriteFile } = await import('../filesystem/write.js');
        const out = await executeFsWriteFile(
          env,
          { ...params, path, user_id, workspace_id, tenant_id },
          runContext || {},
        );
        if (!out?.error) return out;
        return { error: out.error, ...out };
      }
      if (!path) return { error: 'path required' };
      return {
        error:
          'workspace_write_requires_user_context — connect workspace and ensure PTY repo is cloned',
      };
    } catch (e) {
      return { error: `Failed to write file: ${e.message}` };
    }
  },
};

/** Normalizes a flat list of paths into a nested tree structure. */
function buildTree(files, rootPath) {
  const root = { name: rootPath.split('/').pop() || '.', path: rootPath, kind: 'directory', children: [] };
  const map = { [rootPath]: root };

  files.forEach(f => {
    const parts = f.path.split('/');
    let currentPath = '';
    
    parts.forEach((part, i) => {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      
      if (!map[currentPath]) {
        const isFile = i === parts.length - 1 && !f.kind?.includes('directory');
        const node = {
          name: part,
          path: currentPath,
          kind: isFile ? 'file' : 'directory',
          size: isFile ? f.size : undefined,
          mtime: f.mtime,
          children: isFile ? undefined : []
        };
        map[currentPath] = node;
        if (map[parentPath]) {
          map[parentPath].children.push(node);
        } else if (parentPath === '' || parentPath === '.') {
             root.children.push(node);
        }
      }
    });
  });
  return root.children;
}

export const definitions = [
  {
    name: 'list_dir',
    description: 'List contents of a directory (recursive optional)',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
        recursive: { type: 'boolean', description: 'Whether to scan subdirectories' },
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a specific file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or update a file with new content',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path where the file should be saved' },
        content: { type: 'string', description: 'The code or text content to write' },
      },
      required: ['path', 'content'],
    },
  },
];
