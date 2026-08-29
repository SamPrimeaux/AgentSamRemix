/**
 * Session-complete operational identity — workspace pin, capabilities, terminal lane.
 * Used at login finalization and GET /api/dashboard/bootstrap (L1 SSOT).
 */
import { buildTerminalLaneTargets } from './terminal-splash-status.js';

/**
 * @param {ReturnType<typeof buildTerminalLaneTargets> extends Promise<infer T> ? T : never} targets
 */
export function summarizeTerminalLaneTargets(targets) {
  if (!targets || targets.can_run_pty === false) {
    return {
      ready: false,
      lane: null,
      connection_id: null,
      cwd: null,
      status: 'disconnected',
      can_run_pty: false,
    };
  }

  let lane = null;
  if (targets.local?.ready) lane = 'local';
  else if (targets.cloud?.ready) lane = 'cloud';
  else if (targets.sandbox?.ready) lane = 'sandbox';
  else if (targets.local?.configured) lane = 'local';
  else if (targets.cloud?.configured) lane = 'cloud';

  const ready =
    targets.local?.ready === true ||
    targets.cloud?.ready === true ||
    targets.sandbox?.ready === true;

  let connection_id = null;
  let cwd = null;
  if (lane === 'local') {
    connection_id = targets.local?.connection_id ?? null;
    cwd = targets.local?.cwd ?? null;
  } else if (lane === 'cloud') {
    connection_id = targets.cloud?.connection_id ?? null;
    cwd = targets.cloud?.cwd ?? null;
  } else if (lane === 'sandbox') {
    connection_id = targets.sandbox?.connection_id ?? null;
    cwd = targets.sandbox?.cwd ?? null;
  }

  return {
    ready,
    lane,
    connection_id,
    cwd,
    status: ready ? 'connected' : 'disconnected',
    can_run_pty: true,
  };
}

/**
 * Resolve operational workspace for bootstrap / terminal lane.
 * User-scoped active workspace (incl. project activation) wins over platform pin.
 * @param {*} env
 * @param {{ isSuperadmin?: boolean, workspaceId?: string|null, storedActiveWorkspaceId?: string|null, active_workspace_id?: string|null }} authCtx
 */
export function resolveOperationalWorkspaceId(env, authCtx) {
  const fromCtx = authCtx?.workspaceId != null ? String(authCtx.workspaceId).trim() : '';
  if (fromCtx) return fromCtx;

  const fromStored =
    authCtx?.storedActiveWorkspaceId != null
      ? String(authCtx.storedActiveWorkspaceId).trim()
      : authCtx?.active_workspace_id != null
        ? String(authCtx.active_workspace_id).trim()
        : '';
  if (fromStored) return fromStored;

  return null;
}

/**
 * Full L1 operational snapshot for bootstrap / login enrichment.
 * @param {*} env
 * @param {import('./auth.js').AuthContext | { userId: string, workspaceId?: string|null, tenantId?: string|null, isSuperadmin?: boolean, capabilities?: object }} authCtx
 */
export async function buildOperationalIdentitySnapshot(env, authCtx, terminalDeps = {}) {
  const userId = String(authCtx?.userId || '').trim();
  const workspaceId = resolveOperationalWorkspaceId(env, authCtx);
  const tenantId = authCtx?.tenantId != null ? String(authCtx.tenantId).trim() : null;
  const capabilities = authCtx?.capabilities ?? {
    canRunPty: false,
    canRunMcp: false,
    canDeploy: false,
  };

  let github_repo = null;
  if (env?.DB && workspaceId) {
    try {
      const row = await env.DB.prepare(
        `SELECT github_repo FROM workspaces WHERE id = ? LIMIT 1`,
      )
        .bind(workspaceId)
        .first();
      github_repo =
        row?.github_repo != null ? String(row.github_repo).trim() || null : null;
    } catch {
      github_repo = null;
    }
  }

  let terminal = {
    ready: false,
    lane: null,
    connection_id: null,
    cwd: null,
    status: 'disconnected',
    can_run_pty: false,
  };

  if (userId && workspaceId && capabilities.canRunPty) {
    try {
      const targets = await buildTerminalLaneTargets(env, { id: userId }, workspaceId, terminalDeps);
      terminal = summarizeTerminalLaneTargets(targets);
    } catch (e) {
      console.warn('[buildOperationalIdentitySnapshot] terminal', e?.message ?? e);
    }
  }

  return {
    workspace_id: workspaceId,
    tenant_id: tenantId,
    github_repo,
    capabilities,
    terminal,
  };
}
