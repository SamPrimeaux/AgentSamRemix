import { resolveConnectionAuthToken } from '../connection-auth.js';
import { classifyTerminalHttpFailure } from '../failure-class.js';

function normalizeExecHttpUrl(raw) {
  let value = String(raw || '').trim().split('?')[0];
  if (!value) return '';
  if (value.startsWith('wss://')) value = 'https://' + value.slice(6);
  else if (value.startsWith('ws://')) value = 'http://' + value.slice(5);
  else if (!/^https?:\/\//i.test(value)) value = 'https://' + value.replace(/^\/+/, '');
  try { return new URL('/exec', new URL(value).origin).href; } catch { return ''; }
}

function terminalFetchSignal(external, timeoutMs = 120000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([external, timeout]);
  return external;
}

function outputFromData(data) {
  const stdout = typeof data?.stdout === 'string' ? data.stdout : '';
  const stderr = typeof data?.stderr === 'string' ? data.stderr : '';
  return `${stdout}${stderr ? `\n${stderr}` : ''}`.trim() || '(no output)';
}

function hopTimeoutMs(ctx) {
  const n = Number(ctx?.timeout_ms);
  if (!Number.isFinite(n) || n <= 0) return 120000;
  return Math.min(240000, Math.max(10000, Math.floor(n)));
}

export async function executeHttpTerminalTransport(session, plan, ctx) {
  const conn = plan.connection;
  let execBase = String(ctx.execBase || conn?.ws_url || '').trim();
  if (!execBase && plan.target_lane === 'remote') {
    execBase = String(session.env?.TERMINAL_WS_URL || '').trim();
  }
  const execUrl = normalizeExecHttpUrl(execBase);
  if (!execUrl) throw new Error('Terminal /exec endpoint is not configured');

  let dbToken = null;
  if (conn) {
    dbToken = await resolveConnectionAuthToken(session.env, conn, plan.user_id, plan.workspace_id);
  }
  const tokens = Array.from(new Set([
    dbToken,
    String(session.env?.PTY_AUTH_TOKEN || '').trim(),
    String(session.env?.TERMINAL_SECRET || '').trim(),
  ].filter(Boolean)));
  if (!tokens.length) throw new Error('No terminal auth token configured');

  const hopMs = hopTimeoutMs(ctx);
  const payload = {
    ...(ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {}),
    timeout_ms: hopMs,
  };

  let lastStatus = 500;
  for (let i = 0; i < tokens.length; i += 1) {
    let res;
    try {
      res = await fetch(execUrl, {
        method: 'POST',
        headers: { ...ctx.headers, Authorization: `Bearer ${tokens[i]}` },
        body: JSON.stringify(payload),
        signal: terminalFetchSignal(ctx.signal, hopMs),
      });
    } catch (e) {
      const classified = classifyTerminalHttpFailure({
        targetLane: plan.target_lane,
        url: execUrl,
        fetchThrown: e,
      });
      return {
        error: classified.user_message,
        failure_class: classified.failure_class,
      };
    }
    lastStatus = res.status;
    if (res.status === 401 && i < tokens.length - 1) continue;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const bodyError =
        (typeof data?.stderr === 'string' && data.stderr.trim()) ||
        (typeof data?.error === 'string' && data.error.trim()) ||
        '';
      const classified = classifyTerminalHttpFailure({
        status: res.status,
        targetLane: plan.target_lane,
        url: execUrl,
        bodyError,
        failureClass: typeof data?.failure_class === 'string' ? data.failure_class : null,
      });
      return {
        error: classified.user_message,
        failure_class: classified.failure_class,
        host_receipt: data && typeof data === 'object' ? data : null,
      };
    }
    return {
      output: outputFromData(data),
      exit_code: data?.exit_code ?? 0,
      host_receipt: data && typeof data === 'object' ? data : null,
      failure_class: data?.failure_class ?? null,
    };
  }
  return { error: `PTY command unauthorized (${lastStatus})` };
}
