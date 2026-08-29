/**
 * IAM_CAD_WORKER lane — health probe + headless CAD job dispatch.
 * Image: meauxcontainer-cad-worker:cad-v1 (standard-2).
 */
import { resolveOutboundBridgeKey } from '../../backend/auth/bridge-key-auth.js';

export const CAD_CONTAINER_IMAGE_REF =
  'registry.cloudflare.com/ede6590ac0d2fb7daf155b35653457b2/meauxcontainer-cad-worker:cad-v1';
export const CAD_CONTAINER_IMAGE_TAG = 'meauxcontainer-cad-worker:cad-v1';

const CAD_CONTAINER_POOL_ID = 'iam-cad-pool';
const CAD_CONTAINER_PORT = 8080;

/** @param {any} env */
function cadContainerNamespace(env) {
  return env?.IAM_CAD_WORKER || null;
}

/**
 * @param {any} env
 * @param {{ ports?: number[] }} [opts]
 */
async function getCadContainerStub(env, opts = {}) {
  const ns = cadContainerNamespace(env);
  if (!ns?.getByName) return null;
  const stub = ns.getByName(CAD_CONTAINER_POOL_ID);
  await stub.startAndWaitForPorts({ ports: opts.ports || [CAD_CONTAINER_PORT] });
  return stub;
}

/**
 * @param {any} env
 */
export async function probeIamCadWorkerContainer(env) {
  const ns = cadContainerNamespace(env);
  if (!ns?.getByName) {
    return {
      ok: false,
      bound: false,
      lane: 'cad-container',
      image: null,
      toolchain_ok: false,
    };
  }
  try {
    const stub = await getCadContainerStub(env);
    if (!stub) {
      return {
        ok: false,
        bound: false,
        lane: 'cad-container',
        image: CAD_CONTAINER_IMAGE_TAG,
        toolchain_ok: false,
      };
    }
    const res = await stub.fetch('http://container/health');
    const text = await res.text().catch(() => '');
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { bodyPreview: text.slice(0, 200) };
    }
    const toolchainOk = Boolean(json?.toolchain_ok);
    return {
      ok: res.ok && json?.ok !== false && toolchainOk,
      bound: true,
      lane: 'cad-container',
      status: res.status,
      image: CAD_CONTAINER_IMAGE_TAG,
      toolchain_ok: toolchainOk,
      response: json,
    };
  } catch (e) {
    return {
      ok: false,
      bound: true,
      lane: 'cad-container',
      image: CAD_CONTAINER_IMAGE_TAG,
      toolchain_ok: false,
      error: String(e?.message || e).slice(0, 400),
    };
  }
}

/**
 * Dispatch one CAD job to the CF container (async 202 — container callbacks job-complete).
 * @param {any} env
 * @param {any} ctx
 * @param {string} jobId
 * @param {{ userId: string, tenantId?: string|null, workspaceId: string }} auth
 */
export async function dispatchCadJobToContainer(env, ctx, jobId, auth) {
  const id = String(jobId || '').trim();
  if (!id) return { ok: false, error: 'job_id_required' };

  const ns = cadContainerNamespace(env);
  if (!ns?.getByName) {
    return { ok: false, error: 'cad_container_unbound', dispatch: 'container' };
  }

  if (!env?.DB) return { ok: false, error: 'database_not_configured' };

  const job = await env.DB.prepare(`SELECT * FROM agentsam_cad_jobs WHERE id = ? LIMIT 1`)
    .bind(id)
    .first();
  if (!job) return { ok: false, error: 'job_not_found' };

  const engine = String(job.engine || '').toLowerCase();
  if (!['openscad', 'blender', 'freecad'].includes(engine)) {
    return { ok: false, error: 'exec_engine_not_supported', engine };
  }

  const { decodeCadScriptPayload, buildCadExportR2Key } = await import('./cad-job-scope.js');
  const script = decodeCadScriptPayload(job.r2_key);
  if (!script) {
    return { ok: false, error: 'missing_script_payload' };
  }

  const tenantId = auth.tenantId || job.tenant_id || 'system';
  const workspaceId = auth.workspaceId || job.workspace_id || 'unknown';
  const r2Key = buildCadExportR2Key(tenantId, workspaceId, id, 'glb');
  const workerOrigin = String(env.IAM_ORIGIN || env.IAM_WORKER_ORIGIN || 'https://inneranimalmedia.com').replace(
    /\/$/,
    '',
  );
  const internalSecret = resolveOutboundBridgeKey(env).trim();
  if (!internalSecret) {
    return { ok: false, error: 'agentsam_bridge_key_missing', dispatch: 'container' };
  }

  const startedAt = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE agentsam_cad_jobs SET
       status = 'running',
       runner_host = 'cad-container',
       progress_pct = 5,
       started_at = ?,
       error = NULL,
       error_code = NULL,
       updated_at = unixepoch()
     WHERE id = ?`,
  )
    .bind(startedAt, id)
    .run();

  const stub = await getCadContainerStub(env);
  if (!stub) {
    return { ok: false, error: 'cad_container_stub_unavailable', dispatch: 'container' };
  }

  const res = await stub.fetch('http://container/cad/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': internalSecret,
    },
    body: JSON.stringify({
      job_id: id,
      engine,
      script,
      r2_key: r2Key,
      worker_origin: workerOrigin,
      tenant_id: tenantId,
      workspace_id: workspaceId,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) {
    return {
      ok: false,
      error: data.error || `cad_container_http_${res.status}`,
      dispatch: 'container',
      http_status: res.status,
    };
  }

  return {
    ok: true,
    job_id: id,
    status: 'running',
    dispatch: 'container',
    runner_host: 'cad-container',
    accepted: data.accepted === true || res.status === 202,
    r2_key: r2Key,
  };
}
