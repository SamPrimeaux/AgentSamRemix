/**
 * TEMPORARY safety choke point for GCP cwd (Sprint 1 / tkt_remote_exec_fail_closed).
 * SSOT ticket history: tkt_0bfb31cbf5104393
 *
 * Architectural rule (do not invert):
 *   Identity decides WHETHER the caller may use the GCP operator lane.
 *   The selected repository + verified checkout decide WHERE the command runs.
 *
 * Paths / Unix owner come from terminal_connections (conn_gcp_iam_tunnel) —
 * never hardcode owner home paths in this module.
 */

import { userIdIsIamTunnelOwner } from '../../backend/identity/workspace/grants.js';
import {
  loadIamTunnelOwnerConfig,
  resolveIamGcpExecosHome,
  resolveIamGcpPlatformRepo,
} from '../../backend/identity/workspace/tunnel-owner.js';
import { writeAgentsamErrorLog } from '../../backend/telemetry/error-log.js';

export {
  resolveIamGcpExecosHome as resolveIamGcpExecosHomePath,
  resolveIamGcpPlatformRepo as resolveIamGcpPlatformRepoPath,
};

/** @deprecated Prefer resolveIamGcpExecosHome(env) — sync constant removed (D1-only paths). */
export const IAM_GCP_EXECOS_HOME = null;
/** @deprecated Prefer resolveIamGcpPlatformRepo(env) */
export const IAM_GCP_PLATFORM_REPO_INNERANIMALMEDIA = null;
/** @deprecated */
export const IAM_GCP_OPERATOR_REPO = null;

const CWD_ERROR_SOURCE = 'identity_scoped_gcp_cwd';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Unverified path constructor — not a success resolver.
 * @param {string|null|undefined} tenantId
 */
export function tenantWorkspaceRoot(tenantId) {
  const tid = trim(tenantId);
  if (!tid) return null;
  return `/workspace/${tid}`;
}

/**
 * @param {Record<string, unknown>} ctx
 * @param {{ ok: false, error: string, user_message: string }} result
 */
async function logCwdResolutionFailure(ctx, result) {
  const env = ctx.env;
  if (!env?.DB) return;
  const userId = trim(ctx.userId);
  const tenantId = trim(ctx.tenantId) || 'system';
  const workspaceId = trim(ctx.workspaceId) || 'unknown';
  const requested = trim(ctx.requestedCwd || ctx.attemptedPath);
  const contextJson = JSON.stringify({
    requested_cwd: requested || null,
    resolved_cwd: null,
    user_id: userId || null,
    attempted_path: requested || null,
    error_code: result.error,
  });
  try {
    await writeAgentsamErrorLog(env, {
      workspaceId,
      tenantId,
      sessionId: ctx.sessionId != null ? String(ctx.sessionId) : null,
      errorCode: result.error,
      errorType: 'cwd_resolution',
      errorMessage: result.user_message || result.error,
      source: CWD_ERROR_SOURCE,
      sourceId: userId || null,
      contextJson,
      resolved: 0,
    });
  } catch (e) {
    console.warn('[identity_scoped_gcp_cwd] agentsam_error_log failed', e?.message ?? e);
  }
}

/**
 * @param {{
 *   userId?: string|null,
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   settings?: Record<string, unknown>|null,
 *   env?: any,
 *   sessionId?: string|null,
 *   requestedCwd?: string|null,
 *   attemptedPath?: string|null,
 * }} ctx
 * @returns {Promise<{ ok: true, cwd: string, source: string } | { ok: false, error: string, user_message: string }>}
 */
export async function resolveIdentityScopedGcpCwd(ctx = {}) {
  const userId = trim(ctx.userId);
  const tenantId = trim(ctx.tenantId);
  const workspaceId = trim(ctx.workspaceId);
  const settings = ctx.settings && typeof ctx.settings === 'object' ? ctx.settings : null;

  /** @type {{ ok: true, cwd: string, source: string } | { ok: false, error: string, user_message: string }} */
  let result;

  if (!userId || !tenantId) {
    result = {
      ok: false,
      error: 'identity_required_for_cwd',
      user_message:
        'GCP exec cwd requires authenticated user_id and tenant_id. No ambient default is applied (fail closed).',
    };
  } else {
    const isOwner = await userIdIsIamTunnelOwner(ctx.env, userId);

    if (!isOwner) {
      result = {
        ok: false,
        error: 'tenant_remote_checkout_unresolved',
        user_message:
          'No verified GCP checkout for this identity on the operator remote host. ' +
          'Use agentsam_terminal_local (your device tunnel), agentsam_terminal_sandbox, or authorized GitHub tools. ' +
          'agentsam_terminal_remote is tunnel-owner-only.',
      };
    } else {
      const fromVm = trim(settings?.vm_workspace_root || settings?.repo?.vm_path);
      if (fromVm) {
        result = { ok: true, cwd: fromVm, source: 'workspace_settings.vm_workspace_root' };
      } else {
        const cfg = await loadIamTunnelOwnerConfig(ctx.env);
        if (
          cfg?.repoPath &&
          workspaceId &&
          cfg.defaultWorkspaceId &&
          workspaceId === cfg.defaultWorkspaceId
        ) {
          result = {
            ok: true,
            cwd: cfg.repoPath,
            source: 'terminal_connections.metadata_json.tunnel_repo_path',
          };
        } else {
          result = {
            ok: false,
            error: 'owner_gcp_cwd_unresolved',
            user_message:
              'Owner GCP cwd unresolved for this workspace. Set workspace_settings.vm_workspace_root to the Linux clone path on iam-tunnel (only if that repo is cloned there), or use GitHub API tools / agentsam_terminal_sandbox.',
          };
        }
      }
    }
  }

  if (!result.ok) {
    await logCwdResolutionFailure(ctx, result);
  }
  return result;
}
