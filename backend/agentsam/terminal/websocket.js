import { shouldSkipTerminalHistoryInput } from './history-policy.js';
import { handleTerminalSlashCommand } from './slash.js';
import { WORKSPACE_CONTEXT_MISSING } from '../../identity/bootstrap.js';
import { assertWorkspaceTokenForPty } from '../../../src/core/workspace-tokens.js';
import { sendTerminalState, broadcastTerminalState, broadcastTerminalOutput as publishTerminalOutput } from './events.js';

/** Hibernation tag on in-app terminal frontend sockets. Not a host/lane/tunnel id. */
const TERMINAL_WS_TAG = 'terminal';
const DEFAULT_EXECUTION_MODE = 'pty';
function normalizeExecutionMode(value) {
  const raw = String(value || DEFAULT_EXECUTION_MODE).trim().toLowerCase();
  return raw === 'ssh' || raw === 'mcp' || raw === 'batch_exec' ? raw : 'pty';
}
function normalizeShellOverride(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  const nick = { zsh: '/bin/zsh', bash: '/bin/bash', sh: '/bin/sh', powershell: 'powershell', pwsh: 'pwsh' };
  if (nick[lower]) return nick[lower];
  if (s.startsWith('/') && /^\/[\w/.-]{1,64}$/.test(s)) return s;
  if (/^(powershell|pwsh)$/i.test(s)) return lower;
  return null;
}
function messageToString(input) {
  if (typeof input === 'string') return input;
  if (input instanceof ArrayBuffer) return new TextDecoder().decode(input);
  if (input instanceof Uint8Array) return new TextDecoder().decode(input);
  if (input == null) return '';
  return String(input);
}

export async function handleTerminalWebSocket(session, request, url) {
    const upgradeHeader = (request.headers.get("Upgrade") || "").toLowerCase();
    if (upgradeHeader !== "websocket") {
      return new Response("Durable Object expected Upgrade: websocket", { status: 426 });
    }

    const executionMode = normalizeExecutionMode(url.searchParams.get("execution_mode"));
    const workspaceId = (url.searchParams.get("workspace_id") || "").trim();
    if (!workspaceId) {
      return new Response(
        JSON.stringify({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const uidRaw = (url.searchParams.get("user_id") || "").trim();
    if (!uidRaw) {
      return new Response(JSON.stringify({ error: "TERMINAL_USER_ID_REQUIRED", code: "TERMINAL_USER_ID_REQUIRED" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    session.ptSessionUserId = uidRaw;
    const preSessionId = (url.searchParams.get("session_id") || "").trim();
    const preSessionToken = (url.searchParams.get("session_token") || "").trim();
    if (preSessionId) {
      session.cachedTerminalSessionId = preSessionId;
      await session.ctx.storage.put("terminal_session_id", preSessionId);
    }
    if (preSessionToken) {
      session.ptSessionMintedToken = preSessionToken;
    }
    session.ptSessionTenantId = (url.searchParams.get("tenant_id") || "").trim();
    session.ptPersonUuid = (url.searchParams.get("person_uuid") || "").trim();
    session.terminalShellOverride = normalizeShellOverride(url.searchParams.get("shell"));
    const rawTargetType = (url.searchParams.get("target_type") || "").trim();
    if (!rawTargetType || rawTargetType === "auto") {
      return new Response(
        JSON.stringify({
          error: rawTargetType === "auto" ? "target_type_invalid" : "target_type_required",
          code: rawTargetType === "auto" ? "target_type_invalid" : "target_type_required",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    session.requestedTargetType = rawTargetType;
    session.requestedConnectionId = (url.searchParams.get("connection_id") || "").trim();
    session.selectedTargetType = session.requestedTargetType;
    await session.ensureWorkspaceSettingsLoaded(workspaceId);
    await session.persistPtySessionContext();

    let tenantForRow = await session.resolvePtyTenantForSession(session.ptSessionUserId);
    tenantForRow = tenantForRow != null ? String(tenantForRow).trim() : "";
    if (!tenantForRow) {
      return new Response(JSON.stringify({ error: "TENANT_CONTEXT_REQUIRED", code: "TENANT_CONTEXT_REQUIRED" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    session.ptSessionTenantId = tenantForRow;
    const tokRes = await assertWorkspaceTokenForPty(session.env, workspaceId, tenantForRow);
    if (!tokRes.ok) {
      return new Response(JSON.stringify({ error: "no active workspace token", message: "no active workspace token" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (session.env?.DB) {
      try {
        const sel = await session.selectTerminalConnection({
          userId: session.ptSessionUserId,
          workspaceId,
          tenantId: tenantForRow,
          connectionId: session.requestedConnectionId || null,
          targetType: session.requestedTargetType || null,
          healthAware: true,
        });
        session.selectedTerminalConnection = sel.connection;
        if (sel.connection?.target_type) {
          session.selectedTargetType = String(sel.connection.target_type).trim();
        }
      } catch (_) {}
    }

    await session.applyPtyWorkingDir(tenantForRow, session.ptSessionUserId, session.selectedTerminalConnection);
    await session.persistPtySessionContext();

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    session.ctx.acceptWebSocket(server, [TERMINAL_WS_TAG, `mode:${executionMode}`]);
    server.serializeAttachment({ kind: TERMINAL_WS_TAG, execution_mode: executionMode });
  void session.scheduleTunnelHealthAlarm();

    const sid = await session.getOrCreateTerminalSessionId();
    try {
      server.send(JSON.stringify({ type: "session_id", session_id: sid }));
    } catch (_) {}
    let personForRow = session.ptPersonUuid ? String(session.ptPersonUuid).trim() || null : null;
    if (!personForRow) {
      try {
        const ur = await session.env.DB.prepare(`SELECT person_uuid FROM auth_users WHERE id = ? LIMIT 1`)
          .bind(session.ptSessionUserId)
          .first();
        personForRow = ur?.person_uuid ? String(ur.person_uuid).trim() || null : null;
      } catch (_) {}
    }
    if (tenantForRow && workspaceId && session.ptSessionUserId) {
      await session.upsertTerminalSessionRow(sid, {
        tenantId: tenantForRow,
        userId: session.ptSessionUserId,
        workspaceId,
        personUuid: personForRow,
      });
    }

    session.sendStateToWebSocket(server, "connecting");
    try {
      await session.ensureModeReady(executionMode, {
        workspaceId,
        userId: session.ptSessionUserId,
        targetType: session.requestedTargetType,
      });
      if (executionMode === "pty" && session.env?.DB) {
        const doId = session.ctx.id.toString();
        const wid = String(session.workspaceId || workspaceId || "").trim();
        let personUuid = personForRow;
        const tid = tenantForRow ? String(tenantForRow).trim() : null;
        if (!tid) throw new Error("PTY tenant_id missing");
        if (wid) {
          await session.env.DB.prepare(
            `INSERT INTO agentsam_workspace_state (workspace_id, agent_session_id, workspace_type, updated_at)
             VALUES (?, ?, 'ide', unixepoch())
             ON CONFLICT(workspace_id) DO UPDATE SET
               agent_session_id = excluded.agent_session_id,
               updated_at = excluded.updated_at`,
          ).bind(wid, doId).run().catch(() => {});
        }
      }
      session.sendStateToWebSocket(server, "connected");
      void session.insertTerminalHistoryRow("system", "terminal session opened", { triggeredBy: "system" });
    } catch (e) {
      session.sendStateToWebSocket(server, "backend_unavailable", String(e?.message || e));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

export function sendStateToWebSocket(session, ws, status, error = null) {
  return sendTerminalState(session, ws, status, error);
}

export function broadcastState(session, status, error = null) {
  return broadcastTerminalState(session, status, error);
}

export function broadcastTerminalOutput(session, text) {
  return publishTerminalOutput(session, text);
}

export function getSocketMeta(session, ws) {
    try {
      return ws.deserializeAttachment() || {};
    } catch (_) {
      return {};
    }
  }

export async function webSocketMessage(session, ws, message) {
    const meta = session.getSocketMeta(ws);
    if (meta?.kind !== TERMINAL_WS_TAG) return;
    const mode = normalizeExecutionMode(meta?.execution_mode);

    if (mode === "pty") {
      try {
        const raw = messageToString(message);
        let slashLine = null;
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.type === "slash" && typeof parsed?.line === "string") {
            slashLine = parsed.line.trim();
          } else if (
            parsed?.type === "input" &&
            typeof parsed?.data === "string" &&
            /^\/[a-zA-Z]/.test(parsed.data.trim())
          ) {
            slashLine = parsed.data.trim();
          } else if (parsed?.type === "resize") {
            await session.ensurePtyConnected();
            if (session.ptyWs && session.ptyWs.readyState === 1) {
              session.ptyWs.send(JSON.stringify(parsed));
            }
            return;
          }
        } catch (_) {
          if (/^\/[a-zA-Z]/.test(raw.trim())) slashLine = raw.trim();
        }

        if (slashLine) {
          const sid = await session.getOrCreateTerminalSessionId();
          const tenantId = await session.resolvePtyTenantForSession(session.ptSessionUserId);
          await handleTerminalSlashCommand(session.env, {
            line: slashLine,
            userId: session.ptSessionUserId,
            workspaceId: session.workspaceId,
            tenantId,
            sessionId: sid,
            broadcast: (text) => session.broadcastTerminalOutput(text),
          });
          return;
        }

        await session.ensurePtyConnected();
        if (!session.ptyWs || session.ptyWs.readyState !== 1) throw new Error("PTY socket not ready");
        let recordLine = null;
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.type === "input" && typeof parsed?.data === "string" && /[\r\n]/.test(parsed.data)) {
            recordLine = parsed.data.replace(/[\r\n]+$/, "").trim();
          }
        } catch (_) {
          if (/[\r\n]/.test(raw)) recordLine = raw.replace(/[\r\n]+$/, "").trim();
        }
        if (recordLine && recordLine.length > 0 && !shouldSkipTerminalHistoryInput(recordLine)) {
          void session.insertTerminalHistoryRow("input", recordLine.slice(0, 4000), { triggeredBy: "user" });
        }
        let outbound = raw;
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.type === "input" && typeof parsed?.data === "string") outbound = parsed.data;
          else if (parsed?.type === "resize") outbound = JSON.stringify(parsed);
        } catch (_) {}
        session.ptyWs.send(outbound);
      } catch (e) {
        session.sendStateToWebSocket(ws, "backend_unavailable", String(e?.message || e));
      }
      return;
    }

    const raw = messageToString(message);
    if (!raw) return;
    let input = raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.type === "resize") return;
      if (parsed?.type === "input" && typeof parsed?.data === "string") input = parsed.data;
      if (typeof parsed?.command === "string") input = parsed.command;
    } catch (_) {}

    const current = session.terminalLineBuffers.get(ws) || "";
    const merged = `${current}${input}`;
    const lines = merged.split(/\r\n|\n|\r/);
    const pending = lines.pop() || "";
    session.terminalLineBuffers.set(ws, pending);

    for (const line of lines) {
      const command = line.trim();
      if (!command) continue;
      try {
        const result = mode === "ssh"
          ? await session.executeSshCommand(command, {})
          : await session.executeMcpCommand(command, {});
        const out = result?.error ? String(result.error) : String(result?.output || "(no output)");
        session.sendStateToWebSocket(ws, "connected");
        session.broadcastTerminalOutput(`${out}\r\n`);
      } catch (e) {
        session.sendStateToWebSocket(ws, "backend_unavailable", String(e?.message || e));
      }
    }
  }

export async function webSocketClose(session, ws) {
    session.terminalLineBuffers.delete(ws);
    session.maybeFinalizeTerminalSession("terminal session closed");
  }

export async function webSocketError(session, ws) {
    session.terminalLineBuffers.delete(ws);
    session.maybeFinalizeTerminalSession("terminal websocket error");
  }
