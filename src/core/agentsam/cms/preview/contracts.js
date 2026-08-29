export function assertCmsPreviewStore(store) {
  for (const method of ['getPageById', 'findPageByRoute', 'listSections', 'listBlocks', 'getDraft']) {
    if (typeof store?.[method] !== 'function') throw new TypeError(`CMS preview store missing ${method}()`);
  }
  return store;
}
