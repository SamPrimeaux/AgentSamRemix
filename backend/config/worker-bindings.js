/**
 * Production Worker bindings — wrangler.production.toml SSOT (static catalog).
 *
 * App-internal only: env.DB / env.HYPERDRIVE / env.ASSETS / … are never human-session bypasses.
 * Human Cloudflare/D1/R2 → OAuth-connected account or user_secrets (R2_* keys), not these bindings.
 *
 * Validated at build/sync time via backend/config/validate-worker-bindings.mjs
 *
 * @module backend/config/worker-bindings
 */

/** @typedef {typeof PRODUCTION_WORKER_BINDINGS} ProductionWorkerBindings */

/**
 * Full binding catalog for worker `inneranimalmedia`.
 * Keep aligned with wrangler.production.toml — run validate-worker-bindings before ship.
 */
export const PRODUCTION_WORKER_BINDINGS = Object.freeze({
  source: 'wrangler.production.toml',
  worker_name: 'inneranimalmedia',
  d1: Object.freeze([
    Object.freeze({
      binding: 'DB',
      database_name: 'inneranimalmedia-business',
      database_id: 'cf87b717-d4e2-4cf8-bab0-a81268e32d49',
    }),
  ]),
  hyperdrive: Object.freeze([
    Object.freeze({
      binding: 'HYPERDRIVE',
      id: '08183bb9d2914e87ac8395d7e4ecff60',
      note: 'inneranimalmedia-supabase-hyperdrive',
    }),
  ]),
  r2: Object.freeze([
    Object.freeze({ binding: 'ASSETS', bucket_name: 'inneranimalmedia' }),
    Object.freeze({ binding: 'AUTORAG_BUCKET', bucket_name: 'inneranimalmedia-autorag' }),
    Object.freeze({ binding: 'ARTIFACTS', bucket_name: 'artifacts' }),
    Object.freeze({ binding: 'CMS_BUCKET', bucket_name: 'cms' }),
    Object.freeze({ binding: 'CAD', bucket_name: 'cad' }),
  ]),
  kv: Object.freeze([
    Object.freeze({ binding: 'KV', namespace_id: '09438d5e4f664bf78467a15af7743c44' }),
    Object.freeze({ binding: 'SESSION_CACHE', namespace_id: 'dc87920b0a9247979a213c09df9a0234' }),
  ]),
  vectorize: Object.freeze([
    Object.freeze({
      binding: 'AGENTSAM_VECTORIZE_DOCUMENTS',
      index_name: 'agentsam-documents-oai3large-1536',
    }),
    Object.freeze({
      binding: 'AGENTSAM_VECTORIZE_COURSES',
      index_name: 'agentsam-courses-oai3large-1536',
    }),
    Object.freeze({
      binding: 'AGENTSAM_VECTORIZE_CODE',
      index_name: 'agentsam-codebase-oai3large-1536',
    }),
    Object.freeze({
      binding: 'AGENTSAM_VECTORIZE_SCHEMA',
      index_name: 'agentsam-schema-oai3large-1536',
    }),
    Object.freeze({
      binding: 'AGENTSAM_VECTORIZE_MEMORY',
      index_name: 'agentsam-memory-oai3large-1536',
    }),
    Object.freeze({
      binding: 'AGENTSAM_VECTORIZE_MEDIA',
      index_name: 'agentsam-moviemode-gemini2-1536',
    }),
  ]),
  ai: Object.freeze([Object.freeze({ binding: 'AI' })]),
  images: Object.freeze([
    Object.freeze({ binding: 'IMAGES', account_hash: 'g7wf09fCONpnidkRnR_5vw' }),
  ]),
  browser: Object.freeze([Object.freeze({ binding: 'MYBROWSER' })]),
  worker_loaders: Object.freeze([Object.freeze({ binding: 'LOADER' })]),
  services: Object.freeze([
    Object.freeze({ binding: 'MOVIEMODE_SERVICE', service: 'moviemode-service' }),
    Object.freeze({ binding: 'IAM_CODEBASE_INDEXER', service: 'iam-codebase-indexer-service' }),
    Object.freeze({ binding: 'CMS_PIPELINE', service: 'iam-cms-pipeline' }),
    Object.freeze({ binding: 'IAM_WORKFLOWS', service: 'iam-workflows' }),
    Object.freeze({ binding: 'EXECOS', service: 'execos' }),
  ]),
  vpc_services: Object.freeze([
    Object.freeze({
      binding: 'PTY_SERVICE',
      service_id: '019db639-7c70-7071-8ef3-32ec0392a9ff',
      remote: true,
    }),
  ]),
  durable_objects: Object.freeze([
    Object.freeze({ name: 'IAM_COLLAB', class_name: 'IAMCollaborationSession' }),
    Object.freeze({ name: 'CHESS_SESSION', class_name: 'ChessRoom' }),
    Object.freeze({ name: 'AGENT_SESSION', class_name: 'AgentChatSqlV1' }),
    Object.freeze({ name: 'OPENAI_RESPONSES_WS', class_name: 'OpenAiResponsesWsV1' }),
    Object.freeze({ name: 'BROWSER_SESSION', class_name: 'AgentBrowserLiveV1' }),
    Object.freeze({ name: 'MY_CONTAINER', class_name: 'MyContainer' }),
    Object.freeze({ name: 'IAM_CAD_WORKER', class_name: 'IamCadWorkerContainer' }),
  ]),
  containers: Object.freeze([
    Object.freeze({
      class_name: 'MyContainer',
      binding: 'MY_CONTAINER',
      image:
        'registry.cloudflare.com/ede6590ac0d2fb7daf155b35653457b2/inneranimalmedia-mycontainer@sha256:0360d567dc947a7debbd79cf53de3783198c7dc38d9feacc457d59544302273a',
      instance_type: 'basic',
      max_instances: 0,
    }),
    Object.freeze({
      class_name: 'IamCadWorkerContainer',
      binding: 'IAM_CAD_WORKER',
      image:
        'registry.cloudflare.com/ede6590ac0d2fb7daf155b35653457b2/meauxcontainer-cad-worker:cad-v1',
      instance_type: 'standard-2',
      max_instances: 5,
    }),
  ]),
  queues: Object.freeze([
    Object.freeze({
      binding: 'MY_QUEUE',
      queue: '74b3155b36334b69852411c083d50322',
      role: 'producer_and_consumer',
    }),
  ]),
  analytics_engine: Object.freeze([Object.freeze({ binding: 'WAE', dataset: 'inneranimalmedia' })]),
  pipelines: Object.freeze([
    Object.freeze({
      binding: 'INNERANIMALPRO_STREAM',
      stream: '7907f409b0d444b9a09c901fbdf05f1f',
    }),
  ]),
  routes: Object.freeze([
    'inneranimalmedia.com/*',
    'www.inneranimalmedia.com/*',
    'webhooks.inneranimalmedia.com/*',
    'studio.inneranimalmedia.com/*',
  ]),
});

/**
 * Snapshot for D1 workspace metadata_json.worker_bindings (includes sync timestamp).
 * @param {number} [syncedAt] unix seconds; defaults to now
 */
export function buildWorkerBindingsSnapshot(syncedAt = Math.floor(Date.now() / 1000)) {
  return {
    ...PRODUCTION_WORKER_BINDINGS,
    synced_at: syncedAt,
  };
}

/**
 * @param {string} bindingName
 * @returns {boolean}
 */
export function isPlatformWorkerBinding(bindingName) {
  const b = String(bindingName || '').trim();
  if (!b) return false;
  const catalog = PRODUCTION_WORKER_BINDINGS;
  const groups = [
    catalog.d1,
    catalog.hyperdrive,
    catalog.r2,
    catalog.kv,
    catalog.vectorize,
    catalog.ai,
    catalog.images,
    catalog.browser,
    catalog.worker_loaders,
    catalog.services,
    catalog.vpc_services,
    catalog.queues,
    catalog.analytics_engine,
    catalog.pipelines,
  ];
  for (const group of groups) {
    for (const row of group) {
      if (row.binding === b) return true;
    }
  }
  for (const row of catalog.durable_objects) {
    if (row.name === b) return true;
  }
  for (const row of catalog.containers) {
    if (row.binding === b) return true;
  }
  return false;
}
