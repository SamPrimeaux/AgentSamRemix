/**
 * RuntimeProfile — the single orchestration contract downstream execution should read.
 * Phase 0 schema; compiled from D1 registry at request time (Phase 1).
 *
 * @module runtime-profile.types
 */

/**
 * @typedef {import('../../backend/agentsam/runtime/mode.js').AgentMode} AgentMode
 */

/**
 * @typedef {'ask'|'plan'|'agent'|'debug'|'multitask'} RuntimeMode
 */

/**
 * @typedef {'ask_controller'|'plan_controller'|'agent_controller'|'debug_controller'|'multitask_controller'} ModeController
 */

/**
 * @typedef {Object} RuntimeWritePolicy
 * @property {boolean} can_edit_files
 * @property {boolean} can_terminal
 * @property {boolean} can_d1_write
 * @property {boolean} can_deploy
 * @property {boolean} can_browser_automation
 * @property {boolean} can_memory_write
 * @property {boolean} [can_send_email]
 * @property {boolean} [can_external_side_effects]
 * @property {boolean} [can_postgres_write]
 * @property {boolean} [can_postgres_migrate]
 */

/**
 * @typedef {'readonly_context'|'plan_artifact'|'execution'|'parallel'} ToolProfile
 */

/**
 * @typedef {Object} RuntimeToolPolicy
 * @property {string[]} allowlist
 * @property {string[]} denylist
 * @property {string[]} [require_approval]
 * @property {number} [max_tool_calls]
 * @property {number} [max_runtime_ms]
 */

/**
 * @typedef {Object} RuntimeContextPolicy
 * @property {boolean} include_rag
 * @property {boolean} include_memory
 * @property {boolean} include_workspace
 * @property {boolean} fresh_thread_recommended
 */

/**
 * @typedef {Object} RuntimeParallelPolicy
 * @property {boolean} enabled
 * @property {boolean} [execution_enabled]
 * @property {number} max_subagents
 * @property {number} [max_depth]
 * @property {string[]} allowed_subagent_types
 * @property {'synthesize'|'report'} merge_strategy
 */

/**
 * @typedef {Object} RuntimeDebugPolicy
 * @property {boolean} evidence_required_before_write
 * @property {boolean} evidence_required_before_deploy
 * @property {'hypothesize'|'inspect'|'instrument'|'fix'|'verify'|'cleanup'} phase
 */

/**
 * @typedef {Object} RuntimeProfileSource
 * @property {string|null} prompt_route_id
 * @property {string|null} route_requirements_id
 * @property {number} compiled_at
 * @property {'shadow'|'live'} compile_lane
 */

/**
 * @typedef {Object} RuntimeProfile
 * @property {AgentMode} mode
 * @property {ModeController} mode_controller
 * @property {string} profile_id
 * @property {string} profile_hash
 * @property {number} profile_version
 * @property {string|null} system_prompt_key
 * @property {string|null} system_prompt_inline
 * @property {string[]} prompt_layers
 * @property {string[]} tool_allowlist
 * @property {string[]} tool_denylist
 * @property {string[]} tool_require_approval
 * @property {RuntimeToolPolicy} tool_policy
 * @property {number} max_tools
 * @property {number} max_tool_calls
 * @property {number} max_turns
 * @property {number} max_runtime_ms
 * @property {RuntimeWritePolicy} write_policy
 * @property {string|null} workflow_key
 * @property {RuntimeContextPolicy} context_policy
 * @property {string} routing_task_type
 * @property {string|null} model_key
 * @property {string|null} routing_arm_id
 * @property {string|null} [routing_selected_by]
 * @property {number} temperature
 * @property {RuntimeParallelPolicy} parallel_policy
 * @property {RuntimeDebugPolicy|null} [debug_policy]
 * @property {RuntimeProfileSource} source
 * @property {string|null} refined_route_key
 * @property {string} color
 * @property {ToolProfile} tool_profile
 * @property {boolean} tool_capable_required
 * @property {string|null} selected_provider
 */

/**
 * @typedef {Object} RuntimeProfileSession
 * @property {string} userId
 * @property {string} workspaceId
 * @property {string|null} [tenantId]
 * @property {string|null} [conversationId]
 */

/**
 * @typedef {Object} RuntimeProfileOverrides
 * @property {string|null} [model_key]
 * @property {string|null} [subagent_slug]
 * @property {string|null} [tool_profile_key]
 * @property {string|null} [route_key]
 * @property {string|null} [task_type]
 */

/**
 * @typedef {Object} ResolveRuntimeProfileInput
 * @property {unknown} mode
 * @property {string} message
 * @property {RuntimeProfileSession} session
 * @property {RuntimeProfileOverrides} [overrides]
 * @property {'shadow'|'live'} [compile_lane]
 * @property {boolean} [skip_model_resolve] session bootstrap only — chat spine binds the model per turn
 */

export const RUNTIME_PROFILE_VERSION = 1;
