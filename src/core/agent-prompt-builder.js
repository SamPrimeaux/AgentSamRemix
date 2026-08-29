import { scheduleToolCallLog } from './agentsam-ops-ledger.js';

export function inferArtifactFromAssistantText(text) {
  if (!text || typeof text !== 'string' || !text.includes('```')) return null;
  const m = text.match(/```([\w+#.-]*)/);
  const rawLang = m && m[1] ? String(m[1]).toLowerCase().replace(/^language-/, '') : '';
  let artifact_type = 'other';
  if (rawLang.includes('html')) artifact_type = 'html';
  else if (rawLang === 'js' || rawLang === 'javascript') artifact_type = 'js';
  else if (rawLang === 'ts' || rawLang === 'typescript' || rawLang === 'tsx') artifact_type = 'tsx';
  else if (rawLang === 'css') artifact_type = 'css';
  else if (rawLang === 'json') artifact_type = 'json';
  else if (rawLang === 'sql') artifact_type = 'sql';
  const name = rawLang && rawLang.length > 0 && rawLang.length < 80 ? rawLang : 'untitled';
  return { artifact_type, name };
}

function assistantPlainFromContent(c) {
  if (typeof c === 'string') return c.trim();
  if (Array.isArray(c)) {
    return c
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }
  return '';
}

export function extractLastAssistantPlainText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'assistant') continue;
    const t = assistantPlainFromContent(m.content);
    if (t) return t;
  }
  return '';
}

/**
 * Prefer the longest assistant text in the turn. Timeout/halt synthesis is often
 * appended last and would otherwise replace a long streamed answer on persist.
 */
export function extractBestAssistantPlainText(messages) {
  if (!Array.isArray(messages)) return '';
  let best = '';
  for (const m of messages) {
    if (!m || m.role !== 'assistant') continue;
    const t = assistantPlainFromContent(m.content);
    if (t.length > best.length) best = t;
  }
  return best;
}

export function scheduleAgentsamArtifactFromChatOutput(env, ctx, opts) {
  if (!env?.DB || !ctx?.waitUntil) return;
  const { outputText, userId, tenantId, workspaceId, sourceAgentRunId, sourceSessionId } = opts;
  const meta = inferArtifactFromAssistantText(outputText || '');
  if (!meta) return;
  const uid = userId != null ? String(userId).trim() : '';
  const tid = tenantId != null ? String(tenantId).trim() : '';
  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  if (!uid || !tid || !ws) return;
  ctx.waitUntil(
    (async () => {
      try {
        const { extractFencedArtifactContent, writeWorkspaceArtifact } = await import(
          '../core/artifact-r2-store.js'
        );
        const content = extractFencedArtifactContent(outputText || '');
        if (!content) return;
        const out = await writeWorkspaceArtifact(env, ctx, {
          userId: uid,
          tenantId: tid,
          workspaceId: ws,
          content,
          artifactType: meta.artifact_type,
          name: meta.name,
          source: 'agent_response',
          sourceRunId: sourceAgentRunId ?? null,
          sourceSessionId: sourceSessionId ?? null,
          origin: env?.IAM_ORIGIN ?? null,
        });
        if (!out.ok) {
          console.error('[agentsam_artifacts]', out.user_message || out.error);
        }
      } catch (e) {
        console.warn('[agentsam_artifacts]', e?.message ?? e);
      }
    })(),
  );
}

export function scheduleAgentsamToolCallLog(env, ctx, fields) {
  const {
    tenantId, sessionId, toolName, status, durationMs, costUsd,
    inputTokens, outputTokens, userId, workspaceId, errorMessage,
    agent_run_id, agentRunId, conversation_id, conversationId,
    routingArmId, routing_arm_id,
    mode, modelKey, model_key, toolChainId, tool_chain_id,
  } = fields;
  const tid = tenantId != null && String(tenantId).trim() !== '' ? String(tenantId).trim() : '';
  const ws = workspaceId != null && String(workspaceId).trim() !== '' ? String(workspaceId).trim() : '';
  if (!tid || !ws) {
    // Fail loud — silent skip made tool_blocked SSE unauditable (zero ledger rows).
    console.error(
      '[tool_call_log] identity_required',
      JSON.stringify({
        tool_name: toolName != null ? String(toolName).slice(0, 120) : null,
        status: status != null ? String(status).slice(0, 40) : null,
        has_tenant: Boolean(tid),
        has_workspace: Boolean(ws),
        agent_run_id: agent_run_id ?? agentRunId ?? null,
        conversation_id: conversation_id ?? conversationId ?? sessionId ?? null,
      }),
    );
    return;
  }
  let stat = 'success';
  if (status === 'error') stat = 'error';
  else if (status === 'timeout') stat = 'timeout';
  else if (status === 'blocked') stat = 'blocked';
  else if (status === 'pending') stat = 'pending';
  scheduleToolCallLog(env, ctx, {
    tenantId,
    workspaceId,
    sessionId,
    toolName,
    status: stat,
    durationMs,
    costUsd,
    inputTokens,
    outputTokens,
    userId,
    errorMessage: errorMessage != null ? String(errorMessage).slice(0, 8000) : null,
    tool_key: fields.tool_key ?? toolName,
    tool_category: fields.tool_category ?? fields.toolCategory,
    handler_key: fields.handler_key,
    agentsam_tools_id: fields.agentsam_tools_id,
    agent_run_id: agent_run_id ?? agentRunId,
    conversation_id: conversation_id ?? conversationId ?? sessionId,
    routing_arm_id: routing_arm_id ?? routingArmId ?? null,
    mode,
    model_key: model_key ?? modelKey ?? null,
    model_key_source: fields.model_key_source ?? fields.modelKeySource ?? null,
    source_client: fields.source_client ?? fields.sourceClient ?? null,
    tool_chain_id: tool_chain_id ?? toolChainId ?? null,
    cache_hit: fields.cache_hit ?? fields.cacheHit,
    cacheHit: fields.cacheHit ?? fields.cache_hit,
    result_source: fields.result_source ?? fields.resultSource,
    resultSource: fields.resultSource ?? fields.result_source,
    external_execution: fields.external_execution ?? fields.externalExecution,
    externalExecution: fields.externalExecution ?? fields.external_execution,
  });
}

export function toolLogFieldsFromValidation(validation) {
  if (!validation || typeof validation !== 'object') return {};
  const v = validation;
  const policy = {
    allowed: v.allowed === true,
    reason: v.reason ?? null,
    riskLevel: v.riskLevel ?? null,
    requiresConfirmation: v.requiresConfirmation === true,
    capability_shadow:
      v.capabilityDecision && typeof v.capabilityDecision === 'object'
        ? v.capabilityDecision
        : null,
  };
  const out = {
    tool_key: v.toolKey != null ? String(v.toolKey) : undefined,
    tool_category: v.toolCategory != null ? String(v.toolCategory) : undefined,
    capability_key: v.capabilityKey != null ? String(v.capabilityKey) : undefined,
    handler_key: v.handlerKey != null ? String(v.handlerKey) : undefined,
    route_key: v.routeKey != null ? String(v.routeKey) : undefined,
    agentsam_tools_id: v.agentsamToolsId != null ? v.agentsamToolsId : undefined,
    mcp_server_id: v.mcpServerId != null ? v.mcpServerId : undefined,
    server_key: v.serverKey != null ? String(v.serverKey) : undefined,
    policy_decision_json: JSON.stringify(policy),
  };
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}

// Stubs — no longer needed but kept to avoid import errors elsewhere
export async function resolveBootstrapWorkspaceIdForAgentApi() { return null; }
export async function resolvePromptRouteRowForAgentChat() { return null; }
export async function resolveAgentsamPromptRoute() { return null; }
export async function fetchActivePlanContextFragment() { return ''; }

export function isSimpleAskMessage(_message = '') {
  return false;
}

/**
 * Flat static system prompt — ambient identity + optional locked client context +
 * optional lane RAG block.
 * Do not auto-query Hyperdrive here. Pinned-memory SELECT raced at 1.5s, leaked
 * pool clients after timeout, and contended with the code indexer. Later:
 * query-time Vectorize via AGENTSAM_VECTORIZE_MEMORY
 * (tkt_chat_memory_vectorize_not_hyperdrive_2026_08).
 */
export async function buildSystemPrompt(_env, _tenantId, _mode, _contextBlock, _modeConfig, _promptRouteRow, options = {}) {
  const message = options?.message != null ? String(options.message) : '';
  const activeRepo = String(
    options?.activeRepo ??
      options?.active_repo ??
      options?.githubRepoContext ??
      options?.github_repo_context ??
      '',
  ).trim();
  const activeBranch = String(options?.activeBranch ?? options?.active_branch ?? '').trim();
  const userId = String(options?.userId ?? options?.ctx?.authUser?.id ?? '').trim();
  const workspaceId = String(options?.workspaceId ?? options?.ctx?.authUser?.active_workspace_id ?? '').trim();
  const tenantId = String(_tenantId ?? options?.ctx?.authUser?.tenant_id ?? '').trim();

  const filesSource = String(options?.filesSource || options?.files_source || '')
    .trim()
    .toLowerCase();
  const filesSourcePath = String(
    options?.filesSourcePath || options?.files_source_path || '',
  ).trim();
  const fsaRoot =
    options?.fsaRoot === true ||
    options?.fsa_root === true ||
    filesSource === 'local';

  const base = activeRepo || fsaRoot || filesSource
    ? 'You are Agent Sam, an AI coding and operations assistant. Use tools to read/edit/run when the job needs file contents or side effects. When asked what is open in Files/editor, answer from the "What you currently see" / Files-rail facts — do not rediscover with tools.'
    : 'You are Agent Sam, an AI coding and operations assistant. Use tools to read files, query databases, run commands, and deploy. Do not assume an active repo, file, or dashboard surface — discover job context through tools or explicit user attachments (@file, @browser, etc.).';
  const parts = [base];

  const filesSourceIsGithub = filesSource === 'github';

  if (fsaRoot) {
    // Facts only — path/lane law lives in D1 rules + tool execution, not prompt prose.
    parts.push(
      [
        '## Active local workspace (Files rail — local)',
        `fsa_root: true`,
        filesSourcePath ? `folder: ${filesSourcePath}` : 'folder: (connected)',
        filesSource ? `files_source: ${filesSource}` : 'files_source: local',
        'If asked whether you see the open local folder/Files rail, answer yes from these facts immediately.',
      ].join('\n'),
    );
  } else if (filesSourceIsGithub && activeRepo) {
    // Lock only when Files rail is GitHub — never ambient workspace.github_repo alone.
    // Never invent main — omit branch line until Files rail / create_branch supplies one.
    parts.push(
      [
        '## Active GitHub repo (Files rail — github)',
        `repo: ${activeRepo}`,
        ...(activeBranch ? [`branch: ${activeBranch}`] : ['branch: (unset — never invent main; use the branch from create_branch or Files rail)']),
        'files_source: github',
        'When the user says "this repo", "the open repo", "the current repo", "my open github repo", or "here", use this exact owner/name.',
        'If asked whether you see the open GitHub repo/Files rail, answer yes from these facts immediately — do not rediscover.',
      ].join('\n'),
    );
  } else if (activeRepo) {
    // Ambient workspace metadata is informational only when the Files rail is not GitHub.
    parts.push(
      activeBranch
        ? `Available GitHub repository metadata: ${activeRepo} (branch: ${activeBranch}).`
        : `Available GitHub repository metadata: ${activeRepo} (branch unset — do not invent main).`,
    );
  }

  // Tool menus / allowlists come from D1 runtime profiles — never hardcode tool policy here.

  try {
    const { formatAmbientIdentityForAgent } = await import('./workspace-studio-context.js');
    const auth = options?.ctx?.authUser ?? options?.authUser ?? null;
    const identityBlock = formatAmbientIdentityForAgent({
      user_id: userId || auth?.id || null,
      email: auth?.email ?? null,
      role: auth?.role ?? 'user',
      tenant_id: tenantId || auth?.tenant_id || null,
      workspace_id: workspaceId || auth?.active_workspace_id || null,
      credential_lane: auth?.credential_lane ?? 'byok',
    });
    if (identityBlock) parts.push(`## Session\n${identityBlock}`);
  } catch (_) {
    /* optional */
  }

  const laneCtx = _contextBlock != null ? String(_contextBlock).trim() : '';
  if (laneCtx) {
    parts.push(`## Lane context\n${laneCtx.slice(0, 6000)}`);
  }

  return parts.join('\n\n');
}

export { resolveWorkerProjectId as projectIdFromEnv } from './worker-identity.js';

export function parseJsonSafe(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}
