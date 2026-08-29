import { WORKSPACE_CONTEXT_MISSING, WORKSPACE_ROOT_CONTEXT_MISSING } from '../../identity/bootstrap.js';
export async function resolveIamWorkspaceRoot(env, opts = {}) {
  if (!env?.DB) throw new Error('DB not configured');

  let wid = String(opts.workspaceId || '').trim();

  if (!wid) {
    throw new Error(WORKSPACE_CONTEXT_MISSING);
  }

  const workspaceSettingsRow = await env.DB
    .prepare('SELECT settings_json FROM workspace_settings WHERE workspace_id = ?')
    .bind(wid)
    .first()
    .catch(() => null);

  if (workspaceSettingsRow?.settings_json) {
    try {
      const parsed = JSON.parse(workspaceSettingsRow.settings_json);
      const root = typeof parsed?.workspace_root === 'string' ? parsed.workspace_root.trim() : '';
      if (root) return root;
    } catch (_) {}
  }

  throw new Error(WORKSPACE_ROOT_CONTEXT_MISSING);
}
