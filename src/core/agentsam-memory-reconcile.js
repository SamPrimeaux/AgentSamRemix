/**
 * Operator-only memory reconciliation (dry-run by default).
 * Does NOT trust embedded_at. Does NOT rewrite/archive/delete on first run.
 */
import { isHyperdriveUsable, runHyperdriveQuery } from '../../backend/services/database/hyperdrive.js';
import { resolveCronWorkspaceId } from '../../backend/jobs/cron-tenant.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {any} env
 * @param {{ workspace_id?: string, dry_run?: boolean, limit?: number }} [opts]
 */
export async function runAgentsamMemoryReconciliation(env, opts = {}) {
  const dryRun = opts.dry_run !== false;
  let workspaceId = trim(opts.workspace_id);
  if (!workspaceId) {
    workspaceId = (await resolveCronWorkspaceId(env)) || '';
    if (!workspaceId) {
      return { ok: false, error: 'workspace_id_required', dry_run: dryRun };
    }
  }
  const limit = Math.min(5000, Math.max(1, Number(opts.limit) || 2000));
  const db = env?.DB;
  if (!db) return { ok: false, error: 'DB missing', dry_run: dryRun };

  const report = {
    ok: true,
    dry_run: dryRun,
    workspace_id: workspaceId,
    generated_at: new Date().toISOString(),
    d1: {},
    postgres: {},
    drift: {
      missing_sync_key: [],
      embedded_without_receipt: [],
      missing_managed_pg: [],
      missing_pgvector: [],
      missing_vectorize_receipt: [],
      duplicate_active_keys: [],
      content_hash_mismatch: [],
      orphan_projections: [],
      identity_mismatch: [],
      searchable_superseded: [],
    },
    proposed_repair_counts: {},
    note: 'No automatic rewrite/merge/archive/delete in dry-run. Review before backfill.',
  };

  const { results: d1rows } = await db
    .prepare(
      `SELECT id, memory_id, tenant_id, user_id, workspace_id, key, revision, status,
              sync_key, content_hash, embedded_at, embedding_id, projection_status,
              is_archived, updated_at
         FROM agentsam_memory
        WHERE workspace_id = ?
        ORDER BY updated_at DESC
        LIMIT ?`,
    )
    .bind(workspaceId, limit)
    .all();

  const rows = d1rows || [];
  const active = rows.filter((r) => trim(r.status) === 'active' || (!r.status && !Number(r.is_archived)));
  report.d1 = {
    scanned: rows.length,
    active: active.length,
    with_embedded_at: active.filter((r) => r.embedded_at != null).length,
    with_embedding_id: active.filter((r) => trim(r.embedding_id)).length,
    projection_ready: active.filter((r) => trim(r.projection_status) === 'ready').length,
    projection_pending: active.filter((r) => !trim(r.projection_status) || trim(r.projection_status) === 'pending')
      .length,
  };

  for (const r of active) {
    if (!trim(r.sync_key)) {
      report.drift.missing_sync_key.push({ id: r.id, key: r.key, memory_id: r.memory_id });
    }
  }

  // Receipts
  const { results: receipts } = await db
    .prepare(
      `SELECT memory_id, revision, content_hash, projection_target, status, projection_key
         FROM agentsam_memory_projection_receipts
        WHERE status = 'ok'
        LIMIT 10000`,
    )
    .all()
    .catch(() => ({ results: [] }));

  const receiptSet = new Set(
    (receipts || []).map(
      (x) => `${x.memory_id}:${x.revision}:${x.content_hash}:${x.projection_target}`,
    ),
  );

  for (const r of active) {
    if (r.embedded_at != null) {
      const hasVec =
        receiptSet.has(`${r.memory_id}:${r.revision}:${r.content_hash}:vectorize`) ||
        receiptSet.has(`${r.memory_id}:${r.revision}:${r.content_hash}:pgvector_chunk`);
      if (!hasVec && !trim(r.embedding_id)) {
        report.drift.embedded_without_receipt.push({
          id: r.id,
          memory_id: r.memory_id,
          key: r.key,
          embedded_at: r.embedded_at,
          projection_status: r.projection_status,
        });
      }
    }
  }

  // Duplicate active keys
  const keyCount = new Map();
  for (const r of active) {
    const k = `${r.tenant_id}|${r.user_id}|${r.key}`;
    keyCount.set(k, (keyCount.get(k) || 0) + 1);
  }
  for (const [k, n] of keyCount) {
    if (n > 1) report.drift.duplicate_active_keys.push({ slot: k, count: n });
  }

  // Superseded still marked somehow searchable — status check
  for (const r of rows) {
    if (trim(r.status) === 'superseded' || trim(r.status) === 'archived' || trim(r.status) === 'deleted') {
      // flag if projection_status still ready (may still be in Vectorize)
      if (trim(r.projection_status) === 'ready') {
        report.drift.searchable_superseded.push({
          id: r.id,
          memory_id: r.memory_id,
          key: r.key,
          status: r.status,
        });
      }
    }
  }

  if (isHyperdriveUsable(env)) {
    const managed = await runHyperdriveQuery(
      env,
      `SELECT d1_id, memory_id, memory_key, revision, content_hash, workspace_id, user_id, tenant_id
         FROM agentsam.agentsam_memory
        WHERE workspace_id = $1
        LIMIT $2`,
      [workspaceId, limit],
    );
    const chunks = await runHyperdriveQuery(
      env,
      `SELECT projection_key, memory_id, revision, content_hash, workspace_key, user_key, tenant_key, memory_key
         FROM agentsam.agentsam_memory_oai3large_1536
        WHERE workspace_key = $1 OR (workspace_key IS NULL AND metadata->>'workspace_key' = $1)
        LIMIT $2`,
      [workspaceId, limit],
    );

    const managedByD1 = new Map();
    for (const m of managed?.rows || []) {
      if (m.d1_id) managedByD1.set(String(m.d1_id), m);
      if (m.memory_id) managedByD1.set(`mid:${m.memory_id}:${m.revision}`, m);
    }
    const chunkByMem = new Map();
    for (const c of chunks?.rows || []) {
      if (c.memory_id) chunkByMem.set(`${c.memory_id}:${c.revision}`, c);
    }

    report.postgres = {
      managed_rows: (managed?.rows || []).length,
      managed_with_d1_id: (managed?.rows || []).filter((m) => trim(m.d1_id)).length,
      chunk_rows: (chunks?.rows || []).length,
      chunk_with_text_identity: (chunks?.rows || []).filter((c) => trim(c.workspace_key) && trim(c.user_key))
        .length,
    };

    for (const r of active) {
      const m =
        managedByD1.get(String(r.id)) || managedByD1.get(`mid:${r.memory_id}:${r.revision}`);
      if (!m) {
        report.drift.missing_managed_pg.push({ id: r.id, memory_id: r.memory_id, key: r.key });
      } else if (trim(r.content_hash) && trim(m.content_hash) && trim(r.content_hash) !== trim(m.content_hash)) {
        report.drift.content_hash_mismatch.push({
          id: r.id,
          memory_id: r.memory_id,
          d1_hash: r.content_hash,
          pg_hash: m.content_hash,
        });
      }
      if (!chunkByMem.has(`${r.memory_id}:${r.revision}`)) {
        report.drift.missing_pgvector.push({ id: r.id, memory_id: r.memory_id, key: r.key });
      }
      const hasVzReceipt = receiptSet.has(`${r.memory_id}:${r.revision}:${r.content_hash}:vectorize`);
      if (!hasVzReceipt) {
        report.drift.missing_vectorize_receipt.push({
          id: r.id,
          memory_id: r.memory_id,
          key: r.key,
        });
      }
    }

    for (const c of chunks?.rows || []) {
      if (!trim(c.workspace_key) || !trim(c.user_key) || !trim(c.tenant_key)) {
        report.drift.identity_mismatch.push({
          projection_key: c.projection_key,
          memory_id: c.memory_id,
          workspace_key: c.workspace_key,
          user_key: c.user_key,
          tenant_key: c.tenant_key,
        });
      }
      const stillActive = active.some(
        (r) => r.memory_id === c.memory_id && Number(r.revision) === Number(c.revision),
      );
      if (c.memory_id && !stillActive) {
        report.drift.orphan_projections.push({
          projection_key: c.projection_key,
          memory_id: c.memory_id,
          revision: c.revision,
        });
      }
    }
  } else {
    report.postgres = { error: 'hyperdrive_unavailable' };
  }

  // Cap list sizes for report readability
  for (const k of Object.keys(report.drift)) {
    const arr = report.drift[k];
    report.proposed_repair_counts[k] = Array.isArray(arr) ? arr.length : 0;
    if (Array.isArray(arr) && arr.length > 50) {
      report.drift[k] = arr.slice(0, 50);
      report.drift[`${k}_truncated`] = true;
    }
  }

  report.proposed_repair_counts.enqueue_outbox_for_active_missing_projections =
    report.proposed_repair_counts.missing_pgvector ||
    report.proposed_repair_counts.missing_managed_pg ||
    report.proposed_repair_counts.missing_vectorize_receipt;

  report.proposed_repair_counts.fill_missing_sync_key = report.proposed_repair_counts.missing_sync_key;
  report.proposed_repair_counts.clear_bogus_embedded_at =
    report.proposed_repair_counts.embedded_without_receipt;

  if (!dryRun) {
    report.ok = false;
    report.error = 'apply_mode_disabled_until_operator_approval';
  }

  return report;
}
