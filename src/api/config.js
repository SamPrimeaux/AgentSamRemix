/**
 * Client-safe config for dashboard (no secrets beyond public Supabase anon key).
 */
import { getAuthUser, jsonResponse } from '../core/auth.js';

/**
 * GET /api/config/client — session required; returns public Supabase Realtime credentials.
 * @param {Request} request
 * @param {{ SUPABASE_URL?: string, SUPABASE_ANON_KEY?: string }} env
 */
export async function handleClientConfig(request, env) {
  if (request.method === 'OPTIONS') {
    return jsonResponse({}, 204);
  }
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  const supabaseUrl = env?.SUPABASE_URL != null ? String(env.SUPABASE_URL).trim().replace(/\/$/, '') : '';
  const supabaseAnonKey =
    env?.SUPABASE_ANON_KEY != null ? String(env.SUPABASE_ANON_KEY).trim() : '';

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: 'Supabase client config unavailable' }, 503);
  }

  return jsonResponse({
    supabaseUrl,
    supabaseAnonKey,
    supabase_url: supabaseUrl,
    supabase_anon_key: supabaseAnonKey,
    meetEngine:
      env?.MEET_ENGINE != null && String(env.MEET_ENGINE).trim().toLowerCase() === 'realtimekit'
        ? 'realtimekit'
        : 'legacy',
  });
}
