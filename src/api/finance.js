/**
 * API Service: Finance & Client Operations
 * Handles accounting, spend tracking, client projects, and AI usage billing.
 * Deconstructed from legacy worker.js.
 *
 * ISOLATION RULES:
 * - All platform financial data (P&L, transactions, client revenue, invoices) is
 *   gated by the authenticated user's D1 platform-finance grant. Other users get
 *   scoped AI spend data only.
 * - agentsam_usage_rollups_daily is tenant+workspace scoped — safe for all users.
 * - financial_monthly_summaries, financial_health, client_revenue, invoices, clients
 *   are platform-wide tables — D1 platform-finance grant gate only (no per-user column).
 * - finance_transactions, agentsam_usage_events, founder_metrics (operator wellness):
 *   tenant/workspace scoped in analytics.js; founder_metrics is superadmin-only (no tenant column).
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js'; import { getAuthUser } from '../../backend/identity/index.js';
import { userHasPolicyGrant } from '../../backend/identity/workspace/grants.js';
import { buildFinanceAnalyticsExtension } from './analytics.js';
import { handleProjectsApi } from './projects.js';
import { isProjectRuntimeContractSyncPath } from './projects/helpers.js';
import { resolveIdentity } from '../../backend/identity/index.js';

function currentMonthStart() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
function safeQuery(db, sql, binds = []) {
    if (!db) return Promise.resolve(null);
    return db.prepare(sql).bind(...binds).first().catch(() => null);
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
function safeAll(db, sql, binds = []) {
    if (!db) return Promise.resolve({ results: [] });
    return db.prepare(sql).bind(...binds).all().catch(() => ({ results: [] }));
}

function buildScopeWhere(authUser, opts = {}) {
    const prefix = opts.alias ? `${opts.alias}.` : '';
    const tenantId = authUser?.tenant_id ?? null;
    const workspaceId = opts.workspaceId ?? null;
    if (tenantId && workspaceId) {
        return {
            sql: `${prefix}tenant_id = ? AND ${prefix}workspace_id = ?`,
            binds: [tenantId, workspaceId],
        };
    }
    if (tenantId) {
        return { sql: `${prefix}tenant_id = ?`, binds: [tenantId] };
    }
    return { sql: '1=1', binds: [] };
}

/** Empty scoped finance response for non-superadmin users. */
function scopedEmptyFinanceResponse() {
    return jsonResponse({
        success: true,
        ai_spend_mtd: 0,
        tokens_mtd: 0,
        mrr: 0,
        net_cashflow_last_month: 0,
        last_pl_period: null,
        monthly_pl: [],
        client_revenue: [],
        daily_spend_sparkline: [],
        _scoped: true,
        _note: 'Financial data scoped to your account. Platform P&L not available.',
    });
}

/**
 * Main dispatcher for Finance-related API routes (/api/finance/*, /api/clients, /api/projects, /api/billing/*).
 */
export async function handleFinanceApi(request, url, env, ctx) {
    const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
    const method = request.method.toUpperCase();

    const runtimeContractBridgeSync =
      isProjectRuntimeContractSyncPath(pathLower, method) && verifyBridgeKey(request, env);

    let authUser = null;
    if (!runtimeContractBridgeSync) {
      authUser = await getAuthUser(request, env);
      if (!authUser) {
        return jsonResponse({ error: 'Unauthorized', code: 'SESSION_MISSING' }, 401);
      }
    }
    const identity = runtimeContractBridgeSync ? null : await resolveIdentity(request, env);
    const workspaceId = identity?.workspace?.id || null;

    const canViewPlatformFinance =
      !runtimeContractBridgeSync &&
      Boolean(
        workspaceId &&
          identity?.user?.id &&
          (await userHasPolicyGrant(env, identity.user.id, workspaceId)),
      );

    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

    try {
        // ── /api/finance Dispatcher ──
        if (pathLower.startsWith('/api/finance')) {
            const subPath = pathLower.slice('/api/finance/'.length);
            const segments = subPath.split('/').filter(Boolean);

            if (segments[0] === 'transactions') {
                // Transactions are platform financial data — explicit grant only.
                if (!canViewPlatformFinance) return jsonResponse({ success: true, transactions: [], _scoped: true }, 200);
                if (segments[1] && method === 'GET') return handleFinanceTransactionGet(env, segments[1], authUser);
                if (segments[1] && (method === 'PATCH' || method === 'PUT' || method === 'DELETE')) {
                    return handleFinanceTransactionMutate(request, env, segments[1], method, authUser);
                }
                if (method === 'GET') return handleFinanceTransactionsList(url, env, authUser);
                if (method === 'POST') {
                    return jsonResponse({
                        error: 'Manual transaction POST disabled. Import CSV via /api/finance/import-csv.',
                    }, 405);
                }
            }

            if (segments[0] === 'summary') {
                // Summary mixes platform P&L (explicit grant) with scoped AI spend.
                return handleFinanceSummary(url, env, authUser, canViewPlatformFinance, workspaceId);
            }

            // All routes below are platform-financial — explicit grant only.
            if (!canViewPlatformFinance) {
                // AI spend endpoints are safe for all users (tenant+workspace scoped)
                if (segments[0] === 'ai-spend') return handleFinanceAiSpend(url, env, authUser, workspaceId);
                if (segments[0] === 'spend-by-model' && method === 'GET') return handleFinanceSpendByModel(env, authUser, workspaceId);
                if (segments[0] === 'spend-by-day' && method === 'GET') return handleFinanceSpendByDay(url, env, authUser, workspaceId);
                if (segments[0] === 'providers' && method === 'GET') return handleFinanceProviders(env, authUser);
                if (segments[0] === 'budgets') return jsonResponse({ budgets: [], _scoped: true }, 200);
                if (segments[0] === 'alerts') return jsonResponse({ alerts: [], _scoped: true }, 200);
                // All other finance routes blocked without the grant.
                return jsonResponse({ error: 'Forbidden', _scoped: true }, 403);
            }

            if (segments[0] === 'health') return handleFinanceHealth(env);
            if (segments[0] === 'breakdown') return handleFinanceBreakdown(url, env);
            if (segments[0] === 'categories') return handleFinanceCategories(env);
            if (segments[0] === 'accounts') return handleFinanceAccounts(env);
            if (segments[0] === 'ai-spend') return handleFinanceAiSpend(url, env, authUser, workspaceId);
            if (segments[0] === 'spend-by-model' && method === 'GET') return handleFinanceSpendByModel(env, authUser, workspaceId);
            if (segments[0] === 'spend-by-day' && method === 'GET') return handleFinanceSpendByDay(url, env, authUser, workspaceId);
            if (segments[0] === 'providers' && method === 'GET') return handleFinanceProviders(env, authUser);
            if (segments[0] === 'budgets' && method === 'GET') return handleFinanceBudgetsGet(env, authUser);
            if (segments[0] === 'budgets' && method === 'POST') return handleFinanceBudgetsPost(request, env, authUser);
            if (segments[0] === 'alerts' && method === 'GET') return handleFinanceAlertsGet(env, authUser);
            if (segments[0] === 'alerts' && segments[1] && segments[2] === 'resolve' && method === 'POST') {
                return handleFinanceAlertResolve(env, authUser, segments[1]);
            }
            if (segments[0] === 'import-csv' && method === 'POST') return handleFinanceImportCsv(request, env, authUser);
        }

        // ── /api/clients — explicit platform-finance grant only ──
        if (pathLower === '/api/clients') {
            if (!canViewPlatformFinance) return jsonResponse({ success: true, clients: [], _scoped: true }, 200);
            return handleClientsRequest(request, url, env);
        }

        // ── /api/projects* — scoped via authUser inside handler ──
        if (pathLower.startsWith('/api/projects')) {
            return handleProjectsApi(request, url, env, authUser, ctx);
        }

        return jsonResponse({ error: 'Finance route not found' }, 404);
    } catch (e) {
        return jsonResponse({ error: String(e.message || e) }, 500);
    }
}

// --- Implementation Handlers ---

async function handleFinanceSummary(url, env, authUser, canViewPlatformFinance, workspaceId) {
    const monthStart = currentMonthStart();
    const { sql: scopeSql, binds: scopeBinds } = buildScopeWhere(authUser, { workspaceId });

    // AI spend is safe for all users — always scoped to their tenant+workspace
    const usageMtd = await safeQuery(
        env.DB,
        `SELECT COALESCE(SUM(cost_usd), 0) AS ai_spend_mtd,
                COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens_mtd
         FROM agentsam_usage_rollups_daily
         WHERE ${scopeSql} AND day >= ?`,
        [...scopeBinds, monthStart],
    );

    const sparkline = await safeAll(
        env.DB,
        `SELECT day, COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM agentsam_usage_rollups_daily
         WHERE ${scopeSql} AND day >= date('now', '-30 days')
         GROUP BY day
         ORDER BY day ASC`,
        scopeBinds,
    );

    // Platform P&L data — explicit D1 grant only.
    if (!canViewPlatformFinance) {
        return jsonResponse({
            success: true,
            ai_spend_mtd: Number(usageMtd?.ai_spend_mtd ?? 0),
            tokens_mtd: Number(usageMtd?.tokens_mtd ?? 0),
            mrr: 0,
            net_cashflow_last_month: 0,
            last_pl_period: null,
            monthly_pl: [],
            client_revenue: [],
            daily_spend_sparkline: (sparkline?.results || []).map((r) => ({
                day: r.day,
                cost_usd: Number(r.cost_usd ?? 0),
            })),
            _scoped: true,
        });
    }

    const tenantId = authUser?.tenant_id ?? null;

    const mrrRow = await safeQuery(
        env.DB,
        `SELECT COALESCE(SUM(monthly_recurring_revenue), 0) AS mrr
         FROM client_revenue
         WHERE payment_status = 'current'`,
    );

    const lastPl = await safeQuery(
        env.DB,
        `SELECT year, month, total_income, total_expenses, net_cashflow
         FROM financial_monthly_summaries
         ORDER BY year DESC, month DESC
         LIMIT 1`,
    );

    const monthlyPl = await safeAll(
        env.DB,
        `SELECT year, month, total_income, total_expenses, net_cashflow
         FROM financial_monthly_summaries
         ORDER BY year DESC, month DESC
         LIMIT 6`,
    );

    const clientRevenueSql = tenantId
        ? `SELECT client_name, monthly_recurring_revenue, payment_status, onboarding_status
           FROM client_revenue
           WHERE tenant_id = ? OR tenant_id IS NULL
           ORDER BY monthly_recurring_revenue DESC`
        : `SELECT client_name, monthly_recurring_revenue, payment_status, onboarding_status
           FROM client_revenue
           ORDER BY monthly_recurring_revenue DESC`;
    const clientRevenue = await safeAll(
        env.DB,
        clientRevenueSql,
        tenantId ? [tenantId] : [],
    );

    let analytics_extension = {};
    try {
        analytics_extension = await buildFinanceAnalyticsExtension(env, {
            isPlatformOperator: canViewPlatformFinance,
            tenantId,
            workspaceId,
        });
    } catch {
        analytics_extension = {};
    }

    return jsonResponse({
        success: true,
        ai_spend_mtd: Number(usageMtd?.ai_spend_mtd ?? 0),
        tokens_mtd: Number(usageMtd?.tokens_mtd ?? 0),
        mrr: Number(mrrRow?.mrr ?? 0),
        net_cashflow_last_month: Number(lastPl?.net_cashflow ?? 0),
        last_pl_period: lastPl
            ? { year: Number(lastPl.year), month: Number(lastPl.month) }
            : null,
        monthly_pl: (monthlyPl?.results || []).slice().reverse(),
        client_revenue: clientRevenue?.results || [],
        daily_spend_sparkline: (sparkline?.results || []).map((r) => ({
            day: r.day,
            cost_usd: Number(r.cost_usd ?? 0),
        })),
        analytics_extension,
    });
}

async function handleFinanceHealth(env) {
    const [inRow, outRow] = await Promise.all([
        safeQuery(
            env.DB,
            `SELECT COALESCE(SUM(amount_cents), 0) / 100.0 AS total
             FROM finance_transactions
             WHERE direction IN ('credit', 'in')`,
        ),
        safeQuery(
            env.DB,
            `SELECT COALESCE(SUM(amount_cents), 0) / 100.0 AS total
             FROM finance_transactions
             WHERE direction IN ('debit', 'expense', 'out')`,
        ),
    ]);
    return jsonResponse({
        success: true,
        total_in_all_time: Number(inRow?.total ?? 0),
        total_out_all_time: Number(outRow?.total ?? 0),
    });
}

async function handleFinanceBreakdown(url, env) {
    const month = url.searchParams.get('month') || '';
    const monthStart = month ? `date('${month}-01')` : `date('1900-01-01')`;
    const monthEnd = month ? `date('${month}-01','+1 month','-1 day')` : `date('now','+1 year')`;
    const { results } = await env.DB.prepare(
        `SELECT COALESCE(category, 'Uncategorized') as category_name, direction, SUM(amount_cents)/100.0 as total FROM finance_transactions WHERE date >= ${monthStart} AND date <= ${monthEnd} GROUP BY category, direction`
    ).all();
    return jsonResponse({ success: true, data: results || [] });
}

async function handleFinanceCategories(env) {
    const { results } = await env.DB.prepare(`SELECT id, name as category_name, color as category_color FROM finance_categories LIMIT 100`).all();
    return jsonResponse({ success: true, data: results || [] });
}

async function handleFinanceAccounts(env) {
    const { results } = await env.DB.prepare(`SELECT id, name as display_name, email FROM financial_accounts LIMIT 100`).all();
    return jsonResponse({ success: true, data: results || [] });
}

async function handleFinanceAiSpend(url, env, authUser, workspaceId) {
    const monthStart = currentMonthStart();
    const { sql: scopeSql, binds: scopeBinds } = buildScopeWhere(authUser, { workspaceId });
    const summary = await safeQuery(
        env.DB,
        `SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS count
         FROM agentsam_usage_rollups_daily
         WHERE ${scopeSql} AND day >= ?`,
        [...scopeBinds, monthStart],
    );
    const list = await safeAll(
        env.DB,
        `SELECT day AS occurred_at, cost_usd AS amount_usd, provider_breakdown_json
         FROM agentsam_usage_rollups_daily
         WHERE ${scopeSql} AND day >= ?
         ORDER BY day DESC
         LIMIT 100`,
        [...scopeBinds, monthStart],
    );
    return jsonResponse({
        success: true,
        total_usd: Number(summary?.total ?? 0),
        count: Number(summary?.count ?? 0),
        rows: list?.results || [],
    });
}

function isMissingTableError(error) {
    const msg = String(error?.message || error || '').toLowerCase();
    return msg.includes('no such table');
}

/**
 * MTD AI spend breakdown — models + providers from agentsam_usage_events (accurate),
 * daily totals from agentsam_usage_rollups_daily (rollup SSOT for day totals).
 * Legacy `rows` kept for older finance chart callers (provider-keyed day slices).
 */
async function handleFinanceSpendByModel(env, authUser, workspaceId) {
    try {
        const monthStart = currentMonthStart();
        const { sql: eventScope, binds: eventBinds } = buildScopeWhere(authUser, { workspaceId });
        const { sql: rollupScope, binds: rollupBinds } = buildScopeWhere(authUser, { alias: 'r', workspaceId });
        const monthStartUnix = Math.floor(new Date(`${monthStart}T00:00:00Z`).getTime() / 1000);

        const [modelRes, providerRes, dailyRes, legacyRes, totalsRes] = await Promise.all([
            env.DB.prepare(`
                SELECT
                  COALESCE(NULLIF(TRIM(model_key), ''), NULLIF(TRIM(model), ''), 'unknown') AS key,
                  ROUND(SUM(COALESCE(cost_usd, 0)), 6) AS cost_usd,
                  COUNT(*) AS request_count
                FROM agentsam_usage_events
                WHERE ${eventScope}
                  AND created_at >= ?
                GROUP BY key
                HAVING cost_usd > 0 OR request_count > 0
                ORDER BY cost_usd DESC
                LIMIT 40
            `).bind(...eventBinds, monthStartUnix).all(),
            env.DB.prepare(`
                SELECT
                  COALESCE(NULLIF(LOWER(TRIM(provider)), ''), 'unknown') AS key,
                  ROUND(SUM(COALESCE(cost_usd, 0)), 6) AS cost_usd,
                  COUNT(*) AS request_count
                FROM agentsam_usage_events
                WHERE ${eventScope}
                  AND created_at >= ?
                GROUP BY key
                HAVING cost_usd > 0 OR request_count > 0
                ORDER BY cost_usd DESC
                LIMIT 24
            `).bind(...eventBinds, monthStartUnix).all(),
            env.DB.prepare(`
                SELECT r.day AS day,
                       ROUND(SUM(r.cost_usd), 6) AS cost_usd,
                       COALESCE(SUM(r.ai_calls), 0) AS request_count
                FROM agentsam_usage_rollups_daily r
                WHERE ${rollupScope} AND r.day >= ?
                GROUP BY r.day
                ORDER BY r.day ASC
            `).bind(...rollupBinds, monthStart).all(),
            env.DB.prepare(`
                SELECT
                    j.key AS model_key,
                    j.key AS provider_slug,
                    r.day AS day,
                    ROUND(SUM(CAST(json_extract(j.value, '$.cost_usd') AS REAL)), 6) AS total_usd,
                    SUM(CAST(json_extract(j.value, '$.requests') AS INTEGER)) AS request_count
                FROM agentsam_usage_rollups_daily r,
                     json_each(COALESCE(r.provider_breakdown_json, '{}')) j
                WHERE ${rollupScope}
                  AND r.day >= ?
                GROUP BY j.key, r.day
                ORDER BY total_usd DESC
            `).bind(...rollupBinds, monthStart).all(),
            env.DB.prepare(`
                SELECT COALESCE(SUM(cost_usd), 0) AS total_usd,
                       COALESCE(SUM(ai_calls), 0) AS request_count
                FROM agentsam_usage_rollups_daily
                WHERE ${eventScope} AND day >= ?
            `).bind(...eventBinds, monthStart).first(),
        ]);

        const toSlices = (rows) => {
            const list = (rows || [])
                .map((r) => ({
                    key: String(r.key || 'unknown'),
                    cost_usd: Number(r.cost_usd) || 0,
                    request_count: Number(r.request_count) || 0,
                }))
                .filter((r) => r.key !== 'unknown' || r.cost_usd > 0);
            const sum = list.reduce((s, r) => s + r.cost_usd, 0) || 0;
            return list.map((r) => ({
                ...r,
                pct: sum > 0 ? Math.round((r.cost_usd / sum) * 1000) / 10 : 0,
            }));
        };

        const models = toSlices(modelRes?.results);
        const providers = toSlices(providerRes?.results);
        const daily = (dailyRes?.results || []).map((r) => ({
            day: String(r.day || ''),
            cost_usd: Number(r.cost_usd) || 0,
            request_count: Number(r.request_count) || 0,
        }));
        const peak = daily.reduce(
            (best, d) => (d.cost_usd > (best?.cost_usd || 0) ? d : best),
            null,
        );
        const daysWithSpend = daily.filter((d) => d.cost_usd > 0).length;
        const totalUsd = Number(totalsRes?.total_usd) || daily.reduce((s, d) => s + d.cost_usd, 0);
        const requestCount =
            Number(totalsRes?.request_count) ||
            daily.reduce((s, d) => s + d.request_count, 0);

        const legacyRows = legacyRes?.results || [];
        return jsonResponse({
            period: 'mtd',
            month_start: monthStart,
            total_usd: totalUsd,
            request_count: requestCount,
            daily_avg: daysWithSpend ? totalUsd / daysWithSpend : 0,
            peak_day: peak,
            models,
            providers,
            projects: [],
            daily,
            rows: legacyRows,
            model_keys: models.map((m) => m.key),
        });
    } catch (error) {
        if (isMissingTableError(error)) {
            return jsonResponse({
                period: 'mtd',
                total_usd: 0,
                request_count: 0,
                daily_avg: 0,
                peak_day: null,
                models: [],
                providers: [],
                projects: [],
                daily: [],
                rows: [],
                model_keys: [],
            });
        }
        throw error;
    }
}

function spendByDayRangeClause(range) {
    const r = String(range || '30d').toLowerCase();
    if (r === '7d') return `r.day >= date('now', '-7 days')`;
    if (r === 'mtd') return `r.day >= date('now', 'start of month')`;
    return `r.day >= date('now', '-30 days')`;
}

function normalizeRollupProviderSlug(key) {
    const x = String(key || '').trim().toLowerCase();
    if (!x || x === 'unknown') return '';
    if (x === 'workers_ai' || x === 'cloudflare') return 'cloudflare_workers_ai';
    return x;
}

/** @param {import('@cloudflare/workers-types').D1Database} db @param {string | null} tenantId */
async function loadFinanceProviderColorMap(db, tenantId) {
    if (!db || !tenantId) return {};
    const { results } = await db
        .prepare(
            `SELECT id, color, ai_keywords
             FROM finance_categories
             WHERE kind = 'provider' AND tenant_id = ?`,
        )
        .bind(tenantId)
        .all()
        .catch(() => ({ results: [] }));
    /** @type {Record<string, string>} */
    const map = {};
    for (const row of results || []) {
        const color = String(row.color || '').trim();
        if (!color) continue;
        let keys = [];
        try {
            const parsed = JSON.parse(String(row.ai_keywords || '[]'));
            keys = Array.isArray(parsed) ? parsed : [];
        } catch {
            keys = [];
        }
        for (const k of keys) {
            const nk = normalizeRollupProviderSlug(k);
            if (nk) map[nk] = color;
        }
        const slug = String(row.id || '').replace(/^cat_provider_/, '');
        const nk = normalizeRollupProviderSlug(slug);
        if (nk) map[nk] = color;
    }
    return map;
}

async function handleFinanceSpendByDay(url, env, authUser, workspaceId) {
    try {
        const range = url.searchParams.get('range') || '30d';
        const dayFilter = spendByDayRangeClause(range);
        const { sql: scopeSql, binds: scopeBinds } = buildScopeWhere(authUser, { alias: 'r', workspaceId });
        const tenantId = authUser?.tenant_id ?? null;

        const [{ results }, { results: dailyTotals }] = await Promise.all([
            env.DB.prepare(`
            SELECT
                r.day AS date,
                CASE
                  WHEN LOWER(j.key) IN ('workers_ai', 'cloudflare') THEN 'cloudflare_workers_ai'
                  ELSE LOWER(j.key)
                END AS provider_slug,
                ROUND(SUM(CAST(json_extract(j.value, '$.cost_usd') AS REAL)), 6) AS total_usd,
                SUM(CAST(json_extract(j.value, '$.requests') AS INTEGER)) AS request_count
            FROM agentsam_usage_rollups_daily r,
                 json_each(COALESCE(r.provider_breakdown_json, '{}')) j
            WHERE ${scopeSql}
              AND ${dayFilter}
              AND j.key IS NOT NULL AND TRIM(j.key) != ''
            GROUP BY r.day, provider_slug
            HAVING provider_slug != '' AND provider_slug != 'unknown'
            ORDER BY r.day ASC
        `).bind(...scopeBinds).all(),
            env.DB.prepare(`
            SELECT r.day AS date, ROUND(SUM(r.cost_usd), 6) AS total_usd
            FROM agentsam_usage_rollups_daily r
            WHERE ${scopeSql} AND ${dayFilter}
            GROUP BY r.day
            ORDER BY r.day ASC
        `).bind(...scopeBinds).all(),
        ]);

        const rows = results || [];
        const providers = [...new Set(rows.map((row) => normalizeRollupProviderSlug(row.provider_slug)).filter(Boolean))];
        const dates = [...new Set(rows.map((row) => row.date).filter(Boolean))];
        const provider_colors = await loadFinanceProviderColorMap(env.DB, tenantId);

        return jsonResponse({
            rows,
            providers,
            dates,
            range,
            daily_totals: dailyTotals || [],
            provider_colors,
        });
    } catch (error) {
        if (isMissingTableError(error)) {
            return jsonResponse({
                rows: [], providers: [], dates: [], range: '30d', daily_totals: [], provider_colors: {},
            });
        }
        throw error;
    }
}

async function handleFinanceProviders(env, authUser) {
    const tenantId = authUser?.tenant_id ?? null;
    if (!tenantId) return jsonResponse({ success: true, providers: [] });
    try {
        const { results } = await env.DB.prepare(
            `SELECT id, name, color, ai_keywords
             FROM finance_categories
             WHERE kind = 'provider' AND tenant_id = ?`,
        ).bind(tenantId).all();
        return jsonResponse({ success: true, providers: results || [] });
    } catch (error) {
        if (isMissingTableError(error)) return jsonResponse({ success: true, providers: [] });
        throw error;
    }
}

async function handleFinanceBudgetsGet(env, authUser) {
    try {
        const tenantId = authUser?.tenant_id ?? null;
        const { results } = await env.DB.prepare(`
            SELECT
                b.id,
                b.tenant_id,
                b.month,
                b.category_id,
                b.budget_cents,
                b.created_at,
                b.updated_at,
                c.name AS category_name,
                c.color AS category_color,
                c.kind AS category_kind
            FROM finance_budgets b
            LEFT JOIN finance_categories c
              ON c.id = b.category_id
             AND (c.tenant_id = b.tenant_id OR c.tenant_id IS NULL)
            WHERE b.tenant_id = ?
            ORDER BY b.created_at DESC
        `).bind(tenantId).all();
        return jsonResponse({ budgets: results || [] });
    } catch (error) {
        if (isMissingTableError(error)) return jsonResponse({ budgets: [] });
        throw error;
    }
}

async function handleFinanceBudgetsPost(request, env, authUser) {
    const body = await request.json().catch(() => ({}));
    const tenantId = authUser?.tenant_id ?? null;
    const { month, category_id, budget_cents } = body;
    await env.DB.prepare(
        `INSERT INTO finance_budgets (tenant_id, month, category_id, budget_cents, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(tenantId, month ?? null, category_id ?? null, budget_cents ?? 0).run();
    return jsonResponse({ ok: true });
}

async function handleFinanceAlertsGet(env, authUser) {
    try {
        const tenantId = authUser?.tenant_id ?? null;
        const { results } = await env.DB.prepare(`
            SELECT *
            FROM spend_alerts
            WHERE resolved = 0 AND tenant_id = ?
            ORDER BY created_at DESC
        `).bind(tenantId).all();
        return jsonResponse({ alerts: results || [] });
    } catch (error) {
        if (isMissingTableError(error)) return jsonResponse({ alerts: [] });
        throw error;
    }
}

async function handleFinanceAlertResolve(env, authUser, id) {
    const tenantId = authUser?.tenant_id ?? null;
    await env.DB.prepare(`
        UPDATE spend_alerts
        SET resolved = 1, resolved_at = datetime('now')
        WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).run();
    return jsonResponse({ ok: true });
}

async function handleFinanceTransactionsList(url, env, authUser) {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const tenantId = authUser?.tenant_id ?? null;
    const { results } = await env.DB.prepare(`
        SELECT
            t.id,
            t.tenant_id,
            t.account_id,
            t.date,
            t.amount_cents,
            t.direction,
            t.merchant,
            t.description,
            t.category_id,
            t.source_type,
            t.source_upload_id,
            t.created_at,
            c.name AS category_name
        FROM finance_transactions t
        LEFT JOIN finance_categories c
          ON c.id = t.category_id
         AND (c.tenant_id = t.tenant_id OR c.tenant_id IS NULL)
        WHERE t.tenant_id = ?
        ORDER BY t.date DESC, t.id DESC
        LIMIT ?
    `).bind(tenantId, limit).all();

    const transactions = (results || []).map((row) => ({
        id: row.id,
        tenant_id: row.tenant_id,
        workspace_id: null,
        account_id: row.account_id,
        date: row.date,
        transaction_date: row.date,
        amount_cents: row.amount_cents,
        amount: Number(row.amount_cents ?? 0) / 100,
        direction: ['debit', 'expense', 'out'].includes(String(row.direction || '').toLowerCase()) ? 'out' : 'in',
        raw_direction: row.direction,
        merchant: row.merchant,
        description: row.description,
        category_id: row.category_id,
        category_name: row.category_name ?? null,
        source: row.source_type ?? 'unknown',
        source_type: row.source_type,
        source_upload_id: row.source_upload_id,
        created_at: row.created_at,
    }));
    return jsonResponse({ success: true, transactions });
}

async function handleFinanceTransactionGet(env, id, authUser) {
    const tenantId = authUser?.tenant_id ?? null;
    const row = await env.DB.prepare(`
        SELECT t.*, c.name AS category_name
        FROM finance_transactions t
        LEFT JOIN finance_categories c ON c.id = t.category_id
        WHERE t.id = ? AND t.tenant_id = ?
    `).bind(id, tenantId).first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    return jsonResponse({ success: true, data: row });
}

async function handleFinanceTransactionMutate(request, env, id, method, authUser) {
    const tenantId = authUser?.tenant_id ?? null;
    if (method === 'DELETE') {
        await env.DB.prepare(`DELETE FROM finance_transactions WHERE id = ? AND tenant_id = ?`).bind(id, tenantId).run();
        return jsonResponse({ success: true });
    }
    const body = await request.json().catch(() => ({}));
    const updates = [];
    const bindings = [];
    const fieldMap = {
        date: 'date',
        transaction_date: 'date',
        description: 'description',
        merchant: 'merchant',
        direction: 'direction',
        category_id: 'category_id',
        amount: 'amount_cents',
        amount_cents: 'amount_cents',
    };
    for (const [k, v] of Object.entries(body)) {
        const col = fieldMap[k];
        if (!col) continue;
        if (col === 'amount_cents' && k === 'amount') {
            updates.push('amount_cents = ?');
            bindings.push(Math.round(Math.abs(Number(v) || 0) * 100));
            continue;
        }
        updates.push(`${col} = ?`);
        bindings.push(v);
    }
    if (!updates.length) return jsonResponse({ success: true });
    updates.push(`updated_at = datetime('now')`);
    bindings.push(id, tenantId);
    await env.DB.prepare(
        `UPDATE finance_transactions SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`,
    ).bind(...bindings).run();
    return jsonResponse({ success: true });
}

async function handleFinanceImportCsv(request, env, authUser) {
    const { csv, filename } = await request.json().catch(() => ({}));
    if (!csv) return jsonResponse({ error: 'csv required' }, 400);
    const tenantId = authUser?.tenant_id ?? null;
    if (!tenantId) return jsonResponse({ error: 'tenant required' }, 400);

    const lines = csv.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return jsonResponse({ success: true, imported: 0 });

    const importId = `csv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const rowCount = lines.length - 1;

    await env.DB.prepare(`
        INSERT INTO csv_imports (
            import_id, filename, uploaded_at, uploaded_by, source_type,
            row_count, processed_count, status, created_at
        ) VALUES (?, ?, datetime('now'), ?, 'finance_transactions', ?, 0, 'processing', datetime('now'))
    `).bind(importId, filename || 'import.csv', authUser?.id ?? authUser?.user_id ?? 'unknown', rowCount).run();

    const insertStmt = env.DB.prepare(`
        INSERT INTO finance_transactions (
            id, tenant_id, date, amount_cents, direction, description, merchant,
            source_type, source_upload_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'csv_import', ?, datetime('now'), datetime('now'))
    `);

    let imported = 0;
    for (const line of lines.slice(1)) {
        const p = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
        if (p.length < 3) continue;
        const [date, description, amountRaw, directionRaw] = p;
        const amount = Math.abs(parseFloat(amountRaw));
        if (!date || !description || !Number.isFinite(amount)) continue;
        const dir = String(directionRaw || '').toLowerCase();
        const direction = dir === 'in' || dir === 'credit' ? 'credit' : 'debit';
        const txnId = `ft_${importId}_${imported}`;
        await insertStmt.bind(
            txnId,
            tenantId,
            date,
            Math.round(amount * 100),
            direction,
            description,
            p[4] || null,
            importId,
        ).run();
        imported++;
    }

    await env.DB.prepare(`
        UPDATE csv_imports
        SET processed_count = ?, status = 'complete', uploaded_at = datetime('now')
        WHERE import_id = ?
    `).bind(imported, importId).run();

    return jsonResponse({ success: true, imported, import_id: importId });
}

async function handleClientsRequest(request, url, env) {
    const method = request.method;
    if (method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT * FROM clients WHERE COALESCE(status, '') != 'merged' ORDER BY name ASC`).all();
        return jsonResponse({ success: true, clients: results || [] });
    }
    if (method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const clientId = body.id || 'client_' + Math.random().toString(36).slice(2, 10);
        await env.DB.prepare(`INSERT OR REPLACE INTO clients (id, name, email, domain, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())`)
            .bind(clientId, body.name, body.email, body.domain, body.status || 'active').run();
        return jsonResponse({ success: true, id: clientId });
    }
    return jsonResponse({ error: 'Method not allowed' }, 405);
}

async function handleBillingSummary(env) {
    const { results } = await env.DB.prepare(`SELECT i.*, c.name as client_name FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.status = 'paid' ORDER BY i.paid_at DESC`).all();
    const total = (results || []).reduce((a, i) => a + (Number(i.amount) || 0), 0);
    return jsonResponse({ success: true, invoices: results || [], total_collected: total });
}
