/**
 * agentsam_memory — resolved / closed rows excluded from daily briefs and active recall.
 */
import { readD1TableColumns as pragmaTableInfo } from '../../../services/d1/schema.js';

/** @param {import('@cloudflare/workers-types').D1Database} db */
export async function agentsamMemoryHasResolvedColumn(db) {
  const cols = await pragmaTableInfo(db, 'agentsam_memory');
  return cols.has('is_resolved');
}

/**
 * SQL fragment: active (not archived, not resolved). Optional table alias.
 * @param {string} [alias]
 */
export function agentsamMemoryActiveSql(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `COALESCE(${p}is_archived, 0) = 0 AND COALESCE(${p}is_resolved, 0) = 0`;
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} [alias]
 */
export async function agentsamMemoryActiveSqlOrEmpty(db, alias = '') {
  if (!db) return '1=1';
  const hasResolved = await agentsamMemoryHasResolvedColumn(db);
  const p = alias ? `${alias}.` : '';
  if (hasResolved) return agentsamMemoryActiveSql(alias);
  return `COALESCE(${p}is_archived, 0) = 0`;
}

function strOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Mark memory row(s) resolved — stops inclusion in daily briefs / active recall.
 * @param {any} env
 * @param {{
 *   tenantId: string,
 *   userId: string,
 *   key?: string|null,
 *   keys?: string[],
 *   id?: string|null,
 *   resolvedBy?: string|null,
 *   note?: string|null,
 * }} opts
 */
export async function resolveAgentsamMemory(env, opts) {
  if (!env?.DB) return { ok: false, error: 'no_d1' };
  const tenantId = strOrNull(opts.tenantId);
  const userId = strOrNull(opts.userId);
  if (!tenantId || !userId) return { ok: false, error: 'tenant_and_user_required' };

  const hasResolved = await agentsamMemoryHasResolvedColumn(env.DB);
  if (!hasResolved) return { ok: false, error: 'is_resolved_column_missing_run_migration_805' };

  const resolvedBy = strOrNull(opts.resolvedBy) || userId;
  const note = strOrNull(opts.note);
  const keys = [
    ...(opts.key ? [String(opts.key).trim()] : []),
    ...(Array.isArray(opts.keys) ? opts.keys.map((k) => String(k).trim()).filter(Boolean) : []),
  ];
  const id = strOrNull(opts.id);

  if (!id && !keys.length) return { ok: false, error: 'key_or_id_required' };

  let changes = 0;
  const resolvedKeys = [];

  if (id) {
    const row = await env.DB.prepare(
      `SELECT key FROM agentsam_memory WHERE id = ? AND tenant_id = ? AND user_id = ? LIMIT 1`,
    )
      .bind(id, tenantId, userId)
      .first();
    if (!row?.key) return { ok: false, error: 'not_found', id };
    keys.push(String(row.key));
  }

  for (const key of [...new Set(keys)]) {
    const r = await env.DB.prepare(
      `UPDATE agentsam_memory
       SET is_resolved = 1,
           resolved_at = unixepoch(),
           resolved_by = ?,
           updated_at = unixepoch()
       WHERE tenant_id = ? AND user_id = ? AND key = ?
         AND COALESCE(is_resolved, 0) = 0`,
    )
      .bind(resolvedBy, tenantId, userId, key)
      .run();
    const n = r.meta?.changes ?? r.changes ?? 0;
    if (n > 0) {
      changes += n;
      resolvedKeys.push(key);
      if (note) {
        await env.DB.prepare(
          `UPDATE agentsam_memory
           SET summary = CASE
             WHEN summary IS NULL OR trim(summary) = '' THEN ?
             ELSE summary || ' [resolved: ' || ? || ']'
           END
           WHERE tenant_id = ? AND user_id = ? AND key = ?`,
        )
          .bind(note, note, tenantId, userId, key)
          .run()
          .catch(() => {});
      }
    }
  }

  return {
    ok: true,
    resolved: changes,
    keys: resolvedKeys,
    missing: keys.filter((k) => !resolvedKeys.includes(k)),
  };
}

/**
 * Re-open a resolved memory row (rare — undo mistaken resolve).
 * @param {any} env
 * @param {{ tenantId: string, userId: string, key: string }} opts
 */
export async function unresolveAgentsamMemory(env, opts) {
  if (!env?.DB) return { ok: false, error: 'no_d1' };
  const tenantId = strOrNull(opts.tenantId);
  const userId = strOrNull(opts.userId);
  const key = strOrNull(opts.key);
  if (!tenantId || !userId || !key) return { ok: false, error: 'missing_fields' };

  const hasResolved = await agentsamMemoryHasResolvedColumn(env.DB);
  if (!hasResolved) return { ok: false, error: 'is_resolved_column_missing' };

  const r = await env.DB.prepare(
    `UPDATE agentsam_memory
     SET is_resolved = 0, resolved_at = NULL, resolved_by = NULL, updated_at = unixepoch()
     WHERE tenant_id = ? AND user_id = ? AND key = ?`,
  )
    .bind(tenantId, userId, key)
    .run();

  return { ok: true, changes: r.meta?.changes ?? r.changes ?? 0, key };
}
