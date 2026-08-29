// src/api/integrations.js
/**
 * API Service: Integrations Controller
 * Owns /api/integrations/* plus inbound provider webhooks.
 */
import { getAuthUser, jsonResponse, fallbackSystemTenantId } from '../core/auth.js';
import { userCanInviteToTenant } from '../../backend/identity/workspace/authority.js';
import { ensureOauthTokenColumns } from '../../backend/identity/oauth/token-store.js';
import { getUserSupabaseToken, resolveOAuthAccessToken } from '../../backend/identity/oauth/user-token.js';
import { getIntegrationToken } from '../integrations/tokens.js';
import { getUserBYOKey } from '../../backend/identity/provisioning/byok.js';
import { handleGithubReposList } from '../integrations/github.js';
import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';
import { recordWorkerAnalyticsError } from './telemetry.js';
import {
    enrichResendInboundPayload,
    persistResendInboundEmail,
} from '../core/resend-inbound.js';
import {
    resendWebhookLaneForPath,
    verifyResendWebhookRequest,
} from '../core/resend-webhook-verify.js';
import { resolveCronWorkspaceId } from '../../backend/jobs/cron-tenant.js';
import { handleIntegrationsConnectRoutes } from './integrations/connect.js';
import {
    addSharedDrivePermissionV3,
    createSharedDriveV3,
    deleteSharedDriveV3,
    exportDriveFileV3,
    fetchDriveFileTextV3,
    getDriveAboutV3,
    getDriveFileV3,
    getSharedDriveV3,
    hideSharedDriveV3,
    isGoogleAppsMime,
    listDriveFilesV3,
    listSharedDrivePermissionsV3,
    listSharedDrivesV3,
    removeSharedDrivePermissionV3,
    resolveDriveTokenForUser,
    searchDriveFilesV3,
    unhideSharedDriveV3,
    updateSharedDriveV3,
} from '../integrations/gdrive-v3.js';
import { resolveGoogleAppsExportMime } from '../integrations/drive-mime.js';
import { handleGdriveV3ExtendedRoutes } from './gdrive-v3-routes.js';

const REGISTRY_SEED = [
    ['int_github', 'github', 'GitHub', 'source_control', 'oauth2', 'disconnected', 10, null],
    ['int_google_drive', 'google_drive', 'Google Drive', 'storage', 'oauth2', 'disconnected', 20, null],
    ['int_cloudflare_oauth', 'cloudflare_oauth', 'Cloudflare (OAuth)', 'deployment', 'oauth2', 'disconnected', 25, 'CLOUDFLARE_OAUTH_CLIENT_ID'],
    ['int_cloudflare_r2', 'cloudflare_r2', 'Cloudflare R2', 'storage', 'worker_binding', 'disconnected', 30, 'R2'],
    // local_tunnel — cloudflared quick tunnel / IAM hostname; connect via POST { tunnel_url } (see integrations/connect.js).
    // integration_registry CHECK: category 'deployment', auth_type 'none'; live tunnel URL stored in config_json after connect.
    ['int_local_tunnel', 'local_tunnel', 'Local Machine', 'deployment', 'none', 'disconnected', 35, null],
    ['int_mcp', 'mcp_servers', 'MCP Servers', 'automation', 'api_key', 'disconnected', 40, null],
    ['int_resend', 'resend', 'Resend', 'communication', 'api_key', 'disconnected', 50, 'RESEND_API_KEY'],
    ['int_anthropic', 'anthropic', 'Anthropic', 'ai_provider', 'api_key', 'disconnected', 60, 'ANTHROPIC_API_KEY'],
    ['int_openai', 'openai', 'OpenAI', 'ai_provider', 'api_key', 'disconnected', 70, 'OPENAI_API_KEY'],
    ['int_google_ai', 'google_ai', 'Google AI', 'ai_provider', 'api_key', 'disconnected', 80, 'GOOGLE_AI_API_KEY'],
    ['int_bluebubbles', 'bluebubbles', 'BlueBubbles (retired)', 'communication', 'webhook', 'disconnected', 90, null],
    ['int_cloudflare_images', 'cloudflare_images', 'Cloudflare Images', 'storage', 'worker_binding', 'disconnected', 100, 'CLOUDFLARE_IMAGES_ACCOUNT_HASH'],
    ['int_vectorize', 'vectorize', 'Vectorize', 'analytics', 'worker_binding', 'disconnected', 110, 'VECTORIZE'],
    ['int_hyperdrive', 'hyperdrive', 'Hyperdrive (Supabase)', 'database', 'worker_binding', 'disconnected', 120, 'HYPERDRIVE'],
    ['int_browser_rendering', 'browser_rendering', 'Browser Rendering', 'automation', 'worker_binding', 'disconnected', 130, 'MYBROWSER'],
    ['int_supabase', 'supabase', 'Supabase', 'database', 'api_key', 'disconnected', 140, 'SUPABASE_SERVICE_ROLE_KEY'],
    ['int_supabase_oauth', 'supabase_oauth', 'Supabase (OAuth)', 'database', 'oauth2', 'disconnected', 145, 'SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID'],
    ['int_cursor', 'cursor', 'Cursor', 'automation', 'api_key', 'disconnected', 150, 'CURSOR_API_KEY'],
    ['int_claude_code', 'claude_code', 'Claude Code', 'automation', 'api_key', 'disconnected', 160, 'CLAUDE_CODE_API_KEY'],
];

const OAUTH_PROVIDER_ALIASES = {
    github: 'github',
    google_drive: 'google_drive',
    google_gmail: 'google_gmail',
    cloudflare_oauth: 'cloudflare',
    supabase_oauth: 'supabase_management',
};

const PROVIDER_COLOR_SLUGS = {
    anthropic: 'anthropic_api',
    claude_code: 'claude_pro',
    cloudflare_images: 'cf_images',
    cloudflare_r2: 'cf_r2',
    cloudflare_oauth: 'cloudflare',
    cursor: 'cursor_api',
    github: 'github',
    google_ai: 'google_antigravity',
    google_drive: 'google_workspace',
    hyperdrive: 'supabase',
    mcp_servers: 'cf_workers',
    openai: 'openai_api',
    resend: 'resend',
    supabase: 'supabase',
    supabase_oauth: 'supabase',
    vectorize: 'workers_ai',
    browser_rendering: 'cf_workers',
    bluebubbles: 'bluebubbles',
    aws_s3: 'aws',
};

/**
 * Main switch-board for Integration webhooks.
 */
export async function handleIntegrationsRequest(request, envArg, ctxArg, authUserArg) {
    const { env, ctx, authUser: providedAuthUser } = normalizeArgs(envArg, ctxArg, authUserArg);
    const url = new URL(request.url);
    const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
    const method = request.method.toUpperCase();

    if (method === 'POST' && request.headers.get('X-GitHub-Event')) {
        return jsonResponse(
            {
                error: 'Use signed endpoint POST /api/webhooks/github (X-Hub-Signature-256 required)',
            },
            400,
        );
    }

    // 1. BlueBubbles retired — Mac Messages.app daemon owns iMessage now.
    if (pathLower === '/api/integrations/bluebubbles/webhook' && method === 'POST') {
        return jsonResponse(
            {
                error: 'bluebubbles_retired',
                detail: 'Use agentsam_imessage_send / agentsam_imessage_request_approval. Mac daemon: scripts/imessage/imessage_approval_daemon.py',
            },
            410,
        );
    }

    // 2. Resend webhooks (Svix) — path-bound secrets (do not cross-wire):
    //    /api/email/inbound              → RESEND_INBOUND_WEBHOOK_SECRET  (email.received)
    //    /api/webhooks/resend (+ alias)  → RESEND_WEBHOOK_SECRET          (delivery/bounce/…)
    if (
        (pathLower === '/api/integrations/resend/webhook' ||
            pathLower === '/api/webhooks/resend' ||
            pathLower === '/api/email/inbound') &&
        method === 'POST'
    ) {
        const lane = resendWebhookLaneForPath(pathLower);
        const rawBody = await request.text();
        const verified = await verifyResendWebhookRequest(rawBody, request.headers, url, env, {
            pathLower,
            lane,
        });
        if (!verified.ok) {
            return jsonResponse(
                {
                    error: 'Invalid webhook signature',
                    reason: verified.reason || 'denied',
                    lane,
                },
                403,
            );
        }
        let parsed;
        try {
            parsed = rawBody ? JSON.parse(rawBody) : {};
        } catch {
            return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }
        return handleResendWebhook(request, env, ctx, pathLower, parsed, verified.mode);
    }

    if (!pathLower.startsWith('/api/integrations') && !pathLower.startsWith('/api/gdrive')) return null;

    if (pathLower === '/api/integrations/gmail/callback' && method === 'GET') {
        const { handleGmailConnectCallback } = await import('./integrations/gmail-connect.js');
        return handleGmailConnectCallback(request, url, env);
    }

    if (pathLower === '/api/integrations/google-calendar/callback' && method === 'GET') {
        const { handleGoogleCalendarConnectCallback } = await import('./integrations/google-calendar-connect.js');
        return handleGoogleCalendarConnectCallback(request, url, env, ctx);
    }

    const authUser =
      providedAuthUser ||
      (await import('../core/auth.js').then((m) => m.authUserFromRequest(request, env)));
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    await ensureIntegrationTables(env, resolveTenantId(authUser, env));

    const connectRes = await handleIntegrationsConnectRoutes(
        request,
        env,
        ctx,
        authUser,
        url,
        pathLower,
        method,
    );
    if (connectRes) return connectRes;

    // ── GET /api/integrations (lightweight list) ─────────────────────────────
    if (method === 'GET' && pathLower === '/api/integrations') {
        const tenantId = resolveTenantId(authUser, env);
        try {
            const { results } = await env.DB.prepare(
                `SELECT id, tenant_id, provider_key, display_name, category, auth_type, status,
                        scopes_json, config_json, account_display, secret_binding_name,
                        last_sync_at, last_health_check_at, last_health_latency_ms, last_health_status,
                        is_enabled, sort_order, created_at, updated_at
                 FROM integration_registry
                 WHERE tenant_id = ? AND COALESCE(is_enabled, 1) = 1
                 ORDER BY sort_order ASC, display_name ASC`,
            ).bind(tenantId).all();
            const integrations = (results || []).filter(Boolean);
            return jsonResponse({ integrations, total: integrations.length });
        } catch (e) {
            return jsonResponse({ integrations: [], total: 0, error: String(e?.message || e) }, 200);
        }
    }

    if (method === 'GET' && pathLower === '/api/integrations/status') {
        return handleLegacyStatus(env, authUser);
    }
    if (method === 'GET' && pathLower === '/api/integrations/summary') {
        return handleSummary(env, authUser);
    }
    if (method === 'GET' && pathLower === '/api/integrations/connectors/catalog') {
        const { handleConnectorsCatalogApi } = await import('../../backend/http/integrations/connectors-catalog.js');
        return handleConnectorsCatalogApi(request, env, authUser);
    }
    const connectorToolsMatch = pathLower.match(/^\/api\/integrations\/connectors\/([^/]+)\/tools$/);
    if (connectorToolsMatch && method === 'GET') {
        const { handleConnectorToolsApi } = await import('../../backend/http/integrations/connectors-catalog.js');
        return handleConnectorToolsApi(request, env, authUser, decodeURIComponent(connectorToolsMatch[1] || ''));
    }
    if (method === 'GET' && pathLower === '/api/integrations/events') {
        return handleEvents(env, authUser, url);
    }
    if (method === 'GET' && pathLower === '/api/integrations/webhooks') {
        return handleWebhooks(env, authUser);
    }
    if (method === 'GET' && pathLower === '/api/integrations/mcp-tools') {
        return handleMcpTools(env, authUser);
    }
    if (method === 'GET' && pathLower === '/api/integrations/api-keys') {
        return handleApiKeys(env, authUser);
    }
    if (method === 'POST' && pathLower === '/api/integrations/api-keys') {
        return handleCreateApiKey(env, authUser, request);
    }

    if (method === 'DELETE' && pathLower === '/api/integrations/supabase') {
        return handleSupabaseIntegrationDelete(env, authUser);
    }

    const singleIntegrationGet = pathLower.match(/^\/api\/integrations\/([^/]+)$/);
    if (singleIntegrationGet && method === 'GET') {
        const key = decodeURIComponent(singleIntegrationGet[1] || '').toLowerCase();
        const reserved = new Set(['status', 'summary', 'events', 'webhooks', 'mcp-tools', 'api-keys', 'connectors']);
        if (key && !reserved.has(key)) {
            return handleProviderDetail(env, authUser, normalizeProviderKey(singleIntegrationGet[1]));
        }
    }

    const actionMatch = pathLower.match(/^\/api\/integrations\/([^/]+)\/(test|sync|disconnect|settings|detail|refresh|verify)$/);
    if (actionMatch) {
        const provider = normalizeProviderKey(actionMatch[1]);
        const action = actionMatch[2];
        if (action === 'detail' && method === 'GET') return handleProviderDetail(env, authUser, provider);
        if (action === 'test' && method === 'POST') return handleProviderTest(env, authUser, provider);
        if (action === 'verify' && method === 'POST') return handleProviderTest(env, authUser, provider);
        if (action === 'sync' && method === 'POST') return handleProviderSync(env, authUser, provider);
        if (action === 'disconnect' && method === 'POST') return handleProviderDisconnect(env, authUser, provider);
        if (action === 'settings' && method === 'PATCH') return handleProviderSettings(env, authUser, provider, request);
        if (action === 'refresh' && method === 'POST') return handleProviderOauthRefresh(env, authUser, provider);
    }

    const rotateMatch = pathLower.match(/^\/api\/integrations\/([^/]+)\/webhook\/rotate-secret$/);
    if (rotateMatch && method === 'POST') {
        return handleRotateWebhookSecret(env, authUser, normalizeProviderKey(rotateMatch[1]));
    }

    if (pathLower === '/api/integrations/cloudflare/context' && method === 'GET') {
        const { handleCfAccountContext } = await import('./integrations/cloudflare-stack.js');
        return handleCfAccountContext(env, authUser);
    }
    if (pathLower === '/api/integrations/cloudflare_oauth/stack/enumerate' && method === 'POST') {
        const { handleCfStackEnumerate } = await import('./integrations/cloudflare-stack.js');
        const body = await request.json().catch(() => ({}));
        return handleCfStackEnumerate(env, authUser, body);
    }
    if (pathLower === '/api/integrations/cloudflare_oauth/stack/save' && method === 'POST') {
        const { handleCfStackSave } = await import('./integrations/cloudflare-stack.js');
        const body = await request.json().catch(() => ({}));
        return handleCfStackSave(env, authUser, body);
    }

    const legacy = await handleLegacyProviderBrowser(request, env, authUser, url, pathLower, method);
    if (legacy) return legacy;

    return jsonResponse({ error: 'Integration route not found', path: url.pathname }, 404);
}

function normalizeArgs(envArg, ctxArg, authUserArg) {
    if (envArg instanceof URL) {
        return { env: ctxArg, ctx: authUserArg, authUser: null };
    }
    return { env: envArg, ctx: ctxArg, authUser: authUserArg };
}

function resolveTenantId(authUser, env) {
    return authUser?.tenant_id || env?.TENANT_ID || fallbackSystemTenantId(env);
}

/** Match `user_oauth_tokens.user_id` — auth_users.id (au_*) only; never email/usr_*. */
function integrationUserId(authUser) {
    const sid = authUser?.id != null && String(authUser.id).trim() !== '' ? String(authUser.id).trim() : '';
    return sid.startsWith('au_') ? sid : '';
}

function normalizeProviderKey(provider) {
    const p = String(provider || '').trim().toLowerCase();
    if (p === 'gdrive' || p === 'google') return 'google_drive';
    if (p === 'r2') return 'cloudflare_r2';
    if (p === 'mcp') return 'mcp_servers';
    if (p === 'supabase_management' || p === 'supabase') return 'supabase_oauth';
    return p;
}

function colorSlugForProvider(providerKey) {
    const key = normalizeProviderKey(providerKey);
    return PROVIDER_COLOR_SLUGS[key] || key;
}

function parseJson(value, fallback) {
    if (value == null || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (_) { return fallback; }
}

function epochToIso(value) {
    if (!value) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return new Date(n * 1000).toISOString();
}

async function ensureIntegrationTables(env, tenantId) {
    if (!env?.DB) return;
    await env.DB.batch([
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS integration_registry (
            id TEXT PRIMARY KEY DEFAULT ('int_'||lower(hex(randomblob(8)))),
            tenant_id TEXT NOT NULL,
            provider_key TEXT NOT NULL,
            display_name TEXT NOT NULL,
            category TEXT NOT NULL CHECK(category IN ('source_control','storage','ai_provider','communication','database','analytics','payment','deployment','automation','other')),
            auth_type TEXT NOT NULL CHECK(auth_type IN ('oauth2','api_key','webhook','worker_binding','none')),
            status TEXT NOT NULL DEFAULT 'disconnected' CHECK(status IN ('connected','disconnected','degraded','auth_expired','pending')),
            scopes_json TEXT DEFAULT '[]',
            config_json TEXT DEFAULT '{}',
            account_display TEXT,
            secret_binding_name TEXT,
            last_sync_at TEXT,
            last_health_check_at TEXT,
            last_health_latency_ms INTEGER,
            last_health_status TEXT,
            is_enabled INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 50,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(tenant_id, provider_key)
        )`),
        env.DB.prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_registry_tenant_provider
           ON integration_registry (tenant_id, provider_key)`,
        ),
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS integration_health_checks (
            id TEXT PRIMARY KEY DEFAULT ('ihc_'||lower(hex(randomblob(8)))),
            tenant_id TEXT NOT NULL,
            provider_key TEXT NOT NULL,
            checked_at TEXT NOT NULL DEFAULT (datetime('now')),
            status TEXT NOT NULL CHECK(status IN ('ok','degraded','error','timeout')),
            latency_ms INTEGER,
            error_message TEXT,
            checked_by TEXT DEFAULT 'system',
            response_preview TEXT
        )`),
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS integration_events (
            id TEXT PRIMARY KEY DEFAULT ('iev_'||lower(hex(randomblob(8)))),
            tenant_id TEXT NOT NULL,
            provider_key TEXT NOT NULL,
            event_type TEXT NOT NULL CHECK(event_type IN ('connected','disconnected','token_refreshed','sync_completed','health_check','test_run','webhook_received','error','settings_updated')),
            actor TEXT,
            message TEXT NOT NULL,
            metadata_json TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now'))
        )`),
    ]);
    for (const row of REGISTRY_SEED) {
        await env.DB.prepare(
            `INSERT OR IGNORE INTO integration_registry
             (id, tenant_id, provider_key, display_name, category, auth_type, status, sort_order, secret_binding_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(row[0], tenantId, row[1], row[2], row[3], row[4], row[5], row[6], row[7]).run();
    }
}

async function handleSummary(env, authUser) {
    if (!env?.DB) return jsonResponse({ providers: [], summary: emptySummary(), error: 'DB not configured' }, 503);
    const tenantId = resolveTenantId(authUser, env);
    const userId = integrationUserId(authUser);
    await ensureOauthTokenColumns(env.DB);
    const [registry, oauth, toolCounts, webhookCounts, allowlistCount, events, providerColors] = await Promise.all([
        env.DB.prepare(
            `SELECT r.*,
                    h.status AS health_status,
                    h.latency_ms,
                    h.checked_at AS latest_health_check_at,
                    h.error_message
             FROM integration_registry r
             LEFT JOIN integration_health_checks h ON h.provider_key = r.provider_key
              AND h.tenant_id = r.tenant_id
              AND h.id = (SELECT id FROM integration_health_checks
                          WHERE provider_key = r.provider_key AND tenant_id = r.tenant_id
                          ORDER BY checked_at DESC LIMIT 1)
             WHERE r.tenant_id = ? AND COALESCE(r.is_enabled, 1) = 1
             ORDER BY r.sort_order`
        ).bind(tenantId).all(),
        safeAll(env.DB, `SELECT provider, account_identifier, scope, expires_at, created_at, updated_at, metadata_json, workspace_id FROM user_oauth_tokens WHERE user_id = ?`, [userId]),
        getMcpToolCounts(env),
        getWebhookCounts(env),
        safeFirst(env.DB, `SELECT COUNT(*) AS count FROM agentsam_mcp_allowlist WHERE user_id = ?`, [userId]),
        safeAll(env.DB, `SELECT provider_key, event_type, message, actor, created_at FROM integration_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 25`, [tenantId]),
        loadProviderColors(env),
    ]);
    // Defensive: filter null rows to avoid frontend palette crashes.
    const providerColorsSafe = (providerColors.results || []).filter(Boolean);
    const colorBySlug = new Map(providerColorsSafe.map((row) => [String(row.slug || '').toLowerCase(), row]));

    const oauthByProvider = new Map();
    for (const token of oauth.results || []) {
        const key = normalizeProviderKey(token.provider);
        const account = token.account_identifier || token.provider;
        if (!oauthByProvider.has(key)) oauthByProvider.set(key, []);
        oauthByProvider.get(key).push({
            provider: token.provider,
            account_identifier: token.account_identifier || '',
            account_display: key === 'github' && account ? `github.com/${account}` : account,
            scopes: String(token.scope || '').split(/[,\s]+/).filter(Boolean),
            issued_at: epochToIso(token.created_at),
            expires_at: epochToIso(token.expires_at),
            status: oauthTokenStatus(token.expires_at),
            metadata_json: token.metadata_json || null,
            workspace_id: token.workspace_id || null,
        });
    }

    const providers = (registry.results || []).map((r) => {
        let regRow = r;
        if (r.provider_key === 'supabase_oauth') {
            const mgmtReady =
                env.SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID && env.SUPABASE_MANAGEMENT_OAUTH_CLIENT_SECRET;
            regRow = {
                ...r,
                status: mgmtReady ? r.status : 'disconnected',
                secret_binding_name: mgmtReady ? r.secret_binding_name : null,
            };
        }
        let oauthAccounts = oauthByProvider.get(normalizeProviderKey(regRow.provider_key)) || [];
        if (regRow.provider_key === 'supabase_oauth' && oauthAccounts.length === 0) {
            oauthAccounts = [
                ...(oauthByProvider.get('supabase_management') || []),
                ...(oauthByProvider.get('supabase') || []),
            ];
        }
        let status = oauthAccounts.some((a) => a.status === 'expired') ? 'auth_expired' : regRow.status;
        if (oauthAccounts.length > 0 && status !== 'auth_expired') status = 'connected';
        const providerColorSlug = colorSlugForProvider(regRow.provider_key);
        return {
            ...regRow,
            status,
            provider_color_slug: providerColorSlug,
            provider_color: colorBySlug.get(providerColorSlug) || null,
            scopes: parseJson(r.scopes_json, []),
            config: parseJson(r.config_json, {}),
            oauth_account: oauthAccounts[0] || null,
            oauth_accounts: oauthAccounts,
            account_display: r.account_display || oauthAccounts[0]?.account_display || null,
            health: {
                status: r.health_status || r.last_health_status || null,
                latency_ms: r.latency_ms ?? r.last_health_latency_ms ?? null,
                checked_at: r.latest_health_check_at || r.last_health_check_at || null,
                error_message: r.error_message || null,
            },
            tool_count: toolCountForProvider(r.provider_key, toolCounts.byCategory),
        };
    });

    const summary = summarizeProviders(providers, toolCounts, webhookCounts);
    return jsonResponse({
        providers,
        oauth_tokens: oauth.results || [],
        mcp_tools: toolCounts,
        webhooks: webhookCounts,
        allowlist_count: Number(allowlistCount?.count || 0),
        recent_events: events.results || [],
        provider_colors: providerColorsSafe,
        provider_color_aliases: PROVIDER_COLOR_SLUGS,
        capabilities: resolveCapabilities(authUser),
        summary,
    });
}

async function loadProviderColors(env) {
    const withDisplayName = await safeAll(env.DB, `SELECT slug, display_name, primary_color, secondary_color, text_on_color, icon_slug, category FROM provider_colors ORDER BY category, display_name`, []);
    if (withDisplayName.results?.length) return withDisplayName;
    return safeAll(env.DB, `SELECT slug, css_var, color AS primary_color, color AS secondary_color, '#ffffff' AS text_on_color, slug AS icon_slug, 'other' AS category FROM provider_colors ORDER BY slug`, []);
}

function resolveCapabilities(authUser) {
    const parsed = parseJson(authUser?.capabilities_json, {});
    return {
        can_manage_mcp: parsed.can_manage_mcp !== false,
        can_manage_secrets: parsed.can_manage_secrets !== false,
    };
}

function emptySummary() {
    return { connected: 0, degraded: 0, auth_expired: 0, disconnected: 0, total_mcp_tools: 0, enabled_mcp_tools: 0, webhook_count: 0, active_webhooks: 0 };
}

function summarizeProviders(providers, toolCounts, webhookCounts) {
    const summary = emptySummary();
    for (const p of providers) {
        if (p.status === 'connected') summary.connected += 1;
        if (p.status === 'degraded') summary.degraded += 1;
        if (p.status === 'auth_expired') summary.auth_expired += 1;
        if (p.status === 'disconnected') summary.disconnected += 1;
    }
    summary.total_mcp_tools = toolCounts.total;
    summary.enabled_mcp_tools = toolCounts.enabled;
    summary.webhook_count = webhookCounts.total;
    summary.active_webhooks = webhookCounts.active;
    return summary;
}

function oauthTokenStatus(expiresAt) {
    if (!expiresAt) return 'connected';
    const exp = Number(expiresAt);
    if (!Number.isFinite(exp)) return 'connected';
    const now = Math.floor(Date.now() / 1000);
    if (exp < now) return 'expired';
    if (exp < now + 7 * 24 * 60 * 60) return 'expiring_soon';
    return 'connected';
}

async function getMcpToolCounts(env) {
    const total = await safeFirst(env.DB, `SELECT COUNT(*) AS total, SUM(CASE WHEN COALESCE(is_active, 1) = 1 THEN 1 ELSE 0 END) AS enabled FROM agentsam_tools`, []);
    const by = await safeAll(env.DB, `SELECT COALESCE(tool_category, 'uncategorized') AS category, COUNT(*) AS total, SUM(CASE WHEN COALESCE(is_active, 1) = 1 THEN 1 ELSE 0 END) AS enabled FROM agentsam_tools GROUP BY COALESCE(tool_category, 'uncategorized') ORDER BY category`, []);
    const byCategory = {};
    for (const row of by.results || []) byCategory[row.category] = { total: Number(row.total || 0), enabled: Number(row.enabled || 0) };
    return { total: Number(total?.total || 0), enabled: Number(total?.enabled || 0), by_category: by.results || [], byCategory };
}

function toolCountForProvider(providerKey, byCategory) {
    if (providerKey === 'mcp_servers') return Object.values(byCategory || {}).reduce((n, c) => n + Number(c.enabled || 0), 0);
    if (['github', 'google_drive', 'cloudflare_images'].includes(providerKey)) return byCategory?.integrations?.enabled || 0;
    if (providerKey === 'cloudflare_r2') return byCategory?.storage?.enabled || byCategory?.r2?.enabled || 0;
    return 0;
}

async function getWebhookCounts(env) {
    const endpoints = await safeFirst(env.DB, `SELECT COUNT(*) AS total, SUM(CASE WHEN COALESCE(is_active, 0) = 1 THEN 1 ELSE 0 END) AS active FROM webhook_endpoints`, []);
    const hooks = await safeFirst(env.DB, `SELECT COUNT(*) AS total, SUM(CASE WHEN COALESCE(is_active, 0) = 1 THEN 1 ELSE 0 END) AS active FROM agentsam_hook`, []);
    return {
        total: Number(endpoints?.total || 0) + Number(hooks?.total || 0),
        active: Number(endpoints?.active || 0) + Number(hooks?.active || 0),
        webhook_endpoints: Number(endpoints?.total || 0),
        agentsam_hooks: Number(hooks?.total || 0),
    };
}

async function handleProviderOauthRefresh(env, authUser, provider) {
    const userId = integrationUserId(authUser);
    if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (provider === 'supabase_oauth' || provider === 'supabase') {
        const tok = await getUserSupabaseToken(env, userId, null);
        return jsonResponse({ ok: !!tok?.access_token, provider: 'supabase_management' });
    }
    return jsonResponse({ ok: true, provider, note: 'Nothing to refresh for this integration type.' });
}

async function handleProviderDetail(env, authUser, provider) {
    const tenantId = resolveTenantId(authUser, env);
    const userId = integrationUserId(authUser);
    const [registry, health, events, oauth, tools, providerColors] = await Promise.all([
        safeFirst(env.DB, `SELECT * FROM integration_registry WHERE tenant_id = ? AND provider_key = ? LIMIT 1`, [tenantId, provider]),
        safeAll(env.DB, `SELECT * FROM integration_health_checks WHERE tenant_id = ? AND provider_key = ? ORDER BY checked_at DESC LIMIT 5`, [tenantId, provider]),
        safeAll(env.DB, `SELECT * FROM integration_events WHERE tenant_id = ? AND provider_key = ? ORDER BY created_at DESC LIMIT 10`, [tenantId, provider]),
        safeAll(env.DB, `SELECT provider, account_identifier, scope, expires_at, created_at, updated_at FROM user_oauth_tokens WHERE user_id = ? AND provider = ?`, [userId, OAUTH_PROVIDER_ALIASES[provider] || provider]),
        safeAll(env.DB, `SELECT id, COALESCE(tool_name, tool_key) AS tool_name, tool_category, description, COALESCE(is_active, 1) AS enabled FROM agentsam_tools WHERE (? = 'mcp_servers' OR tool_category = 'integrations') ORDER BY tool_category, COALESCE(tool_name, tool_key) LIMIT 100`, [provider]),
        loadProviderColors(env),
    ]);
    const colorSlug = colorSlugForProvider(provider);
    const colorBySlug = new Map((providerColors.results || []).map((row) => [String(row.slug || '').toLowerCase(), row]));
    return jsonResponse({
        provider: registry ? { ...registry, provider_color_slug: colorSlug, provider_color: colorBySlug.get(colorSlug) || null } : registry,
        health_checks: health.results || [],
        events: events.results || [],
        oauth_tokens: oauth.results || [],
        tools: tools.results || [],
        provider_colors: providerColors.results || [],
        provider_color_aliases: PROVIDER_COLOR_SLUGS,
    });
}

async function handleEvents(env, authUser, url) {
    const tenantId = resolveTenantId(authUser, env);
    const provider = normalizeProviderKey(url.searchParams.get('provider') || '');
    const eventType = String(url.searchParams.get('event_type') || '').trim();
    const args = [tenantId];
    let where = 'tenant_id = ?';
    if (provider) { where += ' AND provider_key = ?'; args.push(provider); }
    if (eventType) { where += ' AND event_type = ?'; args.push(eventType); }
    const rows = await env.DB.prepare(`SELECT * FROM integration_events WHERE ${where} ORDER BY created_at DESC LIMIT 100`).bind(...args).all();
    return jsonResponse({ events: rows.results || [] });
}

async function handleWebhooks(env, authUser) {
    const tenantId = resolveTenantId(authUser, env);
    const endpoints = await safeAll(env.DB, `SELECT id, source AS provider, slug AS name, endpoint_path AS endpoint_url, last_received_at AS last_triggered_at, total_received AS trigger_count, is_active FROM webhook_endpoints ORDER BY source, slug`, []);
    const hooks = await safeAll(env.DB, `SELECT id, provider, trigger AS name, external_id AS endpoint_url, created_at AS last_triggered_at, 0 AS trigger_count, is_active FROM agentsam_hook ORDER BY provider, trigger`, []);
    const rows = [...(endpoints.results || []), ...(hooks.results || [])].map((r) => ({ ...r, status: r.is_active ? 'active' : 'inactive' }));
    return jsonResponse({ webhooks: rows, tenant_id: tenantId });
}

async function handleMcpTools(env) {
    const rows = await safeAll(env.DB, `SELECT id, COALESCE(tool_name, tool_key) AS tool_name, tool_category, description, COALESCE(is_active, 1) AS enabled, is_degraded FROM agentsam_tools ORDER BY tool_category, COALESCE(tool_name, tool_key)`, []);
    const counts = await getMcpToolCounts(env);
    return jsonResponse({ tools: rows.results || [], counts });
}

async function handleApiKeys(env, authUser) {
    const tenantId = resolveTenantId(authUser, env);
    const userId = integrationUserId(authUser);
    const { listUserSecrets } = await import('../../backend/credentials/user-secret-store.js');
    const items = await listUserSecrets(env, { userId, tenantId, categoryFilter: null });
    const [providers] = await Promise.all([
        safeAll(env.DB, `SELECT provider_key, display_name, secret_binding_name, status, last_health_check_at, last_health_latency_ms FROM integration_registry WHERE tenant_id = ? AND auth_type = 'api_key' ORDER BY sort_order`, [tenantId]),
    ]);
    const userKeys = items.map((i) => ({
        id: i.id,
        provider: i.provider,
        key_name: i.label || i.secret_name,
        key_preview: i.last_four,
        is_active: i.status === 'active' ? 1 : 0,
        last_used_at: i.last_used_at,
        created_at: i.created_at,
    }));
    return jsonResponse({ providers: providers.results || [], user_api_keys: userKeys });
}

async function handleCreateApiKey(env, authUser, request) {
    return jsonResponse(
        {
            error: 'Use POST /api/integrations/:slug/connect with api_key, or POST /api/settings/keys for BYOK.',
        },
        400,
    );
}

async function handleProviderTest(env, authUser, provider) {
    const tenantId = resolveTenantId(authUser, env);
    const started = Date.now();
    let result = { ok: false, status: 'error', error: null, account_info: null, response_preview: null };
    try {
        result = await runProviderHealthCheck(env, authUser, provider);
    } catch (e) {
        result = { ok: false, status: 'error', error: e?.message || String(e), account_info: null, response_preview: null };
    }
    const latency = Date.now() - started;
    const healthStatus = result.ok ? 'ok' : (result.status || 'error');
    await env.DB.batch([
        env.DB.prepare(`INSERT INTO integration_health_checks (tenant_id, provider_key, status, latency_ms, error_message, checked_by, response_preview) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .bind(tenantId, provider, healthStatus, latency, result.error || null, authUser.email || authUser.id || 'user', result.response_preview || null),
        env.DB.prepare(`UPDATE integration_registry SET last_health_check_at = datetime('now'), last_health_status = ?, last_health_latency_ms = ?, status = CASE WHEN ? = 'ok' THEN 'connected' ELSE 'degraded' END, updated_at = datetime('now') WHERE tenant_id = ? AND provider_key = ?`)
            .bind(healthStatus, latency, healthStatus, tenantId, provider),
    ]);
    await recordIntegrationEvent(env, tenantId, provider, 'health_check', authUser.email || authUser.id, result.ok ? 'Health check passed' : `Health check failed: ${result.error || healthStatus}`, { latency_ms: latency });
    return jsonResponse({ ok: result.ok, latency_ms: latency, error: result.error, account_info: result.account_info || null });
}

async function runProviderHealthCheck(env, authUser, provider) {
    const userId = integrationUserId(authUser);
    const tenantId = resolveTenantId(authUser, env);
    if (provider === 'github') {
        const token = await getIntegrationToken(env, userId, 'github', '');
        if (!token) return { ok: false, status: 'error', error: 'GitHub OAuth token not found' };
        const ghToken = await resolveOAuthAccessToken(env, token);
        if (!ghToken) return { ok: false, status: 'error', error: 'GitHub token unavailable — please reconnect' };
        const res = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'IAM-Platform' } });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.ok ? 'ok' : 'error', error: res.ok ? null : data.message || res.statusText, account_info: data.login ? { login: data.login, html_url: data.html_url } : null, response_preview: JSON.stringify({ login: data.login, id: data.id }).slice(0, 500) };
    }
    if (provider === 'google_drive') {
        const token = await getIntegrationToken(env, userId, 'google_drive', '');
        if (!token) return { ok: false, status: 'error', error: 'Google Drive OAuth token not found' };
        const gdToken = await resolveOAuthAccessToken(env, token);
        if (!gdToken) return { ok: false, status: 'error', error: 'Google Drive token unavailable — please reconnect' };
        const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user,storageQuota', { headers: { Authorization: `Bearer ${gdToken}` } });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.ok ? 'ok' : 'error', error: res.ok ? null : data.error?.message || res.statusText, account_info: data.user || null, response_preview: JSON.stringify(data.user || data.error || {}).slice(0, 500) };
    }
    if (provider === 'anthropic') {
        const byok = await getUserBYOKey(env, userId, tenantId, 'anthropic');
        const key = byok?.key || env.ANTHROPIC_API_KEY;
        return testJsonFetch('https://api.anthropic.com/v1/messages', key, {
            method: 'POST',
            headers: { 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'x-api-key': key || '' },
            body: JSON.stringify({ model: 'claude-3-5-haiku-latest', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        });
    }
    if (provider === 'openai') {
        const byok = await getUserBYOKey(env, userId, tenantId, 'openai');
        const key = byok?.key || env.OPENAI_API_KEY;
        return testJsonFetch('https://api.openai.com/v1/models', key, { headers: { Authorization: `Bearer ${key || ''}` } });
    }
    if (provider === 'google_ai') {
        const byok = await getUserBYOKey(env, userId, tenantId, 'google');
        const key = byok?.key || env.GOOGLE_AI_API_KEY;
        return testJsonFetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key || '')}`,
            key,
            {},
        );
    }
    if (provider === 'resend') {
        const byok = await getUserBYOKey(env, userId, tenantId, 'resend');
        const key = byok?.key || env.RESEND_API_KEY;
        return testJsonFetch('https://api.resend.com/emails?limit=1', key, { headers: { Authorization: `Bearer ${key || ''}` } });
    }
    if (provider === 'cloudflare_r2') {
        if (!env.R2?.list) return { ok: false, status: 'error', error: 'R2 binding not configured' };
        const list = await env.R2.list({ prefix: '_probe/', limit: 1 });
        return { ok: true, status: 'ok', account_info: { object_count_sample: list.objects?.length || 0 }, response_preview: JSON.stringify({ truncated: list.truncated, object_count_sample: list.objects?.length || 0 }) };
    }
    if (provider === 'mcp_servers') return testJsonFetch('https://mcp.inneranimalmedia.com/health', true, {});
    if (provider === 'vectorize') {
        const binding = env.AGENTSAM_VECTORIZE_DOCUMENTS;
        return { ok: !!binding, status: binding ? 'ok' : 'error', error: binding ? null : 'AGENTSAM_VECTORIZE_DOCUMENTS binding not configured', account_info: { binding: 'AGENTSAM_VECTORIZE_DOCUMENTS' } };
    }
    if (provider === 'hyperdrive') return { ok: !!env.HYPERDRIVE, status: env.HYPERDRIVE ? 'ok' : 'error', error: env.HYPERDRIVE ? null : 'HYPERDRIVE binding not configured', account_info: { binding: 'HYPERDRIVE' } };
    if (provider === 'browser_rendering') return { ok: !!env.MYBROWSER, status: env.MYBROWSER ? 'ok' : 'error', error: env.MYBROWSER ? null : 'MYBROWSER binding not configured' };
    if (provider === 'stripe') {
        const token = await getIntegrationToken(env, userId, 'stripe', '');
        if (!token) return { ok: false, status: 'error', error: 'Stripe OAuth token not found' };
        const stripeToken = await resolveOAuthAccessToken(env, token);
        if (!stripeToken) return { ok: false, status: 'error', error: 'Stripe token unavailable — please reconnect' };
        const res = await fetch('https://api.stripe.com/v1/account', {
            headers: { Authorization: `Bearer ${stripeToken}` },
        });
        const data = await res.json().catch(() => ({}));
        return {
            ok: res.ok,
            status: res.ok ? 'ok' : 'error',
            error: res.ok ? null : data.error?.message || res.statusText,
            account_info: data.id ? { id: data.id, display_name: data.display_name || data.email } : null,
            response_preview: JSON.stringify({ id: data.id, display_name: data.display_name }).slice(0, 500),
        };
    }
    return { ok: true, status: 'ok', account_info: { configured: true } };
}

async function testJsonFetch(url, requiredSecret, init) {
    if (!requiredSecret) return { ok: false, status: 'error', error: 'Required API key or binding is not configured' };
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.ok ? 'ok' : 'error', error: res.ok ? null : data.error?.message || data.message || res.statusText, response_preview: JSON.stringify(data).slice(0, 500) };
}

async function handleProviderSync(env, authUser, provider) {
    const tenantId = resolveTenantId(authUser, env);
    const changes = [];
    if (provider === 'github') {
        const token = await getIntegrationToken(env, integrationUserId(authUser), 'github', '');
        if (token) {
            const ghToken = await resolveOAuthAccessToken(env, token);
            if (ghToken) {
                const res = await fetch('https://api.github.com/user/repos?sort=updated&per_page=10&affiliation=owner,collaborator,organization_member', { headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'IAM-Platform' } });
                changes.push({ github_repos_checked: res.ok });
            }
        }
    } else if (provider === 'google_drive') {
        changes.push({ token_status: await oauthProviderConnected(env.DB, integrationUserId(authUser), 'google_drive') ? 'valid_row_present' : 'missing' });
    } else if (provider === 'mcp_servers') {
        const counts = await getMcpToolCounts(env);
        changes.push({ enabled_tools: counts.enabled, total_tools: counts.total });
    } else if (provider === 'vectorize') {
        const stats = await safeFirst(
            env.DB,
            `SELECT COUNT(*) AS indexes FROM vectorize_index_registry
             WHERE COALESCE(is_active, 1) = 1 AND (tenant_id = ? OR tenant_id IS NULL)`,
            [tenantId],
        );
        changes.push({ active_indexes: Number(stats?.indexes || 0) });
    } else if (provider === 'cloudflare_r2') {
        changes.push({ rollup_job: 'storage_rollup_bucket_summary' });
    }
    await env.DB.prepare(`UPDATE integration_registry SET last_sync_at = datetime('now'), updated_at = datetime('now') WHERE tenant_id = ? AND provider_key = ?`).bind(tenantId, provider).run();
    await recordIntegrationEvent(env, tenantId, provider, 'sync_completed', authUser.email || authUser.id, 'Integration sync completed', { changes });
    return jsonResponse({ synced: true, changes });
}

async function handleSupabaseIntegrationDelete(env, authUser) {
    if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const userId = integrationUserId(authUser);
    const tenantId = resolveTenantId(authUser, env);
    await env.DB.prepare(`DELETE FROM user_oauth_tokens WHERE user_id = ? AND provider = 'supabase'`).bind(userId).run();
    await env.DB.prepare(
        `UPDATE integration_registry SET status = 'disconnected', account_display = NULL, updated_at = datetime('now') WHERE tenant_id = ? AND provider_key = 'supabase_oauth'`,
    ).bind(tenantId).run();
    await recordIntegrationEvent(env, tenantId, 'supabase_oauth', 'disconnected', authUser.email || authUser.id, 'Supabase OAuth disconnected', {});
    return jsonResponse({ disconnected: true });
}

async function handleProviderDisconnect(env, authUser, provider) {
    const tenantId = resolveTenantId(authUser, env);
    if (!(await userCanInviteToTenant(env, authUser))) return jsonResponse({ error: 'Tenant admin required' }, 403);
    if (['github', 'google_drive', 'google_gmail'].includes(provider)) {
        await env.DB.prepare(`DELETE FROM user_oauth_tokens WHERE user_id = ? AND provider = ?`).bind(integrationUserId(authUser), provider).run();
    }
    await env.DB.prepare(`UPDATE integration_registry SET status = 'disconnected', updated_at = datetime('now') WHERE tenant_id = ? AND provider_key = ?`).bind(tenantId, provider).run();
    await recordIntegrationEvent(env, tenantId, provider, 'disconnected', authUser.email || authUser.id, 'Integration disconnected', {});
    return jsonResponse({ disconnected: true });
}

async function handleProviderSettings(env, authUser, provider, request) {
    const tenantId = resolveTenantId(authUser, env);
    const body = await request.json().catch(() => ({}));
    const row = await safeFirst(env.DB, `SELECT config_json, scopes_json FROM integration_registry WHERE tenant_id = ? AND provider_key = ?`, [tenantId, provider]);
    const config = { ...parseJson(row?.config_json, {}), ...(body.config_json || body.config || {}) };
    const scopes = body.scopes || body.scopes_json || parseJson(row?.scopes_json, []);
    const enabled = body.is_enabled == null ? null : (body.is_enabled ? 1 : 0);
    if (enabled == null) {
        await env.DB.prepare(`UPDATE integration_registry SET config_json = ?, scopes_json = ?, updated_at = datetime('now') WHERE tenant_id = ? AND provider_key = ?`)
            .bind(JSON.stringify(config), JSON.stringify(scopes), tenantId, provider).run();
    } else {
        await env.DB.prepare(`UPDATE integration_registry SET config_json = ?, scopes_json = ?, is_enabled = ?, updated_at = datetime('now') WHERE tenant_id = ? AND provider_key = ?`)
            .bind(JSON.stringify(config), JSON.stringify(scopes), enabled, tenantId, provider).run();
    }
    await recordIntegrationEvent(env, tenantId, provider, 'settings_updated', authUser.email || authUser.id, 'Integration settings updated', {});
    return jsonResponse({ updated: true });
}

async function handleRotateWebhookSecret(env, authUser, provider) {
    if (!(await userCanInviteToTenant(env, authUser))) return jsonResponse({ error: 'Tenant admin required' }, 403);
    const tenantId = resolveTenantId(authUser, env);
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const newSecret = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    if (env.KV?.put) await env.KV.put(`webhook_secret:${tenantId}:${provider}`, newSecret);
    const hash = await sha256Hex(newSecret);
    try {
        await env.DB.prepare(`UPDATE agentsam_hook SET auth_token = ? WHERE provider = ?`).bind(hash, provider).run();
    } catch (_) { /* older agentsam_hook schemas do not have auth_token */ }
    await recordIntegrationEvent(env, tenantId, provider, 'settings_updated', authUser.email || authUser.id, 'Webhook secret rotated', {});
    return jsonResponse({ rotated: true, new_secret: newSecret });
}

async function recordIntegrationEvent(env, tenantId, provider, eventType, actor, message, metadata) {
    try {
        await env.DB.prepare(
            `INSERT INTO integration_events (tenant_id, provider_key, event_type, actor, message, metadata_json)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(tenantId, provider, eventType, actor || null, message, JSON.stringify(metadata || {})).run();
    } catch (e) {
        console.warn('[integrations] event write failed', e?.message || e);
    }
}

async function safeAll(DB, sql, binds) {
    try { return await DB.prepare(sql).bind(...binds).all(); } catch (_) { return { results: [] }; }
}

async function safeFirst(DB, sql, binds) {
    try { return await DB.prepare(sql).bind(...binds).first(); } catch (_) { return null; }
}

async function handleLegacyStatus(env, authUser) {
    const userId = integrationUserId(authUser);
    const rows = await safeAll(env.DB, `SELECT provider, account_identifier FROM user_oauth_tokens WHERE user_id = ?`, [userId]);
    let google = false;
    let github = false;
    const githubAccounts = [];
    for (const r of rows.results || []) {
        if (r.provider === 'google_drive' || r.provider === 'google') google = true;
        if (r.provider === 'github') {
            github = true;
            if (r.account_identifier) githubAccounts.push({ account_identifier: r.account_identifier });
        }
    }
    return jsonResponse({ google, github, github_accounts: githubAccounts });
}

async function handleLegacyProviderBrowser(request, env, authUser, url, pathLower, method) {
    const userId = (await resolveIntegrationUserId(env, authUser)) || integrationUserId(authUser);
    const githubAccount = url.searchParams.get('account') || '';

    async function driveAuth() {
        return resolveDriveTokenForUser(env, userId, getIntegrationToken, resolveOAuthAccessToken);
    }

    if (method === 'GET' && pathLower === '/api/integrations/gdrive/access-token') {
        const auth = await driveAuth();
        if (!auth.ok) {
            return jsonResponse({ error: auth.error }, auth.status || 400);
        }
        return jsonResponse({
            access_token: auth.token,
            apiVersion: 3,
        });
    }

    if (method === 'GET' && pathLower === '/api/integrations/gdrive/status') {
        const auth = await driveAuth();
        if (!auth.ok) {
            return jsonResponse(
                { connected: false, error: auth.error },
                auth.status === 401 ? 401 : 400,
            );
        }
        const about = await getDriveAboutV3(auth.token);
        const row = auth.tokenRow || {};
        return jsonResponse({
            connected: true,
            email: about.about?.user?.emailAddress || row.account_email || null,
            displayName: about.about?.user?.displayName || row.account_display || null,
            scope: row.scope || null,
            storage: about.about?.storageQuota || null,
            exportFormats: about.about?.exportFormats || null,
            apiVersion: 3,
            service: 'googleapis.com/drive/v3',
        });
    }

    if (method === 'GET' && pathLower === '/api/integrations/gdrive/drives') {
        const auth = await driveAuth();
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status || 400);
        const out = await listSharedDrivesV3(auth.token, { q: url.searchParams.get('q') || undefined });
        if (!out.ok) return jsonResponse({ error: out.error, files: [] }, 502);
        return jsonResponse({ files: out.files, drives: out.drives, apiVersion: 3 });
    }

    const driveIdMatch = pathLower.match(/^\/api\/integrations\/gdrive\/drives\/([^/]+)(?:\/(.+))?$/);
    if (driveIdMatch) {
        const driveId = decodeURIComponent(driveIdMatch[1] || '');
        const sub = driveIdMatch[2] || '';
        const auth = await driveAuth();
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status || 400);

        if (method === 'GET' && !sub) {
            const out = await getSharedDriveV3(auth.token, driveId);
            return jsonResponse(out.ok ? { drive: out.drive, apiVersion: 3 } : { error: out.error }, out.ok ? 200 : 502);
        }

        if (method === 'PATCH' && !sub) {
            let body = {};
            try {
                body = await request.json();
            } catch {
                return jsonResponse({ error: 'Invalid JSON body' }, 400);
            }
            const out = await updateSharedDriveV3(auth.token, driveId, body);
            return jsonResponse(out.ok ? { drive: out.drive, apiVersion: 3 } : { error: out.error }, out.ok ? 200 : 502);
        }

        if (method === 'DELETE' && !sub) {
            const out = await deleteSharedDriveV3(auth.token, driveId);
            return jsonResponse(out.ok ? { ok: true, apiVersion: 3 } : { error: out.error }, out.ok ? 200 : 502);
        }

        if (method === 'POST' && sub === 'hide') {
            const out = await hideSharedDriveV3(auth.token, driveId);
            return jsonResponse(out.ok ? { drive: out.drive, apiVersion: 3 } : { error: out.error }, out.ok ? 200 : 502);
        }

        if (method === 'POST' && sub === 'unhide') {
            const out = await unhideSharedDriveV3(auth.token, driveId);
            return jsonResponse(out.ok ? { drive: out.drive, apiVersion: 3 } : { error: out.error }, out.ok ? 200 : 502);
        }

        if (sub === 'permissions') {
            if (method === 'GET') {
                const out = await listSharedDrivePermissionsV3(auth.token, driveId);
                return jsonResponse(
                    out.ok ? { permissions: out.permissions, apiVersion: 3 } : { error: out.error },
                    out.ok ? 200 : 502,
                );
            }
            if (method === 'POST') {
                let body = {};
                try {
                    body = await request.json();
                } catch {
                    return jsonResponse({ error: 'Invalid JSON body' }, 400);
                }
                const out = await addSharedDrivePermissionV3(auth.token, driveId, body);
                return jsonResponse(
                    out.ok ? { permission: out.permission, apiVersion: 3 } : { error: out.error },
                    out.ok ? 200 : 502,
                );
            }
        }

        const permMatch = sub.match(/^permissions\/([^/]+)$/);
        if (permMatch && method === 'DELETE') {
            const permissionId = decodeURIComponent(permMatch[1]);
            const out = await removeSharedDrivePermissionV3(auth.token, driveId, permissionId);
            return jsonResponse(out.ok ? { ok: true, apiVersion: 3 } : { error: out.error }, out.ok ? 200 : 502);
        }
    }

    if (method === 'POST' && pathLower === '/api/integrations/gdrive/drives') {
        const auth = await driveAuth();
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status || 400);
        let body = {};
        try {
            body = await request.json();
        } catch {
            return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }
        const out = await createSharedDriveV3(auth.token, body);
        return jsonResponse(out.ok ? { drive: out.drive, apiVersion: 3 } : { error: out.error }, out.ok ? 200 : 502);
    }

    if (method === 'GET' && pathLower === '/api/integrations/gdrive/search') {
        const q = url.searchParams.get('q') || '';
        const auth = await driveAuth();
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status || 400);
        const out = await searchDriveFilesV3(auth.token, q);
        if (!out.ok) return jsonResponse({ error: out.error, files: [] }, 502);
        return jsonResponse({ files: out.files, apiVersion: 3 });
    }

    if (method === 'GET' && pathLower === '/api/integrations/gdrive/files') {
        const view = url.searchParams.get('view') || 'my-drive';
        const folderId = url.searchParams.get('folderId') || 'root';
        const driveId = url.searchParams.get('driveId') || '';
        const auth = await driveAuth();
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status || 400);

        if (view === 'shared-drives' && (!folderId || folderId === 'root')) {
            const out = await listSharedDrivesV3(auth.token);
            if (!out.ok) return jsonResponse({ error: out.error, files: [] }, 502);
            return jsonResponse({ files: out.files, apiVersion: 3 });
        }

        const listView = view === 'shared-drives' ? 'shared-drive' : view;
        const out = await listDriveFilesV3(auth.token, {
            view: listView,
            folderId,
            driveId,
        });
        if (!out.ok) return jsonResponse({ error: out.error, files: [] }, 502);
        return jsonResponse({ files: out.files, apiVersion: 3 });
    }

    if (method === 'GET' && pathLower === '/api/integrations/gdrive/file') {
        const fileId = url.searchParams.get('fileId');
        const auth = await driveAuth();
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status || 400);
        const out = await fetchDriveFileTextV3(auth.token, fileId);
        if (!out.ok) return jsonResponse({ error: out.error || 'fetch_failed' }, 502);
        return jsonResponse({ content: out.content, name: out.file?.name, mimeType: out.file?.mimeType });
    }

    if (method === 'GET' && pathLower === '/api/integrations/gdrive/export') {
        const fileId = url.searchParams.get('fileId');
        const format = url.searchParams.get('format') || url.searchParams.get('mimeType') || '';
        const auth = await driveAuth();
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status || 400);
        if (!fileId) return jsonResponse({ error: 'fileId required' }, 400);

        const metaOut = await getDriveFileV3(auth.token, fileId, 'id,name,mimeType');
        if (!metaOut.ok) return jsonResponse({ error: metaOut.error || 'File not found' }, 502);
        const sourceMime = String(metaOut.file?.mimeType || '');
        if (!isGoogleAppsMime(sourceMime)) {
            return jsonResponse({ error: 'Export only applies to Google Workspace files' }, 400);
        }

        const exportMime = resolveGoogleAppsExportMime(sourceMime, format || undefined);
        const out = await exportDriveFileV3(auth.token, fileId, exportMime);
        if (!out.ok) return jsonResponse({ error: out.error || 'Export failed' }, out.status || 502);

        const baseName = String(metaOut.file?.name || 'export').replace(/[\\/:*?"<>|]+/g, '_');
        const filename = `${baseName}.${out.extension || 'bin'}`;
        return new Response(out.body, {
            headers: {
                'Content-Type': out.contentType || exportMime,
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'private, max-age=60',
            },
        });
    }

    if (method === 'GET' && pathLower === '/api/integrations/gdrive/raw') {
        const fileId = url.searchParams.get('fileId');
        const auth = await driveAuth();
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status || 400);
        if (!fileId) return jsonResponse({ error: 'fileId required' }, 400);

        const metaOut = await getDriveFileV3(auth.token, fileId, 'id,name,mimeType');
        if (!metaOut.ok) return jsonResponse({ error: metaOut.error || 'Not found' }, 502);
        const sourceMime = String(metaOut.file?.mimeType || '');

        if (isGoogleAppsMime(sourceMime)) {
            const format = url.searchParams.get('format') || '';
            const exportMime = resolveGoogleAppsExportMime(sourceMime, format || undefined);
            const out = await exportDriveFileV3(auth.token, fileId, exportMime);
            if (!out.ok) return jsonResponse({ error: out.error || 'Export failed' }, out.status || 502);
            return new Response(out.body, {
                headers: {
                    'Content-Type': out.contentType || exportMime,
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Range',
                    'Access-Control-Expose-Headers': 'Cache-Control, Content-Encoding, Content-Range',
                    'Cache-Control': 'private, max-age=60',
                },
            });
        }

        const rawUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
        rawUrl.searchParams.set('alt', 'media');
        rawUrl.searchParams.set('supportsAllDrives', 'true');
        const res = await fetch(rawUrl.toString(), { headers: { Authorization: `Bearer ${auth.token}` } });
        if (!res.ok) return jsonResponse({ error: res.statusText || 'Not found' }, res.status);
        const headers = new Headers({
            'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Range',
            'Access-Control-Expose-Headers': 'Cache-Control, Content-Encoding, Content-Range',
        });
        const contentRange = res.headers.get('Content-Range');
        if (contentRange) headers.set('Content-Range', contentRange);
        const acceptRanges = res.headers.get('Accept-Ranges');
        if (acceptRanges) headers.set('Accept-Ranges', acceptRanges);
        return new Response(res.body, { headers });
    }

    if (method === 'POST' && pathLower === '/api/gdrive/list') {
        let body = {};
        try {
            body = await request.json();
        } catch {
            return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }
        const auth = await driveAuth();
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status || 400);
        const view = body.view || 'my-drive';
        if (view === 'shared-drives' && (!body.folderId || body.folderId === 'root')) {
            const out = await listSharedDrivesV3(auth.token);
            return jsonResponse(out.ok ? { files: out.files, drives: out.drives } : { error: out.error }, out.ok ? 200 : 502);
        }
        const listView = view === 'shared-drives' ? 'shared-drive' : view;
        const out = await listDriveFilesV3(auth.token, {
            view: listView,
            folderId: body.folderId || 'root',
            driveId: body.driveId || '',
        });
        return jsonResponse(out.ok ? { files: out.files } : { error: out.error }, out.ok ? 200 : 502);
    }

    if (method === 'POST' && pathLower === '/api/gdrive/fetch') {
        let body = {};
        try {
            body = await request.json();
        } catch {
            return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }
        const fileId = body.fileId || body.id;
        if (!fileId) return jsonResponse({ error: 'fileId required' }, 400);
        const auth = await driveAuth();
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status || 400);
        const out = await fetchDriveFileTextV3(auth.token, fileId);
        return jsonResponse(
            out.ok ? { content: out.content, file: out.file } : { error: out.error },
            out.ok ? 200 : 502,
        );
    }

    const extended = await handleGdriveV3ExtendedRoutes(request, pathLower, method, url, driveAuth);
    if (extended) return extended;

    if (method === 'GET' && pathLower === '/api/integrations/github/repos') {
        return handleGithubReposList(request, env, authUser, url);
    }
    if (method === 'GET' && pathLower === '/api/integrations/github/files') {
        const repo = url.searchParams.get('repo');
        const filePath = url.searchParams.get('path') || '';
        const tokenRow = await getIntegrationToken(env, userId, 'github', githubAccount);
        if (!tokenRow) return jsonResponse({ error: 'not_connected' }, 400);
        const ghToken = await resolveOAuthAccessToken(env, tokenRow);
        if (!ghToken) return jsonResponse({ error: 'GitHub token unavailable — please reconnect' }, 401);
        const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, { headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'IAM-Platform' } });
        return jsonResponse(await res.json(), res.ok ? 200 : res.status);
    }
    if (method === 'GET' && pathLower === '/api/integrations/github/file') {
        const repo = url.searchParams.get('repo');
        const filePath = url.searchParams.get('path');
        const tokenRow = await getIntegrationToken(env, userId, 'github', githubAccount);
        if (!tokenRow) return jsonResponse({ error: 'not_connected' }, 400);
        const ghToken = await resolveOAuthAccessToken(env, tokenRow);
        if (!ghToken) return jsonResponse({ error: 'GitHub token unavailable — please reconnect' }, 401);
        const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, { headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'IAM-Platform' } });
        const data = await res.json();
        const content = atob((data.content || '').replace(/\n/g, ''));
        return jsonResponse({ content, sha: data.sha, name: data.name }, res.ok ? 200 : res.status);
    }
    if (method === 'GET' && pathLower === '/api/integrations/github/raw') {
        const repo = url.searchParams.get('repo');
        const filePath = url.searchParams.get('path');
        const tokenRow = await getIntegrationToken(env, userId, 'github', githubAccount);
        if (!tokenRow) return jsonResponse({ error: 'not_connected' }, 400);
        const ghToken = await resolveOAuthAccessToken(env, tokenRow);
        if (!ghToken) return jsonResponse({ error: 'GitHub token unavailable — please reconnect' }, 401);
        const res = await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(repo)}/HEAD/${String(filePath || '').split('/').map((p) => encodeURIComponent(p)).join('/')}`, { headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'IAM-Platform' } });
        if (!res.ok) return jsonResponse({ error: res.statusText || 'Not found' }, res.status);
        return new Response(res.body, { headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' } });
    }
    return null;
}

async function oauthProviderConnected(DB, userId, provider) {
    const row = await safeFirst(DB, `SELECT 1 AS ok FROM user_oauth_tokens WHERE user_id = ? AND provider = ? LIMIT 1`, [userId, provider]);
    return !!row;
}

async function sha256Hex(value) {
    return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function hex(buffer) {
    return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 🧱 handleResendWebhook: Inbound Email Reply Hub
 * Phone IDE loop: Svix verify → enrich Receiving API → persist → allowlist → Agent Sam turn.
 */
async function handleResendWebhook(
    request,
    env,
    ctx,
    endpointPath = '/api/webhooks/resend',
    preParsedBody = null,
    verifyMode = null,
) {
    try {
        const rawBody =
            preParsedBody && typeof preParsedBody === 'object'
                ? preParsedBody
                : await request.json();
        const pathNorm = String(endpointPath || '/api/webhooks/resend').toLowerCase();
        const lane = resendWebhookLaneForPath(pathNorm);
        const eventTypeRaw = rawBody?.type != null ? String(rawBody.type) : '';
        const isEmailReceived =
            eventTypeRaw === 'email.received' || lane === 'inbound';

        // email.received webhooks omit body — pull text/html/headers from Receiving API.
        const body = isEmailReceived
            ? await enrichResendInboundPayload(env, rawBody)
            : rawBody;
        const data = body?.data && typeof body.data === 'object' ? body.data : body;
        const fromRaw = data?.from;
        const senderEmail =
            typeof fromRaw === 'string'
                ? fromRaw
                : fromRaw?.email || fromRaw?.address || fromRaw;
        const subject = data?.subject != null ? String(data.subject) : '';
        const text = data?.text != null ? String(data.text) : '';
        const html = data?.html != null ? String(data.html) : '';
        const headersObj =
            data?.headers && typeof data.headers === 'object' ? data.headers : {};
        const inReplyToRaw =
            headersObj['in-reply-to'] ||
            headersObj['In-Reply-To'] ||
            data?.in_reply_to ||
            data?.inReplyTo ||
            data?.message_id ||
            null;

        console.log(
            `[Resend] ${lane} event=${eventTypeRaw || 'unknown'} from ${senderEmail}: ${subject}` +
                (verifyMode ? ` verify=${verifyMode}` : '') +
                (data?._enriched_from_receiving_api ? ' enriched=1' : ''),
        );

        let inbound = { ok: false, reason: 'not_inbound_event' };
        if (isEmailReceived) {
            inbound = await persistResendInboundEmail(env, body);
            if (!inbound.ok && inbound.reason !== 'unresolved_tenant') {
                console.warn('[Resend] inbound persist skipped', inbound.reason || 'unknown');
            } else if (inbound.ok && !inbound.duplicate) {
                console.log(
                    `[Resend] stored inbound ${inbound.id} tenant=${inbound.tenantId || 'unknown'}`,
                );
            }
        }

        let phoneLoop = { attempted: false, ok: false };
        if (isEmailReceived) {
            try {
                const {
                    isPhoneLoopAllowlistedSender,
                    handleParsedEmailReply,
                } = await import('../core/email-agent-bridge.js');

                if (await isPhoneLoopAllowlistedSender(env, senderEmail)) {
                    phoneLoop.attempted = true;
                    const result = await handleParsedEmailReply(env, ctx, {
                        text,
                        html,
                        subject,
                        fromAddress: senderEmail,
                        inReplyTo: inReplyToRaw,
                    });
                    phoneLoop = { attempted: true, ...result };
                    console.log('[Resend] phone loop', JSON.stringify({
                        ok: result.ok,
                        conversationId: result.conversationId,
                        minted: result.minted,
                        accepted: result.accepted,
                        error: result.error || null,
                    }));
                } else {
                    console.log(`[Resend] sender not phone-loop allowlisted: ${senderEmail}`);
                }
            } catch (loopErr) {
                console.warn('[Resend] phone loop failed', loopErr?.message || loopErr);
                phoneLoop = { attempted: true, ok: false, error: loopErr?.message || String(loopErr) };
            }
        }

        await recordIntegrationEvent(
            env,
            'system',
            'resend',
            isEmailReceived ? 'webhook_received' : eventTypeRaw || 'webhook_received',
            senderEmail,
            isEmailReceived
                ? `Inbound email webhook received from ${senderEmail}`
                : `Resend ${eventTypeRaw || 'webhook'} on ${pathNorm}`,
            {
                subject,
                lane,
                inbound_id: inbound.ok ? inbound.id : null,
                phone_loop: phoneLoop,
            },
        );

        const { ingestWebhookEventAndDispatch } = await import('../../backend/http/webhooks/ingest.js');
        const eventType =
            eventTypeRaw ||
            (lane === 'inbound' ? 'email_inbound' : 'webhook_received');
        let webhookWorkspaceId = inbound.ok ? inbound.workspaceId : null;
        if (!webhookWorkspaceId) {
          webhookWorkspaceId = (await resolveCronWorkspaceId(env)) || null;
        }
        await ingestWebhookEventAndDispatch(env, ctx, {
            tenantId: inbound.ok ? inbound.tenantId : null,
            workspaceId: webhookWorkspaceId,
            provider: 'resend',
            eventType,
            payload: body,
            endpointPath: pathNorm,
            signatureValid: true,
            metadata: {
                subject: subject ?? null,
                from: senderEmail,
                lane,
                inbound_id: inbound.ok ? inbound.id : null,
                phone_loop: phoneLoop,
            },
        });

        return jsonResponse({
            status: 'received',
            source: 'resend',
            lane,
            inbound_id: inbound.ok ? inbound.id : null,
            tenant_id: inbound.ok ? inbound.tenantId : null,
            phone_loop: phoneLoop,
        });

    } catch (e) {
        console.error('[Resend Webhook Error]', e.message);
        ctx.waitUntil(recordWorkerAnalyticsError(env, {
            path: '/api/integrations/resend/webhook',
            method: 'POST',
            error_message: e.message
        }));
        return jsonResponse({ error: 'Email webhook processing failed' }, 500);
    }
}
