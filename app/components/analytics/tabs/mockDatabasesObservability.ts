// mockDatabasesObservability.ts
// Phase 1 staging data — swap imports for useDatabasesObservability() in Phase 3.
// Sources will be: agentsam_execution_performance_metrics, agentsam_tool_call_log,
// /api/analytics/databases/summary|timeseries|queries|tables|health

export const HOURS_24 = Array.from({ length: 24 }, (_, i) =>
  `${String(i).padStart(2, '0')}:00`
);

export const kpiCards = [
  {
    id: 'queries',
    label: 'Total queries',
    value: '73k',
    trend: '+45.6%',
    dir: 'up' as const,
    spark: [180, 90, 40, 20, 15, 10, 8, 30, 200, 800, 1400, 2200, 3000, 4200, 2800, 1900, 1500, 2100, 3400, 3800, 2600, 1800, 1200, 900],
  },
  {
    id: 'rowsRead',
    label: 'Rows read',
    value: '62M',
    trend: '+775%',
    dir: 'up' as const,
    spark: [280, 240, 200, 160, 100, 80, 60, 40, 30, 20, 15, 12, 10, 8, 6, 5, 4, 3, 2, 2, 1, 1, 1, 1],
  },
  {
    id: 'rowsWritten',
    label: 'Rows written',
    value: '18k',
    trend: '+2.8%',
    dir: 'up' as const,
    spark: [260, 240, 280, 220, 240, 200, 220, 180, 200, 180, 160, 190, 210, 195, 185, 175, 190, 200, 180, 170, 190, 180, 175, 160],
  },
  {
    id: 'p95',
    label: 'P95 latency',
    value: '34ms',
    trend: '−8.2%',
    dir: 'down' as const,
    spark: [80, 120, 60, 140, 100, 180, 140, 160, 120, 100, 80, 120, 110, 100, 90, 80, 75, 80, 70, 60, 70, 80, 65, 55],
  },
  {
    id: 'errors',
    label: 'Errors',
    value: '12',
    trend: '−40%',
    dir: 'down' as const,
    spark: [60, 80, 40, 140, 60, 100, 40, 60, 40, 40, 30, 50, 40, 35, 30, 25, 40, 30, 25, 20, 30, 20, 15, 10],
  },
];

export const miniStats = [
  { label: 'Storage used', value: '52.1 MB' },
  { label: 'Tables', value: '612' },
  { label: 'Hyperdrive', value: 'healthy', status: 'healthy' as const },
  { label: 'D1 health', value: 'healthy', status: 'healthy' as const },
  { label: 'Cost est.', value: '$0.04' },
];

// Hero chart series
export const d1Series    = [180,90,40,20,15,10,8,30,200,800,1400,2200,3000,4200,2800,1900,1500,2100,3400,3800,2600,1800,1200,900];
export const supSeries   = [60,30,15,8,5,4,3,12,80,300,500,800,1100,1500,1000,700,550,800,1200,1400,950,650,440,320];
export const errSeries   = [0,0,0,0,0,0,0,0,1,0,2,0,1,0,0,0,3,0,1,0,2,0,1,1];

export const heroSeriesMap = {
  total:  { d1: d1Series,                                  sup: supSeries },
  reads:  { d1: d1Series.map(v => Math.round(v * 0.92)),  sup: supSeries.map(v => Math.round(v * 0.88)) },
  writes: { d1: d1Series.map(v => Math.round(v * 0.08)),  sup: supSeries.map(v => Math.round(v * 0.12)) },
  errors: { d1: errSeries,                                 sup: errSeries.map(v => Math.round(v * 0.3)) },
};

// Latency chart
export const p50Series = [0.28,0.25,0.22,0.20,0.19,0.18,0.20,0.24,0.30,0.35,0.38,0.42,0.40,0.38,0.36,0.34,0.36,0.40,0.44,0.48,0.42,0.38,0.34,0.30];
export const latencyMultipliers = { p50: 1, p95: 85, p99: 220 } as const;

// Query performance table
export interface QueryRow {
  fp: string;
  fullSql: string;
  pct: number;
  count: number;
  total: string;
  p50: string;
  p99: string;
  rowsRead: string;
  rpr: string;
  ds: 'd1' | 'supabase';
  lastSeen: string;
}

export const queryRows: QueryRow[] = [
  { fp: 'SELECT c.job_name, c.status, c.duration_ms, c.error... FROM cron_jobs c...', fullSql: 'SELECT c.job_name, c.status, c.duration_ms, c.error_message\nFROM cron_jobs c\nJOIN agentsam_agent_run r ON r.job_id = c.id\nWHERE c.tenant_id = ?\nORDER BY c.started_at DESC LIMIT ?', pct: 16.64, count: 708,   total: '7.8s',  p50: '8.8ms',   p99: '34.3ms', rowsRead: '19.96M', rpr: '854',   ds: 'd1',       lastSeen: '3s ago'  },
  { fp: 'WITH ranked AS (SELECT job_name, status, started_a...)',                     fullSql: 'WITH ranked AS (\n  SELECT job_name, status, started_at,\n  ROW_NUMBER() OVER (PARTITION BY job_name ORDER BY started_at DESC) rn\n  FROM cron_jobs WHERE tenant_id = ?\n)\nSELECT * FROM ranked WHERE rn <= ?', pct: 13.58, count: 614,   total: '6.3s',  p50: '10.4ms',  p99: '13.6ms', rowsRead: '13.87M', rpr: '122',   ds: 'd1',       lastSeen: '12s ago' },
  { fp: 'SELECT * FROM auth_users WHERE id = ? LIMIT ?',                              fullSql: 'SELECT * FROM auth_users WHERE id = ? LIMIT ?',                                                                                                                                                                                                                                                          pct: 5.71,  count: 13399, total: '2.7s',  p50: '0.2ms',   p99: '0.5ms',  rowsRead: '13.4k',  rpr: '1',     ds: 'd1',       lastSeen: '1s ago'  },
  { fp: 'SELECT COUNT(*) AS c FROM agentsam_webhook_events W...',                     fullSql: 'SELECT COUNT(*) AS c FROM agentsam_webhook_events\nWHERE workspace_id = ? AND status = ? AND created_at > ?',                                                                                                                                                                                           pct: 5.62,  count: 668,   total: '2.6s',  p50: '1.3ms',   p99: '52.4ms', rowsRead: '769.63k', rpr: '1.15k', ds: 'd1',       lastSeen: '4m ago'  },
  { fp: 'SELECT COUNT(*) AS total, SUM(CASE WHEN status = ...)',                      fullSql: "SELECT COUNT(*) AS total,\n  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed\nFROM agentsam_agent_run\nWHERE tenant_id = ? AND created_at BETWEEN ? AND ?",                                                                                                                          pct: 3.42,  count: 651,   total: '1.6s',  p50: '0.9ms',   p99: '22.5ms', rowsRead: '891.87k', rpr: '1.37k', ds: 'supabase', lastSeen: '8m ago'  },
  { fp: 'SELECT tool_key AS tool_name, description, input_sc...',                     fullSql: 'SELECT tool_key AS tool_name, description, input_schema, is_active\nFROM agentsam_mcp_allowlist\nWHERE workspace_id = ? AND is_active = 1',                                                                                                                                                             pct: 2.85,  count: 459,   total: '1.3s',  p50: '1.4ms',   p99: '11.8ms', rowsRead: '385.56k', rpr: '2',     ds: 'd1',       lastSeen: '2m ago'  },
  { fp: 'SELECT model_key, provider, cost_usd, latency_ms, s...',                     fullSql: 'SELECT model_key, provider, cost_usd, latency_ms, status\nFROM agentsam_ai WHERE is_active = 1 ORDER BY cost_usd ASC',                                                                                                                                                                                 pct: 2.33,  count: 662,   total: '1.1s',  p50: '0.7ms',   p99: '16.3ms', rowsRead: '117.85k', rpr: '2',     ds: 'd1',       lastSeen: '6s ago'  },
  { fp: "SELECT COALESCE(NULLIF(TRIM(ai_model_ref), ''), NUL...)",                    fullSql: "SELECT COALESCE(NULLIF(TRIM(ai_model_ref), ''), NULL) AS model_ref, COUNT(*) AS cnt\nFROM agentsam_tool_chain GROUP BY 1 ORDER BY cnt DESC LIMIT ?",                                                                                                                                                    pct: 2.26,  count: 550,   total: '1.1s',  p50: '1.5ms',   p99: '9.2ms',  rowsRead: '687.69k', rpr: '104',   ds: 'supabase', lastSeen: '14m ago' },
  { fp: 'SELECT w.id AS workspace_id, w.handle AS handle, aw...',                    fullSql: 'SELECT w.id AS workspace_id, w.handle AS handle, aw.role\nFROM agentsam_workspace_members aw\nJOIN workspaces w ON w.id = aw.workspace_id\nWHERE aw.user_id = ?',                                                                                                                                       pct: 2.14,  count: 5540,  total: '1.0s',  p50: '0.2ms',   p99: '0.9ms',  rowsRead: '11.08k',  rpr: '2',     ds: 'd1',       lastSeen: '0s ago'  },
  { fp: 'SELECT s.*, (SELECT COUNT(*) FROM agentsam_skill_in...)',                    fullSql: 'SELECT s.*,\n  (SELECT COUNT(*) FROM agentsam_skill_invocations WHERE skill_id = s.id) AS invocation_count\nFROM skills s\nWHERE s.tenant_id = ?\nORDER BY s.updated_at DESC',                                                                                                                          pct: 1.99,  count: 6,     total: '0.9s',  p50: '154.7ms', p99: '154.7ms', rowsRead: '14.67M', rpr: '9.78k', ds: 'supabase', lastSeen: '22m ago' },
];

export type HotTable = { name: string; val: string; ds: 'd1' | 'supabase' };

export const largestTables: HotTable[] = [
  { name: 'agentsam_execution_steps',   val: '8.3 MB',  ds: 'd1' },
  { name: 'agentsam_tool_call_log',     val: '5.1 MB',  ds: 'd1' },
  { name: 'agentsam_webhook_events',    val: '4.7 MB',  ds: 'd1' },
  { name: 'agentsam_mcp_tool_execution',val: '3.9 MB',  ds: 'd1' },
  { name: 'codebase_chunks',            val: '59.1 MB', ds: 'supabase' },
];

export const mostReadTables: HotTable[] = [
  { name: 'auth_users',                 val: '13.4k/run',  ds: 'd1' },
  { name: 'agentsam_agent_run',         val: '891k total', ds: 'd1' },
  { name: 'agentsam_webhook_events',    val: '769k total', ds: 'd1' },
  { name: 'workspaces',                 val: '11k total',  ds: 'd1' },
  { name: 'agentsam_ai',               val: '117k total', ds: 'd1' },
];

export const mostWrittenTables: HotTable[] = [
  { name: 'agentsam_tool_call_log',     val: '2.1k writes', ds: 'd1' },
  { name: 'agentsam_mcp_tool_execution',val: '1.8k writes', ds: 'd1' },
  { name: 'spend_ledger',               val: '1.4k writes', ds: 'd1' },
  { name: 'agent_telemetry',            val: '980 writes',  ds: 'd1' },
  { name: 'agentsam_execution_steps',   val: '740 writes',  ds: 'd1' },
];

export const largeObjects = [
  { name: 'public.codebase_chunks',                       size: '59.13 MB', pct: '41.66%' },
  { name: 'public.documents',                             size: '26.7 MB',  pct: '18.81%' },
  { name: 'public.codebase_files',                        size: '13.38 MB', pct: '9.43%'  },
  { name: 'public.documents_embedding_hnsw_cosine_idx',   size: '9.7 MB',   pct: '6.83%'  },
  { name: 'public.documents_embedding_hnsw_idx',          size: '9.63 MB',  pct: '6.79%'  },
];

export const timelineEvents = [
  { time: '12:58 AM', kind: 'ok'   as const, label: 'D1 query executed',           detail: 'SELECT agentsam_project_context WHERE tenant_id = ?', meta: '670 ms' },
  { time: '12:54 AM', kind: 'err'  as const, label: 'Hyperdrive error',             detail: 'permission denied for table auth_users',               meta: 'D1'     },
  { time: '12:52 AM', kind: 'info' as const, label: 'Schema migration applied',     detail: 'agentsam_mcp_allowlist ADD COLUMN workspace_id',        meta: 'migration' },
  { time: '12:47 AM', kind: 'info' as const, label: 'Table edited',                 detail: 'agentsam_model_catalog — 1 row updated',               meta: 'Supabase' },
  { time: '12:42 AM', kind: 'warn' as const, label: 'Slow query detected',          detail: 'agentsam_execution_steps',                             meta: 'P99 1.8s' },
  { time: '12:38 AM', kind: 'ok'   as const, label: 'D1 query executed',            detail: 'SELECT * FROM auth_users WHERE id = ? LIMIT ?',         meta: '0.2 ms' },
  { time: '12:31 AM', kind: 'ok'   as const, label: 'Hyperdrive pool refreshed',    detail: '08183bb9d291...',                                       meta: '18 conns' },
];
