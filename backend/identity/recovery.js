/**
 * Identity recovery spine — structured errors, Resend email codes, backup-code paths,
 * D1 audit trail for customer-care follow-up.
 */
import { logAuthEvent } from '../../backend/identity/auth-events.js';
import { sendResendEmail, resendFromAddress } from '../services/email/resend.js';
import { resolveAuthUserByEmail } from '../../backend/identity/users/index.js';

const RECOVERY_CODE_TTL_SEC = 900;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_REQUESTS_PER_HOUR = 6;

/** @type {Record<string, { title: string, message: string, channels: string[] }>} */
export const AUTH_RECOVERY_CATALOG = {
  invalid_grant: {
    title: 'Session expired',
    message: 'Your MCP connection expired. Reconnect the app or sign in with a recovery option.',
    channels: ['mcp_reconnect', 'backup_code', 'email_code'],
  },
  invalid_grant_expired: {
    title: 'Refresh token expired',
    message: 'Your long-lived MCP authorization ended (~90 days). Reconnect ChatGPT, Claude, or Cursor once.',
    channels: ['mcp_reconnect', 'backup_code', 'email_code'],
  },
  invalid_workspace: {
    title: 'Workspace not ready',
    message: 'Your account exists but workspace access is not provisioned yet.',
    channels: ['email_code', 'backup_code', 'support'],
  },
  invalid_credentials: {
    title: 'Sign-in failed',
    message: 'Email or password did not match. Try again or use a recovery channel.',
    channels: ['password_reset', 'backup_code', 'email_code'],
  },
  oauth_identity_blocked: {
    title: 'Identity verification needed',
    message: 'We could not verify your login with the external provider. Use email recovery or backup codes.',
    channels: ['email_code', 'backup_code', 'mcp_reconnect'],
  },
  default: {
    title: 'Authentication issue',
    message: 'Something blocked sign-in. Use a recovery option below or contact support.',
    channels: ['email_code', 'backup_code', 'password_reset'],
  },
};

const CHANNEL_ENDPOINTS = {
  backup_code: '/api/auth/backup-code',
  email_code: '/api/auth/recovery/verify',
  email_code_request: '/api/auth/recovery/request',
  password_reset: '/api/auth/password-reset/request',
  mcp_reconnect: 'https://inneranimalmedia.com/api/mcp/oauth/authorize',
  support: 'mailto:info@inneranimals.com',
};

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function recoveryId() {
  return `ira_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

async function sha256hex(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomSixDigitCode() {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return String(100000 + (bytes[0] % 900000));
}

/**
 * @param {string} errorCode
 * @param {Record<string, unknown>} [extra]
 */
export function buildAuthRecoveryPayload(errorCode, extra = {}) {
  const key = trim(errorCode).toLowerCase() || 'default';
  const entry = AUTH_RECOVERY_CATALOG[key] || AUTH_RECOVERY_CATALOG.default;
  const channels = entry.channels.map((c) => ({
    channel: c,
    endpoint: CHANNEL_ENDPOINTS[c] || null,
  }));
  return {
    recovery: {
      code: key,
      title: entry.title,
      message: entry.message,
      channels,
      ...extra,
    },
  };
}

/**
 * @param {any} env
 * @param {object} opts
 */
export async function logIdentityRecoveryAttempt(env, opts) {
  if (!env?.DB) return null;
  const id = trim(opts.id) || recoveryId();
  const email = trim(opts.email).toLowerCase();
  if (!email) return null;

  try {
    await env.DB.prepare(
      `INSERT INTO identity_recovery_attempts
         (id, user_id, email, channel, purpose, code_hash, status, attempt_count, expires_at, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
    )
      .bind(
        id,
        trim(opts.userId) || null,
        email,
        trim(opts.channel) || 'unknown',
        trim(opts.purpose) || 'login',
        trim(opts.codeHash) || null,
        trim(opts.status) || 'pending',
        Number(opts.attemptCount || 0),
        opts.expiresAt != null ? Number(opts.expiresAt) : null,
        JSON.stringify(opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {}),
      )
      .run();
  } catch (e) {
    console.warn('[identity_recovery] audit insert failed:', e?.message ?? e);
    return null;
  }

  await logAuthEvent(env, {
    request: opts.request,
    eventType: 'identity_recovery_attempt',
    userId: opts.userId ?? null,
    status: opts.status || 'pending',
    metadata: {
      channel: opts.channel,
      purpose: opts.purpose,
      error_code: opts.errorCode ?? null,
      recovery_id: id,
    },
  }).catch(() => {});

  return id;
}

/**
 * POST /api/auth/recovery/request — send 6-digit Resend code (login / MCP recovery).
 * @param {any} env
 * @param {Request} request
 * @param {{ email: string, purpose?: string }} body
 */
export async function requestIdentityRecoveryEmail(env, request, body) {
  const email = trim(body?.email).toLowerCase();
  const purpose = trim(body?.purpose) || 'login';
  if (!email || !email.includes('@')) {
    return { ok: false, status: 400, body: { error: 'valid_email_required', ...buildAuthRecoveryPayload('default') } };
  }
  if (!env?.DB) {
    return { ok: false, status: 503, body: { error: 'database_not_configured' } };
  }

  const hourAgo = Math.floor(Date.now() / 1000) - 3600;
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM identity_recovery_attempts
      WHERE LOWER(email) = ? AND channel = 'email_code' AND created_at >= ?`,
  )
    .bind(email, hourAgo)
    .first()
    .catch(() => null);
  if (Number(recent?.c || 0) >= MAX_REQUESTS_PER_HOUR) {
    return {
      ok: false,
      status: 429,
      body: {
        error: 'recovery_rate_limited',
        retry_after_sec: 3600,
        ...buildAuthRecoveryPayload('default', { hint: 'Try backup codes or wait before requesting another email.' }),
      },
    };
  }

  const user = await resolveAuthUserByEmail(env, email);

  if (!user?.id) {
    return { ok: true, status: 200, body: { ok: true, message: 'If an account exists, a recovery code was sent.' } };
  }

  const code = randomSixDigitCode();
  const codeHash = await sha256hex(code);
  const expiresAt = Math.floor(Date.now() / 1000) + RECOVERY_CODE_TTL_SEC;
  const recoveryIdValue = await logIdentityRecoveryAttempt(env, {
    request,
    userId: user.id,
    email,
    channel: 'email_code',
    purpose,
    codeHash,
    status: 'pending',
    expiresAt,
    metadata: { delivery: 'resend' },
  });
  if (!recoveryIdValue) {
    return { ok: false, status: 503, body: { error: 'recovery_persistence_unavailable' } };
  }

  const from = resendFromAddress(env);
  if (!env.RESEND_API_KEY || !from) {
    return {
      ok: false,
      status: 503,
      body: {
        error: 'email_not_configured',
        ...buildAuthRecoveryPayload('default', { channels_available: ['backup_code'] }),
      },
    };
  }

  const name = trim(user.name) || 'there';
  const sent = await sendResendEmail(env, {
    to: user.email,
    subject: 'Your Inner Animal Media recovery code',
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;padding:24px">
      <p>Hi ${name},</p>
      <p>Your recovery code:</p>
      <p style="font-size:24px;font-weight:700;letter-spacing:6px">${code}</p>
      <p>Expires in 15 minutes. Use it at Settings → Security or POST /api/auth/recovery/verify.</p>
      <p style="font-size:13px;color:#64748b">If you did not request this, ignore this email.</p>
    </div>`,
    tags: [{ name: 'purpose', value: purpose }],
  });

  if (sent.error) {
    await logIdentityRecoveryAttempt(env, {
      request,
      id: recoveryIdValue || recoveryId(),
      userId: user.id,
      email,
      channel: 'email_code',
      purpose,
      status: 'failed',
      metadata: { resend_error: sent.error },
    });
    return {
      ok: false,
      status: 503,
      body: {
        error: 'email_delivery_failed',
        ...buildAuthRecoveryPayload('default', { fallback: 'backup_code' }),
      },
    };
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      message: 'Recovery code sent when an account exists for this email.',
      expires_in: RECOVERY_CODE_TTL_SEC,
      recovery_id: recoveryIdValue,
    },
  };
}

/**
 * @param {any} env
 * @param {Request} request
 * @param {{ email: string, code: string, purpose?: string, create_session?: boolean }} body
 */
export async function verifyIdentityRecoveryCode(env, request, body) {
  const email = trim(body?.email).toLowerCase();
  const code = trim(body?.code).replace(/\s/g, '');
  const purpose = trim(body?.purpose) || 'login';
  if (!email || !code) {
    return {
      ok: false,
      status: 400,
      body: { error: 'email_and_code_required', ...buildAuthRecoveryPayload('invalid_credentials') },
    };
  }
  if (!env?.DB) {
    return { ok: false, status: 503, body: { error: 'database_not_configured' } };
  }

  const user = await resolveAuthUserByEmail(env, email);
  if (!user?.id) {
    return {
      ok: false,
      status: 401,
      body: { error: 'invalid_recovery_code', ...buildAuthRecoveryPayload('invalid_credentials') },
    };
  }

  const codeHash = await sha256hex(code);
  const row = await env.DB.prepare(
    `SELECT id, attempt_count, expires_at, status
       FROM identity_recovery_attempts
      WHERE LOWER(email) = ?
        AND purpose = ?
        AND channel = 'email_code'
        AND code_hash = ?
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1`,
  )
    .bind(email, purpose, codeHash)
    .first()
    .catch(() => null);

  const now = Math.floor(Date.now() / 1000);
  if (!row?.id || Number(row.expires_at || 0) <= now) {
    await logIdentityRecoveryAttempt(env, {
      request,
      userId: user.id,
      email,
      channel: 'email_code',
      purpose,
      status: 'failed',
      metadata: { reason: 'expired_or_missing' },
    });
    return {
      ok: false,
      status: 401,
      body: { error: 'invalid_or_expired_code', ...buildAuthRecoveryPayload('invalid_credentials') },
    };
  }

  const attempts = Number(row.attempt_count || 0) + 1;
  if (attempts > MAX_VERIFY_ATTEMPTS) {
    await env.DB.prepare(
      `UPDATE identity_recovery_attempts SET status = 'failed', attempt_count = ?, updated_at = unixepoch() WHERE id = ?`,
    )
      .bind(attempts, row.id)
      .run()
      .catch(() => {});
    return {
      ok: false,
      status: 429,
      body: { error: 'too_many_attempts', ...buildAuthRecoveryPayload('invalid_credentials') },
    };
  }

  const consumed = await env.DB.prepare(
    `UPDATE identity_recovery_attempts
        SET status = 'verified', attempt_count = ?, updated_at = unixepoch()
      WHERE id = ? AND status = 'pending' AND expires_at > ?`,
  )
    .bind(attempts, row.id, now)
    .catch(() => null);
  if (!consumed?.meta?.changes) {
    return {
      ok: false,
      status: 401,
      body: { error: 'invalid_or_expired_code', ...buildAuthRecoveryPayload('invalid_credentials') },
    };
  }

  await logAuthEvent(env, {
    request,
    eventType: 'identity_recovery_verified',
    userId: user.id,
    status: 'ok',
    metadata: { channel: 'email_code', purpose, recovery_id: row.id },
  }).catch(() => {});

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      verified: true,
      user_id: user.id,
      email: user.email,
      purpose,
      create_session: body?.create_session === true,
      ...buildAuthRecoveryPayload('default', { next: body?.create_session ? 'session_mint' : 'verified_only' }),
    },
    user,
  };
}

/**
 * Enrich OAuth/token failure metadata for auth_event_log + API responses.
 * @param {string} errorCode
 * @param {Record<string, unknown>} [extra]
 */
export function mcpOAuthRecoveryExtras(errorCode, extra = {}) {
  return buildAuthRecoveryPayload(errorCode, extra).recovery
    ? { recovery: buildAuthRecoveryPayload(errorCode, extra).recovery }
    : {};
}
