/**
 * Platform Quickstart gallery — D1 agentsam_subagent_profile (is_platform_global = 1).
 * GET /api/agent/quickstart/templates
 */

import { readD1TableColumns as getD1TableColumns } from '../../../services/d1/schema.js';

const SLUG_ROUTING_DEFAULTS = {
  'deep-researcher': { task_type: 'web_search', route_key: 'chat' },
  'code-editor': { task_type: 'code', route_key: 'code' },
  'deploy-validator': { task_type: 'deploy', route_key: 'deploy_validation' },
  'model-compare': { task_type: 'chat', route_key: 'model_comparison' },
};

/** Shipped fallback when D1 has no platform-global rows yet (matches legacy static UI). */
export const QUICKSTART_TEMPLATE_FALLBACK = [
  {
    id: 'tpl_deep_research',
    slug: 'deep-researcher',
    name: 'Deep researcher',
    description: 'Multi-step research with sources, synthesis, and gap analysis.',
    model_hint: 'claude-sonnet-4-6',
    seed_message:
      'Quickstart: Deep researcher. Help me investigate a topic with sub-questions, cited sources, and a confidence-scored summary. Ask what topic to research if I have not specified one.',
    task_type: 'web_search',
    route_key: 'chat',
    subagent_slug: 'deep-researcher',
    sort_order: 10,
    icon: '',
    agent_type: 'research',
    subagent_profile_id: null,
  },
  {
    id: 'tpl_code_editor',
    slug: 'code-editor',
    name: 'Code editor',
    description: 'Implement, refactor, and fix code in this workspace with Monaco and terminal tools.',
    model_hint: 'claude-sonnet-4-6',
    seed_message:
      'Quickstart: Code editor. I want to implement or fix something in this repo. Ask what file or feature to touch, then use workspace read/search and terminal only when needed.',
    task_type: 'code',
    route_key: 'code',
    subagent_slug: 'code-editor',
    sort_order: 20,
    icon: '',
    agent_type: 'code',
    subagent_profile_id: null,
  },
  {
    id: 'tpl_deploy_validator',
    slug: 'deploy-validator',
    name: 'Deploy validator',
    description: 'Health check, dashboard asset integrity, and deploy proof — not health-only.',
    model_hint: 'gemini-3.5-flash-lite',
    seed_message:
      'Quickstart: Deploy validator. Walk me through validating a deploy: Worker /health, dashboard HTML chunk 200s, and browser proof. Ask which surface we are shipping.',
    task_type: 'deploy',
    route_key: 'deploy_validation',
    subagent_slug: 'deploy-validator',
    sort_order: 30,
    icon: '',
    agent_type: 'deploy',
    subagent_profile_id: null,
  },
  {
    id: 'tpl_model_compare',
    slug: 'model-compare',
    name: 'Model compare',
    description: 'Run the same prompt across models and compare latency, cost, and quality.',
    model_hint: 'Thompson routing',
    seed_message:
      'Quickstart: Model compare. I will give you one prompt — help me run it fairly across 2–3 models and summarize tokens, cost, and quality. Ask for the prompt if missing.',
    task_type: 'chat',
    route_key: 'model_comparison',
    subagent_slug: 'model-compare',
    sort_order: 40,
    icon: '',
    agent_type: 'eval',
    subagent_profile_id: null,
  },
];

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function parseJsonObject(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return /** @type {Record<string, unknown>} */ (raw);
  try {
    const p = JSON.parse(String(raw));
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, unknown>} row
 * @returns {{ task_type: string, route_key: string, model_hint: string | null, seed_message: string | null }}
 */
function quickstartConfigFromRow(row) {
  const slug = String(row.slug || '').trim();
  const defaults = SLUG_ROUTING_DEFAULTS[slug] || { task_type: 'chat', route_key: 'chat' };

  const root = parseJsonObject(row.output_schema_json);
  const qs =
    root.quickstart && typeof root.quickstart === 'object' && !Array.isArray(root.quickstart)
      ? /** @type {Record<string, unknown>} */ (root.quickstart)
      : root;

  const task_type =
    qs.task_type != null && String(qs.task_type).trim() !== ''
      ? String(qs.task_type).trim()
      : qs.taskType != null && String(qs.taskType).trim() !== ''
        ? String(qs.taskType).trim()
        : defaults.task_type;

  const route_key =
    qs.route_key != null && String(qs.route_key).trim() !== ''
      ? String(qs.route_key).trim()
      : qs.routeKey != null && String(qs.routeKey).trim() !== ''
        ? String(qs.routeKey).trim()
        : defaults.route_key;

  const model_hint =
    qs.model_hint != null && String(qs.model_hint).trim() !== ''
      ? String(qs.model_hint).trim()
      : qs.modelHint != null && String(qs.modelHint).trim() !== ''
        ? String(qs.modelHint).trim()
        : row.default_model_id != null && String(row.default_model_id).trim() !== ''
          ? String(row.default_model_id).trim()
          : 'auto';

  let seed_message = null;
  if (qs.seed_message != null && String(qs.seed_message).trim() !== '') {
    seed_message = String(qs.seed_message).trim();
  } else if (qs.seedMessage != null && String(qs.seedMessage).trim() !== '') {
    seed_message = String(qs.seedMessage).trim();
  } else if (row.instructions_markdown != null && String(row.instructions_markdown).trim() !== '') {
    seed_message = String(row.instructions_markdown).trim();
  } else if (row.description != null && String(row.description).trim() !== '') {
    const name = String(row.display_name || slug || 'Agent').trim();
    seed_message = `Quickstart: ${name}. ${String(row.description).trim()}`;
  }

  let open_surface = null;
  const rawSurface = qs.open_surface ?? qs.openSurface ?? null;
  if (rawSurface != null && String(rawSurface).trim() !== '') {
    const s = String(rawSurface).trim().toLowerCase();
    if (s === 'excalidraw' || s === 'wireframe') open_surface = s;
  }

  return { task_type, route_key, model_hint, seed_message, open_surface };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {QuickstartTemplateDto}
 */
export function mapSubagentRowToQuickstartTemplate(row) {
  const slug = String(row.slug || '').trim();
  const cfg = quickstartConfigFromRow(row);
  const name = String(row.display_name || slug || 'Agent').trim();

  return {
    id: String(row.id || `tpl_${slug}`).trim(),
    slug,
    name,
    description: String(row.description ?? '').trim(),
    model_hint: cfg.model_hint || 'auto',
    seed_message: cfg.seed_message || `Quickstart: ${name}. How can I help?`,
    task_type: cfg.task_type,
    route_key: cfg.route_key,
    open_surface: cfg.open_surface,
    subagent_slug: slug,
    sort_order: Number(row.sort_order) || 0,
    icon: String(row.icon ?? '').trim(),
    agent_type: String(row.agent_type ?? 'custom').trim(),
    subagent_profile_id: String(row.id || '').trim() || null,
  };
}

/**
 * @typedef {{
 *   id: string,
 *   slug: string,
 *   name: string,
 *   description: string,
 *   model_hint: string,
 *   seed_message: string,
 *   task_type: string,
 *   route_key: string,
 *   subagent_slug: string,
 *   sort_order: number,
 *   icon: string,
 *   agent_type: string,
 *   subagent_profile_id: string | null,
 * }} QuickstartTemplateDto
 */

/**
 * @param {any} env
 * @returns {Promise<{ templates: QuickstartTemplateDto[], source: 'd1' | 'fallback' }>}
 */
export async function listPlatformQuickstartTemplates(env) {
  if (!env?.DB) {
    return { templates: [...QUICKSTART_TEMPLATE_FALLBACK], source: 'fallback' };
  }

  const cols = await getD1TableColumns(env.DB, 'agentsam_subagent_profile');
  if (!cols.size) {
    return { templates: [...QUICKSTART_TEMPLATE_FALLBACK], source: 'fallback' };
  }

  const hasGlobal = cols.has('is_platform_global');
  const selectCols = [
    'id',
    'slug',
    'display_name',
    cols.has('description') ? "COALESCE(description, '') AS description" : "'' AS description",
    'default_model_id',
    'instructions_markdown',
    cols.has('output_schema_json') ? 'output_schema_json' : "NULL AS output_schema_json",
    cols.has('sort_order') ? 'COALESCE(sort_order, 0) AS sort_order' : '0 AS sort_order',
    cols.has('icon') ? "COALESCE(icon, '') AS icon" : "'' AS icon",
    cols.has('agent_type') ? "COALESCE(agent_type, 'custom') AS agent_type" : "'custom' AS agent_type",
  ].join(', ');

  const whereGlobal = hasGlobal ? 'COALESCE(is_platform_global, 0) = 1' : '1 = 0';

  try {
    const q = await env.DB.prepare(
      `SELECT ${selectCols}
         FROM agentsam_subagent_profile
        WHERE is_active = 1 AND ${whereGlobal}
        ORDER BY sort_order ASC, display_name ASC`,
    ).all();

    const rows = q.results || [];
    if (!rows.length) {
      return { templates: [...QUICKSTART_TEMPLATE_FALLBACK], source: 'fallback' };
    }

    return {
      templates: rows.map((r) => mapSubagentRowToQuickstartTemplate(r)),
      source: 'd1',
    };
  } catch (e) {
    console.warn('[quickstart-templates] query failed', e?.message ?? e);
    return { templates: [...QUICKSTART_TEMPLATE_FALLBACK], source: 'fallback' };
  }
}
