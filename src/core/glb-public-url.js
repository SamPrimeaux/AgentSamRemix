/**
 * Flatten chess GLB URLs to same-origin Worker /assets/ passthrough (avoids assets.* CF challenge).
 * @param {string|null|undefined} input
 * @returns {string}
 */
export function normalizeGlbPublicUrl(input) {
  const s = input != null ? String(input).trim() : '';
  if (!s) return '';

  if (s.startsWith('/assets/')) return s;

  try {
    const u = new URL(s, 'https://inneranimalmedia.com');
    // Dedicated CAD bucket is public + CDN-fronted — always load cross-origin, never flatten.
    if (u.hostname === 'cad.inneranimalmedia.com') return s;
    if (u.hostname === 'assets.inneranimalmedia.com') {
      const p = u.pathname.replace(/^\/+/, '');
      if (p.startsWith('chess-pieces/')) {
        return `/assets/glb/chess/${p.replace(/^chess-pieces\//, '')}`;
      }
      if (p.startsWith('glb/')) return `/assets/${p}`;
      if (p.startsWith('assets/')) return `/assets/${p}`;
    }
    if (u.hostname.includes('inneranimalmedia.com') && u.pathname.startsWith('/assets/')) {
      return u.pathname;
    }
    const m = u.pathname.match(/\/glb\/chess\/v1\/(.+)$/i);
    if (m) return `/assets/glb/chess/v1/${m[1]}`;

    if (u.hostname.includes('pub-e733f82cb31c4f34b6a719e749d0416d.r2.dev')) {
      const tail = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
      if (tail) return `/assets/glb/${tail}`;
    }
  } catch (_) {}

  return s;
}
