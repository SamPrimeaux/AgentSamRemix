/** Fixed-destination provider key validation. Never logs or returns secret values. */
const VALIDATE_TIMEOUT_MS = 12_000;

export function normalizeApiKeySecret(raw) {
  let value = String(raw ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (/^bearer\s+/i.test(value)) value = value.replace(/^bearer\s+/i, '').trim();
  return value.replace(/\s+/g, '');
}

async function fetchWithTimeout(url, init = {}, timeoutMs = VALIDATE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function check(id, ok, latencyMs, detail, extra = {}) {
  return {
    id,
    status: ok ? 'pass' : 'fail',
    latency_ms: latencyMs,
    ...(detail ? { detail: String(detail).slice(0, 500) } : {}),
    ...extra,
  };
}

async function parseJson(response) {
  return response.json().catch(() => ({}));
}

function sampleIds(ids, label = 'models') {
  const clean = ids.filter(Boolean).map(String);
  if (!clean.length) return null;
  return `${clean.length} ${label} (e.g. ${clean.slice(0, 6).join(', ')}${clean.length > 6 ? '…' : ''})`;
}

export async function validateProviderKey(provider, rawKey, env = {}, opts = {}) {
  const prov = String(provider || '').trim().toLowerCase();
  const key = normalizeApiKeySecret(rawKey);
  const checks = [];
  const warnings = [];
  if (!key) return { ok: false, provider: prov, checks: [check('non_empty', false, 0, 'API key is required')], warnings };

  const t0 = Date.now();
  try {
    if (prov === 'openai') {
      const response = await fetchWithTimeout('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
      const body = await parseJson(response);
      const ms = Date.now() - t0;
      if (!response.ok) return { ok: false, provider: prov, checks: [check('models_list', false, ms, body?.error?.message || `HTTP ${response.status}`)], warnings };
      const ids = Array.isArray(body?.data) ? body.data.map((model) => model?.id) : [];
      checks.push(check('models_list', true, ms, sampleIds(ids) || 'OpenAI API accepted key', { model_count: ids.length, models_sample: ids.slice(0, 12) }));
      return { ok: true, provider: prov, checks, warnings };
    }

    if (prov === 'anthropic') {
      const response = await fetchWithTimeout('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      });
      const body = await parseJson(response);
      const ms = Date.now() - t0;
      if (!response.ok) return { ok: false, provider: prov, checks: [check('models_list', false, ms, body?.error?.message || `HTTP ${response.status}`)], warnings };
      const ids = Array.isArray(body?.data) ? body.data.map((model) => model?.id || model?.name) : [];
      checks.push(check('models_list', true, ms, sampleIds(ids) || 'Anthropic API accepted key', { model_count: ids.length, models_sample: ids.slice(0, 12) }));
      return { ok: true, provider: prov, checks, warnings };
    }

    if (prov === 'google') {
      const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
      const body = await parseJson(response);
      const ms = Date.now() - t0;
      if (!response.ok) return { ok: false, provider: prov, checks: [check('models_list', false, ms, body?.error?.message || `HTTP ${response.status}`)], warnings };
      const ids = Array.isArray(body?.models) ? body.models.map((model) => String(model?.name || '').replace(/^models\//, '')) : [];
      checks.push(check('models_list', true, ms, sampleIds(ids, 'Gemini models') || 'Google AI API accepted key', { model_count: ids.length, models_sample: ids.slice(0, 12) }));
      return { ok: true, provider: prov, checks, warnings };
    }

    if (prov === 'cloudflare') {
      const accountId = String(opts?.cloudflare_account_id || '').trim().replace(/\s+/g, '');
      if (!/^[a-f0-9]{32}$/i.test(accountId)) {
        return { ok: false, provider: prov, checks: [check('account_id', false, 0, 'Cloudflare Account ID must be 32 hex characters')], warnings };
      }
      const verify = await fetchWithTimeout('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      });
      const verifyBody = await parseJson(verify);
      const verifyMs = Date.now() - t0;
      if (!verify.ok || verifyBody?.success === false) {
        return { ok: false, provider: prov, checks: [check('token_verify', false, verifyMs, verifyBody?.errors?.[0]?.message || `HTTP ${verify.status}`)], warnings };
      }
      checks.push(check('token_verify', true, verifyMs, 'Token is valid'));
      const t1 = Date.now();
      const account = await fetchWithTimeout(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`, {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      });
      const accountBody = await parseJson(account);
      const accountMs = Date.now() - t1;
      const readable = account.ok && accountBody?.success !== false;
      checks.push(check('account_read', readable, accountMs, readable ? accountBody?.result?.name || 'Account readable' : 'Token cannot read this account'));
      return { ok: readable, provider: prov, checks, warnings };
    }

    if (prov === 'github') {
      const response = await fetchWithTimeout('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/vnd.github+json', 'User-Agent': 'AgentSamRemix-KeyValidate/1.0' },
      });
      const body = await parseJson(response);
      const ms = Date.now() - t0;
      const ok = response.ok;
      checks.push(check('user', ok, ms, ok ? `GitHub user: ${body?.login || 'OK'}` : `HTTP ${response.status}`));
      return { ok, provider: prov, checks, warnings };
    }

    if (prov === 'cursor') {
      const response = await fetchWithTimeout('https://api.cursor.com/v0/me', {
        headers: { Authorization: `Basic ${btoa(`${key}:`)}` },
      });
      const body = await parseJson(response);
      const ms = Date.now() - t0;
      const ok = response.ok;
      checks.push(check('cursor_me', ok, ms, ok ? `Cursor API key ok (${body?.apiKeyName || body?.userEmail || body?.email || 'OK'})` : body?.message || `HTTP ${response.status}`));
      return { ok, provider: prov, checks, warnings };
    }

    if (prov === 'resend') {
      const response = await fetchWithTimeout('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } });
      const body = await parseJson(response);
      const ms = Date.now() - t0;
      const ok = response.ok;
      const count = Array.isArray(body?.data) ? body.data.length : 0;
      checks.push(check('domains', ok, ms, ok ? `${count} Resend domain(s)` : `HTTP ${response.status}`, { domain_count: count }));
      return { ok, provider: prov, checks, warnings };
    }

    if (prov === 'supabase') {
      const base = String(env?.SUPABASE_URL || '').trim().replace(/\/$/, '');
      if (!base) {
        warnings.push('SUPABASE_URL is not configured; only secret storage can be verified.');
        checks.push(check('format', true, 0, 'Saved without remote Supabase validation'));
        return { ok: true, provider: prov, checks, warnings };
      }
      const response = await fetchWithTimeout(`${base}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      const ms = Date.now() - t0;
      const ok = response.status !== 401 && response.status !== 403;
      checks.push(check('rest_ping', ok, ms, `HTTP ${response.status}`));
      return { ok, provider: prov, checks, warnings };
    }

    if (prov === 'meshy') {
      const response = await fetchWithTimeout('https://api.meshy.ai/openapi/v1/balance', {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      });
      const body = await parseJson(response);
      const ms = Date.now() - t0;
      const ok = response.ok;
      checks.push(check('balance', ok, ms, ok ? `Meshy balance: ${body?.balance ?? body?.credits ?? 'available'}` : body?.message || `HTTP ${response.status}`));
      return { ok, provider: prov, checks, warnings };
    }

    if (prov === 'other') {
      warnings.push('No remote validator exists for provider "other".');
      checks.push(check('format', true, 0, 'Non-empty secret accepted'));
      return { ok: true, provider: prov, checks, warnings };
    }

    return { ok: false, provider: prov, checks: [check('unsupported_provider', false, 0, `No validator for ${prov}`)], warnings };
  } catch (error) {
    const ms = Date.now() - t0;
    const detail = error?.name === 'AbortError' ? 'Validation timed out' : error?.message || 'Validation failed';
    return { ok: false, provider: prov, checks: [check('network', false, ms, detail)], warnings };
  }
}
