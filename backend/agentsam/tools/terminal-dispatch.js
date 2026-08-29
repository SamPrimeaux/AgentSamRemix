/**
 * Dispatcher: Terminal (terminal-dispatch)
 * Handles HTTP routes for terminal execution, auditing, and AI assistance.
 */

import { getAuthUser } from '../../../src/core/auth.js'; import { verifyBridgeKey } from '../../auth/bridge-key-auth.js';
import { resolveCanonicalUserId } from '../../identity/users/index.js';
import { startAgentsamScriptRun, finalizeAgentsamScriptRun } from '../../../src/core/agentsam-script-runs.js';
import { runTerminalCommand } from '../../../src/core/terminal-session/runtime.js';

const SCRIPT_TRIGGER_SOURCES = new Set(['agent_sam', 'cursor', 'manual', 'github_push', 'scheduled', 'cicd']);

function explicitWorkspaceId(authUser, requestedWorkspaceId = '') {
  const requested = String(requestedWorkspaceId || '').trim();
  if (requested) return requested;
  return String(authUser?.workspace_id || authUser?.active_workspace_id || '').trim();
}

export async function handleTerminalRequest(path, method, body, env, request, ctx) {
  const pathLower = path.toLowerCase();

  // 1. POST /api/agent/terminal/run
  if (pathLower === '/api/agent/terminal/run' && method === 'POST') {
    const command = typeof body?.command === 'string' ? body.command.trim() : '';
    const session_id = body?.session_id ?? null;
    if (!command) return { error: 'No command', status: 400 };

    const agentsamScriptId =
      typeof body?.agentsam_script_id === 'string' ? body.agentsam_script_id.trim() : '';
    const authUser = await getAuthUser(request, env).catch(() => null);
    const workspaceForTelemetry =
      explicitWorkspaceId(authUser, body?.workspace_id);
    const triggerSrcRaw = body?.trigger_source;
    const triggerSource =
      typeof triggerSrcRaw === 'string' && SCRIPT_TRIGGER_SOURCES.has(triggerSrcRaw.trim())
        ? triggerSrcRaw.trim()
        : 'agent_sam';

    let scriptRun = null;
    /** @type {{ scriptId: string, workspaceId: string, tenantId?: string | null, userId?: string | null } | null} */
    let hookCtx = null;
    const startedMs = Date.now();

    if (agentsamScriptId && workspaceForTelemetry && env.DB) {
      try {
        const authUser = await getAuthUser(request, env);
        const tenantId =
          authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== ''
            ? String(authUser.tenant_id).trim()
            : null;
        scriptRun = await startAgentsamScriptRun(env.DB, {
          scriptId: agentsamScriptId,
          workspaceId: workspaceForTelemetry,
          triggeredBy: authUser?.email || authUser?.id || 'terminal',
          triggerSource,
          tenantId,
          userId: authUser?.id ?? null,
        });
        if (scriptRun?.id) {
          hookCtx = {
            scriptId: agentsamScriptId,
            workspaceId: workspaceForTelemetry,
            tenantId,
            userId: authUser?.id ?? null,
          };
        }
      } catch (e) {
        console.warn('[terminal] agentsam_script_runs start', e?.message ?? e);
      }
    }

    try {
      const { output, command: runCommand, exitCode } = await runTerminalCommand(
        env,
        request,
        command,
        session_id,
        ctx,
      );
      const execId = crypto.randomUUID();
      const wid = explicitWorkspaceId(await getAuthUser(request, env).catch(() => null));
      const tenantId = env.DEFAULT_TENANT_ID ?? null;

      // Audit execution to D1
      if (wid) {
        try {
          let uidForRun = hookCtx?.userId ?? null;
          if (uidForRun == null) {
            try {
              const au = await getAuthUser(request, env);
              uidForRun = au?.id ?? null;
            } catch (_) {}
          }
          const canonicalUserId = await resolveCanonicalUserId(uidForRun, env);
          await env.DB.prepare(
            `INSERT INTO agentsam_command_run 
         (id, tenant_id, workspace_id, user_id, session_id, command_name, command_text, output_text, status, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, 'terminal_run', ?, ?, 'completed', unixepoch(), unixepoch())`
          )
            .bind(execId, tenantId, wid, canonicalUserId, session_id || null, runCommand, output)
            .run();
        } catch (_) {}
      }

      if (scriptRun?.id && hookCtx) {
        try {
          const dur = Date.now() - startedMs;
          const ok = exitCode === 0 || exitCode === undefined || exitCode === null;
          await finalizeAgentsamScriptRun(
            env.DB,
            scriptRun.id,
            {
              status: ok ? 'passed' : 'failed',
              exitCode: exitCode ?? null,
              durationMs: dur,
              outputSummary: String(output ?? '').slice(0, 2000),
              errorMessage: ok ? null : `exit code ${exitCode}`,
            },
            hookCtx,
          );
        } catch (e) {
          console.warn('[terminal] agentsam_script_runs finalize', e?.message ?? e);
        }
      }

      return {
        output,
        command: runCommand,
        execution_id: execId,
        exit_code: exitCode,
        agentsam_script_run_id: scriptRun?.id ?? null,
      };
    } catch (e) {
      if (scriptRun?.id && hookCtx && env.DB) {
        try {
          await finalizeAgentsamScriptRun(
            env.DB,
            scriptRun.id,
            {
              status: 'failed',
              durationMs: Date.now() - startedMs,
              errorMessage: String(e?.message || e).slice(0, 2000),
            },
            hookCtx,
          );
        } catch (_) {}
      }
      throw e;
    }
  }

  // 2. POST /api/agent/terminal/complete
  if (pathLower === '/api/agent/terminal/complete' && method === 'POST') {
    const executionId = body?.execution_id;
    const status = body?.status;
    const now = Math.floor(Date.now() / 1000);

    if (executionId && (status === 'completed' || status === 'failed')) {
      try {
        await env.DB.prepare(
          "UPDATE agentsam_command_run SET status = ?, completed_at = ? WHERE id = ?"
        ).bind(status, now, executionId).run();
      } catch (_) {}
    }
    return { ok: true };
  }

  // 3. POST /api/agent/terminal/live-event — MCP terminal tool pushes live output for dashboard display
  if (pathLower === '/api/agent/terminal/live-event' && method === 'POST') {
    if (!verifyBridgeKey(request, env)) {
      return { error: 'Unauthorized', status: 401 };
    }
    const { workspace_id, event } = body || {};
    if (!workspace_id || !event) return { ok: true }; // non-fatal
    try {
      // Fan-out to all terminal DO instances for this workspace.
      // DO name: terminal:{userId}:{workspaceId}:{mode} — we broadcast to the
      // global workspace sentinel which the frontend subscribes to.
      if (env.AGENT_SESSION?.idFromName) {
        const sentinelName = 'terminal_live:' + workspace_id;
        const stub = env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(sentinelName));
        await stub.fetch('https://internal/designstudio/stream-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ envelope: { type: 'terminal_output', workspace_id, ...event, ts: event.ts || Date.now() } }),
        }).catch(() => null);
      }
    } catch (_) {}
    return { ok: true };
  }

  // 4. GET /api/agent/terminal/events — SSE stream of terminal_output events for the dashboard live view
  if (pathLower === '/api/agent/terminal/events' && method === 'GET') {
    if (!authUser) return { error: 'Unauthorized', status: 401 };
    if (!env.AGENT_SESSION) return { error: 'AGENT_SESSION not configured', status: 503 };
    const wsId = (url.searchParams.get('workspace_id') || '').trim();
    if (!wsId) return { error: 'workspace_id required', status: 400 };
    // Use the sentinel DO for this workspace — no DB lookup needed
    const sentinelName = 'terminal_live:' + wsId;
    const stub = env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(sentinelName));
    const doUrl = new URL(request.url);
    doUrl.pathname = '/designstudio/events';
    doUrl.search = '';
    doUrl.searchParams.set('run_id', sentinelName);
    const lastId = url.searchParams.get('last_id');
    if (lastId) doUrl.searchParams.set('last_id', lastId);
    return stub.fetch(new Request(doUrl.toString(), { headers: request.headers }));
  }

  // 5. POST /api/terminal/assist
  if (pathLower === '/api/terminal/assist' && method === 'POST') {
    const { mode, command, context, output, exit_code } = body || {};
    // ... migration logic for assists handlers ...
    return { error: 'Terminal assist integration in progress', status: 501 };
  }

  return { error: 'Not Found', status: 404 };
}
