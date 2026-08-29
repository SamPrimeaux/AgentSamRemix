export type BrowserLiveTarget = {
  targetId: string;
  url: string;
  pageUrl?: string;
  title?: string;
  type?: string;
};

export type BrowserLiveView = {
  ok?: boolean;
  active?: boolean;
  agentName?: string;
  sessionId?: string;
  expiresInMs?: number;
  targets?: BrowserLiveTarget[];
  error?: string;
};

function endpoint(agentName?: string | null): string {
  const qs = new URLSearchParams();
  const name = String(agentName || '').trim();
  if (name) qs.set('agent_name', name);
  const suffix = qs.toString();
  return `/api/browser/live-view${suffix ? `?${suffix}` : ''}`;
}

export async function fetchBrowserLiveView(agentName?: string | null): Promise<BrowserLiveView> {
  const response = await fetch(endpoint(agentName), {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({})) as BrowserLiveView;
  if (!response.ok) {
    return { ...data, ok: false, error: data.error || `browser_live_view_${response.status}` };
  }
  return data;
}

export async function closeBrowserLiveView(agentName?: string | null): Promise<BrowserLiveView> {
  const response = await fetch(endpoint(agentName), {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({})) as BrowserLiveView;
  if (!response.ok) {
    return { ...data, ok: false, error: data.error || `browser_live_view_${response.status}` };
  }
  return data;
}
