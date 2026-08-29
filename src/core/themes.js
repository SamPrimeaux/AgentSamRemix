/**
 * Centralized Theme Management System
 * Handles normalization, fallbacks, and workspace-to-slug mapping.
 */

const DEFAULT_DARK = 'meaux-storm-gray';
const DEFAULT_LIGHT = 'solarized-light';

/**
 * Normalizes any string or ID into a valid theme slug.
 */
export function normalizeThemeSlug(value, env = {}) {
    if (!value) return env.DEFAULT_THEME || DEFAULT_DARK;

    let s = String(value).toLowerCase().trim();
    s = s.replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');

    // Dynamic Color-Family Fallbacks
    if (['dark', 'black', 'midnight', 'night'].includes(s)) return env.DEFAULT_DARK_THEME || DEFAULT_DARK;
    if (['light', 'white', 'solarized-light', 'paper'].includes(s)) return env.DEFAULT_LIGHT_THEME || DEFAULT_LIGHT;

    return s;
}

/**
 * Resolves the theme for a specific workspace.
 */
export async function getWorkspaceTheme(env, workspaceId) {
    if (!env.DB || !workspaceId) return DEFAULT_DARK;

    try {
        const row = await env.DB.prepare(
            'SELECT theme_id FROM workspaces WHERE id = ? OR handle = ? LIMIT 1'
        ).bind(workspaceId, workspaceId).first();
        
        return normalizeThemeSlug(row?.theme_id, env);
    } catch (e) {
        console.error('[Themes] Failed to resolve workspace theme:', e.message);
        return env.DEFAULT_THEME || DEFAULT_DARK;
    }
}
