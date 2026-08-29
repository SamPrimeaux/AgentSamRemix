/**
 * Cloudflare Images delivery helpers for Media Library / DAM.
 * Named variants (account-level): avatar 200×200, small 400×400, …
 * Gallery / list previews: avatar on narrow viewports, small on desktop.
 */

const VARIANT_SUFFIX =
  /\/(public|small|thumbnail|avatar|hero|large|medium)(?:\?.*)?$/i;

export function cfImagesBaseUrl(url: string | null | undefined): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (!raw.includes('imagedelivery.net')) return raw;
  return raw.replace(VARIANT_SUFFIX, '/public');
}

export function cfImagesVariantUrl(
  url: string | null | undefined,
  variant: 'public' | 'small' | 'thumbnail' | 'avatar' | 'hero' | 'large' | 'medium' = 'public',
): string {
  const base = cfImagesBaseUrl(url);
  if (!base) return '';
  if (!base.includes('imagedelivery.net')) return base;
  return base.replace(/\/public$/, `/${variant}`);
}

/**
 * Responsive preview for gallery cards and detail default preview.
 * - Mobile / narrow: `avatar` (200×200)
 * - Desktop: `small` (400×400)
 * Uses srcset + sizes so the browser picks; fallback src is `small`.
 */
export function cloudflareImageUrl(
  url: string | null | undefined,
  _opts?: { width?: number; quality?: number; variant?: string },
): { src: string; srcSet?: string; sizes?: string } {
  const raw = String(url || '').trim();
  if (!raw) return { src: '' };
  if (!raw.includes('imagedelivery.net')) {
    return { src: raw };
  }
  const avatar = cfImagesVariantUrl(raw, 'avatar');
  const small = cfImagesVariantUrl(raw, 'small');
  return {
    src: small,
    srcSet: `${avatar} 200w, ${small} 400w`,
    sizes: '(max-width: 640px) 200px, 400px',
  };
}
