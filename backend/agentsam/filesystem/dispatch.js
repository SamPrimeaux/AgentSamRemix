import { executeFsReadFile } from './read.js';
import { executeFsWriteFile } from './write.js';
import { executeFsEditFile } from './edit.js';
import { executeFsListDir } from './list.js';
import { executeFsSearchFiles } from './search.js';

const SEARCH_OPERATIONS = new Set([
  'grep', 'search', 'search_files', 'fs_search_files', 'workspace_grep', 'workspace_search',
]);
const WRITE_OPERATIONS = new Set(['write', 'put', 'fs_write_file']);
const LIST_OPERATIONS = new Set(['list', 'list_dir', 'fs_list_dir']);

/** True only for an explicit filesystem dispatcher/tool identity or handler_type=filesystem. */
export function isFilesystemCatalogLane({ handlerType, config = {}, toolKey = '' } = {}) {
  const dispatcher = String(config.dispatcher || '').trim().toLowerCase();
  const key = String(toolKey || '').trim().toLowerCase();
  const type = String(handlerType || '').trim().toLowerCase();
  return type === 'filesystem' || type === 'workspace.reader' ||
    /^fs_(?:read|write|edit|list|search)/.test(dispatcher) ||
    /^fs_(?:read|write|edit|list|search)/.test(key);
}

/**
 * Execute a D1 catalog filesystem row. D1 still selects handler_type/dispatcher/operation;
 * this module only maps that declared filesystem operation to the backend implementation.
 */
export async function executeFilesystemCatalogLane(laneCtx) {
  const { env, config = {}, params = {}, runContext = {}, toolKey = '' } = laneCtx;
  const dispatcher = String(config.dispatcher || '').trim().toLowerCase();
  const operation = String(config.operation || dispatcher || 'read').trim().toLowerCase();
  const key = String(toolKey || '').trim().toLowerCase();

  let out;
  if (dispatcher === 'fs_edit_file' || key === 'fs_edit_file') {
    out = await executeFsEditFile(env, params, runContext);
  } else if (dispatcher === 'fs_write_file' || WRITE_OPERATIONS.has(operation)) {
    out = await executeFsWriteFile(env, params, runContext);
  } else if (dispatcher === 'fs_list_dir' || LIST_OPERATIONS.has(operation)) {
    out = await executeFsListDir(env, params, runContext);
  } else if (dispatcher === 'fs_search_files' || SEARCH_OPERATIONS.has(operation)) {
    out = await executeFsSearchFiles(env, params, runContext);
  } else {
    out = await executeFsReadFile(env, params, runContext);
  }

  const failed = !!out?.error || out?.success === false || (out?.exit_code != null && Number(out.exit_code) !== 0);
  return failed
    ? { ok: false, error: String(out?.error || out?.message || 'filesystem_operation_failed'), body: out }
    : { ok: true, body: out };
}
