export function assertCmsTemplateStore(store) {
  for (const method of ['list','getById','upsert','patch']) {
    if (typeof store?.[method] !== 'function') throw new TypeError(`CMS template store missing ${method}()`);
  }
  return store;
}
