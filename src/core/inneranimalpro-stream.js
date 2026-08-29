/**
 * Cloudflare Pipelines ingest for inneranimalpro (stream → SQL passthrough → R2/Iceberg sink).
 * Dashboard stream schema: user_id, event_name
 */

export const INNERANIMALPRO_STREAM_BINDING = 'INNERANIMALPRO_STREAM';

/** @param {any} env */
function getStreamBinding(env) {
  return env?.[INNERANIMALPRO_STREAM_BINDING] ?? env?.INNERANIMALPRO_STREAM_STREAM ?? null;
}

/**
 * Fire-and-forget analytics event. Never throws; safe on hot paths.
 *
 * @param {any} env
 * @param {{ userId?: string|null, eventName: string }} opts
 * @param {ExecutionContext} [ctx]
 */
export function emitInnerAnimalProEvent(env, { userId, eventName }, ctx) {
  const stream = getStreamBinding(env);
  const name = String(eventName || '').trim();
  if (!stream || !name) return;

  const record = {
    user_id: String(userId || 'system').slice(0, 256),
    event_name: name.slice(0, 512),
  };

  const task = stream.send([record]).catch(() => {});

  if (ctx?.waitUntil) {
    ctx.waitUntil(task);
  }
}
