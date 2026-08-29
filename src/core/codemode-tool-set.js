/**
 * Codemode toolset — thin adapter over an already-authorized Agent Sam tool menu.
 *
 * Cloudflare Codemode needs a connector internally. That is an implementation detail.
 * This module MUST NOT:
 *   - query agentsam_tools / rebuild a parallel catalog
 *   - select, allowlist, or policy-filter tools
 *   - apply workspace / lane / approval / superadmin logic
 *
 * All of that happens upstream. Here we only translate the effective tools into
 * Codemode-callable functions and mount the CF-required connector.
 *
 * Requires env.LOADER and DurableObjectState (opts.durableCtx) for the runtime facet.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { createCodemodeRuntime, DynamicWorkerExecutor } from '@cloudflare/codemode';
import { toolSetConnector } from '@cloudflare/codemode/ai';
import { dispatchCatalogToolResult } from '../../backend/http/agentsam/routes/dispatch-by-tool-code.js';
import {
  CODEMODE_TOOL_CONNECTOR,
  CODEMODE_TOOL_NAME,
  CODEMODE_CATALOG_CONNECTOR,
} from './codemode-constants.js';

export { CODEMODE_TOOL_NAME, CODEMODE_TOOL_CONNECTOR, CODEMODE_CATALOG_CONNECTOR };

/**
 * @param {Record<string, unknown>} prop
 */
function jsonSchemaPropertyToZod(prop) {
  if (!prop || typeof prop !== 'object') return z.unknown().optional();
  const t = String(prop.type || '').toLowerCase();
  if (t === 'string') return z.string().optional();
  if (t === 'number' || t === 'integer') return z.number().optional();
  if (t === 'boolean') return z.boolean().optional();
  if (t === 'array') return z.array(z.unknown()).optional();
  if (t === 'object') return z.record(z.string(), z.unknown()).optional();
  return z.unknown().optional();
}

/**
 * @param {Record<string, unknown>} schema
 */
function jsonSchemaToZodObject(schema) {
  const props = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const shape = Object.fromEntries(
    Object.entries(props).map(([k, v]) => [k, jsonSchemaPropertyToZod(v)]),
  );
  const obj = Object.keys(shape).length ? z.object(shape) : z.object({}).passthrough();
  // Codemode zero-arg calls pass `undefined`, not `{}`. Default coerces undefined → {}.
  return obj.default({});
}

/**
 * Normalize the already-authorized Agent Sam tool menu into slim defs for the connector.
 * @param {unknown} tools
 * @returns {Array<{ name: string, description: string, input_schema: Record<string, unknown> }>}
 */
export function normalizeAuthorizedToolsForCodemode(tools) {
  if (!Array.isArray(tools)) return [];
  const out = [];
  const seen = new Set();
  for (const t of tools) {
    if (!t || typeof t !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (t);
    const name = String(row.name || row.tool_name || row.tool_key || '').trim();
    if (!name || name === CODEMODE_TOOL_NAME || seen.has(name)) continue;
    seen.add(name);
    const rawSchema = row.input_schema || row.inputSchema || row.parameters;
    const input_schema =
      rawSchema && typeof rawSchema === 'object'
        ? /** @type {Record<string, unknown>} */ (rawSchema)
        : { type: 'object', properties: {} };
    out.push({
      name,
      description: String(row.description || name).slice(0, 4000),
      input_schema: Object.assign({ type: 'object', properties: {} }, input_schema, {
        type: 'object',
      }),
    });
  }
  return out;
}

/**
 * Adapt already-authorized Agent Sam tools into a Codemode runtime.
 * Does not decide access — only translates presentation/dispatch.
 *
 * @param {any} env
 * @param {Record<string, unknown>} [runContext] identity bag for nested dispatch
 * @param {{
 *   tools: Array<Record<string, unknown>>,
 *   durableCtx: DurableObjectState,
 *   runtimeName?: string,
 *   getRunContext?: () => Record<string, unknown>,
 * }} opts
 * @returns {Promise<{
 *   codemodeTool: import('ai').Tool,
 *   toolCount: number,
 *   runtime: ReturnType<typeof createCodemodeRuntime>,
 *   connectorName: string,
 * }>}
 */
export async function buildCodemodeToolset(env, runContext = {}, opts = {}) {
  if (!env?.LOADER) {
    throw new Error('buildCodemodeToolset: env.LOADER worker_loaders binding is required');
  }
  const durableCtx = opts.durableCtx;
  if (!durableCtx || typeof durableCtx !== 'object') {
    throw new Error(
      'buildCodemodeToolset: opts.durableCtx (DurableObjectState) is required for createCodemodeRuntime',
    );
  }
  if (typeof durableCtx.facets?.get !== 'function') {
    throw new Error(
      'buildCodemodeToolset: durableCtx.facets unavailable — bump compatibility_date for Durable Object facets',
    );
  }

  const authorized = normalizeAuthorizedToolsForCodemode(opts.tools);
  if (!authorized.length) {
    throw new Error(
      'buildCodemodeToolset: opts.tools (already-authorized Agent Sam menu) is required and must be non-empty',
    );
  }

  /** @type {Record<string, import('ai').Tool>} */
  const adapted = {};
  for (const def of authorized) {
    const toolKey = def.name;
    adapted[toolKey] = tool({
      description: def.description,
      inputSchema: jsonSchemaToZodObject(def.input_schema),
      execute: async (args) => {
        const live = typeof opts.getRunContext === 'function' ? opts.getRunContext() : null;
        const ctx = live && typeof live === 'object' ? live : runContext;
        return dispatchCatalogToolResult(env, toolKey, args, ctx);
      },
    });
  }
  const toolCount = authorized.length;

  const executor = new DynamicWorkerExecutor({
    loader: env.LOADER,
    timeout: 25_000,
    globalOutbound: null,
  });

  const connectorName = CODEMODE_TOOL_CONNECTOR;
  const connector = toolSetConnector(durableCtx, {
    name: connectorName,
    instructions:
      `Authorized Agent Sam tools for this turn (${toolCount}). ` +
      'codemode.search / codemode.describe discover method names on this connector only — not the git repo. ' +
      `Call as await ${connectorName}.<tool_key>(args).`,
    tools: adapted,
  });

  const runtime = createCodemodeRuntime({
    ctx: durableCtx,
    executor,
    connectors: [connector],
    name: opts.runtimeName != null ? String(opts.runtimeName) : 'default',
  });

  const codemodeTool = runtime.tool({
    connectorHints: {
      [connectorName]: `${toolCount} authorized tools — use codemode.search / codemode.describe first`,
    },
  });

  return { codemodeTool, toolCount, runtime, connectorName };
}
