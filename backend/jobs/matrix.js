// Cron matrix — wrangler.production.toml [triggers] crons → handleScheduled in scheduled.js.
//
// Expression            Job
// --------------------- ----
// */20 * * * *          runMeshyCadReconcileJobs — Meshy CAD safety net (only when in-flight jobs > 0)
// */5 * * * *           approval notify + iMessage apply + sweepStaleChatAgentRuns (chat orphans after 8m)
//                       + countdown expiry + stale codebase_full reclaim
// (no trigger)          runContainerPrewarmCron — keep-warm; re-add CRON_CONTAINER_PREWARM
//                       only when CONTAINER_PREWARM_ENABLED=1
// */30 * * * *          runThirtyMinuteJobs — DB queue drain, non-chat stale runs (35m), chat sweep belt,
//                       pg_stat_statements_snapshot (Hyperdrive → D1 deltas for Supabase charts),
//                       agentsam_model_health_rollup (usage_events → availability circuit breaker)
// 0 * * * *             runHourlyRoutingJobs — await eto_apply_routing_arms first,
//                       then waitUntil reconcile + memory rollup (those jobs do not apply ETO)
// 0 0 * * *             runMidnightUtcJobs — retention purge (data_retention_policies), OAuth expiry,
//                       master retention, security scan, usage rollups, archive, daily digest;
//                       snapshot + Sunday runWeeklyRollup + webhook_weekly_rollup
// 0 1 * * *             scheduleOneAmMaintenance — webhook stuck-received repair, worker analytics rollup,
//                       calendar-day exact UPSERT (tool_call_log → tool_stats_compacted) then purge,
//                       OTLP rollup, code_index_runner (stale full-index reclaim + idle pump)
// 0 9 * * *             runFinancialCommandCron
// 0 9 * * 1             runIntegritySnapshot
// 30 13 * * *           sendDailyPlanEmail
// 5 9 * * *             runDailyEvolutionCuratorCron — evolution brief + router (Chicago ~04:05)
// 0 0 1 * *             runFirstOfMonthJobs — email monthly rollup + spend ledger
//
// Retention ownership (DELETE path):
// Table                         Days          Cron
// ----------------------------- ------------- ----
// agentsam_tool_call_log        1 (24h)       midnight runRetentionPurge (after usage rollup;
//                                             pre-purge → tool_stats_compacted + compaction_events + context_digest)
// agentsam_tool_chain           3             midnight
// agentsam_mcp_tool_execution   7             midnight
// agentsam_execution_steps      7             midnight
// agentsam_cron_runs            14            midnight
// otlp_traces                   7             midnight (unix_ns)
// system_health_snapshots       7             midnight
// deployment_notifications      14            midnight (status='sent')
// terminal_history              14            midnight (recorded_at unix)
// agentsam_workflow_runs        7             midnight (started_at unix)
// agentsam_memory               180 + decay   midnight (updated_at unix)
// agentsam_hook_execution       30            midnight
// agentsam_webhook_events       1             01:00 runRetentionPurge (data_retention_policies)
//                                             + 01:00 webhook_events_repair (stuck received → ignored)
// worker_analytics_events       72h raw       01:00 rollup (post-hourly)
// worker_analytics_hourly       30d           01:00 rollup trim
// agentsam_tool_cache           14d + 5000 cap  01:00 runToolCacheMaintenance
