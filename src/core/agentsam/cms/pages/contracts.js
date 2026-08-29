const REQUIRED_PAGE_STORE = ['list','getById','routeExists','insert','updateMetadata','archive','restore'];
export function assertCmsPageStore(store) {
  if (!store || typeof store !== 'object') throw new TypeError('CMS page store required');
  for (const method of REQUIRED_PAGE_STORE) {
    if (typeof store[method] !== 'function') throw new TypeError(`CMS page store missing ${method}()`);
  }
  return store;
}
