-- Layer 1: provider console/admin truth vs our internal truth, per model per day
CREATE TABLE IF NOT EXISTS agentsam_usage_reconcile_daily (
  id            TEXT PRIMARY KEY DEFAULT ('urc_' || lower(hex(randomblob(8)))),
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  day           TEXT NOT NULL,             -- YYYY-MM-DD, UTC
  console_tokens_in   INTEGER NOT NULL DEFAULT 0,
  console_tokens_out  INTEGER NOT NULL DEFAULT 0,
  console_cost_usd    REAL NOT NULL DEFAULT 0,
  internal_tokens_in  INTEGER NOT NULL DEFAULT 0,
  internal_tokens_out INTEGER NOT NULL DEFAULT 0,
  internal_cost_usd   REAL NOT NULL DEFAULT 0,
  delta_pct_tokens    REAL NOT NULL DEFAULT 0,   -- negative = we're undercounting
  delta_pct_cost      REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'ok', -- ok | drift | adapter_error
  checked_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(provider, model, day)
);

-- Layer 2: internal-only cross-check, agentsam_agent_run (dispatch) vs
-- agentsam_usage_events (post-stream write). No external API involved --
-- pinpoints WHERE in our own pipeline events are lost, not whether they are.
CREATE TABLE IF NOT EXISTS agentsam_agent_usage_integrity (
  id                TEXT PRIMARY KEY DEFAULT ('aui_' || lower(hex(randomblob(8)))),
  day               TEXT NOT NULL,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  agent_run_rows        INTEGER NOT NULL DEFAULT 0, -- agentsam_agent_run count
  agent_run_completed    INTEGER NOT NULL DEFAULT 0, -- status='completed' subset
  usage_event_rows      INTEGER NOT NULL DEFAULT 0, -- agentsam_usage_events count
  agent_run_tokens_in   INTEGER NOT NULL DEFAULT 0,
  usage_event_tokens_in INTEGER NOT NULL DEFAULT 0,
  gap_pct_tokens        REAL NOT NULL DEFAULT 0,    -- (agent_run - usage_events) / agent_run
  checked_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(day, provider, model)
);
