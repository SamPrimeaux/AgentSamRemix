/**
 * Per-user notification preferences + recipient resolution.
 * Stored in user_settings.settings_json.notify (existing table — no new schema).
 * Recipient is always the user's profile email from D1 — never a platform env fallback.
 */
// guard-dup-allow: backend identity peel; src/core/notification-prefs.js remains for notifySam and keys-security until those modules peel.

const NOTIFY_EVENT_KEYS = [
  'deploy_success',
  'deploy_failure',
  'agent_error',
  'spend_threshold',
  'benchmark_fail',
];

const NOTIFY_CHANNEL_KEYS = ['email', 'push', 'imessage'];

/** Flat keys used by the settings UI (notify.<event> and notify.channel.<name>). */
export const NOTIFY_FLAT_KEYS = NOTIFY_EVENT_KEYS.map((k) => `notify.${k}`);
export const NOTIFY_CHANNEL_FLAT_KEYS = NOTIFY_CHANNEL_KEYS.map((k) => `notify.channel.${k}`);

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseJson(raw, fallback = {}) {
  if (raw == null || raw === '') return { ...fallback };
  if (typeof raw === 'object' && raw !== null) return { ...raw };
  try {
    const o = JSON.parse(String(raw));
    return typeof o === 'object' && o !== null ? { ...o } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function defaultEvents() {
  /** @type {Record<string, boolean>} */
  const events = {};
  for (const k of NOTIFY_EVENT_KEYS) events[k] = false;
  return events;
}

function defaultChannels() {
  return {
    email: true,
    push: false,
    imessage: false,
  };
}

/**
 * Normalize settings_json.notify bag.
 * @param {unknown} raw
 */
export function normalizeNotifyBag(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const eventsIn = base.events && typeof base.events === 'object' ? base.events : {};
  const events = defaultEvents();
  for (const k of NOTIFY_EVENT_KEYS) {
    if (eventsIn[k] === true || eventsIn[k] === 1 || eventsIn[k] === 'true') events[k] = true;
    else if (eventsIn[k] === false || eventsIn[k] === 0 || eventsIn[k] === 'false') events[k] = false;
  }
  const channelsIn = base.channels && typeof base.channels === 'object' ? base.channels : {};
  const channels = defaultChannels();
  for (const k of NOTIFY_CHANNEL_KEYS) {
    if (channelsIn[k] === true || channelsIn[k] === 1 || channelsIn[k] === 'true') channels[k] = true;
    else if (channelsIn[k] === false || channelsIn[k] === 0 || channelsIn[k] === 'false') channels[k] = false;
  }
  return {
    events,
    channels,
    updated_at: Number.isFinite(Number(base.updated_at)) ? Number(base.updated_at) : null,
  };
}

/**
 * Flat map for dashboard toggles.
 * @param {ReturnType<typeof normalizeNotifyBag>} bag
 */
export function notifyBagToFlat(bag) {
  /** @type {Record<string, string>} */
  const flat = {};
  for (const k of NOTIFY_EVENT_KEYS) {
    flat[`notify.${k}`] = bag.events[k] ? 'true' : 'false';
  }
  for (const k of NOTIFY_CHANNEL_KEYS) {
    flat[`notify.channel.${k}`] = bag.channels[k] ? 'true' : 'false';
  }
  return flat;
}

/**
 * Merge flat UI updates into a notify bag.
 * @param {ReturnType<typeof normalizeNotifyBag>} current
 * @param {Array<{ setting_key: string, setting_value: string }>|Record<string, string>} updates
 */
export function applyFlatNotifyUpdates(current, updates) {
  const next = normalizeNotifyBag(current);
  const list = Array.isArray(updates)
    ? updates
    : Object.entries(updates || {}).map(([setting_key, setting_value]) => ({
        setting_key,
        setting_value: String(setting_value),
      }));
  for (const u of list) {
    const key = trim(u.setting_key);
    const val = u.setting_value != null ? String(u.setting_value) : '';
    if (key.startsWith('notify.channel.')) {
      const channel = key.slice('notify.channel.'.length);
      if (!NOTIFY_CHANNEL_KEYS.includes(channel)) {
        throw new Error(`unknown_notify_channel:${channel}`);
      }
      next.channels[channel] = val === 'true' || val === '1';
      continue;
    }
    if (!key.startsWith('notify.')) continue;
    const eventKey = key.slice('notify.'.length);
    if (!NOTIFY_EVENT_KEYS.includes(eventKey)) {
      throw new Error(`unknown_notify_pref:${eventKey}`);
    }
    next.events[eventKey] = val === 'true' || val === '1';
  }
  next.updated_at = Math.floor(Date.now() / 1000);
  return next;
}

/**
 * @param {any} env
 * @param {string} userId
 */
export async function readNotificationPrefs(env, userId) {
  const uid = trim(userId);
  if (!env?.DB || !uid) throw new Error('user_id_required');
  const row = await env.DB.prepare(
    `SELECT settings_json FROM user_settings WHERE user_id = ? LIMIT 1`,
  )
    .bind(uid)
    .first();
  const prefs = parseJson(row?.settings_json);
  return normalizeNotifyBag(prefs.notify);
}

/**
 * Persist notify bag into user_settings.settings_json.notify.
 * @param {any} env
 * @param {string} userId
 * @param {ReturnType<typeof normalizeNotifyBag>} bag
 */
export async function writeNotificationPrefs(env, userId, bag) {
  const uid = trim(userId);
  if (!env?.DB || !uid) throw new Error('user_id_required');
  const normalized = normalizeNotifyBag(bag);
  normalized.updated_at = Math.floor(Date.now() / 1000);

  const row = await env.DB.prepare(
    `SELECT settings_json FROM user_settings WHERE user_id = ? LIMIT 1`,
  )
    .bind(uid)
    .first();
  const prefs = parseJson(row?.settings_json);
  prefs.notify = {
    events: normalized.events,
    channels: normalized.channels,
    updated_at: normalized.updated_at,
  };
  const next = JSON.stringify(prefs);
  const now = normalized.updated_at;

  const upd = await env.DB.prepare(
    `UPDATE user_settings SET settings_json = ?, updated_at = ? WHERE user_id = ?`,
  )
    .bind(next, now, uid)
    .run();

  if (!upd?.meta?.changes) {
    await env.DB.prepare(
      `INSERT INTO user_settings (id, user_id, settings_json, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(`us_${uid.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40)}`, uid, next, now)
      .run();
  }

  return normalized;
}

/**
 * Resolve the notification inbox for a user from D1 only.
 * Fail loud if the user has no usable email — never invent or fall back to env.
 *
 * @param {any} env
 * @param {string} userId
 * @returns {Promise<{ email: string, source: 'user_settings.primary_email'|'auth_users.email' }>}
 */
export async function resolveNotificationEmail(env, userId) {
  const uid = trim(userId);
  if (!env?.DB || !uid) throw new Error('user_id_required');

  const row = await env.DB.prepare(
    `SELECT LOWER(TRIM(s.primary_email)) AS primary_email,
            LOWER(TRIM(u.email)) AS auth_email
     FROM auth_users u
     LEFT JOIN user_settings s ON s.user_id = u.id
     WHERE u.id = ?
     LIMIT 1`,
  )
    .bind(uid)
    .first();

  if (!row) throw new Error('auth_user_not_found');

  const primary = trim(row.primary_email);
  if (primary.includes('@')) {
    return { email: primary, source: 'user_settings.primary_email' };
  }
  const authEmail = trim(row.auth_email);
  if (authEmail.includes('@')) {
    return { email: authEmail, source: 'auth_users.email' };
  }
  throw new Error('notification_email_required');
}

/**
 * @param {ReturnType<typeof normalizeNotifyBag>} bag
 * @param {string} eventKey — e.g. deploy_failure
 */
export function isNotifyEventEnabled(bag, eventKey) {
  const k = trim(eventKey);
  if (!NOTIFY_EVENT_KEYS.includes(k)) return false;
  return bag.events[k] === true;
}
