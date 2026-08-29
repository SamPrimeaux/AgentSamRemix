/**
 * Routes Cloudflare Queue messages by payload shape (legacy worker.js parity).
 *
 * Playwright screenshot jobs are registered from Worker composition (src/index.js)
 * so this queue module does not import backend/browser (platform ↛ backend).
 */
import { deleteVectorsForDocKey, performDocsBucketVectorizeIndex } from '../../../src/queue/docs-vectorize.js';
import { getDocsVectorizePauseState } from '../../../src/queue/docs-vectorize-pause.js';
import { resolveAutoragBucketName } from '../../../src/core/r2-storage-scope.js';

/** @type {null | ((env: any, body: Record<string, unknown>) => Promise<unknown>)} */
let playwrightQueueJobHandler = null;

/** @param {(env: any, body: Record<string, unknown>) => Promise<unknown>} fn */
export function setPlaywrightQueueJobHandler(fn) {
  playwrightQueueJobHandler = typeof fn === 'function' ? fn : null;
}
function normalizeQueueBody(msg) {
  if (!msg?.body) return {};
  if (typeof msg.body === 'object') return msg.body;
  if (typeof msg.body === 'string') {
    try {
      return JSON.parse(msg.body || '{}');
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * @param {any} env
 * @param {ExecutionContext} ctx
 * @param {string} tenantId
 * @param {string} workspaceId
 * @param {Record<string, unknown>} body
 */
async function recordWebhookEvent(env, ctx, tenantId, workspaceId, body) {
  if (!env?.DB) return;
  const isCfSystem = typeof body?.type === 'string' && body.type.startsWith('cf.workers');
  const provider = isCfSystem ? 'cloudflare' : 'internal';
  const { ingestWebhookEventAndDispatch } = await import('../webhooks/ingest.js');
  const { resolveWebhookInsertScope, extractGithubRepoFromWebhookPayload, extractWorkerNameFromWebhookPayload } = await import(
    '../../services/webhooks/ledger.js',
  );
  const repoFullName = extractGithubRepoFromWebhookPayload(body, null);
  const workerName = extractWorkerNameFromWebhookPayload(body, null);
  const metadata = {
    ...(repoFullName ? { repo_full_name: repoFullName } : {}),
    ...(workerName ? { worker_name: workerName } : {}),
  };
  const scope = await resolveWebhookInsertScope(env, {
    tenantId: tenantId ?? null,
    workspaceId: workspaceId ?? null,
    provider,
    eventType: String(body?.type ?? 'unknown'),
    payload: typeof body === 'object' && body ? body : null,
    metadata: Object.keys(metadata).length ? metadata : null,
  });
  await ingestWebhookEventAndDispatch(env, ctx, {
    tenantId: scope.tenantId ?? null,
    workspaceId: scope.workspaceId ?? null,
    provider,
    eventType: String(body?.type ?? 'unknown'),
    payload: {
      ...(typeof body === 'object' && body ? body : {}),
      workspace_id: scope.workspaceId ?? workspaceId ?? null,
    },
    metadata: Object.keys(metadata).length ? metadata : null,
    endpointPath: '/api/webhooks/cloudflare',
    signatureValid: true,
  });
}

/**
 * Handle inneranimalmedia-autorag R2 Put/Delete → documents Vectorize lane.
 * @param {any} env
 * @param {Record<string, unknown>} body
 */
async function handleAutoragMdEvent(env, body) {
  const r2SourceOk = body.source === 'r2' || body.source == null || body.source === undefined;
  const objectKey = body.object && typeof body.object.key === 'string' ? body.object.key : null;
  const bucketName = body.bucket;
  const action = body.action;
  const autoragBucket = resolveAutoragBucketName(env);
  if (!r2SourceOk || !autoragBucket || bucketName !== autoragBucket || !objectKey) return false;
  if (!objectKey.endsWith('.md')) return true;

  const putActions = new Set(['PutObject', 'CopyObject', 'CompleteMultipartUpload']);
  const delActions = new Set(['DeleteObject', 'LifecycleDeletion']);
  try {
    if (putActions.has(action)) {
      const pause = await getDocsVectorizePauseState(env);
      if (pause.paused) {
        console.warn('[queue autorag-docs] put skipped (paused)', {
          key: objectKey,
          reason: pause.reason,
        });
        return true;
      }
      await performDocsBucketVectorizeIndex(env, objectKey);
    } else if (delActions.has(action)) {
      await deleteVectorsForDocKey(env, objectKey);
      if (env.DB) {
        await env.DB.prepare(`UPDATE docs_index_log SET deleted_at = datetime('now'), status = 'deleted' WHERE key = ?`)
          .bind(objectKey)
          .run()
          .catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[queue autorag-docs]', e?.message ?? e);
  }
  return true;
}

function isPlaywrightJobBody(body) {
  const jobId = body?.jobId;
  const jt = body?.job_type;
  return !!(jobId && (jt === 'screenshot' || jt === 'render' || jt === 'quality_report'));
}

/**
 * @param {any} env
 * @param {ExecutionContext} ctx
 * @param {import('@cloudflare/workers-types').Message} queueMsg
 * @returns {Promise<{ handled: boolean, kind: string }>}
 */
export async function dispatchQueueMessage(env, ctx, queueMsg) {
  const body = normalizeQueueBody(queueMsg);

  let tenantId = body.tenantId ?? body.tenant_id;
  let workspaceId = body.workspaceId ?? body.workspace_id;
  const isCfSystem = typeof body.type === 'string' && body.type.startsWith('cf.workers');
  if (isCfSystem) {
    // Explicitly system-scoped queue messages may use platform env bindings.
    tenantId = typeof env?.TENANT_ID === 'string' && env.TENANT_ID.trim() ? env.TENANT_ID.trim() : tenantId;
    workspaceId =
      typeof env?.WORKSPACE_ID === 'string' && env.WORKSPACE_ID.trim()
        ? env.WORKSPACE_ID.trim()
        : workspaceId;
  }

  if (body.type === 'codebase_index_sync') {
    console.warn(
      '[queue] codebase_index_sync retired — use agentsam_codebase_reindex.mjs + rag_ingest --lane code (public.codebase_* removed)',
    );
    return { handled: true, kind: 'codebase_index_sync_retired' };
  }

  if (body.type === 'codebase_full_index_batch') {
    try {
      const { handleCodebaseFullIndexQueueJob } = await import(
        '../../agentsam/codebase/queue-handler.js'
      );
      const result = await handleCodebaseFullIndexQueueJob(env, body);
      return { handled: true, kind: 'codebase_full_index_batch', ...result };
    } catch (e) {
      console.warn('[queue codebase_full_index_batch]', e?.message ?? e);
      throw e;
    }
  }

  const r2SourceOk = body.source === 'r2' || body.source == null || body.source === undefined;
  const bucketName = body.bucket;
  const objectKey = body.object && typeof body.object.key === 'string' ? body.object.key : null;
  const autoragBucket = resolveAutoragBucketName(env);
  if (r2SourceOk && autoragBucket && bucketName === autoragBucket && objectKey) {
    await handleAutoragMdEvent(env, body);
    return { handled: true, kind: 'r2_autorag_md' };
  }

  if (isPlaywrightJobBody(body)) {
    try {
      if (typeof playwrightQueueJobHandler !== 'function') {
        console.warn('[queue playwright] handler not registered');
      } else {
        await playwrightQueueJobHandler(env, body);
      }
    } catch (e) {
      console.warn('[queue playwright]', e?.message ?? e);
    }
    return { handled: true, kind: 'playwright_job' };
  }

  if (body.type === 'cms_liquid_import') {
    try {
      const { handleCmsLiquidImportQueueJob } = await import('../../../src/queue/handlers/cms-liquid-import.js');
      await handleCmsLiquidImportQueueJob(env, body);
    } catch (e) {
      console.warn('[queue cms_liquid_import]', e?.message ?? e);
    }
    return { handled: true, kind: 'cms_liquid_import' };
  }

  // MCP Resend hooks enqueue { type: 'alert', source: 'resend_webhook', event: 'email.bounced', … }
  if (body.type === 'alert') {
    try {
      const { handleQueueAlert } = await import('./alert.js');
      await handleQueueAlert(env, ctx, body);
    } catch (e) {
      console.info('[queue alert]', e?.message ?? e);
    }
    return { handled: true, kind: 'alert' };
  }

  if (typeof body.type === 'string' && body.type.startsWith('cf.workersBuilds.')) {
    await recordWebhookEvent(env, ctx, tenantId, workspaceId, body);
    return { handled: true, kind: body.type };
  }

  if (tenantId && workspaceId) {
    await recordWebhookEvent(env, ctx, tenantId, workspaceId, body);
    return { handled: true, kind: typeof body.type === 'string' ? body.type : 'webhook_event' };
  }

  const kind = typeof body.type === 'string' ? body.type : 'unknown';
  console.warn('[queue] unhandled_message_type', kind, JSON.stringify(body).slice(0, 500));
  return { handled: false, kind };
}
