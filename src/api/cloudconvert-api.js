/**
 * CloudConvert API surface — presets, operations catalog, jobs (IAM + MovieMode).
 */
import { getAuthUser, jsonResponse } from '../core/auth.js';

async function requireAuth(request, env) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return { error: jsonResponse({ error: 'Unauthorized' }, 401) };
  const workspaceId = authUser.active_workspace_id || authUser.workspace_id || null;
  const tenantId = authUser.tenant_id || authUser.active_tenant_id || null;
  if (!workspaceId || !tenantId) {
    return { error: jsonResponse({ error: 'workspace_id and tenant_id required' }, 400) };
  }
  return {
    authUser,
    workspaceId: String(workspaceId),
    tenantId: String(tenantId),
    userId: authUser?.id != null ? String(authUser.id).trim() : '',
  };
}

export async function handleCloudConvertApi(request, url, env) {
  const path = url.pathname.replace(/\/$/, '') || '/';
  const method = (request.method || 'GET').toUpperCase();
  if (!env.CLOUDFLARE_ACCOUNT_ID && !env.CLOUDFLARE_STREAM_TOKEN) {
    /* CLOUDCONVERT only needs CLOUDCONVERT_API_KEY */
  }

  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;
  const { workspaceId, tenantId, userId } = auth;

  if (path === '/api/cloudconvert/presets' && method === 'GET') {
    const { listCloudConvertPresets, getR2S3Credentials } = await import(
      '../core/cloudconvert-api.js'
    );
    return jsonResponse({
      ok: true,
      presets: listCloudConvertPresets(),
      r2_direct_storage: Boolean(getR2S3Credentials(env)),
      webhook: 'https://inneranimalmedia.com/api/webhooks/cloudconvert',
      socket_api: 'https://socketio.cloudconvert.com',
    });
  }

  if (path === '/api/cloudconvert/operations' && method === 'GET') {
    try {
      const { listCloudConvertOperations } = await import('../core/cloudconvert-api.js');
      const ops = await listCloudConvertOperations(env, {
        operation: url.searchParams.get('operation') || undefined,
        input_format: url.searchParams.get('input_format') || undefined,
        output_format: url.searchParams.get('output_format') || undefined,
      });
      return jsonResponse({ ok: true, operations: ops });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
    }
  }

  if (path === '/api/cloudconvert/jobs' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const preset = String(body.preset || body.workflow || '').trim();
    const assetId = String(body.asset_id || '').trim();
    const captureUrl = body.capture_url ? String(body.capture_url).trim() : '';

    if (!preset) return jsonResponse({ error: 'preset required' }, 400);

    try {
      const { enqueueMoviemodeConversion } = await import('../core/moviemode-conversions.js');
      const job = await enqueueMoviemodeConversion(env, { workspaceId, tenantId, userId }, {
        asset_id: assetId || undefined,
        service: 'cloudconvert',
        preset,
        output_format: body.output_format || 'mp4',
        input_format: body.input_format || 'auto',
        project_id: body.project_id || null,
        convert_options: body.convert_options || body.options || {},
        capture_url: captureUrl,
        ffmpeg_arguments: body.ffmpeg_arguments || null,
        sync: body.sync === true,
      });
      return jsonResponse({ ok: true, job });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 400);
    }
  }

  const jobMatch = path.match(/^\/api\/cloudconvert\/jobs\/([^/]+)$/);
  if (jobMatch && method === 'GET') {
    const id = decodeURIComponent(jobMatch[1]);
    try {
      const local = await env.DB.prepare(
        `SELECT * FROM moviemode_conversion_jobs WHERE id = ? AND workspace_id = ? LIMIT 1`,
      )
        .bind(id, workspaceId)
        .first();

      let remote = null;
      const extId = local?.external_job_id || (id.includes('-') ? id : null);
      if (extId && env.CLOUDCONVERT_API_KEY) {
        const { getCloudConvertJob } = await import('../core/cloudconvert-api.js');
        try {
          remote = await getCloudConvertJob(env, String(extId));
        } catch {
          /* optional */
        }
      }

      if (!local && !remote) return jsonResponse({ error: 'Not found' }, 404);
      return jsonResponse({ ok: true, job: local, cloudconvert: remote });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
    }
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
