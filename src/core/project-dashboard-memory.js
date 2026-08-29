/** Fixed project_memory keys for dashboard project detail UI (memory_type = user_preference). */

export const PROJECT_DASHBOARD_MEMORY_TYPE = 'user_preference';

export const PROJECT_DASHBOARD_MEMORY_KEY = 'dashboard.memory';

export const PROJECT_DASHBOARD_INSTRUCTIONS_KEY = 'dashboard.instructions';

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} projectId
 */
export async function readProjectDashboardMemory(db, projectId) {
  const pid = String(projectId || '').trim();
  if (!db || !pid) return { memory: '', instructions: '', updated_at: null };

  const { results } = await db
    .prepare(
      `SELECT key, value, updated_at FROM project_memory
       WHERE project_id = ? AND memory_type = ?
         AND key IN (?, ?)`,
    )
    .bind(
      pid,
      PROJECT_DASHBOARD_MEMORY_TYPE,
      PROJECT_DASHBOARD_MEMORY_KEY,
      PROJECT_DASHBOARD_INSTRUCTIONS_KEY,
    )
    .all();

  let memory = '';
  let instructions = '';
  let updatedAt = null;
  for (const row of results || []) {
    const key = String(row.key || '');
    const val = row.value != null ? String(row.value) : '';
    if (key === PROJECT_DASHBOARD_MEMORY_KEY) memory = val;
    if (key === PROJECT_DASHBOARD_INSTRUCTIONS_KEY) instructions = val;
    const ts = Number(row.updated_at) || 0;
    if (ts > (Number(updatedAt) || 0)) updatedAt = ts;
  }
  return { memory, instructions, updated_at: updatedAt };
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{ projectId: string, tenantId: string, userId?: string|null, memory?: string, instructions?: string }} opts
 */
export async function upsertProjectDashboardMemory(db, opts) {
  const pid = String(opts.projectId || '').trim();
  const tenantId = String(opts.tenantId || '').trim();
  if (!db || !pid || !tenantId) throw new Error('missing_project_or_tenant');

  const upsertOne = async (key, value) => {
    if (value === undefined) return;
    const id = `pmem_ui_${pid}_${key.replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`;
    await db
      .prepare(
        `INSERT INTO project_memory (
          id, project_id, tenant_id, memory_type, key, value,
          importance_score, confidence_score, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1.0, 1.0, ?, unixepoch(), unixepoch())
        ON CONFLICT(project_id, memory_type, key) DO UPDATE SET
          value = excluded.value,
          updated_at = unixepoch(),
          created_by = COALESCE(excluded.created_by, project_memory.created_by)`,
      )
      .bind(
        id,
        pid,
        tenantId,
        PROJECT_DASHBOARD_MEMORY_TYPE,
        key,
        String(value ?? ''),
        opts.userId != null ? String(opts.userId) : null,
      )
      .run();
  };

  await upsertOne(PROJECT_DASHBOARD_MEMORY_KEY, opts.memory);
  const instructionsTouched = opts.instructions !== undefined;
  await upsertOne(PROJECT_DASHBOARD_INSTRUCTIONS_KEY, opts.instructions);

  const next = await readProjectDashboardMemory(db, pid);

  if (instructionsTouched) {
    try {
      const { syncProjectRuntimeContract } = await import('./project-runtime-contract-sync.js');
      const sync = await syncProjectRuntimeContract(
        { DB: db },
        {
          projectRef: pid,
          tenantId: opts.tenantId,
          userId: opts.userId ?? null,
        },
      );
      next.runtime_contract_sync = sync?.ok
        ? {
            ok: true,
            rule_key: sync.rule_key ?? null,
            unchanged: sync.unchanged === true,
            content_hash: sync.content_hash ?? null,
            body_chars: sync.body_chars ?? null,
          }
        : {
            ok: false,
            error: sync?.error ?? 'sync_failed',
            hint: sync?.hint ?? null,
          };
    } catch (e) {
      console.warn('[project-dashboard-memory] runtime_contract_sync', e?.message ?? e);
      next.runtime_contract_sync = {
        ok: false,
        error: e?.message ?? String(e),
      };
    }
  }

  return next;
}
