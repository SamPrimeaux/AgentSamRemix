export function assertCmsAssetStore(store) {
  for (const method of ['list', 'getById', 'insert', 'update', 'remove', 'listCollection']) {
    if (typeof store?.[method] !== 'function') throw new TypeError(`CMS asset store missing ${method}()`);
  }
  return store;
}

export function assertCmsAssetObjectStore(store) {
  for (const method of ['get', 'head', 'put', 'remove', 'publicUrl']) {
    if (typeof store?.[method] !== 'function') throw new TypeError(`CMS asset object store missing ${method}()`);
  }
  return store;
}
