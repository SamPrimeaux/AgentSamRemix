/**
 * One-shot / repeatable D1 agentsam_memory → agentsam.agentsam_memory backfill.
 */
import {
  mapD1RowToPrivateMemory,
  upsertPrivateAgentsamMemory,
  MANAGED_MEMORY_TYPES,
} from './private-memory.js';

/**
 * @param {Record<string, unknown>} row
 */
export function shouldSkipD1RowForPrivateBackfill(row) {
  const key = String(row?.key ?? '').trim();
  const value = String(row?.value ?? '').trim();
  if (!key || !value) return 'empty';
  if (value.startsWith('[STALE')) return 'stale_marker';
  if (row?.is_archived === 1 || row?.is_archived === true) return 'archived';
  const mt = String(row?.memory_type ?? 'fact').trim();
  if (!MANAGED_MEMORY_TYPES.includes(mt)) return 'invalid_type';
  const decay = Number(row?.decay_score ?? 1);
  if (Number.isFinite(decay) && decay <= 0) return 'decayed';
  return null;
}

/**
 * @param {any} env
 * @param {{
 *   tenantId: string,
 *   workspaceId?: string,
 *   userId?: string,
 *   limit?: number,
 *   dryRun?: boolean,
 * }} opts
 */
export async function backfillPrivateMemoryFromD1(env, opts) {
  const tenantId = String(opts.tenantId ?? '').trim();
  const workspaceId = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  const userId = opts.userId != null ? String(opts.userId).trim() : '';
  const limit = Math.min(Math.max(Number(opts.limit) || 500, 1), 2000);
  const dryRun = Boolean(opts.dryRun);

  if (!env?.DB || !tenantId) {
    return { ok: false, error: 'missing_db_or_tenant', inserted: 0, updated: 0, skipped: 0, errors: [] };
  }

  const binds = [tenantId];
  const clauses = [
    'tenant_id = ?',
    "value NOT LIKE '[STALE%'",
    '(expires_at IS NULL OR expires_at > unixepoch())',
  ];
  if (workspaceId) {
    clauses.push('(workspace_id = ? OR workspace_id IS NULL OR TRIM(COALESCE(workspace_id,"")) = "")');
    binds.push(workspaceId);
  }
  if (userId) {
    clauses.push('user_id = ?');
    binds.push(userId);
  }
  binds.push(limit);

  const { results } = await env.DB.prepare(
    `SELECT * FROM agentsam_memory
     WHERE ${clauses.join(' AND ')}
     ORDER BY updated_at DESC
     LIMIT ?`,
  )
    .bind(...binds)
    .all();

  const rows = results ?? [];
  const report = {
    ok: true,
    dry_run: dryRun,
    scanned: rows.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    skip_reasons: {},
  };

  for (const row of rows) {
    const skip = shouldSkipD1RowForPrivateBackfill(row);
    if (skip) {
      report.skipped += 1;
      report.skip_reasons[skip] = (report.skip_reasons[skip] || 0) + 1;
      continue;
    }
    const mapped = mapD1RowToPrivateMemory(row);
    if (workspaceId && !mapped.workspace_id) {
      mapped.workspace_id = workspaceId;
    }
    if (dryRun) {
      report.inserted += 1;
      continue;
    }
    const out = await upsertPrivateAgentsamMemory(env, mapped);
    if (!out.ok) {
      report.errors.push({ key: mapped.memory_key, error: out.error });
      continue;
    }
    report.inserted += 1;
  }

  if (report.errors.length) report.ok = false;
  return report;
}
