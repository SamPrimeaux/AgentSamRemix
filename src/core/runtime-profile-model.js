/**
 * Model resolution for compiled runtime profiles.
 * Mode profile only — route_key is prompt/tools, not the bandit namespace.
 */

/**
 * Bind model + routing arm via resolveModelForTask (Thompson when auto).
 * @param {any} env
 * @param {import('./runtime-profile.types.js').RuntimeProfile} profile
 * @param {{ workspaceId?: string|null, tenantId?: string|null, requestedModel?: string|null, requireTools?: boolean, requireVision?: boolean }} opts
 */
export async function resolveProfileModel(env, profile, opts) {
  if (!env?.DB || !opts.workspaceId) return profile;
  const ws = String(opts.workspaceId).trim();
  const raw = opts.requestedModel != null ? String(opts.requestedModel).trim() : '';
  const isAuto = !raw || raw.toLowerCase() === 'auto';
  const requireVision = opts.requireVision === true;
  const toolCapableRequired = profile.tool_capable_required || profile.tool_allowlist.length > 0;
  const { resolveModelForTask } = await import('./resolveModel.js');

  /** @param {Record<string, unknown>} extra */
  const resolveOpts = (extra = {}) => ({
    mode: profile.mode,
    prefer_mode_profile: true,
    workspace_id: ws,
    tenant_id: opts.tenantId != null ? String(opts.tenantId).trim() : undefined,
    require_tools: toolCapableRequired,
    require_vision: requireVision,
    ...extra,
  });

  /** Bind catalog provider + arm — never leave selected_provider stale/null on pins. */
  const applyResolved = (resolved) => {
    profile.model_key = resolved.model_key;
    profile.routing_arm_id =
      resolved.routing_arm_id != null ? String(resolved.routing_arm_id) : null;
    profile.selected_provider =
      resolved.provider != null ? String(resolved.provider) : null;
    profile.tool_capable_required = toolCapableRequired;
  };

  if (!isAuto && !requireVision) {
    try {
      applyResolved(await resolveModelForTask(env, resolveOpts({ requested_model_key: raw })));
    } catch (e) {
      console.warn('[runtime-profile] pinned model resolve failed', e?.message ?? e);
      profile.model_key = raw;
      profile.selected_provider = null;
      profile.tool_capable_required = toolCapableRequired;
    }
    return profile;
  }

  if (!isAuto && requireVision) {
    try {
      applyResolved(await resolveModelForTask(env, resolveOpts({ requested_model_key: raw })));
      return profile;
    } catch (e) {
      console.warn('[runtime-profile] pinned model lacks vision, re-routing', e?.message ?? e);
    }
  }

  applyResolved(
    await resolveModelForTask(env, resolveOpts({ requested_model_key: isAuto ? null : raw })),
  );
  return profile;
}
