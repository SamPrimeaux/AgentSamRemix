/**
 * Settings sections: grouped small read-only status getters, none large
 * enough to warrant its own module individually.
 * - GET /api/settings/cicd               -> getCicd
 * - GET /api/settings/docs               -> getDocs
 * - GET /api/settings/themes/status      -> getThemesStatus
 * - GET /api/settings/hooks/status       -> getHooksStatus
 * - GET /api/settings/billing/status     -> getBillingStatus
 * - GET /api/settings/tools/status       -> getToolsStatus
 * - GET /api/settings/integrations/status -> getIntegrationsStatus
 * Deconstructed from src/api/settings-sections.js (Sections peel SEC7 --
 * final peel in this sequence -- no behavior change).
 */
import { jsonResponse } from '../../agentsam/shared.js';
import { tableExists, safeQueryAll, safeFirst, stripSecretFields, envelope } from './shared.js';

// ─── Section: CI/CD ──────────────────────────────────────────────────────────
async function getCicd(env, authUser, workspaceId) {
  const warnings = [];
  const cache = new Map();
  const db = env.DB;
  const wsId = workspaceId || '';

  const scripts = await safeQueryAll(
    db,
    'agentsam_scripts',
    wsId
      ? `SELECT id, name, slug, language, runner, risk_level, is_active, created_by_user_id,
                last_run_at_epoch, created_at_epoch, updated_at_epoch
         FROM agentsam_scripts WHERE workspace_id = ?
         ORDER BY COALESCE(updated_at_epoch, created_at_epoch) DESC LIMIT 200`
      : `SELECT id, name, slug, language, runner, risk_level, is_active, created_by_user_id,
                last_run_at_epoch, created_at_epoch, updated_at_epoch
         FROM agentsam_scripts ORDER BY COALESCE(updated_at_epoch, created_at_epoch) DESC LIMIT 200`,
    wsId ? [wsId] : [],
    warnings,
    cache,
  );

  const recentRuns = await safeQueryAll(
    db,
    'agentsam_script_runs',
    wsId
      ? `SELECT id, script_id, status, exit_code, started_at_epoch, completed_at_epoch, duration_ms, triggered_by
         FROM agentsam_script_runs WHERE workspace_id = ? ORDER BY started_at_epoch DESC LIMIT 50`
      : `SELECT id, script_id, status, exit_code, started_at_epoch, completed_at_epoch, duration_ms, triggered_by
         FROM agentsam_script_runs ORDER BY started_at_epoch DESC LIMIT 50`,
    wsId ? [wsId] : [],
    warnings,
    cache,
  );

  const cicdRuns = await safeQueryAll(
    db,
    'cicd_pipeline_runs',
    `SELECT run_id, env, status, branch, commit_hash, triggered_at, completed_at, notes
     FROM cicd_pipeline_runs ORDER BY COALESCE(completed_at, triggered_at) DESC LIMIT 25`,
    [],
    warnings,
    cache,
  );

  const deploymentHealth = await safeQueryAll(
    db,
    'agentsam_deployment_health',
    wsId
      ? `SELECT environment, status, checked_at, response_time_ms, http_status_code, error_message
         FROM agentsam_deployment_health WHERE workspace_id = ? ORDER BY checked_at DESC LIMIT 10`
      : `SELECT environment, status, checked_at, response_time_ms, http_status_code, error_message
         FROM agentsam_deployment_health ORDER BY checked_at DESC LIMIT 10`,
    wsId ? [wsId] : [],
    warnings,
    cache,
  );

  const dashboardVersions = await safeQueryAll(
    db,
    'dashboard_versions',
    `SELECT version, deployed_at, git_commit, environment, locked_by, description
     FROM dashboard_versions ORDER BY deployed_at DESC LIMIT 10`,
    [],
    warnings,
    cache,
  );

  const activeScripts = scripts.filter((s) => Number(s.is_active) === 1).length;
  const recentFailures = recentRuns.filter(
    (r) => String(r.status || '').toLowerCase() === 'failed',
  ).length;
  const recentSuccesses = recentRuns.filter(
    (r) => String(r.status || '').toLowerCase() === 'passed' ||
           String(r.status || '').toLowerCase() === 'success',
  ).length;

  return envelope('cicd', {
    summary: {
      total_scripts: scripts.length,
      active_scripts: activeScripts,
      recent_runs: recentRuns.length,
      recent_failures: recentFailures,
      recent_successes: recentSuccesses,
      latest_dashboard_version: dashboardVersions[0]?.version || null,
      latest_deployed_at: dashboardVersions[0]?.deployed_at || cicdRuns[0]?.completed_at || null,
    },
    rows: scripts,
    warnings,
    actions: [
      {
        key: 'run_smoke',
        label: 'Run smoke pipeline',
        enabled: false,
        reasonDisabled:
          'Run is disabled here because the approval-gated runner is configured under /api/cicd, not Settings.',
      },
      {
        key: 'rollback',
        label: 'Rollback last deploy',
        enabled: false,
        reasonDisabled: 'Rollback is disabled because no safe rollback workflow is wired yet.',
      },
    ],
    extra: {
      recent_runs: recentRuns,
      cicd_pipeline_runs: cicdRuns,
      deployment_health: deploymentHealth,
      dashboard_versions: dashboardVersions,
    },
  });
}

// ─── Section: Docs ───────────────────────────────────────────────────────────
async function getDocs(env, authUser, workspaceId) {
  const warnings = [];
  const cache = new Map();
  const db = env.DB;
  const wsId = workspaceId || '';

  const cmsPages = await safeQueryAll(
    db,
    'cms_pages',
    wsId
      ? `SELECT id, slug, title, status, updated_at FROM cms_pages WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 50`
      : `SELECT id, slug, title, status, updated_at FROM cms_pages ORDER BY updated_at DESC LIMIT 50`,
    wsId ? [wsId] : [],
    warnings,
    cache,
  );

  const ruleDocs = await safeQueryAll(
    db,
    'agentsam_rules_document',
    `SELECT id, title, workspace_id, is_active, updated_at_epoch FROM agentsam_rules_document
      WHERE (workspace_id = ? OR workspace_id IS NULL)
        AND (user_id = ? OR user_id IS NULL)
      ORDER BY COALESCE(updated_at_epoch, 0) DESC LIMIT 50`,
    [wsId, String(authUser?.id || '')],
    warnings,
    cache,
  );

  const projectContext = await safeQueryAll(
    db,
    'agentsam_project_context',
    `SELECT id, scope_type, scope_id, kind, updated_at FROM agentsam_project_context ORDER BY COALESCE(updated_at, id) DESC LIMIT 25`,
    [],
    warnings,
    cache,
  );

  const cmsAssets = await safeFirst(
    db,
    'cms_assets',
    `SELECT COUNT(*) AS n FROM cms_assets`,
    [],
    warnings,
    cache,
  );

  const r2Inventory = await safeFirst(
    db,
    'r2_object_inventory',
    `SELECT COUNT(*) AS n FROM r2_object_inventory`,
    [],
    warnings,
    cache,
  );

  return envelope('docs', {
    summary: {
      cms_pages_count: cmsPages.length,
      rule_documents_count: ruleDocs.length,
      project_context_entries: projectContext.length,
      cms_assets_total: Number(cmsAssets?.n || 0),
      r2_object_inventory_total: Number(r2Inventory?.n || 0),
      knowledge_graph_status: 'supabase',
      knowledge_graph_note:
        'Supabase tables documents / knowledge_edges / semantic_search_log power retrieval; not enumerated here for size.',
    },
    rows: cmsPages,
    warnings,
    actions: [
      {
        key: 'reingest_docs',
        label: 'Re-ingest documentation',
        enabled: false,
        reasonDisabled:
          'Re-ingest is disabled because no safe doc-ingest endpoint is wired in this dashboard yet.',
      },
    ],
    extra: {
      rule_documents: ruleDocs,
      project_context: projectContext,
    },
  });
}

// ─── Section: Themes ─────────────────────────────────────────────────────────
async function getThemesStatus(env, authUser, workspaceId) {
  const warnings = [];
  const cache = new Map();
  const db = env.DB;
  const userId = String(authUser?.id || '').trim();
  const wsId = workspaceId || '';

  const themes = await safeQueryAll(
    db,
    'cms_themes',
    `SELECT id, slug, display_name, scope, preview_url, is_default, created_at, updated_at
     FROM cms_themes ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 50`,
    [],
    warnings,
    cache,
  );

  const userPref = await safeFirst(
    db,
    'cms_theme_preferences',
    `SELECT user_id, workspace_id, theme_id, scope, updated_at FROM cms_theme_preferences WHERE user_id = ? LIMIT 1`,
    [userId],
    warnings,
    cache,
  );

  const wsPref =
    wsId && (await tableExists(db, 'cms_theme_preferences', cache))
      ? await safeFirst(
          db,
          'cms_theme_preferences',
          `SELECT user_id, workspace_id, theme_id, scope, updated_at FROM cms_theme_preferences WHERE workspace_id = ? AND scope IN ('workspace','global') ORDER BY updated_at DESC LIMIT 1`,
          [wsId],
          warnings,
          cache,
        )
      : null;

  return envelope('themes', {
    summary: {
      theme_count: themes.length,
      user_theme_id: userPref?.theme_id || null,
      workspace_theme_id: wsPref?.theme_id || null,
      scope: userPref?.scope || wsPref?.scope || 'user',
    },
    rows: themes,
    warnings,
    actions: [
      {
        key: 'save_theme',
        label: 'Save theme preference',
        enabled: true,
      },
    ],
  });
}

// ─── Section: Hooks ──────────────────────────────────────────────────────────
async function getHooksStatus(env) {
  const warnings = [];
  const cache = new Map();
  const db = env.DB;

  const hooks = await safeQueryAll(
    db,
    'agentsam_hook',
    `SELECT id, trigger, command, provider, is_active, created_at, updated_at FROM agentsam_hook ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 100`,
    [],
    warnings,
    cache,
  );

  const executions = await safeQueryAll(
    db,
    'agentsam_hook_execution',
    `SELECT id, hook_id, status, started_at, finished_at, exit_code FROM agentsam_hook_execution ORDER BY started_at DESC LIMIT 50`,
    [],
    warnings,
    cache,
  );

  const cronRuns = await safeQueryAll(
    db,
    'agentsam_cron_runs',
    `SELECT id, job_name, status, started_at, finished_at, duration_ms FROM agentsam_cron_runs ORDER BY started_at DESC LIMIT 20`,
    [],
    warnings,
    cache,
  );

  const compaction = await safeQueryAll(
    db,
    'agentsam_compaction_events',
    `SELECT id, provider, model_key, tokens_before, tokens_after,
            COALESCE(tokens_saved, tokens_before - tokens_after) AS tokens_saved,
            cost_saved_usd, compaction_strategy, summary_text, compacted_at,
            agent_id, workspace_id, user_id, metadata_json
     FROM agentsam_compaction_events ORDER BY compacted_at DESC LIMIT 20`,
    [],
    warnings,
    cache,
  );

  const webhookWeekly = await safeQueryAll(
    db,
    'agentsam_webhook_weekly',
    `SELECT week_start_unix, tenant_id, workspace_id, provider, event_type,
            total_received, total_processed, total_failed, total_cost_usd, updated_at
     FROM agentsam_webhook_weekly
     ORDER BY week_start_unix DESC LIMIT 8`,
    [],
    warnings,
    cache,
  );

  return envelope('hooks', {
    summary: {
      hook_count: hooks.length,
      active_hooks: hooks.filter((h) => Number(h.is_active) === 1).length,
      recent_executions: executions.length,
      recent_failures: executions.filter((e) => Number(e.exit_code) !== 0 && e.exit_code != null).length,
      latest_cron_run: cronRuns[0]?.started_at || null,
      latest_compaction: compaction[0]?.compacted_at || null,
    },
    rows: hooks,
    warnings,
    extra: {
      executions,
      cron_runs: cronRuns,
      compaction_events: compaction,
      webhook_weekly: webhookWeekly,
    },
  });
}

// ─── Section: Plan & Usage status ────────────────────────────────────────────
async function getBillingStatus(env, authUser, workspaceId) {
  const warnings = [];
  const cache = new Map();
  const db = env.DB;
  const wsId = workspaceId || '';
  const userId = String(authUser?.id || '').trim();

  const plans = await safeQueryAll(
    db,
    'billing_plans',
    `SELECT id, display_name, monthly_token_limit, daily_request_limit, monthly_price_usd FROM billing_plans ORDER BY monthly_price_usd ASC, id ASC LIMIT 25`,
    [],
    warnings,
    cache,
  );

  const subscription = await safeFirst(
    db,
    'agentsam_subscription_registry',
    `SELECT user_id, workspace_id, plan_id, status, started_at, current_period_end FROM agentsam_subscription_registry WHERE user_id = ? ORDER BY started_at DESC LIMIT 1`,
    [userId],
    warnings,
    cache,
  );

  const dailyRollups = await safeQueryAll(
    db,
    'agentsam_usage_rollups_daily',
    wsId
      ? `SELECT day, total_tokens, total_cost_usd, request_count FROM agentsam_usage_rollups_daily WHERE workspace_id = ? ORDER BY day DESC LIMIT 30`
      : `SELECT day, total_tokens, total_cost_usd, request_count FROM agentsam_usage_rollups_daily ORDER BY day DESC LIMIT 30`,
    wsId ? [wsId] : [],
    warnings,
    cache,
  );

  const wsUsage = await safeFirst(
    db,
    'workspace_usage_metrics',
    wsId
      ? `SELECT workspace_id, period_start, period_end, total_tokens, total_cost_usd FROM workspace_usage_metrics WHERE workspace_id = ? ORDER BY period_end DESC LIMIT 1`
      : `SELECT workspace_id, period_start, period_end, total_tokens, total_cost_usd FROM workspace_usage_metrics ORDER BY period_end DESC LIMIT 1`,
    wsId ? [wsId] : [],
    warnings,
    cache,
  );

  return envelope('billing', {
    summary: {
      plan_count: plans.length,
      subscription_status: subscription?.status || null,
      subscription_plan: subscription?.plan_id || null,
      latest_daily_cost_usd: Number(dailyRollups[0]?.total_cost_usd ?? 0),
      latest_daily_tokens: Number(dailyRollups[0]?.total_tokens ?? 0),
      workspace_period_cost_usd: Number(wsUsage?.total_cost_usd ?? 0),
      workspace_period_tokens: Number(wsUsage?.total_tokens ?? 0),
    },
    rows: plans,
    warnings,
    extra: {
      daily_rollups: dailyRollups,
      workspace_usage: wsUsage,
      subscription,
    },
  });
}

// ─── Section: Tools status ───────────────────────────────────────────────────
async function getToolsStatus(env, authUser, workspaceId) {
  const warnings = [];
  const cache = new Map();
  const db = env.DB;
  const wsId = workspaceId || '';

  const servers = await safeQueryAll(
    db,
    'agentsam_mcp_servers',
    `SELECT id, name, endpoint_url, status, transport, last_seen_at FROM agentsam_mcp_servers ORDER BY name LIMIT 50`,
    [],
    warnings,
    cache,
  );

  const tools = await safeQueryAll(
    db,
    'agentsam_tools',
    `SELECT id, tool_key, json_extract(handler_config, '$.server_key') AS server_key, risk_level, is_active AS is_enabled, updated_at FROM agentsam_tools ORDER BY tool_key LIMIT 200`,
    [],
    warnings,
    cache,
  );

  const allowlist = await safeQueryAll(
    db,
    'agentsam_mcp_allowlist',
    wsId
      ? `SELECT tool_key, scope, notes, created_at FROM agentsam_mcp_allowlist WHERE workspace_id = ? OR workspace_id IS NULL ORDER BY tool_key`
      : `SELECT tool_key, scope, notes, created_at FROM agentsam_mcp_allowlist ORDER BY tool_key LIMIT 200`,
    wsId ? [wsId] : [],
    warnings,
    cache,
  );

  const recentExec = await safeQueryAll(
    db,
    'agentsam_mcp_tool_execution',
    `SELECT id, tool_key,
            CASE WHEN COALESCE(denial_code, '') != '' THEN 'blocked' WHEN success = 1 THEN 'success' ELSE 'error' END AS status,
            duration_ms AS latency_ms, created_at
     FROM agentsam_mcp_tool_execution ORDER BY created_at DESC LIMIT 25`,
    [],
    warnings,
    cache,
  );

  const stats = await safeQueryAll(
    db,
    'agentsam_tool_stats_compacted',
    `SELECT tool_key, source_client, cost_basis, call_count, error_count,
            attributed_model_cost_usd, duration_sum_ms, metric_date, computed_at
     FROM agentsam_tool_stats_compacted
     WHERE metric_date >= date('now', '-7 days')
     ORDER BY call_count DESC LIMIT 25`,
    [],
    warnings,
    cache,
  );

  const fetchAllow = await safeQueryAll(
    db,
    'agentsam_fetch_domain_allowlist',
    `SELECT host, notes FROM agentsam_fetch_domain_allowlist ORDER BY host LIMIT 100`,
    [],
    warnings,
    cache,
  );

  const cmdAllow = await safeQueryAll(
    db,
    'agentsam_command_allowlist',
    `SELECT command, scope, notes FROM agentsam_command_allowlist ORDER BY command LIMIT 100`,
    [],
    warnings,
    cache,
  );

  return envelope('tools', {
    summary: {
      server_count: servers.length,
      tool_count: tools.length,
      allowlisted_tool_count: allowlist.length,
      fetch_allowlist_count: fetchAllow.length,
      command_allowlist_count: cmdAllow.length,
      recent_tool_executions: recentExec.length,
      recent_failures: recentExec.filter((r) => String(r.status || '').toLowerCase() === 'error' || String(r.status || '').toLowerCase() === 'failed').length,
    },
    rows: servers,
    warnings,
    extra: {
      tools,
      allowlist,
      command_allowlist: cmdAllow,
      fetch_allowlist: fetchAllow,
      executions: recentExec,
      stats,
    },
  });
}

// ─── Section: Integrations status ────────────────────────────────────────────
async function getIntegrationsStatus(env, authUser) {
  const warnings = [];
  const cache = new Map();
  const db = env.DB;
  const userId = String(authUser?.id || '').trim();

  const catalog = await safeQueryAll(
    db,
    'integration_catalog',
    `SELECT id, slug, display_name, category, auth_type, capabilities, is_published FROM integration_catalog ORDER BY display_name LIMIT 100`,
    [],
    warnings,
    cache,
  );

  const connections = await safeQueryAll(
    db,
    'integration_connections',
    `SELECT id, provider, status, account_label, account_identifier, last_verified_at, created_at, updated_at FROM integration_connections WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`,
    [userId],
    warnings,
    cache,
  );

  const healthChecks = await safeQueryAll(
    db,
    'integration_health_checks',
    `SELECT slug, status, latency_ms, error_message, checked_at FROM integration_health_checks ORDER BY checked_at DESC LIMIT 50`,
    [],
    warnings,
    cache,
  );

  const events = await safeQueryAll(
    db,
    'integration_events',
    `SELECT id, provider_key AS slug, event_type, actor AS severity, created_at
     FROM integration_events ORDER BY created_at DESC LIMIT 25`,
    [],
    warnings,
    cache,
  );

  const PROVIDERS = [
    'cloudflare',
    'supabase',
    'google_drive',
    'github',
    'openai',
    'anthropic',
    'google_ai',
    'workers_ai',
    'resend',
  ];

  const providers = PROVIDERS.map((slug) => {
    const conn = connections.find((c) => String(c.provider || '').toLowerCase().includes(slug));
    const health = healthChecks.find((h) => String(h.slug || '').toLowerCase() === slug);
    const status = conn
      ? String(conn.status || '').toLowerCase() || 'connected'
      : health
        ? String(health.status || '').toLowerCase()
        : 'not_connected';
    return {
      provider: slug,
      status,
      accountLabel: conn?.account_label || null,
      resourceLabel: conn?.account_identifier || null,
      lastCheckedAt: health?.checked_at || conn?.last_verified_at || conn?.updated_at || null,
      capabilities: [],
      warnings: [],
    };
  });

  return envelope('integrations', {
    summary: {
      catalog_count: catalog.length,
      connection_count: connections.length,
      connected_count: connections.filter((c) => String(c.status || '').toLowerCase() === 'connected').length,
      recent_health_checks: healthChecks.length,
      recent_events: events.length,
    },
    rows: connections,
    warnings,
    providers,
    extra: {
      catalog,
      health_checks: healthChecks,
      events,
    },
  });
}


export {
  getCicd,
  getDocs,
  getThemesStatus,
  getHooksStatus,
  getBillingStatus,
  getToolsStatus,
  getIntegrationsStatus,
};
