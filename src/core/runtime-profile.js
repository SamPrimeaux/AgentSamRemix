/**
 * Compile D1 registry fragments → flat RuntimeProfile.
 * Sole public compiler: resolveRuntimeProfile. compile_lane is metadata only
 * (live | session_context | shadow label) — not a second menu or dual hot-path compile.
 *
 * Module map (facade — stable import surface):
 *   runtime-profile.js (this file)
 *     → runtime-profile-compile.js     D1 tool/menu compile + mode controller
 *     → runtime-profile-prompt-route.js  agentsam_prompt_routes resolution
 *     → runtime-profile-model.js       Thompson / resolveModelForTask binding
 *                                      (skipped when skip_model_resolve — chat spine)
 *     → runtime-profile-log.js         one-line profile proof logger
 */
import { normalizeAgentRuntimeMode } from '../../backend/agentsam/runtime/mode.js';
import { compileModeProfile } from './runtime-profile-compile.js';
import { resolveProfileModel } from './runtime-profile-model.js';

/** Strip quickstart/on-demand suffixes before casual-intent checks. */
export function stripCasualIntentMessage(message) {
  const raw = String(message || '').trim();
  if (!raw) return '';
  const cut = raw.split(/\r?\n\r?\n--- On-demand context/i)[0]?.trim();
  return cut || raw;
}

export function isSimpleAskMessage(_message) {
  return false;
}

/**
 * @deprecated Ask tools come from D1 `ask` profile — not message heuristics.
 * @param {string} _message
 */
export function askNeedsReadEvidenceTools(_message) {
  return true;
}

/**
 * @param {import('./runtime-profile.types.js').RuntimeProfile} profile
 */
export async function hashRuntimeProfile(profile) {
  const stable = JSON.stringify({
    mode: profile.mode,
    mode_controller: profile.mode_controller,
    profile_id: profile.profile_id,
    tool_policy: profile.tool_policy,
    write_policy: profile.write_policy,
    routing_task_type: profile.routing_task_type,
    max_tools: profile.max_tools,
    context_policy: profile.context_policy,
    parallel_policy: profile.parallel_policy,
    debug_policy: profile.debug_policy ?? null,
  });
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/**
 * @param {import('./runtime-profile.types.js').RuntimeProfile} profile
 * @param {Record<string, unknown>|null|undefined} userPolicy
 */
function applyUserPolicyToProfile(profile, userPolicy) {
  if (!userPolicy) return profile;
  const canPty = Number(userPolicy.can_run_pty) === 1;
  if (!canPty) {
    // Gate via write_policy only — no hardcoded terminal tool-name denylist in JS.
    profile.write_policy.can_terminal = false;
  }

  // Multitask orchestration — flags come from agentsam_user_policy.
  if (profile.mode === 'multitask' && profile.parallel_policy) {
    const allowSpawn = Number(userPolicy.allow_subagent_spawn ?? 0) === 1;
    const allowExec = Number(userPolicy.allow_fanout_execution ?? 0) === 1;
    profile.parallel_policy.enabled = allowSpawn;
    profile.parallel_policy.execution_enabled = allowSpawn && allowExec;
    if (userPolicy.max_spawn_depth != null && String(userPolicy.max_spawn_depth).trim() !== '') {
      profile.parallel_policy.max_depth = Math.max(
        1,
        Math.floor(Number(userPolicy.max_spawn_depth) || 1),
      );
    }
    if (userPolicy.max_subagents != null && String(userPolicy.max_subagents).trim() !== '') {
      profile.parallel_policy.max_subagents = Math.max(
        0,
        Math.floor(Number(userPolicy.max_subagents) || 0),
      );
    }
    if (userPolicy.merge_strategy != null && String(userPolicy.merge_strategy).trim() !== '') {
      profile.parallel_policy.merge_strategy = String(userPolicy.merge_strategy).trim();
    }
    if (Array.isArray(userPolicy.allowed_subagent_types)) {
      profile.parallel_policy.allowed_subagent_types = userPolicy.allowed_subagent_types
        .map((x) => String(x).trim())
        .filter(Boolean);
    }
  }
  return profile;
}

/**
 * @param {import('./runtime-profile.types.js').RuntimeProfile} profile
 * @param {import('./runtime-profile.types.js').RuntimeProfileOverrides} [overrides]
 */
function applyOverridesToProfile(profile, overrides) {
  if (!overrides) return profile;
  if (overrides.model_key != null && String(overrides.model_key).trim() !== '') {
    profile.model_key = String(overrides.model_key).trim();
  }
  // Multitask lanes pass subagent_slug — must pin, not ignore (was silent code-editor drift).
  const slug =
    overrides.subagent_slug != null
      ? String(overrides.subagent_slug).trim()
      : overrides.agent_slug != null
        ? String(overrides.agent_slug).trim()
        : '';
  if (slug) {
    profile.subagent_slug = slug;
    profile.agent_slug = slug;
  }
  return profile;
}

/**
 * @param {any} env
 * @param {import('./runtime-profile.types.js').ResolveRuntimeProfileInput} input
 * @returns {Promise<import('./runtime-profile.types.js').RuntimeProfile>}
 */
export async function resolveRuntimeProfile(env, input) {
  const mode = normalizeAgentRuntimeMode(input.mode);
  const composerMode = mode;
  const session = input.session || {};
  const overrides = input.overrides || {};
  const message = String(input.message || '').trim();
  const precomputed = input.turnDecision;

  let mayUsePrivilegedTerminal = false;
  let hasPlatformPolicyGrant = false;
  const uid = session.userId != null ? String(session.userId).trim() : '';
  const wid = session.workspaceId != null ? String(session.workspaceId).trim() : '';
  const policyHash =
    session.actorPolicyHash != null
      ? String(session.actorPolicyHash).trim()
      : session.roots?.session_grants_policy_hash != null
        ? String(session.roots.session_grants_policy_hash).trim()
        : session.roots?.actor_policy_hash != null
          ? String(session.roots.actor_policy_hash).trim()
          : '';
  if (session.sessionGrants && typeof session.sessionGrants === 'object') {
    mayUsePrivilegedTerminal = session.sessionGrants.mayUsePrivilegedTerminal === true;
    hasPlatformPolicyGrant = session.sessionGrants.hasPlatformPolicyGrant === true;
  } else {
    const { readSessionGrantsPin } = await import('./session-envelope.js');
    const pinned = readSessionGrantsPin(session.roots, policyHash);
    if (pinned) {
      mayUsePrivilegedTerminal = pinned.mayUsePrivilegedTerminal;
      hasPlatformPolicyGrant = pinned.hasPlatformPolicyGrant;
    } else if (uid && wid && env?.DB) {
      const { userMayUsePrivilegedTerminal, userHasPolicyGrant } = await import(
        '../../backend/identity/workspace/grants.js'
      );
      const authRow =
        session.authUser && typeof session.authUser === 'object' ? session.authUser : { id: uid };
      [mayUsePrivilegedTerminal, hasPlatformPolicyGrant] = await Promise.all([
        userMayUsePrivilegedTerminal(env, authRow, wid),
        userHasPolicyGrant(env, uid, wid),
      ]);
    }
  }

  if (precomputed?.chatResult || precomputed?.decisionId) {
    console.info(
      '[runtime-profile] turn_decision',
      JSON.stringify({
        decisionId: precomputed.decisionId ?? null,
        imageFastPath: precomputed.imageFastPath === true,
        matchedBy: precomputed.matchedBy ?? null,
        taskSpecKey: precomputed.taskSpec
          ? `${precomputed.taskSpec.domain}.${precomputed.taskSpec.operation}`
          : null,
        toolProfile: precomputed.taskSpec?.toolProfile ?? null,
      }),
    );
  }

  // Mode owns menu binding + compile. No classifiedTaskType / work-intent invent.
  // (D1 agentsam_tool_profile_bindings.task_type column stores mode keys: agent|ask|…)
  let profile = await compileModeProfile(env, {
    mode: composerMode,
    message,
    tenantId: session.tenantId,
    workspaceId: session.workspaceId,
    userId: session.userId,
    taskType: composerMode,
    taskSpec: precomputed?.taskSpec || null,
    routeKeyPin: overrides.route_key,
    compile_lane: input.compile_lane || 'shadow',
    mcpOAuthParity: input.mcpOAuthParity,
    overrides,
    mayUsePrivilegedTerminal,
    hasPlatformPolicyGrant,
  });

  if (session.userId && session.workspaceId) {
    const { loadAgentSamUserPolicy } = await import('../../backend/identity/index.js');
    const userPolicy = await loadAgentSamUserPolicy(env, session.userId, session.workspaceId);
    profile = applyUserPolicyToProfile(profile, userPolicy);
  }

  profile = applyOverridesToProfile(profile, overrides);
  // Chat spine (loadOrBootstrapSessionContext) skips here: it always rebinds
  // model_key via resolveModelForTask after bootstrap. Child/spawn/plan-intake
  // still need this bind — they have no second resolver.
  if (input.skip_model_resolve !== true) {
    profile = await resolveProfileModel(env, profile, {
      workspaceId: session.workspaceId,
      tenantId: session.tenantId,
      requestedModel: overrides.model_key,
      requireTools: profile.tool_allowlist.length > 0,
      requireVision: input.requireVision === true,
    });
  }
  profile.tool_capable_required = profile.tool_allowlist.length > 0;
  profile.profile_hash = await hashRuntimeProfile(profile);
  return profile;
}

/**
 * Map compiled tool rows → OpenAI/Anthropic manifest shape.
 * @param {Array<Record<string, unknown>>} rows
 */
export function toolsManifestFromCompiledRows(rows) {
  return (rows || []).map((t) => {
    const raw =
      t.input_schema && typeof t.input_schema === 'object' ? t.input_schema : {};
    const name = String(t.name || t.tool_name || '').trim();
    return {
      name,
      description: String(t.description || name),
      input_schema: Object.assign({ type: 'object', properties: {} }, raw, { type: 'object' }),
    };
  }).filter((t) => t.name);
}

export { resolveModeController } from './runtime-profile-compile.js';
export {
  agentLikeTooling,
  resolveComposerRoutingTaskType,
} from './runtime-profile-prompt-route.js';
export { resolveProfileModel } from './runtime-profile-model.js';
export { logRuntimeProfile } from './runtime-profile-log.js';
