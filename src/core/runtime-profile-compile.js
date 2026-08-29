/**
 * D1 registry compile path for runtime profiles.
 */
import { normalizeAgentRuntimeMode, AGENT_MODE_CONTRACT } from '../../backend/agentsam/runtime/mode.js';
import { RUNTIME_PROFILE_VERSION } from './runtime-profile.types.js';
import { sealWritePolicyForMode } from '../../shared/agent-runtime/mode-write-gate.js';
import {
  compileD1ToolProfileRows,
  loadToolProfileRow,
  parseWritePolicyJson,
  parseRuntimePolicyJson,
  PINNED_PROFILE_KEYS,
  resolveD1ToolProfileKey,
  resolveUseOAuthParity,
} from './d1-tool-profile.js';
import { effectiveAgentChatToolCap } from './agentsam-route-tool-resolver.js';
import {
  contextPolicyFromPromptRoute,
  resolvePromptRouteForCompile,
} from './runtime-profile-prompt-route.js';

/**
 * @param {string} mode
 * @param {string} message
 * @param {number} maxTools
 * @param {string|null} refinedRouteKey
 */
function shouldCompileToolsForTurn(mode, _message, maxTools, _refinedRouteKey) {
  if (maxTools <= 0) return false;
  if (mode === 'agent' || mode === 'debug' || mode === 'multitask' || mode === 'plan' || mode === 'ask') return true;
  return false;
}

/**
 * @param {string} mode
 */
export function resolveModeController(mode) {
  switch (normalizeAgentRuntimeMode(mode)) {
    case 'ask':
      return 'ask_controller';
    case 'plan':
      return 'plan_controller';
    case 'agent':
      return 'agent_controller';
    case 'debug':
      return 'debug_controller';
    case 'multitask':
      return 'multitask_controller';
    default:
      return 'ask_controller';
  }
}

/**
 * When a surface route (e.g. browser) scores zero tools, re-select from mode defaults + intent caps — no hardcoded tool names.
 * @param {any} env
 * @param {{ message: string, mode: string, taskType: string, tenantId?: string|null, workspaceId: string, userId: string, maxTools: number }} p
 */
async function compileCatalogToolsForModeFallback(env, p) {
  const useOAuthParity = resolveUseOAuthParity(p);
  if (useOAuthParity) {
    const { selectOAuthMcpParityToolsForAgentChat } = await import('./in-app-mcp-oauth-parity.js');
    const det = await selectOAuthMcpParityToolsForAgentChat(
      env.DB,
      {
        userId: p.userId,
        tenantId: p.tenantId,
        workspaceId: p.workspaceId,
        mayUsePrivilegedTerminal: p.mayUsePrivilegedTerminal === true,
      },
      {
        outputLimit: Math.max(0, Number(p.maxTools) || 0),
        modeSlug: p.mode,
        mayUsePrivilegedTerminal: p.mayUsePrivilegedTerminal === true,
        hasPlatformPolicyGrant: p.hasPlatformPolicyGrant === true,
      },
    );
    return det.rows || [];
  }
  const { resolveAgentChatRouteToolRequirements } = await import('./agentsam-route-tool-resolver.js');
  const { selectAgentsamToolsForAgentChat } = await import('./agentsam-tools-catalog.js');
  const mode = String(p.mode || 'agent').toLowerCase();
  // Mode owns the route — D1 route_requirements + tool profile only (no Ask JS augment).
  const fallbackRouteKey = mode;
  const req = await resolveAgentChatRouteToolRequirements(env, {
    routeKey: fallbackRouteKey,
    taskType: p.taskType,
    modeSlug: mode,
  });
  const det = await selectAgentsamToolsForAgentChat(
    env.DB,
    { userId: p.userId, tenantId: p.tenantId, workspaceId: p.workspaceId },
    {
      routeToolRequirements: req,
      message: p.message,
      taskType: p.taskType,
      modeSlug: mode,
      catalogLimit: Math.min(96, Math.max(8, p.maxTools * 4)),
      outputLimit: Math.max(1, p.maxTools),
    },
  );
  return det.rows || [];
}

/**
 * @param {any} env
 * @param {{
 *   mode: string,
 *   message: string,
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   userId?: string|null,
 *   taskType?: string|null,
 *   routeKeyPin?: string|null,
 *   compile_lane?: 'shadow'|'live',
 *   overrides?: Record<string, unknown>|null,
 *   taskSpec?: unknown,
 * }} input
 * @returns {Promise<import('./runtime-profile.types.js').RuntimeProfile>}
 */
/**
 * Internal D1 compiler. Public entry is resolveRuntimeProfile only —
 * do not import this from outside runtime-profile.js.
 * @param {any} env
 * @param {object} input
 */
export async function compileModeProfile(env, input) {
  const mode = normalizeAgentRuntimeMode(input.mode);
  const message = String(input.message || '');
  let taskType = String(input.taskType || mode).toLowerCase();
  const tenantId = input.tenantId != null ? String(input.tenantId).trim() : null;
  const workspaceId = input.workspaceId != null ? String(input.workspaceId).trim() : null;
  const userId = input.userId != null ? String(input.userId).trim() : null;
  const compileLane = input.compile_lane === 'live' ? 'live' : 'shadow';
  const useOAuthParity = resolveUseOAuthParity(input);
  const mayUsePrivilegedTerminal = input.mayUsePrivilegedTerminal === true;
  const hasPlatformPolicyGrant = input.hasPlatformPolicyGrant === true;
  /** @type {Record<string, unknown>} */
  const overrides =
    input.overrides && typeof input.overrides === 'object' ? input.overrides : {};

  const { row: promptRouteRow, refinedRouteKey } = await resolvePromptRouteForCompile(env, {
    tenantId,
    mode,
    taskType,
    message,
    routeKeyPin: input.routeKeyPin,
  });

  const routeKey =
    refinedRouteKey ||
    (input.routeKeyPin ? String(input.routeKeyPin).trim() : null) ||
    (promptRouteRow?.route_key != null ? String(promptRouteRow.route_key).trim() : null) ||
    mode;

  // Do not invent cms_edit task_type from route_key — agents are not CMS editors.
  // CMS studio keeps its own route/tools; chat agents use real classifier/tool-shape intent.

  const routeToolRequirements = env?.DB
    ? await (
        await import('./agentsam-route-tool-resolver.js')
      ).resolveAgentChatRouteToolRequirements(env, {
        routeKey,
        taskType,
        modeSlug: mode,
      })
    : null;

  // Route requirements from D1 only — no Ask/message JS augment of tool policy.
  const effectiveRouteReq = routeToolRequirements;

  // Profile = D1 bindings (or taskSpec / cms surface pin / chosen subagent tool_profile_key).
  // Ask/Agent/Plan/Debug/Multitask: same path. Write gates = write_policy_json + sealWritePolicyForMode.
  // Subagent pin must win over mode presets.
  const toolProfilePin =
    overrides.tool_profile_key != null && String(overrides.tool_profile_key).trim()
      ? String(overrides.tool_profile_key).trim()
      : null;
  const profileResolve = await resolveD1ToolProfileKey(env, {
    taskSpec: input.taskSpec,
    taskType,
    routeKey,
    routeKeyPin: input.routeKeyPin,
    mode,
    toolProfilePin,
  });
  const activeProfileKey = profileResolve.profileKey;
  const activeProfileRow =
    env?.DB && activeProfileKey
      ? await loadToolProfileRow(env, activeProfileKey)
      : null;
  /** @type {Record<string, unknown>} */
  let d1WritePolicy = {};

  // Boring law: agentsam_tool_profiles.max_tools is the ceiling.
  // route_requirements may only tighten. No JS 20/12/256 invent.
  const profileMax =
    activeProfileRow?.max_tools != null && String(activeProfileRow.max_tools).trim() !== ''
      ? Number(activeProfileRow.max_tools)
      : null;
  if (activeProfileKey && (profileMax == null || !Number.isFinite(profileMax))) {
    console.warn(
      '[runtime-profile] profile_max_tools_missing',
      JSON.stringify({ profile_key: activeProfileKey, task_type: taskType }),
    );
  }
  const maxTools = effectiveAgentChatToolCap({
    profileMax,
    routeReqMax: effectiveRouteReq?.max_tools ?? routeToolRequirements?.max_tools,
  });

  /** @type {string[]} */
  let toolAllowlist = [];
  /** @type {Array<Record<string, unknown>>} */
  let compiledToolRows = [];
  /** @type {string[]} */
  let missingRequiredCapabilities = [];
  /** @type {string[]} */
  let allowedDomains = [];
  if (
    env?.DB &&
    workspaceId &&
    userId &&
    shouldCompileToolsForTurn(mode, message, maxTools, refinedRouteKey) &&
    maxTools > 0
  ) {
    const { selectAgentsamToolsForAgentChat } = await import('./agentsam-tools-catalog.js');
    let scoredRows = [];
    // Cursor-shaped: oauth_visible catalog is the menu. No JS exempt allowlists.
    // D1 profile pins are not exclusive — they must not starve GitHub/CF tools.
    if (useOAuthParity) {
      const { selectOAuthMcpParityToolsForAgentChat } = await import('./in-app-mcp-oauth-parity.js');
      const det = await selectOAuthMcpParityToolsForAgentChat(
        env.DB,
        { userId, tenantId, workspaceId, mayUsePrivilegedTerminal, hasPlatformPolicyGrant },
        {
          outputLimit: maxTools,
          modeSlug: mode,
          mayUsePrivilegedTerminal,
          hasPlatformPolicyGrant,
        },
      );
      scoredRows = det.rows || [];
      // Optional: load write_policy from profile row without replacing the menu.
      if (activeProfileRow) {
        const wp = parseWritePolicyJson(activeProfileRow.write_policy_json);
        if (wp && typeof wp === 'object') d1WritePolicy = wp;
      }
      console.info(
        '[runtime-profile] oauth_parity_catalog',
        JSON.stringify({
          profile_key: activeProfileKey,
          selected: scoredRows.length,
          max_tools: maxTools,
          tools: scoredRows.map((r) => r.name || r.tool_key).filter(Boolean).slice(0, 32),
        }),
      );
    } else if (activeProfileKey) {
      const det = await compileD1ToolProfileRows(
        env,
        { userId, tenantId, workspaceId, mayUsePrivilegedTerminal, hasPlatformPolicyGrant },
        {
          profileKey: activeProfileKey,
          maxTools,
          taskType,
          modeSlug: mode,
          message,
          routeToolRequirements: effectiveRouteReq || routeToolRequirements,
        },
      );
      if (det.write_policy && typeof det.write_policy === 'object') {
        d1WritePolicy = det.write_policy;
      }
      scoredRows = det.rows || [];
      // Fail loud on empty D1 profile — do not pad from catalog / JS pins.
      if (!scoredRows.length && det.source === 'd1_profile_empty') {
        console.warn(
          '[runtime-profile] tool_menu_empty_no_fallback',
          JSON.stringify({ profile_key: activeProfileKey, task_type: taskType, mode }),
        );
      }
      if (det.missingPinned?.length) {
        console.warn('[runtime-profile] d1_tool_profile_missing_pinned', {
          profile_key: activeProfileKey,
          missing: det.missingPinned,
          pinned_count: det.pinned_count,
          source: det.source,
          binding_source: profileResolve.source,
        });
      }
      console.info(
        '[runtime-profile] d1_tool_profile',
        JSON.stringify({
          profile_key: activeProfileKey,
          source: det.source,
          binding_source: profileResolve.source,
          d1_row_id: det.d1_row_id,
          task_type: taskType,
          route_key: routeKey,
          pinned_count: det.pinned_count,
          selected: scoredRows.length,
          max_tools: maxTools,
          tools: scoredRows.map((r) => r.name || r.tool_key).filter(Boolean).slice(0, 24),
        }),
      );
    } else {
      const { selectAgentsamToolsForAgentChat } = await import('./agentsam-tools-catalog.js');
      const det = await selectAgentsamToolsForAgentChat(env.DB, { userId, tenantId, workspaceId }, {
        allowlistKeys: null,
        routeToolRequirements: effectiveRouteReq || {
          route_key: routeKey,
          task_type: taskType,
          allowed_lanes: [],
          allowed_domains: [],
          required_capabilities: [],
          optional_capabilities: [],
          blocked_capabilities: [],
          max_tools: maxTools,
          approval_policy: null,
          source: 'default',
        },
        message,
        taskType,
        modeSlug: mode,
        catalogLimit: Math.min(256, maxTools * 4),
        outputLimit: maxTools,
      });
      scoredRows = det.rows || [];
      missingRequiredCapabilities = det.missingRequiredCapabilities || [];
      allowedDomains = det.allowedDomains || [];
    }
    // No JS Ask/readonly pin lists — D1 profile rows own the compiled menu.
    compiledToolRows = scoredRows;
    toolAllowlist = compiledToolRows.map((r) => String(r.name || r.tool_key || r.tool_name || '').trim()).filter(Boolean);
  }

  const modesWithCatalogFallback =
    mode === 'multitask' || mode === 'agent' || mode === 'debug' || mode === 'plan';
  const blockOAuthEmptyFallback =
    activeProfileKey != null && PINNED_PROFILE_KEYS.has(activeProfileKey);
  if (
    modesWithCatalogFallback &&
    toolAllowlist.length === 0 &&
    !blockOAuthEmptyFallback &&
    env?.DB &&
    workspaceId &&
    userId
  ) {
    const fallbackRows = await compileCatalogToolsForModeFallback(env, {
      message,
      mode,
      taskType,
      tenantId,
      userId,
      workspaceId,
      maxTools,
      mcpOAuthParity: false,
      mayUsePrivilegedTerminal,
      hasPlatformPolicyGrant,
    });
    if (fallbackRows.length) {
      compiledToolRows = fallbackRows;
      toolAllowlist = compiledToolRows
        .map((r) => String(r.name || r.tool_key || r.tool_name || '').trim())
        .filter(Boolean);
    }
  } else if (blockOAuthEmptyFallback && toolAllowlist.length === 0) {
    console.error(
      '[runtime-profile] pinned_profile_empty_no_oauth_fallback',
      JSON.stringify({ profile_key: activeProfileKey, task_type: taskType, route_key: routeKey }),
    );
  }

  // Progressive tool discovery retired — menus stay D1 composer_* / agentsam_tools as compiled.
  /** @type {string[]|null} */
  const discoveryCeilingKeys = null;
  const progressiveToolDiscovery = false;

  const modeContract = AGENT_MODE_CONTRACT[mode] || AGENT_MODE_CONTRACT.agent;

  // Write policy SSOT: agentsam_tool_profiles.write_policy_json (via d1WritePolicy).
  // Ask/Plan sealed deny; Agent/Debug/Multitask fail closed when D1 policy grants nothing.
  const writePolicy = sealWritePolicyForMode(mode, d1WritePolicy);
  const modeController = resolveModeController(mode);

  const profileId = `mode_${mode}@${routeKey || 'default'}`;
  const systemPromptKey =
    promptRouteRow?.system_prompt_key != null && String(promptRouteRow.system_prompt_key).trim() !== ''
      ? String(promptRouteRow.system_prompt_key).trim()
      : promptRouteRow?.route_key != null
        ? String(promptRouteRow.route_key)
        : mode;

  // Ceilings + debug_policy SSOT: agentsam_tool_profiles.runtime_policy_json (fail closed).
  const runtimePolicy = parseRuntimePolicyJson(activeProfileRow?.runtime_policy_json);
  if (
    activeProfileKey &&
    runtimePolicy.max_tool_calls <= 0 &&
    runtimePolicy.max_runtime_ms <= 0
  ) {
    console.warn(
      '[runtime-profile] runtime_policy_missing_fail_closed',
      JSON.stringify({ profile_key: activeProfileKey, mode }),
    );
  }

  /** @type {import('./runtime-profile.types.js').RuntimeProfile} */
  const profile = {
    mode,
    mode_controller: modeController,
    profile_id: profileId,
    profile_hash: '',
    profile_version: RUNTIME_PROFILE_VERSION,
    system_prompt_key: systemPromptKey,
    system_prompt_inline:
      promptRouteRow?.system_prompt_fragment != null
        ? String(promptRouteRow.system_prompt_fragment)
        : null,
    prompt_layers: promptRouteRow?.route_key ? [String(promptRouteRow.route_key)] : [mode],
    tool_allowlist: toolAllowlist,
    tool_denylist: [],
    tool_require_approval: [],
    // Menu = D1 mode profile allowlist (progressive discovery retired — never empty for "option a").
    tool_policy: {
      allowlist: toolAllowlist,
      denylist: [],
      require_approval: [],
      max_tool_calls: runtimePolicy.max_tool_calls,
      max_runtime_ms: runtimePolicy.max_runtime_ms,
    },
    max_tools: maxTools,
    max_tool_calls: runtimePolicy.max_tool_calls,
    max_turns: runtimePolicy.max_turns,
    max_runtime_ms: runtimePolicy.max_runtime_ms,
    write_policy: writePolicy,
    workflow_key:
      promptRouteRow?.workflow_key != null && String(promptRouteRow.workflow_key).trim() !== ''
        ? String(promptRouteRow.workflow_key).trim()
        : null,
    context_policy: contextPolicyFromPromptRoute(promptRouteRow),
    routing_task_type: taskType,
    model_key: null,
    routing_arm_id: null,
    temperature: runtimePolicy.temperature,
    parallel_policy: {
      enabled: false,
      execution_enabled: false,
      max_subagents: 0,
      max_depth: 0,
      allowed_subagent_types: [],
      merge_strategy: null,
    },
    debug_policy:
      mode === 'debug'
        ? runtimePolicy.debug_policy
        : null,
    source: {
      prompt_route_id: promptRouteRow?.id != null ? String(promptRouteRow.id) : null,
      route_requirements_id: routeToolRequirements?.route_key ?? null,
      compiled_at: Math.floor(Date.now() / 1000),
      compile_lane: compileLane,
      task_spec_key: input.taskSpec
        ? `${input.taskSpec.domain}.${input.taskSpec.operation}`
        : null,
      task_spec_tool_profile: input.taskSpec?.toolProfile ?? null,
      d1_tool_profile_key: activeProfileKey,
      d1_tool_profile_binding_source: profileResolve.source,
    },
    refined_route_key: refinedRouteKey,
    color: modeContract.color,
    tool_profile: activeProfileKey || modeContract.tool_profile,
    tool_capable_required:
      toolAllowlist.length > 0 ||
      mode === 'agent' ||
      mode === 'debug' ||
      mode === 'plan' ||
      mode === 'multitask',
    missing_required_capabilities: missingRequiredCapabilities,
    allowed_domains: allowedDomains,
    selected_provider: null,
    _compiled_tool_rows: compiledToolRows,
    _prompt_route_row: promptRouteRow,
    _progressive_tool_discovery: progressiveToolDiscovery,
    /** Raw D1 runtime_policy_json parse — timeout hard caps etc. (not invent in JS). */
    _runtime_policy: runtimePolicy,
    _discovery_ceiling_keys: discoveryCeilingKeys,
  };

  // Hash once in resolveRuntimeProfile after policy/model mutations — not here.
  return profile;
}
