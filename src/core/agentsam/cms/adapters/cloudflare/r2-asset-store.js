import { cmsR2PublicObjectUrl, getCmsR2Binding } from './storage.js';

export function createCloudflareCmsAssetObjectStore(env) {
  return {
    async get(locator) {
      const binding = getCmsR2Binding(env, locator?.bucket);
      if (!binding || !locator?.key) return null;
      return binding.get(locator.key).catch(() => null);
    },
    async head(locator) {
      const binding = getCmsR2Binding(env, locator?.bucket);
      if (!binding || !locator?.key || typeof binding.head !== 'function') return null;
      return binding.head(locator.key).catch(() => null);
    },
    async put(locator, value, options) {
      const binding = getCmsR2Binding(env, locator?.bucket);
      if (!binding || !locator?.key) throw new Error('CMS asset R2 binding unavailable');
      return binding.put(locator.key, value, options);
    },
    async remove(locator) {
      const binding = getCmsR2Binding(env, locator?.bucket);
      if (!binding || !locator?.key || typeof binding.delete !== 'function') return false;
      await binding.delete(locator.key);
      return true;
    },
    publicUrl(locator) {
      if (!locator?.key) return null;
      return cmsR2PublicObjectUrl(locator.bucket, locator.key);
    },
  };
}
