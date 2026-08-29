/**
 * Tool: Platform (Admin / Quality / A11y)
 * Implements 4 tools for system oversight and accessibility auditing.
 */

async function invokePlatformOp(env, endpoint, method = 'POST', body = null) {
    const origin = env.IAM_ORIGIN || 'https://inneranimalmedia.com';
    try {
        const res = await fetch(`${origin}${endpoint}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : null,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Platform Operation Failed');
        return data;
    } catch (e) {
        return { error: `Platform Error: ${e.message}` };
    }
}

export const handlers = {
    // ── Platform Oversight ────────────────────────────────────────────────
    async platform_info(params, env) { return await invokePlatformOp(env, '/api/platform/info', 'GET'); },
    async list_clients(params, env) { return await invokePlatformOp(env, '/api/platform/clients', 'GET'); },

    // ── Accessibility & Quality ──────────────────────────────────────────
    async a11y_audit_webpage(params, env) { return await invokePlatformOp(env, '/api/platform/a11y/audit', 'POST', params); },
    async a11y_get_summary(params, env) { return await invokePlatformOp(env, '/api/platform/a11y/summary', 'POST', params); },
};
