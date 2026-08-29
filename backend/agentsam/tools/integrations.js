/**
 * Implements 13 tools for third-party service connectivity.
 */
import { sendPlatformEmail as sendEmail } from '../../../src/lib/email.js';

async function invokeExternalApi(env, endpoint, method = 'POST', body = null) {
    const origin = env.IAM_ORIGIN || 'https://inneranimalmedia.com';
    try {
        const res = await fetch(`${origin}${endpoint}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : null,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'External Integration Failed');
        return data;
    } catch (e) {
        return { error: `Integration Error: ${e.message}` };
    }
}

export const handlers = {
    // ── Resend (Email Intelligence) ───────────────────────────────────────
    async resend_send_email(params, env) { return await sendEmail(env, params); },
    async resend_send_and_wait(params, env, ctx, session) { 
        const { to, subject, html, text, conversationId } = params;
        if (!to || !conversationId) {
            throw new Error("Missing recipient or conversationId for resend_send_and_wait");
        }

        // 1. Send the email
        const res = await sendEmail(env, params);

        // 2. Register the hook
        if (res.success) {
            await env.DB.prepare(
                `INSERT INTO agentsam_hook (id, user_id, provider, external_id, trigger, target_id, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                crypto.randomUUID(),
                session?.user_id || 'system',
                'resend',
                to, // Using recipient email as external_id for matching
                'email_reply',
                conversationId,
                1
            ).run();
        }

        return { 
            status: res.success ? 'sent_and_hooked' : 'failed',
            to,
            conversationId,
            result: res
        };
    },
    async resend_send_broadcast(params, env) { return await invokeExternalApi(env, '/api/email/broadcast', 'POST', params); },
    async resend_list_domains(params, env) { return await invokeExternalApi(env, '/api/email/domains', 'GET'); },
    async resend_create_api_key(params, env) { return await invokeExternalApi(env, '/api/email/keys', 'POST', params); },

    // ── Cloudflare Images ─────────────────────────────────────────────────
    async cf_images_upload(params, env) { return await invokeExternalApi(env, '/api/images/cf/upload', 'POST', params); },
    async cf_images_list(params, env) { return await invokeExternalApi(env, '/api/images/cf/list', 'GET'); },
    async cf_images_delete(params, env) { return await invokeExternalApi(env, '/api/images/cf/delete', 'POST', params); },

    // ── Google Drive ──────────────────────────────────────────────────────
    async gdrive_list(params, env) { return await invokeExternalApi(env, '/api/gdrive/list', 'POST', params); },
    async gdrive_fetch(params, env) { return await invokeExternalApi(env, '/api/gdrive/fetch', 'POST', params); },

    // ── CloudConvert (Transformation) ─────────────────────────────────────
    async cloudconvert_create_job(params, env) { return await invokeExternalApi(env, '/api/convert/create', 'POST', params); },
    async cloudconvert_get_job(params, env) { return await invokeExternalApi(env, `/api/convert/status?id=${params.id}`, 'GET'); },
};
