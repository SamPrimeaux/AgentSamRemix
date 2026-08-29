/**
 * Zone B — curated public.iam_* projection (learning/onboarding layer).
 * No raw copy from agentsam runtime; no user_id / tenant_id / secrets / workflow internals.
 */
import { runHyperdriveQuery, isHyperdriveUsable } from '../../backend/services/database/hyperdrive.js';

/** Columns never published to public.iam_* */
const STRIP_KEYS = new Set([
  'user_id',
  'tenant_id',
  'workspace_id',
  'auth_user_id',
  'handler_config',
  'handler_key',
  'oauth',
  'secret',
  'token',
  'password',
  'api_key',
  'routing_arm_id',
  'workflow_run_id',
  'agent_run_id',
  'cost_usd',
  'input_tokens',
  'output_tokens',
  'supabase_sync',
  'mcp_token',
]);

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} allowColumns
 */
export function sanitizePublicIamRow(row, allowColumns) {
  const out = {};
  for (const col of allowColumns) {
    if (row[col] == null) continue;
    const key = String(col);
    if (STRIP_KEYS.has(key) || /secret|token|password|oauth/i.test(key)) continue;
    const v = row[col];
    if (typeof v === 'object' && v !== null) {
      out[key] = JSON.stringify(v).slice(0, 4000);
    } else {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Sync agentsam_tools → public.iam_tool_cards (safe catalog projection).
 *
 * @param {any} env
 */
export async function syncIamToolCardsFromD1(env) {
  if (!env?.DB) return { ok: false, error: 'd1_unavailable', upserted: 0 };
  if (!isHyperdriveUsable(env)) return { ok: false, error: 'hyperdrive_unavailable', upserted: 0 };

  const rows = await env.DB.prepare(
    `SELECT tool_key, display_name, description, tool_category, risk_level, sort_priority
       FROM agentsam_tools
      WHERE COALESCE(is_active, 1) = 1
        AND COALESCE(is_degraded, 0) = 0
        AND tool_key NOT IN ('knowledge_search','rag_search','ss_search_knowledge')
        AND (
          tool_category LIKE 'research.%'
          OR tool_category LIKE 'database.%'
          OR tool_category = 'platform'
        )
      ORDER BY sort_priority ASC, tool_key ASC
      LIMIT 200`,
  ).all();

  const allow = ['slug', 'title', 'summary', 'category', 'risk_level', 'sort_order'];
  let upserted = 0;
  const errors = [];

  for (const row of rows?.results || []) {
    const pub = sanitizePublicIamRow(
      {
        slug: row.tool_key,
        title: row.display_name || row.tool_key,
        summary: String(row.description || '').slice(0, 2000),
        category: row.tool_category,
        risk_level: row.risk_level,
        sort_order: row.sort_priority ?? 0,
      },
      allow,
    );
    const sql = `INSERT INTO public.iam_tool_cards (slug, title, summary, category, risk_level, sort_order, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (slug) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        category = EXCLUDED.category,
        risk_level = EXCLUDED.risk_level,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()`;
    const r = await runHyperdriveQuery(env, sql, [
      pub.slug,
      pub.title,
      pub.summary,
      pub.category,
      pub.risk_level,
      pub.sort_order,
    ]);
    if (r.ok) upserted += 1;
    else errors.push({ slug: pub.slug, error: r.error });
  }

  return { ok: errors.length === 0, upserted, errors: errors.slice(0, 10) };
}

/**
 * @param {any} env
 * @param {{ tables?: string[] }} [opts]
 */
export async function runPublicIamSync(env, opts = {}) {
  const t0 = Date.now();
  const requested = Array.isArray(opts.tables) ? opts.tables.map(String) : null;
  const results = {};

  if (!requested || requested.includes('iam_tool_cards')) {
    results.iam_tool_cards = await syncIamToolCardsFromD1(env);
  }

  const pending = [
    'iam_glossary',
    'iam_workflow_templates',
    'iam_safe_examples',
    'iam_platform_status',
    'iam_courses',
    'iam_course_modules',
    'iam_course_lessons',
    'iam_quizzes',
    'iam_quiz_questions',
    'iam_help_categories',
    'iam_keyboard_shortcuts',
    'iam_onboarding_steps',
    'iam_ui_copy_packs',
  ].filter((t) => !requested || requested.includes(t));

  for (const table of pending) {
    if (table === 'iam_tool_cards') continue;
    results[table] = {
      ok: true,
      skipped: true,
      reason: 'source_manifest_pending',
      upserted: 0,
    };
  }

  console.info(
    '[public-iam-sync]',
    JSON.stringify({ duration_ms: Date.now() - t0, tables: requested || 'all', results }),
  );

  return {
    ok: Object.values(results).every((r) => r.ok !== false || r.skipped),
    duration_ms: Date.now() - t0,
    results,
  };
}
