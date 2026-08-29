/**
 * Queue message inventory — derived from legacy worker.js `queue()` (lines ~6962–7046).
 * Extend QUEUE_MESSAGE_KINDS when adding handlers in dispatcher.js.
 */

/** @typedef {'codebase_index_sync'|'codebase_full_index_batch'|'r2_event_iam_docs_md'|'playwright_screenshot_or_render'|'alert'|'unknown'} QueueKind */

export const QUEUE_MESSAGE_KINDS = {
  /** Cloudflare Workers Builds notifications (build.started / build.succeeded / …) */
  CF_WORKERS_BUILDS: 'cf.workersBuilds.worker.build.*',
  /** Retired: public.codebase_* queue sync — use agentsam_codebase_reindex.mjs */
  CODEBASE_INDEX_SYNC: 'codebase_index_sync',
  /**
   * Durable full project reindex batch: run_id + workspace_id.
   * Producer: queueFullCodeIndexRun / enqueueFullCodeIndexBatch (MY_QUEUE).
   * Consumer: handlers/codebase-full-index.js → runCodeIndexJob → re-enqueue while resume.
   */
  CODEBASE_FULL_INDEX_BATCH: 'codebase_full_index_batch',
  /**
   * R2 event notification: bucket `inneranimalmedia-autorag`, object `.md`, actions PutObject|CopyObject|CompleteMultipartUpload|DeleteObject.
   * Handled: docs-vectorize.js → AGENTSAM_VECTORIZE_DOCUMENTS + docs_index_log.
   */
  R2_AUTORAG_MD: 'r2_event_autorag_md',
  /**
   * Playwright batch job: body.jobId + job_type `screenshot`|`render`|`quality_report` + url.
   * Handled: playwright-queue-job.js
   */
  PLAYWRIGHT_JOB: 'playwright_screenshot_or_render',
  /**
   * Operator alert (MCP Resend bounce/complaint/failed → MY_QUEUE).
   * Consumer: handlers/alert.js → agentsam_webhook_events (+ optional notifications).
   */
  ALERT: 'alert',
};

export const QUEUE_INVENTORY_DOC = `
Known Cloudflare Queue message shapes (production):

1. type=codebase_index_sync — tenantId/tenant_id, workspaceId/workspace_id, payload for codebase index sync.
2. type=cf.workersBuilds.worker.build.* — Cloudflare build lifecycle; audited to agentsam_webhook_events (provider cloudflare).
3. R2 notification (no type): bucket inneranimalmedia-autorag, object.key ending in .md, action PutObject|CopyObject|...
4. Playwright: jobId, job_type screenshot|render|quality_report, url — updates playwright_jobs in D1.
5. type=alert — severity/source/event/event_id (Resend bounce etc.); persist + notify, no unhandled warn.

Unhandled types are logged with [queue] unhandled_message_type and should be acked after instrumentation.
`;
