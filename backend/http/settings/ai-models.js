/**
 * AI model catalog + BYOK provider key settings.
 * - GET    /api/settings/ai-models/usage
 * - GET    /api/settings/ai-models
 * - POST   /api/settings/ai-models
 * - POST   /api/settings/ai-models/keys
 * - DELETE /api/settings/ai-models/keys/:provider
 * - GET/PATCH/DELETE /api/settings/ai-models/:model_key
 * Deconstructed from src/api/settings.js (Lane D peel D5, no behavior change).
 */
import { httpJsonResponse as jsonResponse } from '../responses.js';
import { fetchAuthUserTenantId } from '../../identity/users/tenant.js';
import { userMayUseWorkspaceCredentials } from '../../identity/workspace/grants.js';
import { handleSettingsKeysRoutes } from './keys.js';

async function resolveAuthTenantId(env, authUser) {
  if (authUser.tenant_id != null && String(authUser.tenant_id).trim() !== '') {
    return String(authUser.tenant_id).trim();
  }
  let tid = await fetchAuthUserTenantId(env, authUser.id);
  if (tid) return tid;
  if (authUser.email) {
    tid = await fetchAuthUserTenantId(env, authUser.email);
    if (tid) return tid;
  }
  return null;
}

export async function handleSettingsAiModelsRoutes(request, env, ctx, authContext) {
  const { authUser, identity, url, pathLower, method } = authContext || {};
  if (!authUser) return null;

  const workspaceId = identity?.workspace?.id || null;

  const isAiModelsPath = pathLower === '/api/settings/ai-models' || pathLower.startsWith('/api/settings/ai-models/');
  if (!isAiModelsPath) return null;

  // ── AI Models catalog + BYOK (/api/settings/ai-models*) ───────────────────
  const normalizeAiProviderSlug = (p) => {
    const s = String(p || '').trim().toLowerCase();
    if (s === 'google' || s === 'gemini' || s === 'google_ai') return 'google_ai';
    if (s === 'anthropic') return 'anthropic';
    if (s === 'cursor') return 'cursor';
    if (s === 'openai') return 'openai';
    if (s === 'cloudflare' || s === 'workers_ai' || s === 'cloudflare_workers_ai') return 'cloudflare';
    if (s === 'ollama') return 'ollama';
    return s;
  };

  const providerSlugForKeysApi = (slug) => {
    const s = normalizeAiProviderSlug(slug);
    if (s === 'google_ai') return 'google';
    return s;
  };

  const canManageAiModelCatalog = async (user) =>
    userMayUseWorkspaceCredentials(env, user, workspaceId);

  const providerUiOrder = (slug) => {
    const k = normalizeAiProviderSlug(slug);
    const order = { openai: 0, anthropic: 1, google_ai: 2, google: 2, cloudflare: 3, ollama: 4 };
    return order[k] != null ? order[k] : 100 + k.charCodeAt(0);
  };

  async function validateAiKeyProbe(providerNorm, rawKey) {
    const k = String(rawKey || '');
    if (!k.trim()) return { ok: false, error: 'Key required' };
    if (providerNorm === 'cursor') {
      const r = await fetch('https://api.cursor.com/v0/me', {
        headers: { Authorization: `Basic ${btoa(`${k}:`)}` },
      });
      return r.ok ? { ok: true } : { ok: false, error: `Cursor validation failed (${r.status})` };
    }
    if (providerNorm === 'openai') {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${k}` },
      });
      return r.ok ? { ok: true } : { ok: false, error: `OpenAI validation failed (${r.status})` };
    }
    if (providerNorm === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': k,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      return r.ok ? { ok: true } : { ok: false, error: `Anthropic validation failed (${r.status})` };
    }
    if (providerNorm === 'google_ai' || providerNorm === 'google') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`;
      const r = await fetch(url);
      return r.ok ? { ok: true } : { ok: false, error: `Google AI validation failed (${r.status})` };
    }
    return { ok: true };
  }

  if (pathLower === '/api/settings/ai-models/usage' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const tenantId = await resolveAuthTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'tenant required' }, 400);
    try {
      const { results } = await env.DB.prepare(
        `SELECT provider, model,
            SUM(cost_usd) AS cost_30d,
            SUM(tokens_in + tokens_out) AS tokens_30d,
            COUNT(*) AS calls_30d
         FROM agentsam_usage_events
         WHERE tenant_id = ? AND created_at > unixepoch() - 2592000
         GROUP BY provider, model
         ORDER BY cost_30d DESC`,
      )
        .bind(tenantId)
        .all();
      const usage = (results || []).map((row) => ({
        provider: row.provider != null ? String(row.provider) : '',
        model: row.model != null ? String(row.model) : '',
        cost_30d: Number(row.cost_30d) || 0,
        tokens_30d: Number(row.tokens_30d) || 0,
        calls_30d: Number(row.calls_30d) || 0,
      }));
      return jsonResponse({ usage });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  const CATALOG_PROVIDERS = new Set([
    'anthropic',
    'openai',
    'google',
    'workers_ai',
    'ollama',
    'cursor',
    'deepseek',
  ]);
  const CATALOG_TIERS = new Set(['lite', 'fast', 'standard', 'heavy', 'reasoning', 'specialized']);

  const normalizeCatalogProvider = (p) => {
    const s = String(p || '').trim().toLowerCase();
    if (s === 'google_ai' || s === 'gemini' || s === 'google') return 'google';
    if (s === 'cloudflare' || s === 'cloudflare_workers_ai' || s === 'workers_ai') return 'workers_ai';
    if (s === 'openai' || s === 'cursor') return s === 'cursor' ? 'cursor' : 'openai';
    return s;
  };

  const mapCatalogModelForSettings = (m) => {
    const active = Number(m.is_active) === 1;
    const ap = m.api_platform != null ? String(m.api_platform) : '';
    return {
      model_key: m.model_key != null ? String(m.model_key) : '',
      display_name:
        m.display_name != null && String(m.display_name).trim() !== ''
          ? String(m.display_name)
          : m.model_key != null
            ? String(m.model_key)
            : '',
      status: active ? 'active' : 'inactive',
      is_active: active,
      show_in_picker: Number(m.show_in_picker) === 1,
      picker_eligible: true,
      supports_tools: Number(m.supports_tools) === 1,
      supports_vision: Number(m.supports_vision) === 1,
      supports_cache: Number(m.cost_per_1k_cached_in) > 0,
      supports_thinking: Number(m.supports_reasoning) === 1 || Number(m.supports_adaptive_thinking) === 1,
      supports_structured_output: Number(m.supports_json_mode) === 1,
      supports_responses_api: /responses/i.test(ap),
      context_max_tokens:
        m.context_window != null && m.context_window !== '' ? Number(m.context_window) : null,
      input_rate_per_mtok:
        m.cost_per_1k_in != null && m.cost_per_1k_in !== ''
          ? Number(m.cost_per_1k_in) * 1000
          : null,
      output_rate_per_mtok:
        m.cost_per_1k_out != null && m.cost_per_1k_out !== ''
          ? Number(m.cost_per_1k_out) * 1000
          : null,
      size_class: m.tier != null ? String(m.tier) : '',
      tier: m.tier != null ? String(m.tier) : '',
      sort_order: 0,
      provider: m.provider != null ? String(m.provider) : '',
      api_platform: ap,
    };
  };

  if (pathLower === '/api/settings/ai-models' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const tenantId = await resolveAuthTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'tenant required' }, 400);
    const storeUserId = String(authUser.id || '').trim();
    try {
      const { results: modelRows } = await env.DB.prepare(
        `SELECT *
         FROM agentsam_model_catalog
         WHERE model_key IS NOT NULL
         ORDER BY provider, display_name, model_key`,
      ).all();

      const { results: usageRows } = await env.DB.prepare(
        `SELECT provider,
            SUM(cost_usd) AS cost_30d,
            SUM(tokens_in + tokens_out) AS tokens_30d,
            COUNT(*) AS calls_30d
         FROM agentsam_usage_events
         WHERE tenant_id = ? AND created_at > unixepoch() - 2592000
         GROUP BY provider`,
      )
        .bind(tenantId)
        .all();

      let keyRows = [];
      try {
        const q = await env.DB.prepare(
          `SELECT service_name, metadata_json, description
             FROM user_secrets
            WHERE user_id = ?
              AND COALESCE(is_active, 1) = 1
              AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)`,
        )
          .bind(storeUserId, tenantId)
          .all();
        keyRows = (q?.results || []).map((r) => {
          let meta = {};
          try {
            meta = JSON.parse(String(r.metadata_json || '{}'));
          } catch {
            meta = {};
          }
          const provider = String(meta.provider || r.service_name || '').toLowerCase();
          const last4 = meta.last_four || meta.last4 || '????';
          return {
            provider,
            key_name: r.description || provider,
            key_preview: last4,
            is_active: 1,
            last_used_at: null,
          };
        });
      } catch (_) {
        keyRows = [];
      }

      const usageByProv = new Map();
      for (const r of usageRows || []) {
        usageByProv.set(
          normalizeAiProviderSlug(r.provider),
          {
            cost_30d: Number(r.cost_30d) || 0,
            tokens_30d: Number(r.tokens_30d) || 0,
            calls_30d: Number(r.calls_30d) || 0,
          },
        );
      }

      const keysByProv = new Map();
      for (const r of keyRows) {
        const slug = normalizeAiProviderSlug(r.provider);
        if (!keysByProv.has(slug)) keysByProv.set(slug, r);
      }

      const bySlug = new Map();
      for (const m of modelRows || []) {
        const slug = normalizeAiProviderSlug(m.provider);
        if (!bySlug.has(slug)) {
          bySlug.set(slug, {
            provider: slug,
            api_platform: m.api_platform != null ? String(m.api_platform) : '',
            has_personal_key: !!keysByProv.get(slug),
            key_preview: keysByProv.get(slug)?.key_preview != null ? String(keysByProv.get(slug).key_preview) : null,
            cost_30d: usageByProv.get(slug)?.cost_30d ?? 0,
            tokens_30d: usageByProv.get(slug)?.tokens_30d ?? 0,
            calls_30d: usageByProv.get(slug)?.calls_30d ?? 0,
            models: [],
          });
        }
        const bucket = bySlug.get(slug);
        if (!bucket.api_platform && m.api_platform) bucket.api_platform = String(m.api_platform);
        bucket.models.push(mapCatalogModelForSettings(m));
      }

      const providers = Array.from(bySlug.values()).sort(
        (a, b) => providerUiOrder(a.provider) - providerUiOrder(b.provider) || a.provider.localeCompare(b.provider),
      );

      for (const p of providers) {
        const kr = keysByProv.get(p.provider);
        p.has_personal_key = !!kr;
        p.key_preview = kr?.key_preview != null ? String(kr.key_preview) : null;
      }

      return jsonResponse({
        providers,
        can_manage_catalog: await canManageAiModelCatalog(authUser),
      });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  if (pathLower === '/api/settings/ai-models' && method === 'POST') {
    if (!(await canManageAiModelCatalog(authUser))) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const body = await request.json().catch(() => ({}));
    const modelKey = String(body.model_key || '').trim();
    const displayName = String(body.display_name || '').trim();
    const provider = normalizeCatalogProvider(body.provider);
    const tier = String(body.tier || '').trim().toLowerCase();
    const contextWindow = Number(body.context_window ?? body.context_max_tokens);
    const maxOutputTokens = Number(body.max_output_tokens ?? body.output_max_tokens);
    if (!modelKey) return jsonResponse({ error: 'model_key required' }, 400);
    if (!displayName) return jsonResponse({ error: 'display_name required' }, 400);
    if (!CATALOG_PROVIDERS.has(provider)) {
      return jsonResponse({
        error: `provider must be one of: ${[...CATALOG_PROVIDERS].join(', ')}`,
      }, 400);
    }
    if (!CATALOG_TIERS.has(tier)) {
      return jsonResponse({
        error: `tier must be one of: ${[...CATALOG_TIERS].join(', ')}`,
      }, 400);
    }
    if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
      return jsonResponse({ error: 'context_window required (positive integer)' }, 400);
    }
    if (!Number.isFinite(maxOutputTokens) || maxOutputTokens <= 0) {
      return jsonResponse({ error: 'max_output_tokens required (positive integer)' }, 400);
    }
    const costIn =
      body.cost_per_1k_in != null
        ? Number(body.cost_per_1k_in)
        : body.input_rate_per_mtok != null
          ? Number(body.input_rate_per_mtok) / 1000
          : 0;
    const costOut =
      body.cost_per_1k_out != null
        ? Number(body.cost_per_1k_out)
        : body.output_rate_per_mtok != null
          ? Number(body.output_rate_per_mtok) / 1000
          : 0;
    const apiPlatform =
      body.api_platform != null && String(body.api_platform).trim() !== ''
        ? String(body.api_platform).trim()
        : provider === 'workers_ai'
          ? 'workers_ai'
          : provider === 'google'
            ? 'gemini_api'
            : provider === 'anthropic'
              ? 'anthropic'
              : provider === 'deepseek'
                ? 'deepseek'
                : provider === 'ollama'
                  ? 'ollama'
                  : 'openai_responses';
    const showInPicker =
      body.show_in_picker === true ||
      body.show_in_picker === 1 ||
      body.show_in_picker === '1';
    const isActive =
      body.is_active === undefined && body.status === undefined
        ? 1
        : body.is_active === true ||
            body.is_active === 1 ||
            body.is_active === '1' ||
            String(body.status || '').toLowerCase() === 'active'
          ? 1
          : 0;
    try {
      const existing = await env.DB.prepare(
        `SELECT model_key FROM agentsam_model_catalog WHERE model_key = ? LIMIT 1`,
      )
        .bind(modelKey)
        .first();
      if (existing) return jsonResponse({ error: 'model_key already exists', model_key: modelKey }, 409);

      await env.DB.prepare(
        `INSERT INTO agentsam_model_catalog (
           model_key, display_name, provider, tier,
           context_window, max_output_tokens,
           cost_per_1k_in, cost_per_1k_out, cost_per_tool_call,
           supports_tools, supports_vision, supports_streaming, supports_json_mode,
           supports_reasoning, is_active, show_in_picker, api_platform,
           thinking_policy, routing_lane, web_tool_mode,
           created_at, updated_at
         ) VALUES (
           ?, ?, ?, ?,
           ?, ?,
           ?, ?, 0,
           ?, ?, 1, ?,
           ?, ?, ?, ?,
           'omitted', 'unknown', 'none',
           unixepoch(), unixepoch()
         )`,
      )
        .bind(
          modelKey,
          displayName,
          provider,
          tier,
          Math.floor(contextWindow),
          Math.floor(maxOutputTokens),
          Number.isFinite(costIn) ? costIn : 0,
          Number.isFinite(costOut) ? costOut : 0,
          body.supports_tools === false || body.supports_tools === 0 ? 0 : 1,
          body.supports_vision === true || body.supports_vision === 1 ? 1 : 0,
          body.supports_json_mode === true || body.supports_structured_output === true ? 1 : 0,
          body.supports_reasoning === true || body.supports_thinking === true ? 1 : 0,
          isActive,
          showInPicker ? 1 : 0,
          apiPlatform,
        )
        .run();

      const row = await env.DB.prepare(
        `SELECT * FROM agentsam_model_catalog WHERE model_key = ? LIMIT 1`,
      )
        .bind(modelKey)
        .first();
      return jsonResponse({ ok: true, model: mapCatalogModelForSettings(row || { model_key: modelKey }) }, 201);
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (/UNIQUE|unique/i.test(msg)) {
        return jsonResponse({ error: 'model_key already exists', model_key: modelKey }, 409);
      }
      return jsonResponse({ error: msg }, 500);
    }
  }

  if (pathLower === '/api/settings/ai-models/keys' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const providerRaw = String(body.provider || '').trim();
    const provNorm = normalizeAiProviderSlug(providerRaw);
    if (!provNorm) return jsonResponse({ error: 'provider required' }, 400);
    const keysProvider = providerSlugForKeysApi(provNorm);
    const rawKey = String(body.rawKey || body.raw_key || body.api_key || '').trim();
    if (!rawKey) return jsonResponse({ error: 'API key required' }, 400);
    const label =
      String(body.keyName || body.key_name || '').trim() ||
      `${keysProvider} API key (AI Models)`;
    const fwdUrl = new URL(request.url);
    fwdUrl.pathname = '/api/settings/keys';
    const fwdReq = new Request(fwdUrl.toString(), {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({
        category: 'provider',
        provider: keysProvider,
        label,
        api_key: rawKey,
        validate: true,
      }),
    });
    return handleSettingsKeysRoutes(
      fwdReq,
      env,
      ctx,
      authUser,
      fwdUrl,
      '/api/settings/keys',
      'POST',
    );
  }

  {
    const m = pathLower.match(/^\/api\/settings\/ai-models\/keys\/([^/]+)$/);
    if (m && method === 'DELETE') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const tenantId = await resolveAuthTenantId(env, authUser);
      if (!tenantId) return jsonResponse({ error: 'tenant required' }, 400);
      const storeUserId = String(authUser.id || '').trim();
      const providerSeg = decodeURIComponent(m[1] || '').trim();
      const keysProvider = providerSlugForKeysApi(providerSeg);
      try {
        const row = await env.DB.prepare(
          `SELECT id FROM user_secrets
           WHERE user_id = ?
             AND COALESCE(is_active, 1) = 1
             AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
             AND (
               LOWER(COALESCE(service_name, '')) = LOWER(?)
               OR LOWER(COALESCE(json_extract(metadata_json, '$.provider'), '')) = LOWER(?)
             )
           LIMIT 1`,
        )
          .bind(storeUserId, tenantId, keysProvider, keysProvider)
          .first();
        if (!row?.id) return jsonResponse({ ok: true, removed: false });
        const fwdUrl = new URL(request.url);
        fwdUrl.pathname = `/api/settings/keys/${encodeURIComponent(String(row.id))}`;
        const fwdReq = new Request(fwdUrl.toString(), {
          method: 'DELETE',
          headers: request.headers,
        });
        return handleSettingsKeysRoutes(
          fwdReq,
          env,
          ctx,
          authUser,
          fwdUrl,
          fwdUrl.pathname.toLowerCase(),
          'DELETE',
        );
      } catch (e) {
        return jsonResponse({ error: e?.message ?? 'Failed to remove key' }, 500);
      }
    }
  }

  {
    // Preserve model_key case from raw pathname (pathLower would corrupt keys).
    const pathRaw = (url.pathname || '').replace(/\/$/, '') || '/';
    const m = pathRaw.match(/^\/api\/settings\/ai-models\/([^/]+)$/i);
    if (m) {
      const seg = decodeURIComponent(m[1] || '').trim();
      const segLower = seg.toLowerCase();
      if (seg && segLower !== 'keys' && segLower !== 'usage') {
        if (!(await canManageAiModelCatalog(authUser))) {
          return jsonResponse({ error: 'Forbidden' }, 403);
        }
        if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
        const modelKey = seg;

        if (method === 'DELETE') {
          try {
            const existing = await env.DB.prepare(
              `SELECT model_key FROM agentsam_model_catalog WHERE model_key = ? LIMIT 1`,
            )
              .bind(modelKey)
              .first();
            if (!existing) return jsonResponse({ error: 'Model not found' }, 404);
            await env.DB.prepare(`DELETE FROM agentsam_routing_arms WHERE model_key = ?`)
              .bind(modelKey)
              .run();
            const del = await env.DB.prepare(
              `DELETE FROM agentsam_model_catalog WHERE model_key = ?`,
            )
              .bind(modelKey)
              .run();
            if (!del.meta?.changes) return jsonResponse({ error: 'Model not found' }, 404);
            return jsonResponse({ ok: true, model_key: modelKey, removed: true, hard_deleted: true });
          } catch (e) {
            return jsonResponse({ error: e?.message ?? 'Remove failed' }, 500);
          }
        }

        if (method === 'PATCH') {
          const body = await request.json().catch(() => ({}));
          const has = (k) => body && Object.prototype.hasOwnProperty.call(body, k);
          const sets = [];
          const vals = [];

          if (has('show_in_picker')) {
            sets.push('show_in_picker = ?');
            vals.push(
              body.show_in_picker === true ||
                body.show_in_picker === 1 ||
                body.show_in_picker === '1'
                ? 1
                : 0,
            );
          }
          if (has('is_active') || has('status')) {
            let nextActive;
            if (has('is_active')) {
              nextActive =
                body.is_active === true ||
                body.is_active === 1 ||
                body.is_active === '1' ||
                body.is_active === 'active';
            } else {
              const st = String(body.status || '').toLowerCase();
              if (st !== 'active' && st !== 'inactive') {
                return jsonResponse({ error: 'status must be active or inactive' }, 400);
              }
              nextActive = st === 'active';
            }
            sets.push('is_active = ?');
            vals.push(nextActive ? 1 : 0);
          }
          if (has('display_name')) {
            const dn = String(body.display_name || '').trim();
            if (!dn) return jsonResponse({ error: 'display_name cannot be empty' }, 400);
            sets.push('display_name = ?');
            vals.push(dn);
          }
          if (has('tier')) {
            const t = String(body.tier || '').trim().toLowerCase();
            if (!CATALOG_TIERS.has(t)) {
              return jsonResponse({ error: `tier must be one of: ${[...CATALOG_TIERS].join(', ')}` }, 400);
            }
            sets.push('tier = ?');
            vals.push(t);
          }
          if (has('context_window') || has('context_max_tokens')) {
            const cw = Number(body.context_window ?? body.context_max_tokens);
            if (!Number.isFinite(cw) || cw <= 0) {
              return jsonResponse({ error: 'context_window must be a positive integer' }, 400);
            }
            sets.push('context_window = ?');
            vals.push(Math.floor(cw));
          }
          if (has('max_output_tokens') || has('output_max_tokens')) {
            const mo = Number(body.max_output_tokens ?? body.output_max_tokens);
            if (!Number.isFinite(mo) || mo <= 0) {
              return jsonResponse({ error: 'max_output_tokens must be a positive integer' }, 400);
            }
            sets.push('max_output_tokens = ?');
            vals.push(Math.floor(mo));
          }
          if (has('cost_per_1k_in') || has('input_rate_per_mtok')) {
            const v =
              has('cost_per_1k_in')
                ? Number(body.cost_per_1k_in)
                : Number(body.input_rate_per_mtok) / 1000;
            if (!Number.isFinite(v) || v < 0) {
              return jsonResponse({ error: 'invalid input rate' }, 400);
            }
            sets.push('cost_per_1k_in = ?');
            vals.push(v);
          }
          if (has('cost_per_1k_out') || has('output_rate_per_mtok')) {
            const v =
              has('cost_per_1k_out')
                ? Number(body.cost_per_1k_out)
                : Number(body.output_rate_per_mtok) / 1000;
            if (!Number.isFinite(v) || v < 0) {
              return jsonResponse({ error: 'invalid output rate' }, 400);
            }
            sets.push('cost_per_1k_out = ?');
            vals.push(v);
          }
          if (has('supports_tools')) {
            sets.push('supports_tools = ?');
            vals.push(body.supports_tools === true || body.supports_tools === 1 ? 1 : 0);
          }
          if (has('supports_vision')) {
            sets.push('supports_vision = ?');
            vals.push(body.supports_vision === true || body.supports_vision === 1 ? 1 : 0);
          }
          if (has('api_platform')) {
            sets.push('api_platform = ?');
            vals.push(String(body.api_platform || '').trim() || null);
          }

          if (!sets.length) return jsonResponse({ error: 'No fields to update' }, 400);
          sets.push('updated_at = unixepoch()');
          try {
            const r = await env.DB.prepare(
              `UPDATE agentsam_model_catalog SET ${sets.join(', ')} WHERE model_key = ?`,
            )
              .bind(...vals, modelKey)
              .run();
            if (!r.meta?.changes) return jsonResponse({ error: 'Model not found' }, 404);
            const row = await env.DB.prepare(
              `SELECT * FROM agentsam_model_catalog WHERE model_key = ? LIMIT 1`,
            )
              .bind(modelKey)
              .first();
            return jsonResponse({
              ok: true,
              model_key: modelKey,
              model: mapCatalogModelForSettings(row || { model_key: modelKey }),
            });
          } catch (e) {
            return jsonResponse({ error: e?.message ?? 'Update failed' }, 500);
          }
        }
      }
    }
  }

  return null;
}
