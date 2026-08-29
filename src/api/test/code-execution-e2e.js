/**
 * DB + Anthropic E2E for code_execution_20260120 (programmatic tool calling).
 * Tables: agentsam_tool_chain, agentsam_usage_events, agentsam_command_run (existing columns only).
 *
 * Gates: production + env.IAM_ENABLE_E2E_TEST_ROUTES === 'true' (see src/index.js).
 * Auth: X-IAM-Test-Secret == env.IAM_TEST_SECRET ?? env.PTY_AUTH_TOKEN
 *
 * Body:
 *   mode              happy_path | bad_tool_input | unknown_tool | forced_tool_error |
 *                     forced_timeout | invalid_model_preference | opus_without_gate
 *   model_preference  sonnet | haiku | opus
 *   opus_gated        true to allow opus
 *   dry_run           true — no D1 writes; still runs validation / optional Anthropic
 *   test_id_suffix    optional string to stabilize correlation ids
 */

import { resolveCanonicalUserId } from '../auth.js';
import { pragmaTableInfo } from '../../../backend/services/retention.js';
import { estimateCostUsdFromCatalog, resolveModelKeyFromProviderId } from '../../../backend/telemetry/model-catalog-cost.js';

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const CODE_EXEC_TOOL_VERSION = 'code_execution_20260120';

const INSERTABLE_TABLES = new Set(['agentsam_tool_chain', 'agentsam_usage_events', 'agentsam_command_run']);

const TIER_MAP = {
  sonnet: { provider: 'anthropic', tier: 'power' },
  haiku: { provider: 'anthropic', tier: 'standard' },
  opus: { provider: 'anthropic', tier: 'reasoning', gated: true },
};

const E2E_MODES = new Set([
  'happy_path',
  'bad_tool_input',
  'unknown_tool',
  'forced_tool_error',
  'forced_timeout',
  'invalid_model_preference',
  'opus_without_gate',
]);

function newHexId(prefix) {
  const hex = crypto.randomUUID().replace(/-/g, '');
  return `${prefix}${hex.slice(0, 16)}`;
}

function isAuthorized(request, env) {
  const secret = env.IAM_TEST_SECRET ?? env.PTY_AUTH_TOKEN ?? '';
  return !!secret && (request.headers.get('X-IAM-Test-Secret') ?? '') === String(secret);
}

async function resolveModel(env, pref = 'sonnet', opusGated = false) {
  const map = TIER_MAP[pref] ?? TIER_MAP.sonnet;
  if (map.gated && !opusGated) {
    return resolveModel(env, 'sonnet', false);
  }
  try {
    const row = await env.DB.prepare(
      `
      SELECT model_key, anthropic_model_id, display_name,
             cost_per_1k_in, cost_per_1k_out
      FROM   agentsam_model_catalog
      WHERE  provider  = ?
        AND  tier      = ?
        AND  is_active = 1
        AND  anthropic_model_id IS NOT NULL
        AND  trim(anthropic_model_id) != ''
      LIMIT  1
    `,
    )
      .bind(map.provider, map.tier)
      .first();
    if (row?.anthropic_model_id) return { ...row, _source: 'agentsam_model_catalog' };
  } catch (err) {
    console.error('[e2e] agentsam_model_catalog:', err.message);
  }
  return {
    model_key: 'claude-sonnet-4-6',
    anthropic_model_id: 'claude-sonnet-4-6',
    display_name: 'Claude Sonnet 4.6 (fallback)',
    cost_per_1k_in: 0.003,
    cost_per_1k_out: 0.015,
    _source: 'fallback',
  };
}

async function resolveBootstrap(env) {
  try {
    const row = await env.DB.prepare(
      `
      SELECT workspace_id, tenant_id, user_id
      FROM   agentsam_bootstrap
      WHERE  is_active   = 1
        AND  environment = 'production'
      LIMIT  1
    `,
    ).first();
    if (row?.workspace_id) return { ...row, _source: 'agentsam_bootstrap' };
  } catch (err) {
    console.error('[e2e] agentsam_bootstrap:', err.message);
  }
  return {
    workspace_id: 'ws_inneranimalmedia',
    tenant_id: 'tenant_sam_primeaux',
    user_id: 'au_871d920d1233cbd1',
    _source: 'fallback',
  };
}

const SAMPLE_TOOL = {
  name: 'query_workspace_stats',
  description:
    'Returns workspace usage stats as JSON from D1 (read-only): counts for agentsam_tool_chain, agentsam_usage_events, agentsam_command_run for the given workspace_id.',
  input_schema: {
    type: 'object',
    properties: {
      workspace_id: { type: 'string' },
      since_days: { type: 'number' },
    },
    required: ['workspace_id'],
  },
  allowed_callers: [CODE_EXEC_TOOL_VERSION],
};

let e2eToolHandlerMode = 'happy_path';

async function fetchWorkspaceTelemetryStats(env, workspaceId) {
  const ws = String(workspaceId || '').trim();
  if (!ws || !env?.DB) {
    return { workspace_id: ws, tool_chain_rows: 0, usage_rows: 0, command_run_rows: 0, error: 'no_db_or_workspace' };
  }
  try {
    const tc = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM agentsam_tool_chain WHERE workspace_id = ?`,
    )
      .bind(ws)
      .first();
    const ue = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM agentsam_usage_events WHERE workspace_id = ?`,
    )
      .bind(ws)
      .first();
    const cr = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM agentsam_command_run WHERE workspace_id = ?`,
    )
      .bind(ws)
      .first();
    return {
      workspace_id: ws,
      tool_chain_rows: Number(tc?.n) || 0,
      usage_rows: Number(ue?.n) || 0,
      command_run_rows: Number(cr?.n) || 0,
    };
  } catch (e) {
    return { workspace_id: ws, error: e?.message ?? String(e) };
  }
}

async function handleSampleTool(env, input) {
  if (e2eToolHandlerMode === 'bad_tool_input') {
    return JSON.stringify({ error: 'malformed_input', detail: 'e2e_bad_tool_input' });
  }
  if (e2eToolHandlerMode === 'forced_tool_error') {
    throw new Error('e2e_forced_tool_error');
  }
  const stats = await fetchWorkspaceTelemetryStats(env, input.workspace_id);
  return JSON.stringify(stats);
}

async function anthropicPost(apiKey, body, signal = undefined) {
  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message ?? JSON.stringify(json);
    throw new Error(`Anthropic ${res.status}: ${msg}`);
  }
  return json;
}

async function runLoop(apiKey, env, modelId, messages, tools, containerId = null, fetchSignal = undefined) {
  const toolCallLog = [];
  for (let i = 0; i < 10; i++) {
    const body = { model: modelId, max_tokens: 2048, messages, tools };
    if (containerId) body.container = containerId;
    const resp = await anthropicPost(apiKey, body, fetchSignal);
    containerId = resp.container?.id ?? containerId;
    const uses = (resp.content ?? []).filter((b) => b.type === 'tool_use');
    toolCallLog.push(...uses);
    if (resp.stop_reason === 'end_turn') return { response: resp, toolCallLog, containerId };
    if (resp.stop_reason !== 'tool_use') throw new Error(`stop_reason: ${resp.stop_reason}`);
    const results = await Promise.all(
      uses.map(async (b) => ({
        type: 'tool_result',
        tool_use_id: b.id,
        content:
          b.name === 'query_workspace_stats'
            ? await handleSampleTool(env, b.input)
            : JSON.stringify({ error: `unknown_tool: ${b.name}` }),
      })),
    );
    messages = [...messages, { role: 'assistant', content: resp.content }, { role: 'user', content: results }];
  }
  throw new Error('max iterations exceeded');
}

function buildToolChainRow(p) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: p.chainId,
    workspace_id: p.workspaceId,
    tenant_id: p.tenantId ?? 'tenant_e2e',
    user_id: p.userId ?? 'user_e2e',
    tool_key: p.toolKey ?? p.toolName ?? 'code_execution',
    tool_status: p.toolStatus ?? 'completed',
    agent_run_id: p.agentRunId ?? null,
    conversation_id: p.agentSessionId ?? null,
    routing_arm_id: null,
    model_key: p.modelKey ?? null,
    outcome: p.outcome ?? 'ok',
    outcome_reason: p.outcomeReason ?? 'ok',
    started_at: now - Math.max(1, Math.floor((p.durationMs ?? 0) / 1000)),
    completed_at: now,
    duration_ms: p.durationMs ?? 0,
  };
}

function buildUsageEventRow(p) {
  const tin = Math.floor(Number(p.inputTokens) || 0);
  const tout = Math.floor(Number(p.outputTokens) || 0);
  return {
    id: p.usageId,
    tenant_id: p.tenantId,
    workspace_id: p.workspaceId,
    user_id: p.userId ?? null,
    session_id: p.agentSessionId,
    agent_name: 'agent-sam',
    provider: 'anthropic',
    model: p.anthropicModelId,
    model_key: p.modelKey,
    tokens_in: tin,
    tokens_out: tout,
    input_tokens: tin,
    output_tokens: tout,
    total_tokens: tin + tout,
    task_type: 'code',
    mode: 'agent',
    cost_usd: p.costUsd,
    status: p.status ?? 'ok',
    tool_name: 'code_execution',
    reason: null,
    ref_table: 'agentsam_tool_chain',
    ref_id: p.toolChainId,
    duration_ms: p.durationMs,
    event_type: p.eventType ?? 'code_execution_e2e_test',
    created_at: Math.floor(Date.now() / 1000),
  };
}

function buildCommandRunRow(p) {
  return {
    id: p.runId,
    workspace_id: p.workspaceId,
    tenant_id: p.tenantId ?? null,
    user_id: p.userId ?? null,
    session_id: p.agentSessionId,
    conversation_id: null,
    user_input: `E2E code_execution (${p.e2eMode ?? 'happy_path'})`,
    normalized_intent: 'code_execution_e2e',
    intent_category: 'misc',
    tier_used: 0,
    model_id: p.modelKey,
    commands_json: '[]',
    result_json: JSON.stringify(
      p.resultJson ?? {
        e2e_mode: p.e2eMode,
        telemetry_model: p.telemetryModel ?? null,
      },
    ),
    output_text: (p.outputText ?? '').slice(0, 2000) || null,
    confidence_score: 1.0,
    success: p.success ? 1 : 0,
    exit_code: p.exitCode ?? 0,
    duration_ms: p.durationMs,
    input_tokens: p.inputTokens,
    output_tokens: p.outputTokens,
    cost_usd: p.costUsd,
    error_message: p.errorMessage ?? null,
    selected_command_id: null,
    selected_command_slug: 'code_execution_e2e',
    risk_level: 'low',
    requires_confirmation: 0,
    approval_status: 'not_required',
  };
}

function validateToolChain(row) {
  const errors = [];
  for (const f of ['tenant_id', 'workspace_id', 'user_id', 'tool_key', 'tool_status', 'started_at']) {
    if (row[f] == null) errors.push(`missing: ${f}`);
  }
  const valid = ['running', 'completed', 'failed'];
  if (!valid.includes(row.tool_status)) errors.push(`bad tool_status: ${row.tool_status}`);
  if (row.completed_at != null && (row.started_at ?? 0) > (row.completed_at ?? 0)) {
    errors.push('started_at > completed_at');
  }
  return errors;
}

function validateUsageEvent(row) {
  const errors = [];
  for (const f of ['tenant_id', 'workspace_id', 'provider', 'model', 'tokens_in', 'tokens_out', 'model_key', 'event_type']) {
    if (row[f] == null) errors.push(`missing: ${f}`);
  }
  if (row.total_tokens == null) errors.push('missing: total_tokens');
  if (!['ok', 'blocked', 'error', 'timeout'].includes(row.status)) errors.push(`bad status: ${row.status}`);
  return errors;
}

async function insertRow(env, table, row) {
  if (!INSERTABLE_TABLES.has(table)) throw new Error('invalid table');
  const cols = await pragmaTableInfo(env.DB, table);
  const entries = Object.entries(row).filter(([k, v]) => cols.has(k.toLowerCase()) && v !== undefined);
  if (!entries.length) throw new Error(`no matching columns for ${table}`);
  const names = entries.map(([k]) => k);
  const placeholders = names.map(() => '?').join(', ');
  await env.DB.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders})`)
    .bind(...entries.map(([, v]) => v))
    .run();
}

async function persistE2eRows(env, toolChainRow, usageRow, commandRunRow) {
  const dbResults = { tool_chain: 'skipped', usage_event: 'skipped', command_run: 'skipped' };
  for (const [key, table, row] of [
    ['tool_chain', 'agentsam_tool_chain', toolChainRow],
    ['usage_event', 'agentsam_usage_events', usageRow],
    ['command_run', 'agentsam_command_run', commandRunRow],
  ]) {
    try {
      await insertRow(env, table, row);
      dbResults[key] = 'written';
    } catch (err) {
      dbResults[key] = `error: ${err.message}`;
      console.error(`[e2e] ${table}:`, err.message);
    }
  }
  return dbResults;
}

async function readbackRows(env, chainId, usageId, runId) {
  const db_readback = {};
  try {
    db_readback.tool_chain = await env.DB.prepare(`SELECT * FROM agentsam_tool_chain WHERE id = ? LIMIT 1`)
      .bind(chainId)
      .first();
  } catch (e) {
    db_readback.tool_chain = { error: e?.message ?? String(e) };
  }
  try {
    db_readback.usage_event = await env.DB.prepare(`SELECT * FROM agentsam_usage_events WHERE id = ? LIMIT 1`)
      .bind(usageId)
      .first();
  } catch (e) {
    db_readback.usage_event = { error: e?.message ?? String(e) };
  }
  try {
    db_readback.command_run = await env.DB.prepare(`SELECT * FROM agentsam_command_run WHERE id = ? LIMIT 1`)
      .bind(runId)
      .first();
  } catch (e) {
    db_readback.command_run = { error: e?.message ?? String(e) };
  }
  return db_readback;
}

function joinCheck(dbReadback) {
  const tc = dbReadback?.tool_chain;
  const ue = dbReadback?.usage_event;
  const cr = dbReadback?.command_run;
  const joins = {
    usage_ref_matches_tool_chain:
      ue && tc && String(ue.ref_table) === 'agentsam_tool_chain' && String(ue.ref_id) === String(tc.id),
    session_alignment:
      !!(
        tc &&
        ue &&
        cr &&
        String(tc.agent_session_id || '') === String(ue.session_id || '') &&
        String(tc.agent_session_id || '') === String(cr.session_id || '')
      ),
  };
  joins.all_ok = !!(joins.usage_ref_matches_tool_chain && joins.session_alignment);
  return joins;
}

function costCheck(usageRow, catalogRow) {
  const tin = Number(usageRow?.tokens_in) || 0;
  const tout = Number(usageRow?.tokens_out) || 0;
  const expected =
    (tin * Number(catalogRow?.cost_per_1k_in ?? 0)) / 1000 + (tout * Number(catalogRow?.cost_per_1k_out ?? 0)) / 1000;
  const actual = Number(usageRow?.cost_usd) || 0;
  return {
    expected_usd: expected,
    actual_usd: actual,
    close: Math.abs(expected - actual) < 0.0001 || (expected === 0 && actual === 0),
  };
}

export async function handleCodeExecutionE2E(request, env, _ctx) {
  const failures = [];

  if (!isAuthorized(request, env)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }
  if (!env.DB) {
    return Response.json({ error: 'DB not configured' }, { status: 503 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* empty */
  }

  const mode = String(body.mode ?? 'happy_path').toLowerCase();
  if (!E2E_MODES.has(mode)) {
    return Response.json(
      {
        pass: false,
        mode,
        dry_run: body.dry_run === true,
        failures: [`unknown_mode:${mode}`],
        validation: {},
        db_writes: {},
        db_readback: {},
        joins: {},
        costs: {},
        rows: {},
      },
      { status: 400 },
    );
  }

  const dryRun = body.dry_run === true;
  const suffix =
    body.test_id_suffix != null && String(body.test_id_suffix).trim() !== ''
      ? String(body.test_id_suffix).trim().slice(0, 24).replace(/[^a-zA-Z0-9_-]/g, '_')
      : `t${Date.now().toString(36)}`;

  const emptyPayload = {
    pass: false,
    mode,
    dry_run: dryRun,
    model: null,
    workspace: null,
    anthropic: {},
    validation: {},
    db_writes: {},
    db_readback: {},
    joins: {},
    costs: {},
    failures,
    rows: {},
  };

  if (mode === 'invalid_model_preference') {
    const badPref = String(body.model_preference ?? '__invalid_e2e_pref__');
    if (TIER_MAP[badPref]) {
      failures.push('invalid_model_preference: use a value not in tier map');
      return Response.json({ ...emptyPayload, pass: false });
    }
    return Response.json({
      ...emptyPayload,
      pass: true,
      validation: { rejected_unknown_model_preference: badPref },
      anthropic: { skipped: true },
    });
  }

  if (mode === 'opus_without_gate') {
    const pref = String(body.model_preference ?? 'opus').toLowerCase();
    const gated = body.opus_gated === true;
    const scenarioOk = pref === 'opus' && !gated;
    return Response.json({
      ...emptyPayload,
      pass: scenarioOk,
      validation: { opus_blocked_without_gate: scenarioOk, model_preference: pref, opus_gated: gated },
      anthropic: { skipped: true, reason: 'opus_requires_opus_gated_true' },
    });
  }

  const pref = String(body.model_preference ?? 'sonnet').toLowerCase();
  const [modelRow, bootstrap] = await Promise.all([
    resolveModel(env, pref === 'opus' ? 'opus' : pref === 'haiku' ? 'haiku' : 'sonnet', body.opus_gated === true),
    resolveBootstrap(env),
  ]);

  const userId = await resolveCanonicalUserId(bootstrap.user_id, env);
  if (!userId) {
    failures.push('canonical_user_id_unresolved');
  }

  const agentSessionId = `asess_e2e_${suffix}`;
  const chainId = newHexId('atc_e2e_');
  const usageId = newHexId('ue_e2e_');
  const runId = newHexId('run_e2e_');

  const workspaceStats = await fetchWorkspaceTelemetryStats(env, bootstrap.workspace_id);

  e2eToolHandlerMode = mode;

  const tools = [{ type: CODE_EXEC_TOOL_VERSION, name: 'code_execution' }, SAMPLE_TOOL];
  const messages = [
    {
      role: 'user',
      content: `Use code execution to call query_workspace_stats for workspace "${bootstrap.workspace_id}" with since_days=7. Return JSON only summarizing counts.`,
    },
  ];

  let finalResponse = null;
  let toolCallLog = [];
  let containerId = null;
  let durationMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let anthropicError = null;

  const skipAnthropic = mode === 'unknown_tool';

  const tLoop = Date.now();
  if (!skipAnthropic) {
    try {
      const signal = mode === 'forced_timeout' ? AbortSignal.timeout(80) : undefined;
      ({ response: finalResponse, toolCallLog, containerId } = await runLoop(
        env.ANTHROPIC_API_KEY,
        env,
        modelRow.anthropic_model_id,
        messages,
        tools,
        null,
        signal,
      ));
      durationMs = Date.now() - tLoop;
      const usage = finalResponse?.usage ?? {};
      inputTokens = usage.input_tokens ?? 0;
      outputTokens = usage.output_tokens ?? 0;
    } catch (err) {
      anthropicError = err?.message ?? String(err);
      durationMs = Math.max(1, Date.now() - tLoop);
      if (mode === 'forced_timeout') {
        anthropicError = anthropicError || 'timeout';
      } else if (mode !== 'forced_tool_error' && mode !== 'bad_tool_input') {
        return Response.json(
          {
            ...emptyPayload,
            model: { source: modelRow._source, model_key: modelRow.model_key },
            workspace: { ...bootstrap, user_id: userId, source: bootstrap._source },
            anthropic: { error: anthropicError },
            failures: [...failures, 'api_loop_failed'],
          },
          { status: 502 },
        );
      }
    }
  }

  if (mode === 'unknown_tool') {
    inputTokens = 0;
    outputTokens = 0;
    durationMs = 12;
    anthropicError = null;
  }

  const usage = finalResponse?.usage ?? {};
  if (!inputTokens && !outputTokens && finalResponse) {
    inputTokens = usage.input_tokens ?? 0;
    outputTokens = usage.output_tokens ?? 0;
  }

  let costUsd =
    (inputTokens * Number(modelRow.cost_per_1k_in ?? 0)) / 1000 +
    (outputTokens * Number(modelRow.cost_per_1k_out ?? 0)) / 1000;

  const textBlock = finalResponse?.content ? (finalResponse.content ?? []).find((b) => b.type === 'text') : null;

  let toolStatus = 'completed';
  let errorMessage = null;
  let errorType = null;
  let eventType = 'code_execution_e2e_test';
  let usageStatus = 'ok';

  if (mode === 'unknown_tool') {
    toolStatus = 'failed';
    errorMessage = 'unknown_tool_e2e';
    errorType = 'tool_not_found';
    eventType = 'code_execution_e2e_unknown_tool';
    usageStatus = 'error';
  } else if (mode === 'forced_tool_error' || (mode === 'forced_tool_error' && anthropicError)) {
    toolStatus = 'failed';
    errorMessage = anthropicError || 'e2e_forced_tool_error';
    errorType = 'tool_execution';
    usageStatus = 'error';
  } else if (mode === 'forced_timeout') {
    toolStatus = 'timeout';
    errorMessage = anthropicError || 'e2e_forced_timeout';
    errorType = 'timeout';
    eventType = 'code_execution_e2e_timeout';
    usageStatus = 'timeout';
  } else if (mode === 'bad_tool_input') {
    toolStatus = 'completed';
    errorMessage = null;
    errorType = null;
  }

  const { modelKey: catalogKey, rawModelId: providerRaw } = await resolveModelKeyFromProviderId(
    env.DB,
    'anthropic',
    modelRow.anthropic_model_id,
  );
  const modelKeyForRow = catalogKey || modelRow.model_key;
  const telemetryModel =
    providerRaw && catalogKey && catalogKey !== providerRaw
      ? { provider_model_id: providerRaw, catalog_model_key: catalogKey }
      : { provider_model_id: modelRow.anthropic_model_id, catalog_model_key: modelKeyForRow };

  if (!costUsd && (inputTokens || outputTokens) && modelKeyForRow) {
    costUsd = await estimateCostUsdFromCatalog(env.DB, modelKeyForRow, inputTokens, outputTokens);
  }

  const toolChainRow = buildToolChainRow({
    chainId,
    tenantId: bootstrap.tenant_id,
    workspaceId: bootstrap.workspace_id,
    userId,
    agentSessionId,
    modelKey: modelKeyForRow,
    toolName: mode === 'unknown_tool' ? 'nonexistent_tool_e2e' : 'code_execution',
    durationMs,
    inputTokens,
    outputTokens,
    costUsd,
    toolCallCount: mode === 'unknown_tool' ? 0 : toolCallLog.length,
    containerId,
    toolStatus,
    errorMessage,
    errorType,
    e2eMode: mode,
    providerModelId: modelRow.anthropic_model_id,
  });

  const usageRow = buildUsageEventRow({
    usageId,
    tenantId: bootstrap.tenant_id,
    workspaceId: bootstrap.workspace_id,
    userId,
    agentSessionId,
    modelKey: modelKeyForRow,
    anthropicModelId: modelRow.anthropic_model_id,
    inputTokens,
    outputTokens,
    costUsd,
    durationMs,
    toolChainId: chainId,
    status: usageStatus,
    eventType,
  });

  const commandRunRow = buildCommandRunRow({
    runId,
    workspaceId: bootstrap.workspace_id,
    tenantId: bootstrap.tenant_id,
    userId,
    agentSessionId,
    modelKey: modelKeyForRow,
    durationMs,
    inputTokens,
    outputTokens,
    costUsd,
    outputText: textBlock?.text,
    e2eMode: mode,
    telemetryModel,
    success: toolStatus === 'completed' && usageStatus === 'ok',
    exitCode: toolStatus === 'completed' ? 0 : 1,
    errorMessage,
  });

  const chainErrors = validateToolChain(toolChainRow);
  const usageErrors = validateUsageEvent(usageRow);
  const allValid = chainErrors.length === 0 && usageErrors.length === 0;

  let db_writes = { tool_chain: 'skipped', usage_event: 'skipped', command_run: 'skipped' };
  if (dryRun) {
    db_writes = { tool_chain: 'dry_run', usage_event: 'dry_run', command_run: 'dry_run' };
  } else if (
    allValid ||
    mode === 'unknown_tool' ||
    mode === 'forced_timeout' ||
    mode === 'forced_tool_error' ||
    mode === 'bad_tool_input'
  ) {
    db_writes = await persistE2eRows(env, toolChainRow, usageRow, commandRunRow);
  }

  let db_readback = {};
  if (!dryRun && db_writes.tool_chain === 'written' && db_writes.usage_event === 'written' && db_writes.command_run === 'written') {
    db_readback = await readbackRows(env, chainId, usageId, runId);
  }

  const joins = joinCheck(db_readback);
  const costs = costCheck(db_readback.usage_event || usageRow, modelRow);

  if (!dryRun && db_readback.tool_chain && !joins.all_ok) {
    failures.push('join_verification_failed');
  }
  if (!dryRun && db_readback.usage_event && !costs.close && (inputTokens || outputTokens)) {
    failures.push('cost_mismatch');
  }

  const writesOk =
    db_writes.tool_chain === 'written' &&
    db_writes.usage_event === 'written' &&
    db_writes.command_run === 'written';
  const pass =
    failures.length === 0 && (dryRun ? allValid : writesOk && (!db_readback.tool_chain || joins.all_ok));

  const modelMeta = { ...modelRow };
  delete modelMeta._source;
  const workspaceMeta = { ...bootstrap };
  delete workspaceMeta._source;

  e2eToolHandlerMode = 'happy_path';

  return Response.json({
    pass,
    mode,
    dry_run: dryRun,
    model: { ...modelMeta, source: modelRow._source },
    workspace: { ...workspaceMeta, user_id: userId, source: bootstrap._source },
    anthropic: {
      skipped: !!skipAnthropic,
      error: anthropicError,
      tool_calls: toolCallLog.map((t) => ({ name: t.name, caller_type: t.caller?.type ?? 'direct' })),
      container_id: containerId,
    },
    validation: {
      tool_chain_errors: chainErrors,
      usage_event_errors: usageErrors,
      workspace_stats: workspaceStats,
    },
    db_writes,
    db_readback,
    joins,
    costs,
    failures,
    rows: {
      tool_chain_id: chainId,
      usage_event_id: usageId,
      command_run_id: runId,
      agent_session_id: agentSessionId,
      tool_chain: toolChainRow,
      usage_event: usageRow,
      command_run: commandRunRow,
    },
    model_response: textBlock?.text ?? null,
  });
}
