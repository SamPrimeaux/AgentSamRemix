/** Compact write_policy for logs — full capability arrays are Worker log noise, not model context. */
function summarizeWritePolicyForLog(wp) {
  if (!wp || typeof wp !== 'object') return null;
  const allow = Array.isArray(wp.allow_mutating_capabilities) ? wp.allow_mutating_capabilities.length : 0;
  const require = Array.isArray(wp.require_approval_capabilities)
    ? wp.require_approval_capabilities.length
    : 0;
  const deny = Array.isArray(wp.deny_capabilities) ? wp.deny_capabilities.length : 0;
  return {
    version: wp.version ?? null,
    can_edit_files: !!wp.can_edit_files,
    can_terminal: !!wp.can_terminal,
    can_d1_write: !!wp.can_d1_write,
    can_deploy: !!wp.can_deploy,
    allow_mutating_count: allow,
    require_approval_count: require,
    deny_count: deny,
  };
}

/**
 * One proof line per chat turn: resolved profile + raw request pins.
 * One field per fact — requested* must stay separate from resolved so mismatches show.
 * @param {import('./runtime-profile.types.js').RuntimeProfile} profile
 * @param {{
 *   path?: string,
 *   conversation_id?: string|null,
 *   requestedMode?: string|null,
 *   requestedRouteKey?: string|null,
 *   live?: boolean,
 * }} [meta]
 */
export function logRuntimeProfile(profile, meta = {}) {
  const tools = Array.isArray(profile?.tool_allowlist) ? profile.tool_allowlist : [];
  const resolvedMode = profile?.mode != null ? String(profile.mode).trim() : '';
  const requestedMode =
    meta.requestedMode != null && String(meta.requestedMode).trim() !== ''
      ? String(meta.requestedMode).trim()
      : null;
  const resolvedRouteKey =
    profile?.refined_route_key != null && String(profile.refined_route_key).trim() !== ''
      ? String(profile.refined_route_key).trim()
      : null;
  const requestedRouteKey =
    meta.requestedRouteKey != null && String(meta.requestedRouteKey).trim() !== ''
      ? String(meta.requestedRouteKey).trim()
      : null;
  console.log(
    '[runtime-profile]',
    JSON.stringify({
      live: meta.live !== false,
      path: meta.path || 'agentChatSpine',
      conversation_id: meta.conversation_id ?? null,
      mode: resolvedMode || null,
      requestedMode,
      modeMismatch:
        requestedMode != null && resolvedMode !== '' && requestedMode !== resolvedMode,
      routeKey: resolvedRouteKey,
      requestedRouteKey,
      routeMismatch:
        requestedRouteKey != null &&
        resolvedRouteKey != null &&
        requestedRouteKey !== resolvedRouteKey,
      profile_id: profile?.profile_id ?? null,
      profile_hash: profile?.profile_hash ?? null,
      model_key: profile?.model_key ?? null,
      selected_provider: profile?.selected_provider ?? null,
      routing_arm_id: profile?.routing_arm_id ?? null,
      tool_allowlist_count: tools.length,
      tool_names_sample: tools.slice(0, 8),
      max_tools: profile?.max_tools ?? null,
      write_policy: summarizeWritePolicyForLog(profile?.write_policy),
      color: profile?.color ?? null,
      tool_profile: profile?.tool_profile ?? null,
      tool_capable_required:
        typeof profile?.tool_capable_required === 'boolean' ? profile.tool_capable_required : null,
      missing_required_capabilities: profile?.missing_required_capabilities || [],
      allowed_domains: profile?.allowed_domains || [],
      dropped_route_lanes: profile?.source?.dropped_route_lanes || [],
      source: profile?.source ?? null,
    }),
  );
}
