const REQUIRED_RUNTIME_ADAPTERS = [
  'resolveSiteConfig',
  'resolvePublicDomain',
  'resolveStorage',
];

export function assertCmsRuntimeAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('CMS runtime adapter required');
  for (const key of REQUIRED_RUNTIME_ADAPTERS) {
    if (typeof adapter[key] !== 'function') throw new TypeError(`CMS runtime adapter missing ${key}()`);
  }
  return adapter;
}
