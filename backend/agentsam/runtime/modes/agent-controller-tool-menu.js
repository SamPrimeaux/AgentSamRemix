/**
 * Finalize the already-compiled Agent Sam tool menu for one turn.
 *
 * Starts from runtime-profile `_compiled_tool_rows` (SSOT compiler).
 * Does NOT query agentsam_tools or re-compile profiles.
 *
 * Order: subagent → slash-skill → terminal lane (strip all if no lane) → Codemode adapter.
 * Execute must treat the returned menu as immutable.
 */

import { reportAgentControllerWarning } from './agent-controller-report.js';

/**
 * @param { any } profile
 * @param { any[] } tools
 */
function syncProfileAllowlist(profile, tools) {
  const allow = tools
    .map((t) => String(t?.name || t?.tool_name || '').trim())
    .filter(Boolean);
  if (!allow.length) return allow;
  profile.tool_allowlist = allow;
  if (!profile.tool_policy) profile.tool_policy = {};
  profile.tool_policy.allowlist = allow;
  return allow;
}

/**
 * @param { any } env
 * @param { any } ctx
 * @param {
 *   profile: any,
 *   message: string,
 *   workspaceId: string|null,
 *   userId: string|null,
 *   tenantId: string|null,
 *   sessionId: string|null,
 *   subagentProfileRow: any,
 *   requestedLane: string|null,
 *   createSubagentFlow: { active?: boolean },
 *   progressiveDiscovery: boolean,
 *   useCodemodeGuess: boolean,
 *   codemodeRunContext: Record<string, unknown>,
 *   chatAgentRunId: string|null,
 *   assertNotCancelled: (env: any, runId: string|null) => Promise<void>,
 * } args
 */
export async function finalizeAgentTurnToolMenu(env, ctx, args) {
  const {
    profile,
    message,
    workspaceId,
    userId,
    tenantId,
    sessionId,
    subagentProfileRow,
    requestedLane,
    createSubagentFlow,
    progressiveDiscovery,
    useCodemodeGuess,
    codemodeRunContext,
    chatAgentRunId,
    assertNotCancelled,
    services = {},
  } = args;
  const {
    toolsManifestFromCompiledRows,
    applySubagentToolPolicy,
    resolveSlashSkillInvoke,
    getOrBuildCodemodeRuntime,
    buildHybridCodemodeManifest,
    filterToolsForDockExecLane,
    stripAllTerminalLaneTools,
    CODEMODE_TOOL_NAME,
    normalizeAuthorizedToolsForCodemode,
  } = services;

  let tools = typeof toolsManifestFromCompiledRows === 'function'
    ? toolsManifestFromCompiledRows(profile._compiled_tool_rows || [])
    : [];

  if (subagentProfileRow) {
    if (typeof applySubagentToolPolicy !== 'function') {
      throw new Error('subagent_tool_policy_service_required');
    }
    tools = await applySubagentToolPolicy(env, tools, subagentProfileRow);
    syncProfileAllowlist(profile, tools);
  }

  // Explicit slash only — never route auto-inject.
  let slashSkill = null;
  try {
    if (typeof resolveSlashSkillInvoke !== 'function') {
      throw new Error('slash_skill_service_required');
    }
    slashSkill = await resolveSlashSkillInvoke(env, ctx, {
      message,
      workspaceId,
      userId,
      tenantId,
      conversationId: sessionId,
      baseTools: tools,
    });
    if (slashSkill?.matched && Array.isArray(slashSkill.tools) && slashSkill.tools.length) {
      tools = slashSkill.tools;
      syncProfileAllowlist(profile, tools);
      console.info(
        '[agent-controller] slash_skill',
        JSON.stringify({
          trigger: slashSkill.trigger,
          skill_id: slashSkill.skillId,
          tools: tools.length,
        }),
      );
    } else if (slashSkill?.matched) {
      console.info(
        '[agent-controller] slash_skill',
        JSON.stringify({
          trigger: slashSkill.trigger,
          skill_id: slashSkill.skillId,
          tools: 'profile_menu',
        }),
      );
    }
  } catch (e) {
    reportAgentControllerWarning(env, 'slash_skill_resolve', e, {
      workspaceId,
      tenantId,
      sessionId,
    });
    slashSkill = null;
  }

  // Terminal policy ONCE, before Codemode — no lane ⇒ strip all terminal tools.
  const execLane = requestedLane || null;
  let terminalLaneStatus = null;
  const beforeLane = tools.length;
  if (execLane) {
    if (typeof filterToolsForDockExecLane !== 'function') {
      throw new Error('terminal_lane_service_required');
    }
    tools = filterToolsForDockExecLane(tools, execLane);
    syncProfileAllowlist(profile, tools);
    console.info(
      '[agent-controller] terminal_lane_menu',
      JSON.stringify({
        exec_lane: execLane,
        tools_before: beforeLane,
        tools_after: tools.length,
        terminal_tool: `agentsam_terminal_${execLane}`,
      }),
    );
  } else {
    if (typeof stripAllTerminalLaneTools !== 'function') {
      throw new Error('terminal_lane_service_required');
    }
    tools = stripAllTerminalLaneTools(tools);
    syncProfileAllowlist(profile, tools);
    terminalLaneStatus = {
      phase: 'no_terminal_lane',
      detail:
        'No terminal dock connected (Local / VM / Sandbox) — shell commands unavailable this turn.',
      code: 'exec_lane_required',
    };
    console.info(
      '[agent-controller] terminal_lane_menu',
      JSON.stringify({
        exec_lane: null,
        tools_before: beforeLane,
        tools_after: tools.length,
        stripped_all_terminal: true,
      }),
    );
  }

  let codemodeRuntime = null;
  const useCodemode =
    !progressiveDiscovery &&
    !createSubagentFlow?.active &&
    !slashSkill?.matched &&
    useCodemodeGuess;
  if (useCodemode) {
    await assertNotCancelled(env, chatAgentRunId);
    try {
      if (
        typeof CODEMODE_TOOL_NAME !== 'string' ||
        typeof normalizeAuthorizedToolsForCodemode !== 'function' ||
        typeof getOrBuildCodemodeRuntime !== 'function' ||
        typeof buildHybridCodemodeManifest !== 'function'
      ) {
        throw new Error('codemode_services_required');
      }
      const authorizedTools = normalizeAuthorizedToolsForCodemode(
        tools.filter((t) => {
          const n = String(t?.name || t?.tool_name || '').trim();
          return n && n !== CODEMODE_TOOL_NAME;
        }),
      );
      if (!authorizedTools.length) {
        console.info(
          '[agent-controller] codemode_skip_empty_authorized_menu',
          JSON.stringify({ mode: profile.mode, tools: tools.length }),
        );
      } else {
        // Invariant: Codemode presents the same authorized menu — never a second catalog.
        const codemodeOpts = { tools: authorizedTools };
        codemodeRuntime = await getOrBuildCodemodeRuntime(env, codemodeRunContext, codemodeOpts);
        await assertNotCancelled(env, chatAgentRunId);
        if (!codemodeRuntime.mode || !codemodeRuntime.connectorName) {
          throw new Error(
            `codemode_runtime_telemetry_incomplete mode=${codemodeRuntime.mode} connector=${codemodeRuntime.connectorName}`,
          );
        }
        tools = buildHybridCodemodeManifest(tools, codemodeRuntime, {
          browserDispatchToolsActive: /\b(browser|screenshot|navigate|playwright|cdt_)\b/i.test(
            message,
          ),
          imageCapabilityIntent: false,
          videoCapabilityIntent: false,
        });
        console.info(
          '[agent-controller] codemode_manifest',
          JSON.stringify({
            manifest_tools: tools.length,
            native_plus_codemode: true,
            authorized_tools: authorizedTools.length,
            codemode_tools_in_sandbox: codemodeRuntime.toolCount,
            mode: codemodeRuntime.mode,
            connector: codemodeRuntime.connectorName,
          }),
        );
      }
    } catch (e) {
      if (e?.name === 'AbortError' || e?.code === 'agent_run_cancelled') throw e;
      reportAgentControllerWarning(env, 'codemode_build_failed', e, {
        workspaceId,
        tenantId,
        sessionId,
      });
    }
  } else if (progressiveDiscovery && profile.mode === 'multitask') {
    console.info(
      '[agent-controller] progressive_skip_codemode',
      JSON.stringify({ mode: profile.mode, tools: tools.length }),
    );
  }

  const toolKeys = tools
    .map((t) => String(t?.name || t?.tool_name || '').trim())
    .filter(Boolean);
  const requireTools = tools.length > 0 || profile.tool_capable_required === true;

  return {
    tools,
    toolKeys,
    execLane,
    slashSkill,
    codemodeRuntime,
    requireTools,
    terminalLaneStatus,
  };
}
