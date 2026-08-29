/**
 * agent-integrity.js
 * Layer 2: internal-only cross-check, agentsam_agent_run (dispatch-time
 * record) vs agentsam_usage_events (post-stream write). No external API
 * calls -- this cannot tell you the absolute truth (only Console can), but
 * it CAN tell you where in our own pipeline events are being lost.
 *
 * Confirmed 2026-08-01 (Anthropic, Aug 1): agent_run=647,608 tokens_in,
 * usage_events=528,392 tokens_in, Console=850,425+ total. Three-tier gap,
 * not two -- see README.
 *
 * agent_run.status ratio is also worth surfacing: only 28/36 rows were
 * status='completed' on the sample day checked. That alone may explain part
 * of the gap and is arguably a bug in its own right, separate from this
 * feature -- flag to Sam if the swarm confirms it's a pattern, don't just
 * silently fold it into the gap_pct number.
 */

/**
 * @param {any} env
 * @param {string} provider
 * @param {string} day - 'YYYY-MM-DD'
 * @returns {Promise<{ provider: string, day: string, results?: any[] }>}
 */
export async function checkAgentIntegrityDay(env, provider, day) {
  if (!env?.DB) throw new Error('usage integrity requires env.DB');
  const sql = `
    WITH runs AS (
      SELECT COALESCE(NULLIF(ar.model_key, ''), NULLIF(ar.model_id, ''), '__unknown_model__') AS model,
        COUNT(*) AS run_rows, SUM(CASE WHEN ar.status = 'completed' THEN 1 ELSE 0 END) AS completed,
        COALESCE(SUM(ar.input_tokens), 0) AS tokens_in
      FROM agentsam_agent_run ar
      LEFT JOIN agentsam_model_catalog mc ON mc.model_key = COALESCE(ar.model_key, ar.model_id)
      WHERE mc.provider = ? AND date(COALESCE(ar.created_at_unix, CAST(strftime('%s', ar.created_at) AS INTEGER)), 'unixepoch') = ?
      GROUP BY model
    ), events AS (
      SELECT model, COUNT(*) AS event_rows, COALESCE(SUM(tokens_in), 0) AS tokens_in
      FROM agentsam_usage_events WHERE provider = ? AND date(created_at, 'unixepoch') = ? GROUP BY model
    ), models AS (SELECT model FROM runs UNION SELECT model FROM events)
    SELECT models.model, COALESCE(runs.run_rows, 0) AS run_rows, COALESCE(runs.completed, 0) AS completed,
      COALESCE(events.event_rows, 0) AS event_rows, COALESCE(runs.tokens_in, 0) AS run_tokens,
      COALESCE(events.tokens_in, 0) AS event_tokens
    FROM models LEFT JOIN runs USING (model) LEFT JOIN events USING (model)`;
  const { results = [] } = await env.DB.prepare(sql).bind(provider, day, provider, day).all();
  const writes = await Promise.all(results.map(async (row) => {
    const runTokens = Number(row.run_tokens) || 0;
    const eventTokens = Number(row.event_tokens) || 0;
    const gap = runTokens ? ((runTokens - eventTokens) / runTokens) * 100 : eventTokens ? -100 : 0;
    try {
      await env.DB.prepare(`INSERT INTO agentsam_agent_usage_integrity (
        day, provider, model, agent_run_rows, agent_run_completed, usage_event_rows,
        agent_run_tokens_in, usage_event_tokens_in, gap_pct_tokens, checked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(day, provider, model) DO UPDATE SET
        agent_run_rows=excluded.agent_run_rows, agent_run_completed=excluded.agent_run_completed,
        usage_event_rows=excluded.usage_event_rows, agent_run_tokens_in=excluded.agent_run_tokens_in,
        usage_event_tokens_in=excluded.usage_event_tokens_in, gap_pct_tokens=excluded.gap_pct_tokens,
        checked_at=excluded.checked_at`).bind(
        day, provider, row.model, row.run_rows, row.completed, row.event_rows, runTokens, eventTokens, gap,
      ).run();
      return true;
    } catch (error) {
      console.warn('[usage-integrity] write failed', { provider, day, model: row.model, error: error?.message });
      return false;
    }
  }));
  return { provider, day, results, rowsWritten: writes.filter(Boolean).length };
}
