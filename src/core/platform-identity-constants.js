/**
 * Platform identity shape validators (au_*, ws_*, tenant_*, Supabase UUID).
 * Runtime scope resolution: backend/identity/system-actor.js + backend/jobs/cron-tenant.js.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AU_RE = /^au_[a-f0-9]+$/;
const WS_RE = /^ws_[a-z0-9_]+$/i;
const TENANT_RE = /^tenant_[a-z0-9_]+$/i;

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** @param {unknown} raw */
export function isPlatformAuthUserId(raw) {
  return AU_RE.test(trim(raw));
}

/** @param {unknown} raw */
export function isSupabaseUuid(raw) {
  return UUID_RE.test(trim(raw));
}

/** @param {unknown} raw */
export function isD1WorkspaceId(raw) {
  return WS_RE.test(trim(raw));
}

/** @param {unknown} raw */
export function isTenantId(raw) {
  return TENANT_RE.test(trim(raw));
}

/**
 * Primary Supabase auth.users UUID from env.
 * @param {Record<string, unknown>|null|undefined} env
 */
export function resolvePlatformSupabaseUserId(env) {
  for (const key of ['IAM_SUPABASE_USER_ID', 'SUPABASE_USER_ID', 'OPERATOR_SUPABASE_USER_ID']) {
    const v = trim(env?.[key]);
    if (isSupabaseUuid(v)) return v;
  }
  throw new Error('platform_supabase_user_id_required');
}

/**
 * Supabase workspace UUID for platform lane (never pass ws_* to Postgres uuid columns).
 * @param {Record<string, unknown>|null|undefined} env
 */
export function resolvePlatformSupabaseWorkspaceUuid(env) {
  for (const key of ['IAM_SUPABASE_WORKSPACE_ID', 'SUPABASE_WORKSPACE_UUID', 'SUPABASE_WORKSPACE_ID']) {
    const v = trim(env?.[key]);
    if (isSupabaseUuid(v)) return v;
  }
  throw new Error('platform_supabase_workspace_uuid_required');
}

/**
 * Primary operator email for deploy notifications / audit.
 * @param {Record<string, unknown>|null|undefined} env
 */
export function resolvePlatformOperatorEmailPrimary(env) {
  for (const key of ['OPERATOR_USER_EMAIL', 'DEPLOY_USER_EMAIL', 'IAM_USER_EMAIL']) {
    const v = trim(env?.[key]);
    if (v && v.includes('@')) return v.toLowerCase();
  }
  throw new Error('platform_operator_email_required');
}
