/**
 * Preferences surface registry — theme, legacy preferences, storage-preferences, user-policy.
 */
import { handleSettingsProfileRoutes } from './profile.js';
import { handleSettingsStoragePrefsRoutes } from './storage-preferences.js';
import { handleSettingsPolicyRoutes } from './policy.js';

export async function handleSettingsPreferencesRoutes(request, env, ctx, authContext) {
  const { pathLower } = authContext || {};
  const prefPaths =
    pathLower === '/api/settings/theme' ||
    pathLower === '/api/settings/preferences' ||
    pathLower === '/api/settings/storage-preferences' ||
    pathLower === '/api/settings/user-policy' ||
    pathLower === '/api/settings/feature-flags' ||
    (pathLower && pathLower.startsWith('/api/settings/feature-flags/'));
  if (!prefPaths) return null;
  for (const fn of [
    () => handleSettingsProfileRoutes(request, env, ctx, authContext),
    () => handleSettingsStoragePrefsRoutes(request, env, ctx, authContext),
    () => handleSettingsPolicyRoutes(request, env, ctx, authContext),
  ]) {
    const res = await fn();
    if (res) return res;
  }
  return null;
}
