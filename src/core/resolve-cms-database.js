/**
 * Resolve CMS write target — platform D1 vs workspace BYO D1 + R2/worker bindings.
 */
import { getAgentsamWorkspace, resolveWorkspaceByokR2Bucket } from '../../backend/identity/workspace/agentsam-workspace.js';
import {
  resolveWorkspaceD1Catalog,
  resolveWorkspaceMemberD1Grant,
} from './workspace-d1-access.js';
import { createRemoteD1Adapter } from './remote-d1-adapter.js';
import { CMS_DEFAULT_R2_BUCKET } from './cms-r2-binding.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

const PLATFORM_WORKER = 'inneranimalmedia';

/**
 * @param {any} env
 * @param {{ tenant_id?: string, id?: string }} authUser
 * @param {string} workspaceId
 * @param {{
 *   db_target?: string,
 *   database_id?: string,
 *   r2_target?: string,
 *   r2_bucket?: string,
 *   worker_target?: string,
 *   worker_name?: string,
 * }} [opts]
 */
export async function resolveCmsDatabase(env, authUser, workspaceId, opts = {}) {
  const ws = trim(workspaceId);
  if (!env?.DB || !ws) {
    return { ok: false, error: 'missing_env_or_workspace' };
  }

  const wsRow = await getAgentsamWorkspace(env, ws);
  const dbTarget = trim(opts.db_target || 'platform').toLowerCase();
  const r2Target = trim(opts.r2_target || 'shared').toLowerCase();
  const workerTarget = trim(opts.worker_target || 'shared').toLowerCase();

  let db = env.DB;
  let target = 'platform';
  let databaseId = null;
  let databaseName = 'inneranimalmedia-business';

  if (dbTarget === 'workspace' || dbTarget === 'byo' || dbTarget === 'workspace_d1') {
    const explicitId = trim(opts.database_id);
    let grant = null;
    if (explicitId) {
      const catalog = resolveWorkspaceD1Catalog(wsRow);
      const entry = catalog.find((e) => e.database_id === explicitId);
      if (entry) {
        grant = await resolveWorkspaceMemberD1Grant(env, authUser, ws, entry);
      }
    }
    if (!grant) {
      grant = await resolveWorkspaceMemberD1Grant(env, authUser, ws);
    }
    if (!grant?.token || !grant.database_id) {
      return {
        ok: false,
        error: 'workspace_d1_unavailable',
        message: 'Workspace D1 not configured or credentials missing. Use db_target platform or set agentsam_workspace.d1_database_id.',
        catalog: resolveWorkspaceD1Catalog(wsRow),
      };
    }
    db = createRemoteD1Adapter(grant);
    target = 'workspace_d1';
    databaseId = grant.database_id;
    databaseName = trim(grant.database_name) || databaseId;
  }

  let r2Bucket = CMS_DEFAULT_R2_BUCKET;
  if (r2Target === 'workspace' || r2Target === 'byo') {
    const byok = resolveWorkspaceByokR2Bucket(wsRow);
    const wsBucket = trim(wsRow?.r2_bucket);
    r2Bucket = trim(opts.r2_bucket) || byok || wsBucket || CMS_DEFAULT_R2_BUCKET;
  } else if (trim(opts.r2_bucket)) {
    r2Bucket = trim(opts.r2_bucket);
  }

  let workerName = PLATFORM_WORKER;
  if (workerTarget === 'workspace' || workerTarget === 'dedicated') {
    workerName = trim(opts.worker_name) || trim(wsRow?.worker_name) || PLATFORM_WORKER;
  } else if (trim(opts.worker_name)) {
    workerName = trim(opts.worker_name);
  }

  return {
    ok: true,
    db,
    target,
    database_id: databaseId,
    database_name: databaseName,
    r2_bucket: r2Bucket,
    worker_name: workerName,
    workspace_id: ws,
    catalog: resolveWorkspaceD1Catalog(wsRow),
  };
}

/**
 * Targets for Proceed UI / Agent Sam.
 * @param {any} env
 * @param {string} workspaceId
 */
export async function listCmsProceedTargets(env, workspaceId) {
  const ws = trim(workspaceId);
  const wsRow = ws ? await getAgentsamWorkspace(env, ws) : null;
  const catalog = resolveWorkspaceD1Catalog(wsRow);
  const byokR2 = resolveWorkspaceByokR2Bucket(wsRow);
  const wsR2 = trim(wsRow?.r2_bucket);

  return {
    db_targets: [
      { id: 'platform', label: 'IAM shared D1', database_id: null },
      ...catalog.map((e) => ({
        id: 'workspace',
        label: e.database_name || e.database_id,
        database_id: e.database_id,
        binding: e.binding,
      })),
    ],
    r2_targets: [
      { id: 'shared', label: 'Shared CMS bucket', bucket: CMS_DEFAULT_R2_BUCKET },
      ...(byokR2 || wsR2
        ? [{ id: 'workspace', label: byokR2 || wsR2, bucket: byokR2 || wsR2 }]
        : []),
    ],
    worker_targets: [
      { id: 'shared', label: PLATFORM_WORKER, worker_name: PLATFORM_WORKER },
      ...(trim(wsRow?.worker_name) && trim(wsRow.worker_name) !== PLATFORM_WORKER
        ? [{ id: 'workspace', label: trim(wsRow.worker_name), worker_name: trim(wsRow.worker_name) }]
        : []),
    ],
  };
}
