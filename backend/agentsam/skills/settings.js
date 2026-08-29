/** Agent Sam skill settings domain — D1 CRUD + append-only revisions. */

const TRACKED_FIELDS = new Set([
  'name',
  'description',
  'icon',
  'content_markdown',
  'slash_trigger',
  'globs',
  'always_apply',
  'tags',
  'sort_order',
  'is_active',
]);

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function fail(kind, error) {
  return { ok: false, kind, error };
}

async function appendSkillRevision(env, opts = {}) {
  if (!env?.DB) return fail('unavailable', 'db_unavailable');
  const skillId = trim(opts.skillId);
  if (!skillId) return fail('validation', 'skill_id_required');

  const changedBy = String(opts.changedBy ?? 'system').slice(0, 200);
  const changeNote = trim(opts.changeNote) ? String(opts.changeNote).slice(0, 2000) : null;
  const contentMarkdown = opts.contentMarkdown != null ? String(opts.contentMarkdown) : null;

  try {
    if (contentMarkdown != null) {
      await env.DB.prepare(
        `INSERT INTO agentsam_skill_revision (id, skill_id, content_markdown, version, changed_by, change_note)
         VALUES (
           'skillrev_'||lower(hex(randomblob(8))),
           ?, ?,
           COALESCE((SELECT MAX(version) FROM agentsam_skill_revision WHERE skill_id = ?), 0) + 1,
           ?, ?
         )`,
      )
        .bind(skillId, contentMarkdown, skillId, changedBy, changeNote)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO agentsam_skill_revision (id, skill_id, content_markdown, version, changed_by, change_note)
         SELECT 'skillrev_'||lower(hex(randomblob(8))), id, content_markdown,
                COALESCE((SELECT MAX(version) FROM agentsam_skill_revision WHERE skill_id = agentsam_skill.id), 0) + 1,
                ?, ?
           FROM agentsam_skill
          WHERE id = ?`,
      )
        .bind(changedBy, changeNote, skillId)
        .run();
    }
    return { ok: true };
  } catch (error) {
    const message = error?.message ?? String(error);
    console.warn('[agentsam_skill_revision]', message);
    return fail('internal', message);
  }
}

export async function listSkillsForSettings(env, scope) {
  if (!env?.DB) return { ok: true, body: { skills: [] } };
  const userId = trim(scope?.userId);
  if (!userId) return fail('unauthenticated', 'user required');
  const { results } = await env.DB.prepare(
    `SELECT s.*,
      (SELECT COUNT(*) FROM agentsam_skill_invocation i WHERE i.skill_id = s.id) AS invocation_count,
      (SELECT MAX(invoked_at) FROM agentsam_skill_invocation i WHERE i.skill_id = s.id) AS last_used
     FROM agentsam_skill s
     WHERE s.user_id = ?
     ORDER BY COALESCE(s.sort_order, 9999), COALESCE(s.name, s.id)`,
  )
    .bind(userId)
    .all()
    .catch(() => ({ results: [] }));
  return { ok: true, body: { skills: results || [] } };
}

export async function createSkillForSettings(env, scope, input = {}) {
  if (!env?.DB) return fail('unavailable', 'DB not configured');
  const userId = trim(scope?.userId);
  if (!userId) return fail('unauthenticated', 'user required');

  const name = trim(input.name);
  if (!name) return fail('validation', 'name required');
  const workspaceId = trim(scope?.workspaceId) || null;
  const id = trim(input.id) || `skill_${crypto.randomUUID()}`;
  const description = typeof input.description === 'string' ? input.description : null;
  const icon = typeof input.icon === 'string' ? input.icon : null;
  const contentMarkdown = typeof input.content_markdown === 'string' ? input.content_markdown : '';
  const slashTrigger = typeof input.slash_trigger === 'string' ? input.slash_trigger : null;
  const globs = typeof input.globs === 'string' ? input.globs : null;
  const alwaysApply = input.always_apply === true || input.always_apply === 1 || input.always_apply === '1' ? 1 : 0;
  const tags = typeof input.tags === 'string' ? input.tags : null;
  const sortOrder = input.sort_order != null && Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : null;
  const isActive = input.is_active === false || input.is_active === 0 || input.is_active === '0' ? 0 : 1;

  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_skill (
        id, user_id, workspace_id, name, description, icon, content_markdown,
        slash_trigger, globs, always_apply, tags, sort_order, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        id,
        userId,
        workspaceId,
        name,
        description,
        icon,
        contentMarkdown,
        slashTrigger,
        globs,
        alwaysApply,
        tags,
        sortOrder,
        isActive,
      )
      .run();

    const revision = await appendSkillRevision(env, {
      skillId: id,
      changedBy: userId,
      changeNote: typeof input.change_note === 'string' ? input.change_note : 'initial create',
      contentMarkdown,
    });
    if (!revision.ok) return fail('internal', revision.error || 'skill_revision_failed');
    return { ok: true, body: { ok: true, id } };
  } catch (error) {
    return fail('internal', error?.message ?? String(error));
  }
}

export async function patchSkillForSettings(env, scope, idRaw, input = {}) {
  if (!env?.DB) return fail('unavailable', 'DB not configured');
  const id = trim(idRaw);
  const userId = trim(scope?.userId);
  if (!id) return fail('validation', 'id required');
  if (!userId) return fail('unauthenticated', 'user required');

  const allowed = [...TRACKED_FIELDS];
  const keys = allowed.filter((key) => Object.prototype.hasOwnProperty.call(input, key));
  if (!keys.length) return fail('validation', 'No fields to update');

  const sets = keys.map((key) => `${key} = ?`).join(', ');
  const values = keys.map((key) => input[key]);
  try {
    await env.DB.prepare(
      `UPDATE agentsam_skill SET ${sets}, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
      .bind(...values, id, userId)
      .run();

    if (keys.some((key) => TRACKED_FIELDS.has(key))) {
      const fieldsNote = keys.filter((key) => key !== 'content_markdown').join(', ');
      const changeNote =
        trim(input.change_note)
          ? String(input.change_note).slice(0, 2000)
          : fieldsNote
            ? `updated: ${fieldsNote}`
            : null;
      const revision = await appendSkillRevision(env, {
        skillId: id,
        changedBy: userId,
        changeNote,
        contentMarkdown: typeof input.content_markdown === 'string' ? input.content_markdown : undefined,
      });
      if (!revision.ok) return fail('internal', revision.error || 'skill_revision_failed');
    }
    return { ok: true, body: { ok: true } };
  } catch (error) {
    return fail('internal', error?.message ?? String(error));
  }
}
