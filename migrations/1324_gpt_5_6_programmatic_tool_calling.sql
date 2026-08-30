-- GPT-5.6 family + Programmatic Tool Calling runtime contract.
-- PTC is feature-gated and each tool is separately caller-policy gated.
INSERT INTO agentsam_model_catalog (
  id, model_key, display_name, provider, api_platform, tier,
  context_window, max_output_tokens, effort_default, effort_param,
  effort_levels_json, supports_tools, supports_vision, supports_streaming,
  supports_json_mode, supports_reasoning, supports_code_execution,
  supports_effort_scaling, supports_apply_patch, supports_hosted_shell,
  supports_programmatic_tool_calling, routing_lane, is_active, show_in_picker,
  updated_at
) VALUES
  (
    'gpt-5.6-sol', 'gpt-5.6-sol', 'GPT-5.6 Sol', 'openai',
    'openai_responses', 'heavy', 1050000, 128000, 'medium', 'reasoning_effort',
    '["none","low","medium","high","xhigh","max"]',
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 'reasoning', 1, 1, unixepoch()
  ),
  (
    'gpt-5.6-terra', 'gpt-5.6-terra', 'GPT-5.6 Terra', 'openai',
    'openai_responses', 'standard', 1050000, 128000, 'medium', 'reasoning_effort',
    '["none","low","medium","high","xhigh","max"]',
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 'standard', 1, 1, unixepoch()
  ),
  (
    'gpt-5.6-luna', 'gpt-5.6-luna', 'GPT-5.6 Luna', 'openai',
    'openai_responses', 'lite', 1050000, 128000, 'medium', 'reasoning_effort',
    '["none","low","medium","high","xhigh","max"]',
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 'fast', 1, 1, unixepoch()
  )
ON CONFLICT(model_key) DO UPDATE SET
  display_name = excluded.display_name,
  provider = excluded.provider,
  api_platform = excluded.api_platform,
  tier = excluded.tier,
  context_window = excluded.context_window,
  max_output_tokens = excluded.max_output_tokens,
  effort_default = excluded.effort_default,
  effort_param = excluded.effort_param,
  effort_levels_json = excluded.effort_levels_json,
  supports_tools = excluded.supports_tools,
  supports_vision = excluded.supports_vision,
  supports_streaming = excluded.supports_streaming,
  supports_json_mode = excluded.supports_json_mode,
  supports_reasoning = excluded.supports_reasoning,
  supports_code_execution = excluded.supports_code_execution,
  supports_effort_scaling = excluded.supports_effort_scaling,
  supports_apply_patch = excluded.supports_apply_patch,
  supports_hosted_shell = excluded.supports_hosted_shell,
  supports_programmatic_tool_calling = excluded.supports_programmatic_tool_calling,
  routing_lane = excluded.routing_lane,
  is_active = excluded.is_active,
  show_in_picker = excluded.show_in_picker,
  updated_at = unixepoch();

INSERT INTO agentsam_feature_flag (
  flag_key, description, enabled_globally, config_json,
  enabled_for_tenants, enabled_for_users, rollout_pct, environment,
  flag_type, created_at, updated_at, is_archived, tags
) VALUES (
  'openai_ptc',
  'OpenAI Responses Programmatic Tool Calling; exact-order store:false replay',
  0,
  '{"execution_locus":"openai_hosted_v8","store":false,"capability_column":"supports_programmatic_tool_calling","defer_loading_law":"no_defer_for_programmatic"}',
  '[]', '[]', 0, 'all', 'boolean', unixepoch(), unixepoch(), 0,
  '["openai","responses","tool-calling"]'
)
ON CONFLICT(flag_key) DO UPDATE SET
  description = excluded.description,
  config_json = excluded.config_json,
  updated_at = unixepoch(),
  is_archived = 0;

UPDATE agentsam_tools
SET caller_policy = '["direct"]',
    updated_at = unixepoch(),
    updated_at_unix = unixepoch()
WHERE is_active = 1
  AND (requires_approval = 1 OR LOWER(COALESCE(risk_level, 'high')) <> 'low');

UPDATE agentsam_tools
SET caller_policy = '["direct","programmatic"]',
    updated_at = unixepoch(),
    updated_at_unix = unixepoch()
WHERE is_active = 1
  AND requires_approval = 0
  AND LOWER(COALESCE(risk_level, 'high')) = 'low'
  AND COALESCE(tool_key, tool_name) IN (
    'agentsam_autorag',
    'agentsam_cf_d1_list',
    'agentsam_cf_kv_list',
    'agentsam_cf_r2_buckets',
    'agentsam_codebase_retrieve',
    'agentsam_d1_query',
    'agentsam_github_grep',
    'agentsam_github_list_commits',
    'agentsam_github_read',
    'agentsam_github_search',
    'agentsam_github_tree',
    'agentsam_grep',
    'agentsam_memory_search',
    'agentsam_r2_get',
    'agentsam_r2_list',
    'agentsam_search_tools',
    'agentsam_supabase_query',
    'agentsam_ticket_get',
    'agentsam_ticket_list',
    'fs_read_file',
    'fs_search_files',
    'search_web'
  );
