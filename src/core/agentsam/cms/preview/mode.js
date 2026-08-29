export function normalizeCmsPreviewMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'draft' || raw === '1' || raw === 'true') return 'draft';
  if (raw === 'published' || raw === 'live') return 'published';
  return null;
}

export function parseCmsPreviewRequest(url) {
  const cmsEmbed = url?.searchParams?.get('cms') === '1';
  const previewMode = normalizeCmsPreviewMode(url?.searchParams?.get('preview'));
  const pageId = String(url?.searchParams?.get('page_id') || url?.searchParams?.get('page') || '').trim() || null;
  return { cmsEmbed, previewMode, pageId };
}

export function isPublicCmsPreviewRequest(url, method = 'GET') {
  const m = String(method || 'GET').toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') return false;
  const parsed = parseCmsPreviewRequest(url);
  return parsed.cmsEmbed || parsed.previewMode === 'draft' || parsed.previewMode === 'published';
}

export function resolveEffectiveCmsPreviewMode({ previewMode = null, cmsEmbed = false, userId = null } = {}) {
  const normalized = normalizeCmsPreviewMode(previewMode);
  if (normalized === 'draft' && !String(userId || '').trim()) return 'published';
  if (normalized) return normalized;
  if (cmsEmbed) return String(userId || '').trim() ? 'draft' : 'published';
  return 'published';
}

export function cmsPreviewCacheControl(mode) {
  return normalizeCmsPreviewMode(mode) === 'draft' ? 'private, no-store, max-age=0' : 'public, max-age=300';
}
