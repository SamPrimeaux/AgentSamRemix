/**
 * Legacy D1 agentsam_memory → projection reconciliation.
 *
 * Does NOT embed or treat embedded_at as authority.
 * Enqueues agentsam_memory_outbox jobs for legacy rows missing outbox coverage;
 * the outbox drain (hourly cron) is the only projection authority.
 */
import { DESIRED_PROJECTIONS, sha256Hex } from '../../../../src/core/agentsam-memory-contract.js';
import { isTransportWorkspaceKey } from '../../../../src/core/agentsam-memory-scope.js';
import { completeCronRun, failCronRun, startCronRun } from '../../../jobs/cron-run-ledger.js';

export const MEMORY_VECTOR_SYNC_MAX_ROWS = 50;
/** Actual wrangler schedule that invokes this job (via runHourlyRoutingJobs). */
const CRON_HOURLY = '0 * * * *';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function newId(prefix) {
  const hex = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return `${prefix}_${hex}`;
}

/**
 * @param {any} env
 * @param {{ limit?: number, skipLedger?: boolean, cronExpression?: string }} [opts]
 */
export async function runAgentsamMemoryVectorSync(env, opts = {}) {
  const limit = Math.min(
    Math.max(1, Number(opts.limit) || MEMORY_VECTOR_SYNC_MAX_ROWS),
    MEMORY_VECTOR_SYNC_MAX_ROWS,
  );
  const skipLedger = opts.skipLedger === true;
  const cronExpression = opts.cronExpression ?? CRON_HOURLY;

  if (!env?.DB) {
    return { ok: false, error: 'DB not configured', enqueued: 0, skipped: 0, failed: 0 };
  }

  let runId = null;
  let startedAt = Date.now();
  if (!skipLedger) {
    const begun = await startCronRun(env, {
      jobName: 'agentsam_memory_legacy_outbox_enqueue',
      cronExpression,
      tenantId: null,
      workspaceId: null,
    });
    runId = begun?.runId ?? null;
    startedAt = begun?.startedAt ?? Date.now();
  }

  let enqueued = 0;
  let skipped = 0;
  let failed = 0;
  let rowsRead = 0;
  const errors = [];
  const skipReasons = {
    transport_workspace: 0,
    incomplete_row: 0,
    already_has_outbox: 0,
    new_pipeline_ready: 0,
    mapping_missing: 0,
  };

  try {
    // Legacy / orphaned rows: active memory without a matching outbox revision.
    // Never select by embedded_at — that column is not projection authority.
    const { results: pending } = await env.DB.prepare(
      `SELECT m.id, m.memory_id, m.revision, m.tenant_id, m.user_id, m.workspace_id,
              m.memory_type, m.key, m.value, m.title, m.summary, m.content_hash,
              m.projection_status, m.status, m.tags
         FROM agentsam_memory m
        WHERE COALESCE(m.status, 'active') = 'active'
          AND COALESCE(m.is_archived, 0) = 0
          AND TRIM(COALESCE(m.value, '')) != ''
          AND TRIM(COALESCE(m.workspace_id, '')) != ''
          AND COALESCE(m.projection_status, '') NOT IN ('ready')
          AND NOT EXISTS (
            SELECT 1 FROM agentsam_memory_outbox o
             WHERE o.memory_id = COALESCE(NULLIF(TRIM(m.memory_id), ''), m.id)
               AND o.revision = COALESCE(m.revision, 1)
               AND o.status IN ('pending', 'partial', 'processing', 'ready', 'committed')
          )
        ORDER BY m.updated_at DESC
        LIMIT ?`,
    )
      .bind(limit)
      .all();

    const rows = pending || [];
    rowsRead = rows.length;
    const now = Math.floor(Date.now() / 1000);

    for (const row of rows) {
      const d1WorkspaceId = trim(row.workspace_id);
      const memoryKey = trim(row.key);
      const content = trim(row.value);
      if (!d1WorkspaceId || !memoryKey || !content) {
        skipped += 1;
        skipReasons.incomplete_row += 1;
        continue;
      }
      if (isTransportWorkspaceKey(d1WorkspaceId)) {
        skipped += 1;
        skipReasons.transport_workspace += 1;
        continue;
      }

      // Fail closed on missing UUID mapping (do not invent projection identity)
      try {
        const map = await env.DB.prepare(
          `SELECT supabase_workspace_id FROM agentsam_workspace WHERE id = ? LIMIT 1`,
        )
          .bind(d1WorkspaceId)
          .first();
        if (!trim(map?.supabase_workspace_id)) {
          skipped += 1;
          skipReasons.mapping_missing += 1;
          errors.push({ id: row.id, error: 'workspace_uuid_mapping_missing', workspace_id: d1WorkspaceId });
          continue;
        }
      } catch (e) {
        failed += 1;
        errors.push({ id: row.id, error: e?.message || 'mapping_lookup_failed' });
        continue;
      }

      const memoryId = trim(row.memory_id) || trim(row.id);
      const revision = Number(row.revision) > 0 ? Number(row.revision) : 1;
      let contentHash = trim(row.content_hash);
      if (!contentHash) {
        contentHash = await sha256Hex(
          `${trim(row.memory_type) || 'fact'}|${memoryKey}|${trim(row.title)}|${trim(row.summary) || content.slice(0, 280)}|${content}|[]|normal`,
        );
      }

      // Ensure memory_id/revision exist on legacy rows (idempotent)
      if (!trim(row.memory_id) || !row.revision) {
        await env.DB.prepare(
          `UPDATE agentsam_memory
              SET memory_id = COALESCE(NULLIF(TRIM(memory_id), ''), ?),
                  revision = COALESCE(revision, 1),
                  content_hash = COALESCE(NULLIF(TRIM(content_hash), ''), ?),
                  projection_status = COALESCE(projection_status, 'pending'),
                  updated_at = ?
            WHERE id = ?`,
        )
          .bind(memoryId, contentHash, now, row.id)
          .run();
      }

      const outboxId = newId('mob');
      try {
        await env.DB.prepare(
          `INSERT INTO agentsam_memory_outbox (
            id, memory_id, revision, content_hash, operation, desired_projections_json,
            status, attempts, next_attempt_at, receipts_json,
            tenant_id, user_id, workspace_id, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, 'upsert', ?,
            'pending', 0, ?, '{}',
            ?, ?, ?, ?, ?
          )`,
        )
          .bind(
            outboxId,
            memoryId,
            revision,
            contentHash,
            JSON.stringify(DESIRED_PROJECTIONS),
            now,
            trim(row.tenant_id),
            trim(row.user_id),
            d1WorkspaceId,
            now,
            now,
          )
          .run();
        enqueued += 1;
      } catch (e) {
        // Unique conflict → already covered
        const msg = e?.message || String(e);
        if (/UNIQUE|unique|constraint/i.test(msg)) {
          skipped += 1;
          skipReasons.already_has_outbox += 1;
        } else {
          failed += 1;
          errors.push({ id: row.id, error: msg.slice(0, 200) });
        }
      }
    }

    const result = {
      ok: failed === 0,
      mode: 'legacy_outbox_enqueue',
      enqueued,
      skipped,
      failed,
      rows_read: rowsRead,
      skip_reasons: skipReasons,
      errors: errors.slice(0, 20),
      note: 'embedded_at is not used; outbox drain performs projections',
    };

    if (!skipLedger && runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead,
        rowsWritten: enqueued,
        metadata: result,
      });
    }
    return result;
  } catch (e) {
    const err = e?.message || String(e);
    if (!skipLedger && runId) {
      await failCronRun(env, runId, startedAt, err);
    }
    return { ok: false, error: err, enqueued, skipped, failed, rows_read: rowsRead };
  }
}
