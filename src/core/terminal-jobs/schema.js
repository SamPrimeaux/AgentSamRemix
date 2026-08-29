export function initializeTerminalJobsSchema(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS terminal_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued',
      protocol TEXT NOT NULL DEFAULT 'batch_exec',
      command TEXT NOT NULL,
      cwd TEXT,
      target_id TEXT,
      target_type TEXT,
      target_lane TEXT,
      transport TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      timeout_ms INTEGER,
      stdout_tail TEXT,
      stderr_tail TEXT,
      exit_code INTEGER,
      error TEXT,
      artifact_refs_json TEXT NOT NULL DEFAULT '[]',
      cleanup_json TEXT,
      instance_name TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER,
      finished_at INTEGER,
      cancel_requested_at INTEGER,
      cancel_reason TEXT,
      conversation_id TEXT,
      turn_id TEXT,
      user_id TEXT,
      workspace_id TEXT,
      tenant_id TEXT,
      agent_id TEXT,
      tool_call_id TEXT,
      idempotency_key TEXT,
      resume_policy TEXT NOT NULL DEFAULT 'none',
      retry_policy_json TEXT NOT NULL DEFAULT '{}',
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      resumed_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  const jobCols = [...sql.exec(`PRAGMA table_info(terminal_jobs)`)].map((row) => String(row.name));
  if (!jobCols.includes('cancel_reason')) sql.exec(`ALTER TABLE terminal_jobs ADD COLUMN cancel_reason TEXT`);
  if (!jobCols.includes('conversation_id')) sql.exec(`ALTER TABLE terminal_jobs ADD COLUMN conversation_id TEXT`);
  if (!jobCols.includes('turn_id')) sql.exec(`ALTER TABLE terminal_jobs ADD COLUMN turn_id TEXT`);
  if (!jobCols.includes('user_id')) sql.exec(`ALTER TABLE terminal_jobs ADD COLUMN user_id TEXT`);
  if (!jobCols.includes('workspace_id')) sql.exec(`ALTER TABLE terminal_jobs ADD COLUMN workspace_id TEXT`);
  if (!jobCols.includes('tenant_id')) sql.exec(`ALTER TABLE terminal_jobs ADD COLUMN tenant_id TEXT`);
  if (!jobCols.includes('agent_id')) sql.exec(`ALTER TABLE terminal_jobs ADD COLUMN agent_id TEXT`);
  if (!jobCols.includes('tool_call_id')) sql.exec(`ALTER TABLE terminal_jobs ADD COLUMN tool_call_id TEXT`);
  if (!jobCols.includes('idempotency_key')) sql.exec(`ALTER TABLE terminal_jobs ADD COLUMN idempotency_key TEXT`);
  if (!jobCols.includes('resume_policy')) sql.exec(`ALTER TABLE terminal_jobs ADD COLUMN resume_policy TEXT NOT NULL DEFAULT 'none'`);
  if (!jobCols.includes('retry_policy_json')) sql.exec(`ALTER TABLE terminal_jobs ADD COLUMN retry_policy_json TEXT NOT NULL DEFAULT '{}'`);
  if (!jobCols.includes('attempt')) sql.exec(`ALTER TABLE terminal_jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0`);
  if (!jobCols.includes('max_attempts')) sql.exec(`ALTER TABLE terminal_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 1`);
  if (!jobCols.includes('resumed_at')) sql.exec(`ALTER TABLE terminal_jobs ADD COLUMN resumed_at INTEGER`);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_terminal_jobs_status_updated ON terminal_jobs(status, updated_at)`);
  sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_terminal_jobs_idempotency ON terminal_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != ''`);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS terminal_job_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_terminal_job_events_job ON terminal_job_events(job_id, seq)`);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS terminal_job_dependencies (
      job_id TEXT NOT NULL,
      depends_on_job_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (job_id, depends_on_job_id)
    )
  `);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_terminal_job_dependencies_dep ON terminal_job_dependencies(depends_on_job_id)`);
}

export function recoverInterruptedTerminalJobs(sql) {
  const interrupted = [...sql.exec(
    `SELECT id, status FROM terminal_jobs WHERE status = 'running'`,
  )];
  if (!interrupted.length) return 0;
  sql.exec(`UPDATE terminal_jobs
    SET status = 'failed', error = 'terminal_job_interrupted_by_do_restart', progress = 100,
        finished_at = unixepoch(), updated_at = unixepoch()
    WHERE status = 'running'`);
  for (const row of interrupted) {
    sql.exec(
      `INSERT INTO terminal_job_events (job_id, event_type, payload)
       VALUES (?, 'failed', ?)`,
      String(row.id),
      JSON.stringify({
        job_id: String(row.id),
        status: 'failed',
        error: 'terminal_job_interrupted_by_do_restart',
        recovered_from: String(row.status || ''),
      }),
    );
  }
  return interrupted.length;
}
