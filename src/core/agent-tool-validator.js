import { dispatchByToolCode } from '../../backend/http/agentsam/routes/dispatch-by-tool-code.js';
import {
  tryReadAgentsamToolCache,
  writeAgentsamToolCacheAfterSuccess,
  isSubstantiveToolOutput,
} from './mcp-tool-execution.js';
import { buildToolCacheLookupOpts, tagToolCacheProvenance } from '../../shared/agent-runtime/tool-cache-session.js';
import {
  isToolAllowedByAllowlist,
  isToolAllowedByPolicyRisk,
  isExplicitUserMcpAllowlistPath,
  isSubagentToolName,
  collectAllowlistToolKeysForScope,
} from './agent-policy.js';
import { loadAgentSamUserPolicy, normalizeAutoRunMode } from '../../backend/identity/index.js';
import { loadAgentsamToolRow } from './agentsam-tools-catalog.js';
import {
  resolveCatalogDispatchToolKey,
  loadCatalogToolRowForDispatch,
  allowlistHasTool,
} from './catalog-tool-key-resolve.js';
import { normalizeToolName } from '../../backend/agentsam/tools/ai-dispatch.js';
import { toolLogFieldsFromValidation } from './agent-prompt-builder.js';
import {
  needsApproval,
  createApprovalRequest,
  pollApprovalQueue,
  checkApprovalGate,
  auditToolDecision,
} from './agent-approval-gate.js';
import {
  CODEMODE_TOOL_NAME,
  CODEMODE_TOOLS_ID,
  CODEMODE_TOOL_CATEGORY,
  CODEMODE_HANDLER_KEY,
  CODEMODE_CAPABILITY_KEY,
} from './codemode-constants.js';
import { assertModeWriteGate, sealWritePolicyForMode, isHardReadonlyMode } from '../../shared/agent-runtime/mode-write-gate.js';
import {
  evaluateToolCapabilities,
  loadToolCapabilities,
} from '../../shared/agent-runtime/tool-capability-policy.js';
import { isMissingRequiredArgErrorText, softMissingRequiredArgResult } from '../../shared/agent-runtime/user-visible-agent-error.js';

/** @deprecated Prefer softMissingRequiredArgResult from user-visible-agent-error.js */
export { softMissingRequiredArgResult };

/** Legacy workflow_key for historical rows — chat tools no longer INSERT agentsam_workflow_runs. */
export const CHAT_TOOL_SESSION_LEDGER_KIND = 'chat_tool_session';

export function chatToolSessionSseBase(ledger) {
  const runId = ledger?.runId != null ? String(ledger.runId).trim() : '';
  return {
    run_id: runId,
    agent_run_id: runId,
    spine: 'agent_run',
    ledger_kind: CHAT_TOOL_SESSION_LEDGER_KIND,
    requested_mode: ledger?.requestedMode != null ? String(ledger.requestedMode) : null,
  };
}

/** In-memory tool-session ledger keyed on agentsam_agent_run.id (no agentsam_workflow_runs row). */
export function createChatToolSessionLedger(p) {
  const {
    tenantId,
    workspaceId,
    userId,
    sessionId,
    modelKey,
    stepsTotal,
    chatAgentRunId,
    requestedMode,
  } = p;
  const runId = chatAgentRunId != null ? String(chatAgentRunId).trim() : '';
  if (!runId || !tenantId || !workspaceId) return null;

  const routingArmId =
    p.routingArmId != null
      ? String(p.routingArmId).trim()
      : p.routing_arm_id != null
        ? String(p.routing_arm_id).trim()
        : null;

  const planned = Number(stepsTotal);
  return {
    runId,
    steps: [],
    startedAt: Date.now(),
    // 0 = unknown planned length (chat tool sessions). Forcing 1 made the UI show "N / 1".
    stepsTotal: Number.isFinite(planned) && planned > 0 ? Math.floor(planned) : 0,
    tenantId: String(tenantId).trim(),
    workspaceId: String(workspaceId).trim(),
    modelKey: modelKey != null ? String(modelKey) : null,
    sessionId: sessionId != null ? String(sessionId) : null,
    conversationId: sessionId != null ? String(sessionId) : null,
    chatAgentRunId: runId,
    routingArmId: routingArmId || null,
    requestedMode: requestedMode != null ? String(requestedMode) : 'agent',
  };
}

/** @returns {Promise<null>} execution_step id (unused; tool rows via scheduleAgentsamToolCallLog). */
export async function appendChatToolSessionLedgerStep(env, emit, ledger, stepEntry) {
  if (!ledger?.runId) return null;
  ledger.steps.push(stepEntry);
  emit('workflow_step', {
    ...chatToolSessionSseBase(ledger),
    node_key: stepEntry.tool_name,
    current_node_key: stepEntry.tool_name,
    tool_name: stepEntry.tool_name,
    steps_completed: ledger.steps.length,
    // null when unknown — client shows "N tool calls" instead of "N / 1".
    steps_total: ledger.stepsTotal > 0 ? ledger.stepsTotal : null,
    ok: stepEntry.ok,
    output_preview: String(stepEntry.output_preview || '').slice(0, 4000),
  });
  return null;
}

export function finalizeChatToolSessionLedger(_env, _ctx, emit, ledger, { ok, errorMessage } = {}) {
  if (!ledger?.runId) return;
  const err = ok ? null : String(errorMessage || 'chat_tool_session_failed').slice(0, 4000);
  const base = chatToolSessionSseBase(ledger);
  const completed = ledger.steps.length;
  if (ok) {
    emit('workflow_complete', {
      ...base,
      status: 'completed',
      message: `Executed ${completed} tool call(s).`,
      steps_completed: completed,
      // Honest denominator — never the max-tool budget (that made the UI stuck at 5/12).
      steps_total: Math.max(completed, 1),
    });
  } else {
    emit('workflow_error', {
      ...base,
      status: 'failed',
      message: err || 'failed',
      steps_completed: completed,
      steps_total: Math.max(completed, 1),
    });
  }
}

/**
 * GitHub mutation approval target — never hide owner/repo@branch behind a bare path.
 * @param {Record<string, unknown>} inp
 * @returns {string|null}
 */
export function formatGithubApprovalTargetPreview(inp) {
  const repo = String(inp?.repo || inp?.repository || inp?.repository_full_name || '').trim();
  if (!repo.includes('/')) return null;
  const branch = String(inp?.branch || inp?.ref || inp?.head || '').trim();
  const path = String(inp?.path || inp?.github_path || '').trim();
  const target = branch ? `${repo}@${branch}` : `${repo}@(branch unset)`;
  const lines = [target];
  if (path) lines.push(`path: ${path}`);
  const find = inp?.find != null ? String(inp.find) : inp?.old_str != null ? String(inp.old_str) : '';
  const replace =
    inp?.replace != null ? String(inp.replace) : inp?.new_str != null ? String(inp.new_str) : '';
  if (find) {
    const f = find.length > 160 ? `${find.slice(0, 160)}…` : find;
    const r = replace.length > 160 ? `${replace.slice(0, 160)}…` : replace;
    lines.push(`find: ${f}`);
    lines.push(`replace: ${r}`);
  }
  return lines.join('\n').slice(0, 8000);
}

/**
 * Workspace MCP tool library: global workspace_scope + workspace-specific overrides.
 * Workspace-scoped rows win on duplicate tool_name.
 */
export function formatToolApprovalPreview(toolName, toolInput) {
  const inp = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const name = String(toolName || '').trim().toLowerCase();
  const githubPreview = formatGithubApprovalTargetPreview(inp);
  if (
    githubPreview &&
    (name.includes('github') ||
      inp.repo ||
      inp.repository ||
      inp.github_repo ||
      inp.github_path)
  ) {
    return githubPreview;
  }
  if (name === 'spawn_lane_extension' || name.includes('spawn_lane_extension')) {
    const total = Number(inp.total_cost_usd);
    const cap = Number(inp.cost_cap_usd);
    if (Number.isFinite(total) && Number.isFinite(cap) && cap > 0) {
      const pct = Math.round((total / cap) * 100);
      return (
        `Budget: $${total.toFixed(4)} / $${cap.toFixed(4)} (${pct}%)\n` +
        `Approve to extend the job cost cap and resume remaining lanes.\n` +
        `Deny keeps the current cap — remaining lanes resume until the 100% hard-stop.`
      );
    }
    return 'Extend spawn lane cost cap and resume remaining lanes.';
  }
  // Prefer unified diff / patch payload for in-card diff view (before SQL/command).
  const diffish =
    inp.diff ??
    inp.patch ??
    inp.unified_diff ??
    inp.unifiedDiff ??
    inp.diff_text ??
    inp.diffText;
  if (diffish != null && String(diffish).trim()) return String(diffish).trim().slice(0, 8000);
  const cmd =
    inp.command ??
    inp.cmd ??
    inp.shell_command ??
    inp.shell ??
    inp.query ??
    inp.sql;
  if (cmd != null && String(cmd).trim()) return String(cmd).trim().slice(0, 8000);
  const path = inp.path ?? inp.cwd ?? inp.working_directory;
  if (path != null && String(path).trim()) {
    const base = String(path).trim();
    if (cmd != null && String(cmd).trim()) return `cd ${base} && ${String(cmd).trim()}`.slice(0, 8000);
    return base.slice(0, 8000);
  }
  try {
    return JSON.stringify(inp, null, 2).slice(0, 4000);
  } catch {
    return `${String(toolName || 'tool')}()`;
  }
}

export function toolInputHasApprovalId(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return false;
  const id = toolInput.approval_id ?? toolInput.approvalId ?? null;
  return id != null && String(id).trim() !== '';
}

export function inferRiskLevel(toolName, category = '', rowRiskLevel = '') {
  const r = String(rowRiskLevel || '').toLowerCase();
  if (['low', 'medium', 'high', 'critical'].includes(r)) return r;
  void toolName;
  const c = String(category || '').toLowerCase();
  if (c.includes('terminal') || c.includes('deploy')) return 'high';
  if (c.startsWith('d1') || c.startsWith('r2')) return 'medium';
  return 'low';
}

/**
 * Tool-call validator (hot path)
 *
 * New contract (runtime spine): validateToolCall(env, profile, toolCall, mcpRuntimeContext, userPolicy)
 * - Enforces compiled RuntimeProfile.tool_policy + write_policy (+ debug_policy phase gates)
 * - Honors require_approval tools by returning `requiresConfirmation: true` (not allowed)
 *
 * Compatibility (legacy callers): validateToolCall(env, modeSlug, toolName, ...)
 * - Must not be used by the runtime spine/controllers path.
 *
 * @param {any} env
 * @param {import('../core/runtime-profile.types.js').RuntimeProfile|string} profileOrMode
 * @param {{ name?: string }|string} toolCallOrName
 * @param {Record<string, unknown>} mcpRuntimeContext
 * @param {any} userPolicy
 */
export async function validateToolCall(env, profileOrMode, toolCallOrName, mcpRuntimeContext = {}, userPolicy = null) {
  const ctxRouteKey =
    mcpRuntimeContext.routeKey != null && String(mcpRuntimeContext.routeKey).trim() !== ''
      ? String(mcpRuntimeContext.routeKey).trim()
      : '';
  const routeKeyOut = (rk) =>
    (rk != null && String(rk).trim() !== '' ? String(rk).trim() : null) || ctxRouteKey || null;
  const name =
    typeof toolCallOrName === 'string'
      ? String(toolCallOrName || '').trim()
      : String(toolCallOrName?.name || '').trim();
  if (!name) {
    return {
      allowed: false,
      reason: 'missing tool name',
      riskLevel: 'blocked',
      requiresConfirmation: false,
      mcpToolId: null,
      toolKey: null,
      capabilityKey: null,
      handlerKey: null,
      routeKey: routeKeyOut(null),
      serverKey: null,
      mcpServerId: null,
      agentsamToolsId: null,
    };
  }

  const runtimeProfileEarly =
    typeof profileOrMode === 'object' && profileOrMode
      ? profileOrMode
      : (mcpRuntimeContext.runtimeProfile || mcpRuntimeContext.runtime_profile || null);
  const modeSlugEarly =
    typeof profileOrMode === 'string'
      ? profileOrMode
      : runtimeProfileEarly?.mode != null
        ? String(runtimeProfileEarly.mode)
        : '';

  // Codemode shortcut: Ask/Plan hard-deny before catalog (no name heuristics — mode law only).
  // Attribution must still fill tool_call_log (category / handler / catalog id) — the meta row
  // stays is_active=0 so loadAgentsamToolRow would miss it.
  if (name === CODEMODE_TOOL_NAME && env?.LOADER) {
    const codemodeAttribution = {
      toolKey: CODEMODE_TOOL_NAME,
      toolCategory: CODEMODE_TOOL_CATEGORY,
      capabilityKey: CODEMODE_CAPABILITY_KEY,
      handlerKey: CODEMODE_HANDLER_KEY,
      routeKey: routeKeyOut(null),
      serverKey: null,
      mcpServerId: null,
      agentsamToolsId: CODEMODE_TOOLS_ID,
      mcpToolId: null,
    };
    if (isHardReadonlyMode(modeSlugEarly)) {
      return {
        allowed: false,
        reason: `blocked by ${modeSlugEarly || 'readonly'} write_policy: codemode requires Agent`,
        riskLevel: 'blocked',
        requiresConfirmation: false,
        ...codemodeAttribution,
      };
    }
    return {
      allowed: true,
      reason: 'allowed',
      riskLevel: 'low',
      requiresConfirmation: false,
      ...codemodeAttribution,
    };
  }

  const toolInput =
    typeof toolCallOrName === 'object' && toolCallOrName && typeof toolCallOrName.input === 'object'
      ? toolCallOrName.input
      : null;
  if (name === 'knowledge_search' || name === 'ss_search_knowledge') {
    const query =
      toolInput?.query ??
      toolInput?.q ??
      toolInput?.search_query ??
      toolInput?.search ??
      toolInput?.text ??
      '';
    if (!String(query).trim()) {
      return {
        allowed: false,
        reason: 'knowledge_search_query_missing',
        riskLevel: 'blocked',
        requiresConfirmation: false,
        mcpToolId: null,
        toolKey: name,
        capabilityKey: null,
        handlerKey: null,
        routeKey: routeKeyOut(null),
        serverKey: null,
        mcpServerId: null,
        agentsamToolsId: null,
      };
    }
  }

  const uid = mcpRuntimeContext.userId != null ? String(mcpRuntimeContext.userId).trim() : '';
  const ws =
    mcpRuntimeContext.workspaceId != null ? String(mcpRuntimeContext.workspaceId).trim() : '';
  const policyRow = userPolicy || (await loadAgentSamUserPolicy(env, uid, ws));

  if (isSubagentToolName(name) && Number(policyRow.allow_subagent_spawn ?? 1) !== 1) {
    return {
      allowed: false,
      reason: 'subagent spawn disabled by policy',
      riskLevel: 'blocked',
      requiresConfirmation: false,
      mcpToolId: null,
      toolKey: name,
      capabilityKey: null,
      handlerKey: null,
      routeKey: routeKeyOut(null),
      serverKey: null,
      mcpServerId: null,
      agentsamToolsId: null,
    };
  }

  const runtimeProfile =
    typeof profileOrMode === 'object' && profileOrMode
      ? profileOrMode
      : (mcpRuntimeContext.runtimeProfile || mcpRuntimeContext.runtime_profile || null);
  const modeSlug = typeof profileOrMode === 'string' ? profileOrMode : runtimeProfile?.mode;
  const resolvedToolKey = resolveCatalogDispatchToolKey(name);
  const row = env.DB ? await loadCatalogToolRowForDispatch(env, name) : null;
  if (env.DB && !row) {
    return {
      allowed: false,
      reason: 'agentsam_tools not found',
      riskLevel: 'blocked',
      requiresConfirmation: false,
      mcpToolId: null,
      toolKey: resolvedToolKey || name,
      capabilityKey: null,
      capabilityKeys: [],
      capabilityDecision: {
        schema_version: 1,
        decision: 'deny',
        reason: 'canonical_tool_not_found',
        capabilities: [],
      },
      handlerKey: null,
      routeKey: routeKeyOut(null),
      serverKey: null,
      mcpServerId: null,
      agentsamToolsId: null,
    };
  }
  const capabilities = row ? await loadToolCapabilities(env, row, toolInput) : [];
  const capabilityKeys = capabilities.map((item) => String(item.capability_key)).filter(Boolean);

  // OpenAI PTC: re-check caller_policy at invoke (fail-closed). caller.type=program → programmatic.
  const callerRaw =
    typeof toolCallOrName === 'object' && toolCallOrName
      ? (toolCallOrName.caller ?? toolCallOrName.caller_type ?? null)
      : null;
  if (callerRaw != null) {
    const { assertCallerAllowedAtInvoke } = await import('./openai-caller-policy.js');
    const gate = assertCallerAllowedAtInvoke(row?.caller_policy, callerRaw);
    if (!gate.ok) {
      return {
        allowed: false,
        reason: gate.reason,
        riskLevel: 'blocked',
        requiresConfirmation: false,
        mcpToolId: row?.id ?? null,
        toolKey: row?.tool_key ?? resolvedToolKey ?? name,
        capabilityKey: capabilityKeys[0] ?? null,
        capabilityKeys,
        handlerKey: row?.handler_key ?? null,
        routeKey: routeKeyOut(row?.route_key),
        serverKey: row?.server_key ?? null,
        mcpServerId: row?.mcp_server_id ?? row?.server_id ?? null,
        agentsamToolsId: row?.id ?? null,
        allowed_callers: gate.allowed_callers,
        caller_type: gate.caller_type,
      };
    }
  }

  const writePolicy = sealWritePolicyForMode(
    modeSlug || runtimeProfile?.mode,
    mcpRuntimeContext.writePolicy != null
      ? mcpRuntimeContext.writePolicy
      : mcpRuntimeContext.write_policy != null
        ? mcpRuntimeContext.write_policy
        : runtimeProfile?.write_policy ?? null,
  );

  // Enforce the compiled RuntimeProfile tool policy first (no guessing, no promotions).
  // Alias-aware: d1_query ≡ agentsam_d1_query (catalog redirects + agentsam_ prefix).
  const compiledToolPolicy = runtimeProfile?.tool_policy || null;
  if (compiledToolPolicy?.denylist?.length && allowlistHasTool(name, compiledToolPolicy.denylist)) {
    return {
      allowed: false,
      reason: 'blocked by profile tool_policy denylist',
      riskLevel: 'blocked',
      requiresConfirmation: false,
      mcpToolId: null,
      toolKey: name,
      capabilityKey: null,
      handlerKey: null,
      routeKey: routeKeyOut(null),
      serverKey: null,
      mcpServerId: null,
      agentsamToolsId: null,
    };
  }
  const profileRequiresApproval =
    compiledToolPolicy?.require_approval?.length &&
    allowlistHasTool(name, compiledToolPolicy.require_approval) &&
    !toolInputHasApprovalId(toolInput);
  // Progressive discovery (Agent/Debug/Multitask): menu = schemas on the wire;
  // safety = denylist + write_policy/capability — do not block on baked allowlist.
  // See plans/active/CURSOR-PARITY-TOOL-DISCOVERY-2026-07.md (option a).
  let skipAllowlist = false;
  let discoveredNeedsGrantApproval = false;
  try {
    const { modeSkipsToolPolicyAllowlist } = await import('./progressive-tool-discovery.js');
    skipAllowlist =
      modeSkipsToolPolicyAllowlist(modeSlug) ||
      modeSkipsToolPolicyAllowlist(runtimeProfile?.mode) ||
      runtimeProfile?._progressive_tool_discovery === true;
  } catch {
    skipAllowlist = false;
  }
  if (
    !skipAllowlist &&
    compiledToolPolicy?.allowlist?.length &&
    !allowlistHasTool(name, compiledToolPolicy.allowlist)
  ) {
    const { findMcpAllowlistMatch } = await import('./agent-policy.js');
    const { resolveDiscoveryAllowlistMiss } = await import('./discovery-tool-grant.js');
    const { coerceAllowlistKeySet } = await import('./session-envelope.js');
    const pinnedAllowlist = coerceAllowlistKeySet(mcpRuntimeContext.allowlistKeySet);
    const discoveryGrant = pinnedAllowlist
      ? {
          matched:
            pinnedAllowlist.has(String(name).trim().toLowerCase()) ||
            [...pinnedAllowlist].some((k) => k === String(name).trim().toLowerCase()),
          path: pinnedAllowlist.has(String(name).trim().toLowerCase())
            ? 'allowlist_user_workspace_tool'
            : null,
        }
      : await findMcpAllowlistMatch(
      env?.DB,
      {
        userId: mcpRuntimeContext.userId,
        workspaceId: mcpRuntimeContext.workspaceId,
        tenantId: mcpRuntimeContext.tenantId,
        personUuid: mcpRuntimeContext.personUuid,
      },
      name,
    );
    const miss = resolveDiscoveryAllowlistMiss({
      matched: discoveryGrant.matched === true,
      hydratedNames: mcpRuntimeContext._activeToolNames,
      toolName: name,
    });
    if (miss === 'hard_block') {
      return {
        allowed: false,
        reason: 'not in profile tool_policy allowlist',
        riskLevel: 'blocked',
        requiresConfirmation: false,
        mcpToolId: null,
        toolKey: name,
        capabilityKey: null,
        handlerKey: null,
        routeKey: routeKeyOut(null),
        serverKey: null,
        mcpServerId: null,
        agentsamToolsId: null,
      };
    }
    // Discovered via agentsam_search_tools this turn but not yet granted —
    // fall through to normal flow below, forcing an approval instead of a hard block.
    if (miss === 'needs_grant_approval') {
      discoveredNeedsGrantApproval = true;
    }
  }

  const debugPolicy = runtimeProfile?.debug_policy || null;
  const capabilityDecision = evaluateToolCapabilities({
    toolRow: row,
    capabilities,
    writePolicy,
    productionAllowed: true,
  });
  const isDebugLane =
    debugPolicy &&
    runtimeProfile?.mode === 'debug';
  const debugEarlyPhase = ['hypothesize', 'inspect', 'instrument'].includes(debugPolicy?.phase);
  const hasMutatingCapability = capabilityDecision.mutating_capabilities.length > 0;
  const hasDeployCapability = capabilityDecision.capabilities.includes('cloudflare.deploy');
  if (
    capabilityDecision.decision === 'deny' ||
    (isDebugLane && debugPolicy.evidence_required_before_write && debugEarlyPhase && hasMutatingCapability) ||
    (isDebugLane &&
      debugPolicy.evidence_required_before_deploy &&
      hasDeployCapability &&
      !['verify', 'cleanup'].includes(debugPolicy.phase))
  ) {
    return {
      allowed: false,
      reason:
        capabilityDecision.decision === 'deny'
          ? `blocked by capability policy: ${capabilityDecision.reason}`
          : `debug phase gate: capability blocked in ${debugPolicy.phase}`,
      riskLevel: 'blocked',
      requiresConfirmation: false,
      mcpToolId: row?.id ?? null,
      toolKey: row?.tool_key ?? resolvedToolKey ?? name,
      capabilityKey: capabilityKeys[0] ?? null,
      capabilityKeys,
      capabilityDecision,
      handlerKey: row?.handler_key ?? null,
      routeKey: routeKeyOut(row?.route_key),
      serverKey: row?.server_key ?? null,
      mcpServerId: row?.mcp_server_id ?? row?.server_id ?? null,
      agentsamToolsId: row?.id ?? null,
    };
  }

  const modeWriteGate = assertModeWriteGate({
    mode: modeSlug || runtimeProfile?.mode,
    write_policy: writePolicy,
    toolName: name,
    capabilityDecision,
  });
  if (!modeWriteGate.allowed) {
    return {
      allowed: false,
      reason: modeWriteGate.reason,
      riskLevel: 'blocked',
      requiresConfirmation: false,
      mcpToolId: row?.id ?? null,
      toolKey: row?.tool_key ?? resolvedToolKey ?? name,
      capabilityKey: capabilityKeys[0] ?? null,
      capabilityKeys,
      capabilityDecision,
      handlerKey: row?.handler_key ?? null,
      routeKey: routeKeyOut(row?.route_key),
      serverKey: row?.server_key ?? null,
      mcpServerId: row?.mcp_server_id ?? row?.server_id ?? null,
      agentsamToolsId: row?.id ?? null,
    };
  }

  const allowRes = await isToolAllowedByAllowlist(
    env,
    policyRow,
    {
      userId: mcpRuntimeContext.userId,
      workspaceId: mcpRuntimeContext.workspaceId,
      tenantId: mcpRuntimeContext.tenantId,
      personUuid: mcpRuntimeContext.personUuid,
      mayUsePrivilegedTerminal: !!mcpRuntimeContext.mayUsePrivilegedTerminal,
      hasPlatformPolicyGrant: !!mcpRuntimeContext.hasPlatformPolicyGrant,
      allowlistKeySet:
        mcpRuntimeContext.allowlistKeySet instanceof Set
          ? mcpRuntimeContext.allowlistKeySet
          : undefined,
    },
    name,
    row ? { ...row, enabled: 1 } : null,
    { agentMode: String(modeSlug || '').toLowerCase() === 'agent' },
  );
  if (!allowRes.allowed) {
    const rk = row && typeof row === 'object' ? row : {};
    return {
      allowed: false,
      reason: allowRes.reason || 'tool not in allowlist',
      riskLevel: 'blocked',
      requiresConfirmation: false,
      mcpToolId: row?.id ?? null,
      toolKey: rk.tool_key != null ? String(rk.tool_key) : name,
      capabilityKey: capabilityKeys[0] ?? (rk.capability_key != null ? String(rk.capability_key) : null),
      capabilityKeys,
      capabilityDecision: {
        ...capabilityDecision,
        legacy_decision: 'deny',
        agreement: capabilityDecision.decision === 'deny' ? 'match' : 'mismatch',
        mismatch_reason:
          capabilityDecision.decision === 'allow' ? 'legacy_allowlist_denied' : null,
      },
      handlerKey: rk.handler_key != null ? String(rk.handler_key) : null,
      routeKey: routeKeyOut(rk.route_key),
      serverKey: rk.server_key != null ? String(rk.server_key) : null,
      mcpServerId: rk.mcp_server_id ?? rk.server_id ?? null,
      agentsamToolsId: rk.id ?? null,
    };
  }

  const riskLevel = inferRiskLevel(name, row?.tool_category, row?.risk_level);
  if (!isToolAllowedByPolicyRisk(policyRow, riskLevel)) {
    const rk = row && typeof row === 'object' ? row : {};
    return {
      allowed: false,
      reason: 'blocked by tool_risk_level_max',
      riskLevel: 'blocked',
      requiresConfirmation: false,
      mcpToolId: row?.id ?? null,
      toolKey: rk.tool_key != null ? String(rk.tool_key) : name,
      capabilityKey: capabilityKeys[0] ?? (rk.capability_key != null ? String(rk.capability_key) : null),
      capabilityKeys,
      capabilityDecision: {
        ...capabilityDecision,
        legacy_decision: 'deny',
        agreement: capabilityDecision.decision === 'deny' ? 'match' : 'mismatch',
        mismatch_reason:
          capabilityDecision.decision === 'allow' ? 'legacy_risk_cap_denied' : null,
      },
      handlerKey: rk.handler_key != null ? String(rk.handler_key) : null,
      routeKey: routeKeyOut(rk.route_key),
      serverKey: rk.server_key != null ? String(rk.server_key) : null,
      mcpServerId: rk.mcp_server_id ?? rk.server_id ?? null,
      agentsamToolsId: rk.id ?? null,
    };
  }

  const allowlistMatched = isExplicitUserMcpAllowlistPath(allowRes.path);

  const modeNorm = String(modeSlug || runtimeProfile?.mode || '')
    .trim()
    .toLowerCase();
  const toolNorm = String(name || '')
    .trim()
    .toLowerCase();
  const workspaceFileToolNoApproval =
    (toolNorm === 'fs_write_file' ||
      toolNorm === 'fs_edit_file' ||
      toolNorm === 'write_file') &&
    (runtimeProfile?.write_policy?.can_edit_files === true ||
      modeNorm === 'agent' ||
      modeNorm === 'debug' ||
      modeNorm === 'multitask');

  // Spawn accept = human pre-approval for the child's compiled menu. Do not email a second
  // approval for agentsam_github_create_branch / write / etc. Interactive chat still gates.
  const spawnPreapproved =
    mcpRuntimeContext?.spawn_preapproved === true ||
    mcpRuntimeContext?.spawnPreapproved === true;

  const requiresConfirmation =
    !workspaceFileToolNoApproval &&
    !spawnPreapproved &&
    (profileRequiresApproval ||
      capabilityDecision.requires_approval ||
      discoveredNeedsGrantApproval ||
      (row != null && Number(row.requires_approval || 0) === 1)) &&
    !toolInputHasApprovalId(toolInput) &&
    !(normalizeAutoRunMode(policyRow?.auto_run_mode) === 'allowlist' && allowlistMatched);
  const rk = row && typeof row === 'object' ? row : {};
  return {
    allowed: true,
    reason: requiresConfirmation ? 'requires approval' : 'allowed',
    riskLevel,
    requiresConfirmation,
    allowlistMatched,
    grantOnApproval: discoveredNeedsGrantApproval,
    mcpToolId: null,
    toolKey: rk.tool_key != null ? String(rk.tool_key) : name,
    toolCategory: rk.tool_category != null ? String(rk.tool_category) : null,
    capabilityKey: capabilityKeys[0] ?? (rk.capability_key != null ? String(rk.capability_key) : null),
    capabilityKeys,
    capabilityDecision,
    handlerKey: rk.handler_key != null ? String(rk.handler_key) : null,
    routeKey: routeKeyOut(rk.route_key),
    serverKey: null,
    mcpServerId: null,
    agentsamToolsId: rk.id != null ? String(rk.id) : null,
  };
}

export async function dispatchToolCall(env, toolName, input, context = {}) {
  const t0 = Date.now();
  const canonicalToolRow = env?.DB
    ? await loadCatalogToolRowForDispatch(env, toolName).catch(() => null)
    : null;
  const cacheBinding = buildToolCacheLookupOpts(input, context);
  const cached = await tryReadAgentsamToolCache(env, {
    workspaceId: context.workspaceId,
    tenantId: cacheBinding.tenantId ?? context.tenantId,
    userId: cacheBinding.userId ?? context.userId,
    sessionId: cacheBinding.sessionId ?? context.sessionId,
    sourceVersion: cacheBinding.sourceVersion,
    sourceEtag: cacheBinding.sourceEtag,
    toolName,
    toolInput: input,
  });
  if (cached.hit) {
    const cachedValue = cached.value;
    if (!canonicalToolRow?.result_policy_json) {
      return tagToolCacheProvenance(cachedValue, { cacheHit: true, resultSource: 'tool_cache' });
    }
    const { applyToolResultPolicy } = await import('./tool-result-policy.js');
    const policied = await applyToolResultPolicy({
      env,
      toolRow: canonicalToolRow,
      input,
      result: cachedValue,
      context,
    });
    return tagToolCacheProvenance(policied, { cacheHit: true, resultSource: 'tool_cache' });
  }

  const sess = {
    user_id: context.userId,
    workspace_id: context.workspaceId,
    workspaceId: context.workspaceId,
    tenant_id: context.tenantId,
    session_id: context.sessionId,
    person_uuid: context.personUuid,
  };
  const params = {
    ...(input && typeof input === 'object' ? input : {}),
    session: sess,
    session_id: context.sessionId || input?.session_id || null,
    tenant_id: context.tenantId || input?.tenant_id || null,
    user_id: context.userId || input?.user_id || null,
    workspace_id: context.workspaceId ?? input?.workspace_id ?? null,
    person_uuid: context.personUuid ?? input?.person_uuid ?? null,
    request: context.request || null,
    agent_run_id:
      context.agent_run_id ?? context.agentRunId ?? input?.agent_run_id ?? input?.agentRunId ?? null,
    browser_session_id:
      context.browser_session_id ??
      context.browserSessionId ??
      input?.browser_session_id ??
      input?.browserSessionId ??
      (context.browserContext && typeof context.browserContext === 'object'
        ? context.browserContext.browser_session_id ?? context.browserContext.browserSessionId
        : null) ??
      (context.browser_context && typeof context.browser_context === 'object'
        ? context.browser_context.browser_session_id ?? context.browser_context.browserSessionId
        : null) ??
      null,
    conversation_id:
      context.conversation_id ??
      context.conversationId ??
      context.sessionId ??
      input?.conversation_id ??
      input?.conversationId ??
      null,
  };
  const catalogOut = await dispatchByToolCode(env, resolveCatalogDispatchToolKey(toolName), params, context);
  let out =
    catalogOut?.ok === false
      ? {
          ok: false,
          error: catalogOut.error ?? 'dispatch_failed',
          user_message: catalogOut.user_message ?? catalogOut.body?.user_message ?? null,
          schema_hint: catalogOut.schema_hint ?? catalogOut.body?.schema_hint ?? null,
          recovery: catalogOut.recovery ?? catalogOut.body?.recovery ?? null,
          database_id: catalogOut.database_id ?? catalogOut.body?.database_id ?? null,
          hint: catalogOut.hint ?? catalogOut.body?.hint ?? null,
          body: catalogOut.body ?? null,
        }
      : catalogOut?.result ?? catalogOut;
  if (canonicalToolRow?.result_policy_json && !out?.error) {
    const { applyToolResultPolicy } = await import('./tool-result-policy.js');
    out = await applyToolResultPolicy({
      env,
      toolRow: canonicalToolRow,
      input,
      result: out,
      context,
    });
  }

  /** MCP tools/call has no envelope gate — skip for oauth_visible + allowlist tools (Phase 3.1). */
  let skipOAuthEnvelopeGate = false;
  if (env?.DB && context.workspaceId) {
    try {
      const { isOAuthMcpParityToolAllowed } = await import('./in-app-mcp-oauth-parity.js');
      skipOAuthEnvelopeGate = await isOAuthMcpParityToolAllowed(env, toolName, {
        mayUsePrivilegedTerminal: context.mayUsePrivilegedTerminal === true,
        hasPlatformPolicyGrant: context.hasPlatformPolicyGrant === true,
        userId: context.userId ?? context.user_id ?? null,
        workspaceId: context.workspaceId ?? context.workspace_id ?? null,
        tenantId: context.tenantId ?? context.tenant_id ?? null,
        personUuid: context.personUuid ?? context.person_uuid ?? null,
      });
    } catch (_) {}
  }

  if (
    out &&
    typeof out === 'object' &&
    out.error != null &&
    isMissingRequiredArgErrorText(out.error)
  ) {
    return softMissingRequiredArgResult(toolName, out.error, {
      lane: out.lane != null ? out.lane : undefined,
    });
  }
  if (
    !skipOAuthEnvelopeGate &&
    out &&
    typeof out === 'object' &&
    !isSubstantiveToolOutput(toolName, out)
  ) {
    const envelopeErr =
      typeof out.error === 'string'
        ? out.error
        : 'Tool returned no usable payload (empty or stale envelope). Retry the call.';
    if (isMissingRequiredArgErrorText(envelopeErr)) {
      return softMissingRequiredArgResult(toolName, envelopeErr);
    }
    throw new Error(envelopeErr);
  }
  if (out && typeof out === 'object' && out.budget_exhausted === true) {
    return out;
  }
  if (out && typeof out === 'object' && out.error) {
    if (isMissingRequiredArgErrorText(out.error)) {
      return softMissingRequiredArgResult(toolName, out.error, {
        lane: out.lane != null ? out.lane : undefined,
      });
    }
    const { isCatalogCfD1GuidedSchemaFailure } = await import('./catalog-tool-cf-d1.js');
    if (isCatalogCfD1GuidedSchemaFailure(out)) {
      return {
        ok: false,
        soft_validation_error: true,
        code: 'd1_schema_mismatch',
        error: String(out.error),
        user_message: out.user_message != null ? String(out.user_message) : String(out.error),
        schema_hint: out.schema_hint ?? null,
        recovery: out.recovery ?? null,
        database_id: out.database_id ?? null,
        hint:
          out.hint != null
            ? String(out.hint)
            : 'Use recovery.rows for real column names and rewrite the SQL in the same turn.',
        tool: toolName,
      };
    }
    const { terminalToolFailureMessage } = await import('../../backend/agentsam/terminal/failure-class.js');
    throw new Error(terminalToolFailureMessage(out));
  }
  const fromCache =
    out &&
    typeof out === 'object' &&
    (out.__cacheProvenance?.cacheHit === true ||
      out.cache_hit === 1 ||
      out.cache_hit === true ||
      out.result_source === 'tool_cache' ||
      out.resultSource === 'tool_cache');
  let cacheWrite = null;
  if (!fromCache) {
    cacheWrite = await writeAgentsamToolCacheAfterSuccess(env, {
      workspaceId: context.workspaceId,
      tenantId: cacheBinding.tenantId ?? context.tenantId,
      userId: cacheBinding.userId ?? context.userId,
      sessionId: cacheBinding.sessionId ?? context.sessionId,
      sourceVersion: cacheBinding.sourceVersion,
      sourceEtag: cacheBinding.sourceEtag,
      toolName,
      toolInput: input,
      toolOutput: out,
      durationMs: Date.now() - t0,
      execErr: null,
      modelKey: context.modelKey ?? context.model_key ?? null,
      provider: context.provider ?? context.provider_key ?? null,
      agentRunId:
        context.agent_run_id ?? context.agentRunId ?? input?.agent_run_id ?? input?.agentRunId ?? null,
    });
  }
  if (cacheWrite?.ok === false) {
    console.warn(
      '[agentsam_tool_cache] write_failed',
      toolName,
      cacheWrite.reason ?? cacheWrite.error ?? 'unknown',
    );
  }
  if (fromCache) {
    return tagToolCacheProvenance(out, { cacheHit: true, resultSource: 'tool_cache' });
  }
  return tagToolCacheProvenance(out, { cacheHit: false, resultSource: 'live' });
}

/** Per-tool wall-clock budget for Promise.race around dispatchToolCall (ms). */
export function resolveToolExecutionBudgetMs(toolName, input) {
  const n = String(toolName || '').toLowerCase();
  const inp = input && typeof input === 'object' ? input : {};
  const rawTimeout = inp.timeout_ms != null ? Number(inp.timeout_ms) : NaN;
  if (n === 'agentsam_terminal_sandbox' || n === 'agentsam_container_exec') {
    if (Number.isFinite(rawTimeout) && rawTimeout > 0) {
      return Math.min(600_000, Math.max(60_000, Math.floor(rawTimeout)));
    }
    return 130_000;
  }
  const terminalNames = new Set([
    'terminal_run',
    'terminal_execute',
    'terminal_wrangler',
    'run_command',
    'bash',
  ]);
  if (n.startsWith('agentsam_terminal_') || terminalNames.has(n)) {
    if (Number.isFinite(rawTimeout) && rawTimeout > 0) {
      return Math.min(600_000, Math.max(60_000, Math.floor(rawTimeout)));
    }
    return 130_000;
  }
  if (
    n === 'd1_query' ||
    n === 'agentsam_d1_query' ||
    n === 'd1_explain' ||
    n === 'd1_schema_introspect' ||
    (n.startsWith('d1_') && n.includes('query')) ||
    (n.startsWith('agentsam_d1_') && (n.includes('query') || n.includes('write') || n.includes('migrate')))
  ) {
    if (Number.isFinite(rawTimeout) && rawTimeout > 0 && rawTimeout <= 10000) return Math.floor(rawTimeout);
    return 10000;
  }
  if (n.startsWith('r2_')) {
    if (Number.isFinite(rawTimeout) && rawTimeout > 0 && rawTimeout < 20000) return Math.floor(rawTimeout);
    return 20000;
  }
  if (
    n.startsWith('browser_') ||
    n.startsWith('playwright') ||
    n.startsWith('cdt_') ||
    n === 'preview_in_browser' ||
    n === 'playwright_screenshot'
  ) {
    if (Number.isFinite(rawTimeout) && rawTimeout > 0 && rawTimeout < 30000) return Math.floor(rawTimeout);
    return 30000;
  }
  if (n === 'search_web') return 12_000;
  if (n === 'web_fetch') return 15_000;
  if (n === 'excalidraw_plan_map_create') return 15000;
  if (n === 'illustration_create') return 45000;
  // Image gen is 20–35s each; variations fan-out needs parallel headroom under the 2m turn.
  if (n.startsWith('imgx_')) {
    const vRaw = Number(inp.variations ?? inp.count ?? inp.n ?? 1);
    const variations = Number.isFinite(vRaw) ? Math.max(1, Math.min(4, Math.floor(vRaw))) : 1;
    const budget = 90_000 + (variations - 1) * 20_000;
    if (Number.isFinite(rawTimeout) && rawTimeout > 0) {
      return Math.min(120_000, Math.max(budget, Math.floor(rawTimeout)));
    }
    return Math.min(120_000, budget);
  }
  if (n.startsWith('github_')) {
    if (Number.isFinite(rawTimeout) && rawTimeout > 0 && rawTimeout < 30000) return Math.floor(rawTimeout);
    return 30000;
  }
  if (Number.isFinite(rawTimeout) && rawTimeout > 0 && rawTimeout < 30000) return Math.floor(rawTimeout);
  return 30000;
}

export async function dispatchToolCallWithBudget(env, toolName, input, context, budgetMs) {
  let tid;
  const err = /** @type {Error & { code?: string; budgetMs?: number }} */ (
    Object.assign(new Error(`Tool timed out after ${budgetMs}ms`), {
      code: 'tool_timeout',
      budgetMs,
    })
  );
  try {
    return await Promise.race([
      dispatchToolCall(env, toolName, input, context),
      new Promise((_, reject) => {
        tid = setTimeout(() => reject(err), budgetMs);
      }),
    ]);
  } finally {
    if (tid) clearTimeout(tid);
  }
}

// ─── Request-scoped Context Loaders ──────────────────────────────────────────

