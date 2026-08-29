/**
 * Tenant-safe /api/agent/terminal/run gate: bootstrap, MCP tool registration, optional approval.
 */
import { getAuthUser, fetchAuthUserTenantId, platformTenantIdFromEnv } from './auth.js';
import { userCanRunPtyFromPolicy } from '../../backend/http/agentsam/routes/pty-policy.js';
import {
  resolveEffectiveWorkspaceId,
  resolveActiveBootstrap,
  WORKSPACE_CONTEXT_MISSING,
} from '../../backend/identity/bootstrap.js';
import { resolvePtyTenantIdForUser } from '../../backend/agentsam/terminal/pty-workspace-paths.js';
import { loadAgentsamToolRow } from './agentsam-tools-catalog.js';
import { loadAgentSamUserPolicy } from '../../backend/identity/index.js';
import { runTerminalCommand } from '../../backend/agentsam/terminal/runtime.js';
import { resolveTerminalExecRoutingFromDb } from '../../backend/agentsam/terminal/routing-policy.js';
import { scheduleRecordMcpToolExecution } from './mcp-tool-execution.js';
import { scheduleToolCallLog } from './agentsam-ops-ledger.js';
import { resolveCanonicalUserId } from '../api/auth.js';

function isLikelySafeShellCommand(cmd) {
  const c = String(cmd || '').trim();
  if (!c) return false;
  if (/[\r\n;|&`$<>]/.test(c)) return false;
  if (
    /^cd inneranimalmedia && rg --json --max-count \d+ --max-columns \d+ --glob '!\.git\/\*' -e '/.test(c) &&
    c.length <= 12000
  ) {
    return true;
  }
  return (
    /^(pwd|whoami|hostname|date|uname)(\s|$)/i.test(c) ||
    /^echo\s+/i.test(c) ||
    /^ls(\s|$)/i.test(c) ||
    /^printenv(\s|$)/i.test(c) ||
    /^git status(\s|$)/i.test(c) ||
    /^git diff(\s|$)/i.test(c) ||
    /^git log -n \d+(\s|$)/i.test(c) ||
    /^node --check \S+\.(js|mjs|cjs)(\s|$)/i.test(c) ||
    /^npm run (build|test|lint)(\s|$)/i.test(c) ||
    (/^python3(\d(\.\d+)?)?\s+-m\s+py_compile\s+/i.test(c) && c.length <= 12000)
  );
}

function scheduleTerminalToolCallLog(env, ctx, params) {
  const {
    tenantId,
    sessionId,
    userId,
    workspaceId,
    toolName,
    status,
    durationMs,
    errorMessage,
    inputSummary,
    agent_run_id,
    agentRunId,
    conversation_id,
    conversationId,
  } = params;
  scheduleToolCallLog(env, ctx, {
    tenantId: tenantId != null ? String(tenantId) : 'system',
    workspaceId,
    sessionId,
    userId,
    toolName: String(toolName || 'terminal_run'),
    status: status === 'success' ? 'success' : 'error',
    durationMs,
    errorMessage,
    inputSummary,
    agent_run_id: agent_run_id ?? agentRunId,
    conversation_id: conversation_id ?? conversationId ?? sessionId,
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {any} ctx
 * @param {URL} url
 * @param {object} body parsed JSON body
 */
export async function executeScopedAgentTerminalRun(request, env, ctx, url, body) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return { response: null, error: 'Unauthorized', status: 401 };

  const command = typeof body?.command === 'string' ? body.command.trim() : '';
  if (!command) return { response: null, error: 'No command', status: 400 };

  const sessionId = body?.session_id ?? null;
  const proposalId = body?.proposal_id ?? body?.approved_proposal_id ?? null;
  const uid = String(authUser.id || '').trim();

  const wsRes = await resolveEffectiveWorkspaceId(env, request, authUser, {});
  if (wsRes.error || !wsRes.workspaceId) {
    return { response: null, error: WORKSPACE_CONTEXT_MISSING, status: 400 };
  }
  const effectiveWs = String(wsRes.workspaceId).trim();
  const targetWorkspace = effectiveWs;

  let tenantId = await resolvePtyTenantIdForUser(env, authUser, uid);
  tenantId = tenantId != null ? String(tenantId).trim() : '';
  if (!tenantId) return { response: null, error: 'tenant_required', status: 403 };

  const personUuid = authUser.person_uuid != null ? String(authUser.person_uuid).trim() : '';

  const policy = await loadAgentSamUserPolicy(env, uid, targetWorkspace);
  const bootstrap = await resolveActiveBootstrap(env, {
    userId: uid,
    personUuid: personUuid || null,
    tenantId,
    workspaceId: targetWorkspace,
  });

  const policyCanPty = await userCanRunPtyFromPolicy(env, uid, targetWorkspace);

  if (!policyCanPty) {
    if (!bootstrap) return { response: null, error: 'Terminal not permitted (no bootstrap)', status: 403 };
    let capabilities = {};
    try {
      capabilities = JSON.parse(bootstrap.capabilities_json || '{}');
    } catch (_) {
      capabilities = {};
    }
    const canPty = capabilities.can_run_pty === true || capabilities.terminal === true;
    if (!canPty) return { response: null, error: 'Terminal not permitted', status: 403 };

    const catalogRow = await loadAgentsamToolRow(env, 'terminal_execute');
    const legacyOk = Number(policy.legacy_terminal_tool ?? 0) === 1;
    if (!catalogRow && !legacyOk) {
      return { response: null, error: 'terminal_execute not registered for this workspace', status: 403 };
    }

    const needsApprovalGate = !isLikelySafeShellCommand(command);
    if (needsApprovalGate) {
      let ok = false;
      if (proposalId && env.DB) {
        const pr = await env.DB.prepare(
          `SELECT id FROM agentsam_approval_queue WHERE id = ? AND status = 'approved' AND expires_at > unixepoch() LIMIT 1`,
        )
          .bind(String(proposalId))
          .first()
          .catch(() => null);
        ok = !!pr;
      }
      if (!ok) {
        return {
          response: null,
          error:
            'High-risk terminal command requires an approved proposal_id (dashboard approval flow) or use d1_query for reads.',
          status: 403,
        };
      }
    }
  }

  const t0 = Date.now();
  let output = '';
  let runCommand = command;
  let execErr = null;
  try {
    const { userMayUsePrivilegedTerminal } = await import('../../backend/identity/workspace/grants.js');
    const isOp = await userMayUsePrivilegedTerminal(env, { id: uid }, targetWorkspace);
    const routing = await resolveTerminalExecRoutingFromDb(env, {
      tool_name: body?.tool_name,
      target_id: body?.target_id ?? body?.ssh_target_id,
      target_type: body?.target_type,
      user_id: uid,
      isPlatformOperator: isOp,
    });
    const r = await runTerminalCommand(env, request, command, sessionId, {
      execution_mode: 'pty',
      workspace_id: targetWorkspace,
      tool_name: body?.tool_name ?? null,
      ...(routing.target_id ? { target_id: routing.target_id } : {}),
      ...(routing.target_type ? { target_type: routing.target_type } : {}),
    });
    output = r.output;
    runCommand = r.command;
  } catch (e) {
    execErr = e;
  }
  const durationMs = Date.now() - t0;

  const execId = crypto.randomUUID();
  if (env.DB) {
    try {
      const canonicalUserId = await resolveCanonicalUserId(uid, env);
      await env.DB.prepare(
        `INSERT INTO agentsam_command_run
         (id, tenant_id, workspace_id, user_id, session_id, command_name, command_text, output_text, status, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, 'terminal_run', ?, ?, ?, unixepoch(), unixepoch())`,
      ).bind(
        execId,
        tenantId,
        targetWorkspace,
        canonicalUserId,
        sessionId || null,
        runCommand,
        execErr ? String(execErr.message || execErr).slice(0, 12000) : output.slice(0, 12000),
        execErr ? 'failed' : 'completed',
      ).run();
    } catch (_) {}

    const terminalSpine = {
      agent_run_id:
        body?.agent_run_id != null && String(body.agent_run_id).trim() !== ''
          ? String(body.agent_run_id).trim()
          : body?.agentRunId != null && String(body.agentRunId).trim() !== ''
            ? String(body.agentRunId).trim()
            : null,
      conversation_id:
        body?.conversation_id != null && String(body.conversation_id).trim() !== ''
          ? String(body.conversation_id).trim()
          : sessionId,
    };

    scheduleRecordMcpToolExecution(env, ctx, {
      tenant_id: tenantId,
      workspace_id: targetWorkspace,
      session_id: sessionId,
      tool_name: 'terminal_run',
      input_json: JSON.stringify({ command: runCommand, workspace_id: targetWorkspace }),
      output_json: execErr ? null : JSON.stringify({ output: output.slice(0, 8000) }),
      success: !execErr,
      error_message: execErr ? String(execErr.message || execErr).slice(0, 4000) : null,
      duration_ms: durationMs,
      user_id: uid,
      person_uuid: personUuid || null,
      status: execErr ? 'error' : 'completed',
      // TELEMETRY-LEDGER-OWNERSHIP Phase A: scheduleTerminalToolCallLog below owns agentsam_tool_call_log.
      skip_tool_call_log: true,
      ...terminalSpine,
    });

    scheduleTerminalToolCallLog(env, ctx, {
      tenantId,
      sessionId,
      userId: uid,
      workspaceId: targetWorkspace,
      toolName: 'terminal_run',
      status: execErr ? 'error' : 'success',
      durationMs,
      ...terminalSpine,
      errorMessage: execErr ? String(execErr.message || execErr) : null,
      inputSummary: String(runCommand).slice(0, 200),
    });
  }

  if (execErr) {
    return {
      response: null,
      error: execErr.message || 'terminal run failed',
      status: 500,
      execution_id: execId,
    };
  }

  return {
    response: { output, command: runCommand, execution_id: execId },
    error: null,
    status: 200,
  };
}
