import { handlePlaywrightQueueJob } from '../browser/runtime/screenshot-queue-job.js';
import { dispatchQueueMessage, setPlaywrightQueueJobHandler } from '../queue/dispatcher.js';
import { wrapEnvKvBinding } from './kv-storage-policy.js';

setPlaywrightQueueJobHandler(handlePlaywrightQueueJob);

/**
 * Cloudflare queue() composition owned by backend/worker.
 * Await each message in-handler so full-index jobs cannot be cancelled by an
 * early handler return.
 */
export async function handleWorkerQueue(batch, env, ctx) {
  env = wrapEnvKvBinding(env);
  const messages = batch?.messages || [];
  for (const msg of messages) {
    let body = {};
    try {
      body =
        msg.body && typeof msg.body === 'object'
          ? msg.body
          : typeof msg.body === 'string'
            ? JSON.parse(msg.body || '{}')
            : {};
    } catch {
      body = {};
    }

    if (body?.type === 'codebase_index_sync') {
      console.warn(
        '[queue] codebase_index_sync retired — use agentsam_codebase_reindex.mjs + rag_ingest --lane code',
      );
      msg.ack();
      continue;
    }

    try {
      await dispatchQueueMessage(env, ctx, msg);
      msg.ack();
    } catch (error) {
      const kind = typeof body?.type === 'string' ? body.type : 'unknown';
      console.error('[queue] dispatch failed', kind, error?.message);
      msg.retry();
    }
  }
}
