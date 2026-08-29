import { isD1OverloadError, withD1Retry } from '../../database/d1/retry.js';
import {
  loadAgentSamUserPolicy,
  readAuthRev,
  loadMembershipCached,
  loadAgentSamUserPolicyCached,
} from '../permissions/index.js';
import { loadMembership } from '../workspace/membership.js';
import {
  AUTH_SESSION_TTL_SECONDS,
  MAX_AGENT_SESSION_TTL_SECONDS,
  MIN_AGENT_SESSION_TTL_SECONDS,
  DEFAULT_AGENT_SESSION_TTL_SECONDS,
} from '../../auth/constants.js';
import {
  markSessionRevokedInKv,
  resolveSessionFromCookieValue,
  readAuthRevFromCache,
  syncAuthRevCache,
} from '../../auth/session-tokens.js';
import { loadFeatureFlagsCached } from '../permissions/feature-flags.js';
import { formatSessionCookieHeader } from '../../auth/session-cookies.js';
import { persistWorkspaceSelection } from '../workspace/request-resolve.js';
import {
  authSessionsColumns,
  sessionFieldsFromAuthUser,
  computeAuthCapabilities,
  trimSessionField,
} from './fields.js';
import { writeIamSessionToKv } from './kv.js';
import { mintBrowserSessionToken } from './mint.js';
import { resolveWorkspaceIdAtLogin } from './workspace.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function prepareInsertAuthSessionRow(env, row) {
  const email = String(row.email || '').trim();
  if (!email) throw new Error('auth_sessions.email required');

  const cols = await authSessionsColumns(env);
  const colNames = [
    'id', 'user_id', 'tenant_id', 'person_uuid', 'email', 'provider',
    'provider_subject', 'display_name', 'avatar_url', 'workspace_id',
    'expires_at', 'created_at', 'ip_address', 'user_agent', 'last_active_at',
  ];
  const valueExprs = [
    '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?',
    "datetime('now')", '?', '?', '?',
  ];
  const binds = [
    row.sessionId, row.userId, row.tenantId ?? null, row.personUuid ?? null,
    email, row.provider || 'email', row.providerSubject ?? null,
    row.displayName ?? null, row.avatarUrl ?? null, row.workspaceId ?? null,
    row.expiresAtIso, row.ip || '', row.ua || '', row.lastActiveAtMs ?? Date.now(),
  ];

  if (cols.has('supabase_user_id')) {
    colNames.splice(4, 0, 'supabase_user_id');
    valueExprs.splice(4, 0, '?');
    binds.splice(4, 0, row.supabaseUserId ?? null);
  }

  return env.DB.prepare(
    `INSERT INTO auth_sessions (${colNames.join(', ')}) VALUES (${valueExprs.join(', ')})`,
  ).bind(...binds);
}

export async function establishIamSession(
  request,
  env,
  userId,
  bodyObj = { ok: true },
  sessionProvider = 'iam',
) {
  if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 500);
  const sessionId = crypto.randomUUID();
  const expiresTs = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const expiresAtIso = new Date(expiresTs).toISOString();
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = request.headers.get('user-agent') || '';

  let userRow = null;
  try {
    userRow = await env.DB.prepare('SELECT * FROM auth_users WHERE id = ? LIMIT 1').bind(userId).first();
  } catch {}
  if (!userRow?.email) return jsonResponse({ error: 'User not found' }, 404);

  const sessionFields = sessionFieldsFromAuthUser(userRow, sessionProvider);
  const resolvedWorkspaceId = await resolveWorkspaceIdAtLogin(env, userRow, {});
  sessionFields.workspaceId = resolvedWorkspaceId ?? sessionFields.workspaceId;
  const insertStmt = await prepareInsertAuthSessionRow(env, {
    sessionId, userId, tenantId: sessionFields.tenantId, personUuid: sessionFields.personUuid,
    supabaseUserId: sessionFields.supabaseUserId, email: sessionFields.email,
    provider: sessionFields.provider, providerSubject: sessionFields.providerSubject,
    displayName: sessionFields.displayName, avatarUrl: sessionFields.avatarUrl,
    workspaceId: sessionFields.workspaceId, ip, ua, expiresAtIso,
  });
  await withD1Retry(() => insertStmt.run());

  if (sessionFields.workspaceId) {
    await persistWorkspaceSelection(env, {
      userId, workspaceId: sessionFields.workspaceId, tenantId: sessionFields.tenantId,
    });
  }
  await writeIamSessionToKv(env, sessionId, userId, sessionFields.tenantId, expiresAtIso, {
    workspaceId: sessionFields.workspaceId, personUuid: sessionFields.personUuid,
    supabaseUserId: sessionFields.supabaseUserId, email: sessionFields.email,
    provider: sessionFields.provider, displayName: sessionFields.displayName,
    avatarUrl: sessionFields.avatarUrl, providerSubject: sessionFields.providerSubject,
    lastActiveAt: Date.now(),
  });

  try {
    await pruneExpiredAuthSessions(env, { userId, limit: 80 });
    await replaceLiveSessionsForSameClient(env, {
      userId, keepId: sessionId, provider: sessionProvider, userAgent: ua,
    });
  } catch (error) {
    console.warn('[establishIamSession] session replace/prune', error?.message ?? error);
  }

  const membership = sessionFields.workspaceId
    ? await loadMembership(env, userId, sessionFields.workspaceId)
    : null;
  const policy = await loadAgentSamUserPolicy(env, userId, sessionFields.workspaceId || '');
  const authRev = await readAuthRev(env, userId);
  const capabilities = computeAuthCapabilities(membership, policy);
  const sessionToken = await mintBrowserSessionToken(env, {
    sessionId, userId, tenantId: sessionFields.tenantId,
    workspaceId: sessionFields.workspaceId, email: sessionFields.email,
    personUuid: sessionFields.personUuid, displayName: sessionFields.displayName,
    authRev, capabilities,
  });
  await syncAuthRevCache(env, userId, authRev);

  const response = jsonResponse(bodyObj);
  response.headers.append('Set-Cookie', formatSessionCookieHeader(sessionToken));
  return response;
}

/**
 * Creates auth_sessions + KV (email / OAuth / signup login).
 * @returns {Promise<{ sessionId: string, sessionToken: string }>}
 */
export async function createLoginSession(request, env, userId, sessionProvider = 'email', opts = {}) {
  const sessionId = crypto.randomUUID();
  let expiresTs;
  if (opts != null && opts.ttlSeconds != null) {
    const raw = Number(opts.ttlSeconds);
    const sec = Number.isFinite(raw)
      ? Math.min(MAX_AGENT_SESSION_TTL_SECONDS, Math.max(MIN_AGENT_SESSION_TTL_SECONDS, raw))
      : DEFAULT_AGENT_SESSION_TTL_SECONDS;
    expiresTs = Date.now() + sec * 1000;
  } else {
    expiresTs = Date.now() + 30 * 24 * 60 * 60 * 1000;
  }
  const expiresAtIso = new Date(expiresTs).toISOString();
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = request.headers.get('user-agent') || '';

  let userRow = null;
  try {
    userRow = await withD1Retry(() =>
      env.DB.prepare('SELECT * FROM auth_users WHERE id = ? LIMIT 1').bind(userId).first(),
    );
  } catch (error) {
    console.warn('[createLoginSession] auth_users lookup failed', error.message);
  }
  if (!userRow?.email && opts?.fallbackUserRow?.email) {
    userRow = { ...opts.fallbackUserRow, id: userId };
    console.warn('[createLoginSession] using fallback user row during D1 pressure', userId);
  }
  if (!userRow?.email) throw new Error('User not found in auth_users during login finalization');

  const accountRow = await env.DB.prepare('SELECT id FROM accounts WHERE id = ? LIMIT 1')
    .bind(userId).first().catch(() => null);
  if (!accountRow?.id) {
    throw new Error('identity_plane_account_missing_before_session');
  }

  const sessionFields = sessionFieldsFromAuthUser(userRow, sessionProvider, {
    workspaceId: opts.workspaceId,
    providerSubject: opts.providerSubject,
  });
  let resolvedWorkspaceId = null;
  try {
    resolvedWorkspaceId = await resolveWorkspaceIdAtLogin(env, userRow, {
      workspaceId: opts.workspaceId,
    });
  } catch (error) {
    if (!isD1OverloadError(error)) throw error;
    console.warn('[createLoginSession] resolveWorkspaceIdAtLogin skipped during overload', error?.message ?? error);
  }
  sessionFields.workspaceId = resolvedWorkspaceId ?? sessionFields.workspaceId ?? null;

  const insertStmt = await prepareInsertAuthSessionRow(env, {
    sessionId, userId, tenantId: sessionFields.tenantId, personUuid: sessionFields.personUuid,
    supabaseUserId: sessionFields.supabaseUserId, email: sessionFields.email,
    provider: sessionFields.provider, providerSubject: sessionFields.providerSubject,
    displayName: sessionFields.displayName, avatarUrl: sessionFields.avatarUrl,
    workspaceId: sessionFields.workspaceId, ip, ua, expiresAtIso,
  });
  let d1SessionPersisted = false;
  try {
    await withD1Retry(() => insertStmt.run(), {
      maxAttempts: 6, delays: [100, 200, 400, 800, 1500, 3000],
    });
    d1SessionPersisted = true;
  } catch (error) {
    if (!isD1OverloadError(error)) throw error;
    console.warn('[createLoginSession] auth_sessions D1 batch deferred during overload — minting KV/JWT session', error?.message ?? error);
  }

  if (d1SessionPersisted && sessionFields.workspaceId) {
    await persistWorkspaceSelection(env, {
      userId, workspaceId: sessionFields.workspaceId, tenantId: sessionFields.tenantId,
    });
  }
  await writeIamSessionToKv(env, sessionId, userId, sessionFields.tenantId, expiresAtIso, {
    workspaceId: sessionFields.workspaceId, personUuid: sessionFields.personUuid,
    supabaseUserId: sessionFields.supabaseUserId, email: sessionFields.email,
    provider: sessionFields.provider, displayName: sessionFields.displayName,
    avatarUrl: sessionFields.avatarUrl, providerSubject: sessionFields.providerSubject,
    lastActiveAt: Date.now(),
  });

  if (d1SessionPersisted) {
    try {
      await pruneExpiredAuthSessions(env, { userId, limit: 80 });
      await replaceLiveSessionsForSameClient(env, {
        userId, keepId: sessionId, provider: sessionProvider, userAgent: ua,
      });
    } catch (error) {
      console.warn('[createLoginSession] session replace/prune', error?.message ?? error);
    }
  }

  let membership = null;
  let policy = null;
  let authRev = 0;
  if (d1SessionPersisted) {
    membership = sessionFields.workspaceId
      ? await loadMembership(env, userId, sessionFields.workspaceId)
      : null;
    policy = await loadAgentSamUserPolicy(env, userId, sessionFields.workspaceId || '');
    authRev = await readAuthRev(env, userId);
  } else {
    membership = sessionFields.workspaceId
      ? await loadMembershipCached(env, userId, sessionFields.workspaceId).catch(() => null)
      : null;
    policy = await loadAgentSamUserPolicyCached(env, userId, sessionFields.workspaceId || '').catch(() => null);
    authRev = (await readAuthRevFromCache(env, userId)) ?? 0;
  }
  const capabilities = computeAuthCapabilities(membership, policy);
  const ttlSec =
    opts != null && opts.ttlSeconds != null
      ? Math.min(
          MAX_AGENT_SESSION_TTL_SECONDS,
          Math.max(MIN_AGENT_SESSION_TTL_SECONDS, Number(opts.ttlSeconds) || DEFAULT_AGENT_SESSION_TTL_SECONDS),
        )
      : AUTH_SESSION_TTL_SECONDS;
  const featureFlags = d1SessionPersisted
    ? undefined
    : await loadFeatureFlagsCached(env, userId, sessionFields.tenantId).catch(() => ({}));
  const sessionToken = await mintBrowserSessionToken(env, {
    sessionId, userId, tenantId: sessionFields.tenantId,
    workspaceId: sessionFields.workspaceId, email: sessionFields.email,
    personUuid: sessionFields.personUuid, displayName: sessionFields.displayName,
    authRev, capabilities, featureFlags, ttlSec,
  });
  await syncAuthRevCache(env, userId, authRev);

  return {
    sessionId,
    sessionToken,
    tenantId: sessionFields.tenantId,
    workspaceId: sessionFields.workspaceId,
    d1SessionPersisted,
    capabilities,
  };
}

export async function pruneExpiredAuthSessions(env, opts = {}) {
  if (!env?.DB) return { rowsWritten: 0 };
  const uid = opts.userId != null ? String(opts.userId).trim() : '';
  const limit = Math.min(400, Math.max(1, Number(opts.limit) || 80));
  try {
    const sql = uid
      ? `UPDATE auth_sessions
            SET revoked_at = datetime('now'), revoke_reason = 'expired'
          WHERE user_id = ?
            AND (revoked_at IS NULL OR TRIM(COALESCE(revoked_at, '')) = '')
            AND expires_at IS NOT NULL AND TRIM(expires_at) != ''
            AND datetime(replace(replace(expires_at, 'T', ' '), 'Z', '')) < datetime('now')`
      : `UPDATE auth_sessions
            SET revoked_at = datetime('now'), revoke_reason = 'expired'
          WHERE (revoked_at IS NULL OR TRIM(COALESCE(revoked_at, '')) = '')
            AND expires_at IS NOT NULL AND TRIM(expires_at) != ''
            AND datetime(replace(replace(expires_at, 'T', ' '), 'Z', '')) < datetime('now')`;
    const stmt = uid ? env.DB.prepare(sql).bind(uid) : env.DB.prepare(sql);
    const out = await stmt.run();
    void limit;
    return { rowsWritten: Number(out?.meta?.changes ?? 0) || 0 };
  } catch (error) {
    console.warn('[pruneExpiredAuthSessions]', error?.message ?? error);
    return { rowsWritten: 0 };
  }
}

async function replaceLiveSessionsForSameClient(env, args) {
  const userId = String(args?.userId || '').trim();
  const keepId = String(args?.keepId || '').trim();
  if (!env?.DB || !userId || !keepId) return 0;
  const ua = String(args?.userAgent || '').trim();
  const prov = String(args?.provider || 'email').trim();
  let results = [];
  try {
    const q = await env.DB.prepare(
      `SELECT id FROM auth_sessions
       WHERE user_id = ? AND id != ?
         AND (revoked_at IS NULL OR TRIM(COALESCE(revoked_at, '')) = '')
         AND LOWER(TRIM(COALESCE(provider, ''))) = LOWER(?)
         AND TRIM(COALESCE(user_agent, '')) = ?
       LIMIT 80`,
    ).bind(userId, keepId, prov, ua).all();
    results = q?.results || [];
  } catch (error) {
    console.warn('[replaceLiveSessionsForSameClient] list', error?.message ?? error);
    return 0;
  }
  let count = 0;
  for (const row of results) {
    const id = row?.id != null ? String(row.id).trim() : '';
    if (!id) continue;
    await revokeAuthSession(env, id, 'replaced_same_client', userId);
    count += 1;
  }
  return count;
}

/**
 * Revoke a browser session (soft-delete). Clears KV cache for that session id.
 * @param {string} [userId] auth_users.id — when set, revoke only if session belongs to user
 */
export async function revokeAuthSession(env, sessionId, reason = 'logout', userId = null) {
  const id = String(sessionId || '').trim();
  const uid = trimSessionField(userId);
  if (!id || !env?.DB) return;

  if (env.SESSION_CACHE) {
    try {
      const { deleteSessionKvPayload } = await import(
        '../../services/session-context/kv-cache.js'
      );
      await deleteSessionKvPayload(env, id);
    } catch {}
  }
  await markSessionRevokedInKv(env, id, AUTH_SESSION_TTL_SECONDS);

  try {
    const query = uid
      ? `UPDATE auth_sessions
         SET revoked_at = datetime('now'), revoke_reason = ?
         WHERE id = ? AND user_id = ?
           AND (revoked_at IS NULL OR TRIM(COALESCE(revoked_at, '')) = '')`
      : `UPDATE auth_sessions
         SET revoked_at = datetime('now'), revoke_reason = ?
         WHERE id = ?
           AND (revoked_at IS NULL OR TRIM(COALESCE(revoked_at, '')) = '')`;
    const statement = uid
      ? env.DB.prepare(query).bind(reason, id, uid)
      : env.DB.prepare(query).bind(reason, id);
    await statement.run();
  } catch (error) {
    console.warn('[revokeAuthSession]', error?.message ?? error);
  }
}

/**
 * Resolve canonical auth_sessions.id from cookie value (JWT sid or legacy UUID).
 * @param {any} env
 * @param {string} rawCookieValue
 */
export async function resolveSessionIdFromCookieValue(env, rawCookieValue) {
  const resolved = await resolveSessionFromCookieValue(env, rawCookieValue);
  return trimSessionField(resolved.sessionId);
}
