/**
 * POST /api/contact — public contact proposal (Resend → hey@inneranimalmedia.com).
 */
import { jsonResponse } from '../core/auth.js';

const CONTACT_TO = 'hey@inneranimalmedia.com';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendContactViaResend(env, { from, name, email, message }) {
  const key = env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'no_resend_key' };

  const subject = `Contact proposal — ${name}`;
  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    '',
    message,
    '',
    '— inneranimalmedia.com/contact',
  ].join('\n');
  const html = `
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
    <hr>
    <p>${message.replace(/\n/g, '<br>')}</p>
    <p style="color:#888;font-size:12px">via inneranimalmedia.com/contact</p>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [CONTACT_TO],
      reply_to: email,
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `resend_${res.status}`, detail: t.slice(0, 200) };
  }
  return { ok: true };
}

export async function handleContactApi(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const name = String(body.name || '').trim().slice(0, 200);
  const email = String(body.email || '').trim().slice(0, 320);
  const message = String(body.message || body.brief || '').trim().slice(0, 10000);

  if (!name || !email || !isValidEmail(email)) {
    return jsonResponse({ error: 'Valid name and email required' }, 400);
  }
  if (message.length < 10) {
    return jsonResponse({ error: 'Message must be at least 10 characters' }, 400);
  }

  const from =
    (env.RESEND_FROM && String(env.RESEND_FROM).trim()) ||
    'Inner Animal Media <notifications@inneranimalmedia.com>';

  const sent = await sendContactViaResend(env, { from, name, email, message });
  if (!sent.ok) {
    return jsonResponse({ error: 'Unable to send message', code: sent.error }, 503);
  }

  return jsonResponse({ ok: true, responseTime: '24 hours' });
}
