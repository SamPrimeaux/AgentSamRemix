/**
 * src/core/realtimekit-client.js
 * Cloudflare RealtimeKit REST client (server-side only — uses REALTIMEKIT_API_TOKEN).
 */

const RTK_API = 'https://api.cloudflare.com/client/v4';

export class RealtimeKitConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RealtimeKitConfigError';
  }
}

export class RealtimeKitApiError extends Error {
  /** @param {string} message @param {number} status @param {unknown} [body] */
  constructor(message, status, body = null) {
    super(message);
    this.name = 'RealtimeKitApiError';
    this.status = status;
    this.body = body;
  }
}

/** @param {object} env */
export function resolveRealtimeKitConfig(env) {
  const accountId =
    env?.CLOUDFLARE_ACCOUNT_ID != null ? String(env.CLOUDFLARE_ACCOUNT_ID).trim() : '';
  const appId =
    env?.REALTIMEKIT_APP_ID != null ? String(env.REALTIMEKIT_APP_ID).trim() : '';
  const apiToken =
    env?.REALTIMEKIT_API_TOKEN != null ? String(env.REALTIMEKIT_API_TOKEN).trim() : '';
  if (!accountId || !appId || !apiToken) {
    throw new RealtimeKitConfigError(
      'RealtimeKit is not configured (CLOUDFLARE_ACCOUNT_ID / REALTIMEKIT_APP_ID / REALTIMEKIT_API_TOKEN).',
    );
  }
  return { accountId, appId, apiToken };
}

export function isMeetEngineRealtimeKit(env) {
  const engine = env?.MEET_ENGINE != null ? String(env.MEET_ENGINE).trim().toLowerCase() : '';
  return engine === 'realtimekit';
}

/** Preset names configured on IAM RealtimeKit app. */
export const RTK_PRESETS = {
  host: 'group_call_host',
  participant: 'group_call_participant',
  guest: 'group_call_guest',
};

/** @param {'host'|'participant'|'guest'} role */
export function presetForRole(role) {
  if (role === 'host') return RTK_PRESETS.host;
  if (role === 'guest') return RTK_PRESETS.guest;
  return RTK_PRESETS.participant;
}

function rtkBasePath(accountId, appId) {
  return `/accounts/${accountId}/realtime/kit/${appId}`;
}

/**
 * @param {object} env
 * @param {string} pathSuffix e.g. `/meetings` or `/meetings/{id}/participants`
 * @param {object} [opts]
 */
async function rtkRequest(env, pathSuffix, { method = 'GET', body = null } = {}) {
  const { accountId, appId, apiToken } = resolveRealtimeKitConfig(env);
  const url = `${RTK_API}${rtkBasePath(accountId, appId)}${pathSuffix}`;
  /** @type {RequestInit} */
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
  };
  if (body != null) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok || json?.success === false) {
    throw new RealtimeKitApiError(
      `RealtimeKit ${method} ${pathSuffix} → ${res.status}: ${text.slice(0, 400)}`,
      res.status,
      json,
    );
  }
  return json?.data ?? json;
}

/** @param {object} env @param {{ title?: string }} [opts] */
export async function rtkCreateMeeting(env, opts = {}) {
  const title = opts.title != null ? String(opts.title).trim() : 'IAM Meet';
  return rtkRequest(env, '/meetings', {
    method: 'POST',
    body: { title: title || 'IAM Meet' },
  });
}

/** @param {object} env @param {string} meetingId */
export async function rtkGetMeeting(env, meetingId) {
  return rtkRequest(env, `/meetings/${encodeURIComponent(meetingId)}`);
}

/** @param {object} env @param {string} meetingId */
export async function rtkDeleteMeeting(env, meetingId) {
  return rtkRequest(env, `/meetings/${encodeURIComponent(meetingId)}`, { method: 'DELETE' });
}

/**
 * @param {object} env
 * @param {string} meetingId
 * @param {{ name?: string, presetName: string, customParticipantId: string }} opts
 */
export async function rtkAddParticipant(env, meetingId, opts) {
  const data = await rtkRequest(env, `/meetings/${encodeURIComponent(meetingId)}/participants`, {
    method: 'POST',
    body: {
      name: opts.name ?? 'Participant',
      preset_name: opts.presetName,
      custom_participant_id: opts.customParticipantId,
    },
  });
  return data;
}

/** @param {object} env */
export async function rtkListPresets(env) {
  return rtkRequest(env, '/presets');
}

/** @param {object} env */
export async function rtkListWebhooks(env) {
  return rtkRequest(env, '/webhooks');
}

/**
 * @param {object} env
 * @param {{ name: string, url: string, events: string[], enabled?: boolean }} opts
 */
export async function rtkCreateWebhook(env, opts) {
  return rtkRequest(env, '/webhooks', {
    method: 'POST',
    body: {
      name: opts.name,
      url: opts.url,
      events: opts.events,
      enabled: opts.enabled !== false,
    },
  });
}
