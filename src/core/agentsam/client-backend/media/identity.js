const DEFAULT_TRACKING_PARAMS = Object.freeze([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
]);

function isTrackingParam(name, extra = []) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return false;
  if (key.startsWith('utm_')) return true;
  const all = new Set([...DEFAULT_TRACKING_PARAMS, ...extra.map((item) => String(item).toLowerCase())]);
  return all.has(key);
}

/**
 * Normalize a public source URL without guessing away provider transformation semantics.
 * Provider-specific transform collapsing happens in resolveCanonicalSourceAssetIdentity.
 */
export function normalizeSourceUrl(raw, baseUrl = undefined, options = {}) {
  const value = String(raw || '').trim();
  if (!value) return null;
  let url;
  try {
    url = baseUrl ? new URL(value, baseUrl) : new URL(value);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  url.hash = '';
  if (options.stripTracking !== false) {
    const extra = Array.isArray(options.trackingParams) ? options.trackingParams : [];
    for (const key of [...url.searchParams.keys()]) {
      if (isTrackingParam(key, extra)) url.searchParams.delete(key);
    }
  }
  if (options.sortQuery !== false) url.searchParams.sort();
  return url.toString();
}

function wixIdentity(url) {
  if (!/(^|\.)wixstatic\.com$/i.test(url.hostname)) return null;
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep encoded path */ }
  const match = path.match(/\/media\/([^/]+?)(?:\/v1\/|$)/i);
  if (!match?.[1]) return null;
  return {
    provider: 'wix',
    id: match[1],
    canonical_id: `wix:${match[1]}`,
  };
}

function godaddyIdentity(url) {
  if (!/(^|\.)(wsimg\.com|secureserver\.net)$/i.test(url.hostname)) return null;
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep encoded path */ }
  const basePath = path.split('/:/', 1)[0] || path;
  if (!basePath || basePath === '/') return null;
  const canonicalUrl = `${url.protocol}//${url.hostname}${basePath}`;
  return {
    provider: 'godaddy',
    id: canonicalUrl,
    canonical_id: `godaddy:${canonicalUrl}`,
  };
}

/**
 * Pre-download identity hint. This collapses known CDN resize/quality variants without
 * pretending they are byte-identical. SHA-256 after download remains authoritative
 * for exact content identity.
 */
export function resolveCanonicalSourceAssetIdentity(raw, baseUrl = undefined, options = {}) {
  const normalizedUrl = normalizeSourceUrl(raw, baseUrl, options);
  if (!normalizedUrl) return null;
  const url = new URL(normalizedUrl);
  const provider = wixIdentity(url) || godaddyIdentity(url);
  if (provider) return { ...provider, normalized_url: normalizedUrl };
  return {
    provider: 'url',
    id: normalizedUrl,
    canonical_id: `url:${normalizedUrl}`,
    normalized_url: normalizedUrl,
  };
}

export function canonicalSourceAssetId(raw, baseUrl = undefined, options = {}) {
  return resolveCanonicalSourceAssetIdentity(raw, baseUrl, options)?.canonical_id || null;
}

export function contentIdentityFromSha256(raw) {
  const hash = String(raw || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? `sha256:${hash}` : null;
}
