/** Cloudflare Images URL variants for project card covers. */
export function cfImageVariants(url: string | null | undefined) {
  const raw = (url || '').trim();
  if (!raw) return { src: '', srcSet: undefined as string | undefined };
  if (!raw.includes('imagedelivery.net')) return { src: raw, srcSet: undefined };
  const publicUrl = raw.replace(/\/(small|thumbnail|avatar|hero)$/, '/public');
  const smallUrl = publicUrl.replace(/\/public$/, '/small');
  return { src: publicUrl, srcSet: `${smallUrl} 1x, ${publicUrl} 2x` };
}

/**
 * Responsive wallpaper URLs for full-bleed heroes.
 * `/hero` for large viewports, `/public` default, `/small` for narrow.
 */
export function cfHeroWallpaper(url: string | null | undefined) {
  const raw = (url || '').trim();
  if (!raw) return { small: '', public: '', hero: '' };
  if (!raw.includes('imagedelivery.net')) {
    return { small: raw, public: raw, hero: raw };
  }
  const publicUrl = raw.replace(/\/(small|thumbnail|avatar|hero|public)$/, '/public');
  return {
    small: publicUrl.replace(/\/public$/, '/small'),
    public: publicUrl,
    hero: publicUrl.replace(/\/public$/, '/hero'),
  };
}

export function projectInitials(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

/** Deterministic accent from project id for placeholder cards. */
export function projectAccentHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}
