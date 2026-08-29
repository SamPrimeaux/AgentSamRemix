/**
 * Tool: Storage (R2)
 * R2: get / put / delete via Worker binding or user S3 credentials; list via catalog helpers.
 */
import {
  executeR2CatalogOperation,
  executeR2ListCatalogOperation,
} from './r2-object-crud.js';

export const handlers = {
  async r2_list(params, env) {
    const bucket = String(params?.bucket || '').trim();
    if (!bucket) {
      return {
        ok: false,
        error: 'bucket_required',
        user_message:
          'r2_list requires bucket. Use agentsam_cf_r2_buckets for account bucket inventory.',
      };
    }
    return executeR2ListCatalogOperation(env, params || {}, {}, 'objects');
  },
  async r2_search(params, env) {
    return handlers.r2_list(params, env);
  },
  async r2_bucket_summary() {
    return {
      ok: true,
      note: 'Bucket inventory via D1/registry only; object listing not available to agents.',
    };
  },
  async r2_read(params, env) {
    return executeR2CatalogOperation(env, params, {}, 'read');
  },
  async r2_write(params, env) {
    return executeR2CatalogOperation(env, params, {}, 'write');
  },
  async r2_delete(params, env) {
    return executeR2CatalogOperation(env, params, {}, 'delete');
  },
  async get_r2_url(params, env) {
    const bucket = String(params.bucket || '').trim();
    const key = String(params.key || params.path || '').trim();
    if (!bucket || !key) return { error: 'bucket and key required' };
    const origin = env.IAM_ORIGIN || 'https://inneranimalmedia.com';
    return {
      ok: true,
      url: `${origin}/api/r2/buckets/${encodeURIComponent(bucket)}/object/${encodeURIComponent(key)}`,
    };
  },
};
