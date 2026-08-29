import { existsSync } from "fs";
import { userInfo } from "os";
import {
  EXECOS_KEY,
  EXECOS_TIMEOUT_MS,
  WORKER_URL,
  IS_WIN,
  listShellCandidates,
  ENV_BASE,
  buildPtyPromptEnv,
  log,
  TUNNEL_URL,
} from "./pty-env.js";
import { execAsOperator, executionIdentityReceipt, resolveOperatorIdentity } from "./operator-identity.js";
import { classifyCommandFailure } from "./failure-class.js";
import { executionLaneStamp, hostTargetFromPlatform } from "./exec-vocabulary.js";
import {
  checkCommandGuards,
  sanitizeOutput,
  logSecurityEvent,
} from "../shared/guard.mjs";
import { validateSamOperatorRepoAccess } from "../shared/sam-operator-lane.mjs";

// ─── IAM SECURITY LAYER — shared/guard.mjs (/exec + /exec-agentsam-bridgekey) ─

export function logSec(type, cmd, reason) {
  logSecurityEvent(type, cmd, reason);
}

/**
 * Shared guarded exec used by /exec and /exec-agentsam-bridgekey.
 * Runs the hard-block check, executes the command, sanitizes output, writes the response.
 * @param {string} cmd
 * @param {string} reqCwd
 * @param {import('http').ServerResponse} res
 */
export function notifyExecIdentityMismatch(req, cmd, expectedIdentity, runtimeUser, privilegedTarget) {
  const base = (WORKER_URL || '').replace(/\/$/, '');
  const key = (EXECOS_KEY || '').trim();
  if (!base || !key) return;
  const payload = JSON.stringify({
    expected_identity: expectedIdentity,
    runtime_user: runtimeUser,
    privileged_target: privilegedTarget || null,
    command: String(cmd || '').slice(0, 500),
    host: process.env.EXECOS_HOST || 'iam-tunnel',
  });
  fetch(`${base}/api/internal/exec-identity-alert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ExecOS-Key': key,
    },
    body: payload,
  }).catch((err) => {
    console.warn('[EXECOS-SECURITY] identity alert webhook failed', err?.message || err);
  });
}

/**
 * Durable cwd / operator-repo denial → D1 agentsam_error_log via main Worker.
 * Fire-and-forget; local logSec remains.
 * @param {import('http').IncomingMessage|null|undefined} req
 * @param {{
 *   error_code: string,
 *   error_message: string,
 *   requested_cwd?: string|null,
 *   resolved_cwd?: string|null,
 *   command?: string|null,
 * }} detail
 */
export function reportCwdResolutionError(req, detail) {
  const base = (WORKER_URL || '').replace(/\/$/, '');
  const key = (EXECOS_KEY || '').trim();
  if (!base || !key) return;
  const headers = req?.headers || {};
  const userId = String(headers['x-user-id'] || '').trim() || null;
  const workspaceId = String(headers['x-workspace-id'] || '').trim() || 'unknown';
  const tenantId = String(headers['x-tenant-id'] || '').trim() || 'system';
  const payload = JSON.stringify({
    error_type: 'cwd_resolution',
    error_code: detail.error_code,
    error_message: detail.error_message,
    source: 'execos_resolve_req_cwd',
    workspace_id: workspaceId,
    tenant_id: tenantId,
    source_id: userId,
    context_json: {
      requested_cwd: detail.requested_cwd ?? null,
      resolved_cwd: detail.resolved_cwd ?? null,
      user_id: userId,
      attempted_path: detail.requested_cwd ?? null,
      command: detail.command != null ? String(detail.command).slice(0, 500) : null,
      host: process.env.EXECOS_HOST || 'iam-tunnel',
    },
  });
  fetch(`${base}/api/internal/error-log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ExecOS-Key': key,
    },
    body: payload,
  }).catch((err) => {
    console.warn('[EXECOS-SECURITY] cwd error-log webhook failed', err?.message || err);
  });
}

export function runtimeExecUser() {
  const fromEnv = (process.env.EXECOS_RUNTIME_USER || process.env.IAM_PTY_UNIX_USER || "").trim();
  if (fromEnv) return fromEnv;
  try {
    return String(userInfo().username || "").trim();
  } catch (_) {
    return "";
  }
}

/**
 * Fail-closed: caller-supplied X-IAM-Exec-Identity must match the OS user running this process.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{ required?: boolean, cmd?: string }} [opts]
 * @returns {boolean}
 */
export function validateExecIdentity(req, res, opts = {}) {
  const trimmed = String(opts.cmd || "").trim();
  const execIdentity = String(req?.headers?.["x-iam-exec-identity"] || "").trim();
  const privilegedTarget = String(req?.headers?.["x-iam-privileged-target"] || "").trim();
  const runtimeUser = runtimeExecUser();
  const operatorUser = resolveOperatorIdentity().effective_username;

  if (opts.required && !execIdentity) {
    logSec("EXEC_IDENTITY_MISSING", trimmed, `runtime ${runtimeUser}`);
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      stdout: "",
      stderr: "IAM Security: X-IAM-Exec-Identity required",
      exit_code: 1,
      blocked: true,
      identity_mismatch: true,
    }));
    return false;
  }

  if (!execIdentity) return true;

  logSec("EXEC_IDENTITY", trimmed, execIdentity + (privilegedTarget ? `@${privilegedTarget}` : ""));
  const execActor = String(req?.headers?.["x-iam-exec-actor"] || "").trim();
  if (execActor) logSec("EXEC_ACTOR", trimmed, execActor);

  const allowed = new Set([runtimeUser, operatorUser].filter(Boolean));
  if (!IS_WIN && execIdentity && allowed.size && !allowed.has(execIdentity)) {
    logSec("EXEC_IDENTITY_MISMATCH", trimmed, `expected ${[...allowed].join("|")} got header ${execIdentity} runtime ${runtimeUser}`);
    notifyExecIdentityMismatch(req, trimmed, execIdentity, runtimeUser, privilegedTarget);
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      stdout: "",
      stderr: `IAM Security: exec identity mismatch (expected ${execIdentity}, runtime ${runtimeUser})`,
      exit_code: 1,
      blocked: true,
      identity_mismatch: true,
    }));
    return false;
  }

  return true;
}

/**
 * Fail-closed cwd for /exec and /run — never invent a production repo path
 * (tkt_0bfb31cbf5104393). Returns { ok, cwd } or { ok:false, error, user_message }.
 * Host-aware: Mac paths only on Darwin; Linux /home paths only on Linux.
 * @param {string|null|undefined} reqCwd
 */
export function resolveReqCwd(reqCwd) {
  const cwd = String(reqCwd || "").trim();
  if (!cwd) {
    return {
      ok: false,
      error: "cwd_required",
      user_message:
        "Exec requires an explicit cwd computed from caller identity. No ambient default is applied.",
    };
  }
  const isDarwin = process.platform === "darwin";
  const isLinux = process.platform === "linux";
  if ((cwd.startsWith("/Users/") || cwd.startsWith("/Volumes/")) && !isDarwin) {
    return {
      ok: false,
      error: "mac_cwd_on_linux",
      user_message:
        "Mac absolute paths are not valid on this host. Resolve a Linux cwd (platform repo or /workspace/{tenant_id}/) before calling ExecOS.",
    };
  }
  if (cwd.startsWith("/home/") && isDarwin) {
    return {
      ok: false,
      error: "cwd_foreign_host",
      user_message:
        "Linux absolute paths are not valid on this Mac host. Use a Darwin cwd under /Users/… before calling localpty.",
    };
  }
  if (isLinux && !cwd.startsWith("/") ) {
    return {
      ok: false,
      error: "cwd_required",
      user_message: "Exec requires an absolute cwd on this host.",
    };
  }
  if (!IS_WIN && !existsSync(cwd)) {
    return {
      ok: false,
      error: "cwd_missing",
      user_message: `cwd does not exist on this host: ${cwd}`,
    };
  }
  return { ok: true, cwd };
}

export function writeCwdError(res, resolved) {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      ok: false,
      error: resolved.error,
      user_message: resolved.user_message,
      stdout: "",
      stderr: resolved.user_message || resolved.error,
      exit_code: 1,
      blocked: true,
    }),
  );
}

/**
 * @param {import('http').IncomingMessage} [req]
 */
export function runGuardedExec(cmd, reqCwd, res, req = null, opts = {}) {
  const trimmed = cmd.trim();
  const resolved = resolveReqCwd(reqCwd);
  if (!resolved.ok) {
    logSec("CWD_REJECTED", trimmed, resolved.error);
    reportCwdResolutionError(req, {
      error_code: resolved.error,
      error_message: resolved.user_message || resolved.error,
      requested_cwd: reqCwd,
      command: trimmed,
    });
    writeCwdError(res, resolved);
    return;
  }
  const resolvedCwd = resolved.cwd;
  const repoAccess = validateSamOperatorRepoAccess(req || {}, resolvedCwd);
  if (!repoAccess.ok) {
    logSec("OPERATOR_REPO_FORBIDDEN", trimmed, repoAccess.reason);
    reportCwdResolutionError(req, {
      error_code: 'operator_repo_forbidden',
      error_message: repoAccess.reason,
      requested_cwd: reqCwd,
      resolved_cwd: resolvedCwd,
      command: trimmed,
    });
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      stdout: "",
      stderr: `IAM Security: ${repoAccess.reason}`,
      exit_code: 1,
      blocked: true,
      operator_repo_forbidden: true,
      error: 'operator_repo_forbidden',
    }));
    return;
  }
  if (!validateExecIdentity(req || {}, res, { required: opts.requireIdentity === true, cmd: trimmed })) {
    return;
  }

  const guard = checkCommandGuards(trimmed);
  if (guard.blocked) {
    logSec('BLOCKED', trimmed, guard.reason);
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ stdout: "", stderr: "IAM Security: " + guard.reason, exit_code: 1, blocked: true }));
    return;
  }

  logSec('ALLOWED', trimmed, 'passed');

  execAsOperator(
    trimmed,
    resolvedCwd,
    {
      env: { ...ENV_BASE, ...buildPtyPromptEnv(null) },
      timeout: EXECOS_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    },
    (err, stdout, stderr) => {
    const cleanOut = sanitizeOutput(stdout || "");
    const cleanErr = sanitizeOutput(stderr || "");
    if (cleanOut !== stdout || cleanErr !== stderr) {
      logSec('REDACTED', trimmed, 'secret patterns scrubbed from output');
    }
    const exitCode = err ? (err.code ?? 1) : 0;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ stdout: cleanOut, stderr: cleanErr, exit_code: exitCode }));
  },
  );
}

/**
 * Owner exec for ExecOS POST /run — EXECOS_KEY + explicit cwd only.
 * CONTRACT: owner trust boundary; no X-User-Id / operator-repo gate on /run
 * (that gate stays on /exec + bridge lanes via runGuardedExec).
 * @param {import('http').IncomingMessage} [req]
 */
export function runOwnerExec(cmd, reqCwd, res, req = null) {
  const trimmed = String(cmd || "").trim();
  if (!trimmed) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "command_required" }));
    return;
  }

  const resolved = resolveReqCwd(reqCwd);
  if (!resolved.ok) {
    logSec("CWD_REJECTED", trimmed, resolved.error);
    reportCwdResolutionError(req, {
      error_code: resolved.error,
      error_message: resolved.user_message || resolved.error,
      requested_cwd: reqCwd,
      command: trimmed,
    });
    writeCwdError(res, resolved);
    return;
  }

  logSec("EXECOS_ALLOWED", trimmed, "owner_key_authenticated");

  const started = Date.now();
  const hostTarget = hostTargetFromPlatform();
  const identity = executionIdentityReceipt({
    cwd: resolved.cwd,
    cwd_source: "request",
    connection_target: TUNNEL_URL,
    ...executionLaneStamp(hostTarget),
  });
  execAsOperator(
    trimmed,
    resolved.cwd,
    {
      env: { ...ENV_BASE, ...buildPtyPromptEnv(null) },
      timeout: EXECOS_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    },
    (err, stdout, stderr) => {
      const cleanOut = sanitizeOutput(stdout || "");
      const cleanErr = sanitizeOutput(stderr || "");
      const timedOut = !!(err && (err.killed || err.signal === "SIGTERM" || err.signal === "SIGKILL"));
      const wrapperMissing = err && err.code === "operator_wrapper_missing";
      const operatorUserRequired = err && err.code === "operator_user_required";
      if (wrapperMissing || operatorUserRequired) {
        const error = operatorUserRequired ? "operator_user_required" : "operator_wrapper_missing";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error,
            failure_class: "execos_unreachable",
            user_message: operatorUserRequired
              ? "EXECOS_OPERATOR_USER must be configured on this host. Runtime will not invent an operator account."
              : "ExecOS daemon is not agentsam→operator wrapper-ready. Install execos-run-as-operator and sudoers.",
            stderr: cleanErr,
            stdout: cleanOut,
            exit_code: 1,
            latency_ms: Date.now() - started,
            target: hostTarget,
            transport_ok: true,
            shell_ok: false,
            ...identity,
          }),
        );
        return;
      }
      if (timedOut) {
        res.writeHead(504, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: "exec_timeout",
            failure_class: "execution_timeout",
            user_message: `Command exceeded EXECOS_TIMEOUT_MS (${EXECOS_TIMEOUT_MS}).`,
            stdout: cleanOut,
            stderr: cleanErr || `exec_timeout after ${EXECOS_TIMEOUT_MS}ms`,
            exit_code: err?.code ?? 124,
            latency_ms: Date.now() - started,
            target: hostTarget,
            transport_ok: true,
            shell_ok: false,
            ...identity,
          }),
        );
        return;
      }
      // ok = transport/exec completed (not timeout). Command status is exit_code.
      const exitCode = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      const failure_class =
        exitCode === 0 ? null : classifyCommandFailure({ stderr: cleanErr, stdout: cleanOut, exit_code: exitCode });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          stdout: cleanOut,
          stderr: cleanErr,
          exit_code: exitCode,
          latency_ms: Date.now() - started,
          target: hostTarget,
          transport_ok: true,
          shell_ok: true,
          failure_class,
          ...identity,
        }),
      );
    },
  );
}
