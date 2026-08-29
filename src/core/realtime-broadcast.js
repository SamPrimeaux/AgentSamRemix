/**
 * Minimal Supabase Realtime Broadcast sender for Cloudflare Workers.
 * Fires a broadcast message on a topic with no DB table required — for
 * push-instead-of-poll signals (e.g. "git status changed for this repo").
 *
 * Modeled on src/api/health/supabaseRest.js (same env vars, same fetch style,
 * no supabase-js dependency in the Worker).
 */

/** @param {any} env */
function supabaseRestBase(env) {
  const raw = env?.SUPABASE_URL;
  if (!raw || !String(raw).trim()) return '';
  return String(raw).replace(/\/$/, '');
}

/** @param {any} env */
function supabaseServiceKey(env) {
  const k = env?.SUPABASE_SERVICE_ROLE_KEY;
  return k && String(k).trim() ? String(k).trim() : '';
}

/**
 * Sends a Realtime broadcast message. Best-effort — never throws; callers
 * should not depend on delivery (poll-based UI fallback stays in place).
 *
 * @param {any} env
 * @param {string} topic     e.g. "git-status:SamPrimeaux/inneranimalmedia"
 * @param {string} event     e.g. "push"
 * @param {Record<string, unknown>} payload
 * @returns {Promise<{ ok: boolean, status: number }>}
 */
export async function broadcastSupabaseRealtime(env, topic, event, payload = {}) {
  const base = supabaseRestBase(env);
  const key = supabaseServiceKey(env);
  const t = String(topic || '').trim();
  const e = String(event || '').trim();
  if (!base || !key || !t || !e) return { ok: false, status: 0 };

  try {
    const res = await fetch(`${base}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ topic: t, event: e, payload }],
      }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.warn('[realtime-broadcast]', t, e, err?.message ?? err);
    return { ok: false, status: 0 };
  }
}

/**
 * Sanitizes a value (e.g. "owner/repo") into a safe Realtime topic segment.
 * @param {string} value
 */
export function topicSafe(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, '-');
}
