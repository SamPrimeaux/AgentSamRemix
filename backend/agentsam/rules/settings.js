/** Agent Sam rules settings domain — scoped document CRUD + revisions. */

const ORDER_BY = 'COALESCE(sort_order, 0) ASC, COALESCE(updated_at_epoch, 0) DESC';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function fail(kind, error) {
  return { ok: false, kind, error };
}

function normalizeApplyMode(raw) {
  const mode = trim(raw).toLowerCase() || 'always';
  if (mode === 'glob' || mode === 'globs' || mode === 'path') return 'glob';
  if (mode === 'manual' || mode === 'agent_requested') return 'manual';
  return 'always';
}

async function appendRulesRevision(env, opts = {}) {
  if (!env?.DB) return fail('unavailable', 'db_unavailable');
  const documentId = trim(opts.documentId);
  if (!documentId) return fail('validation', 'document_id_required');
  const createdBy = String(opts.createdBy ?? 'system').slice(0, 200);
  const bodyMarkdown = opts.bodyMarkdown != null ? String(opts.bodyMarkdown) : '';
  const requestedVersion = Number.isFinite(Number(opts.version)) ? Number(opts.version) : null;
  try {
    const version =
      requestedVersion ??
      ((await env.DB.prepare(
        `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM agentsam_rules_revision WHERE document_id = ?`,
      )
        .bind(documentId)
        .first())?.v ?? 1);
    await env.DB.prepare(
      `INSERT INTO agentsam_rules_revision (id, document_id, body_markdown, version, created_by)
       VALUES ('ardrev_' || lower(hex(randomblob(8))), ?, ?, ?, ?)`,
    )
      .bind(documentId, bodyMarkdown, version, createdBy)
      .run();
    return { ok: true, version };
  } catch (error) {
    const message = error?.message ?? String(error);
    console.warn('[agentsam_rules_revision]', message);
    return fail('internal', message);
  }
}

async function insertRulesDocument(env, row) {
  const triggerType = row.applyMode === 'always' ? 'system' : 'manual';
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_rules_document (
        id, user_id, workspace_id, title, body_markdown, version, is_active,
        apply_mode, globs, sort_order, trigger_type, created_at_epoch, updated_at_epoch, source_stored
      ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, unixepoch(), unixepoch(), 'dashboard')`,
    )
      .bind(
        row.id,
        row.userId,
        row.workspaceId,
        row.title,
        row.bodyMarkdown,
        row.applyMode,
        row.globs,
        row.sortOrder ?? 0,
        triggerType,
      )
      .run();
    return;
  } catch (error) {
    if (!String(error?.message || error).includes('no such column')) throw error;
  }
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_rules_document (
        id, user_id, workspace_id, title, body_markdown, version, is_active,
        apply_mode, globs, source, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, 'dashboard', ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        row.id,
        row.userId,
        row.workspaceId,
        row.title,
        row.bodyMarkdown,
        row.applyMode,
        row.globs,
        row.sortOrder ?? 0,
      )
      .run();
    return;
  } catch (error) {
    if (!String(error?.message || error).includes('no such column')) throw error;
  }
  await env.DB.prepare(
    `INSERT INTO agentsam_rules_document (
      id, user_id, workspace_id, title, body_markdown, version, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, 1, datetime('now'), datetime('now'))`,
  )
    .bind(row.id, row.userId, row.workspaceId, row.title, row.bodyMarkdown)
    .run();
}

export async function listRulesForSettings(env, scope) {
  if (!env?.DB) return { ok: true, body: { rules: [] } };
  const userId = trim(scope?.userId);
  if (!userId) return fail('unauthenticated', 'user required');
  const workspaceId = trim(scope?.workspaceId);
  try {
    const { results } = await env.DB.prepare(
      `SELECT *
       FROM agentsam_rules_document
       WHERE (user_id = ? OR user_id IS NULL)
         AND (
           COALESCE(workspace_id, '') = ?
           OR workspace_id IS NULL
           OR TRIM(COALESCE(workspace_id, '')) = ''
         )
       ORDER BY ${ORDER_BY}`,
    )
      .bind(userId, workspaceId)
      .all();
    return { ok: true, body: { rules: results || [], workspace_id: workspaceId || null } };
  } catch (error) {
    return fail('internal', error?.message ?? String(error));
  }
}

export async function createRuleForSettings(env, scope, input = {}) {
  if (!env?.DB) return fail('unavailable', 'DB not configured');
  const userId = trim(scope?.userId);
  if (!userId) return fail('unauthenticated', 'user required');
  const workspaceId = trim(scope?.workspaceId);
  const title = trim(input.title).slice(0, 200) || 'Untitled rule';
  const bodyMarkdown = typeof input.body_markdown === 'string' ? input.body_markdown : String(input.body_markdown ?? '');
  const applyMode = normalizeApplyMode(input.apply_mode);
  const globs = trim(input.globs) ? trim(input.globs).slice(0, 2000) : null;
  const id = trim(input.id) || `ard_${crypto.randomUUID()}`;
  try {
    await insertRulesDocument(env, {
      id,
      userId,
      workspaceId,
      title,
      bodyMarkdown,
      applyMode,
      globs,
      sortOrder: 0,
    });
    await appendRulesRevision(env, {
      documentId: id,
      createdBy: userId,
      bodyMarkdown,
      version: 1,
    });
    const row = await env.DB.prepare(`SELECT * FROM agentsam_rules_document WHERE id = ? LIMIT 1`)
      .bind(id)
      .first();
    return { ok: true, body: { ok: true, id, rule: row } };
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes('UNIQUE') || message.includes('constraint')) return fail('conflict', 'Rule already exists');
    return fail('internal', message);
  }
}

export async function patchRuleForSettings(env, scope, idRaw, input = {}) {
  if (!env?.DB) return fail('unavailable', 'DB not configured');
  const id = trim(idRaw);
  const userId = trim(scope?.userId);
  const workspaceId = trim(scope?.workspaceId);
  if (!id) return fail('validation', 'id required');
  if (!userId) return fail('unauthenticated', 'user required');
  const allowed = ['title', 'body_markdown', 'is_active', 'apply_mode', 'globs', 'sort_order'];
  const keys = allowed.filter((key) => Object.prototype.hasOwnProperty.call(input, key));
  if (!keys.length) return fail('validation', 'No fields to update');

  const existing = await env.DB.prepare(`SELECT * FROM agentsam_rules_document WHERE id = ? LIMIT 1`)
    .bind(id)
    .first();
  if (!existing) return fail('not_found', 'Rule not found');
  if (existing.user_id != null && String(existing.user_id) !== userId) return fail('forbidden', 'Forbidden');
  const documentWorkspaceId = trim(existing.workspace_id);
  if (documentWorkspaceId && workspaceId && documentWorkspaceId !== workspaceId) {
    return fail('forbidden', 'Wrong workspace for this rule');
  }

  const sets = [];
  const values = [];
  for (const key of keys) {
    if (key === 'title') {
      sets.push('title = ?');
      values.push(trim(input.title).slice(0, 200) || 'Untitled rule');
    } else if (key === 'body_markdown') {
      sets.push('body_markdown = ?');
      values.push(typeof input.body_markdown === 'string' ? input.body_markdown : String(input.body_markdown ?? ''));
    } else if (key === 'is_active') {
      sets.push('is_active = ?');
      values.push(input.is_active === true || input.is_active === 1 || input.is_active === '1' ? 1 : 0);
    } else if (key === 'apply_mode') {
      sets.push('apply_mode = ?');
      values.push(normalizeApplyMode(input.apply_mode));
    } else if (key === 'globs') {
      sets.push('globs = ?');
      values.push(trim(input.globs) ? trim(input.globs).slice(0, 2000) : null);
    } else if (key === 'sort_order') {
      sets.push('sort_order = ?');
      values.push(Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0);
    }
  }
  if (keys.includes('body_markdown')) sets.push('version = COALESCE(version, 1) + 1');

  try {
    await env.DB.prepare(
      `UPDATE agentsam_rules_document SET ${sets.join(', ')}, updated_at_epoch = unixepoch() WHERE id = ?`,
    )
      .bind(...values, id)
      .run();
  } catch (error) {
    if (!String(error?.message || error).includes('no such column')) return fail('internal', error?.message ?? String(error));
    try {
      await env.DB.prepare(
        `UPDATE agentsam_rules_document SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      )
        .bind(...values, id)
        .run();
    } catch (fallbackError) {
      return fail('internal', fallbackError?.message ?? String(fallbackError));
    }
  }

  if (keys.includes('body_markdown')) {
    await appendRulesRevision(env, {
      documentId: id,
      createdBy: userId,
      bodyMarkdown: typeof input.body_markdown === 'string' ? input.body_markdown : String(input.body_markdown ?? ''),
      version: Number(existing.version || 1) + 1,
    });
  }

  const row = await env.DB.prepare(`SELECT * FROM agentsam_rules_document WHERE id = ? LIMIT 1`)
    .bind(id)
    .first();
  return { ok: true, body: { ok: true, rule: row } };
}

export async function deleteRuleForSettings(env, scope, idRaw) {
  if (!env?.DB) return fail('unavailable', 'DB not configured');
  const id = trim(idRaw);
  const userId = trim(scope?.userId);
  const workspaceId = trim(scope?.workspaceId);
  if (!id) return fail('validation', 'id required');
  if (!userId) return fail('unauthenticated', 'user required');
  const existing = await env.DB.prepare(
    `SELECT user_id, workspace_id FROM agentsam_rules_document WHERE id = ? LIMIT 1`,
  )
    .bind(id)
    .first();
  if (!existing) return fail('not_found', 'Rule not found');
  if (existing.user_id != null && String(existing.user_id) !== userId) return fail('forbidden', 'Forbidden');
  const documentWorkspaceId = trim(existing.workspace_id);
  if (documentWorkspaceId && workspaceId && documentWorkspaceId !== workspaceId) {
    return fail('forbidden', 'Wrong workspace for this rule');
  }

  try {
    await env.DB.prepare(
      `UPDATE agentsam_rules_document SET is_active = 0, updated_at_epoch = unixepoch() WHERE id = ?`,
    )
      .bind(id)
      .run();
  } catch (error) {
    if (!String(error?.message || error).includes('no such column')) return fail('internal', error?.message ?? String(error));
    await env.DB.prepare(
      `UPDATE agentsam_rules_document SET is_active = 0, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(id)
      .run();
  }
  return { ok: true, body: { ok: true } };
}
