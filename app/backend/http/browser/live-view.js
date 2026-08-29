import {
  closeBrowserLiveView,
  getBrowserLiveView,
} from '../../browser/live-view.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Authenticated HTTP adapter for the Think-owned Browser Run live view.
 * Authentication/identity is resolved by the Worker front door and passed in;
 * this route never resolves a second session or browser authority.
 */
export async function handleBrowserLiveViewHttpRequest(request, env, { userId }) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/browser/live-view') return null;

  const agentName = url.searchParams.get('agent_name');

  try {
    if (request.method === 'GET') {
      return json(await getBrowserLiveView(env, { userId, agentName }));
    }
    if (request.method === 'DELETE') {
      return json(await closeBrowserLiveView(env, { userId, agentName }));
    }
    return json({ error: 'method_not_allowed' }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'browser_agent_scope_forbidden') {
      return json({ error: message }, 403);
    }
    if (message === 'browser_user_scope_required') {
      return json({ error: message }, 409);
    }
    console.error('[browser-live-view]', error);
    return json({ error: 'browser_live_view_failed' }, 502);
  }
}
