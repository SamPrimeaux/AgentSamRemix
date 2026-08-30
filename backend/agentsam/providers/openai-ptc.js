/**
 * OpenAI Responses Programmatic Tool Calling authority.
 *
 * Model capability + feature flag decide whether PTC is available. Each
 * tool's caller_policy remains the invocation authority and defaults direct.
 */
import { isFeatureEnabled } from '../../platform/feature-flags.js';
import { loadCatalogCapabilities } from '../catalog/model-capabilities.js';

const FLAG_KEY = 'openai_ptc';
const ALLOWED_CALLERS = new Set(['direct', 'programmatic']);

export function parseCallerPolicy(raw) {
  if (raw == null || raw === '') return ['direct'];
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      return ['direct'];
    }
  }
  if (!Array.isArray(parsed) || !parsed.length) return ['direct'];
  const result = [];
  const seen = new Set();
  for (const item of parsed) {
    const value = String(item || '').trim().toLowerCase();
    if (!ALLOWED_CALLERS.has(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result.length ? result : ['direct'];
}

export function callerPolicyAllowsProgrammatic(rawPolicy) {
  return parseCallerPolicy(rawPolicy).includes('programmatic');
}

export function allowedCallersFromCallerPolicy(rawPolicy, opts = {}) {
  return opts.openaiPtcEnabled === true ? parseCallerPolicy(rawPolicy) : ['direct'];
}

export function normalizeFunctionCallCallerType(caller) {
  const type =
    typeof caller === 'string'
      ? caller
      : caller && typeof caller === 'object'
        ? caller.type
        : '';
  const normalized = String(type || '').trim().toLowerCase();
  return normalized === 'program' || normalized === 'programmatic'
    ? 'programmatic'
    : 'direct';
}

export function assertCallerAllowedAtInvoke(rawPolicy, caller) {
  const allowed = parseCallerPolicy(rawPolicy);
  const callerType = normalizeFunctionCallCallerType(caller);
  if (!allowed.includes(callerType)) {
    return {
      ok: false,
      reason: `caller_policy_denies_${callerType}`,
      allowed_callers: allowed,
      caller_type: callerType,
    };
  }
  return { ok: true };
}

export function applyDeferLoadingLaw(toolDef, allowedCallers) {
  if (!toolDef || typeof toolDef !== 'object') return toolDef;
  if (!Array.isArray(allowedCallers) || !allowedCallers.includes('programmatic')) {
    return toolDef;
  }
  if (toolDef.defer_loading === true) {
    const { defer_loading: _drop, ...rest } = toolDef;
    return rest;
  }
  return toolDef;
}

export async function modelSupportsProgrammaticToolCalling(env, modelKey) {
  const key = String(modelKey || '').trim();
  if (!key) return false;
  const capabilities = await loadCatalogCapabilities(env, key);
  return capabilities?.supports_programmatic_tool_calling === true;
}

export async function shouldInjectProgrammaticToolCalling(env, opts = {}) {
  const flagEnabled =
    opts.force === true ||
    (await isFeatureEnabled(env, FLAG_KEY, {
      userId: opts.userId,
      tenantId: opts.tenantId,
    }));
  if (!flagEnabled) return false;
  return modelSupportsProgrammaticToolCalling(env, opts.modelKey);
}

function toolShape(tool) {
  return tool?.type === 'function' && tool?.function ? tool.function : tool;
}

export function normalizeJsonSchema(raw, fallback = null) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Convert Agent Sam tool definitions to the flat Responses API function shape. */
export function toOpenAIResponsesTools(tools, opts = {}) {
  if (!Array.isArray(tools) || !tools.length) return undefined;
  return tools
    .map((tool) => {
      const shape = toolShape(tool);
      const name = String(shape?.name || tool?.tool_key || '').trim();
      if (!name) return null;
      const rawPolicy =
        tool?.caller_policy ??
        shape?.caller_policy ??
        tool?.allowed_callers ??
        shape?.allowed_callers;
      const allowedCallers = allowedCallersFromCallerPolicy(rawPolicy, opts);
      const definition = {
        type: 'function',
        name,
        description: String(shape?.description || ''),
        parameters:
          shape?.parameters || shape?.input_schema || tool?.input_schema || {
            type: 'object',
            properties: {},
          },
        allowed_callers: allowedCallers,
        ...(shape?.output_schema || tool?.output_schema
          ? { output_schema: shape?.output_schema || tool?.output_schema }
          : {}),
        ...(shape?.defer_loading === true || tool?.defer_loading === true
          ? { defer_loading: true }
          : {}),
      };
      return applyDeferLoadingLaw(definition, allowedCallers);
    })
    .filter(Boolean);
}

export function withProgrammaticToolCalling(tools, enabled) {
  if (!enabled) return tools;
  const result = Array.isArray(tools) ? [...tools] : [];
  if (!result.some((tool) => tool?.type === 'programmatic_tool_calling')) {
    result.push({ type: 'programmatic_tool_calling' });
  }
  return result;
}

export function isProgrammaticFunctionCall(call) {
  return (
    normalizeFunctionCallCallerType(call?.caller ?? call?.caller_type) ===
    'programmatic'
  );
}

export function openAIOutputNeedsContinuation(outputItems) {
  if (!Array.isArray(outputItems) || !outputItems.length) return false;
  const hasMessage = outputItems.some((item) => item?.type === 'message');
  const hasPendingCall = outputItems.some((item) => item?.type === 'function_call');
  const hasProgramState = outputItems.some(
    (item) => item?.type === 'program' || item?.type === 'program_output',
  );
  return !hasMessage && !hasPendingCall && hasProgramState;
}
