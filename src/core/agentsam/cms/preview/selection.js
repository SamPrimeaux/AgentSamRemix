import { normalizeCmsPageRoute } from '../pages/normalize.js';

export function cmsPreviewRouteCandidates(routePath) {
  const route = normalizeCmsPageRoute(routePath);
  if (route === '/') return ['/', '/home'];
  if (route === '/home') return ['/home', '/'];
  return [route];
}

export function selectCmsPreviewPage(pages, { routePath = '/', explicitPageId = null, includeDraft = false } = {}) {
  const rows = Array.isArray(pages) ? pages.filter(Boolean) : [];
  if (explicitPageId) {
    const byId = rows.find((p) => String(p.id || '') === String(explicitPageId));
    if (byId && (includeDraft ? String(byId.status || '') !== 'archived' : String(byId.status || '') === 'published')) return byId;
  }
  const candidates = cmsPreviewRouteCandidates(routePath);
  for (const route of candidates) {
    const found = rows.find((p) => {
      const status = String(p.status || '').toLowerCase();
      if (includeDraft ? status === 'archived' : status !== 'published') return false;
      return normalizeCmsPageRoute(p.route_path || p.path, p.slug) === route;
    });
    if (found) return found;
  }
  const slug = normalizeCmsPageRoute(routePath).replace(/^\//, '');
  if (slug) {
    return rows.find((p) => {
      const status = String(p.status || '').toLowerCase();
      if (includeDraft ? status === 'archived' : status !== 'published') return false;
      return String(p.slug || '').toLowerCase() === slug.toLowerCase();
    }) || null;
  }
  return null;
}

export function mergeCmsDraftSections(sections, draftData) {
  const draftSections = draftData && typeof draftData === 'object' ? draftData.sections : null;
  if (!draftSections || typeof draftSections !== 'object') return sections || [];
  return (sections || []).map((section) => {
    const override = draftSections[section.id];
    if (!override || typeof override !== 'object') return section;
    const base = section.data && typeof section.data === 'object'
      ? section.data
      : section.section_data && typeof section.section_data === 'object'
        ? section.section_data
        : {};
    if ('data' in section) return { ...section, data: { ...base, ...override } };
    return { ...section, section_data: { ...base, ...override } };
  });
}

export function filterCmsPreviewVisibility(sections, mode) {
  if (mode !== 'published') return sections || [];
  return (sections || []).filter((s) => s.visible === true || s.is_visible === true || s.is_visible === 1);
}
