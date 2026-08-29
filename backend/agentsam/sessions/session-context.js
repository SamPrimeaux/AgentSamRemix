/**
 * Session-scoped agent context — tools + write_policy + roots cached on AgentChatSqlV1.
 * Bootstrap once; chat messages reuse. No per-turn profile/classify.
 *
 * LAW: never dump full oauth_visible (~100+) into the in-app model loop —
 * that hangs the Worker after the first tool_call (CPU/stream death).
 * Catalog discovery stays OAuth/MCP-sized; in-app session uses a working spine.
 *
 * SSOT: the in-app tool menu is agentsam_tool_profile_bindings (task_type -> profile_key)
 * joined to agentsam_tool_profiles (tool_keys_json). Editing the menu is a D1 UPDATE,
 * not a code deploy. Missing binding/profile → empty tools + loud warn (no JS menu).
 */
import { inputSchemaFromAgentsamToolRow } from '../../../src/core/agentsam-tools-catalog.js';
import {
  loadExecutableHandlerTypes,
  validateHandlerConfigForExecution,
  EXECUTABLE_HANDLER_TYPES,
} from '../../../src/core/agentsam-tools-catalog.js';
import { parseHandlerConfig } from '../../credentials/resolver.js';
import { normalizeAgentRuntimeMode } from '../runtime/mode.js';
import { parseWritePolicyJson, parseRuntimePolicyJson } from '../../../src/core/d1-tool-profile.js';
import { sealWritePolicyForMode } from '../../../shared/agent-runtime/mode-write-gate.js';
import { resolveSessionProfileTaskType } from '../../../src/core/session-profile-task.js';
import { isDesignModeActiveFromBody } from '../../../src/core/design-mode-context.js';
import { RUNTIME_PROFILE_VERSION } from '../../../src/core/runtime-profile.types.js';
import {
  computeToolManifestHash,
  resolveAgentSamBootstrap,
  resolveToolCatalogGeneration,
  readManifestGenerationStamps,
  warmCatalogGenerationStamp,
  warmProfileGenerationStamp,
} from '../../../src/core/bootstrap-service-bridge.js';

export { resolveSessionProfileTaskType } from '../../../src/core/session-profile-task.js';
export { isDesignModeActiveFromBody, isDesignModeBrowserContext } from '../../../src/core/design-mode-context.js';

/** Soft cap — above this, DO cache is treated as stale mega-catalog and rebuilt. */
/** Soft ceiling for session tool cache (D1 composer_* menus; was 12 under progressive). */
export const SESSION_TOOL_CACHE_SOFT_MAX = 64;
/**
 * DO session cache contract version.
 * v32: session DO pins — allowlist_key_set + session_grants (policy-hash scoped).
 * v31: cheap manifest stamp gate — KV actor/catalog/profile generations before D1/bootstrap.
 * v30: tool_manifest_hash gate — actor authority + catalog generation + profile identity.
 * v28: roots.local drops fake workspace_pty — fs_* without FSA = terminal_exec
 * (agentsam_terminal_* / ExecOS), not a separate product lane.
 * v27: cache reuse = D1 profile_key/revision/hash + mode/files_source only —
 * no JS hard-required tool_key names (contradicts D1 per-mode menu law).
 * v26: stop requiring agentsam_cf_d1_list for session cache (off composer menus).
 * v25: no github Files-rail menu partition (fs+github+deploy stay on composer_*).
 * v24: roots.local (+ github/r2/drive/container lane objects) + always-on roots log.
 * v23: dump buildSessionRuntimeProfile — bootstrap via resolveRuntimeProfile;
 * stamp profile_hash + RUNTIME_PROFILE_VERSION; gate cacheUsable on both.
 */
export const SESSION_CONTEXT_VERSION = 32;

/**
 * Normalize github repo bind for roots.github.repo (string slug or null).
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeGithubRepoRoot(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    return s || null;
  }
  if (typeof raw === 'object') {
    const o = /** @type {{ full_name?: unknown, repo?: unknown, name?: unknown }} */ (raw);
    const s = String(o.full_name || o.repo || o.name || '').trim();
    return s || null;
  }
  const s = String(raw).trim();
  return s || null;
}

/**
 * Always-on roots proof for wrangler tail. files_source = UI preferred rail,
 * not an exclusive capability lock (exclusive_rail always false in this log).
 * @param {'bootstrap'|'cache_hit'} phase
 * @param {string} conversationId
 * @param {Record<string, unknown>} roots
 * @param {Record<string, unknown>} [extra]
 */
function logSessionRoots(phase, conversationId, roots, extra = {}) {
  const local = roots?.local && typeof roots.local === 'object' ? roots.local : {};
  const github = roots?.github && typeof roots.github === 'object' ? roots.github : {};
  const r2 = roots?.r2 && typeof roots.r2 === 'object' ? roots.r2 : {};
  const drive = roots?.drive && typeof roots.drive === 'object' ? roots.drive : {};
  const container =
    roots?.container && typeof roots.container === 'object' ? roots.container : {};
  console.info(
    '[agent-session-context] roots',
    JSON.stringify({
      phase,
      conversationId,
      files_source: roots?.files_source || null,
      files_source_path: roots?.files_source_path || null,
      // Preferred Files-rail tab — never means "only these tools".
      exclusive_rail: false,
      local: {
        fsa_connected: local.fsa_connected === true,
        folder: local.folder ?? null,
      },
      // How fs_* runs this turn — not a product tool name.
      // client_fs = browser FSA; terminal_exec = agentsam_terminal_* / ExecOS fabric.
      fs_transport: roots?.fs_transport || null,
      github: {
        repo: github.repo ?? null,
        bound: Boolean(github.repo),
      },
      r2: {
        bucket: r2.bucket ?? null,
        prefix: r2.prefix ?? null,
        bound: Boolean(r2.bucket),
      },
      drive: { bound: drive.bound === true },
      // Files-rail sandbox tab (not the same as agentsam_terminal_sandbox tool).
      container: { bound: container.bound === true },
      active_file_source: roots?.source || null,
      path: roots?.path || null,
      ...extra,
    }),
  );
}

/**
 * Persist compiler output without duplicating tool rows (those live in tools_json).
 * @param {Record<string, unknown>} profile
 */
function profileSnapshotForCache(profile) {
  const snap = { ...(profile && typeof profile === 'object' ? profile : {}) };
  delete snap._compiled_tool_rows;
  delete snap._prompt_route_row;
  return snap;
}

/**
 * Rebuild RuntimeProfile from DO cache (deserialize only — no D1 invent).
 * @param {unknown[]} tools
 * @param {Record<string, unknown>|null|undefined} writePolicy
 * @param {Record<string, unknown>|null|undefined} roots
 */
function hydrateRuntimeProfileFromCache(tools, writePolicy, roots) {
  const snap =
    roots?.runtime_profile && typeof roots.runtime_profile === 'object'
      ? { ...roots.runtime_profile }
      : null;
  if (!snap) return null;
  const toolRows = Array.isArray(tools) ? tools : [];
  const allowlist = toolRows
    .map((t) => String(t?.name || t?.tool_name || t?.tool_key || '').trim())
    .filter(Boolean);
  return {
    ...snap,
    write_policy:
      writePolicy && typeof writePolicy === 'object' ? writePolicy : snap.write_policy || {},
    tool_allowlist: allowlist.length ? allowlist : Array.isArray(snap.tool_allowlist) ? snap.tool_allowlist : [],
    _compiled_tool_rows: toolRows,
    profile_hash: String(roots?.profile_hash || snap.profile_hash || '').trim(),
    profile_version: Number(roots?.profile_version) || snap.profile_version || RUNTIME_PROFILE_VERSION,
    source: {
      ...(snap.source && typeof snap.source === 'object' ? snap.source : {}),
      compile_lane: 'session_context',
      session_scoped: true,
      cached: true,
    },
  };
}

/**
 * Session write policy: D1 write_policy_json via caller, sealed by mode.
 * No JS invent-writable defaults — missing policy fail-closed.
 * @param {string} mode
 * @param {Record<string, unknown>|null|undefined} [d1WritePolicy]
 */
export function writePolicyFromComposerMode(mode, d1WritePolicy = null) {
  return sealWritePolicyForMode(normalizeAgentRuntimeMode(mode), d1WritePolicy || {});
}

/**
 * @param {string} mode
 */
export function modeControllerForComposerMode(mode) {
  const m = normalizeAgentRuntimeMode(mode);
  if (m === 'ask') return { mode_controller: 'ask_controller' };
  if (m === 'plan') return { mode_controller: 'plan_controller' };
  if (m === 'debug') return { mode_controller: 'debug_controller' };
  if (m === 'multitask') return { mode_controller: 'multitask_controller' };
  return { mode_controller: 'agent_controller' };
}

function parseJsonArraySafe(raw, fallback = []) {
  if (raw == null || raw === '') return fallback;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.map((x) => String(x).trim()).filter(Boolean) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * D1-SSOT profile lookup: task_type (composer mode) -> profile_key -> tool_keys_json.
 * Falls back to profile_key='default_route', then null (caller returns empty tools).
 * @param {unknown} db
 * @param {string} composerMode
 */
export async function loadToolProfileForMode(db, composerMode) {
  if (!db?.prepare) return null;
  const mode = String(composerMode || '').trim().toLowerCase();
  if (!mode) return null;
  try {
    const row = await db
      .prepare(
        `SELECT p.profile_key, p.tool_keys_json, p.max_tools, p.write_policy_json,
                p.runtime_policy_json,
                p.updated_at AS profile_updated_at, b.updated_at AS binding_updated_at,
                b.force_first_tool AS force_first_tool
         FROM agentsam_tool_profile_bindings b
         JOIN agentsam_tool_profiles p ON p.profile_key = b.profile_key AND COALESCE(p.is_active, 1) = 1
         WHERE b.task_type = ? AND COALESCE(b.is_active, 1) = 1
         ORDER BY b.priority ASC
         LIMIT 1`,
      )
      .bind(mode)
      .first()
      .catch(() => null);
    if (row) {
      return {
        profile_key: row.profile_key,
        tool_keys: parseJsonArraySafe(row.tool_keys_json, []),
        max_tools: Number(row.max_tools) > 0 ? Number(row.max_tools) : SESSION_TOOL_CACHE_SOFT_MAX,
        write_policy: parseWritePolicyJson(row.write_policy_json),
        runtime_policy: parseRuntimePolicyJson(row.runtime_policy_json),
        force_first_tool: String(row.force_first_tool || '').trim() || null,
        profile_revision: `${Number(row.binding_updated_at) || 0}:${Number(row.profile_updated_at) || 0}`,
      };
    }
  } catch (e) {
    console.warn('[agent-session-context] profile_binding_query_failed', mode, e?.message ?? e);
  }

  // Named binding missing — try the explicit default_route profile before giving up.
  try {
    const row = await db
      .prepare(
        `SELECT profile_key, tool_keys_json, max_tools, write_policy_json, runtime_policy_json, updated_at
         FROM agentsam_tool_profiles
         WHERE profile_key = 'default_route' AND COALESCE(is_active, 1) = 1
         LIMIT 1`,
      )
      .first()
      .catch(() => null);
    const keys = parseJsonArraySafe(row?.tool_keys_json, []);
    if (row && keys.length) {
      return {
        profile_key: row.profile_key,
        tool_keys: keys,
        max_tools: Number(row.max_tools) > 0 ? Number(row.max_tools) : SESSION_TOOL_CACHE_SOFT_MAX,
        write_policy: parseWritePolicyJson(row.write_policy_json),
        runtime_policy: parseRuntimePolicyJson(row.runtime_policy_json),
        profile_revision: `default:${Number(row.updated_at) || 0}`,
      };
    }
  } catch (e) {
    console.warn('[agent-session-context] default_route_query_failed', e?.message ?? e);
  }

  return null;
}

/**
 * @param {unknown} env Worker env bindings (needs env.DB, optionally env.SESSION_CACHE)
 * @param {string} composerMode
 * @returns {Promise<{ tools: unknown[], profile_key: string|null, profile_task_type: string }>}
 */
export async function loadOauthVisibleToolsForSession(env, composerMode, resolvedProfile = null) {
  const db = env?.DB ?? env; // back-compat: earlier signature took `db` directly
  const profileTaskType = String(composerMode || 'agent').trim().toLowerCase() || 'agent';
  if (!db?.prepare) {
    return { tools: [], profile_key: null, profile_task_type: profileTaskType };
  }

  const profile = resolvedProfile || await loadToolProfileForMode(db, profileTaskType);
  let keys = profile?.tool_keys?.length ? profile.tool_keys : null;
  const maxTools = profile?.max_tools || SESSION_TOOL_CACHE_SOFT_MAX;

  if (!keys) {
    console.warn(
      '[agent-session-context] profile_lookup_failed_no_fallback',
      JSON.stringify({ composerMode: profileTaskType, reason: 'no_active_binding_or_profile' }),
    );
    return { tools: [], profile_key: profile?.profile_key || null, profile_task_type: profileTaskType };
  }

  const placeholders = keys.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT tool_key, tool_name, description, input_schema, handler_config, tool_category,
              handler_type, requires_approval, risk_level, modes_json
       FROM agentsam_tools
       WHERE COALESCE(is_active, 1) = 1
         AND COALESCE(is_degraded, 0) = 0
         AND (tool_key IN (${placeholders}) OR tool_name IN (${placeholders}))
       ORDER BY COALESCE(sort_priority, 50) ASC, tool_name ASC
       LIMIT ?`,
    )
    .bind(...keys, ...keys, Math.min(maxTools, SESSION_TOOL_CACHE_SOFT_MAX))
    .all()
    .catch(() => ({ results: [] }));

  const executableTypes = await loadExecutableHandlerTypes(env?.DB ? env : { DB: db }).catch(
    () => EXECUTABLE_HANDLER_TYPES,
  );
  const { toolAllowsExecutionMode } = await import('../../../src/core/mode-tool-ceiling.js');

  const byKey = new Map();
  for (const row of results || []) {
    const name = String(row.tool_name || row.tool_key || '').trim();
    if (!name) continue;
    const key = String(row.tool_key || name).trim();

    // Mode ceiling: do not offer tools the execution mode cannot run.
    if (!toolAllowsExecutionMode(row.modes_json, profileTaskType)) {
      continue;
    }

    // Fail closed: no executor branch for this handler_type -> never offer it to the model.
    const cfg = parseHandlerConfig(row.handler_config);
    const v = validateHandlerConfigForExecution(row, cfg, executableTypes || EXECUTABLE_HANDLER_TYPES);
    if (!v.ok) {
      console.warn('[agent-session-context] skip_unexecutable_tool', key, v.error);
      continue;
    }

    byKey.set(key, {
      name,
      tool_name: name,
      tool_key: key,
      description: String(row.description || name).slice(0, 4000),
      input_schema: inputSchemaFromAgentsamToolRow(row),
      tool_category: row.tool_category != null ? String(row.tool_category) : null,
      handler_type: row.handler_type != null ? String(row.handler_type).trim() : null,
      requires_approval: Number(row.requires_approval || 0) === 1,
      risk_level: row.risk_level != null ? String(row.risk_level) : null,
      modes_json: row.modes_json != null ? String(row.modes_json) : null,
    });
  }

  // Preserve D1 profile key order for stable model menus.
  const ordered = [];
  for (const k of keys) {
    const hit = byKey.get(k) || [...byKey.values()].find((t) => t.name === k || t.tool_key === k);
    if (hit && !ordered.some((t) => t.tool_key === hit.tool_key)) {
      ordered.push(hit);
    }
  }
  return {
    tools: ordered,
    profile_key: profile?.profile_key || null,
    profile_task_type: profileTaskType,
    write_policy: profile?.write_policy || {},
    runtime_policy: profile?.runtime_policy || parseRuntimePolicyJson(null),
    profile_revision: profile?.profile_revision || null,
    force_first_tool: profile?.force_first_tool || null,
  };
}

/**
 * @param {unknown} env
 * @param {string} conversationId
 */
export function getAgentSessionStub(env, conversationId) {
  if (!env?.AGENT_SESSION) return null;
  const convId = String(conversationId || '').trim();
  if (!convId) return null;
  return env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(convId));
}

/**
 * @param {any} stub
 * @param {unknown} tools
 * @param {unknown} writePolicy
 * @param {unknown} roots
 */
export async function doSetSessionContext(stub, tools, writePolicy, roots) {
  if (!stub) return { ok: false, reason: 'no_stub' };
  if (typeof stub.setSessionContext === 'function') {
    return stub.setSessionContext(tools, writePolicy, roots);
  }
  const resp = await stub.fetch(
    new Request('https://do/session-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tools, writePolicy, roots }),
    }),
  );
  if (!resp.ok) return { ok: false, reason: `do_${resp.status}` };
  return resp.json().catch(() => ({ ok: true }));
}

/**
 * @param {any} stub
 */
export async function doGetSessionContext(stub) {
  if (!stub) return null;
  if (typeof stub.getSessionContext === 'function') {
    return stub.getSessionContext();
  }
  const resp = await stub.fetch(new Request('https://do/session-context', { method: 'GET' }));
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => null);
  if (!data || data.empty) return null;
  return data;
}

/**
 * History + session context + optional codemode in a single DO roundtrip.
 * @param {any} env
 * @param {string} conversationId
 * @param {Record<string, unknown>} [opts]
 */
export async function bootstrapAgentSession(env, conversationId, opts = {}) {
  const stub = getAgentSessionStub(env, conversationId);
  if (!stub) return null;
  if (typeof stub.bootstrapTurn === 'function') {
    return stub.bootstrapTurn(opts);
  }
  const resp = await stub.fetch(
    new Request('https://do/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts || {}),
    }),
  );
  if (!resp?.ok) return null;
  return resp.json().catch(() => null);
}

/**
 * @param {any} env
 * @param {string} conversationId
 * @param {string} [reason]
 */
export async function cancelPendingFsaForConversation(env, conversationId, reason = 'stream_canceled') {
  const stub = getAgentSessionStub(env, conversationId);
  if (!stub) return { cancelled: 0 };
  if (typeof stub.cancelPendingFsaRequests === 'function') {
    return stub.cancelPendingFsaRequests(reason);
  }
  const resp = await stub.fetch(
    new Request('https://do/fsa/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }),
  );
  if (!resp?.ok) return { cancelled: 0 };
  return resp.json().catch(() => ({ cancelled: 0 }));
}

/**
 * @param {any} stub
 * @param {string} callId
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function doWaitForFsaFulfill(stub, callId, opts = {}) {
  if (!stub) throw new Error('fsa_no_session_do');
  if (typeof stub.waitForFsaFulfill === 'function') {
    return stub.waitForFsaFulfill(callId, opts);
  }
  const resp = await stub.fetch(
    new Request('https://do/fsa/wait', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId, timeoutMs: opts.timeoutMs ?? 90000 }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }),
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `fsa_wait_${resp.status}`);
  }
  return resp.json();
}

/**
 * @param {any} stub
 * @param {string} callId
 * @param {unknown} result
 */
export async function doFulfillFsaRequest(stub, callId, result) {
  if (!stub) return { ok: false, reason: 'no_stub' };
  if (typeof stub.fulfillFsaRequest === 'function') {
    return stub.fulfillFsaRequest(callId, result);
  }
  const resp = await stub.fetch(
    new Request('https://do/fsa/fulfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId, result }),
    }),
  );
  if (!resp.ok) return { ok: false, reason: `do_${resp.status}` };
  return resp.json().catch(() => ({ ok: true }));
}

/**
 * @param {unknown} env
 * @param {{
 *   conversationId: string,
 *   mode: string,
 *   workspaceId?: string|null,
 *   userId?: string|null,
 *   tenantId?: string|null,
 *   message?: string|null,
 *   turnDecision?: unknown,
 *   body?: Record<string, unknown>,
 *   activeFileEnvelope?: Record<string, unknown>|null,
 *   forceRefresh?: boolean,
 * }} opts
 */
export async function loadOrBootstrapSessionContext(env, opts) {
  const conversationId = String(opts.conversationId || '').trim();
  const mode = normalizeAgentRuntimeMode(opts.mode);
  const composerMode = mode;
  let profileTaskType = resolveSessionProfileTaskType(composerMode, opts.body);
  const stub = getAgentSessionStub(env, conversationId);
  const requestedRouteKey = String(
    opts.body?.route_key || opts.body?.routeKey || '',
  ).trim().toLowerCase();
  const requestedTaskType = String(opts.body?.task_type || opts.body?.taskType || '')
    .trim()
    .toLowerCase();
  const designModeActive = isDesignModeActiveFromBody(opts.body || null);
  const explicitProfileHint =
    requestedTaskType !== '' ||
    designModeActive ||
    profileTaskType === 'design_mode' ||
    (requestedRouteKey !== '' &&
      requestedRouteKey !== 'auto' &&
      requestedRouteKey !== composerMode);

  const truthyFlag = (v) =>
    v === true || v === 1 || v === '1' || String(v || '').trim().toLowerCase() === 'true';
  const filesSourceForSession = String(
    opts.body?.files_source || opts.body?.filesSource || '',
  )
    .trim()
    .toLowerCase();
  const filesSourcePath = String(
    opts.body?.files_source_path || opts.body?.filesSourcePath || '',
  ).trim() || null;
  const r2Bucket =
    String(opts.body?.files_r2_bucket || opts.body?.filesR2Bucket || '').trim() || null;
  const r2Prefix =
    String(opts.body?.files_r2_prefix || opts.body?.filesR2Prefix || '').trim() || null;
  const fsaConnected =
    truthyFlag(opts.body?.local_fsa_connected) ||
    truthyFlag(opts.body?.fsa_root) ||
    String(opts.activeFileEnvelope?.source || '').toLowerCase() === 'local' ||
    String(opts.body?.active_file_source || '').toLowerCase() === 'local';
  const githubRepoRaw =
    opts.activeFileEnvelope?.github_repo ||
    opts.body?.selectedGithubRepoContext ||
    opts.body?.github_repo_context ||
    null;
  const githubRepo = normalizeGithubRepoRoot(githubRepoRaw);
  // roots.local = Files-rail Local (FSA) bind only. When FSA is off, fs_* still
  // runs via the terminal/ExecOS fabric (agentsam_terminal_local|remote|sandbox) —
  // never invent a "workspace_pty" product lane.
  const localFolder =
    filesSourceForSession === 'local'
      ? filesSourcePath
      : String(opts.body?.local_folder || opts.body?.localFolder || '').trim() || null;
  const fsTransport = fsaConnected ? 'client_fs' : 'terminal_exec';
  const roots = {
    // Flat compat (existing consumers / fs-transport).
    fsa_root: fsaConnected,
    source: opts.activeFileEnvelope?.source || opts.body?.active_file_source || null,
    path:
      opts.activeFileEnvelope?.path ||
      opts.activeFileEnvelope?.workspace_path ||
      opts.body?.active_file_path ||
      null,
    github_repo: githubRepoRaw,
    workspace_id: opts.workspaceId || null,
    profile_task_type: profileTaskType,
    route_key: requestedRouteKey || null,
    files_source: filesSourceForSession || null,
    files_source_path: filesSourcePath,
    context_version: SESSION_CONTEXT_VERSION,
    fs_transport: fsTransport,
    // Preferred binds — not exclusive locks; D1 composer_* owns the tool menu.
    local: {
      fsa_connected: fsaConnected,
      folder: localFolder,
    },
    github: {
      repo: githubRepo,
    },
    r2: {
      bucket: r2Bucket,
      prefix: r2Prefix,
    },
    drive: {
      bound: filesSourceForSession === 'drive',
    },
    container: {
      bound: filesSourceForSession === 'container',
    },
  };

  let cachedSessionContext = null;
  if (stub && !opts.forceRefresh) {
    const cached = await doGetSessionContext(stub).catch(() => null);
    cachedSessionContext = cached;
    const cachedCount = Array.isArray(cached?.tools) ? cached.tools.length : 0;
    const cachedProfileTask =
      String(cached?.roots?.profile_task_type || cached?.profile_task_type || '').trim().toLowerCase();
    const cachedContextVersion = Number(cached?.roots?.context_version || 0);
    // Drop cached design_mode when Browser Design Mode is off; otherwise sticky cache
    // would keep the UI-edit kit after the user toggles Design Mode off.
    if (cachedProfileTask === 'design_mode' && !designModeActive && profileTaskType !== 'design_mode') {
      /* keep freshly resolved profileTaskType */
    } else if (!explicitProfileHint && cachedProfileTask) {
      profileTaskType = cachedProfileTask;
      roots.profile_task_type = cachedProfileTask;
      roots.route_key = cached?.roots?.route_key || null;
    }
    if (designModeActive) {
      profileTaskType = 'design_mode';
      roots.profile_task_type = 'design_mode';
    }

    const cachedProfileKey = String(cached?.roots?.profile_key || '').trim();
    const cachedProfileRevision = String(cached?.roots?.profile_revision || '').trim();
    const cachedProfileHash = String(cached?.roots?.profile_hash || '').trim();
    const cachedProfileVersion = Number(cached?.roots?.profile_version || 0);
    const cachedManifestHash = String(cached?.roots?.tool_manifest_hash || '').trim();
    const cachedCatalogGeneration = String(cached?.roots?.catalog_generation || '').trim();
    const cachedProfileGeneration = String(cached?.roots?.profile_generation || '').trim();
    const cachedActorContextHash = String(cached?.roots?.actor_context_hash || '').trim();
    const staleProgressiveCache = cached?.roots?.progressive_tool_discovery === true;
    const cachedFilesSource = String(cached?.roots?.files_source || '')
      .trim()
      .toLowerCase();
    const filesSourceMismatch = cachedFilesSource !== (filesSourceForSession || '');
    const hasCompilerStamp =
      cachedProfileHash.length > 0 &&
      cachedProfileVersion === RUNTIME_PROFILE_VERSION &&
      cached?.roots?.runtime_profile &&
      typeof cached.roots.runtime_profile === 'object';

    const cheapCacheEligible =
      cached &&
      cachedCount > 0 &&
      cachedCount <= SESSION_TOOL_CACHE_SOFT_MAX &&
      cachedContextVersion === SESSION_CONTEXT_VERSION &&
      hasCompilerStamp &&
      String(cached.mode || '') === composerMode &&
      cachedProfileTask === profileTaskType &&
      !staleProgressiveCache &&
      !filesSourceMismatch &&
      cachedManifestHash.length > 0 &&
      cachedCatalogGeneration.length > 0 &&
      cachedProfileGeneration.length > 0;

    if (cheapCacheEligible && opts.userId && opts.workspaceId) {
      const stamps = await readManifestGenerationStamps(env, {
        userId: String(opts.userId).trim(),
        workspaceId: String(opts.workspaceId).trim(),
        profileTaskType,
      });
      const stampMatch =
        stamps.catalogGeneration === cachedCatalogGeneration &&
        stamps.profileGeneration === cachedProfileGeneration &&
        (!cachedActorContextHash || stamps.actorContextHash === cachedActorContextHash);
      if (stampMatch) {
        const cachedTools = cached.tools;
        const mergedRoots = {
          ...(cached.roots || {}),
          ...roots,
          progressive_tool_discovery: false,
          profile_hash: cachedProfileHash,
          profile_version: RUNTIME_PROFILE_VERSION,
          runtime_profile: cached.roots.runtime_profile,
        };
        const runtimeProfile = hydrateRuntimeProfileFromCache(
          cachedTools,
          cached.writePolicy,
          mergedRoots,
        );
        if (runtimeProfile?.profile_hash) {
          if (JSON.stringify(mergedRoots) !== JSON.stringify(cached.roots || {})) {
            await doSetSessionContext(stub, cachedTools, cached.writePolicy, mergedRoots).catch(
              () => {},
            );
          }
          const toolCount = Array.isArray(cachedTools) ? cachedTools.length : cachedCount;
          console.info(
            '[agent-session-context] cache_hit_stamps',
            JSON.stringify({
              conversationId,
              tools: toolCount,
              mode: composerMode,
              catalog_generation: stamps.catalogGeneration,
              profile_generation: stamps.profileGeneration.slice(0, 24),
            }),
          );
          logSessionRoots('cache_hit_stamps', conversationId, mergedRoots, {
            tools: toolCount,
            mode: composerMode,
          });
          return {
            tools: cachedTools,
            writePolicy: cached.writePolicy || writePolicyFromComposerMode(composerMode),
            runtimePolicy:
              cached?.roots?.runtime_policy && typeof cached.roots.runtime_policy === 'object'
                ? cached.roots.runtime_policy
                : parseRuntimePolicyJson(null),
            runtimeProfile,
            roots: mergedRoots,
            mode: composerMode,
            profile_task_type: profileTaskType,
            profile_key: cached?.roots?.profile_key || null,
            fromCache: true,
          };
        }
      }
    }

    const currentProfile = await loadToolProfileForMode(env?.DB, profileTaskType);
    const currentProfileKey = String(currentProfile?.profile_key || '').trim();
    const currentProfileRevision = String(currentProfile?.profile_revision || '').trim();
    const currentProfileHash = String(currentProfile?.profile_hash || '').trim();
    const catalogGeneration = await resolveToolCatalogGeneration(env);
    let actorContextHash = '';
    let actorPolicyHash = '';
    if (opts.userId && opts.workspaceId) {
      const boot = await resolveAgentSamBootstrap(env, {
        userId: String(opts.userId).trim(),
        requestedWorkspaceId: String(opts.workspaceId).trim(),
      }).catch(() => null);
      if (boot?.ok) {
        actorContextHash = String(boot.context_hash || '').trim();
        actorPolicyHash = String(boot.policy_hash || '').trim();
      }
    }
    const currentToolManifestHash = await computeToolManifestHash({
      actorContextHash,
      actorPolicyHash,
      toolProfileHash: currentProfileHash,
      toolProfileRevision: currentProfileRevision,
      catalogGeneration,
      runtimeProfileVersion: RUNTIME_PROFILE_VERSION,
      mode: composerMode,
    });
    const manifestUsable =
      cachedManifestHash.length > 0 &&
      cachedManifestHash === currentToolManifestHash &&
      cachedCatalogGeneration === catalogGeneration &&
      (!actorContextHash || cachedActorContextHash === actorContextHash);
    const cacheUsable =
      cheapCacheEligible &&
      manifestUsable &&
      cachedProfileKey === currentProfileKey &&
      cachedProfileRevision === currentProfileRevision;
    if (cacheUsable) {
      const cachedTools = cached.tools;
      const mergedRoots = {
        ...(cached.roots || {}),
        ...roots,
        progressive_tool_discovery: false,
        profile_hash: cachedProfileHash,
        profile_version: RUNTIME_PROFILE_VERSION,
        runtime_profile: cached.roots.runtime_profile,
      };
      const runtimeProfile = hydrateRuntimeProfileFromCache(
        cachedTools,
        cached.writePolicy,
        mergedRoots,
      );
      if (!runtimeProfile?.profile_hash) {
        console.warn('[agent-session-context] cache_hit_missing_profile_hash', conversationId);
      } else {
        if (JSON.stringify(mergedRoots) !== JSON.stringify(cached.roots || {})) {
          await doSetSessionContext(stub, cachedTools, cached.writePolicy, mergedRoots).catch(
            () => {},
          );
        }
        const toolCount = Array.isArray(cachedTools) ? cachedTools.length : cachedCount;
        console.info(
          '[agent-session-context] cache_hit',
          JSON.stringify({
            conversationId,
            tools: toolCount,
            mode: composerMode,
            profile_hash: cachedProfileHash.slice(0, 12),
            profile_version: RUNTIME_PROFILE_VERSION,
            progressive: false,
          }),
        );
        logSessionRoots('cache_hit', conversationId, mergedRoots, {
          tools: toolCount,
          mode: composerMode,
          profile_hash: cachedProfileHash.slice(0, 12),
        });
        return {
          tools: cachedTools,
          writePolicy: cached.writePolicy || writePolicyFromComposerMode(composerMode),
          runtimePolicy:
            cached?.roots?.runtime_policy && typeof cached.roots.runtime_policy === 'object'
              ? cached.roots.runtime_policy
              : parseRuntimePolicyJson(null),
          runtimeProfile,
          roots: mergedRoots,
          mode: composerMode,
          profile_task_type: profileTaskType,
          profile_key: cached?.roots?.profile_key || null,
          fromCache: true,
        };
      }
    }
    if (
      (staleProgressiveCache ||
        cachedProfileKey !== currentProfileKey ||
        cachedProfileRevision !== currentProfileRevision ||
        (cachedProfileTask && cachedProfileTask !== profileTaskType) ||
        filesSourceMismatch) &&
      cachedCount > 0
    ) {
      const reasons = [
        staleProgressiveCache ? 'progressive_tool_discovery_retired' : null,
        cachedProfileKey !== currentProfileKey
          ? `profile_key:${cachedProfileKey || '(none)'}->${currentProfileKey || '(none)'}`
          : null,
        cachedProfileRevision !== currentProfileRevision
          ? `profile_revision:${cachedProfileRevision || '(none)'}->${currentProfileRevision || '(none)'}`
          : null,
        cachedProfileTask && cachedProfileTask !== profileTaskType
          ? `profile_task_type:${cachedProfileTask}->${profileTaskType}`
          : null,
        filesSourceMismatch
          ? `files_source:${cachedFilesSource || '(none)'}->${filesSourceForSession || '(none)'}`
          : null,
      ].filter(Boolean);
      console.info(
        '[agent-session-context] cache_invalidate_profile_upgrade',
        JSON.stringify({
          conversationId,
          tools: cachedCount,
          reasons,
        }),
      );
    }
    if (cachedCount > SESSION_TOOL_CACHE_SOFT_MAX) {
      console.info(
        '[agent-session-context] cache_invalidate_mega',
        JSON.stringify({ conversationId, tools: cachedCount, soft_max: SESSION_TOOL_CACHE_SOFT_MAX }),
      );
    }
  }

  // Single public compiler — same entry as child/spawn lanes. Cache result on DO.
  const { resolveRuntimeProfile } = await import('../../../src/core/runtime-profile.js');
  const {
    resolveSessionAllowlistKeys,
    resolveSessionWorkspaceGrants,
    buildAllowlistPinFields,
    buildSessionGrantsPinFields,
  } = await import('../../../src/core/session-envelope.js');
  const d1Meta = await loadToolProfileForMode(env?.DB, profileTaskType);
  const message = String(
    opts.message ?? opts.body?.message ?? opts.body?.content ?? '',
  ).trim();
  const scopeUserId = opts.userId != null ? String(opts.userId).trim() : '';
  const scopeWorkspaceId = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  const scopeTenantId = opts.tenantId != null ? String(opts.tenantId).trim() : '';
  const allowlistScope = {
    userId: scopeUserId,
    workspaceId: scopeWorkspaceId,
    tenantId: scopeTenantId,
    personUuid: opts.personUuid != null ? String(opts.personUuid).trim() : '',
  };

  let actorContextHash = '';
  let actorPolicyHash = '';
  if (scopeUserId && scopeWorkspaceId) {
    const boot = await resolveAgentSamBootstrap(env, {
      userId: scopeUserId,
      requestedWorkspaceId: scopeWorkspaceId,
    }).catch(() => null);
    if (boot?.ok) {
      actorContextHash = String(boot.context_hash || '').trim();
      actorPolicyHash = String(boot.policy_hash || '').trim();
    }
  }

  const envelopeRoots =
    cachedSessionContext?.roots && typeof cachedSessionContext.roots === 'object'
      ? cachedSessionContext.roots
      : roots;
  const [allowlistKeys, sessionGrants] = await Promise.all([
    resolveSessionAllowlistKeys(env, allowlistScope, envelopeRoots),
    resolveSessionWorkspaceGrants(
      env,
      { userId: scopeUserId, workspaceId: scopeWorkspaceId, authUser: opts.authUser },
      envelopeRoots,
      actorPolicyHash,
    ),
  ]);
  const allowlistPin = buildAllowlistPinFields(allowlistKeys, allowlistScope);
  const grantsPin = buildSessionGrantsPinFields(sessionGrants, actorPolicyHash);
  Object.assign(roots, allowlistPin, grantsPin);

  // Do not pass composer mode as overrides.task_type — that label is a binding key
  // (agentsam_tool_profile_bindings), not a resolveModel work intent.
  const overrideTaskType =
    profileTaskType &&
    String(profileTaskType).trim().toLowerCase() !== String(composerMode).trim().toLowerCase()
      ? String(profileTaskType).trim().toLowerCase()
      : null;
  let profile = await resolveRuntimeProfile(env, {
    mode: composerMode,
    message,
    session: {
      userId: scopeUserId || null,
      workspaceId: scopeWorkspaceId || null,
      tenantId: scopeTenantId || null,
      roots,
      actorPolicyHash,
      sessionGrants,
    },
    overrides: {
      route_key: requestedRouteKey || null,
      ...(overrideTaskType ? { task_type: overrideTaskType } : {}),
    },
    turnDecision: opts.turnDecision || null,
    compile_lane: 'live',
    // Spine rebinds model per turn. A bootstrap Thompson draw is discarded and
    // can pause arms / write rewards for a resolution the turn never uses.
    skip_model_resolve: true,
  });

  let tools = Array.isArray(profile._compiled_tool_rows) ? profile._compiled_tool_rows : [];
  // No Files-rail menu partition — composer_* keeps fs + github + deploy together.
  // Illegal pairs are per-call (e.g. github-bound Monaco buffer), not files_source alone.

  const writePolicy =
    profile.write_policy && typeof profile.write_policy === 'object'
      ? profile.write_policy
      : writePolicyFromComposerMode(composerMode);
  const runtimePolicy = {
    max_tool_calls: Number(profile.max_tool_calls) || 0,
    max_turns: Number(profile.max_turns) || 0,
    max_runtime_ms: Number(profile.max_runtime_ms) || 0,
    temperature: profile.temperature ?? null,
  };
  if (tools.length > 0 && runtimePolicy.max_tool_calls <= 0) {
    console.error(
      '[agent-session-context] runtime_policy_missing_fail_closed',
      JSON.stringify({
        conversationId,
        profile_key: profile.tool_profile || d1Meta?.profile_key || null,
        tools: tools.length,
        max_tool_calls: runtimePolicy.max_tool_calls,
      }),
    );
  }

  const profileKey =
    String(profile.tool_profile || profile.source?.d1_tool_profile_key || d1Meta?.profile_key || '')
      .trim() || null;
  const profileHash = String(profile.profile_hash || '').trim();
  if (!profileHash) {
    console.error(
      '[agent-session-context] bootstrap_missing_profile_hash',
      JSON.stringify({ conversationId, profile_key: profileKey }),
    );
  }

  profile.source = {
    ...(profile.source && typeof profile.source === 'object' ? profile.source : {}),
    compile_lane: 'session_context',
    session_scoped: true,
    cached: false,
  };

  const catalogGeneration = await resolveToolCatalogGeneration(env);
  await warmCatalogGenerationStamp(env);
  const profileGeneration = await warmProfileGenerationStamp(env, {
    profileKey,
    profileRevision: d1Meta?.profile_revision || null,
  });
  const toolManifestHash = await computeToolManifestHash({
    actorContextHash,
    actorPolicyHash,
    toolProfileHash: profileHash,
    toolProfileRevision: d1Meta?.profile_revision || null,
    catalogGeneration,
    runtimeProfileVersion: RUNTIME_PROFILE_VERSION,
    mode: composerMode,
  });

  const rootsWithMode = {
    ...roots,
    ...allowlistPin,
    ...grantsPin,
    mode: composerMode,
    profile_task_type: profileTaskType,
    profile_key: profileKey,
    profile_revision: d1Meta?.profile_revision || null,
    force_first_tool: d1Meta?.force_first_tool || null,
    progressive_tool_discovery: false,
    profile_hash: profileHash,
    profile_version: RUNTIME_PROFILE_VERSION,
    actor_context_hash: actorContextHash,
    actor_policy_hash: actorPolicyHash,
    catalog_generation: catalogGeneration,
    profile_generation: profileGeneration,
    tool_manifest_hash: toolManifestHash,
    runtime_policy: runtimePolicy,
    runtime_profile: profileSnapshotForCache(profile),
  };
  if (stub) {
    await doSetSessionContext(stub, tools, writePolicy, rootsWithMode).catch((e) => {
      console.warn('[agent-session-context] set_failed', e?.message ?? e);
    });
  }
  console.info(
    '[agent-session-context] bootstrap',
    JSON.stringify({
      conversationId,
      tools: tools.length,
      mode: composerMode,
      profile_key: profileKey,
      max_tool_calls: runtimePolicy.max_tool_calls,
      profile_hash: profileHash ? profileHash.slice(0, 12) : null,
      profile_version: RUNTIME_PROFILE_VERSION,
      fsa_root: roots.fsa_root === true,
      progressive: false,
    }),
  );
  logSessionRoots('bootstrap', conversationId, rootsWithMode, {
    tools: tools.length,
    mode: composerMode,
    profile_key: profileKey,
    profile_hash: profileHash ? profileHash.slice(0, 12) : null,
    max_tool_calls: runtimePolicy.max_tool_calls,
  });
  return {
    tools,
    writePolicy,
    runtimePolicy,
    runtimeProfile: profile,
    roots: rootsWithMode,
    mode: composerMode,
    profile_task_type: profileTaskType,
    profile_key: profileKey,
    fromCache: false,
  };
}
