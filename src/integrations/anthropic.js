/**
 * Integration: Anthropic
 * Refactored: Official Anthropic TypeScript SDK Integration.
 * Handles tool-calling, streaming, and v4.6 features (Caching, Batching).
 * Zero-hardcoding: Model parameters and feature flags are DB-driven.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  anthropicFeaturesFromCatalogCapabilities,
  loadCatalogCapabilities,
  SCOUT_TASK_TYPES,
} from '../../backend/agentsam/catalog/model-capabilities.js';
import { handlers as dbHandlers } from '../../backend/agentsam/tools/db.js';
import { resolveApiKey } from '../core/vault.js';
import { sanitizeAnthropicToolInputSchema } from './anthropic-schema.js';
import { ANTHROPIC_FILES_API_BETA } from './anthropic-files.js';
import {
  anthropicSkillsMessageBetas,
  normalizeAnthropicContainerSkills,
} from './anthropic-skills.js';

/** BM25 tool search (official name per Anthropic tool reference). */
const TOOL_SEARCH_BM25 = {
  type: 'tool_search_tool_bm25_20251119',
  name: 'tool_search_tool_bm25',
};

/** Beta namespace for Anthropic-hosted code execution (bash + file ops + Python). @see https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/code-execution-tool */
export const ANTHROPIC_CODE_EXECUTION_BETA = 'code-execution-2025-08-25';

/**
 * Build Messages `container` from options (pause_turn id reuse and/or Agent Skills).
 * @param {{ container?: string|{ id?: string, skills?: any[] }, skills?: any[], fileRefs?: boolean }} options
 * @returns {{ container?: string|object, skillBetas: string[], needsFilesBeta: boolean }}
 */
export function resolveAnthropicMessagesContainer(options = {}) {
  const skillBetas = [];
  let needsFilesBeta = options.fileRefs === true || options.filesApi === true;
  const rawSkills = options.skills ?? options.container?.skills;
  const skills = normalizeAnthropicContainerSkills(rawSkills);
  const idRaw =
    typeof options.container === 'string'
      ? options.container
      : options.container?.id != null
        ? String(options.container.id)
        : options.anthropicContainerId != null
          ? String(options.anthropicContainerId)
          : '';
  const id = idRaw.trim();

  if (skills.length) {
    skillBetas.push(...anthropicSkillsMessageBetas());
    needsFilesBeta = true;
  }

  if (!id && !skills.length) {
    return { container: undefined, skillBetas, needsFilesBeta };
  }
  if (id && !skills.length) {
    return { container: id, skillBetas, needsFilesBeta };
  }
  return {
    container: {
      ...(id ? { id } : {}),
      skills,
    },
    skillBetas,
    needsFilesBeta,
  };
}

/**
 * Anthropic server-side sandbox tool — not deferred (always visible; avoids tool-search-only discovery).
 * Haiku: no server-side code execution.
 * Sonnet/Opus 4.5+ and 5+ (incl. `claude-sonnet-5`): prefer `code_execution_20260120`
 * (persistent container + programmatic tool calling). Older Sonnet/Opus → `20250825`.
 * @param {string} modelKey
 * @returns {{ type: string, name: string } | null}
 */
export function anthropicCodeExecutionToolForModel(modelKey) {
  const mk = String(modelKey || '').toLowerCase();
  if (!mk.includes('claude') && !mk.includes('anthropic_')) return null;
  if (mk.includes('haiku')) {
    return null;
  }
  // claude-sonnet-5, claude-opus-4-8, anthropic_claude-sonnet-4.5, …
  const ver = mk.match(/(?:sonnet|opus)[-_.]?(\d+)(?:[-_.](\d+))?/);
  if (ver) {
    const major = Number(ver[1]);
    const minor = ver[2] != null ? Number(ver[2]) : 0;
    if (major > 4 || (major === 4 && minor >= 5)) {
      return { type: 'code_execution_20260120', name: 'code_execution' };
    }
  }
  return { type: 'code_execution_20250825', name: 'code_execution' };
}

/**
 * Build Anthropic Messages `tools[]` for Agent Sam.
 *
 * Default: wire agentsam_tools eagerly (no Anthropic BM25, no defer_loading).
 * Progressive discovery is agentsam_search_tools — NOT tool_search_tool_bm25.
 * Opt-in only: features.anthropic_tool_search === true restores BM25 + defer.
 *
 * @param {any[]} tools
 * @param {{ modelKey?: string, features?: Record<string, unknown> }} [opts]
 */
export function buildAnthropicMessagesTools(tools, opts = {}) {
  const list = Array.isArray(tools) ? tools : [];
  const modelKey = opts.modelKey != null ? String(opts.modelKey) : '';
  const features = opts.features && typeof opts.features === 'object' ? opts.features : {};
  const codeExecOff = features.anthropic_code_execution === false;
  // Fail-closed: Anthropic BM25 searches Anthropic deferred tools, not agentsam_tools.
  // Live hard-fail (2026-08-08): Haiku burned budget on tool_search_tool_bm25 → "no matching tools"
  // while progressive_core_github already had agentsam_github_* + agentsam_codebase_retrieve.
  const useAnthropicToolSearch = features.anthropic_tool_search === true;

  const rest = list.filter(
    (t) =>
      !(
        t &&
        (t.type === TOOL_SEARCH_BM25.type ||
          String(t.name || '') === TOOL_SEARCH_BM25.name ||
          String(t.name || '') === 'tool_search_tool_bm25')
      ),
  );
  // Deduplicate by tool name — multiple upstream sources (MCP tools, catalog
  // enrichment, minimum tool set) can produce the same name more than once.
  // First occurrence wins; Anthropic returns 400 on any duplicate name.
  const _seenNames = new Set();
  const deduped = rest.filter((t) => {
    const n = String(t?.name || '').trim();
    if (!n || _seenNames.has(n)) return false;
    _seenNames.add(n);
    return true;
  });
  const mapped = deduped.map((t) => {
    const schema = t.parameters ?? t.input_schema;
    const out = {
      name: t.name,
    };
    if (useAnthropicToolSearch) out.defer_loading = true;
    if (t.description) out.description = t.description;
    if (t.type) out.type = t.type;
    if (schema && typeof schema === 'object') {
      out.input_schema = sanitizeAnthropicToolInputSchema(schema);
    }
    if (t.cache_control) out.cache_control = t.cache_control;
    return out;
  });

  const codeTool = codeExecOff ? null : anthropicCodeExecutionToolForModel(modelKey);
  // Domain tools first (d1_query, terminal, github, r2), code execution last
  // Model picks the right tool — not biased by position
  const tail = codeTool ? [codeTool] : [];
  if (useAnthropicToolSearch) return [TOOL_SEARCH_BM25, ...mapped, ...tail];
  return [...mapped, ...tail];
}

/**
 * `code-execution-2025-08-25` beta applies to `code_execution_20250825` / legacy `20250522` only.
 * `code_execution_20260120` is first-party GA — sending the 08-25 beta with it can cause 400.
 */
/**
 * Top-level automatic prompt caching (Anthropic moves breakpoint to last cacheable block).
 * @see https://platform.claude.com/docs/en/build-with-claude/prompt-caching#automatic-caching
 * @param {Record<string, unknown>} features
 * @param {{ promptCaching?: boolean, cacheTtl?: string, systemPrompt?: string }} options
 * @returns {{ type: 'ephemeral', ttl?: string } | null}
 */
export function resolveAnthropicAutomaticCacheControl(features, options = {}) {
  const feats = features && typeof features === 'object' ? features : {};
  if (options.promptCaching === false || feats.prompt_caching === false) return null;

  const explicitOn =
    options.promptCaching === true ||
    feats.prompt_caching === true ||
    feats.prompt_caching === 1;
  const systemLen =
    options.systemPrompt != null ? String(options.systemPrompt).length : 0;
  /** Agent Sam layered prompts are typically 8k+ chars — worth caching on multi-turn chat. */
  const largeStaticPrefix = systemLen >= 8192;

  if (!explicitOn && !largeStaticPrefix) return null;

  const out = { type: 'ephemeral' };
  const ttlRaw = options.cacheTtl ?? feats.cache_ttl;
  const ttl = ttlRaw != null ? String(ttlRaw).trim() : '';
  if (ttl === '1h' || ttl === '5m') out.ttl = ttl;
  return out;
}

export function anthropicCodeExecutionNeeds202508Beta(tools) {
  const list = Array.isArray(tools) ? tools : [];
  return list.some(
    (t) =>
      t &&
      String(t.name || '') === 'code_execution' &&
      (t.type === 'code_execution_20250825' || t.type === 'code_execution_20250522'),
  );
}

/** Opus 4.7+ API: adaptive thinking + output_config.effort only — no manual budget_tokens thinking. */
export function isAnthropicOpus47PlusModel(logicalModelKey, apiModelId) {
  const s = `${String(logicalModelKey || '').toLowerCase()} ${String(apiModelId || '').toLowerCase()}`;
  return /opus[-_]?4[-_]7|opus[-_]?4[-_]8|opus_4_7|opus_4_8/.test(s);
}

const ANTHROPIC_EFFORT_VALUES = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/** Map gate / DB effort strings to Anthropic output_config.effort (omit none/disabled). */
export function normalizeAnthropicEffort(raw) {
  const v = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!v || v === 'none' || v === 'off' || v === 'disabled') return null;
  if (ANTHROPIC_EFFORT_VALUES.has(v)) return v;
  if (v === 'minimal') return 'low';
  if (v === 'maximal' || v === 'maximum') return 'max';
  return null;
}

/**
 * Adaptive thinking from catalog flag — Haiku must never receive thinking params (benchmark 400).
 * @param {{ supports_adaptive_thinking?: boolean|number }} resolvedModel
 * @param {{ task_type?: string, mode?: string }} routingDecision
 */
export function buildAnthropicThinkingConfig(resolvedModel, routingDecision = {}) {
  const supports =
    resolvedModel?.supports_adaptive_thinking === true ||
    resolvedModel?.supports_adaptive_thinking === 1;
  if (!supports) return {};

  const needsDeepReasoning = [
    'hard_debug',
    'routing_repair',
    'schema_migration_risk',
    'reviewer',
  ].includes(String(routingDecision.task_type || '').trim());

  if (!needsDeepReasoning) return {};

  // Effort comes from D1/arm via options.reasoningEffort — never hardcode here.
  return {
    thinking: { type: 'adaptive' },
  };
}

/**
 * Executes a tool-aware chat completion using the official Anthropic SDK.
 */
export async function chatWithAnthropic({ messages, tools, env, userId, options = {} }) {
  const apiKey = await resolveApiKey(env, userId, 'ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured for this user');

  const client = new Anthropic({ apiKey });
  const modelForApi = options.model || 'claude-3-5-sonnet-20240620';
  const logicalModelKey =
    options.catalogModelKey != null && String(options.catalogModelKey).trim() !== ''
      ? String(options.catalogModelKey).trim()
      : modelForApi;

  // Dynamic feature and rate lookup from D1 (logical model_key; API id may differ)
  const modelInfo = await dbHandlers.d1_query(
    {
      sql: 'SELECT * FROM agentsam_ai WHERE model_key = ?',
      params: [logicalModelKey],
    },
    env,
  );
  
  const modelData = modelInfo.results?.[0] || {};
  const catalogCap = await loadCatalogCapabilities(env, logicalModelKey);
  let supportsAdaptiveThinking = false;
  try {
    const adaptiveRow = await env?.DB?.prepare(
      'SELECT supports_adaptive_thinking FROM agentsam_model_catalog WHERE model_key = ? LIMIT 1',
    )
      .bind(logicalModelKey)
      .first();
    supportsAdaptiveThinking = adaptiveRow?.supports_adaptive_thinking === 1;
  } catch (_) {
    /* column may not exist pre-migration */
  }
  const features = {
    ...anthropicFeaturesFromCatalogCapabilities(catalogCap),
    ...JSON.parse(modelData.features_json || '{}'),
  };
  const betas = [...(options.betas || [])];
  if (Array.isArray(features.betas)) {
    for (const b of features.betas) {
      if (typeof b === 'string' && b.trim()) betas.push(b.trim());
    }
  }
  const compactionEnabled = features.compaction === true || features.compaction === 1;
  if (compactionEnabled) betas.push('compact-2026-01-12');

  /** Betas Anthropic no longer accepts on current models (400 invalid_request_error). */
  const RETIRED_ANTHROPIC_BETAS = new Set([
    'context-1m-2025-08-07',
    'thinking-2024-10-22',
  ]);

  const automaticCacheControl = resolveAnthropicAutomaticCacheControl(features, {
    promptCaching:
      options.promptCaching === true
        ? true
        : options.promptCaching === false
          ? false
          : Number(modelData.supports_cache) === 1
            ? true
            : undefined,
    cacheTtl: options.cacheTtl,
    systemPrompt: options.systemPrompt,
  });

  // Feature-driven betas only (plus merged features.betas above).
  if (automaticCacheControl) betas.push('prompt-caching-2024-07-31');
  // Do not send thinking-2024-10-22 — Sonnet 4.6 / Opus 4.7 use effort + adaptive thinking in-body, not this beta.

  const builtTools = buildAnthropicMessagesTools(tools, { modelKey: logicalModelKey, features });
  if (anthropicCodeExecutionNeeds202508Beta(builtTools)) {
    betas.push(ANTHROPIC_CODE_EXECUTION_BETA);
  }

  // Skills / Files / pause_turn container — resolve before beta filter
  const resolvedContainer = resolveAnthropicMessagesContainer({
    ...options,
    anthropicContainerId: options.anthropicContainerId ?? options.containerId,
  });
  for (const b of resolvedContainer.skillBetas) {
    if (b) betas.push(b);
  }
  if (resolvedContainer.needsFilesBeta) betas.push(ANTHROPIC_FILES_API_BETA);

  const betasFiltered = [...new Set(betas)].filter(
    (b) =>
      b &&
      !RETIRED_ANTHROPIC_BETAS.has(b) &&
      !String(b).startsWith('context-1m-'),
  );

  // Provider passes catalog max as maxOutputTokens; legacy callers may still use max_tokens.
  // Do NOT silently default to 4096 when catalog supplied a real ceiling — that + adaptive
  // thinking burns the whole budget before any text (done_no_token / close_done_no_token).
  const resolvedMaxTokens = (() => {
    const fromOut = Number(options.maxOutputTokens);
    if (Number.isFinite(fromOut) && fromOut > 0) return Math.floor(fromOut);
    const fromMax = Number(options.max_tokens);
    if (Number.isFinite(fromMax) && fromMax > 0) return Math.floor(fromMax);
    return 4096;
  })();

  const streamParams = {
    model: modelForApi,
    max_tokens: resolvedMaxTokens,
    system: options.systemPrompt || 'You are Agent Sam, a high-performance coding assistant.',
    ...(automaticCacheControl ? { cache_control: automaticCacheControl } : {}),
    messages: messages.map(m => ({
      role: m.role,
      content: Array.isArray(m.content) ? m.content : m.content
    })).filter(m => m.role !== 'system'),
    tools: builtTools,
    tool_choice: options.tool_choice || undefined,
    stream: true,
    // betas sent via client.beta path below, not in body
  };

  const lk = logicalModelKey.toLowerCase();
  const apiId = String(modelForApi).toLowerCase();
  const isHaiku = lk.includes('haiku') || apiId.includes('haiku');
  const isOpus47Plus = isAnthropicOpus47PlusModel(lk, apiId);
  const routingTaskType =
    options.routingTaskType != null ? String(options.routingTaskType).trim() : '';
  const isScoutTask = SCOUT_TASK_TYPES.has(routingTaskType);

  // Never send temperature on Anthropic Messages API bodies (many SKUs reject non-default values).
  // Opus 4.7/4.8 also reject non-default top_p / top_k — omit those for Opus only.
  if (!isOpus47Plus) {
    if (options.top_p != null && Number.isFinite(Number(options.top_p))) {
      streamParams.top_p = Number(options.top_p);
    }
    if (options.top_k != null && Number.isFinite(Number(options.top_k))) {
      streamParams.top_k = Number(options.top_k);
    }
  }

  // Effort — output_config.effort (low|medium|high|xhigh|max).
  // D1/arm only — never invent Opus/Sonnet JS defaults (fail omit → API default).
  const supportsEffort =
    features.supports_effort_scaling === true ||
    features.supports_effort_scaling === 1 ||
    features.effort_scaling === true ||
    features.effort_scaling === 1 ||
    isOpus47Plus;

  if (supportsEffort && !isScoutTask) {
    // D1/arm only — never invent effort from model identity (isOpus47Plus etc.).
    const effortVal =
      normalizeAnthropicEffort(options.effort) ||
      normalizeAnthropicEffort(options.reasoningEffort) ||
      normalizeAnthropicEffort(modelData.effort) ||
      normalizeAnthropicEffort(features.effort_default) ||
      null;
    if (effortVal) {
      const existingOut =
        streamParams.output_config && typeof streamParams.output_config === 'object'
          ? streamParams.output_config
          : {};
      streamParams.output_config = { ...existingOut, effort: effortVal };
    } else {
      const armId =
        options.routing_arm_id != null && String(options.routing_arm_id).trim() !== ''
          ? String(options.routing_arm_id).trim()
          : options.routingArmId != null && String(options.routingArmId).trim() !== ''
            ? String(options.routingArmId).trim()
            : null;
      console.warn(
        '[anthropic] effort_default_missing',
        JSON.stringify({ model_key: logicalModelKey, arm_id: armId }),
      );
    }
  }

  // Thinking — catalog-driven adaptive guard (Haiku: supports_adaptive_thinking=0 → no params).
  const adaptiveThinking = buildAnthropicThinkingConfig(
    { supports_adaptive_thinking: supportsAdaptiveThinking && !isHaiku },
    { task_type: routingTaskType, mode: options.mode },
  );
  if (adaptiveThinking.thinking) {
    streamParams.thinking = adaptiveThinking.thinking;
    if (adaptiveThinking.output_config) {
      streamParams.output_config = {
        ...(streamParams.output_config && typeof streamParams.output_config === 'object'
          ? streamParams.output_config
          : {}),
        ...adaptiveThinking.output_config,
      };
    }
  } else {
  const thinkingMode = String(modelData.thinking_mode || 'none').trim();
  const opusAdaptiveOnly = isOpus47Plus || thinkingMode === 'adaptive';

  if (options.thinking && typeof options.thinking === 'object') {
    const requestedType = String(options.thinking.type || '');
    if (isHaiku || (thinkingMode === 'none' && !isOpus47Plus)) {
      // Strip — Haiku rejects adaptive thinking; none mode stays off.
    } else if (opusAdaptiveOnly || requestedType === 'enabled') {
      streamParams.thinking = { type: 'adaptive' };
    } else {
      streamParams.thinking = options.thinking;
    }
  } else if (thinkingMode === 'none' && !isOpus47Plus) {
    if (isScoutTask) {
      /* scout: no thinking */
    }
  } else if (opusAdaptiveOnly && !isHaiku) {
    streamParams.thinking = { type: 'adaptive' };
  } else if (thinkingMode === 'adaptive_and_enabled' && !isHaiku) {
    // Sonnet 4.6 / Opus 4.6 only — never Opus 4.7+ (guarded above).
    if (options.thinkingBudget && Number(options.thinkingBudget) > 0) {
      streamParams.thinking = {
        type: 'enabled',
        budget_tokens: Number(options.thinkingBudget),
      };
    } else {
      streamParams.thinking = { type: 'adaptive' };
    }
  }
  }

  // Adaptive/enabled thinking shares max_tokens with visible text. Tiny ceilings
  // (or the old 4096 default ignoring catalog) burn the whole budget on thinking
  // → end_turn with zero text. Floor for any model once thinking is on — not Opus-only.
  const thinkingType =
    streamParams.thinking && typeof streamParams.thinking === 'object'
      ? String(streamParams.thinking.type || '')
      : '';
  if (
    (thinkingType === 'adaptive' || thinkingType === 'enabled') &&
    Number(streamParams.max_tokens) < 8192
  ) {
    console.warn(
      '[anthropic] adaptive_thinking_max_tokens_floor',
      JSON.stringify({
        model_key: logicalModelKey,
        from: streamParams.max_tokens,
        to: 8192,
        thinking_type: thinkingType,
      }),
    );
    streamParams.max_tokens = 8192;
  }

  // 3. Structured Output Config (GA moving from legacy output_format)
  if (options.jsonSchema) {
    const existingOut =
      streamParams.output_config && typeof streamParams.output_config === 'object'
        ? streamParams.output_config
        : {};
    streamParams.output_config = {
      ...existingOut,
      format: { type: 'json_schema', schema: options.jsonSchema },
    };
  }

  // 4. Data Residency — inference_geo is not a standard Anthropic field; skip

  if (resolvedContainer.container != null) {
    streamParams.container = resolvedContainer.container;
  }

  if (compactionEnabled) {
    const existing =
      options.context_management && typeof options.context_management === 'object'
        ? options.context_management
        : {};
    const edits = Array.isArray(existing.edits) ? [...existing.edits] : [];
    if (!edits.some((e) => e && String(e.type) === 'compact_20260112')) {
      edits.push({ type: 'compact_20260112' });
    }
    streamParams.context_management = { ...existing, edits };
  }

  // AbortSignal must be request options (2nd arg) — not body. Body `signal` → 400 Extra inputs.
  const requestOpts = options.signal != null ? { signal: options.signal } : undefined;
  const response =
    betasFiltered.length > 0
      ? await client.beta.messages.create(
          {
            ...streamParams,
            betas: betasFiltered,
          },
          requestOpts,
        )
      : await client.messages.create(streamParams, requestOpts);
  return response;
}

/**
 * Asynchronous Message Batch handler.
 * Leverages the SDK's batches namespace for high-volume background tasks.
 */
export async function createAnthropicBatch({ requests, env, userId }) {
  const apiKey = await resolveApiKey(env, userId, 'ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured for this user');
  const client = new Anthropic({ apiKey });
  
  return await client.messages.batches.create({ requests });
}

/**
 * Optional preflight token count for Anthropic payloads.
 *
 * NOT called on every chat request — that would add a full round-trip before
 * each message. Use only for:
 *   - Hard context-window enforcement before sending a large payload
 *   - Audit/debug when prompt size estimates feel wrong
 *
 * Post-call usage.input_tokens / usage.output_tokens from the API response
 * remains the canonical source for billing and agentsam_usage_events rows.
 * The chars/4 heuristic in provider.js is intentionally cheap telemetry only.
 *
 * @param {{ messages: any[], system?: string, tools?: any[], model: string }} params
 * @param {string} apiKey
 * @returns {Promise<number|null>} input token count or null on error
 */
export async function countAnthropicTokens({ messages, system, tools, model }, apiKey) {
  if (!apiKey || !messages?.length) return null;
  try {
    const client = new Anthropic({ apiKey });
    const result = await client.messages.countTokens({
      model,
      messages,
      ...(system  ? { system  } : {}),
      ...(tools?.length ? { tools } : {}),
    });
    return result?.input_tokens ?? null;
  } catch {
    return null;
  }
}

