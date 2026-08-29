/** Agent session Durable Object SQLite schema + compatibility migrations.
 * Session domain only — terminal job schema is composed by the DO shell (AgentChat.js).
 */
export function migrateSessionMessagesSchema(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS session_messages (
      id            TEXT PRIMARY KEY,
      turn_id       TEXT,
      role          TEXT NOT NULL,
      content       TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'complete',
      error         TEXT,
      model_used    TEXT,
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      tool_calls    TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  const cols = [...sql.exec(`PRAGMA table_info(session_messages)`)].map((c) => c.name);
  if (!cols.includes('status')) sql.exec(`ALTER TABLE session_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'complete'`);
  if (!cols.includes('error')) sql.exec(`ALTER TABLE session_messages ADD COLUMN error TEXT`);
  if (!cols.includes('turn_id')) sql.exec(`ALTER TABLE session_messages ADD COLUMN turn_id TEXT`);
  if (!cols.includes('tool_calls')) sql.exec(`ALTER TABLE session_messages ADD COLUMN tool_calls TEXT`);
  if (!cols.includes('updated_at')) sql.exec(`ALTER TABLE session_messages ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (unixepoch())`);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_session_messages_created_at ON session_messages(created_at)`);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_session_messages_turn_id ON session_messages(turn_id)`);
}

export function migrateTurnOutboxSchema(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS turn_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      turn_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_turn_outbox_turn ON turn_outbox(turn_id, seq)`);
}

export function migrateSessionAgentContextSchema(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS session_agent_context (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT,
      tools_json TEXT NOT NULL,
      write_policy_json TEXT NOT NULL,
      roots_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS fsa_fulfill (
      call_id TEXT PRIMARY KEY,
      result_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      fulfilled_at INTEGER
    )
  `);
}

export function initializeAgentSessionSchema(sql) {
  migrateSessionMessagesSchema(sql);
  migrateTurnOutboxSchema(sql);
  migrateSessionAgentContextSchema(sql);
  sql.exec(`CREATE TABLE IF NOT EXISTS session_rag_cache (
    query_hash TEXT PRIMARY KEY,
    chunk_ids TEXT,
    context TEXT,
    top_score REAL,
    cached_at INTEGER DEFAULT (unixepoch())
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS designstudio_event_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    envelope_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
}
