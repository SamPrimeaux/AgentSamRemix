import { handleScheduled } from '../jobs/scheduled.js';
import { wrapEnvKvBinding } from './kv-storage-policy.js';

/** Cloudflare scheduled() composition owned by backend/worker. */
export function handleWorkerScheduled(event, env, ctx) {
  ctx.waitUntil(handleScheduled(event, wrapEnvKvBinding(env), ctx));
}
