/**
 * SQLite schema for AgentBrowserLiveV1 (BROWSER_SESSION DO).
 */

/**
 * @param {import('@cloudflare/workers-types').SqlStorage} sql
 */
export function initializeBrowserSessionSchema(sql) {
  const cols = sql.exec('PRAGMA table_info(live_browser_session)').toArray();
  const names = new Set(cols.map((c) => String(c.name)));
  if (names.has('agent_run_id') && !names.has('browser_session_id')) {
    sql.exec('DROP TABLE IF EXISTS live_browser_session_legacy');
    sql.exec('ALTER TABLE live_browser_session RENAME TO live_browser_session_legacy');
  }

  sql.exec(`CREATE TABLE IF NOT EXISTS live_browser_session (
    browser_session_id TEXT PRIMARY KEY,
    agent_run_id TEXT,
    session_id TEXT NOT NULL,
    target_id TEXT,
    current_url TEXT,
    title TEXT,
    devtools_frontend_url TEXT,
    web_socket_debugger_url TEXT,
    live_view_mode TEXT DEFAULT 'tab',
    status TEXT DEFAULT 'starting',
    devtools_url_expires_at INTEGER,
    keep_alive_ms INTEGER DEFAULT 600000,
    human_input_reason TEXT,
    resume_when TEXT,
    resume_selector TEXT,
    conversation_id TEXT,
    user_id TEXT,
    workspace_id TEXT,
    updated_at INTEGER DEFAULT (unixepoch())
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS live_browser_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  )`);
}
