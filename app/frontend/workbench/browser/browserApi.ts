/** Browser workbench — IAM session / MYBROWSER HTTP helpers (Pass 1 lift). */

import {
  EMPTY_BROWSER_PICKERS,
  type BrowserInvokeResult,
  type BrowserRegistryPickers,
  type BrowserRunSessionResponse,
  type PlaywrightJobSnapshot,
  type TrustCheckResult,
  type TrustScope,
  pickInvokeScreenshotUrl,
  pickScreenshotUrl,
} from './types.ts';

export function browserTrustHeaders(workspaceId?: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  if (ws) headers['x-iam-workspace-id'] = ws;
  return headers;
}

/** Mint a bsess_* lease id — auth stamped on first DO ensure. */
export async function mintBrowserSessionLease(
  workspaceId?: string | null,
): Promise<{ browser_session_id?: string; error?: string }> {
  const r = await fetch('/api/browser/sessions', {
    method: 'POST',
    headers: browserTrustHeaders(workspaceId),
    credentials: 'same-origin',
    body: JSON.stringify({}),
  });
  const data = (await r.json().catch(() => ({}))) as { browser_session_id?: string; error?: string };
  if (!r.ok) return { error: data?.error || r.statusText };
  return data;
}

export async function fetchBrowserRegistryPickers(workspaceId: string): Promise<BrowserRegistryPickers> {
  try {
    const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
    const r = await fetch(`/api/agent/browser/registry-tools${qs}`, { credentials: 'same-origin' });
    const data = (await r.json().catch(() => ({}))) as { pickers?: BrowserRegistryPickers };
    if (data.pickers && typeof data.pickers === 'object') {
      return { ...EMPTY_BROWSER_PICKERS, ...data.pickers };
    }
  } catch {
    /* non-blocking */
  }
  return EMPTY_BROWSER_PICKERS;
}

/** Single browser job fetch — one retry after pending POST (no polling loop). */
export async function fetchBrowserJobOnce(
  jobId: string,
  signal: AbortSignal,
): Promise<PlaywrightJobSnapshot | null> {
  const r = await fetch(`/api/browser/jobs/${encodeURIComponent(jobId)}`, {
    credentials: 'same-origin',
    signal,
  });
  if (!r.ok) return null;
  return (await r.json().catch(() => null)) as PlaywrightJobSnapshot | null;
}

export async function checkTrust(origin: string, workspaceId?: string | null): Promise<TrustCheckResult> {
  try {
    const r = await fetch(`/api/agentsam/browser/trust?origin=${encodeURIComponent(origin)}`, {
      credentials: 'same-origin',
      headers: browserTrustHeaders(workspaceId),
    });
    if (!r.ok) return { trusted: false, trust_scope: null, skip_approval: false };
    const d = (await r.json().catch(() => ({}))) as {
      trusted?: boolean;
      trust_scope?: string | null;
      skip_approval?: boolean;
    };
    const trusted = !!d.trusted;
    const trust_scope = d.trust_scope ?? null;
    const skip_approval =
      d.skip_approval === true ||
      (trusted && String(trust_scope || '').toLowerCase() === 'persistent');
    return { trusted, trust_scope, skip_approval };
  } catch {
    return { trusted: false, trust_scope: null, skip_approval: false };
  }
}

export async function writeTrust(
  origin: string,
  scope: TrustScope,
  workspaceId?: string | null,
): Promise<void> {
  try {
    await fetch('/api/agentsam/browser/trust', {
      method: 'POST',
      headers: browserTrustHeaders(workspaceId),
      credentials: 'same-origin',
      body: JSON.stringify({ origin, trust_scope: scope }),
    });
  } catch {
    /* non-blocking */
  }
}

export async function createBrowserRunLiveSession(
  url: string,
  workspaceId?: string | null,
  browserSessionId?: string | null,
  agentRunId?: string | null,
  cloudflareSessionId?: string | null,
): Promise<BrowserRunSessionResponse> {
  const r = await fetch('/api/browser/session', {
    method: 'POST',
    headers: browserTrustHeaders(workspaceId),
    credentials: 'same-origin',
    body: JSON.stringify({
      url,
      ...(browserSessionId?.trim() ? { browser_session_id: browserSessionId.trim() } : {}),
      ...(cloudflareSessionId ? { session_id: cloudflareSessionId } : {}),
      ...(agentRunId?.trim() ? { agent_run_id: agentRunId.trim() } : {}),
      keep_alive_ms: 600_000,
    }),
  });
  const data = (await r.json().catch(() => ({}))) as BrowserRunSessionResponse;
  if (!r.ok) {
    return { error: data?.error || r.statusText };
  }
  return data;
}

export async function refreshBrowserRunLiveUrl(
  cloudflareSessionId: string,
  browserSessionId?: string | null,
  workspaceId?: string | null,
): Promise<BrowserRunSessionResponse> {
  if (browserSessionId?.trim()) {
    const r = await fetch(
      `/api/browser/live/${encodeURIComponent(browserSessionId.trim())}/live-url`,
      {
        credentials: 'same-origin',
        headers: browserTrustHeaders(workspaceId),
      },
    );
    const data = (await r.json().catch(() => ({}))) as BrowserRunSessionResponse;
    if (!r.ok) return { error: data?.error || r.statusText };
    return data;
  }
  const qs = new URLSearchParams();
  if (browserSessionId?.trim()) qs.set('browser_session_id', browserSessionId.trim());
  const r = await fetch(
    `/api/browser/session/${encodeURIComponent(cloudflareSessionId)}/live-url?${qs.toString()}`,
    {
      credentials: 'same-origin',
      headers: browserTrustHeaders(workspaceId),
    },
  );
  const data = (await r.json().catch(() => ({}))) as BrowserRunSessionResponse;
  if (!r.ok) return { error: data?.error || r.statusText };
  return data;
}

export async function cancelBrowserHumanInput(
  browserSessionId: string,
  workspaceId?: string | null,
): Promise<{ ok?: boolean; error?: string }> {
  const r = await fetch('/api/browser/session/human-cancel', {
    method: 'POST',
    headers: browserTrustHeaders(workspaceId),
    credentials: 'same-origin',
    body: JSON.stringify({ browser_session_id: browserSessionId }),
  });
  return (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
}

export async function fetchAgentLiveSessionSnapshot(
  browserSessionId: string,
  workspaceId?: string | null,
): Promise<BrowserRunSessionResponse & { live_session?: Record<string, unknown> }> {
  const r = await fetch(`/api/browser/live/${encodeURIComponent(browserSessionId)}`, {
    credentials: 'same-origin',
    headers: browserTrustHeaders(workspaceId),
  });
  const data = (await r.json().catch(() => ({}))) as BrowserRunSessionResponse & {
    live_session?: Record<string, unknown>;
  };
  if (!r.ok) return { error: data?.error || r.statusText };
  return data;
}

export async function resumeBrowserHumanInput(
  browserSessionId: string,
  workspaceId?: string | null,
): Promise<{ ok?: boolean; error?: string }> {
  const r = await fetch('/api/browser/session/human-resume', {
    method: 'POST',
    headers: browserTrustHeaders(workspaceId),
    credentials: 'same-origin',
    body: JSON.stringify({ browser_session_id: browserSessionId }),
  });
  return (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
}

export async function closeBrowserSessionLease(
  browserSessionId: string,
  workspaceId?: string | null,
): Promise<void> {
  try {
    await fetch('/api/browser/session/close', {
      method: 'POST',
      headers: browserTrustHeaders(workspaceId),
      credentials: 'same-origin',
      body: JSON.stringify({ browser_session_id: browserSessionId }),
    });
  } catch {
    /* non-blocking */
  }
}

export async function deleteBrowserRunLiveSession(
  cloudflareSessionId: string,
  workspaceId?: string | null,
): Promise<void> {
  try {
    await fetch('/api/browser/session', {
      method: 'DELETE',
      headers: browserTrustHeaders(workspaceId),
      credentials: 'same-origin',
      body: JSON.stringify({
        ...(cloudflareSessionId ? { session_id: cloudflareSessionId } : {}),
      }),
    });
  } catch {
    /* non-blocking */
  }
}

export async function invokeBrowserTool(
  tool_name: string,
  params: Record<string, unknown>,
): Promise<BrowserInvokeResult> {
  const r = await fetch('/api/browser/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ tool_name, params }),
  });
  const data = (await r.json().catch(() => ({}))) as BrowserInvokeResult;
  if (!r.ok) {
    const err = data?.error || r.statusText;
    return { error: err };
  }
  return data;
}

/** @deprecated Use invokeBrowserTool */
export const invokeCdt = invokeBrowserTool;

export function pickNavigatePreview(data: BrowserInvokeResult) {
  const screenshot_url =
    pickScreenshotUrl(data) ||
    (typeof data.result_url === 'string' && data.result_url) ||
    '';
  return { screenshot_url: screenshot_url || null };
}

export { pickInvokeScreenshotUrl, pickScreenshotUrl };
