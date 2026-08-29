// backend/agentsam/tools/http-dispatch.js
/**
 * Agent Sam: HTTP Network Dispatcher
 * Orchestrates isolated external API requests.
 */
import { assertFetchDomainAllowed, jsonResponse } from '../../../src/core/auth.js';

/**
 * Main dispatcher for External HTTP tasks.
 */
export async function handleHttpDispatch(request, env, ctx, authUser) {
    const method = request.method.toUpperCase();
    const requestUrl = new URL(request.url);
    
    try {
        if (method === 'GET') {
            const urlParam = requestUrl.searchParams.get('url');
            if (!urlParam) return jsonResponse({ error: 'Missing url parameter' }, 400);
            const workspaceId = requestUrl.searchParams.get('workspace_id') || '';
            const gate = await assertFetchDomainAllowed(env, authUser?.id, workspaceId, urlParam);
            if (!gate.ok) return jsonResponse({ error: gate.error }, 403);
            
            const response = await fetch(urlParam, {
                headers: { 'User-Agent': 'AgentSam-Worker/2.0' }
            });
            const data = await response.text();
            return jsonResponse({ status: response.status, data });
        }

        if (method === 'POST') {
            const body = await request.json();
            if (!body.url) return jsonResponse({ error: 'Missing url in body' }, 400);
            const workspaceId = body.workspace_id != null ? String(body.workspace_id) : '';
            const gate = await assertFetchDomainAllowed(env, authUser?.id, workspaceId, body.url);
            if (!gate.ok) return jsonResponse({ error: gate.error }, 403);

            const response = await fetch(body.url, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'User-Agent': 'AgentSam-Worker/2.0'
                },
                body: JSON.stringify(body.payload || {})
            });
            const data = await response.json();
            return jsonResponse({ status: response.status, data });
        }

        return jsonResponse({ error: 'Method not supported by HTTP dispatcher' }, 405);

    } catch (e) {
        return jsonResponse({ error: 'HTTP fetch failed', detail: e.message }, 500);
    }
}
