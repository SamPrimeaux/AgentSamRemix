/**
 * Reject D1 tools when SQL targets tables that exist ONLY in Supabase (no D1 peer).
 * Parallel D1 tables with different names (tool_call_log vs tool_call_events) are allowed.
 */
const POSTGRES_ONLY_TABLES = Object.freeze([
  // Vector / embedding lanes — Supabase only
  'agentsam_memory_oai3large_1536',
  'agentsam_deep_archive_oai3large_3072',
  'agentsam_documents_oai3large_1536',
  'agentsam_codebase_chunks_oai3large_1536',
  'agentsam_codebase_files_oai3large_1536',
  'agentsam_codebase_ast_symbols_oai3large_1536',
  'agentsam_codebase_chunks_gemini_embedding_2_1536',
  'agentsam_codebase_files_gemini_embedding_2_1536',
  'agentsam_codebase_ast_symbols_gemini_embedding_2_1536',
  'agentsam_database_schema_oai3large_1536',
  'agentsam_media_gemini2_1536',

  // Supabase telemetry / OS tables with no D1 twin (or differently named twin)
  'agentsam_search_log',
  'agentsam_tool_call_events', // D1 peer: agentsam_tool_call_log
  'agentsam_error_events', // D1 peer: agentsam_error_log
  'agentsam_worker_errors',
  'agentsam_worker_hourly_rollups',
  'agentsam_worker_daily_rollups',
  'agentsam_workflow_step_events',
  'agentsam_workflow_quality_snapshots',
  'agentsam_workflow_daily_rollups',

  // Wave 2 outbox
  'agentsam_vector_sync_outbox',
]);

const TABLE_RE = /\b(?:from|join|into|update|table)\s+(?:agentsam\.)?([a-z_][a-z0-9_]*)\b/gi;

/**
 * @param {string} sql
 * @returns {{ blocked: boolean, table?: string, error?: string, user_message?: string }}
 */
export function assertD1SqlNotPostgresOnly(sql) {
  const text = String(sql || '');
  if (!text.trim()) return { blocked: false };

  const found = new Set();
  let m;
  TABLE_RE.lastIndex = 0;
  while ((m = TABLE_RE.exec(text)) !== null) {
    const name = String(m[1] || '').toLowerCase();
    if (POSTGRES_ONLY_TABLES.includes(name)) found.add(name);
  }

  for (const t of POSTGRES_ONLY_TABLES) {
    if (new RegExp(`\\bagentsam\\.${t}\\b`, 'i').test(text)) found.add(t);
    else if (new RegExp(`\\b(?:from|join|into|update)\\s+${t}\\b`, 'i').test(text)) found.add(t);
  }

  if (!found.size) return { blocked: false };

  const table = [...found][0];
  const error =
    `wrong_data_plane: ${table} is Postgres (Supabase agentsam.* via Hyperdrive), not D1. ` +
    `Use a hyperdrive/supabase catalog tool.`;
  return {
    blocked: true,
    table,
    error,
    user_message:
      `${table} lives in Supabase (Hyperdrive), not Cloudflare D1. ` +
      `Do not call d1_query for this table — use the Supabase/Hyperdrive SQL tool instead.`,
  };
}

export { POSTGRES_ONLY_TABLES };
