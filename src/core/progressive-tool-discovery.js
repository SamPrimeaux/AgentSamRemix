/**
 * Progressive tool discovery — RETIRED (2026-08-08).
 *
 * Mode menus / policy come from D1 only:
 *   agentsam_tool_profiles (composer_*) + agentsam_tools + write_policy_json
 * This module no longer shrinks turn-0 menus. Kept exports are compatibility
 * shims (filterToolsForFilesSource is a no-op — no exclusive Files-rail lock).
 */

import { loadToolProfileRow, parseToolProfileKeysJson } from './d1-tool-profile.js';

/** Pinned onto the active wire menu when the turn is a visual generation ask. */
export const IMAGE_GENERATION_PIN_TOOL_KEYS = Object.freeze(['imgx_generate_image']);

/**
 * Pinned when the user message references a ticket id (`tkt_…`).
 * Without this, thin-pipe models guess via memory_search instead of reading the row.
 */
export const TICKET_INSPECT_PIN_TOOL_KEYS = Object.freeze([
  'agentsam_ticket',
  'agentsam_d1_query',
]);

/** D1 profile_key for progressive turn-0 core (non-GitHub Files rail). */
export const PROGRESSIVE_CORE_PROFILE_KEY = 'progressive_core';

/** D1 profile_key for progressive turn-0 core when files_source=github. */
export const PROGRESSIVE_GITHUB_CORE_PROFILE_KEY = 'progressive_core_github';

/**
 * Ask mode read-only core direction (D1 ask profile should match; used for honesty filter pins).
 */
export const ASK_READONLY_CORE_TOOL_KEYS = Object.freeze([
  'agentsam_search_tools',
  'agentsam_github_tree',
  'agentsam_github_read',
  'agentsam_github_search',
  'agentsam_codebase_retrieve',
  'fs_read_file',
  'fs_list_dir',
  'fs_search_files',
  'agentsam_d1_query',
  'agentsam_memory_search',
  'search_web',
]);

/**
 * Empty — progressive discovery eliminated. Do not re-add mode names here;
 * tool menus are D1 composer_* profiles, not JS mode lists.
 */
export const PROGRESSIVE_DISCOVERY_MODES = Object.freeze([]);

/**
 * @deprecated Progressive cores retired — always returns progressive_core key for legacy callers.
 * @param {unknown} filesSource
 */
export function progressiveCoreProfileKeyForFilesSource(filesSource) {
  const src = String(filesSource || '')
    .trim()
    .toLowerCase();
  return src === 'github' ? PROGRESSIVE_GITHUB_CORE_PROFILE_KEY : PROGRESSIVE_CORE_PROFILE_KEY;
}

/**
 * Load progressive turn-0 tool keys from D1. Missing/empty → fail closed ([]).
 * @param {unknown} env
 * @param {unknown} [filesSource]
 * @returns {Promise<string[]>}
 */
export async function loadProgressiveCoreToolKeys(env, filesSource) {
  const profileKey = progressiveCoreProfileKeyForFilesSource(filesSource);
  const row = await loadToolProfileRow(env, profileKey);
  const keys = parseToolProfileKeysJson(row?.tool_keys_json);
  if (!keys.length) {
    console.warn(
      '[progressive-tools] progressive_core_missing_fail_closed',
      JSON.stringify({
        profile_key: profileKey,
        files_source: String(filesSource || '').trim().toLowerCase() || null,
      }),
    );
  }
  return keys;
}

/**
 * @deprecated Use loadProgressiveCoreToolKeys(env, filesSource). Sync path cannot invent D1 menus.
 * @param {unknown} filesSource
 * @returns {readonly string[]}
 */
export function resolveProgressiveCoreToolKeys(filesSource) {
  void filesSource;
  return Object.freeze([]);
}

/**
 * @deprecated No-op — composer_* menus keep fs + github + deploy together.
 * files_source is UI preferred bind, not a menu partition.
 * @param {unknown[]} tools
 * @param {unknown} [_filesSource]
 * @returns {unknown[]}
 */
export function filterToolsForFilesSource(tools, _filesSource) {
  return Array.isArray(tools) ? tools : [];
}

/**
 * Product surfaces with a tight curated profile (e.g. Design Studio CAD) must NOT
 * thin-pipe to generic core — that drops cad_generate and the model pastes .scad instead.
 * @param {{ routeKey?: string|null, taskType?: string|null, profileKey?: string|null }} [opts]
 */
export function surfaceSkipsProgressiveToolDiscovery(opts = {}) {
  const vals = [opts.routeKey, opts.taskType, opts.profileKey]
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean);
  for (const v of vals) {
    if (
      v === 'design_studio' ||
      v === 'design_studio_base' ||
      v === 'cad_generation' ||
      v.startsWith('design_studio') ||
      v.startsWith('cad_')
    ) {
      return true;
    }
  }
  return false;
}

/** Soft cap on hydrated schemas (Cursor MCP-shaped ceiling). */
export const PROGRESSIVE_HYDRATE_SOFT_MAX = 40;

/**
 * Progressive discovery eliminated — always false.
 * @param {unknown} [_mode]
 */
export function modeUsesProgressiveToolDiscovery(_mode) {
  return false;
}

/**
 * Allowlist is the D1 mode profile menu — never skip it for "progressive" modes.
 * @param {unknown} [_mode]
 */
export function modeSkipsToolPolicyAllowlist(_mode) {
  return false;
}

/**
 * @param {unknown} name
 */
export function isAgentsamSearchToolsName(name) {
  const n = String(name || '')
    .trim()
    .toLowerCase();
  return n === 'agentsam_search_tools' || n === 'search_tools';
}

/**
 * @param {unknown} t
 */
function toolNameOf(t) {
  return String(t?.name || t?.tool_key || t?.tool_name || t?.function?.name || '')
    .trim();
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
function inputSchemaFromRow(row) {
  if (row?.input_schema && typeof row.input_schema === 'object') {
    return Object.assign({ type: 'object', properties: {} }, row.input_schema, { type: 'object' });
  }
  if (row?.input_schema != null && String(row.input_schema).trim() !== '') {
    try {
      const parsed = JSON.parse(String(row.input_schema));
      if (parsed && typeof parsed === 'object') {
        return Object.assign({ type: 'object', properties: {} }, parsed, { type: 'object' });
      }
    } catch {
      /* fall through */
    }
  }
  return { type: 'object', properties: {} };
}

/**
 * Index compiled/catalog rows by wire name and tool_key (both must resolve).
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Map<string, Record<string, unknown>>}
 */
function rowsByName(rows) {
  /** @type {Map<string, Record<string, unknown>>} */
  const map = new Map();
  for (const r of rows || []) {
    const n = toolNameOf(r);
    if (n && !map.has(n)) map.set(n, r);
    const key = String(r?.tool_key || '').trim();
    if (key && !map.has(key)) map.set(key, r);
  }
  return map;
}

/** Wire schema when agentsam_search_tools is missing from D1 (fail-loud restore path). */
function syntheticSearchToolsCompiledRow() {
  return {
    name: 'agentsam_search_tools',
    tool_key: 'agentsam_search_tools',
    tool_name: 'agentsam_search_tools',
    description:
      'Discover Agent Sam catalog tools by capability, intent, category, or name. Prefer exact tool_key when known.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'Capability, intent, category, or exact tool_key to find',
        },
        intent: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 64 },
      },
      required: ['query'],
    },
    tool_category: 'agent.discovery',
    requires_approval: false,
    caller_policy: ['direct', 'programmatic'],
  };
}

/**
 * @param {Record<string, unknown>} row
 */
export function compiledRowFromAgentsamTool(row) {
  const name = String(row.tool_name || row.tool_key || row.name || '').trim();
  return {
    name,
    tool_key: String(row.tool_key || name),
    tool_name: name,
    description: String(row.description || name).slice(0, 4000),
    input_schema: inputSchemaFromRow(row),
    tool_category: String(row.tool_category || 'platform'),
    requires_approval: Number(row.requires_approval || 0) === 1,
    caller_policy: row.caller_policy != null ? row.caller_policy : null,
  };
}

/**
 * Wire-facing tool def from a compiled catalog row (preserve caller_policy for PTC).
 * @param {Record<string, unknown>} compiled
 */
export function wireToolFromCompiledRow(compiled) {
  return {
    name: compiled.name,
    description: compiled.description,
    input_schema: compiled.input_schema,
    tool_category: compiled.tool_category,
    requires_approval: compiled.requires_approval,
    caller_policy: compiled.caller_policy != null ? compiled.caller_policy : null,
    ...(compiled.tool_key ? { tool_key: compiled.tool_key } : {}),
  };
}

/**
 * @param {any} env
 * @param {string[]} names
 */
async function fetchToolRowsByNameOrKey(env, names) {
  if (!env?.DB || !names.length) return [];
  const placeholders = names.map(() => '?').join(',');
  try {
    const { results } = await env.DB.prepare(
      `SELECT tool_name, tool_key, description, input_schema, handler_config, tool_category, requires_approval,
              caller_policy
       FROM agentsam_tools
       WHERE COALESCE(is_active, 1) = 1
         AND (tool_name IN (${placeholders}) OR tool_key IN (${placeholders}))`,
    )
      .bind(...names, ...names)
      .all();
    return results || [];
  } catch (e) {
    console.warn('[progressive-tools] fetchToolRowsByNameOrKey', e?.message ?? e);
    return [];
  }
}

/**
 * Ensure core tools exist as compiled rows (fetch missing from catalog).
 * @param {any} env
 * @param {Array<Record<string, unknown>>} existingRows
 * @param {{ filesSource?: string|null }} [opts]
 */
export async function ensureProgressiveCoreCompiledRows(env, existingRows = [], opts = {}) {
  const coreKeys = await loadProgressiveCoreToolKeys(env, opts.filesSource);
  const byName = rowsByName(existingRows);
  const missing = coreKeys.filter((k) => !byName.has(k));
  if (missing.length && env?.DB) {
    const fetched = await fetchToolRowsByNameOrKey(env, missing);
    for (const row of fetched) {
      const compiled = compiledRowFromAgentsamTool(row);
      if (compiled.name) {
        if (!byName.has(compiled.name)) byName.set(compiled.name, compiled);
        const tk = String(compiled.tool_key || '').trim();
        if (tk && !byName.has(tk)) byName.set(tk, compiled);
      }
    }
  }
  // Catalog gap: progressive cores require search_tools; synthesize until D1 row exists.
  if (
    coreKeys.includes('agentsam_search_tools') &&
    !byName.has('agentsam_search_tools') &&
    !byName.has('search_tools')
  ) {
    const synth = syntheticSearchToolsCompiledRow();
    byName.set(synth.name, synth);
    console.warn(
      '[progressive-tools] search_tools_catalog_missing_synthetic',
      JSON.stringify({
        files_source: String(opts.filesSource || '').trim().toLowerCase() || null,
        note: 'agentsam_search_tools absent from agentsam_tools — wiring synthetic schema',
      }),
    );
  }
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  /** @type {string[]} */
  const stillMissing = [];
  for (const key of coreKeys) {
    const row = byName.get(key);
    if (!row) {
      stillMissing.push(key);
      continue;
    }
    out.push(row.name ? row : compiledRowFromAgentsamTool(row));
  }
  if (stillMissing.length) {
    console.warn(
      '[progressive-tools] core_keys_missing_from_catalog',
      JSON.stringify({
        files_source: String(opts.filesSource || '').trim().toLowerCase() || null,
        missing: stillMissing,
        wired: out.map((r) => String(r.name || r.tool_key || '')),
      }),
    );
  }
  return out;
}

/**
 * Apply progressive core compile: shrink schemas on wire; keep ceiling for telemetry.
 *
 * @param {any} env
 * @param {{
 *   mode: string,
 *   compiledToolRows: Array<Record<string, unknown>>,
 *   toolAllowlist: string[],
 *   routeKey?: string|null,
 *   taskType?: string|null,
 *   profileKey?: string|null,
 *   filesSource?: string|null,
 * }} input
 */
/**
 * No-op: progressive compile retired. Pass through D1 mode-profile tools unchanged.
 * @param {any} _env
 * @param {{
 *   mode?: string,
 *   compiledToolRows: Array<Record<string, unknown>>,
 *   toolAllowlist: string[],
 *   routeKey?: string|null,
 *   taskType?: string|null,
 *   profileKey?: string|null,
 *   filesSource?: string|null,
 * }} input
 */
export async function applyProgressiveCoreCompile(_env, input) {
  void _env;
  return {
    progressive: false,
    compiledToolRows: input.compiledToolRows || [],
    toolAllowlist: input.toolAllowlist || [],
    discoveryCeilingKeys: null,
  };
}

/**
 * Pull tool_key / tool_name values from agentsam_search_tools exec result.
 * @param {unknown} execResult
 * @returns {string[]}
 */
export function extractToolKeysFromSearchToolsResult(execResult) {
  /** @type {string[]} */
  const keys = [];
  const seen = new Set();
  const push = (raw) => {
    const k = String(raw || '').trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    keys.push(k);
  };

  const walkRow = (row) => {
    if (!row || typeof row !== 'object') return;
    const o = /** @type {Record<string, unknown>} */ (row);
    push(o.tool_key || o.tool_name || o.name);
  };

  if (execResult == null) return keys;
  if (typeof execResult === 'string') {
    try {
      return extractToolKeysFromSearchToolsResult(JSON.parse(execResult));
    } catch {
      return keys;
    }
  }
  if (Array.isArray(execResult)) {
    for (const row of execResult) walkRow(row);
    return keys;
  }
  if (typeof execResult === 'object') {
    const o = /** @type {Record<string, unknown>} */ (execResult);
    if (Array.isArray(o.rows)) for (const row of o.rows) walkRow(row);
    if (Array.isArray(o.results)) for (const row of o.results) walkRow(row);
    if (Array.isArray(o.tools)) for (const row of o.tools) walkRow(row);
    if (Array.isArray(o.data)) for (const row of o.data) walkRow(row);
    if (o.result && typeof o.result === 'object') {
      for (const k of extractToolKeysFromSearchToolsResult(o.result)) push(k);
    }
  }
  return keys;
}

/**
 * Append full schemas for discovered tool keys onto activeTools.
 * @param {any} env
 * @param {unknown[]} activeTools
 * @param {unknown} execResult
 * @param {{ softMax?: number, preferKeys?: string[], userMessage?: string, allowMediaTools?: boolean }} [opts]
 * @returns {Promise<{ tools: unknown[], added: string[] }>}
 */
function userMessageMentionsGithub(_userMessage) {
  return false;
}

function isGithubCatalogToolKey(key) {
  const k = String(key || '').trim().toLowerCase();
  return k.startsWith('agentsam_github_') || k === 'agentsam_repo_context';
}

export async function hydrateActiveToolsFromSearchResult(env, activeTools, execResult, opts = {}) {
  const softMax = Math.max(
    8,
    Math.floor(Number(opts.softMax) || PROGRESSIVE_HYDRATE_SOFT_MAX),
  );
  const list = Array.isArray(activeTools) ? [...activeTools] : [];
  const have = new Set(list.map((t) => toolNameOf(t)).filter(Boolean));
  const prefer = (Array.isArray(opts.preferKeys) ? opts.preferKeys : [])
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  const fromSearch = extractToolKeysFromSearchToolsResult(execResult);
  const allowMedia =
    opts.allowMediaTools === true ||
    userMessageAllowsMediaToolHydrate(opts.userMessage, {
      allowMediaTools: opts.allowMediaTools,
      imageAsk: opts.imageAsk,
    });
  const filesSourceNorm = String(opts.filesSource || '')
    .trim()
    .toLowerCase();
  const blockGithubHydrate =
    opts.fsaRoot === true ||
    filesSourceNorm === 'local' ||
    (Boolean(filesSourceNorm) && filesSourceNorm !== 'github');
  const blockFsHydrate = filesSourceNorm === 'github';

  /** Prefer keys win so exact user-named tools beat noisy MCP list_* ranking. */
  const wanted = [];
  const deferredMedia = [];
  const seenWanted = new Set();
  for (const k of [...prefer, ...fromSearch]) {
    if (!k || have.has(k) || seenWanted.has(k)) continue;
    seenWanted.add(k);
    if (blockFsHydrate && String(k).toLowerCase().startsWith('fs_')) {
      continue;
    }
    if (blockGithubHydrate && isGithubCatalogToolKey(k) && !prefer.includes(k)) {
      continue;
    }
    if (isMediaGenerationToolKey(k) && !allowMedia) {
      deferredMedia.push(k);
      continue;
    }
    wanted.push(k);
  }
  // Media last (and only if room remains after non-media) when not explicitly allowed.
  if (allowMedia) {
    for (const k of deferredMedia) wanted.push(k);
  } else if (deferredMedia.length) {
    console.info(
      '[progressive-tools] media_hydrate_deferred',
      JSON.stringify({ deferred: deferredMedia.slice(0, 12), reason: 'non_media_user_message' }),
    );
  }
  if (!wanted.length || !env?.DB) {
    return { tools: list, added: [] };
  }

  const room = Math.max(0, softMax - list.length);
  const slice = wanted.slice(0, room);
  if (!slice.length) {
    console.info(
      '[progressive-tools] hydrate_skip_at_cap',
      JSON.stringify({ soft_max: softMax, active: list.length, wanted: wanted.length }),
    );
    return { tools: list, added: [] };
  }

  const rows = await fetchToolRowsByNameOrKey(env, slice);
  /** @type {string[]} */
  const added = [];
  for (const row of rows) {
    const compiled = compiledRowFromAgentsamTool(row);
    const nm = compiled.name;
    if (!nm || have.has(nm)) continue;
    if (list.length >= softMax) break;
    have.add(nm);
    added.push(nm);
    list.push(wireToolFromCompiledRow(compiled));
  }

  if (added.length) {
    console.info(
      '[progressive-tools] hydrated',
      JSON.stringify({ added, active_tools: list.length, soft_max: softMax }),
    );
  }
  return { tools: list, added };
}

/**
 * Shared media-hydrate judgment — same family as hasImageGenerationIntent / image-intent-gate.
 * opts.allowMediaTools / opts.imageAsk from the turn spine always win (session-cache safe).
 * @param {string|null|undefined} userMessage
 * @param {{ allowMediaTools?: boolean, imageAsk?: boolean }} [opts]
 */
export function userMessageAllowsMediaToolHydrate(_userMessage, opts = {}) {
  // Explicit UI / spine pin only — no message regex media hydrate.
  return opts.allowMediaTools === true || opts.imageAsk === true;
}

/**
 * @param {string} key
 */
export function isMediaGenerationToolKey(key) {
  return /^(imgx_|veo_|moviemode_)/i.test(String(key || '').trim());
}

/**
 * Pin full schemas for tools the user named in the message (progressive thin pipe).
 * Without this, search_tools ranking often hydrates MCP noise and never surfaces the
 * exact key (e.g. agentsam_github_list_commits), so the model claims it is unavailable.
 * @param {any} env
 * @param {unknown[]} activeTools
 * @param {string[]} names
 * @param {{ softMax?: number }} [opts]
 * @returns {Promise<{ tools: unknown[], added: string[] }>}
 */
export async function hydrateNamedCatalogTools(env, activeTools, names, opts = {}) {
  const softMax = Math.max(
    8,
    Math.floor(Number(opts.softMax) || PROGRESSIVE_HYDRATE_SOFT_MAX),
  );
  const list = Array.isArray(activeTools) ? [...activeTools] : [];
  const have = new Set(list.map((t) => toolNameOf(t)).filter(Boolean));
  const wanted = (Array.isArray(names) ? names : [])
    .map((k) => String(k || '').trim())
    .filter((k) => k && !have.has(k));
  if (!wanted.length || !env?.DB) {
    return { tools: list, added: [] };
  }
  const room = Math.max(0, softMax - list.length);
  const slice = wanted.slice(0, room);
  if (!slice.length) return { tools: list, added: [] };

  const rows = await fetchToolRowsByNameOrKey(env, slice);
  /** @type {string[]} */
  const added = [];
  for (const row of rows) {
    const compiled = compiledRowFromAgentsamTool(row);
    const nm = compiled.name;
    if (!nm || have.has(nm)) continue;
    if (list.length >= softMax) break;
    have.add(nm);
    added.push(nm);
    list.push(wireToolFromCompiledRow(compiled));
  }
  if (added.length) {
    console.info(
      '[progressive-tools] named_pin',
      JSON.stringify({ added, active_tools: list.length, soft_max: softMax }),
    );
  }
  return { tools: list, added };
}

/** True when the user message cites a platform ticket id. */
export function userMessageReferencesTicketId(userMessage) {
  return /\btkt_[a-z0-9_]+\b/i.test(String(userMessage || ''));
}

/**
 * Per-turn pin: ticket id in the message → ticket_get + d1_query on the wire menu.
 * @param {any} env
 * @param {unknown[]} activeTools
 * @param {{ userMessage?: string|null, softMax?: number }} [opts]
 */
export async function pinTicketInspectToolsForTurn(env, activeTools, opts = {}) {
  if (!userMessageReferencesTicketId(opts.userMessage) || !env?.DB) {
    return {
      tools: Array.isArray(activeTools) ? activeTools : [],
      added: [],
      pinned: false,
    };
  }
  const pinned = await hydrateNamedCatalogTools(env, activeTools, [...TICKET_INSPECT_PIN_TOOL_KEYS], {
    softMax: opts.softMax,
  });
  if (pinned.added.length) {
    console.info(
      '[progressive-tools] ticket_pin',
      JSON.stringify({ added: pinned.added, active_tools: pinned.tools.length }),
    );
  }
  return { ...pinned, pinned: pinned.added.length > 0 };
}

/**
 * Per-turn pin: session-cached core menus still get imgx when this message is a visual ask.
 * Works for old conversations without forceRefresh of session context.
 * @param {any} env
 * @param {unknown[]} activeTools
 * @param {{
 *   userMessage?: string|null,
 *   imageAsk?: boolean,
 *   allowMediaTools?: boolean,
 *   softMax?: number,
 * }} [opts]
 */
export async function pinImageGenerationToolsForTurn(env, activeTools, opts = {}) {
  const allow = userMessageAllowsMediaToolHydrate(opts.userMessage, opts);
  if (!allow || !env?.DB) {
    return {
      tools: Array.isArray(activeTools) ? activeTools : [],
      added: [],
      pinned: false,
    };
  }
  const pinned = await hydrateNamedCatalogTools(env, activeTools, [...IMAGE_GENERATION_PIN_TOOL_KEYS], {
    softMax: opts.softMax,
  });
  const hasImgx = pinned.tools.some((t) => toolNameOf(t) === 'imgx_generate_image');
  if (pinned.added.length) {
    console.info(
      '[progressive-tools] image_pin',
      JSON.stringify({ added: pinned.added, active_tools: pinned.tools.length }),
    );
  }
  return { ...pinned, pinned: hasImgx };
}
