function trim(v) { return v == null ? '' : String(v).trim(); }

export function normalizeCmsPageSlug(value) {
  return trim(value).replace(/^\/+|\/+$/g, '').replace(/\s+/g, '-').toLowerCase();
}

export function normalizeCmsPageRoute(value, slug = '') {
  let route = trim(value);
  if (!route) route = slug ? `/${normalizeCmsPageSlug(slug)}` : '/';
  if (!route.startsWith('/')) route = `/${route}`;
  route = route.replace(/\/{2,}/g, '/');
  if (route.length > 1) route = route.replace(/\/+$/g, '');
  return route || '/';
}

export function normalizeCmsPageType(value, routePath) {
  const route = normalizeCmsPageRoute(routePath);
  const type = trim(value).toLowerCase();
  if (route === '/') return 'home';
  if (type === 'home') return 'standard';
  return type || 'custom';
}

export function normalizeCmsPageStatus(value) {
  const status = trim(value).toLowerCase();
  return ['draft', 'published', 'archived'].includes(status) ? status : 'draft';
}

export function normalizeCmsPageRow(row) {
  if (!row || typeof row !== 'object') return null;
  const routePath = normalizeCmsPageRoute(row.route_path || row.path, row.slug);
  const pageType = normalizeCmsPageType(row.page_type, routePath);
  const projectSlug = trim(row.project_slug || row.project_id) || null;
  const out = {
    ...row,
    project_id: trim(row.project_id) || projectSlug,
    project_slug: projectSlug,
    slug: normalizeCmsPageSlug(row.slug || (routePath === '/' ? 'home' : routePath)),
    route_path: routePath,
    path: routePath,
    page_type: pageType,
    status: normalizeCmsPageStatus(row.status),
  };
  delete out.is_homepage;
  return out;
}

export function normalizeCmsPageCreateInput(input, context = {}) {
  const projectSlug = trim(input?.project_slug || input?.project_id || context.projectSlug);
  const title = trim(input?.title);
  const routeHint = trim(input?.route_path || input?.path);
  const slug = normalizeCmsPageSlug(
    input?.slug || (routeHint === '/' ? 'home' : routeHint) || title,
  );
  const routePath = normalizeCmsPageRoute(input?.route_path, slug);
  const pageType = normalizeCmsPageType(input?.page_type, routePath);
  if (!projectSlug) return { ok: false, error: 'project_slug_required' };
  if (!title) return { ok: false, error: 'title_required' };
  if (!slug) return { ok: false, error: 'slug_required' };
  return {
    ok: true,
    page: {
      project_id: projectSlug,
      project_slug: projectSlug,
      slug,
      title,
      status: normalizeCmsPageStatus(input?.status),
      route_path: routePath,
      path: routePath,
      page_type: pageType,
      seo_title: trim(input?.seo_title) || title,
      meta_description: trim(input?.meta_description) || null,
      robots: trim(input?.robots) || null,
      sort_order: Number.isFinite(Number(input?.sort_order)) ? Number(input.sort_order) : 0,
    },
  };
}

const UPDATE_FIELDS = new Set(['title','seo_title','meta_description','robots','page_type','sort_order','route_path','slug']);
export function normalizeCmsPageUpdateInput(current, input) {
  const next = { ...normalizeCmsPageRow(current) };
  let touched = false;
  for (const key of UPDATE_FIELDS) {
    if (!(key in (input || {}))) continue;
    touched = true;
    if (key === 'slug') next.slug = normalizeCmsPageSlug(input.slug);
    else if (key === 'route_path') next.route_path = normalizeCmsPageRoute(input.route_path, next.slug);
    else if (key === 'sort_order') next.sort_order = Number(input.sort_order) || 0;
    else next[key] = input[key];
  }
  if (!touched) return { ok: false, error: 'no_valid_fields' };
  next.route_path = normalizeCmsPageRoute(next.route_path, next.slug);
  next.path = next.route_path;
  next.page_type = normalizeCmsPageType(next.page_type, next.route_path);
  // Homepage routes use slug "home"; never treat "/" → "" as a validation failure.
  if (!next.slug && next.route_path === '/') next.slug = 'home';
  if (!next.slug) return { ok: false, error: 'slug_required' };
  return { ok: true, page: next };
}
