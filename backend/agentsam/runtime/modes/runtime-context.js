/**
 * SSE runtime_context payload — dashboard proof of mode alignment.
 *
 * Keep this payload stable and derived only from the compiled RuntimeProfile.
 * Do not add user message heuristics here.
 */

/**
 * @param {Record<string, any>} profile
 * @param {{ modelOverride?: string|null }} [meta]
 */
export function runtimeContextPayload(profile, meta = {}) {
  const allow = profile?.tool_policy?.allowlist || profile?.tool_allowlist || [];
  const deny = profile?.tool_policy?.denylist || [];
  const toolNames = Array.isArray(allow) ? allow.map((t) => String(t)).filter(Boolean) : [];
  return {
    mode: profile.mode,
    mode_controller: profile.mode_controller,
    profile_id: profile.profile_id,
    profile_hash: profile.profile_hash,
    write_policy: profile.write_policy,
    tool_profile: profile.tool_profile,
    tool_policy: {
      allowlist_count: toolNames.length || allow.length,
      denylist_count: deny.length,
      max_tool_calls: profile?.tool_policy?.max_tool_calls ?? profile.max_tool_calls ?? null,
    },
    model: profile.model_key,
    model_key: profile.model_key,
    provider: profile.selected_provider ?? null,
    routing_arm_id: profile.routing_arm_id ?? null,
    tool_names: toolNames.slice(0, 24),
    ...(meta.modelOverride != null ? { auto_model: !meta.modelOverride } : {}),
  };
}

/**
 * Compatibility alias: preserves the older `context` event shape used by some clients.
 * @param {Record<string, any>} profile
 * @param {{ toolsCount?: number, modelOverride?: string|null, routingArmId?: string|null, routingTaskType?: string|null, extra?: Record<string, unknown> }} [meta]
 */
export function legacyContextPayload(profile, meta = {}) {
  return {
    mode: profile.mode,
    runtime_mode: profile.mode,
    profile_id: profile.profile_id,
    profile_hash: profile.profile_hash,
    model: profile.model_key,
    auto_model: meta.modelOverride ? false : true,
    routing_arm_id: meta.routingArmId ?? profile.routing_arm_id ?? null,
    tool_count: meta.toolsCount ?? 0,
    routing_task_type: meta.routingTaskType ?? profile.routing_task_type ?? null,
    write_policy: profile.write_policy,
    color: profile.color,
    tool_profile: profile.tool_profile,
    tool_capable_required: profile.tool_capable_required,
    ...(meta.extra || {}),
  };
}

