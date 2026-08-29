import http from "http";
import { verifyMachineAuthKey } from "./machine-auth.js";
import {
  TOKEN,
  BRIDGE_KEY,
  EXECOS_KEY,
  isVpcOrigin,
  log,
  sessions,
  listShellCandidates,
  IS_WIN,
  WORKER_URL,
  CWD,
  EXECOS_DEFAULT_CWD_META,
  EXECOS_TIMEOUT_MS,
  SESSION_GRACE_MS,
} from "./pty-env.js";
import { runOwnerExec, runGuardedExec } from "./exec-security.js";
import { executionIdentityReceipt, probeOperatorRepo, probeOperatorShell } from "./operator-identity.js";
import { hostTargetFromPlatform } from "./exec-vocabulary.js";
import { callMcpFilesystem } from "./mcp-fs.js";
import {
  collectSessionStats,
  SESSION_MAX_AGE_MS,
  MAX_PTY_GLOBAL,
  MAX_PTY_PER_USER,
  MAX_PTY_PER_WORKSPACE,
} from "./session-lifecycle.js";

function reqPath(req) {
  try {
    return new URL(req.url || "/", "http://execos.local").pathname;
  } catch {
    return String(req.url || "").split("?")[0] || "";
  }
}

function jsonEnd(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const MACHINE_AUTH_ENV = { AGENTSAM_BRIDGE_KEY: BRIDGE_KEY, EXECOS_KEY };

function requireExecosKey(req, res) {
  const provided = req.headers["x-execos-key"] || "";
  if (!verifyMachineAuthKey(provided, MACHINE_AUTH_ENV)) {
    jsonEnd(res, 401, { ok: false, error: "invalid_execos_key", failure_class: "execos_unreachable" });
    return false;
  }
  return true;
}

export const server = http.createServer(async (req, res) => {
  const pathname = reqPath(req);
  if (pathname === "/health") {
    const stats = collectSessionStats();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      service: "execos-runtime",
      version: "2.0.2",
      host_platform: process.platform,
      host_target: hostTargetFromPlatform(),
      token_set: !!TOKEN,
      execos_key_set: !!EXECOS_KEY,
      bridge_key_set: !!BRIDGE_KEY,
      workspaces_root: CWD,
      execos_default_cwd_meta: EXECOS_DEFAULT_CWD_META,
      execos_default_cwd_unused_for_exec: true,
      execos_timeout_ms: EXECOS_TIMEOUT_MS,
      allowed_tenants: (process.env.ALLOWED_TENANTS || "").split(",").filter(Boolean),
      active_sessions: stats.active_sessions,
      disconnected_grace_sessions: stats.disconnected_grace_sessions,
      idle_sessions: stats.idle_sessions,
      oldest_session_age_seconds: stats.oldest_session_age_seconds,
      clients_total: stats.clients_total,
      sessions_tracked: stats.sessions_tracked,
      session_grace_ms: SESSION_GRACE_MS,
      session_max_age_ms: SESSION_MAX_AGE_MS,
      max_pty_global: MAX_PTY_GLOBAL,
      max_pty_per_user: MAX_PTY_PER_USER,
      max_pty_per_workspace: MAX_PTY_PER_WORKSPACE,
      uptime_seconds: Math.floor(process.uptime()),
      agentsam_tools: true,
      routes: ["/health", "/health/shell", "/health/repo", "/status", "/run", "/exec", "/exec-agentsam-bridgekey"],
    }));
    return;
  }

  // Transport vs shell vs repo vs PTY are independent. /health is transport/liveness only.
  if (pathname === "/health/shell" && req.method === "GET") {
    if (!requireExecosKey(req, res)) return;
    probeOperatorShell((err, stdout, stderr) => {
      const identity = executionIdentityReceipt({});
      const exitCode = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      jsonEnd(res, 200, {
        ok: exitCode === 0,
        check: "shell",
        stdout: stdout || "",
        stderr: stderr || "",
        exit_code: exitCode,
        transport_ok: true,
        shell_ok: !err || typeof err.code === "number",
        failure_class: exitCode === 0 ? null : "command_failed",
        ...identity,
      });
    });
    return;
  }

  if (pathname === "/health/repo" && req.method === "GET") {
    if (!requireExecosKey(req, res)) return;
    probeOperatorRepo((err, stdout, stderr) => {
      const identity = executionIdentityReceipt({});
      const exitCode = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      const text = `${stdout || ""}\n${stderr || ""}`;
      let failure_class = null;
      if (exitCode !== 0) {
        if (/permission denied|not writable|FETCH_HEAD/i.test(text)) failure_class = "repo_permission_denied";
        else failure_class = "command_failed";
      }
      jsonEnd(res, 200, {
        ok: exitCode === 0,
        check: "repo",
        stdout: stdout || "",
        stderr: stderr || "",
        exit_code: exitCode,
        transport_ok: true,
        shell_ok: true,
        repo_ok: exitCode === 0,
        failure_class,
        ...identity,
      });
    });
    return;
  }

  // ── POST /run — ExecOS owner exec (X-ExecOS-Key + explicit cwd + repo gate) ─
  if (pathname === "/run" && req.method === "POST") {
    const providedExecKey = req.headers["x-execos-key"] || "";
    if (!verifyMachineAuthKey(providedExecKey, MACHINE_AUTH_ENV)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "invalid_execos_key" }));
      return;
    }
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      let cmd;
      let reqCwd = "";
      try {
        const parsed = JSON.parse(body);
        cmd = parsed.command;
        reqCwd = parsed.cwd || "";
      } catch (_) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
        return;
      }
      runOwnerExec(cmd, reqCwd, res, req);
    });
    return;
  }

  // ── /exec-agentsam-bridgekey — dedicated, unconditional operator exec lane ──
  // No terminal_connections lookup, no workspace resolution, no can_run_pty
  // policy check. Gated solely on AGENTSAM_BRIDGE_KEY via X-Bridge-Key header,
  // per the documented Worker-to-Worker token convention. This exists so the
  // platform owner's own MCP bridge calls never get trapped in multi-tenant
  // resolution logic that was only ever meant to scope customer connections.
  if (pathname === "/exec-agentsam-bridgekey" && req.method === "POST") {
    const providedBridgeKey = req.headers["x-bridge-key"] || "";
    if (!BRIDGE_KEY || providedBridgeKey !== BRIDGE_KEY) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "invalid_bridge_key" }));
      return;
    }
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      let cmd;
      let reqCwd = "";
      try {
        const parsed = JSON.parse(body);
        cmd = parsed.command;
        reqCwd = parsed.cwd || "";
      } catch (_) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
        return;
      }
      if (!cmd) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "command required" }));
        return;
      }
      runGuardedExec(cmd, reqCwd, res, req, { requireIdentity: true });
    });
    return;
  }

  if (pathname === "/exec" && req.method === "POST") {
    if (!isVpcOrigin(req)) {
      const auth = req.headers["x-pty-auth"] || req.headers["authorization"] || "";
      const providedToken = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
      if (!TOKEN || providedToken !== TOKEN) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      let cmd;
      let reqCwd = "";
      try {
        const parsed = JSON.parse(body);
        cmd = parsed.command;
        reqCwd = parsed.cwd || "";
      } catch (_) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      if (!cmd) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "command required" }));
        return;
      }
      runGuardedExec(cmd, reqCwd, res, req, { requireIdentity: true });
    });
    return;
  }

  if (pathname === "/mcp/filesystem" && req.method === "POST") {
    if (!isVpcOrigin(req)) {
      const auth = req.headers["x-pty-auth"] || req.headers["authorization"] || "";
      const providedToken = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
      if (!TOKEN || providedToken !== TOKEN) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }
    let bodyData = "";
    req.on("data", (d) => (bodyData += typeof d === "string" ? d : d.toString()));
    req.on("end", async () => {
      let rpc;
      try {
        rpc = JSON.parse(bodyData);
      } catch (_) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      try {
        const out = await callMcpFilesystem(rpc);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname.startsWith("/sessions") && req.method === "GET") {
    if (!isVpcOrigin(req)) {
      const auth = req.headers["authorization"] || "";
      if (auth !== "Bearer " + TOKEN) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }
    const list = Array.from(sessions.entries()).map(([id, s]) => ({
      session_id: id,
      clients: s.clients?.size || 0,
      createdAt: s.createdAt,
      age_seconds: Math.floor(Math.max(0, Date.now() - Number(s.createdAt || Date.now())) / 1000),
      live_pty: !!(s.term && s.term.pid),
      in_grace: !!(s.killTimer) || ((s.clients?.size || 0) === 0),
      user_id: s.userId || null,
      workspace_id: s.workspaceId || null,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sessions: list }));
    return;
  }

  if (req.headers.upgrade === "websocket") return;
  // GET /status — safe public JSON status (no secrets exposed)
  if (pathname === "/status") {
    const stats = collectSessionStats();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      service: 'execos-runtime',
      status: 'ok',
      version: '2.0.2',
      uptime_seconds: Math.floor(process.uptime()),
      active_sessions: stats.active_sessions,
      disconnected_grace_sessions: stats.disconnected_grace_sessions,
      idle_sessions: stats.idle_sessions,
      oldest_session_age_seconds: stats.oldest_session_age_seconds,
      clients_total: stats.clients_total,
      sessions_tracked: stats.sessions_tracked,
      session_grace_ms: SESSION_GRACE_MS,
      shell: listShellCandidates()[0] || (IS_WIN ? 'powershell' : '/bin/zsh'),
      platform: process.platform,
      agentsam_url: WORKER_URL + '/api/terminal/assist',
      capabilities: ['pty', 'agentsam_assist', 'agentsam_model_catalog', 'session_memory'],
      endpoints: {
        health: 'GET /health (transport)',
        health_shell: 'GET /health/shell (X-ExecOS-Key)',
        health_repo: 'GET /health/repo (X-ExecOS-Key)',
        status: 'GET /status (PTY sessions)',
        websocket: 'WSS /?token=<PTY_AUTH_TOKEN>',
        exec: 'POST /exec (X-Pty-Auth / Bearer PTY_AUTH_TOKEN)',
        exec_bridge: 'POST /exec-agentsam-bridgekey (X-Bridge-Key AGENTSAM_BRIDGE_KEY)'
      }
    }));
    return;
  }

  // GET / — safe HTML landing page
  if (pathname === "/" || pathname === "") {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>ExecOS Runtime</title>
<style>
  body { background: #0d1117; color: #e6edf3; font-family: ui-monospace,monospace; padding: 40px; max-width: 700px; margin: 0 auto; }
  h1 { color: #58a6ff; } code { background: #161b22; padding: 2px 8px; border-radius: 4px; color: #79c0ff; }
  .ok { color: #3fb950; } .muted { color: #6e7681; } a { color: #58a6ff; }
  pre { background: #161b22; padding: 16px; border-radius: 6px; overflow-x: auto; }
</style>
</head>
<body>
<h1>ExecOS Runtime</h1>
<p class="ok">&#9679; Running</p>
<p>WebSocket PTY + owner exec for <a href="https://inneranimalmedia.com">Inner Animal Media</a>.<br>
Connects the dashboard terminal to the host shell via Cloudflare Tunnel / VPC.</p>

<h2>Capabilities</h2>
<ul>
  <li>Interactive PTY shell (zsh/bash)</li>
  <li>Agent Sam assist via Worker <code>/api/terminal/assist</code> (agentsam_model_catalog)</li>
  <li>Slash commands: <code>/status</code> <code>/agents</code> <code>/model</code> <code>/compact</code> <code>/clear</code></li>
  <li>Session memory &amp; context envelope</li>
</ul>

<h2>Endpoints</h2>
<pre>GET  /health    — liveness check
GET  /status    — JSON status (sessions, capabilities)
WSS  /?token=…  — WebSocket PTY connection (requires PTY_AUTH_TOKEN)
POST /exec      — one-shot exec (X-Pty-Auth / Bearer PTY_AUTH_TOKEN)
POST /exec-agentsam-bridgekey — operator-only exec (X-Bridge-Key AGENTSAM_BRIDGE_KEY)</pre>

<h2>Quickstart (Agent Sam)</h2>
<pre># Natural-language lines route to Agent Sam (not local Ollama)
why is wrangler deploy failing?

# Slash commands
/agents              — list models from agentsam_model_catalog
/model &lt;model_key&gt; — override (pick from /agents list)
/model auto          — reset to auto routing
/status              — PTY health</pre>

<p class="muted">AI: Agent Sam only (no local Ollama) &nbsp;|&nbsp; Context: session memory enabled &nbsp;|&nbsp; 
<a href="/health">health</a> &nbsp;|&nbsp; <a href="/status">status JSON</a></p>
</body>
</html>`);
    return;
  }

  res.writeHead(404);
  res.end();
});
