/** Hardened Keys & Secrets settings API backed by user_secrets. */
import { isVaultConfigured } from '../../credentials/vault-key-material.js';
import { PROVIDERS, PROVIDER_OPTIONS, KEY_CATEGORIES, PERSONAL_SERVICE_NAME, providerSecretName } from '../../credentials/provider-catalog.js';
import { normalizeApiKeySecret, validateProviderKey } from '../../credentials/provider-validation.js';
import {
  buildProviderKeyMetadata,
  createUserSecret,
  decryptUserSecretPlaintext,
  getUserSecretScoped,
  lastFourOfSecret,
  listUserSecrets,
  newSecretId,
  parseSecretMetadata,
  resolveProviderCredential,
  revokeUserSecret,
  rotateUserSecretValue,
  toSafeSecretItem,
  updateUserSecretMetadata,
  userSecretsColumns,
} from '../../credentials/user-secret-store.js';

const MAX_SECRET_BYTES = 16 * 1024;
const MAX_LABEL = 160;
const MAX_SECRET_NAME = 160;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0', pragma: 'no-cache', ...headers },
  });
}

function trim(value) { return value == null ? '' : String(value).trim(); }
function nowUnix() { return Math.floor(Date.now() / 1000); }

function secretWithinLimit(value) {
  return new TextEncoder().encode(String(value || '')).byteLength <= MAX_SECRET_BYTES;
}

async function rateLimit(env, key, max, ttlSeconds) {
  if (!env?.SESSION_CACHE) return { allowed: true };
  try {
    const raw = await env.SESSION_CACHE.get(key);
    const count = Number.parseInt(raw || '0', 10) || 0;
    if (count >= max) return { allowed: false, retry_after_sec: ttlSeconds };
    await env.SESSION_CACHE.put(key, String(count + 1), { expirationTtl: ttlSeconds });
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

async function auditColumns(db) {
  try {
    const out = await db.prepare('PRAGMA table_info(secret_audit_log)').all();
    return new Set((out?.results || []).map((row) => String(row?.name || '')).filter(Boolean));
  } catch { return new Set(); }
}

async function writeAudit(env, request, scope, params) {
  if (!env?.DB) return false;
  const cols = await auditColumns(env.DB);
  if (!cols.has('secret_id') || !cols.has('event_type')) return false;
  const values = {
    id: `saudit_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
    secret_id: params.secretId,
    secret_source: 'user_secrets',
    tenant_id: scope.tenantId || '',
    user_id: scope.userId,
    event_type: params.eventType,
    triggered_by: scope.userId,
    previous_last4: params.previousLast4 ?? null,
    new_last4: params.newLast4 ?? null,
    notes: params.notes ?? null,
    ip_address: request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || null,
    user_agent: request.headers.get('user-agent') || null,
  };
  const names = Object.keys(values).filter((name) => cols.has(name));
  const placeholders = names.map(() => '?');
  if (cols.has('created_at')) { names.push('created_at'); placeholders.push('unixepoch()'); }
  try {
    await env.DB.prepare(`INSERT INTO secret_audit_log (${names.join(', ')}) VALUES (${placeholders.join(', ')})`)
      .bind(...Object.keys(values).filter((name) => cols.has(name)).map((name) => values[name]))
      .run();
    return true;
  } catch (error) {
    console.warn('[settings/keys] audit write failed', params.eventType, error?.message || error);
    return false;
  }
}

async function readAudit(env, scope, url) {
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '20', 10) || 20));
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  try {
    const result = await env.DB.prepare(
      `SELECT id, secret_id, event_type, triggered_by, previous_last4, new_last4, notes, created_at
         FROM secret_audit_log
        WHERE user_id = ? AND (secret_source = 'user_secrets' OR secret_source IS NULL)
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).bind(scope.userId, limit, offset).all();
    return json({ ok: true, items: (result?.results || []).map((row) => ({
      id: row.id,
      api_key_id: row.secret_id,
      event_type: row.event_type,
      actor: row.triggered_by || null,
      previous_last4: row.previous_last4 || null,
      new_last4: row.new_last4 || null,
      notes: row.notes || null,
      created_at: row.created_at || null,
    })), limit, offset });
  } catch {
    return json({ ok: true, items: [], limit, offset, warning: 'secret_audit_log_unavailable' });
  }
}

async function listKeys(env, scope, url) {
  const category = trim(url.searchParams.get('category')).toLowerCase();
  if (category && !KEY_CATEGORIES.has(category)) return json({ ok: false, error: 'category_invalid' }, 400);
  const items = await listUserSecrets(env, { userId: scope.userId, tenantId: scope.tenantId, categoryFilter: category || null });
  return json({ ok: true, items, scope: 'user', workspace_id: scope.workspaceId });
}

async function createKey(request, env, scope) {
  if (!isVaultConfigured(env)) return json({ ok: false, error: 'vault_not_configured' }, 503);
  const body = await request.json().catch(() => null);
  const category = trim(body?.category || 'provider').toLowerCase();
  if (!KEY_CATEGORIES.has(category)) return json({ ok: false, error: 'category_invalid' }, 400);
  const provider = category === 'personal' ? PERSONAL_SERVICE_NAME : trim(body?.provider).toLowerCase();
  if (category === 'provider' && !PROVIDERS.has(provider)) return json({ ok: false, error: 'provider_invalid' }, 400);

  const secretNameInput = trim(body?.secret_name);
  const label = trim(body?.label || body?.key_name || secretNameInput).slice(0, MAX_LABEL);
  const apiKey = normalizeApiKeySecret(body?.api_key || body?.secret_value || '');
  if (!apiKey || !secretWithinLimit(apiKey)) return json({ ok: false, error: 'secret_value_invalid' }, 400);
  if (category === 'personal' && !secretNameInput) return json({ ok: false, error: 'secret_name_required' }, 400);
  if (secretNameInput.length > MAX_SECRET_NAME) return json({ ok: false, error: 'secret_name_too_long' }, 400);
  if (category === 'provider' && !label) return json({ ok: false, error: 'label_required' }, 400);

  const cloudflareAccountId = trim(body?.cloudflare_account_id).replace(/\s+/g, '');
  if (provider === 'cloudflare' && !/^[a-f0-9]{32}$/i.test(cloudflareAccountId)) {
    return json({ ok: false, error: 'cloudflare_account_id_invalid' }, 400);
  }

  let validation = null;
  if (body?.validate === true && category === 'provider') {
    const rl = await rateLimit(env, `key_validate:${scope.userId}`, 10, 60);
    if (!rl.allowed) return json({ ok: false, error: 'rate_limited', ...rl }, 429, { 'retry-after': String(rl.retry_after_sec || 60) });
    validation = await validateProviderKey(provider, apiKey, env, { cloudflare_account_id: cloudflareAccountId });
    if (!validation.ok) return json({ ok: false, error: 'validation_failed', ...validation }, 400);
  }

  const secretId = newSecretId();
  const lastFour = lastFourOfSecret(apiKey);
  const effectiveLabel = label || secretNameInput || provider;
  const metadata = buildProviderKeyMetadata({
    provider,
    label: effectiveLabel,
    lastFour,
    category,
    cloudflareAccountId: provider === 'cloudflare' ? cloudflareAccountId : null,
    validated: Boolean(validation?.ok),
  });
  if (category === 'personal') metadata.secret_name = secretNameInput;

  try {
    const row = await createUserSecret(env, {
      userId: scope.userId,
      tenantId: scope.tenantId || '',
      secretId,
      serviceName: category === 'personal' ? PERSONAL_SERVICE_NAME : provider,
      secretName: category === 'personal' ? secretNameInput : providerSecretName(secretId, provider),
      description: effectiveLabel,
      plaintext: apiKey,
      metadata,
      expiresAt: body?.expires_at ?? null,
    });
    const auditOk = await writeAudit(env, request, scope, { secretId, eventType: 'created', newLast4: lastFour, notes: `Created ${provider} credential` });
    return json({ ok: true, item: row ? toSafeSecretItem(row) : null, audit_ok: auditOk });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'key_create_failed' }, 500);
  }
}

async function patchKey(request, env, scope, id) {
  const body = await request.json().catch(() => null);
  const label = body?.label == null ? null : trim(body.label).slice(0, MAX_LABEL);
  if (label === '') return json({ ok: false, error: 'label_required' }, 400);
  const updated = await updateUserSecretMetadata(env, {
    userId: scope.userId,
    tenantId: scope.tenantId,
    secretId: id,
    patchMeta: label == null ? {} : { label },
    description: label,
  });
  if (!updated) return json({ ok: false, error: 'not_found' }, 404);
  await writeAudit(env, request, scope, { secretId: id, eventType: 'updated', notes: 'Credential metadata updated' });
  return json({ ok: true, item: toSafeSecretItem(updated) });
}

async function rotateKey(request, env, scope, id) {
  if (!isVaultConfigured(env)) return json({ ok: false, error: 'vault_not_configured' }, 503);
  const body = await request.json().catch(() => null);
  const apiKey = normalizeApiKeySecret(body?.api_key || body?.secret_value || '');
  if (!apiKey || !secretWithinLimit(apiKey)) return json({ ok: false, error: 'secret_value_invalid' }, 400);
  const row = await getUserSecretScoped(env, { userId: scope.userId, tenantId: scope.tenantId, secretId: id });
  if (!row) return json({ ok: false, error: 'not_found' }, 404);
  const meta = parseSecretMetadata(row);
  const previousLast4 = meta.last_four || null;
  const updated = await rotateUserSecretValue(env, { userId: scope.userId, tenantId: scope.tenantId, secretId: id, plaintext: apiKey });
  const auditOk = await writeAudit(env, request, scope, {
    secretId: id,
    eventType: 'rotated',
    previousLast4,
    newLast4: lastFourOfSecret(apiKey),
    notes: `Rotated ${meta.provider || row.service_name || 'credential'}`,
  });
  return json({ ok: true, item: updated ? toSafeSecretItem(updated) : null, audit_ok: auditOk });
}

async function revokeKey(request, env, scope, id) {
  const row = await getUserSecretScoped(env, { userId: scope.userId, tenantId: scope.tenantId, secretId: id });
  if (!row) return json({ ok: false, error: 'not_found' }, 404);
  const meta = parseSecretMetadata(row);
  await revokeUserSecret(env, { userId: scope.userId, secretId: id });
  const auditOk = await writeAudit(env, request, scope, { secretId: id, eventType: 'revoked', previousLast4: meta.last_four || null, notes: 'Credential revoked' });
  return json({ ok: true, revoked: true, audit_ok: auditOk });
}

async function revealKey(request, env, scope, id) {
  const rl = await rateLimit(env, `key_reveal:${scope.userId}`, 8, 300);
  if (!rl.allowed) return json({ ok: false, error: 'rate_limited', ...rl }, 429, { 'retry-after': String(rl.retry_after_sec || 300) });
  const row = await getUserSecretScoped(env, { userId: scope.userId, tenantId: scope.tenantId, secretId: id });
  if (!row) return json({ ok: false, error: 'not_found' }, 404);
  const value = await decryptUserSecretPlaintext(env, { userId: scope.userId, tenantId: scope.tenantId, secretId: id });
  if (!value) return json({ ok: false, error: 'decrypt_failed' }, 500);
  const meta = parseSecretMetadata(row);
  const auditOk = await writeAudit(env, request, scope, { secretId: id, eventType: 'revealed', notes: `Revealed ${meta.provider || row.service_name || 'credential'}` });
  if (!auditOk) return json({ ok: false, error: 'audit_unavailable', message: 'Reveal blocked because the audit write could not be guaranteed.' }, 503);
  return json({ ok: true, value, expires_in_sec: 30, last_four: meta.last_four || null, provider: meta.provider || row.service_name || null });
}

async function validateKey(request, env, scope, id = null) {
  const rl = await rateLimit(env, `key_validate:${scope.userId}`, 10, 60);
  if (!rl.allowed) return json({ ok: false, error: 'rate_limited', ...rl }, 429, { 'retry-after': String(rl.retry_after_sec || 60) });
  const body = await request.json().catch(() => ({}));
  let provider = trim(body?.provider).toLowerCase();
  let apiKey = normalizeApiKeySecret(body?.api_key || body?.secret_value || '');
  let accountId = trim(body?.cloudflare_account_id).replace(/\s+/g, '');
  if (id) {
    const row = await getUserSecretScoped(env, { userId: scope.userId, tenantId: scope.tenantId, secretId: id });
    if (!row) return json({ ok: false, error: 'not_found' }, 404);
    const meta = parseSecretMetadata(row);
    provider = trim(meta.provider || row.service_name).toLowerCase();
    apiKey = await decryptUserSecretPlaintext(env, { userId: scope.userId, tenantId: scope.tenantId, secretId: id }) || '';
    accountId ||= trim(meta.cloudflare_account_id);
  }
  if (!PROVIDERS.has(provider)) return json({ ok: false, error: 'provider_invalid' }, 400);
  if (!apiKey) return json({ ok: false, error: 'secret_value_required' }, 400);
  const result = await validateProviderKey(provider, apiKey, env, { cloudflare_account_id: accountId });
  if (id) {
    await updateUserSecretMetadata(env, {
      userId: scope.userId,
      tenantId: scope.tenantId,
      secretId: id,
      patchMeta: { validation_status: result.ok ? 'pass' : 'fail', validated_at: nowUnix(), validation_checks: result.checks || [] },
    });
    await writeAudit(env, request, scope, { secretId: id, eventType: 'validated', notes: result.ok ? 'Validation passed' : 'Validation failed' });
  }
  return json(result, result.ok ? 200 : 400);
}

async function cloudflareCatalog(env, scope, kind) {
  const key = await resolveProviderCredential(env, { userId: scope.userId, tenantId: scope.tenantId, provider: 'cloudflare' });
  if (!key) return json({ ok: false, error: 'cloudflare_key_required' }, 400);
  const rows = await listUserSecrets(env, { userId: scope.userId, tenantId: scope.tenantId, categoryFilter: 'provider' });
  const cloudflare = rows.find((item) => item.provider === 'cloudflare');
  const raw = cloudflare ? await getUserSecretScoped(env, { userId: scope.userId, tenantId: scope.tenantId, secretId: cloudflare.id }) : null;
  const accountId = trim(parseSecretMetadata(raw).cloudflare_account_id);
  if (!accountId) return json({ ok: false, error: 'cloudflare_account_id_required' }, 400);
  const endpoint = kind === 'zones'
    ? `https://api.cloudflare.com/client/v4/zones?account.id=${encodeURIComponent(accountId)}&per_page=100`
    : `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database?per_page=100`;
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.success === false) return json({ ok: false, error: 'cloudflare_catalog_failed', detail: body?.errors?.[0]?.message || `HTTP ${response.status}` }, 502);
  return json({ ok: true, account_id_mask: `••••${accountId.slice(-4)}`, items: body?.result || [] });
}

async function selectCloudflareD1(request, env, scope) {
  const body = await request.json().catch(() => null);
  const databaseId = trim(body?.database_id);
  if (!databaseId || databaseId.length > 80) return json({ ok: false, error: 'database_id_required' }, 400);
  const catalogResponse = await cloudflareCatalog(env, scope, 'd1');
  if (!catalogResponse.ok) return catalogResponse;
  const catalog = await catalogResponse.clone().json().catch(() => ({}));
  const selected = (catalog?.items || []).find((item) => String(item?.uuid || item?.id || '') === databaseId);
  if (!selected) return json({ ok: false, error: 'database_not_authorized' }, 403);

  const current = await env.DB.prepare('SELECT settings_json FROM workspace_settings WHERE workspace_id = ? LIMIT 1')
    .bind(scope.workspaceId).first().catch(() => null);
  let settings = {};
  try { settings = current?.settings_json ? JSON.parse(String(current.settings_json)) : {}; } catch { settings = {}; }
  settings = { ...settings, cloudflare_d1_database_id: databaseId, cloudflare_d1_database_name: selected?.name || null };
  await env.DB.prepare(
    `INSERT INTO workspace_settings (workspace_id, settings_json, updated_at)
     VALUES (?, ?, unixepoch())
     ON CONFLICT(workspace_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
  ).bind(scope.workspaceId, JSON.stringify(settings)).run();
  return json({ ok: true, database_id: databaseId, database_name: selected?.name || null });
}

export async function handleKeysRequest(request, env, _identity, scope) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  if (path === '/api/settings/keys/providers' && request.method === 'GET') return json({ ok: true, providers: PROVIDER_OPTIONS });
  if (path === '/api/settings/keys/audit' && request.method === 'GET') return readAudit(env, scope, url);
  if (path === '/api/settings/keys/hints' && request.method === 'GET') return json({ ok: true, workspace_id: scope.workspaceId, vault_configured: isVaultConfigured(env), scope: 'user' });
  if (path === '/api/settings/keys/cloudflare/d1' && request.method === 'GET') return cloudflareCatalog(env, scope, 'd1');
  if (path === '/api/settings/keys/cloudflare/zones' && request.method === 'GET') return cloudflareCatalog(env, scope, 'zones');
  if (path === '/api/settings/keys/cloudflare/d1/select' && request.method === 'POST') return selectCloudflareD1(request, env, scope);
  if (path === '/api/settings/keys/validate' && request.method === 'POST') return validateKey(request, env, scope);
  if (path === '/api/settings/keys' && request.method === 'GET') return listKeys(env, scope, url);
  if (path === '/api/settings/keys' && request.method === 'POST') return createKey(request, env, scope);

  const match = path.match(/^\/api\/settings\/keys\/([^/]+)(?:\/(validate|reveal|rotate))?$/);
  if (!match) return null;
  const id = decodeURIComponent(match[1]);
  const action = match[2] || '';
  if (action === 'validate' && request.method === 'POST') return validateKey(request, env, scope, id);
  if (action === 'reveal' && request.method === 'POST') return revealKey(request, env, scope, id);
  if (action === 'rotate' && request.method === 'POST') return rotateKey(request, env, scope, id);
  if (!action && request.method === 'PATCH') return patchKey(request, env, scope, id);
  if (!action && request.method === 'DELETE') return revokeKey(request, env, scope, id);
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
