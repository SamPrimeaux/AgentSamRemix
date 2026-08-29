/**
 * Provider key validation — server-side only; never log secret values.
 */

const VALIDATE_TIMEOUT_MS = 12_000;

const CF_INVALID_TOKEN_HINT =
  'Use an API Token from Cloudflare Dashboard → My Profile → API Tokens (Create Token). ' +
  'Do not paste the legacy Global API Key from My Profile → API Keys — that format is not supported here. ' +
  'Required permissions: Account → Read, and D1 → Read (plus any services you need).';

/** Strip paste artifacts (Bearer prefix, whitespace, zero-width chars). */
export function normalizeApiKeySecret(raw) {
  let s = String(raw ?? '');
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
  s = s.trim();
  if (/^bearer\s+/i.test(s)) s = s.replace(/^bearer\s+/i, '').trim();
  s = s.replace(/\s+/g, '');
  return s;
}

async function fetchWithTimeout(url, init, timeoutMs = VALIDATE_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function summarizeModelIds(ids, label = 'models') {
  const list = ids.filter(Boolean).map(String);
  if (!list.length) return null;
  const sample = list.slice(0, 6).join(', ');
  return `${list.length} ${label} (e.g. ${sample}${list.length > 6 ? '…' : ''})`;
}

async function parseJsonBody(res) {
  return res.json().catch(() => ({}));
}

function check(id, status, latencyMs, detail = null, extra = {}) {
  return {
    id,
    status: status === 'pass' ? 'pass' : 'fail',
    latency_ms: latencyMs,
    ...(detail != null ? { detail: String(detail).slice(0, 500) } : {}),
    ...extra,
  };
}

/**
 * @param {string} provider
 * @param {string} apiKey
 * @param {object} [env]
 * @param {{ cloudflare_account_id?: string|null }} [opts]
 * @returns {Promise<{ ok: boolean, provider: string, checks: object[], warnings: string[] }>}
 */
export async function validateProviderKey(provider, apiKey, env = {}, opts = {}) {
  const prov = String(provider || '').trim().toLowerCase();
  const key = normalizeApiKeySecret(apiKey);
  const warnings = [];
  const checks = [];

  if (!key) {
    return { ok: false, provider: prov, checks: [check('non_empty', 'fail', 0, 'API key is required')], warnings };
  }

  const t0 = Date.now();
  try {
    if (prov === 'cloudflare') {
      const submittedAccountId =
        opts.cloudflare_account_id != null && String(opts.cloudflare_account_id).trim()
          ? String(opts.cloudflare_account_id).trim().replace(/\s+/g, '')
          : null;

      if (!submittedAccountId) {
        checks.push(check('account_id', 'fail', 0, 'Cloudflare Account ID is required'));
        return { ok: false, provider: prov, checks, warnings };
      }
      if (!/^[a-f0-9]{32}$/i.test(submittedAccountId)) {
        checks.push(
          check(
            'account_id',
            'fail',
            0,
            'Account ID must be 32 hex characters (Dashboard → Account Home → right sidebar)',
          ),
        );
        return { ok: false, provider: prov, checks, warnings };
      }

      const verifyRes = await fetchWithTimeout('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
      });
      const verifyBody = await verifyRes.json().catch(() => ({}));
      const ms = Date.now() - t0;
      if (!verifyRes.ok || verifyBody?.success === false) {
        const cfMsg = verifyBody?.errors?.[0]?.message || `HTTP ${verifyRes.status}`;
        const detail =
          /invalid api token/i.test(String(cfMsg)) || /invalid access token/i.test(String(cfMsg))
            ? CF_INVALID_TOKEN_HINT
            : cfMsg;
        checks.push(check('token_verify', 'fail', ms, detail));
        return {
          ok: false,
          provider: prov,
          checks,
          warnings,
          message: detail,
        };
      }
      checks.push(check('token_verify', 'pass', ms, 'Token is valid'));

      const t1 = Date.now();
      const acctRes = await fetchWithTimeout(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(submittedAccountId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        },
      );
      const acctBody = await acctRes.json().catch(() => ({}));
      const ms2 = Date.now() - t1;
      if (acctRes.ok && acctBody?.success !== false) {
        checks.push(check('account_read', 'pass', ms2, acctBody?.result?.name || 'Account readable'));
      } else {
        checks.push(
          check('account_read', 'fail', ms2, 'Token cannot read this account (scope or wrong account ID)'),
        );
        return { ok: false, provider: prov, checks, warnings };
      }
      return { ok: true, provider: prov, checks, warnings };
    }

    if (prov === 'openai') {
      const res = await fetchWithTimeout('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      const ms = Date.now() - t0;
      const body = await parseJsonBody(res);
      if (!res.ok) {
        const err = body?.error?.message || `HTTP ${res.status}`;
        checks.push(check('models_list', 'fail', ms, err));
        return { ok: false, provider: prov, checks, warnings };
      }
      const ids = Array.isArray(body?.data) ? body.data.map((m) => m?.id) : [];
      const detail = summarizeModelIds(ids) || 'OpenAI API accepted key';
      checks.push(check('models_list', 'pass', ms, detail, { model_count: ids.length, models_sample: ids.slice(0, 12) }));
      return { ok: true, provider: prov, checks, warnings };
    }

    if (prov === 'cursor') {
      // Cursor User API keys — Basic (-u key:) or Bearer both accepted by api.cursor.com.
      const authHeader = `Basic ${btoa(`${key}:`)}`;
      const res = await fetchWithTimeout('https://api.cursor.com/v0/me', {
        headers: { Authorization: authHeader },
      });
      const ms = Date.now() - t0;
      const body = await parseJsonBody(res);
      if (!res.ok) {
        const err = body?.message || body?.error?.message || `HTTP ${res.status}`;
        checks.push(check('cursor_me', 'fail', ms, err));
        return { ok: false, provider: prov, checks, warnings };
      }
      const name = body?.apiKeyName || body?.api_key_name || body?.userEmail || body?.email || 'OK';
      checks.push(check('cursor_me', 'pass', ms, `Cursor API key ok (${name})`));
      return { ok: true, provider: prov, checks, warnings };
    }

    if (prov === 'anthropic') {
      const res = await fetchWithTimeout('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
      });
      const ms = Date.now() - t0;
      const body = await parseJsonBody(res);
      if (!res.ok) {
        const err = body?.error?.message || body?.error?.type || `HTTP ${res.status}`;
        checks.push(check('models_list', 'fail', ms, err));
        return { ok: false, provider: prov, checks, warnings };
      }
      const ids = Array.isArray(body?.data) ? body.data.map((m) => m?.id || m?.name) : [];
      const detail = summarizeModelIds(ids) || 'Anthropic API accepted key';
      checks.push(check('models_list', 'pass', ms, detail, { model_count: ids.length, models_sample: ids.slice(0, 12) }));
      return { ok: true, provider: prov, checks, warnings };
    }

    if (prov === 'google') {
      const res = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      );
      const ms = Date.now() - t0;
      const body = await parseJsonBody(res);
      if (!res.ok) {
        const err = body?.error?.message || `HTTP ${res.status}`;
        checks.push(check('models_list', 'fail', ms, err));
        return { ok: false, provider: prov, checks, warnings };
      }
      const ids = Array.isArray(body?.models)
        ? body.models.map((m) => String(m?.name || '').replace(/^models\//, ''))
        : [];
      const detail = summarizeModelIds(ids, 'Gemini models') || 'Google AI API accepted key';
      checks.push(check('models_list', 'pass', ms, detail, { model_count: ids.length, models_sample: ids.slice(0, 12) }));
      return { ok: true, provider: prov, checks, warnings };
    }

    if (prov === 'github') {
      const res = await fetchWithTimeout('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'InnerAnimalMedia-KeyValidate/1.0',
        },
      });
      const ms = Date.now() - t0;
      if (!res.ok) {
        checks.push(check('user', 'fail', ms, `HTTP ${res.status}`));
        return { ok: false, provider: prov, checks, warnings };
      }
      const body = await parseJsonBody(res);
      checks.push(check('user', 'pass', ms, body?.login ? `GitHub user: ${body.login}` : 'OK'));
      return { ok: true, provider: prov, checks, warnings };
    }

    if (prov === 'resend') {
      const res = await fetchWithTimeout('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${key}` },
      });
      const ms = Date.now() - t0;
      const body = await parseJsonBody(res);
      if (!res.ok) {
        checks.push(check('domains', 'fail', ms, `HTTP ${res.status}`));
        return { ok: false, provider: prov, checks, warnings };
      }
      const domainCount = Array.isArray(body?.data) ? body.data.length : 0;
      checks.push(
        check(
          'domains',
          'pass',
          ms,
          domainCount ? `Resend: ${domainCount} domain(s)` : 'Resend API accepted key',
          { domain_count: domainCount },
        ),
      );
      return { ok: true, provider: prov, checks, warnings };
    }

    if (prov === 'supabase') {
      const base =
        env.SUPABASE_URL && String(env.SUPABASE_URL).trim()
          ? String(env.SUPABASE_URL).replace(/\/$/, '')
          : null;
      if (!base) {
        warnings.push('SUPABASE_URL not configured; skipped Supabase validate.');
        checks.push(check('supabase', 'pass', 0, 'Skipped (no SUPABASE_URL)'));
        return { ok: true, provider: prov, checks, warnings };
      }
      const res = await fetchWithTimeout(`${base}/rest/v1/`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      });
      const ms = Date.now() - t0;
      if (res.status === 401 || res.status === 403) {
        checks.push(check('rest_ping', 'fail', ms, `HTTP ${res.status}`));
        return { ok: false, provider: prov, checks, warnings };
      }
      checks.push(check('rest_ping', 'pass', ms, `HTTP ${res.status}`));
      return { ok: true, provider: prov, checks, warnings };
    }

    if (prov === 'meshy') {
      const res = await fetchWithTimeout('https://api.meshy.ai/openapi/v1/balance', {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      });
      const ms = Date.now() - t0;
      const body = await parseJsonBody(res);
      if (!res.ok) {
        checks.push(check('balance', 'fail', ms, body?.message || `HTTP ${res.status}`));
        return { ok: false, provider: prov, checks, warnings };
      }
      const balance = body?.balance ?? body?.credits;
      checks.push(
        check(
          'balance',
          'pass',
          ms,
          balance != null ? `Meshy balance: ${balance} credits` : 'Meshy API accepted key',
          { balance },
        ),
      );
      return { ok: true, provider: prov, checks, warnings };
    }

    if (prov === 'other') {
      checks.push(check('format', 'pass', 0, 'No remote validator for provider "other"'));
      warnings.push('Save only if you trust this secret; no automated validation.');
      return { ok: true, provider: prov, checks, warnings };
    }

    return {
      ok: false,
      provider: prov,
      checks: [check('unsupported_provider', 'fail', 0, `No validator for ${prov}`)],
      warnings,
    };
  } catch (e) {
    const ms = Date.now() - t0;
    checks.push(check('network', 'fail', ms, e?.name === 'AbortError' ? 'timeout' : e?.message || 'error'));
    return { ok: false, provider: prov, checks, warnings };
  }
}

const RL_PREFIX = 'key_validate_rl:';
const RL_MAX = 10;
const RL_TTL = 60;

const REVEAL_RL_PREFIX = 'key_reveal_rl:';
const REVEAL_RL_MAX = 8;
const REVEAL_RL_TTL = 300;

/** @returns {Promise<{ allowed: boolean, retry_after_sec?: number }>} */
export async function checkValidateRateLimit(env, userId) {
  const uid = String(userId || '').trim();
  if (!uid || !env?.SESSION_CACHE) return { allowed: true };
  const k = `${RL_PREFIX}${uid}`;
  try {
    const raw = await env.SESSION_CACHE.get(k);
    const n = raw ? parseInt(raw, 10) : 0;
    if (Number.isFinite(n) && n >= RL_MAX) {
      return { allowed: false, retry_after_sec: RL_TTL };
    }
    await env.SESSION_CACHE.put(k, String((Number.isFinite(n) ? n : 0) + 1), { expirationTtl: RL_TTL });
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

/** Reveal is audited and rate-limited per authenticated user. */
export async function checkRevealRateLimit(env, userId) {
  const uid = String(userId || '').trim();
  if (!uid || !env?.SESSION_CACHE) return { allowed: true };
  const k = `${REVEAL_RL_PREFIX}${uid}`;
  try {
    const raw = await env.SESSION_CACHE.get(k);
    const n = raw ? parseInt(raw, 10) : 0;
    if (Number.isFinite(n) && n >= REVEAL_RL_MAX) {
      return { allowed: false, retry_after_sec: REVEAL_RL_TTL };
    }
    await env.SESSION_CACHE.put(k, String((Number.isFinite(n) ? n : 0) + 1), {
      expirationTtl: REVEAL_RL_TTL,
    });
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}
