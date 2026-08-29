/** Canonical D1 catalog for Agent Sam commands (slash, settings, MCP). */
import { commandPaletteDto, commandShellLine } from './command-row.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function scopedWhere(opts = {}) {
  const binds = [];
  const scope = [`workspace_id = 'platform'`];
  const tenantId = trim(opts.tenantId) || null;
  const workspaceId = trim(opts.workspaceId) || null;
  if (tenantId) {
    scope.push('tenant_id = ?');
    binds.push(tenantId);
  }
  if (workspaceId) {
    scope.push('workspace_id = ?');
    binds.push(workspaceId);
  }
  return { clause: scope.join(' OR '), binds };
}

/** Slash/palette-visible active commands for Agent/MCP surfaces. */
export async function listAgentsamSlashCommands(db, opts = {}) {
  if (!db) return [];
  const limit = Math.min(Math.max(1, Number(opts.limit) || 200), 500);
  const { clause, binds } = scopedWhere(opts);
  const { results } = await db.prepare(
    `SELECT
       id, slug, display_name, display_name AS name, description, shell_line,
       handler_kind, handler_ref, category, risk_level, requires_confirmation,
       sort_order, workspace_id, tenant_id, is_active, surface
     FROM agentsam_commands
     WHERE COALESCE(is_active, 1) = 1
       AND surface IN ('slash', 'both')
       AND (${clause})
     ORDER BY
       CASE workspace_id WHEN 'platform' THEN 0 ELSE 1 END,
       COALESCE(sort_order, 50) ASC,
       display_name ASC
     LIMIT ${limit}`,
  )
    .bind(...binds)
    .all();
  return (results || []).map((row) => {
    const dto = commandPaletteDto(row);
    return {
      ...dto,
      usage_hint: commandShellLine(row) || dto.slug,
      handler_type: dto.handler_kind,
      handler_ref: dto.handler_ref,
      show_in_slash: 1,
      show_in_palette: dto.surface === 'both' || dto.surface === 'palette' ? 1 : 0,
    };
  });
}

/** Full scoped command rows for Settings, including inactive rows. */
export async function listAgentsamCommandsForSettings(db, opts = {}) {
  if (!db) return [];
  const limit = Math.min(Math.max(1, Number(opts.limit) || 500), 800);
  const { clause, binds } = scopedWhere(opts);
  const { results } = await db.prepare(
    `SELECT *
     FROM agentsam_commands
     WHERE (${clause})
     ORDER BY
       CASE workspace_id WHEN 'platform' THEN 0 ELSE 1 END,
       COALESCE(sort_order, 50) ASC,
       display_name ASC
     LIMIT ${limit}`,
  )
    .bind(...binds)
    .all();
  return (results || []).map((row) => ({
    ...row,
    usage_hint: commandShellLine(row) || row.slug,
    handler_type: row.handler_kind,
    mapped_command: commandShellLine(row) || null,
  }));
}

export async function listCommandsForSettings(env, scope) {
  if (!env?.DB) return { ok: true, body: { commands: [], source: 'agentsam_commands' } };
  try {
    const commands = await listAgentsamCommandsForSettings(env.DB, {
      tenantId: scope?.tenantId,
      workspaceId: scope?.workspaceId,
      limit: 500,
    });
    return { ok: true, body: { commands, source: 'agentsam_commands' } };
  } catch (error) {
    return { ok: false, kind: 'internal', error: error?.message ?? String(error) };
  }
}

export async function toggleCommandForSettings(env, idRaw, input = {}) {
  if (!env?.DB) return { ok: false, kind: 'unavailable', error: 'DB not configured' };
  const id = trim(idRaw);
  if (!id) return { ok: false, kind: 'validation', error: 'id required' };
  const raw = Object.prototype.hasOwnProperty.call(input, 'is_active') ? input.is_active : input.enabled;
  const enabled = raw === true || raw === 1 || raw === '1';
  try {
    await env.DB.prepare(
      `UPDATE agentsam_commands SET is_active = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(enabled ? 1 : 0, id)
      .run();
    return { ok: true, body: { ok: true } };
  } catch (error) {
    return { ok: false, kind: 'internal', error: error?.message ?? String(error) };
  }
}

/** One active command by durable id. */
export async function getActiveAgentSamCommandById(db, idRaw) {
  const id = trim(idRaw);
  if (!db || !id) return null;
  return db.prepare(
    `SELECT * FROM agentsam_commands WHERE id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
  ).bind(id).first().catch(() => null);
}

/** Active slash command scoped to platform / tenant / workspace. */
export async function getActiveAgentSamCommandBySlug(db, slugRaw, opts = {}) {
  const slug = trim(slugRaw);
  if (!db || !slug) return null;
  const tenantId = trim(opts.tenantId);
  const workspaceId = trim(opts.workspaceId);
  return db.prepare(
    `SELECT * FROM agentsam_commands
      WHERE slug = ? AND COALESCE(is_active, 1) = 1
        AND (workspace_id = 'platform' OR workspace_id = ? OR (? != '' AND tenant_id = ?))
      ORDER BY CASE WHEN workspace_id = ? THEN 0 WHEN workspace_id = 'platform' THEN 1 ELSE 2 END
      LIMIT 1`,
  ).bind(slug, workspaceId, tenantId, tenantId, workspaceId).first().catch(() => null);
}

/** Resolve an approval row back to its active catalog command. */
export async function findActiveAgentSamCommandByShellOrSlug(db, valueRaw) {
  const value = trim(valueRaw);
  if (!db || !value) return null;
  return db.prepare(
    `SELECT * FROM agentsam_commands
      WHERE COALESCE(is_active, 1) = 1 AND (shell_line = ? OR slug = ?)
      ORDER BY CASE WHEN shell_line = ? THEN 0 ELSE 1 END LIMIT 1`,
  ).bind(value, value, value).first().catch(() => null);
}
