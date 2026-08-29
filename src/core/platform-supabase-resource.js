/**
 * Human-facing identity for the Hyperdrive-backed platform Supabase origin.
 * Routing sentinel stays `platform_supabase`; UI never shows that string.
 *
 * @param {any} env
 * @returns {{ name: string, ref: string, region: string|null }}
 */
export function platformSupabaseResourceFromEnv(env) {
  const url = env?.SUPABASE_URL == null ? '' : String(env.SUPABASE_URL).trim();
  const explicitRef = env?.SUPABASE_PROJECT_REF == null ? '' : String(env.SUPABASE_PROJECT_REF).trim();
  const region = env?.SUPABASE_REGION == null ? '' : String(env.SUPABASE_REGION).trim();
  let ref = explicitRef;
  if (!ref && url) {
    try {
      const host = new URL(url).hostname;
      ref = host.split('.')[0] || '';
    } catch {
      /* ignore malformed origin */
    }
  }
  const name = ref || 'Supabase Postgres';
  return {
    name,
    ref: ref || name,
    region: region || null,
  };
}
