import { WORKSPACE_CONTEXT_MISSING } from '../../identity/bootstrap.js';
import { assertWorkspaceTokenForPty } from '../../../src/core/workspace-tokens.js';
import { resolveTerminalExecRoutingFromDb } from './routing-policy.js';
import { userMayUsePrivilegedTerminal } from '../../identity/workspace/grants.js';
import { checkSudoPermission, formatTerminalExec403, resolvePrivilegedTargetLookupId } from './privileged-targets.js';
import { parseSshTargets } from './alternate-exec.js';
import { resolveTerminalExecutor } from './executors/index.js';
import { normalizeTerminalProtocol } from './execution-plan.js';

const TERMINAL_WS_TAG = 'terminal';
const DEFAULT_EXECUTION_MODE = 'pty';
const DEFAULT_MCP_ENDPOINT = 'https://mcp.inneranimalmedia.com/mcp';

export async function handleTerminalExec(session, request, url) {
    const body = await request.json().catch(() => ({}));
    const executionMode = normalizeTerminalProtocol(body?.execution_mode || url.searchParams.get("execution_mode"));
    const workspaceId = String(body?.workspace_id || url.searchParams.get("workspace_id") || "").trim();
    if (!workspaceId) {
      return Response.json(
        { ok: false, error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING },
        { status: 400 },
      );
    }
    const uid =
      String(url.searchParams.get("user_id") || body?.user_id || "").trim();
    if (uid) session.ptSessionUserId = uid;
    const tidParam = String(url.searchParams.get("tenant_id") || "").trim();
    if (tidParam) session.ptSessionTenantId = tidParam;
    const pParam = String(url.searchParams.get("person_uuid") || body?.person_uuid || "").trim();
    if (pParam) session.ptPersonUuid = pParam;
    const targetId = String(body?.target_id || body?.ssh_target_id || "").trim() || null;
    const execUidForGate = String(uid || session.ptSessionUserId || url.searchParams.get("user_id") || "").trim();
    const isOp = await userMayUsePrivilegedTerminal(session.env, { id: execUidForGate }, workspaceId);
    const routing = await resolveTerminalExecRoutingFromDb(session.env, {
      tool_name: body?.tool_name,
      target_id: targetId,
      target_type: body?.target_type || url.searchParams.get("target_type"),
      user_id: uid || session.ptSessionUserId,
      mayUsePrivilegedTerminal: isOp,
    });
    if (routing.target_type) {
      session.requestedTargetType = routing.target_type;
      session.selectedTargetType = routing.target_type;
    }
    const pinnedConnectionId = routing.target_id || targetId;
    session.requestedToolName = String(body?.tool_name || "").trim();
    const timeoutMsIn = Number(body?.timeout_ms ?? body?.timeoutMs);
    session.requestedTimeoutMs =
      Number.isFinite(timeoutMsIn) && timeoutMsIn > 0 ? Math.floor(timeoutMsIn) : null;
    if (pinnedConnectionId) {
      session.requestedConnectionId = pinnedConnectionId;
      session.selectedTerminalConnection = null;
    } else {
      // Prior remote/dock pin must not poison a local/sandbox lookup.
      session.requestedConnectionId = null;
      session.selectedTerminalConnection = null;
    }
    await session.ensureWorkspaceSettingsLoaded(workspaceId);

    if (routing.error === "target_id_required") {
      // Fail loud: platform_vm/gcp lane selected but no D1
      // agentsam_terminal_remote.handler_config.default_target_id resolved.
      // Never let an unresolved connection silently pass as "healthy" gcp_primary.
      return Response.json(
        { ok: false, error: "TARGET_ID_REQUIRED", code: "TARGET_ID_REQUIRED" },
        { status: 403 },
      );
    }

    const gcpOperatorPtyBypass =
      routing.lane === "gcp_primary" &&
      isOp &&
      !!pinnedConnectionId &&
      pinnedConnectionId === routing.target_id;

    if ((executionMode === "pty" || executionMode === "batch_exec") && session.env?.DB && !gcpOperatorPtyBypass) {
      let tidEx = await session.resolvePtyTenantForSession(session.ptSessionUserId);
      tidEx = tidEx != null ? String(tidEx).trim() : "";
      if (!tidEx) {
        return Response.json({ ok: false, error: "TENANT_CONTEXT_REQUIRED", code: "TENANT_CONTEXT_REQUIRED" }, { status: 403 });
      }
      const tokEx = await assertWorkspaceTokenForPty(session.env, workspaceId, tidEx);
      if (!tokEx.ok) {
        return Response.json(
          { ok: false, error: "no active workspace token", message: "no active workspace token" },
          { status: 403 },
        );
      }
      let connForCwd = session.selectedTerminalConnection;
      if (!connForCwd) {
        try {
          const sel = await session.selectTerminalConnection({
            userId: String(session.ptSessionUserId || "").trim(),
            workspaceId,
            tenantId: tidEx,
            connectionId: pinnedConnectionId,
            targetType: session.requestedTargetType || routing.target_type || null,
            healthAware: true,
          });
          connForCwd = sel.connection;
          session.selectedTerminalConnection = connForCwd;
          if (connForCwd?.target_type) {
            session.selectedTargetType = String(connForCwd.target_type).trim();
          }
        } catch (_) {}
      }
      await session.applyPtyWorkingDir(tidEx, session.ptSessionUserId, connForCwd);
    }

    const command = String(body?.command || "").trim();

    if (command) {
      let effectiveTargetId =
        pinnedConnectionId ||
        String(session.requestedConnectionId || "").trim() ||
        String(session.selectedTerminalConnection?.id || "").trim() ||
        null;
      if (!effectiveTargetId && session.env?.DB) {
        try {
          const sel = await session.selectTerminalConnection({
            userId: String(session.ptSessionUserId || "").trim(),
            workspaceId,
            tenantId: String(session.ptSessionTenantId || "").trim() || null,
            connectionId: pinnedConnectionId,
            targetType: session.requestedTargetType || routing.target_type || null,
            healthAware: true,
          });
          effectiveTargetId = sel?.connection?.id ? String(sel.connection.id).trim() : null;
          if (sel.connection) {
            session.selectedTerminalConnection = sel.connection;
            session.selectedTargetType = String(sel.connection.target_type || session.selectedTargetType || "").trim();
          }
        } catch (_) {}
      }
      const lookupId = await resolvePrivilegedTargetLookupId(session.env?.DB, effectiveTargetId);
      const sudoCheck = await checkSudoPermission(session.env, lookupId || effectiveTargetId, command);
      if (!sudoCheck.allowed) {
        return Response.json(formatTerminalExec403(sudoCheck), { status: 403 });
      }
    }

    try {
      const executed = await resolveTerminalExecutor(executionMode).execute(session, command, body);
      if (executed.response) return executed.response;
      const result = executed.result;

      const out = String(result?.output || "").trim();
      if (out) session.broadcastTerminalOutput(`${out}\r\n`);
      return Response.json({
        ok: !result?.error,
        execution_mode: executionMode,
        output: result?.output || "",
        stdout: result?.stdout ?? result?.output ?? "",
        stderr: result?.stderr ?? "",
        exit_code: result?.exit_code ?? null,
        tool_name: result?.tool_name ?? null,
        target_id: result?.target_id ?? null,
        target_type: result?.target_type ?? session.selectedTargetType ?? routing.target_type ?? null,
        target_lane: result?.target_lane ?? session.currentTerminalExecutionPlan?.target_lane ?? null,
        transport: result?.transport ?? session.currentTerminalExecutionPlan?.transport ?? null,
        lifecycle: result?.lifecycle ?? null,
        cleanup: result?.cleanup ?? null,
        instance_name: result?.instance_name ?? null,
        exec_identity: result?.exec_identity ?? null,
        privileged_target_id: result?.privileged_target_id ?? null,
        error: result?.error ?? null,
        failure_class: result?.failure_class ?? null,
      });
    } catch (e) {
      return Response.json({ ok: false, execution_mode: executionMode, error: String(e?.message || e) }, { status: 500 });
    }
  }

export async function getTerminalStatus(session, url) {
    const workspaceId = (url.searchParams.get("workspace_id") || "").trim();
    if (!workspaceId) {
      return {
        ok: false,
        error: WORKSPACE_CONTEXT_MISSING,
        code: WORKSPACE_CONTEXT_MISSING,
      };
    }
    const uid = (url.searchParams.get("user_id") || "").trim();
    if (uid) session.ptSessionUserId = uid;
    const tid = (url.searchParams.get("tenant_id") || "").trim();
    if (tid) session.ptSessionTenantId = tid;
    const pu = (url.searchParams.get("person_uuid") || "").trim();
    if (pu) session.ptPersonUuid = pu;
    await session.ensureWorkspaceSettingsLoaded(workspaceId);
    const executionMode = normalizeTerminalProtocol(url.searchParams.get("execution_mode"));
    const sshTargets = parseSshTargets(session.env);
    const mcpToken = String(session.env?.MCP_AUTH_TOKEN || "").trim();
    const ptyConfigured =
      !!session.env?.PTY_SERVICE ||
      (!!String(session.env?.TERMINAL_WS_URL || "").trim() &&
        !!String(session.env?.PTY_AUTH_TOKEN || session.env?.TERMINAL_SECRET || "").trim());
    return {
      ok: true,
      control_plane: "worker_do",
      execution_mode: executionMode,
      session_id: await session.getOrCreateTerminalSessionId(),
      terminal_clients: session.ctx.getWebSockets(TERMINAL_WS_TAG).length,
      backends: {
        pty: { available: ptyConfigured, connected: !!session.ptyWs && session.ptyWs.readyState === 1 },
        ssh: {
          available: sshTargets.length > 0,
          targets: sshTargets.map((t) => ({ id: t.id, host: t.host, user: t.user, port: t.port })),
        },
        mcp: {
          available: !!mcpToken,
          endpoint: String(session.env?.MCP_SERVER_URL || DEFAULT_MCP_ENDPOINT),
        },
        batch_exec: {
          available: ptyConfigured || !!session.env?.MY_CONTAINER || !!session.env?.MOVIEMODE_RENDER,
          targets: ['local', 'remote', 'sandbox'],
          target_types: ['user_hosted_tunnel', 'platform_vm', 'sandbox'],
        },
      },
    };
  }





export async function ensureModeReady(session, mode, opts = {}) {
  return resolveTerminalExecutor(mode).ensureReady(session, opts);
}
