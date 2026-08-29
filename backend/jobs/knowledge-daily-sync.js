import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import { resolveCronTenantId } from './cron-tenant.js';

export async function runKnowledgeDailySync(env) {
  const today = new Date().toISOString().slice(0, 10);
  if (!env.R2) return { memory_key: '', priorities_key: '' };

  const cronTenant = await resolveCronTenantId(env);

  const begun = env?.DB
    ? await startCronRun(env, {
        jobName: 'knowledge_daily_sync',
        cronExpression: '0 6 * * *',
        tenantId: cronTenant,
        workspaceId: null,
      })
    : null;
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  let rowsWritten = 0;

  try {

  let memoryMd = `# Agent memory (high importance) -- ${today}\n\n`;
  const ksTid = cronTenant;
  if (env.DB && ksTid) {
    try {
      const r = await env.DB.prepare(
        `SELECT key, value, importance_score FROM agentsam_memory
         WHERE importance_score >= 7 AND tenant_id = ?
           AND COALESCE(is_archived, 0) = 0 AND COALESCE(is_resolved, 0) = 0
         ORDER BY importance_score DESC`
      ).bind(ksTid).all();
      for (const row of (r.results || [])) {
        memoryMd += `## ${row.key} (score: ${row.importance_score})\n${(row.value || '').trim()}\n\n`;
      }
      await env.R2.put(`knowledge/memory/daily-${today}.md`, memoryMd, { httpMetadata: { contentType: 'text/markdown' } });
      rowsWritten += 1;
    } catch (e) {
      console.warn('[knowledge/daily] memory', e?.message);
    }
  }

  let prioritiesMd = `# Current priorities (active roadmap steps) -- ${today}\n\n`;
  if (env.DB) {
    try {
      const r = await env.DB.prepare(
        "SELECT id, title, status, order_index, description FROM roadmap_steps WHERE plan_id = 'plan_iam_dashboard_v1' AND status IN ('in_progress', 'not_started') ORDER BY order_index"
      ).all();
      for (const row of (r.results || [])) {
        prioritiesMd += `- **${(row.title || row.id || '').replace(/\*\*/g, '')}** (${row.status}) ${(row.description || '').slice(0, 200)}\n`;
      }
      await env.R2.put('knowledge/priorities/current.md', prioritiesMd, { httpMetadata: { contentType: 'text/markdown' } });
      rowsWritten += 1;
    } catch (e) {
      console.warn('[knowledge/priorities]', e?.message);
    }
  }

  if (runId) {
    await completeCronRun(env, runId, startedAt, {
      rowsRead: 0,
      rowsWritten,
      metadata: { today },
    });
  }
  return { memory_key: `knowledge/memory/daily-${today}.md`, priorities_key: 'knowledge/priorities/current.md' };
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[knowledge-daily-sync]', e?.message ?? e);
    return { memory_key: '', priorities_key: '', error: String(e?.message ?? e) };
  }
}
