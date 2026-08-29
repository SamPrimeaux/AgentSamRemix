// backend/agentsam/tools/proxy-dispatch.js
/**
 * Agent Sam: Proxy & Protocol Dispatcher
 * Orchestrates protocol translation and infrastructure bridging.
 */
import { jsonResponse } from '../../../src/core/auth.js';

/**
 * Main dispatcher for Infrastructure Proxy tasks.
 */
export async function handleProxyDispatch(request, env, ctx, authUser) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    // 1. Generic Proxy Forwarding (SOTA)
    // Map /api/agentsam/proxy/target/... to actual target
    const target = url.searchParams.get('target');
    if (!target) return jsonResponse({ error: 'Target destination required' }, 400);

    try {
        const response = await fetch(target, {
            method: request.method,
            headers: request.headers,
            body: request.method !== 'GET' ? await request.clone().blob() : undefined
        });

        return new Response(response.body, {
            status: response.status,
            headers: response.headers
        });

    } catch (e) {
        return jsonResponse({ error: 'Proxy forwarding failed', detail: e.message }, 500);
    }
}
