/**
 * Catalog dispatch: agentsam_tools row → resolveCredential → catalog-tool-executor.
 * No hardcoded tool names; no runBuiltinTool fallback.
 */
import { parseHandlerConfig, resolveCredential, sanitizeToolCredentialError } from '../../../credentials/resolver.js';
import { executeCatalogTool } from '../../../services/tools/catalog-tool-executor.js';
import { assertTenantSpendPolicy } from '../../../identity/policy/tenant-spend.js';
import {
  validateHandlerConfigForExecution,
} from '../../../../src/core/agentsam-tools-catalog.js';
import { resolveIntegrationUserId } from '../../../integrations/user-id.js';
import {
  executeFindToolsMetaTool,
  isCatalogDiscoveryMetaTool,
  normalizeFindToolsInput,
} from './find-tools-meta-tool.js';
import {
  resolveCatalogDispatchToolKey,
  loadCatalogToolRowForDispatch,
} from '../../../../src/core/catalog-tool-key-resolve.js';

function parseInput(input) {
  if (input == null) return {};
  if (typeof input === 'object' && !Array.isArray(input)) return { ...input };
  return { value: input };
}

function normalizeAuthSourceForSpend(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'platform_scoped') return 'platform_scoped';
  if (s === 'platform' || s === 'env' || s === 'binding') return 'platform';
  return s;
}

/**
 * @param {any} env
 * @param {string} toolCodeOrKey
 */
export async function dispatchByToolCode(env, toolCodeOrKey, input, runContext = {}) {
  const rawKey = String(toolCodeOrKey ?? '').trim();

  // Core meta-tool: discover catalog capabilities before normal row dispatch.
  // Includes agentsam_search_tools (P2 progressive discovery) — always platform
  // env.DB, never Catalog Studio D1 (explicit_d1_resource_required).
  // Risk/approval remains enforced when the selected catalog tool is executed later.
  if (isCatalogDiscoveryMetaTool(rawKey)) {
    const toolKey = resolveCatalogDispatchToolKey(rawKey) || rawKey;
    const out = await executeFindToolsMetaTool(
      env,
      normalizeFindToolsInput(parseInput(input), runContext),
      runContext,
    );
    if (out?.ok === false) {
      return {
        ok: false,
        error: out.error || 'find_tools_failed',
        tool_key: toolKey,
        status: out.status,
        body: out.body,
      };
    }
    return {
      ok: true,
      tool_key: toolKey,
      auth_source: 'none',
      status: 200,
      result: out.result ?? out,
    };
  }

  const resolvedKey = resolveCatalogDispatchToolKey(rawKey);
  const row = await loadCatalogToolRowForDispatch(env, rawKey);
  if (!row) {
    return { ok: false, error: `agentsam_tools not found: ${toolCodeOrKey}` };
  }

  const config = parseHandlerConfig(row.handler_config);
  const configCheck = validateHandlerConfigForExecution(row, config);
  if (!configCheck.ok) {
    return { ok: false, error: configCheck.error, tool_key: row.tool_key };
  }

  const workspaceId = runContext.workspaceId ?? runContext.workspace_id ?? null;
  const tenantId = runContext.tenantId ?? runContext.tenant_id ?? null;
  let userId = runContext.userId ?? runContext.user_id ?? null;
  if (userId) {
    const canonicalUserId = await resolveIntegrationUserId(env, { id: String(userId) });
    if (canonicalUserId) userId = canonicalUserId;
  }

  let credentials = { auth_source: 'none', value: null };
  // Actor comes from the host runtime context — do not synthesize privilege from flags.
  const authUser = runContext.authUser ?? runContext.user ?? null;

  const spendGate = await assertTenantSpendPolicy(env, {
    tenantId,
    userId,
    workspaceId,
    sessionId: runContext.sessionId ?? runContext.session_id ?? null,
    authSource: config.auth_source ? normalizeAuthSourceForSpend(config.auth_source) : null,
    modelKey: runContext.modelKey ?? runContext.model_key ?? null,
    modelTier: runContext.modelTier ?? runContext.model_tier ?? null,
    billingSource: runContext.billingSource ?? runContext.billing_source ?? null,
    hasByok: runContext.hasByok === true || runContext.has_byok === true,
    estimatedCallCostUsd: runContext.estimatedCallCostUsd ?? runContext.estimated_call_cost_usd ?? null,
  });
  if (!spendGate.ok) {
    return {
      ok: false,
      error: spendGate.message || spendGate.error || 'tenant_spend_policy_denied',
      tool_key: row.tool_key,
      body: {
        error: spendGate.error,
        tenant_id: tenantId,
        max_model_tier: spendGate.max_model_tier ?? null,
        spent_usd: spendGate.spent_usd ?? null,
        cap_usd: spendGate.cap_usd ?? null,
      },
      status: 402,
    };
  }

  if (config.auth_source) {
    try {
      credentials = await resolveCredential(env, workspaceId, tenantId, config, {
        userId,
        authUser,
        account_identifier: config.account_identifier,
        isInternalAgent: runContext.isInternalAgent === true,
        isOperatorCall:
          runContext.isOperatorCall === true ||
          runContext.is_operator_call === true,
        mcpBearer: runContext.mcpBearer ?? runContext.mcp_bearer ?? null,
      });
    } catch (e) {
      return {
        ok: false,
        error: sanitizeToolCredentialError(e?.message ?? String(e)),
        tool_key: row.tool_key,
      };
    }
  }

  const enrichedContext = {
    ...runContext,
    credentials,
    authUser,
    user: runContext.user ?? authUser,
    mode: runContext.mode ?? runContext.agent_mode ?? null,
    agent_mode: runContext.agent_mode ?? runContext.mode ?? null,
    source_client: runContext.source_client ?? runContext.sourceClient ?? null,
    sourceClient: runContext.sourceClient ?? runContext.source_client ?? null,
    agentsam_tool_id: row.id,
    agentsam_tool_key: row.tool_key,
    handler_type: row.handler_type,
  };

  const out = await executeCatalogTool(
    env,
    row,
    config,
    {
      ...parseInput(input),
      workspace_id: workspaceId,
      tenant_id: tenantId,
      user_id: userId,
    },
    enrichedContext,
    credentials,
  );

  if (!out.ok) {
    const failure = {
      ok: false,
      error: out.error,
      user_message: out.user_message ?? out.body?.user_message ?? null,
      schema_hint: out.schema_hint ?? out.body?.schema_hint ?? null,
      recovery: out.recovery ?? out.body?.recovery ?? null,
      database_id: out.database_id ?? out.body?.database_id ?? null,
      hint: out.hint ?? out.body?.hint ?? null,
      tool_key: row.tool_key,
      auth_source: credentials.auth_source,
      status: out.status,
      body:
        out.body ??
        (out.user_message || out.schema_hint || out.recovery
          ? {
              ok: false,
              error: out.error,
              user_message: out.user_message,
              schema_hint: out.schema_hint,
              recovery: out.recovery,
              database_id: out.database_id,
            }
          : undefined),
    };
    return failure;
  }

  return {
    ok: true,
    tool_key: row.tool_key,
    auth_source: credentials.auth_source,
    status: out.status,
    /** GitHub normalize paths return payload at top level (no .body) — fall back to full result. */
    result: out.body != null ? out.body : out,
  };
}

/**
 * Adapter-friendly wrapper — returns tool output or { error } (no runBuiltinTool).
 * @param {any} env
 * @param {string} toolKey
 * @param {unknown} input
 * @param {Record<string, unknown>} runContext
 */
export async function dispatchCatalogToolResult(env, toolKey, input, runContext = {}) {
  const out = await dispatchByToolCode(env, toolKey, input, runContext);
  if (out?.ok === false) {
    return { error: out.error ?? 'dispatch_failed' };
  }
  return out.result ?? out;
}
