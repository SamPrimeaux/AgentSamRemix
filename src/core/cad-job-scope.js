/**
 * CAD job scope + R2 key helpers (Design Studio / agentsam_cad_jobs).
 */
import { fetchAuthUserTenantId, fallbackSystemTenantId, resolveRequestContext } from './auth.js';

// Heavy CAD/GLB output lives in the dedicated `cad` R2 bucket (not the codebase ASSETS bucket),
// served publicly via the CDN-fronted custom domain below.
const CAD_R2_BUCKET = 'cad';
const CAD_PUBLIC_ORIGIN = 'https://cad.inneranimalmedia.com';
// Legacy CAD objects (pre-cad-bucket) still live here and remain readable via /assets/ passthrough.
const LEGACY_CAD_R2_BUCKET = 'inneranimalmedia';

/** @param {string} stored */
export function decodeCadScriptPayload(stored) {
  const raw = String(stored || '').trim();
  if (!raw) return '';
  if (raw.startsWith('b64:')) {
    try {
      return decodeURIComponent(escape(atob(raw.slice(4))));
    } catch {
      return '';
    }
  }
  return raw;
}

/**
 * @param {string} tenantId
 * @param {string} workspaceId
 * @param {string} jobId
 * @param {string} ext
 */
export function buildCadExportR2Key(tenantId, workspaceId, jobId, ext = 'glb') {
  const t = String(tenantId || 'system').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  const w = String(workspaceId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  const j = String(jobId || 'job').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  const e = String(ext || 'glb').replace(/^\./, '').slice(0, 8);
  return `cad/exports/${t}/${w}/${j}.${e}`;
}

/**
 * Public URL for a CAD asset. New objects live in the `cad` bucket served by the
 * custom domain; callers may override the origin (e.g. from env.CAD_R2_PUBLIC_ORIGIN).
 * @param {string} r2Key
 * @param {string} [origin]
 */
export function buildCadAssetPublicUrl(r2Key, origin) {
  const key = String(r2Key || '').trim().replace(/^\/+/, '');
  if (!key) return '';
  const base = String(origin || CAD_PUBLIC_ORIGIN).trim().replace(/\/$/, '');
  return `${base}/${key}`;
}

/**
 * Resolve the R2 binding for CAD writes/reads — dedicated `cad` bucket, falling back
 * to ASSETS only if the CAD binding is not present (safety during rollout).
 * @param {any} env
 */
export function resolveCadR2Binding(env) {
  if (env?.CAD?.put || env?.CAD?.get) return env.CAD;
  return env?.ASSETS || null;
}

export const CAD_PUBLIC_ORIGIN_DEFAULT = CAD_PUBLIC_ORIGIN;

/**
 * @param {any} env
 * @param {Request} request
 * @param {{ id?: string, tenant_id?: string }} authUser
 * @param {Record<string, unknown>} [body]
 */
export async function resolveCadJobScope(env, request, authUser, body = {}) {
  // Never trust body.workspace_id — derive from membership only
  const reqCtx = await resolveRequestContext(request, env);
  const workspaceId = reqCtx.error ? '' : (reqCtx.workspaceId || '');
  let tenantId =
    reqCtx.error || !reqCtx.tenantId
      ? authUser?.tenant_id != null
        ? String(authUser.tenant_id).trim()
        : ''
      : String(reqCtx.tenantId).trim();
  if (!tenantId && authUser?.id) tenantId = (await fetchAuthUserTenantId(env, authUser.id)) || '';
  if (!tenantId) tenantId = fallbackSystemTenantId(env) || '';
  return {
    workspaceId,
    tenantId,
    projectId:
      body.project_id != null && String(body.project_id).trim() !== ''
        ? String(body.project_id).trim()
        : body.blueprint_id != null && String(body.blueprint_id).trim() !== ''
          ? String(body.blueprint_id).trim()
          : null,
    sceneSnapshotId:
      body.scene_snapshot_id != null && String(body.scene_snapshot_id).trim() !== ''
        ? String(body.scene_snapshot_id).trim()
        : body.scene_id != null && String(body.scene_id).trim() !== ''
          ? String(body.scene_id).trim()
          : null,
    sessionId:
      body.session_id != null && String(body.session_id).trim() !== ''
        ? String(body.session_id).trim()
        : null,
  };
}

/** Bucket name recorded on new CAD jobs/assets. */
export function cadJobR2Bucket(env) {
  return resolveCadR2Binding(env)?.put ? CAD_R2_BUCKET : LEGACY_CAD_R2_BUCKET;
}
