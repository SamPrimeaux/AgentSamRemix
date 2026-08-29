/**
 * Keys & Secrets domain service — user_secrets registry (no user_api_keys).
 */
import { handleKeySecurityAfterOp } from '../../src/core/keys-security.js';
import { upsertWorkspaceDataBinding } from '../../src/core/workspace-data-bindings.js';
import { refreshActorAuthorityAfterKeysChange } from '../services/bootstrap/authority-refresh.js';
import {
  checkRevealRateLimit,
  checkValidateRateLimit,
  normalizeApiKeySecret,
  validateProviderKey,
} from './credential-validation.js';
import { listD1ForScope, listZonesForScope, selectWorkspaceD1 } from './cloudflare/catalog.js';
import { resolveUserCloudflareCredential } from './cloudflare/credentials.js';
import {
  getUserR2Summary,
  loadUserR2Credentials,
  saveUserR2Credentials,
  validateUserR2Credentials,
  revokeUserR2Credentials,
} from './cloudflare/r2-credentials.js';
import {
  assertWorkspaceAccess,
  clientError,
  resolveTenantIdOrFetch,
  workspaceErrorResponse,
} from './request-context.js';
import {
  KEY_CATEGORIES,
  PERSONAL_SERVICE_NAME,
  PROVIDERS,
  providerSecretName,
  R2_SERVICE_NAME,
} from './provider-catalog.js';
import {
  buildProviderKeyMetadata,
  createUserSecret,
  decryptUserSecretPlaintext,
  getUserSecretScoped,
  lastFourOfSecret,
  listUserSecrets,
  newSecretId,
  parseSecretMetadata,
  revokeUserSecret,
  rotateUserSecretValue,
  toSafeSecretItem,
  updateUserSecretMetadata,
} from './user-secret-store.js';

function scheduleActorAuthorityRefresh(env, { userId, workspaceId, tenantId }) {
  void refreshActorAuthorityAfterKeysChange(env, { userId, workspaceId, tenantId }).catch((e) => {
    console.warn('[credentials/service] actor authority refresh failed', e?.message ?? e);
  });
}

function r2SecretFromBody(body) {
  return String(
    body?.r2_secret_access_key ?? body?.secret_access_key ?? body?.api_key ?? body?.secret_value ?? '',
  ).trim();
}

function r2AccessKeyFromBody(body) {
  return String(body?.r2_access_key_id ?? body?.access_key_id ?? '').trim();
}

function r2BucketFromBody(body) {
  const b = body?.byok_r2_bucket ?? body?.default_bucket ?? body?.bucket ?? '';
  const s = String(b || '').trim();
  return s || null;
}

async function readWorkspaceSettingsJson(env, workspaceId) {
  const wid = String(workspaceId || '').trim();
  if (!wid || !env?.DB) return {};
  const row = await env.DB.prepare(
    `SELECT settings_json FROM workspace_settings WHERE workspace_id = ? LIMIT 1`,
  )
    .bind(wid)
    .first()
    .catch(() => null);
  if (!row?.settings_json) return {};
  try {
    return typeof row.settings_json === 'string' ? JSON.parse(row.settings_json) : row.settings_json;
  } catch {
    return {};
  }
}

async function mergeWorkspaceSettingsJson(env, workspaceId, patch) {
  const wid = String(workspaceId || '').trim();
  if (!wid || !env?.DB) return {};
  const current = await readWorkspaceSettingsJson(env, wid);
  const next = { ...current, ...patch };
  await env.DB.prepare(
    `INSERT INTO workspace_settings (workspace_id, settings_json, updated_at)
     VALUES (?, ?, unixepoch())
     ON CONFLICT(workspace_id) DO UPDATE SET
       settings_json = excluded.settings_json,
       updated_at = excluded.updated_at`,
  )
    .bind(wid, JSON.stringify(next))
    .run()
    .catch(() => null);
  return next;
}

export async function listKeys(env, authUser, request, url) {
  const wsRes = await assertWorkspaceAccess(env, request, authUser);
  const wsErr = workspaceErrorResponse(wsRes.error);
  if (wsErr) return wsErr;

  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  const userId = String(authUser?.id || '').trim();
  const categoryFilter = String(url.searchParams.get('category') || '').trim().toLowerCase();

  let items = await listUserSecrets(env, { userId, tenantId, categoryFilter: categoryFilter || null });

  if (!categoryFilter || categoryFilter === 'provider') {
    const r2 = await getUserR2Summary(env, userId);
    if (r2 && !items.some((i) => String(i.provider).toLowerCase() === R2_SERVICE_NAME)) {
      items.unshift({
        id: r2.id,
        workspace_id: null,
        category: 'provider',
        provider: R2_SERVICE_NAME,
        secret_name: 'r2_s3_credentials',
        label: 'Cloudflare R2',
        status: r2.status || 'active',
        scope: 'user',
        last_four: r2.r2_access_key_id_preview || '????',
        cloudflare_account_mask: r2.cf_account_id ? `••••${String(r2.cf_account_id).slice(-4)}` : null,
        byok_r2_bucket: null,
        validated_at: r2.validated_at != null ? new Date(Number(r2.validated_at) * 1000).toISOString() : null,
        created_at: r2.created_at ?? null,
        updated_at: null,
        last_used_at: null,
        rotated_at: null,
        expires_at: null,
      });
    }
  }

  return { status: 200, body: { items } };
}

export async function createKey(env, authUser, request, body) {
  const wsRes = await assertWorkspaceAccess(env, request, authUser);
  const wsErr = workspaceErrorResponse(wsRes.error);
  if (wsErr) return wsErr;

  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  const userId = String(authUser?.id || '').trim();
  const workspaceId = wsRes.workspaceId;

  const categoryRaw = String(body.category || 'provider').trim().toLowerCase();
  const category = KEY_CATEGORIES.has(categoryRaw) ? categoryRaw : 'provider';
  let provider = String(body.provider || '').trim().toLowerCase();

  if (category === 'provider' && provider === R2_SERVICE_NAME) {
    const cfAccountId = body?.cloudflare_account_id != null ? String(body.cloudflare_account_id).trim() : '';
    const accessKeyId = r2AccessKeyFromBody(body);
    const secretAccessKey = r2SecretFromBody(body);
    const bucket = r2BucketFromBody(body);
    if (!cfAccountId) return clientError('CLOUDFLARE_ACCOUNT_ID_REQUIRED', 'Cloudflare Account ID is required.');
    if (!accessKeyId || !secretAccessKey) {
      return clientError('R2_CREDENTIALS_REQUIRED', 'R2 Access Key ID and secret access key are required.');
    }
    const out = await saveUserR2Credentials(env, {
      userId,
      tenantId,
      workspaceId,
      cfAccountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      validateOnCreate: body.validate === true,
    });
    if (!out.ok) return { status: 400, body: out };
    scheduleActorAuthorityRefresh(env, { userId, workspaceId, tenantId });
    return { status: 200, body: { ok: true, item: out.item } };
  }

  const secretNameInput = String(body.secret_name || '').trim();
  const cloudflareAccountId =
    body.cloudflare_account_id != null ? String(body.cloudflare_account_id).trim().replace(/\s+/g, '') : '';
  const keyLabel = String(body.label ?? body.key_name ?? (category === 'personal' ? secretNameInput : '')).trim();
  const apiKey = normalizeApiKeySecret(body.api_key || body.secret_value || '');
  const validationOnCreate = body.validate === true;

  if (category === 'personal') {
    provider = provider || 'other';
    if (!secretNameInput && !keyLabel) {
      return clientError('SECRET_NAME_REQUIRED', 'Secret name is required for personal secrets.');
    }
  } else {
    if (!provider) return clientError('PROVIDER_REQUIRED', 'Provider is required.');
    if (!PROVIDERS.has(provider)) {
      return clientError('INVALID_PROVIDER', 'Choose a supported provider (OpenAI, Anthropic, Google, etc.).');
    }
  }
  if (!keyLabel && category !== 'provider') return clientError('KEY_NAME_REQUIRED', 'Label is required.');
  if (category === 'provider' && provider !== 'cloudflare' && provider !== R2_SERVICE_NAME && !keyLabel) {
    return clientError('KEY_NAME_REQUIRED', 'Label is required.');
  }
  if (!apiKey) return clientError('API_KEY_REQUIRED', 'Secret value is required.');
  if (category === 'provider' && provider === 'cloudflare' && !cloudflareAccountId) {
    return clientError('CLOUDFLARE_ACCOUNT_ID_REQUIRED', 'Cloudflare Account ID is required.');
  }

  const validateOpts = provider === 'cloudflare' ? { cloudflare_account_id: cloudflareAccountId } : {};
  let preValidateResult = null;
  if (validationOnCreate && category === 'provider') {
    preValidateResult = await validateProviderKey(provider, apiKey, env, validateOpts);
    if (!preValidateResult.ok) {
      return { status: 400, body: { ok: false, error: 'validation_failed', ...preValidateResult } };
    }
  }

  const secretId = newSecretId();
  const lastFour = lastFourOfSecret(apiKey);
  const effectiveLabel =
    keyLabel || (provider === 'cloudflare' ? `Cloudflare ••••${cloudflareAccountId.slice(-4)}` : provider);
  const metadata = buildProviderKeyMetadata({
    provider: category === 'personal' ? PERSONAL_SERVICE_NAME : provider,
    label: effectiveLabel,
    lastFour,
    category,
    cloudflareAccountId: provider === 'cloudflare' ? cloudflareAccountId : null,
    validated: validationOnCreate && preValidateResult?.ok,
  });
  if (category === 'personal' && secretNameInput) metadata.secret_name = secretNameInput;

  let row;
  try {
    row = await createUserSecret(env, {
      userId,
      tenantId,
      secretId,
      serviceName: category === 'personal' ? PERSONAL_SERVICE_NAME : provider,
      secretName:
        category === 'personal' && secretNameInput
          ? secretNameInput
          : providerSecretName(secretId, provider),
      secretType: 'api_key',
      description: effectiveLabel,
      plaintext: apiKey,
      metadata,
      expiresAt: body.expires_at ?? null,
    });
  } catch (e) {
    if (String(e?.message) === 'ENCRYPT_FAILED') {
      return clientError('ENCRYPT_FAILED', 'Could not encrypt secret value.', 500);
    }
    return clientError('D1_ERROR', e?.message ?? String(e), 500);
  }

  await handleKeySecurityAfterOp(env, {
    operation: 'create',
    secretId,
    tenantId,
    userId,
    workspaceId,
    provider,
    plaintextKey: apiKey,
    encryptOk: true,
    newLast4: lastFour,
    validationResult: preValidateResult,
    request,
    triggeredBy: 'dashboard_ui',
    notes: `Created credential (${provider})`,
  });

  if (category === 'provider' && provider === 'cloudflare' && cloudflareAccountId) {
    await upsertWorkspaceDataBinding(env, {
      id: `wsbind_cf_${String(workspaceId).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40)}`,
      tenant_id: tenantId,
      user_id: userId,
      workspace_id: workspaceId,
      provider: 'cloudflare',
      connection_id: secretId,
      external_account_id: cloudflareAccountId,
      display_name: effectiveLabel,
      selected_as_default: true,
      health_status: 'active',
      metadata_json: JSON.stringify({ source: 'settings_keys', secret_id: secretId }),
    });
  }

  scheduleActorAuthorityRefresh(env, { userId, workspaceId, tenantId });
  return { status: 200, body: { ok: true, item: row ? toSafeSecretItem(row) : null } };
}

export async function patchKey(env, authUser, request, id, body) {
  const wsRes = await assertWorkspaceAccess(env, request, authUser);
  const wsErr = workspaceErrorResponse(wsRes.error);
  if (wsErr) return wsErr;

  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  const userId = String(authUser?.id || '').trim();
  const row = await getUserSecretScoped(env, { userId, tenantId, secretId: id });
  if (!row) return clientError('NOT_FOUND', 'API key not found.', 404);

  const patchMeta = {};
  if (body.label != null) patchMeta.label = String(body.label).trim();
  if (body.metadata !== undefined) Object.assign(patchMeta, body.metadata || {});
  const updated = await updateUserSecretMetadata(env, {
    userId,
    tenantId,
    secretId: id,
    patchMeta,
    description: patchMeta.label,
  });
  return { status: 200, body: { ok: true, item: updated ? toSafeSecretItem(updated) : null } };
}

export async function rotateKey(env, authUser, request, id, body) {
  const wsRes = await assertWorkspaceAccess(env, request, authUser);
  const wsErr = workspaceErrorResponse(wsRes.error);
  if (wsErr) return wsErr;

  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  const userId = String(authUser?.id || '').trim();
  const workspaceId = wsRes.workspaceId;
  const apiKey = String(body.api_key || body.secret_value || '').trim();
  if (!apiKey) return clientError('API_KEY_REQUIRED', 'Secret value is required.');

  const row = await getUserSecretScoped(env, { userId, tenantId, secretId: id });
  if (!row) return clientError('NOT_FOUND', 'API key not found.', 404);

  const meta = parseSecretMetadata(row);
  const previousLast4 = meta.last_four || '????';
  const newLast4 = lastFourOfSecret(apiKey);

  const updated = await rotateUserSecretValue(env, { userId, tenantId, secretId: id, plaintext: apiKey });
  if (!updated) return clientError('ROTATE_FAILED', 'Could not rotate secret.', 500);

  await handleKeySecurityAfterOp(env, {
    operation: 'rotate',
    secretId: id,
    tenantId,
    userId,
    workspaceId,
    provider: meta.provider,
    previousLast4,
    newLast4,
    request,
    triggeredBy: 'dashboard_ui',
  });

  scheduleActorAuthorityRefresh(env, { userId, workspaceId, tenantId });
  return { status: 200, body: { ok: true, item: toSafeSecretItem(updated) } };
}

export async function revokeKey(env, authUser, request, id) {
  const wsRes = await assertWorkspaceAccess(env, request, authUser);
  const wsErr = workspaceErrorResponse(wsRes.error);
  if (wsErr) return wsErr;

  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  const userId = String(authUser?.id || '').trim();
  const workspaceId = wsRes.workspaceId;

  const row = await getUserSecretScoped(env, { userId, tenantId, secretId: id });
  if (!row) {
    const r2 = await getUserR2Summary(env, userId);
    if (r2?.id === id) {
      await revokeUserR2Credentials(env, { userId, secretId: id });
      return { status: 200, body: { ok: true, revoked: true } };
    }
    return clientError('NOT_FOUND', 'API key not found.', 404);
  }

  const meta = parseSecretMetadata(row);
  await revokeUserSecret(env, { userId, secretId: id });
  await handleKeySecurityAfterOp(env, {
    operation: 'delete',
    secretId: id,
    tenantId,
    userId,
    workspaceId,
    provider: meta.provider,
    previousLast4: meta.last_four,
    request,
    triggeredBy: 'dashboard_ui',
  });
  scheduleActorAuthorityRefresh(env, { userId, workspaceId, tenantId });
  return { status: 200, body: { ok: true, revoked: true } };
}

export async function revealKey(env, authUser, request, id) {
  const userId = String(authUser?.id || '').trim();
  const rl = await checkRevealRateLimit(env, userId);
  if (!rl.allowed) {
    return {
      status: 429,
      body: {
        ok: false,
        error: 'rate_limited',
        message: `Too many reveal attempts. Retry in ${rl.retry_after_sec ?? 60}s.`,
      },
    };
  }

  const wsRes = await assertWorkspaceAccess(env, request, authUser);
  const wsErr = workspaceErrorResponse(wsRes.error);
  if (wsErr) return wsErr;

  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  const workspaceId = wsRes.workspaceId;
  const row = await getUserSecretScoped(env, { userId, tenantId, secretId: id });
  if (!row) return clientError('NOT_FOUND', 'API key not found.', 404);

  const plain = await decryptUserSecretPlaintext(env, { userId, tenantId, secretId: id });
  if (!plain) return clientError('DECRYPT_FAILED', 'Could not decrypt secret.', 500);

  const meta = parseSecretMetadata(row);
  const value = typeof plain === 'string' ? plain : JSON.stringify(plain);

  await handleKeySecurityAfterOp(env, {
    operation: 'reveal',
    secretId: id,
    tenantId,
    userId,
    workspaceId,
    provider: meta.provider,
    request,
    triggeredBy: 'dashboard_ui',
  });

  return {
    status: 200,
    body: {
      ok: true,
      value,
      expires_in_sec: 30,
      last_four: meta.last_four ?? null,
      provider: meta.provider,
      category: meta.category,
    },
  };
}

export async function validateKey(env, authUser, request, body, keyId = null) {
  const userId = String(authUser?.id || '').trim();
  const rl = await checkValidateRateLimit(env, userId);
  if (!rl.allowed) {
    return {
      status: 429,
      body: {
        ok: false,
        error: 'rate_limited',
        message: `Too many validation attempts. Retry in ${rl.retry_after_sec ?? 60}s.`,
      },
    };
  }

  const wsRes = await assertWorkspaceAccess(env, request, authUser);
  const wsErr = workspaceErrorResponse(wsRes.error);
  if (wsErr) return wsErr;

  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  let provider = String(body?.provider || '').trim().toLowerCase();
  let apiKey = normalizeApiKeySecret(body?.api_key || body?.secret_value || '');
  let cloudflareAccountId =
    body?.cloudflare_account_id != null ? String(body.cloudflare_account_id).trim().replace(/\s+/g, '') : '';

  if (keyId) {
    const row = await getUserSecretScoped(env, { userId, tenantId, secretId: keyId });
    if (!row) {
      const r2 = await getUserR2Summary(env, userId);
      if (r2?.id === keyId) provider = R2_SERVICE_NAME;
      else return clientError('NOT_FOUND', 'Key not found.', 404);
    } else {
      const meta = parseSecretMetadata(row);
      provider = String(meta.provider || row.service_name || 'other').toLowerCase();
      const plain = await decryptUserSecretPlaintext(env, { userId, tenantId, secretId: keyId });
      apiKey = typeof plain === 'string' ? plain : '';
      if (!cloudflareAccountId) cloudflareAccountId = String(meta.cloudflare_account_id || '').trim();
    }
  }

  if (!provider) return clientError('PROVIDER_REQUIRED', 'Provider is required.');

  if (provider === R2_SERVICE_NAME) {
    const result = await validateUserR2Credentials(env, {
      userId,
      cfAccountId: cloudflareAccountId,
      accessKeyId: r2AccessKeyFromBody(body),
      secretAccessKey: r2SecretFromBody(body) || apiKey,
      bucketName: r2BucketFromBody(body),
    });
    return { status: 200, body: result };
  }

  if (!apiKey) return clientError('API_KEY_REQUIRED', 'API key value is required.');
  if (provider === 'cloudflare' && !cloudflareAccountId) {
    return clientError('CLOUDFLARE_ACCOUNT_ID_REQUIRED', 'Cloudflare Account ID is required.');
  }

  const validateOpts = provider === 'cloudflare' ? { cloudflare_account_id: cloudflareAccountId } : {};
  const result = await validateProviderKey(provider, apiKey, env, validateOpts);

  if (keyId && result?.ok) {
    await updateUserSecretMetadata(env, {
      userId,
      tenantId,
      secretId: keyId,
      patchMeta: {
        validated_at: Math.floor(Date.now() / 1000),
        validation_status: 'pass',
        validation_checks: result.checks ?? [],
      },
    });
    await handleKeySecurityAfterOp(env, {
      operation: 'validate',
      secretId: keyId,
      tenantId,
      userId,
      workspaceId: wsRes.workspaceId,
      provider,
      plaintextKey: apiKey,
      validationResult: result,
      request,
      triggeredBy: 'dashboard_ui',
    });
  }

  return { status: 200, body: result };
}

export async function auditKeys(env, authUser, request, url) {
  const wsRes = await assertWorkspaceAccess(env, request, authUser);
  const wsErr = workspaceErrorResponse(wsRes.error);
  if (wsErr) return wsErr;

  if (!env?.DB) return { status: 200, body: { items: [], limit: 50, offset: 0 } };

  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const secretId = String(url.searchParams.get('api_key_id') || url.searchParams.get('secret_id') || '').trim() || null;

  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  const userId = String(authUser?.id || '').trim();

  const where = [`(secret_source = 'user_secrets' OR secret_source = 'user_oauth_tokens')`];
  const binds = [];
  if (secretId) {
    where.push('secret_id = ?');
    binds.push(secretId);
  }
  where.push('tenant_id = ?');
  binds.push(tenantId);
  where.push('user_id = ?');
  binds.push(userId);

  const res = await env.DB.prepare(
    `SELECT id, secret_id, event_type, triggered_by, previous_last4, new_last4, notes, created_at
       FROM secret_audit_log
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all()
    .catch(() => ({ results: [] }));

  const items = (res?.results || []).map((r) => ({
    id: r.id,
    api_key_id: r.secret_id,
    event_type: r.event_type,
    actor: r.triggered_by ?? null,
    previous_last4: r.previous_last4 ?? null,
    new_last4: r.new_last4 ?? null,
    notes: r.notes ?? null,
    created_at: r.created_at ?? null,
  }));

  return {
    status: 200,
    body: { items, limit, offset, api_key_id: secretId, workspace_id: wsRes.workspaceId },
  };
}

export async function getHints(env, authUser, request) {
  const wsRes = await assertWorkspaceAccess(env, request, authUser);
  const wsErr = workspaceErrorResponse(wsRes.error);
  if (wsErr) return wsErr;

  const workspaceId = wsRes.workspaceId;
  const settings = await readWorkspaceSettingsJson(env, workspaceId);
  const ptyDefaults =
    settings?.pty_defaults && typeof settings.pty_defaults === 'object' ? settings.pty_defaults : {};

  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  const userId = String(authUser?.id || '').trim();
  const cf = await resolveUserCloudflareCredential(env, { userId, tenantId, workspaceId });
  const cloudflareAccountId = cf.ok ? cf.account_id : null;

  return {
    status: 200,
    body: {
      ok: true,
      workspace_id: workspaceId,
      cloudflare_account_id: cloudflareAccountId,
      cloudflare_account_id_mask: cf.ok ? cf.account_mask : null,
      pty_defaults: {
        zone_id: ptyDefaults.zone_id != null ? String(ptyDefaults.zone_id) : null,
        hostname: ptyDefaults.hostname != null ? String(ptyDefaults.hostname) : null,
        tunnel_name: ptyDefaults.tunnel_name != null ? String(ptyDefaults.tunnel_name) : null,
      },
      sync_note: 'Run npm run sync:operator-keys locally to refresh from .env.cloudflare',
    },
  };
}

export async function putPtyDefaults(env, authUser, request, body) {
  const wsRes = await assertWorkspaceAccess(env, request, authUser);
  const wsErr = workspaceErrorResponse(wsRes.error);
  if (wsErr) return wsErr;

  const raw = body?.pty_defaults;
  if (!raw || typeof raw !== 'object') {
    return clientError('PTY_DEFAULTS_REQUIRED', 'pty_defaults object is required.');
  }

  const pty_defaults = {
    zone_id: raw.zone_id != null ? String(raw.zone_id).trim() : null,
    hostname: raw.hostname != null ? String(raw.hostname).trim() : null,
    tunnel_name: raw.tunnel_name != null ? String(raw.tunnel_name).trim() : null,
    cloudflare_account_id:
      raw.cloudflare_account_id != null ? String(raw.cloudflare_account_id).trim() : null,
    synced_from: raw.synced_from != null ? String(raw.synced_from) : '.env.cloudflare',
    synced_at: raw.synced_at != null ? String(raw.synced_at) : new Date().toISOString(),
  };

  const next = await mergeWorkspaceSettingsJson(env, wsRes.workspaceId, { pty_defaults });
  return { status: 200, body: { ok: true, workspace_id: wsRes.workspaceId, pty_defaults: next.pty_defaults } };
}

export async function listCloudflareD1(env, authUser, request, url) {
  const wsRes = await assertWorkspaceAccess(env, request, authUser);
  const wsErr = workspaceErrorResponse(wsRes.error);
  if (wsErr) return wsErr;

  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  const userId = String(authUser?.id || '').trim();
  const accountIdParam = String(url.searchParams.get('account_id') || '').trim();
  const out = await listD1ForScope(
    env,
    { userId, tenantId, workspaceId: wsRes.workspaceId },
    accountIdParam,
  );
  if (!out.ok) return { status: out.status || 400, body: { ok: false, error: out.error, message: out.message } };
  return { status: 200, body: { ok: true, ...out } };
}

export async function listCloudflareZonesRoute(env, authUser, request) {
  const wsRes = await assertWorkspaceAccess(env, request, authUser);
  const wsErr = workspaceErrorResponse(wsRes.error);
  if (wsErr) return wsErr;

  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  const userId = String(authUser?.id || '').trim();
  const out = await listZonesForScope(env, { userId, tenantId, workspaceId: wsRes.workspaceId });
  if (!out.ok) return { status: out.status || 400, body: { ok: false, error: out.error, message: out.message } };
  return { status: 200, body: { ok: true, ...out } };
}

export async function selectCloudflareD1(env, authUser, request, body) {
  const wsRes = await assertWorkspaceAccess(env, request, authUser);
  const wsErr = workspaceErrorResponse(wsRes.error);
  if (wsErr) return wsErr;

  const databaseId = String(body.database_id || body.external_database_id || '').trim();
  const accountId = body.account_id != null ? String(body.account_id).trim() : '';
  const displayName = body.display_name != null ? String(body.display_name).trim() : '';
  if (!databaseId) return clientError('DATABASE_ID_REQUIRED', 'database_id is required.');

  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  const userId = String(authUser?.id || '').trim();
  const cf = await resolveUserCloudflareCredential(env, {
    userId,
    tenantId,
    workspaceId: wsRes.workspaceId,
  });
  if (!cf.ok) {
    return clientError('CLOUDFLARE_CREDENTIALS_MISSING', 'Add your Cloudflare API token in Keys & Secrets first.', 400);
  }

  const resolvedAccountId = accountId || cf.account_id;
  if (!resolvedAccountId) {
    return clientError('CLOUDFLARE_ACCOUNT_ID_REQUIRED', 'Cloudflare Account ID is required.', 400);
  }

  const out = await selectWorkspaceD1(env, {
    userId,
    tenantId,
    workspaceId: wsRes.workspaceId,
    databaseId,
    accountId: resolvedAccountId,
    displayName,
  });
  return { status: 200, body: out };
}
