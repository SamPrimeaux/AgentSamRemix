import { jsonResponse } from '../core/responses.js';

function extractEmailAddress(fromValue) {
    const s = typeof fromValue === 'string' ? fromValue.trim() : '';
    if (!s) return '';
    const m = /<([^>]+)>/.exec(s);
    if (m && m[1]) return m[1].trim().toLowerCase();
    return s.toLowerCase();
}

/**
 * Resend Email Integration.
 * Handles transactional emails and notifications.
 */
export async function sendEmail(env, { to, subject, html, text }) {
    const apiKey = (env.RESEND_API_KEY || '').trim();
    if (!apiKey) {
        console.error('[Resend] API key not configured');
        return { success: false, error: 'Resend API key missing' };
    }

    try {
        const from = typeof env.EMAIL_FROM === 'string' && env.EMAIL_FROM.trim() ? env.EMAIL_FROM.trim() : '';
        if (!from) return { success: false, error: 'EMAIL_FROM not configured' };
        const allowSelf =
            String(env.ALLOW_SELF_SEND_EMAILS || '').trim().toLowerCase() === 'true' ||
            String(env.ALLOW_SELF_SEND_EMAILS || '').trim() === '1';
        const fromEmail = extractEmailAddress(from);
        const toList = Array.isArray(to) ? to : [to];
        const normalizedTo = toList.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
        if (!allowSelf && fromEmail && normalizedTo.includes(fromEmail)) {
            return { success: false, error: 'self_send_blocked' };
        }
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ from, to, subject, html, text })
        });

        const data = await response.json();
        return { success: response.ok, data };
    } catch (e) {
        console.error('[Resend] Failed to send email:', e.message);
        return { success: false, error: e.message };
    }
}

/**
 * API Handler for Resend actions.
 */
export async function handleResendApi(request, env) {
    const body = await request.json();
    const result = await sendEmail(env, body);
    return jsonResponse(result, result.success ? 200 : 500);
}
