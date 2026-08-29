/** Memory catalog lane. */
/**
 * Execute agentsam_tools rows by handler_type + handler_config only.
 * No hardcoded tool_key / tool_name branches.
 *
 * Credential resolution: backend/credentials/resolver.js (resolveCredential).
 */

import { parseInput, safeJsonString, summarizeOutput, writeTelemetryError, insertToolCallLog, bindingBucket, wrapWorkspaceShellCommand } from '../../backend/services/tools/shared.js';

const MEMORY_CATALOG_OPS = new Set([
  'memory_write',
  'memory_search',
  'memory_read',
  'memory_delete',
  'memory_list',
  'memory_resolve',
]);

const MEMORY_CATALOG_OP_ALIASES = {
  search: 'memory_search',
  write: 'memory_write',
  upsert: 'memory_write',
  save: 'memory_write',
  read: 'memory_read',
  get: 'memory_read',
  delete: 'memory_delete',
  list: 'memory_list',
  resolve: 'memory_resolve',
  close: 'memory_resolve',
};

/**
 * Resolve memory catalog operation from handler_config + tool input.
 * @param {Record<string, unknown>} config
 * @param {Record<string, unknown>} params
 * @param {string} toolKey
 */
function resolveMemoryCatalogOperation(config, params, toolKey) {
  const raw = String(params.operation ?? params.op ?? config.operation ?? '')
    .toLowerCase()
    .trim();
  if (MEMORY_CATALOG_OPS.has(raw)) return raw;

  const manageOps = new Set(['memory.manage', 'memory_manager', 'memory_manage', 'manage']);
  let sub = raw;
  if (manageOps.has(raw) || (toolKey === 'agentsam_memory_manager' && !raw)) {
    sub = String(
      params.sub_operation ?? params.action ?? params.mode ?? '',
    )
      .toLowerCase()
      .trim();
    if (!sub && (params.query != null || params.q != null)) sub = 'search';
    if (!sub && (params.key || params.memory_key) && (params.value || params.content)) {
      sub = 'write';
    }
    if (!sub && params.keys) sub = 'read';
    if (!sub && (params.key || params.memory_key) && params.resolved === true) sub = 'resolve';
    if (!sub && (params.key || params.keys) && (params.resolve === true || params.action === 'resolve')) {
      sub = 'resolve';
    }
  }

  if (MEMORY_CATALOG_OPS.has(sub)) return sub;
  if (MEMORY_CATALOG_OP_ALIASES[sub]) return MEMORY_CATALOG_OP_ALIASES[sub];
  if (MEMORY_CATALOG_OP_ALIASES[raw]) return MEMORY_CATALOG_OP_ALIASES[raw];
  return sub || raw;
}

/**
 * Dispatch agentsam_tools.handler_type=memory (and memory.manage config).
 * @param {any} env
 * @param {Record<string, unknown>} config
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} runContext
 * @param {string} toolKey
 */
export async function executeMemoryCatalogDispatch(env, config, params, runContext, toolKey) {
  const tenantId = String(runContext.tenantId ?? runContext.tenant_id ?? '').trim();
  const userId = String(runContext.userId ?? runContext.user_id ?? '').trim();
  const workspaceId = String(runContext.workspaceId ?? runContext.workspace_id ?? '').trim();
  const tk = String(toolKey || '').trim();

  // Canonical commit / hybrid recall — same core as MCP adapters.
  if (
    tk === 'agentsam_memory_commit' ||
    tk === 'agentsam_memory_save' ||
    String(config.operation || '').toLowerCase() === 'memory.commit'
  ) {
    const workspace = {
      tenant_id: tenantId,
      user_id: userId,
      workspace_id: workspaceId || undefined,
      _,
    };
    const {
      executeAgentsamMemoryCommit,
      executeAgentsamMemorySaveViaCommit,
    } = await import('./agentsam-memory-commit.js');
    const out =
      tk === 'agentsam_memory_save' || config.eager_default === false
        ? await executeAgentsamMemorySaveViaCommit(env, env.DB, workspace, params || {})
        : await executeAgentsamMemoryCommit(env, env.DB, workspace, params || {}, { eager: true });
    const text = out?.content?.[0]?.text;
    let body = out;
    try {
      body = text ? JSON.parse(text) : out;
    } catch {
      body = { ok: false, error: 'unparseable_commit_response', raw: text };
    }
    return body?.ok === false
      ? { ok: false, error: String(body.error || 'commit_failed'), body }
      : { ok: true, body };
  }

  if (tk === 'agentsam_memory_search') {
    const workspace = {
      tenant_id: tenantId,
      user_id: userId,
      workspace_id: workspaceId || undefined,
      _,
    };
    const { executeAgentsamMemoryHybridSearch } = await import('./agentsam-memory-hybrid-search.js');
    const out = await executeAgentsamMemoryHybridSearch(env, env.DB, workspace, {
      ...params,
      query: params.query ?? params.q ?? '',
      limit: Math.min(Math.max(Number(params.limit ?? params.top_k) || 10, 1), 20),
    });
    const text = out?.content?.[0]?.text;
    let body = out;
    try {
      body = text ? JSON.parse(text) : out;
    } catch {
      body = { ok: false, error: 'unparseable_search_response', raw: text };
    }
    const agentRunId =
      runContext?.agentRunId != null
        ? String(runContext.agentRunId).trim()
        : runContext?.agent_run_id != null
          ? String(runContext.agent_run_id).trim()
          : '';
    if (agentRunId && body?.hits?.length) {
      try {
        const { recordKnowledgeUseForRun, knowledgeRefFromMemoryRow } = await import(
          './knowledge-protocol-bridge.js'
        );
        recordKnowledgeUseForRun(
          agentRunId,
          body.hits.map((h) => knowledgeRefFromMemoryRow(h.row || h, Number(h.score) || 0.5)),
        );
      } catch {
        /* optional */
      }
    }
    return body?.ok === false
      ? { ok: false, error: String(body.error || 'search_failed'), body }
      : { ok: true, body };
  }

  const op = resolveMemoryCatalogOperation(config, params, toolKey);

  if (!op || !MEMORY_CATALOG_OPS.has(op)) {
    return {
      ok: false,
      error: `memory operation required (search|write|read|delete|list|resolve); got=${op || '(empty)'}`,
    };
  }

  const memCtx = {
    tenantId,
    userId,
    workspaceId: workspaceId || undefined,
    agentId: runContext.agentId ?? runContext.agent_id,
    sessionId: runContext.sessionId ?? runContext.session_id,
  };

  if (op === 'memory_list') {
    if (workspaceId) {
      const { searchPrivateAgentsamMemory } = await import('../../backend/http/agentsam/routes/private-memory.js');
      const out = await searchPrivateAgentsamMemory(env, {
        tenantId,
        workspaceId,
        userId,
        memoryType: params.memory_type ?? params.memoryType,
        limit: Math.min(Math.max(Number(params.limit) || 10, 1), 20),
        includeContent: false,
      });
      if (out?.error) return { ok: false, error: String(out.error) };
      return {
        ok: true,
        body: {
          results: out.results ?? [],
          count: out.results?.length ?? 0,
          tier: out.tier,
        },
      };
    }
    const { memorySearch } = await import('../../backend/http/agentsam/routes/memory-write-runtime.js');
    const out = await memorySearch({
      ...params,
      limit: Math.min(Math.max(Number(params.limit) || 10, 1), 20),
    }, env, memCtx);
    return out?.error ? { ok: false, error: String(out.error) } : { ok: true, body: out };
  }

  // Compatibility: legacy memory_write / memory_search → canonical commit / hybrid.
  if (op === 'memory_write') {
    const workspace = {
      tenant_id: tenantId,
      user_id: userId,
      workspace_id: workspaceId || undefined,
      _,
    };
    const { resolveManagedMemoryType } = await import('./mcp-memory-type-compat.js');
    const resolved = resolveManagedMemoryType(params);
    const { executeAgentsamMemoryCommit } = await import('./agentsam-memory-commit.js');
    const out = await executeAgentsamMemoryCommit(
      env,
      env.DB,
      workspace,
      {
        ...params,
        key: params.key ?? params.memory_key ?? params.memoryKey,
        memory_key: params.memory_key ?? params.key ?? params.memoryKey,
        content: params.value ?? params.content ?? params.body,
        value: params.value ?? params.content ?? params.body,
        memory_type: resolved.memory_type,
        tags: resolved.tags?.length ? resolved.tags : params.tags,
        source: params.source ?? `catalog:${toolKey}`,
        source_client: 'dashboard',
      },
      { eager: true },
    );
    const text = out?.content?.[0]?.text;
    let body = out;
    try {
      body = text ? JSON.parse(text) : out;
    } catch {
      body = { ok: false, error: 'unparseable_commit_response', raw: text };
    }
    return body?.ok === false
      ? { ok: false, error: String(body.error || 'commit_failed'), body }
      : { ok: true, body };
  }

  if (op === 'memory_search') {
    const workspace = {
      tenant_id: tenantId,
      user_id: userId,
      workspace_id: workspaceId || undefined,
      _,
    };
    const { DEFAULT_MEMORY_SEARCH_QUERY } = await import('./mcp-memory-search-schema.js');
    const { executeAgentsamMemoryHybridSearch } = await import('./agentsam-memory-hybrid-search.js');
    const out = await executeAgentsamMemoryHybridSearch(env, env.DB, workspace, {
      ...params,
      query: params.query ?? params.q ?? (params.top_k ? DEFAULT_MEMORY_SEARCH_QUERY : ''),
      limit: Math.min(Math.max(Number(params.limit ?? params.top_k) || 10, 1), 20),
      source_client: 'dashboard',
    });
    const text = out?.content?.[0]?.text;
    let body = out;
    try {
      body = text ? JSON.parse(text) : out;
    } catch {
      body = { ok: false, error: 'unparseable_search_response', raw: text };
    }
    return body?.ok === false
      ? { ok: false, error: String(body.error || 'search_failed'), body }
      : { ok: true, body };
  }

  const { handlers: memoryHandlers } = await import('../../backend/http/agentsam/routes/memory-write-runtime.js');
  const fn = memoryHandlers[op];
  if (typeof fn !== 'function') {
    return { ok: false, error: `memory handler not registered: ${op}` };
  }

  const out = await fn(params, env, memCtx);
  return out?.error ? { ok: false, error: String(out.error), body: out } : { ok: true, body: out };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} row agentsam_tools
 * @param {Record<string, unknown>} config parsed handler_config
 * @param {unknown} input
 * @param {Record<string, unknown>} runContext
 * @param {{ value?: string, auth_source?: string }} credentials
 */
