/** Workspace code-index truth for Projects and Settings. */
import { isHyperdriveUsable } from '../../backend/services/database/hyperdrive.js';
import { resolveSupabaseWorkspaceId } from '../../backend/rag/index.js';
import {
  FULL_INDEX_PIPELINE,
  PRODUCT_SOURCE_TYPE_SQL_IN,
  isProductCodeIndexSourceType,
  normalizeCodeIndexMode,
} from '../../backend/agentsam/codebase/codebase-full-index.js';

const FULL_PIPELINE = FULL_INDEX_PIPELINE;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeTs(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' || (/^\d+(\.\d+)?$/.test(String(raw)) && Number(raw) > 1e9)) {
    const value = Number(raw);
    const date = new Date(value > 1e12 ? value : value * 1000);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const date = new Date(String(raw));
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(raw);
}

export async function loadLatestDeployForWorkspace(env, workspaceId) {
  const ws = trim(workspaceId);
  if (!env?.DB || !ws) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT id, timestamp, created_at, git_hash, version, status, worker_name, environment
         FROM deployments WHERE workspace_id = ?
        ORDER BY COALESCE(timestamp, created_at) DESC LIMIT 1`,
    )
      .bind(ws)
      .first();
    if (!row) return null;
    return {
      at: row.timestamp || row.created_at || null,
      version: row.version || null,
      git_sha: row.git_hash || row.version || null,
      status: row.status || null,
      worker_name: row.worker_name || null,
      environment: row.environment || null,
      id: row.id || null,
      source: 'd1_deployments',
    };
  } catch (error) {
    console.warn('[workspace-code-index-status] deployments', error?.message ?? error);
    return null;
  }
}

const JOB_COLUMNS = `id, user_id, workspace_id, status, triggered_by, last_sync_at,
  started_at, finished_at, completed_at, updated_at, last_error, file_count,
  indexed_file_count, failed_file_count, progress_percent, repo_full_name,
  source_type, symbol_count, chunk_count, file_manifest, symbol_summary,
  dependency_summary, languages, total_size_bytes`;

/**
 * Prefer live work, then the most recently updated run. The rail must show
 * the latest failure (including a tree-sitter WASM abort), not an older richer
 * checkpoint whose error is no longer the current run's truth.
 */
const JOB_RAIL_ORDER = `
  CASE
    WHEN status IN ('running', 'queued') THEN 0
    WHEN status = 'idle' THEN 1
    WHEN status = 'completed' THEN 2
    WHEN status IN ('cancelled', 'failed', 'failed_partial') THEN 9
    ELSE 3
  END ASC,
  COALESCE(updated_at, finished_at, started_at, 0) DESC,
  rowid DESC`;

/** Live checkpoint/run — refresh must prefer this over terminal cancelled siblings. */
async function loadLiveCodeIndexJob(env, workspaceId, repoFullName = null) {
  const ws = trim(workspaceId);
  const repo = trim(repoFullName);
  if (!env?.DB || !ws) return null;
  const sql = repo
    ? `SELECT ${JOB_COLUMNS} FROM agentsam_code_index_job
        WHERE workspace_id = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
          AND repo_full_name = ? AND status IN ('running', 'queued', 'idle')
        ORDER BY ${JOB_RAIL_ORDER}
        LIMIT 1`
    : `SELECT ${JOB_COLUMNS} FROM agentsam_code_index_job
        WHERE workspace_id = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
          AND status IN ('running', 'queued', 'idle')
        ORDER BY ${JOB_RAIL_ORDER}
        LIMIT 1`;
  return repo
    ? env.DB.prepare(sql).bind(ws, repo).first().catch(() => null)
    : env.DB.prepare(sql).bind(ws).first().catch(() => null);
}

export async function loadCodeIndexJobById(env, workspaceId, runId) {
  const ws = trim(workspaceId);
  const id = trim(runId);
  if (!env?.DB || !ws || !id) return null;
  try {
    return (
      (await env.DB.prepare(
        `SELECT ${JOB_COLUMNS} FROM agentsam_code_index_job
          WHERE id = ? AND workspace_id = ? LIMIT 1`,
      )
        .bind(id, ws)
        .first()) || null
    );
  } catch (error) {
    console.warn('[workspace-code-index-status] code_index_job_by_id', error?.message ?? error);
    return null;
  }
}

/**
 * Compact list for Previous Runs dropdown (newest first among candidates).
 * @returns {Promise<Array<{
 *   run_id: string, status: string, stage: string|null, progress_percent: number,
 *   indexed_file_count: number, chunk_count: number, symbol_count: number,
 *   revision_sha: string|null, last_error: string|null, updated_at: string|null
 * }>>}
 */
export async function listCodeIndexPreviousRuns(env, workspaceId, repoFullName = null, limit = 12) {
  const ws = trim(workspaceId);
  const repo = trim(repoFullName);
  const lim = Math.min(25, Math.max(1, Number(limit) || 12));
  if (!env?.DB || !ws) return [];
  try {
    const rows = repo
      ? await env.DB.prepare(
          `SELECT id, status, progress_percent, indexed_file_count, chunk_count, symbol_count,
                  last_error, updated_at, finished_at, symbol_summary, file_manifest
             FROM agentsam_code_index_job
            WHERE workspace_id = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN} AND repo_full_name = ?
            ORDER BY ${JOB_RAIL_ORDER}
            LIMIT ?`,
        )
          .bind(ws, repo, lim)
          .all()
      : await env.DB.prepare(
          `SELECT id, status, progress_percent, indexed_file_count, chunk_count, symbol_count,
                  last_error, updated_at, finished_at, symbol_summary, file_manifest
             FROM agentsam_code_index_job
            WHERE workspace_id = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
            ORDER BY ${JOB_RAIL_ORDER}
            LIMIT ?`,
        )
          .bind(ws, lim)
          .all();
    const out = [];
    for (const row of rows?.results || []) {
      if (!row?.id) continue;
      const summary = parseObject(row.symbol_summary);
      const manifest = parseObject(row.file_manifest);
      const rev =
        (summary.revision_sha && String(summary.revision_sha)) ||
        (manifest.revision_sha && String(manifest.revision_sha)) ||
        (summary?.stages?.crawl?.revision_sha && String(summary.stages.crawl.revision_sha)) ||
        null;
      out.push({
        run_id: String(row.id),
        status: String(row.status || ''),
        stage: summary.stage != null ? String(summary.stage) : null,
        progress_percent: Math.max(0, Number(row.progress_percent) || 0),
        indexed_file_count: Math.max(0, Number(row.indexed_file_count) || 0),
        chunk_count: Math.max(0, Number(row.chunk_count) || 0),
        symbol_count: Math.max(0, Number(row.symbol_count) || 0),
        revision_sha: rev && /^[a-f0-9]{7,40}$/i.test(rev) ? rev : null,
        last_error: row.last_error != null ? String(row.last_error).slice(0, 160) : null,
        updated_at: normalizeTs(row.updated_at || row.finished_at),
      });
    }
    return out;
  } catch (error) {
    console.warn('[workspace-code-index-status] previous_runs', error?.message ?? error);
    return [];
  }
}

export async function loadLatestCodeIndexJob(env, workspaceId, repoFullName = null, preferredRunId = null) {
  const ws = trim(workspaceId);
  const repo = trim(repoFullName);
  const preferred = trim(preferredRunId);
  if (!env?.DB || !ws) return null;
  try {
    if (preferred) {
      const pinned = await loadCodeIndexJobById(env, ws, preferred);
      if (pinned) {
        const pinnedStatus = String(pinned.status || '').toLowerCase();
        // Keep explicit pin only while that run is still live. Otherwise fall through so a
        // newer idle/running job surfaces (refresh used to stay glued to the old ✓ baseline).
        if (['idle', 'running', 'queued'].includes(pinnedStatus)) return pinned;
      }
    }
    const live = await loadLiveCodeIndexJob(env, ws, repo);
    if (live) return live;
    if (repo) {
      const full = await env.DB.prepare(
        `SELECT ${JOB_COLUMNS} FROM agentsam_code_index_job
          WHERE workspace_id = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN} AND repo_full_name = ?
          ORDER BY ${JOB_RAIL_ORDER}
          LIMIT 1`,
      )
        .bind(ws, repo)
        .first()
        .catch(() => null);
      if (full) return full;
      return (
        (await env.DB.prepare(
          `SELECT ${JOB_COLUMNS} FROM agentsam_code_index_job
            WHERE workspace_id = ? AND repo_full_name = ?
            ORDER BY ${JOB_RAIL_ORDER}
            LIMIT 1`,
        )
          .bind(ws, repo)
          .first()
          .catch(() => null)) || null
      );
    }

    const full = await env.DB.prepare(
      `SELECT ${JOB_COLUMNS} FROM agentsam_code_index_job
        WHERE workspace_id = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
        ORDER BY ${JOB_RAIL_ORDER}
        LIMIT 1`,
    )
      .bind(ws)
      .first()
      .catch(() => null);
    if (full) return full;

    const canonical = await env.DB.prepare(
      `SELECT ${JOB_COLUMNS} FROM agentsam_code_index_job
        WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(`cidx_${ws}`, ws)
      .first()
      .catch(() => null);
    if (canonical) return canonical;

    return (
      (await env.DB.prepare(
        `SELECT ${JOB_COLUMNS} FROM agentsam_code_index_job
          WHERE workspace_id = ?
          ORDER BY ${JOB_RAIL_ORDER}
          LIMIT 1`,
      )
        .bind(ws)
        .first()) || null
    );
  } catch (error) {
    console.warn('[workspace-code-index-status] code_index_job', error?.message ?? error);
    return null;
  }
}

export async function loadAstGraphCounts(env, workspaceId, repoFullName = null, opts = {}) {
  const ws = trim(workspaceId);
  const repo = trim(repoFullName);
  const runId = trim(opts?.runId) || null;
  const out = {
    nodes: null,
    edges: null,
    files: null,
    symbols: null,
    linked_chunks: null,
    total_chunks: null,
    hyperdrive_ok: false,
    last_synced_at: null,
    nodes_updated_at: null,
    symbols_updated_at: null,
    workspace_uuid: null,
    repo: repo || null,
    /** 'run' = scoped to active/latest job; 'workspace' = historical debris possible */
    scope: runId ? 'run' : 'workspace',
    run_id: runId || null,
  };
  // Never invent a workspace — missing id means empty counts, not a platform default.
  if (!ws) return out;
  if (env?.DB) {
    try {
      if (runId) {
        const nodeRow = await env.DB.prepare(
          `SELECT COUNT(*) AS c, COUNT(DISTINCT file_path) AS files
             FROM codebase_ast_nodes
            WHERE index_job_id = ? AND workspace_id = ?`,
        )
          .bind(runId, ws)
          .first()
          .catch(() => null);
        out.nodes = Number(nodeRow?.c ?? 0);
        out.files = Number(nodeRow?.files ?? 0);
        const job = await env.DB.prepare(
          `SELECT ast_last_indexed_at, updated_at, chunk_count, symbol_count, indexed_file_count
             FROM agentsam_code_index_job
            WHERE id = ? AND workspace_id = ?
            LIMIT 1`,
        )
          .bind(runId, ws)
          .first()
          .catch(() => null);
        out.symbols = Number(job?.symbol_count ?? 0);
        out.total_chunks = Number(job?.chunk_count ?? 0);
        out.nodes_updated_at = normalizeTs(job?.ast_last_indexed_at || job?.updated_at);
      } else {
        const job = repo
          ? await env.DB.prepare(
              `SELECT ast_node_count, ast_file_count, ast_last_indexed_at, indexed_file_count, updated_at,
                      chunk_count, symbol_count
                 FROM agentsam_code_index_job
                WHERE workspace_id = ? AND repo_full_name = ?
                ORDER BY updated_at DESC
                LIMIT 1`,
            )
              .bind(ws, repo)
              .first()
          : await env.DB.prepare(
              `SELECT ast_node_count, ast_file_count, ast_last_indexed_at, indexed_file_count, updated_at,
                      chunk_count, symbol_count
                 FROM agentsam_code_index_job
                WHERE workspace_id = ?
                ORDER BY updated_at DESC
                LIMIT 1`,
            )
              .bind(ws)
              .first();
        out.nodes = Number(job?.ast_node_count ?? 0);
        out.files = Number(job?.ast_file_count ?? job?.indexed_file_count ?? 0);
        out.symbols = Number(job?.symbol_count ?? 0);
        out.total_chunks = Number(job?.chunk_count ?? 0);
        out.nodes_updated_at = normalizeTs(job?.ast_last_indexed_at || job?.updated_at);
      }
    } catch {
      out.nodes = null;
      out.files = null;
    }
    try {
      const row = repo
        ? await env.DB.prepare(
            `SELECT COUNT(*) AS c FROM codebase_dep_edges WHERE workspace_id = ? AND repo_full_name = ?`,
          )
            .bind(ws, repo)
            .first()
        : await env.DB.prepare(
            `SELECT COUNT(*) AS c FROM codebase_dep_edges WHERE workspace_id = ?`,
          )
            .bind(ws)
            .first();
      out.edges = Number(row?.c ?? 0);
    } catch {
      out.edges = null;
    }
  }

  const workspaceUuid = await resolveSupabaseWorkspaceId(env, ws).catch(() => null);
  out.workspace_uuid = workspaceUuid;
  // Rail is D1-only for Store/Nodes/edges. Do not COUNT via Hyperdrive here —
  // ~2.5s polling used to stack abandoned Postgres queries on Supavisor.
  // Indexer bulk writes use SUPABASE_DB_URL session pooler; retrieve ANN uses Hyperdrive.
  out.hyperdrive_ok = isHyperdriveUsable(env);
  out.last_synced_at = out.nodes_updated_at || null;
  return out;
}

const EMBED_USAGE_KIND = 'embedding';

export async function loadAstEmbedCostRollup(env, workspaceId) {
  const ws = trim(workspaceId);
  const empty = {
    cost_usd_30d: 0,
    cost_usd_today: 0,
    cost_usd_all: 0,
    embed_events_30d: 0,
    embed_events_today: 0,
    last_embed_at: null,
    cost_usd_this_run: null,
    embed_events_this_run: null,
    this_run_id: null,
  };
  if (!env?.DB || !ws) return empty;
  try {
    const row = await env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN created_at >= unixepoch() - 30 * 86400 THEN cost_usd ELSE 0 END), 0) AS cost_30d,
         COALESCE(SUM(CASE WHEN created_at >= unixepoch('now', 'start of day') THEN cost_usd ELSE 0 END), 0) AS cost_today,
         COALESCE(SUM(cost_usd), 0) AS cost_all,
         COALESCE(SUM(CASE WHEN created_at >= unixepoch() - 30 * 86400 THEN 1 ELSE 0 END), 0) AS n_30d,
         COALESCE(SUM(CASE WHEN created_at >= unixepoch('now', 'start of day') THEN 1 ELSE 0 END), 0) AS n_today,
         MAX(created_at) AS last_at
       FROM agentsam_usage_events
      WHERE workspace_id = ?
        AND usage_kind = ?`,
    )
      .bind(ws, EMBED_USAGE_KIND)
      .first();
    return {
      cost_usd_30d: Number(row?.cost_30d) || 0,
      cost_usd_today: Number(row?.cost_today) || 0,
      cost_usd_all: Number(row?.cost_all) || 0,
      embed_events_30d: Number(row?.n_30d) || 0,
      embed_events_today: Number(row?.n_today) || 0,
      last_embed_at: normalizeTs(row?.last_at),
      cost_usd_this_run: null,
      embed_events_this_run: null,
      this_run_id: null,
    };
  } catch (error) {
    console.warn('[workspace-code-index-status] embed_cost', error?.message ?? error);
    return empty;
  }
}

/** Embed spend attributed to one full-index job via usage ref_id (code-indexer writes this). */
export async function loadAstEmbedCostForRun(env, workspaceId, runId) {
  const ws = trim(workspaceId);
  const id = trim(runId);
  const empty = { cost_usd_this_run: 0, embed_events_this_run: 0, this_run_id: id || null };
  if (!env?.DB || !ws || !id) return empty;
  try {
    const row = await env.DB.prepare(
      `SELECT
         COALESCE(SUM(cost_usd), 0) AS cost_run,
         COUNT(*) AS n_run
       FROM agentsam_usage_events
      WHERE workspace_id = ?
        AND ref_table = 'agentsam_code_index_job'
        AND ref_id = ?
        AND usage_kind = ?`,
    )
      .bind(ws, id, EMBED_USAGE_KIND)
      .first();
    return {
      cost_usd_this_run: Number(row?.cost_run) || 0,
      embed_events_this_run: Number(row?.n_run) || 0,
      this_run_id: id,
    };
  } catch (error) {
    console.warn('[workspace-code-index-status] embed_cost_this_run', error?.message ?? error);
    return empty;
  }
}

function isActiveFullRun(run) {
  if (!run || String(run.pipeline || '') !== FULL_PIPELINE) return false;
  const status = String(run.status || '').toLowerCase();
  if (['completed', 'failed', 'cancelled', 'error'].includes(status)) return false;
  return ['idle', 'running', 'queued'].includes(status) || status === '';
}

function publicRun(job) {
  if (!job) return null;
  const summary = parseObject(job.symbol_summary);
  const manifest = parseObject(job.file_manifest);
  // Product family = pipeline; crawl scope = source_type. Mode stopgap until UI reads source_type.
  const isProduct =
    isProductCodeIndexSourceType(job.source_type) ||
    String(summary.pipeline || '') === FULL_PIPELINE;
  const mode = isProduct
    ? normalizeCodeIndexMode(summary.mode || manifest.mode || 'full')
    : summary.mode || 'legacy';
  const stages = summary.stages || {};
  const skippedUnchanged = Math.max(
    0,
    Number(stages?.parse_chunks?.skipped_unchanged) || 0,
  );
  return {
    run_id: String(job.id),
    job_id: String(job.id),
    pipeline: isProduct ? FULL_PIPELINE : summary.pipeline || 'legacy_code_index',
    mode,
    source_type: job.source_type != null ? String(job.source_type) : null,
    status: String(job.status || 'idle'),
    stage: isProduct ? summary.stage || 'queued' : 'legacy',
    readiness: isProduct ? summary.readiness || 'building' : 'legacy_unverified',
    revision_sha: manifest.revision_sha || summary.revision_sha || null,
    branch: manifest.branch || null,
    repo: job.repo_full_name || manifest.repo || null,
    progress_percent: Number(job.progress_percent) || 0,
    file_count: Number(job.file_count) || 0,
    indexed_file_count: Number(job.indexed_file_count) || 0,
    failed_file_count: Number(job.failed_file_count) || 0,
    chunk_count: Number(job.chunk_count) || 0,
    symbol_count: Number(job.symbol_count) || 0,
    skipped_unchanged: skippedUnchanged,
    structural_quality: summary.structural_quality || null,
    structural_quality_breakdown:
      summary.structural_quality_breakdown &&
      typeof summary.structural_quality_breakdown === 'object'
        ? summary.structural_quality_breakdown
        : null,
    stages,
    activated: summary.activated === true,
    calls_written: Math.max(
      0,
      Number(summary.calls_written) ||
        Number(stages?.calls_backfill?.calls_written) ||
        Number(stages?.activate?.calls_written) ||
        0,
    ),
    calls_backfill: stages?.calls_backfill || null,
    last_error: job.last_error || null,
    started_at: normalizeTs(job.started_at),
    completed_at: normalizeTs(job.completed_at || job.finished_at),
    updated_at: normalizeTs(job.updated_at),
    last_sync_at: normalizeTs(job.last_sync_at),
  };
}

/**
 * @param {any} env
 * @param {string} workspaceId
 * @param {{ repoFullName?: string|null, preferredRunId?: string|null }} [opts]
 */
export async function getWorkspaceCodeIndexStatus(env, workspaceId, opts = {}) {
  const ws = trim(workspaceId);
  const repo = trim(opts?.repoFullName) || null;
  const preferredRunId = trim(opts?.preferredRunId) || null;
  const [lastDeploy, job, embedCost, previousRuns] = await Promise.all([
    loadLatestDeployForWorkspace(env, ws),
    loadLatestCodeIndexJob(env, ws, repo, preferredRunId),
    loadAstEmbedCostRollup(env, ws),
    listCodeIndexPreviousRuns(env, ws, repo, 12),
  ]);
  const run = publicRun(job);
  // Scope Store/Nodes/Symbols/Linked to the rail-selected run (richest checkpoint),
  // not newest rowid — tiny webhook stubs must not hide a near-complete job.
  const scopeRunId =
    run?.run_id && String(run.pipeline || '') === FULL_PIPELINE ? String(run.run_id) : null;
  const ast = await loadAstGraphCounts(env, ws, repo, { runId: scopeRunId });
  // When PG rail COUNTs time out, surface D1 job counters so the panel is not blank.
  if (job && (ast.total_chunks == null || ast.symbols == null)) {
    if (ast.total_chunks == null && job.chunk_count != null) {
      ast.total_chunks = Number(job.chunk_count) || 0;
    }
    if (ast.symbols == null && job.symbol_count != null) {
      ast.symbols = Number(job.symbol_count) || 0;
    }
  }
  let costOut = { ...embedCost, active_full_run: false };
  if (run?.run_id && String(run.pipeline || '') === FULL_PIPELINE) {
    const thisRun = await loadAstEmbedCostForRun(env, ws, run.run_id);
    costOut = {
      ...costOut,
      ...thisRun,
      active_full_run: isActiveFullRun(run),
    };
  }
  return {
    ok: true,
    workspace_id: ws,
    github_repo: repo || run?.repo || null,
    last_deploy: lastDeploy,
    run,
    previous_runs: previousRuns,
    selected_run_id: run?.run_id || null,
    chunk_index: { job },
    ast: {
      ...ast,
      // Prefer this run's wall-clock activity over stale AST rollup times (refresh used to
      // show "Last sync 52m ago" while the rail run had just cancelled/failed).
      last_synced_at: run?.activated
        ? run.last_sync_at || ast.last_synced_at || run.updated_at
        : run?.updated_at || run?.last_sync_at || ast.last_synced_at,
    },
    embed_cost: costOut,
    notes: {
      product_action: 'Re-index queues sam.codebaseindex.index.run(mode=full).',
      readiness: 'Green requires an activated full run after crawl, parse, embed, and verify receipts.',
      legacy_ast_reembed: 'ast-symbol-reembed remains maintenance-only and cannot mark the product index green.',
      cost: 'cost_usd_this_run = usage ref_id (must match OpenAI bill for that run). Soft embed timeouts must not drop usage rows — see embedForIndex in code-indexer.',
      project_repo_scope: repo
        ? 'Counts and run are scoped to the project-bound GitHub repo.'
        : 'No project GitHub repo bound — connect a repo on the project page.',
      count_scope: scopeRunId
        ? 'Store/Nodes/Symbols/Linked are scoped to the rail-selected full-index run (highest progress checkpoint; not newest stub).'
        : 'No full-index run — counts are workspace-wide when present.',
    },
  };
}
