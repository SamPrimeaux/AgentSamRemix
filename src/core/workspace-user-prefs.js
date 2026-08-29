/**
 * Per-user prefs stored in user_settings.settings_json (replaces user_workspace_settings).
 */

function trim(v) {
  if (v == null) return '';
  return String(v).trim();
}

function parseJson(raw, fallback = {}) {
  if (raw == null || raw === '') return { ...fallback };
  if (typeof raw === 'object') return raw;
  try {
    const o = JSON.parse(String(raw));
    return typeof o === 'object' && o !== null ? o : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

/**
 * GitHub active branch preference for user + workspace.
 * @param {any} env
 * @param {string} userId
 * @param {string} workspaceId
 */
export async function readUserGitActiveBranch(env, userId, workspaceId) {
  const uid = trim(userId);
  const wid = trim(workspaceId);
  if (!env?.DB || !uid || !wid) return null;
  try {
    const row = await env.DB.prepare(`SELECT settings_json FROM user_settings WHERE user_id = ? LIMIT 1`)
      .bind(uid)
      .first();
    const prefs = parseJson(row?.settings_json);
    const branches = prefs.github_active_branch && typeof prefs.github_active_branch === 'object'
      ? prefs.github_active_branch
      : {};
    const b = branches[wid];
    return b != null && trim(b) ? trim(b) : null;
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string} workspaceId
 * @param {string} branch
 */
export async function persistUserGitActiveBranch(env, userId, workspaceId, branch) {
  const uid = trim(userId);
  const wid = trim(workspaceId);
  const b = trim(branch);
  if (!env?.DB || !uid || !wid || !b) throw new Error('DB, user, workspace, or branch missing');

  const row = await env.DB.prepare(`SELECT settings_json FROM user_settings WHERE user_id = ? LIMIT 1`)
    .bind(uid)
    .first();
  const prefs = parseJson(row?.settings_json);
  if (!prefs.github_active_branch || typeof prefs.github_active_branch !== 'object') {
    prefs.github_active_branch = {};
  }
  prefs.github_active_branch[wid] = b;
  const next = JSON.stringify(prefs);
  const now = Math.floor(Date.now() / 1000);

  const upd = await env.DB.prepare(
    `UPDATE user_settings SET settings_json = ?, updated_at = ? WHERE user_id = ?`,
  )
    .bind(next, now, uid)
    .run();

  if (!upd?.meta?.changes) {
    await env.DB.prepare(
      `INSERT INTO user_settings (id, user_id, settings_json, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(`us_${uid.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40)}`, uid, next, now)
      .run()
      .catch(() => {});
  }

  return { user_id: uid, workspace_id: wid, active_branch: b };
}

/**
 * Workspace-scoped theme (workspace_settings.theme + settings_json.canvas_theme_slug).
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} themeSlug
 */
export async function persistWorkspaceThemeSlug(env, workspaceId, themeSlug) {
  const wid = trim(workspaceId);
  const theme = trim(themeSlug);
  if (!env?.DB || !wid || !theme) return;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO workspace_settings (workspace_id, theme, settings_json, updated_at)
     VALUES (?, ?, json_object('canvas_theme_slug', ?), ?)
     ON CONFLICT(workspace_id) DO UPDATE SET
       theme = excluded.theme,
       settings_json = json_set(COALESCE(workspace_settings.settings_json, '{}'), '$.canvas_theme_slug', ?),
       updated_at = excluded.updated_at`,
  )
    .bind(wid, theme, theme, now, theme)
    .run()
    .catch(async () => {
      await env.DB.prepare(
        `INSERT INTO workspace_settings (workspace_id, settings_json, updated_at)
         VALUES (?, json_object('theme', ?, 'canvas_theme_slug', ?), ?)
         ON CONFLICT(workspace_id) DO UPDATE SET
           settings_json = json_set(
             json_set(COALESCE(workspace_settings.settings_json, '{}'), '$.theme', ?),
             '$.canvas_theme_slug', ?
           ),
           updated_at = excluded.updated_at`,
      )
        .bind(wid, theme, theme, now, theme, theme)
        .run()
        .catch(() => {});
    });
}

/**
 * @param {any} env
 * @param {string[]} workspaceIds
 */
export async function loadWorkspaceThemeMap(env, workspaceIds) {
  const ids = [...new Set((workspaceIds || []).map((id) => trim(id)).filter(Boolean))];
  if (!env?.DB || !ids.length) return {};
  const ph = ids.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(
    `SELECT workspace_id, theme, settings_json FROM workspace_settings WHERE workspace_id IN (${ph})`,
  )
    .bind(...ids)
    .all()
    .catch(() => ({ results: [] }));
  /** @type {Record<string, string>} */
  const out = {};
  for (const r of results || []) {
    const wid = trim(r.workspace_id);
    if (!wid) continue;
    let fromJson = '';
    try {
      const o = parseJson(r.settings_json);
      fromJson = trim(o.theme || o.canvas_theme_slug);
    } catch {
      /* ignore */
    }
    const t = trim(r.theme) || fromJson;
    if (t) out[wid] = t;
  }
  return out;
}
