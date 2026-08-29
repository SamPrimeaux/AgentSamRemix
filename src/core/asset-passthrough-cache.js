/**
 * Cache-Control for Worker /assets/* → R2 passthrough.
 * Immutable only for content-stable optimized GLBs (versioned / *_opt naming).
 */

/**
 * @param {string} key R2 object key (no leading slash)
 * @returns {string}
 */
export function assetPassthroughCacheControl(key) {
  const lower = String(key || '').toLowerCase();

  if (lower.endsWith('.webp') && lower.startsWith('glb/posters/')) {
    return 'public, max-age=31536000, immutable';
  }

  if (!lower.endsWith('.glb') && !lower.endsWith('.gltf')) {
    return 'public, max-age=3600';
  }

  // Optimized / version-stable GLBs under glb/ — safe for long immutable cache
  if (lower.startsWith('glb/')) {
    if (
      lower.endsWith('_opt.glb') ||
      /_v\d+[^/]*\.glb$/.test(lower) ||
      /_[a-f0-9]{8,}\.glb$/.test(lower)
    ) {
      return 'public, max-age=31536000, immutable';
    }
    return 'public, max-age=86400';
  }

  // Tenant CAD exports and mutable generated paths — shorter cache
  if (lower.startsWith('cad/') || lower.includes('/archive/') || lower.includes('/exports/')) {
    return 'public, max-age=3600';
  }

  return 'public, max-age=3600';
}
