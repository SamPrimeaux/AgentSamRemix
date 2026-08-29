import { resolveActiveCmsThemeRow } from './resolve.js';

/**
 * Persist a cms_theme_preferences row for POST /api/themes/apply.
 *
 * Production D1 may be migration **256** (minimal columns) or an **extended** table with
 * `theme_id NOT NULL` and `UNIQUE(tenant_id, user_id, workspace_id, project_id, page_id, scope)`.
 * The old `INSERT … ON CONFLICT(id)` path fails on extended schemas (NOT NULL theme_id,
 * composite unique vs synthetic `tp_ws_*` ids) and surfaced as HTTP 500 + client theme rollback.
 *
 * Strategy: delete any existing row for the same logical scope key, then insert a fresh row.
 * Insert tries `(…, theme_slug, theme_id, …)` first; on missing `theme_id` column, retries without it.
 *
 * @param {any} env
 * @param {{
 *   prefId: string,
 *   tenantId: string,
 *   scope: string,
 *   workspaceId: string | null,
 *   projectId: string | null,
 *   userId: string | null,
 *   themeSlug: string,
 *   themeCmsRowId?: string | null,
 * }} p
 */
export async function upsertCmsThemePreferenceRow(env, p) {
  const db = env?.DB;
  if (!db) throw new Error("DB not configured");

  const tid = String(p.tenantId || "").trim();
  const slug = String(p.themeSlug || "").trim();
  const prefId = String(p.prefId || "").trim();
  const scope = String(p.scope || "workspace").trim();
  const ws =
    p.workspaceId != null && String(p.workspaceId).trim() !== "" ? String(p.workspaceId).trim() : null;
  const proj =
    p.projectId != null && String(p.projectId).trim() !== "" ? String(p.projectId).trim() : null;
  const uid = p.userId != null && String(p.userId).trim() !== "" ? String(p.userId).trim() : null;

  let themeRowId =
    p.themeCmsRowId != null && String(p.themeCmsRowId).trim() !== "" ? String(p.themeCmsRowId).trim() : "";
  if (!themeRowId && slug) {
    try {
      const t = await db.prepare(`SELECT id FROM cms_themes WHERE slug = ? LIMIT 1`).bind(slug).first();
      if (t?.id != null && String(t.id).trim()) themeRowId = String(t.id).trim();
    } catch {
      /* ignore */
    }
  }
  if (!themeRowId) themeRowId = slug;

  const run = async (sql, ...binds) => {
    await db.prepare(sql).bind(...binds).run();
  };

  const deleteWorkspaceScoped = async () => {
    if (!ws) return;
    try {
      await run(
        `DELETE FROM cms_theme_preferences
         WHERE tenant_id = ? AND scope = 'workspace' AND workspace_id = ?
           AND (project_id IS NULL OR project_id = '')
           AND (page_id IS NULL OR page_id = '')`,
        tid,
        ws,
      );
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (msg.includes("no such table")) throw e;
      if (msg.includes("no such column") && msg.includes("page_id")) {
        try {
          await run(
            `DELETE FROM cms_theme_preferences
             WHERE tenant_id = ? AND scope = 'workspace' AND workspace_id = ?
               AND (project_id IS NULL OR project_id = '')`,
            tid,
            ws,
          );
        } catch (e2) {
          const m2 = String(e2?.message || e2 || "");
          if (m2.includes("no such table")) throw e2;
          await run(
            `DELETE FROM cms_theme_preferences WHERE tenant_id = ? AND scope = 'workspace' AND workspace_id = ?`,
            tid,
            ws,
          );
        }
      } else {
        await run(
          `DELETE FROM cms_theme_preferences WHERE tenant_id = ? AND scope = 'workspace' AND workspace_id = ?`,
          tid,
          ws,
        );
      }
    }
  };

  const deleteProjectScoped = async () => {
    if (!ws || !proj) return;
    try {
      await run(
        `DELETE FROM cms_theme_preferences
         WHERE tenant_id = ? AND scope = 'project' AND workspace_id = ? AND project_id = ?
           AND (page_id IS NULL OR page_id = '')`,
        tid,
        ws,
        proj,
      );
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (msg.includes("no such table")) throw e;
      if (msg.includes("no such column") && msg.includes("page_id")) {
        await run(
          `DELETE FROM cms_theme_preferences
           WHERE tenant_id = ? AND scope = 'project' AND workspace_id = ? AND project_id = ?`,
          tid,
          ws,
          proj,
        );
      } else {
        throw e;
      }
    }
  };

  const deleteUserGlobalScoped = async () => {
    if (!uid) return;
    try {
      await run(
        `DELETE FROM cms_theme_preferences
         WHERE tenant_id = ? AND scope = 'user_global' AND user_id = ?
           AND (page_id IS NULL OR page_id = '')`,
        tid,
        uid,
      );
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (msg.includes("no such table")) throw e;
      if (msg.includes("no such column") && msg.includes("page_id")) {
        await run(
          `DELETE FROM cms_theme_preferences WHERE tenant_id = ? AND scope = 'user_global' AND user_id = ?`,
          tid,
          uid,
        );
      } else {
        throw e;
      }
    }
  };

  if (scope === "workspace") {
    await deleteWorkspaceScoped();
  } else if (scope === "project") {
    await deleteProjectScoped();
  } else if (scope === "user_global") {
    await deleteUserGlobalScoped();
  }

  try {
    await run(
      `INSERT INTO cms_theme_preferences (id, tenant_id, scope, workspace_id, project_id, user_id, theme_slug, theme_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
      prefId,
      tid,
      scope,
      ws,
      proj,
      uid,
      slug,
      themeRowId,
    );
  } catch (e) {
    const msg = String(e?.message || e || "");
    if (msg.includes("no such column") && msg.includes("theme_id")) {
      await run(
        `INSERT INTO cms_theme_preferences (id, tenant_id, scope, workspace_id, project_id, user_id, theme_slug, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`,
        prefId,
        tid,
        scope,
        ws,
        proj,
        uid,
        slug,
      );
    } else {
      throw e;
    }
  }
}

/**
 * Canonical logged-in dashboard theme preference. cms_theme_preferences is the
 * source of truth; user_settings.theme is maintained only as a compatibility
 * mirror for older dashboard/Agent Home readers.
 * @param {any} env
 * @param {{ tenantId: string, userId: string, themeSlug: string, themeCmsRowId?: string | null }} p
 */
export async function setDashboardUserThemePreference(env, p) {
  const tid = String(p.tenantId || '').trim();
  const uid = String(p.userId || '').trim();
  const slug = String(p.themeSlug || '').trim();
  if (!tid || !uid || !slug) throw new Error('tenantId, userId, and themeSlug required');

  await upsertCmsThemePreferenceRow(env, {
    prefId: `tp_ug_${tid}_${uid}`,
    tenantId: tid,
    scope: 'user_global',
    workspaceId: null,
    projectId: null,
    userId: uid,
    themeSlug: slug,
    themeCmsRowId: p.themeCmsRowId ?? null,
  });

  try {
    const updated = await env.DB.prepare(
      `UPDATE user_settings SET theme = ?, updated_at = unixepoch() WHERE user_id = ?`,
    ).bind(slug, uid).run();
    if (!updated?.meta?.changes) {
      await env.DB.prepare(
        `INSERT INTO user_settings (id, user_id, theme, updated_at)
         VALUES (?, ?, ?, unixepoch())`,
      ).bind(`us_${uid}`, uid, slug).run();
    }
  } catch (error) {
    console.warn('[cms-theme] user_settings theme mirror failed', error?.message || error);
  }
}


/** Best-effort compatibility mirror for CMS/site workspace theme selection. */
export async function mirrorWorkspaceCmsThemeSlug(env, workspaceId, slug) {
  const wid = String(workspaceId || '').trim();
  const value = String(slug || '').trim();
  if (!wid || !value || !env?.DB) return;
  try {
    await env.DB.prepare(
      `UPDATE workspaces SET theme_id = ?, theme_set = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(value, value, wid).run();
  } catch (error) {
    const message = String(error?.message || error || '');
    if (message.includes('no such column') && message.includes('theme_set')) {
      try {
        await env.DB.prepare(`UPDATE workspaces SET theme_id = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(value, wid)
          .run();
      } catch {
        /* compatibility mirror is best-effort */
      }
      return;
    }
    console.warn('[cms-theme] workspace theme mirror failed', message);
  }
}

export async function setWorkspaceCmsThemePreferenceAndResolve(env, authUser, tenantId, workspaceId, themeSlug) {
  const tid = String(tenantId || '').trim();
  const ws = String(workspaceId || '').trim();
  const slug = String(themeSlug || '').trim();
  await upsertCmsThemePreferenceRow(env, {
    prefId: `tp_ws_${tid}_${ws}`,
    tenantId: tid,
    scope: 'workspace',
    workspaceId: ws,
    projectId: null,
    userId: null,
    themeSlug: slug,
    themeCmsRowId: null,
  });
  return resolveActiveCmsThemeRow(env, {
    tenantId: tid,
    authUser,
    workspaceId: ws,
    projectId: null,
  });
}
