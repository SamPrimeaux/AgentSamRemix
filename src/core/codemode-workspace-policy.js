/**
 * Codemode workspace isolation — Companions uses a separate CF account (e8d0359c).
 * Never route d1/r2/supabase/hyperdrive tools through IAM bindings for that workspace.
 */
function parseJsonSafe(raw, fallback = null) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

/** Handler types that touch IAM platform storage (wrong account for isolated workspaces). */
export const CODEMODE_IAM_INFRA_HANDLER_TYPES = new Set([
  'd1',
  'hyperdrive',
  'supabase',
  'r2',
]);

/** Read-only catalog tools allowed in isolated (Companions) codemode sandboxes. */
export const CODEMODE_COMPANIONS_READ_TOOL_KEYS = new Set([
  'web_fetch',
  'search_web',
  'agentsam_github_read',
  'agentsam_github_repo_list',
  'agentsam_memory_search',
  'agentsam_memory_save',
  'fs_read_file',
  'fs_search_files',
  'fs_list_dir',
]);

const COMPANIONS_CF_ACCOUNT_ID_PREFIX = 'e8d0359c';

function accountIdMatchesIsolated(accountRaw) {
  const id = accountRaw != null ? String(accountRaw).trim().toLowerCase() : '';
  if (!id) return false;
  return id === COMPANIONS_CF_ACCOUNT_ID_PREFIX || id.startsWith(COMPANIONS_CF_ACCOUNT_ID_PREFIX);
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
export function companionsReadToolAllowed(row) {
  const key = String(row?.tool_key || row?.tool_name || '')
    .trim()
    .toLowerCase();
  if (!key) return false;
  if (CODEMODE_COMPANIONS_READ_TOOL_KEYS.has(key)) return true;
  if (key.startsWith('agentsam_memory_')) return true;
  return false;
}

/**
 * @param {any} env
 * @param {string|null|undefined} workspaceId
 */
export async function isCodemodeIsolatedWorkspace(env, workspaceId) {
  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  if (!ws || !env?.DB) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT settings_json FROM workspaces WHERE id = ? LIMIT 1`,
    )
      .bind(ws)
      .first();
    if (!row) return false;
    const settings = parseJsonSafe(row.settings_json, {});
    if (settings?.codemode_isolated_account === true || settings?.codemode_isolated === true) {
      return true;
    }
    const fromSettings =
      settings?.cloudflare_account_id != null
        ? String(settings.cloudflare_account_id).trim()
        : settings?.cf_account_id != null
          ? String(settings.cf_account_id).trim()
          : '';
    return accountIdMatchesIsolated(fromSettings);
  } catch {
    return false;
  }
}

/**
 * @param {Record<string, unknown>} row
 * @param {boolean} isolated
 */
export function codemodeRowAllowedForWorkspace(row, isolated) {
  const handlerType = String(row.handler_type || '').trim().toLowerCase();
  if (!isolated) return true;
  if (CODEMODE_IAM_INFRA_HANDLER_TYPES.has(handlerType)) return false;
  return companionsReadToolAllowed(row);
}
