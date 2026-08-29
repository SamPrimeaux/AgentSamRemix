/**
 * Single VM (GCP / platform_vm) one-shot HTTP exec helper.
 * Pipe law: PTY_SERVICE VPC if bound — no opportunistic hop to public tunnel on VPC failure.
 * If VPC is not configured, public TERMINAL_WS_URL /exec is the sole pipe.
 *
 * ExecOS requires X-IAM-Exec-Identity on VPC /exec (same as interactive path). Missing identity → 403.
 */
import { resolveUserPtyToken } from '../../credentials/user-secrets.js';
import {
  buildExecTransportHeaders,
  resolveTerminalExecIdentity,
} from './privileged-targets.js';
import { resolveConnectionAuthToken } from './connection-auth.js';
import { maybeWrapRemoteHttpExecCommand } from './unix-identity.js';

export function terminalExecHttpUrlFromEnv(env) {
  const raw = (env?.TERMINAL_WS_URL || '').trim().split('?')[0];
  if (!raw) return '';
  try {
    let u = raw;
    if (u.startsWith('wss://')) u = 'https://' + u.slice(6);
    else if (u.startsWith('ws://')) u = 'http://' + u.slice(7);
    else if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
    return new URL('/exec', new URL(u).origin).href;
  } catch (_) {
    return '';
  }
}

/**
 * @param {any} env
 * @param {string} cmd
 * @param {{
 *   cwd?: string,
 *   userId?: string,
 *   workspaceId?: string,
 *   connection?: Record<string, unknown>|null,
 *   execUser?: string|null,
 *   transportExecUser?: string|null,
 *   privilegedTargetId?: string|null,
 *   headers?: Record<string, string>|null,
 * }} [opts]
 */
export async function runTerminalCommandViaHttpExec(env, cmd, opts = {}) {
  const cwd = opts.cwd != null ? String(opts.cwd).trim() : '';
  if (!cwd) {
    return { ok: false, text: 'cwd_required', exitCode: 1, error: 'cwd_required' };
  }

  const tokens = [];
  const pushTok = (t) => {
    const s = String(t || '').trim();
    if (s && !tokens.includes(s)) tokens.push(s);
  };
  const uid = opts.userId != null ? String(opts.userId).trim() : '';
  const wid = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  if (opts.connection && uid) {
    pushTok(await resolveConnectionAuthToken(env, opts.connection, uid, wid));
  } else if (uid) {
    pushTok(await resolveUserPtyToken(env, uid, wid));
  }
  pushTok(env?.PTY_AUTH_TOKEN);
  pushTok(env?.TERMINAL_SECRET);

  let execUser = opts.execUser != null ? String(opts.execUser).trim() : '';
  let transportExecUser =
    opts.transportExecUser != null ? String(opts.transportExecUser).trim() : '';
  let privilegedTargetId =
    opts.privilegedTargetId != null ? String(opts.privilegedTargetId).trim() : '';
  let isTunnelOwner = opts.isTunnelOwner === true;

  // pty-exec historically passed identity only via headers; remote transport dropped them.
  // Resolve from connection when missing so VPC never ships an empty identity bag.
  if ((!execUser || !privilegedTargetId) && opts.connection && env?.DB) {
    const identity = await resolveTerminalExecIdentity(env.DB, opts.connection, null, {
      env,
      userId: uid || null,
      workspaceId: wid || null,
    });
    if (!execUser) execUser = identity.execUser != null ? String(identity.execUser).trim() : '';
    if (!transportExecUser) {
      transportExecUser =
        identity.transportExecUser != null ? String(identity.transportExecUser).trim() : '';
    }
    if (!privilegedTargetId) {
      privilegedTargetId =
        identity.privilegedTargetId != null ? String(identity.privilegedTargetId).trim() : '';
    }
    if (identity.isTunnelOwner === true) isTunnelOwner = true;
  }

  const identityHeaders = buildExecTransportHeaders({
    execUser: execUser || null,
    transportExecUser: transportExecUser || null,
    privilegedTargetId: privilegedTargetId || null,
    userId: uid || opts.userId,
    isTunnelOwner,
  });
  const callerHeaders =
    opts.headers && typeof opts.headers === 'object' && !Array.isArray(opts.headers)
      ? opts.headers
      : {};
  const execHeaders = { ...callerHeaders, ...identityHeaders };
  if (identityHeaders['X-IAM-Operator-Cwd'] === '1') {
    execHeaders['X-IAM-Operator-Cwd'] = '1';
  }
  const runCmd = maybeWrapRemoteHttpExecCommand(cmd, execUser, transportExecUser);
  const execBody = { command: runCmd, cwd };

  if (env?.PTY_SERVICE) {
    if (!execHeaders['X-IAM-Exec-Identity']) {
      return {
        ok: false,
        text: 'exec_identity_unresolved',
        exitCode: 1,
        error: 'exec_identity_unresolved',
      };
    }
    try {
      // Prefer connection / user PTY token on VPC too — dock WS auth and agent /exec share the same gate.
      const vpcHeaders = { ...execHeaders };
      if (tokens[0] && !vpcHeaders.Authorization) {
        vpcHeaders.Authorization = 'Bearer ' + tokens[0];
      }
      const res = await env.PTY_SERVICE.fetch(
        new Request('http://localhost:3099/exec', {
          method: 'POST',
          headers: vpcHeaders,
          body: JSON.stringify(execBody),
        }),
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const detail =
          data && typeof data === 'object'
            ? String(data.stderr || data.error || data.user_message || '').trim()
            : '';
        const code = `vpc_exec_failed_${res.status}`;
        return {
          ok: false,
          text: detail ? `${code}: ${detail.slice(0, 400)}` : code,
          exitCode: 1,
          error: code,
          detail: detail || null,
        };
      }
      if (!data || typeof data !== 'object') {
        return { ok: false, text: 'vpc_exec_invalid_json', exitCode: 1, error: 'vpc_exec_invalid_json' };
      }
      const stdout = typeof data.stdout === 'string' ? data.stdout : '';
      const stderr = typeof data.stderr === 'string' ? data.stderr : '';
      const text = ((stdout || '') + (stderr ? '\nSTDERR: ' + stderr : '')).trim();
      return { ok: true, text, exitCode: data.exit_code ?? 0, transport: 'vpc' };
    } catch (e) {
      return {
        ok: false,
        text: e?.message || 'vpc_exec_failed',
        exitCode: 1,
        error: 'vpc_exec_failed',
      };
    }
  }

  if (!tokens.length) return { ok: false, error: 'no_terminal_auth_token' };
  const execUrl = terminalExecHttpUrlFromEnv(env);
  if (!execUrl) return { ok: false, error: 'terminal_exec_url_missing' };

  try {
    for (let i = 0; i < tokens.length; i++) {
      const bearer = tokens[i];
      const res = await fetch(execUrl, {
        method: 'POST',
        headers: { ...execHeaders, Authorization: 'Bearer ' + bearer },
        body: JSON.stringify(execBody),
      });
      if (res.status === 401 && i < tokens.length - 1) continue;
      if (!res.ok) return { ok: false, error: `public_exec_failed_${res.status}` };

      const data = await res.json().catch(() => null);
      if (!data || typeof data !== 'object') return { ok: false, error: 'public_exec_invalid_json' };
      const stdout = typeof data.stdout === 'string' ? data.stdout : '';
      const stderr = typeof data.stderr === 'string' ? data.stderr : '';
      const text = ((stdout || '') + (stderr ? '\nSTDERR: ' + stderr : '')).trim();
      return { ok: true, text, exitCode: data.exit_code ?? 0, transport: 'public_tunnel' };
    }
    return { ok: false, error: 'public_exec_unauthorized' };
  } catch (e) {
    return { ok: false, error: e?.message || 'public_exec_failed' };
  }
}
