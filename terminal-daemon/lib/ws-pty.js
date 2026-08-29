import { WebSocketServer } from "ws";
import pty from "node-pty";
import crypto from "crypto";
import { initSessionMemory, restoreSession } from "../context-manager.js";
import {
  TOKEN,
  isVpcOrigin,
  resolveWsIdentity,
  resolveSessionCwd,
  verifyTerminalSession,
  cloudflareEnvFromVerify,
  ENV_BASE,
  buildPtyPromptEnv,
  fetchThemePersonality,
  listShellCandidates,
  ptySpawnArgs,
  sessions,
  log,
  safeSend,
  MAX_BUFFER,
  WORKER_URL,
  TUNNEL_URL,
} from "./pty-env.js";
import { operatorExecEnv, operatorPtySpawnSpec, resolveOperatorIdentity } from "./operator-identity.js";
import { armSessionInactivityTimer, routeMessageToPty, handleAssist, trimBuffer } from "./pty-session.js";
import { shouldAutoAssistOnOutput } from "./assist-policy.js";
import {
  armGraceReap,
  cancelGraceReap,
  destroySession,
  enforcePtyCaps,
  armMaxAgeTimer,
} from "./session-lifecycle.js";
import { server } from "./http-routes.js";

export const wss = new WebSocketServer({ server });

// NOTE: ws.ping()/pong heartbeat was removed. Through Cloudflare Worker fetch()
// WebSocket to this server, pong responses are unreliable and the bridge was
// dropped seconds after connect. Idle TCP cleanup is handled by tunnel/stack.

wss.on("connection", async (ws, req) => {
  if (!TOKEN) {
    safeSend(ws, JSON.stringify({ type: "error", data: "AGENTSAM_BRIDGE_KEY not set" }));
    ws.close(4001, "Unauthorized");
    return;
  }

  const url = new URL(req.url || "/", "http://x");
  const token = url.searchParams.get("token");
  const sessionIdParam = url.searchParams.get("session");
  const coreSessionId = (url.searchParams.get("session_id") || "").trim();
  const coreSessionToken = (url.searchParams.get("session_token") || "").trim();

  if (!isVpcOrigin(req) && token !== TOKEN) {
    ws.close(4001, "Unauthorized");
    return;
  }

  const identity = resolveWsIdentity(url);
  const { tenantId, userId, workspaceId, lane } = identity;
  if (lane === "local_user" && (!tenantId || !userId)) {
    safeSend(ws, JSON.stringify({ type: "error", data: "IAM_PTY_USER_ID/IAM_PTY_TENANT_ID not configured" }));
    ws.close(4002, "Identity missing");
    return;
  }
    const ALLOWED_SHELLS = process.platform === "win32"
      ? ["powershell", "pwsh"]
      : [
          "/usr/local/sbin/execos-run-as-operator",
          "/usr/local/sbin/execos-as-owner",
          "/usr/bin/sudo",
          "/bin/bash",
          "/usr/bin/bash",
          "/bin/zsh",
          "/usr/bin/zsh",
          "/bin/sh",
          "pwsh",
        ];
  const requestedShell = url.searchParams.get("shell") || null;
  const preferredShell =
    requestedShell && ALLOWED_SHELLS.includes(requestedShell) ? requestedShell : null;
  const sessionCwd = resolveSessionCwd(url, identity);

  let sessionId;
  let session = sessionIdParam ? sessions.get(sessionIdParam) : null;

  if (session && session.term) {
    // Reconnecting to an existing session — cancel grace, reuse same PTY.
    sessionId = sessionIdParam;
    cancelGraceReap(session, sessionId);
    session.clients.add(ws);
    session.id = sessionId;
    if (session.lastCommand === undefined) session.lastCommand = "";
    if (session.errorPending === undefined) session.errorPending = false;
    armSessionInactivityTimer(session, sessionId);

    safeSend(ws, JSON.stringify({ type: "session_id", session_id: sessionId }));
    const replay = session.outputBuffer.slice(-MAX_BUFFER).join("");
    if (replay) safeSend(ws, replay);

    ws.on("message", (raw) => {
      armSessionInactivityTimer(session, sessionId);
      void routeMessageToPty(raw, session.term, session).catch((err) =>
        log(`routeMessageToPty: ${err.message}`),
      );
    });
  } else {
    if (sessionIdParam && session && !session.term) {
      // Stale Map entry without a live PTY — remove before spawning.
      destroySession(sessionIdParam, "stale_reconnect");
      session = null;
    }

    const cap = enforcePtyCaps({ userId, workspaceId });
    if (!cap.ok) {
      safeSend(ws, JSON.stringify({ type: "error", data: cap.error }));
      ws.close(4008, cap.error);
      return;
    }

    let verifyPayload = null;
    if (coreSessionId && coreSessionToken) {
      verifyPayload = await verifyTerminalSession(coreSessionId, coreSessionToken);
      if (!verifyPayload) {
        safeSend(ws, JSON.stringify({ type: "error", data: "session verify failed" }));
        ws.close(4003, "Session invalid");
        return;
      }
    }

    sessionId = coreSessionId || crypto.randomUUID();
    const themeSlug = url.searchParams.get("theme_slug");
    let personality = null;
    try {
      personality = await fetchThemePersonality(themeSlug || null);
    } catch (_) {}

    const cfEnv = cloudflareEnvFromVerify(verifyPayload);
    const operatorId = resolveOperatorIdentity();
    if (operatorId.operator_config_missing) {
      safeSend(ws, JSON.stringify({ type: "error", data: "operator_user_required" }));
      ws.close(4002, "operator_user_required");
      return;
    }
    const ptyEnv = {
      ...operatorExecEnv({ ...ENV_BASE, ...cfEnv }),
      ...buildPtyPromptEnv(personality),
      IAM_PTY_USER_ID: userId !== "default" ? userId : process.env.IAM_PTY_USER_ID || "",
      IAM_PTY_TENANT_ID: tenantId !== "default" ? tenantId : process.env.IAM_PTY_TENANT_ID || "",
      IAM_PTY_WORKSPACE_ID: workspaceId || process.env.IAM_PTY_WORKSPACE_ID || "",
    };

    let term;
    let shellUsed = "";
    let lastSpawnErr = null;
    const operatorSpec = operatorPtySpawnSpec(sessionCwd);
    const shellsToTry = preferredShell
      ? [preferredShell, ...listShellCandidates().filter((s) => s !== preferredShell)]
      : listShellCandidates();
    const spawnAttempts = operatorId.needs_switch
      ? [{ file: operatorSpec.file, args: operatorSpec.args }]
      : shellsToTry.map((sh) => ({ file: sh, args: ptySpawnArgs() }));
    for (const attempt of spawnAttempts) {
      try {
        term = pty.spawn(attempt.file, attempt.args, {
          name: "xterm-256color",
          cols: 220,
          rows: 50,
          cwd: sessionCwd,
          env: { ...ptyEnv, SHELL: "/bin/bash" },
        });
        shellUsed = attempt.file;
        break;
      } catch (e) {
        lastSpawnErr = e;
      }
    }
    if (!term) {
      const msg = lastSpawnErr ? String(lastSpawnErr.message) : "posix_spawnp failed";
      safeSend(ws, JSON.stringify({ type: "error", data: msg }));
      ws.close(4002, "Spawn failed");
      return;
    }

    log(
      `new session ${sessionId} (pid ${term.pid}) shell=${shellUsed} lane=${lane}${
        cfEnv.CLOUDFLARE_API_TOKEN ? " cf=oauth" : ""
      }`,
    );

    const outputBuffer = [];
    const clients = new Set([ws]);
    const createdAt = Date.now();

    session = {
      id: sessionId,
      term,
      clients,
      createdAt,
      cwd: sessionCwd,
      userId: userId !== "default" ? userId : null,
      workspaceId: workspaceId || null,
      tenantId: tenantId !== "default" ? tenantId : null,
      cols: term.cols,
      rows: term.rows,
      outputBuffer,
      killTimer: null,
      inactivityTimer: null,
      maxAgeTimer: null,
      lastCommand: "",
      errorPending: false,
      preferredModelKey: null,
      _destroying: false,
    };
    sessions.set(sessionId, session);
    initSessionMemory(session);
    restoreSession(session);
    armSessionInactivityTimer(session, sessionId);
    armMaxAgeTimer(session, sessionId);

    safeSend(ws, JSON.stringify({ type: "session_id", session_id: sessionId }));

    term.onData((d) => {
      if (!sessions.has(sessionId)) return;
      armSessionInactivityTimer(session, sessionId);
      outputBuffer.push(d);
      trimBuffer(outputBuffer);
      clients.forEach((c) => safeSend(c, d));
      const cleanD = d.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");
      if (
        !session.errorPending &&
        shouldAutoAssistOnOutput(cleanD, session.lastCommand)
      ) {
        session.errorPending = true;
        setTimeout(async () => {
          session.errorPending = false;
          await handleAssist(session, {
            mode: "fix",
            command: session.lastCommand,
            context: null,
            output: session.outputBuffer.slice(-20).join(""),
            exit_code: 1,
          });
        }, 500);
      }
    });

    term.onExit(({ exitCode }) => {
      log(`session ${sessionId} exited with code ${exitCode}`);
      const msg = "\r\n[exit " + exitCode + "]\r\n";
      try {
        clients.forEach((c) => safeSend(c, msg));
      } catch (_) {}
      destroySession(sessionId, `pty_exit_${exitCode}`);
    });

    ws.on("message", (raw) => {
      armSessionInactivityTimer(session, sessionId);
      void routeMessageToPty(raw, term, session).catch((err) =>
        log(`routeMessageToPty: ${err.message}`),
      );
    });

    fetch(`${WORKER_URL}/api/terminal/session/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        "X-Bridge-Key": process.env.AGENTSAM_BRIDGE_KEY || "",
      },
      body: JSON.stringify({
        session_id: sessionId,
        session_token: coreSessionToken || undefined,
        tunnel_url: TUNNEL_URL,
        user_id: userId !== "default" ? userId : process.env.IAM_PTY_USER_ID || undefined,
        workspace_id: workspaceId || process.env.IAM_PTY_WORKSPACE_ID || undefined,
        cols: term.cols,
        rows: term.rows,
        shell: shellUsed,
        cwd: sessionCwd,
      }),
    }).catch((err) => log(`session register failed: ${err.message}`));
  }

  ws.on("close", () => {
    if (!session) return;
    if (!sessions.has(sessionId)) return;
    session.clients.delete(ws);
    log(`client disconnected from session ${sessionId}, ${session.clients.size} client(s) remaining`);
    if (session.clients.size === 0) {
      armGraceReap(session, sessionId);
    }
  });

  ws.on("error", () => {
    try {
      session?.clients?.delete(ws);
    } catch (_) {}
    if (session && sessions.has(sessionId) && session.clients.size === 0) {
      armGraceReap(session, sessionId);
    }
  });
});
