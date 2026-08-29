/**
 * CMS R2 bucket binding — dedicated `cms` bucket (cms.inneranimalmedia.com).
 * Legacy pages may still reference inneranimalmedia on ASSETS.
 */

export const CMS_DEFAULT_R2_BUCKET = 'cms';
export const CMS_R2_PUBLIC_ORIGIN = 'https://cms.inneranimalmedia.com';

/** @param {any} env @param {string} [bucketName] */
export function getCmsR2Binding(env, bucketName) {
  const name = String(bucketName || CMS_DEFAULT_R2_BUCKET).trim().toLowerCase();
  if (name === 'cms') return env.CMS_BUCKET || env.ASSETS || env.R2;
  if (name === 'inneranimalmedia' || name === 'dashboard') return env.ASSETS || env.R2;
  if (name === 'inneranimalmedia-autorag' || name === 'autorag') return env.AUTORAG_BUCKET;
  if (name === 'artifacts') return env.ARTIFACTS;
  return env.CMS_BUCKET || env.ASSETS || env.R2;
}

/**
 * Public object URL for CMS section/page HTML on the cms R2 custom domain.
 * @param {string} bucket
 * @param {string} key
 */
export function cmsR2PublicObjectUrl(bucket, key) {
  const b = String(bucket || CMS_DEFAULT_R2_BUCKET).trim().toLowerCase();
  const k = String(key || '').replace(/^\//, '');
  if (!k) return null;
  if (b === 'cms') return `${CMS_R2_PUBLIC_ORIGIN}/${k}`;
  if (b === 'inneranimalmedia') return `https://assets.inneranimalmedia.com/${k}`;
  return null;
}

/**
 * Prefer primary R2 binding, then fallback (fixes inject written to `cms`
 * while storefront hydrate historically only queried ASSETS).
 * @param {unknown} primary
 * @param {unknown} fallback
 */
export function getCmsR2DualBinding(primary, fallback) {
  if (!primary && !fallback) return null;
  if (!fallback || fallback === primary) return primary || fallback;
  if (!primary) return fallback;
  return {
    async get(key) {
      const a = await primary.get(key).catch(() => null);
      if (a) return a;
      return fallback.get(key).catch(() => null);
    },
    async put(key, value, opts) {
      return primary.put(key, value, opts);
    },
    async head(key) {
      const a = await primary.head?.(key).catch(() => null);
      if (a) return a;
      return fallback.head?.(key).catch(() => null);
    },
  };
}
