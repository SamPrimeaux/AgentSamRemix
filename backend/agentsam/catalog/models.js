/**
 * Agent Sam model catalog reads.
 * HTTP adapters consume this module; catalog SQL does not belong in route files.
 */

/**
 * @param {any} env
 * @param {{ showInPicker?: boolean }} [opts]
 */
export async function listAgentModels(env, opts = {}) {
  if (!env?.DB) return [];
  const showInPicker = opts.showInPicker !== false;

  const { results } = await env.DB.prepare(
    `SELECT id,
            display_name AS name,
            display_name,
            provider,
            model_key,
            api_platform,
            show_in_picker,
            1 AS picker_eligible,
            CASE
              WHEN lower(model_key) LIKE '%antigravity%' THEN 'Antigravity'
              WHEN lower(provider) = 'cursor' THEN 'Cursor'
              WHEN lower(provider) = 'workers_ai' THEN 'Workers AI'
              WHEN lower(provider) = 'deepseek' THEN 'DeepSeek'
              ELSE provider
            END AS picker_group,
            (COALESCE(cost_per_1k_in, 0) * 1000) AS input_rate_per_mtok,
            (COALESCE(cost_per_1k_out, 0) * 1000) AS output_rate_per_mtok,
            0 AS sort_order,
            context_window AS context_max_tokens,
            tier AS size_class,
            supports_tools,
            supports_vision,
            supports_reasoning
       FROM agentsam_model_catalog
      WHERE COALESCE(is_active, 1) = 1
        ${showInPicker ? 'AND COALESCE(show_in_picker, 0) = 1' : ''}
      ORDER BY provider ASC, display_name ASC`,
  ).all();

  return (results || []).map((row) => ({
    ...row,
    byok_configured: false,
    byok_masked: null,
    billing_key_source: 'platform',
  }));
}
