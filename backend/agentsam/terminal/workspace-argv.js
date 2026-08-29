/**
 * Generic catalog handler_type=workspace_argv.
 * D1 handler_config owns the frozen interpreter/script/flags.
 * LLM input is typed fields only — never command/argv/shell.
 */

import { executeAgentSessionTerminalCommand } from './exec.js';
import { userCanAccessWorkspace } from '../../identity/workspace/access.js';


function remoteWorkspaceRootFromSettings(settings) {
  if (!settings || typeof settings !== 'object') return null;
  const raw = settings.vm_workspace_root ?? settings.repo?.vm_path ?? null;
  const value = raw == null ? '' : String(raw).trim();
  return value || null;
}

const TERMINAL_TOOL_BY_EXEC_LANE = Object.freeze({
  local: 'agentsam_terminal_local',
  remote: 'agentsam_terminal_remote',
  sandbox: 'agentsam_terminal_sandbox',
});

/** @param {unknown} lane */
function terminalToolKeyForExecLane(lane) {
  const key = String(lane || '').trim().toLowerCase();
  return TERMINAL_TOOL_BY_EXEC_LANE[key] || null;
}

const GIT_REF_RE = /^(HEAD|HEAD~\d+|origin\/[A-Za-z0-9._\/-]+|[A-Za-z0-9][A-Za-z0-9._\/-]*)$/;
const REPO_RELPATH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;
const SHELL_META_RE = /[;&|`$<>\\\n\r\0]/;

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function posixShellQuote(raw) {
  const s = String(raw ?? '');
  if (s === '') return "''";
  if (/^[A-Za-z0-9_./:=+-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {string[]} argv
 * @returns {string}
 */
export function argvToShell(argv) {
  return (Array.isArray(argv) ? argv : []).map(posixShellQuote).join(' ');
}

/**
 * @param {unknown} ref
 * @param {string} [fallback='HEAD']
 * @returns {{ ok: true, ref: string } | { ok: false, error: string }}
 */
export function sanitizeGitRef(ref, fallback = 'HEAD') {
  const raw = ref == null || String(ref).trim() === '' ? fallback : String(ref).trim();
  if (raw.length > 200) return { ok: false, error: 'git_ref_invalid' };
  if (SHELL_META_RE.test(raw) || raw.includes('..') || raw.startsWith('-')) {
    return { ok: false, error: 'git_ref_invalid' };
  }
  if (!GIT_REF_RE.test(raw)) return { ok: false, error: 'git_ref_invalid' };
  return { ok: true, ref: raw };
}

/**
 * @param {unknown} path
 * @returns {{ ok: true, path: string } | { ok: false, error: string }}
 */
export function sanitizeRepoRelativePath(path) {
  const raw = path == null ? '' : String(path).trim();
  if (!raw) return { ok: false, error: 'focus_path_required' };
  if (raw.length > 500) return { ok: false, error: 'focus_path_invalid' };
  if (raw.startsWith('/') || raw.startsWith('~') || /^[A-Za-z]:[\\/]/.test(raw)) {
    return { ok: false, error: 'focus_path_absolute_rejected' };
  }
  if (raw.includes('\\') || SHELL_META_RE.test(raw) || raw.split('/').includes('..')) {
    return { ok: false, error: 'focus_path_invalid' };
  }
  if (!REPO_RELPATH_RE.test(raw)) return { ok: false, error: 'focus_path_invalid' };
  return { ok: true, path: raw.replace(/\/+/g, '/') };
}

/**
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} config
 */
export function validateWorkspaceArgvInput(params, config) {
  const modeDefault = String(config.mode_default || 'overview').trim() || 'overview';
  const modeRaw = params?.mode == null || String(params.mode).trim() === ''
    ? modeDefault
    : String(params.mode).trim().toLowerCase();
  const allowedModes = Array.isArray(config.mode_enum) && config.mode_enum.length
    ? config.mode_enum.map((m) => String(m).trim().toLowerCase()).filter(Boolean)
    : ['overview', 'focus'];
  if (!allowedModes.includes(modeRaw)) {
    return { ok: false, error: 'mode_invalid' };
  }

  const targetSel = sanitizeWorkspaceTargetSelector(params || {});
  if (!targetSel.ok) return targetSel;

  const ref = sanitizeGitRef(params?.ref, String(config.ref_default || 'HEAD'));
  if (!ref.ok) return ref;

  const focusMode = String(config.focus_mode || 'focus').trim() || 'focus';
  let path = null;
  if (modeRaw === focusMode) {
    const p = sanitizeRepoRelativePath(params?.path);
    if (!p.ok) return p;
    path = p.path;
  } else if (params?.path != null && String(params.path).trim() !== '') {
    const p = sanitizeRepoRelativePath(params.path);
    if (!p.ok) return p;
    path = p.path;
  }

  let path_prefix = null;
  if (params?.path_prefix != null && String(params.path_prefix).trim() !== '') {
    const p = sanitizeRepoRelativePath(String(params.path_prefix).replace(/\/+$/, ''));
    if (!p.ok) return { ok: false, error: 'path_prefix_invalid' };
    path_prefix = p.path;
  }
  const domainSel = sanitizeDomainSlug(params?.domain);
  if (!domainSel.ok) return domainSel;
  const sinceSel = sanitizeBoundedInt(params?.since_days, { min: 7, max: 365, error: 'since_days_invalid' });
  if (!sinceSel.ok) return sinceSel;
  const topSel = sanitizeBoundedInt(params?.top_k, { min: 5, max: 40, error: 'top_k_invalid' });
  if (!topSel.ok) return topSel;

  return {
    ok: true,
    mode: modeRaw,
    ref: ref.ref,
    path,
    path_prefix,
    domain: domainSel.domain,
    since_days: sinceSel.value,
    top_k: topSel.value,
    workspace_id: targetSel.workspace_id,
    workspace_slug: targetSel.workspace_slug,
    github_repo: targetSel.github_repo,
  };
}

/**
 * @param {{
 *   interpreter?: string,
 *   script: string,
 *   repoRoot: string,
 *   ref: string,
 *   path?: string|null,
 *   mode?: string,
 *   fixed_args?: string[],
 *   repo_flag?: string,
 *   ref_flag?: string,
 *   focus_flag?: string,
 *   focus_mode?: string,
 * }} spec
 * @returns {{ ok: true, argv: string[] } | { ok: false, error: string }}
 */
export function buildWorkspaceArgv(spec) {
  const interpreter = String(spec.interpreter || 'python3').trim() || 'python3';
  const script = String(spec.script || '').trim();
  if (!script || script.startsWith('/') || script.includes('..') || SHELL_META_RE.test(script)) {
    return { ok: false, error: 'workspace_argv_script_invalid' };
  }
  const repoRoot = String(spec.repoRoot || '').trim();
  if (!repoRoot) return { ok: false, error: 'workspace_repo_root_unresolved' };

  const argv = [interpreter, script];
  const repoFlag = String(spec.repo_flag || '--repo').trim();
  const refFlag = String(spec.ref_flag || '--ref').trim();
  argv.push(repoFlag, repoRoot, refFlag, spec.ref);
  const fixed = Array.isArray(spec.fixed_args) ? spec.fixed_args : [];
  for (const a of fixed) {
    const t = String(a || '').trim();
    if (!t || SHELL_META_RE.test(t) || t.includes('..')) {
      return { ok: false, error: 'workspace_argv_fixed_arg_invalid' };
    }
    argv.push(t);
  }
  const focusMode = String(spec.focus_mode || 'focus').trim() || 'focus';
  if (spec.mode === focusMode && spec.path) {
    argv.push(String(spec.focus_flag || '--focus').trim(), spec.path);
  }
  if (spec.path_prefix) {
    argv.push(String(spec.path_prefix_flag || '--path-prefix').trim(), spec.path_prefix);
  }
  if (spec.domain) {
    argv.push(String(spec.domain_flag || '--domain').trim(), spec.domain);
  }
  if (spec.since_days != null) {
    argv.push(String(spec.since_days_flag || '--since-days').trim(), String(spec.since_days));
  }
  if (spec.top_k != null) {
    argv.push(String(spec.top_k_flag || '--top-k').trim(), String(spec.top_k));
  }
  return { ok: true, argv };
}

/**
 * Local ExecOS /fetch abort window. Catalog timeout_ms is the source of truth.
 * @param {unknown} raw
 * @param {number} [fallback=180000]
 */
export function clampWorkspaceArgvTimeoutMs(raw, fallback = 180000) {
  const n = Number(raw);
  const base = Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  return Math.min(240000, Math.max(10000, base));
}

/**
 * Historian prints `json=…` / `markdown=…` / `agent_packet=…` then a compact JSON line.
 * @param {string} stdout
 * @returns {{ ok: true, packet: object, artifact_paths: Record<string, string> } | { ok: false, error: string }}
 */
export function parsePathLinesThenJson(stdout) {
  const text = String(stdout || '');
  /** @type {Record<string, string>} */
  const artifact_paths = {};
  let packet = null;
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const pathMatch =
      /^(json|markdown|agent_packet|packet|evidence|report|curated_index|scratch_json|scratch_markdown|scratch_agent_packet|archive_run|durable_run|durable_report|durable_index)=(.*)$/.exec(s);
    if (pathMatch) {
      artifact_paths[pathMatch[1]] = pathMatch[2].trim();
      continue;
    }
    if (s.startsWith('{')) {
      try {
        const obj = JSON.parse(s);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) packet = obj;
      } catch {
        /* keep scanning */
      }
    }
  }
  if (!packet) return { ok: false, error: 'repo_intelligence_packet_missing' };
  return { ok: true, packet, artifact_paths };
}

/**
 * @param {Record<string, unknown>} packet
 * @param {{ mode: string, path?: string|null }} input
 */
export function summarizeRepoIntelligencePacket(packet, input) {
  const mode = String(input.mode || 'overview');
  if (mode === 'focus') {
    const focus = packet?.focus && typeof packet.focus === 'object' ? packet.focus : {};
    const path = String(focus.path || input.path || '').trim() || '(unspecified)';
    const n = Number(focus.touching_commits);
    const commits = Number.isFinite(n) ? n : null;
    return commits != null
      ? `Repo intelligence · focus · ${path} · ${commits} commits`
      : `Repo intelligence · focus · ${path}`;
  }
  const n = Number(packet?.commits);
  const scope = packet?.scope && typeof packet.scope === 'object' ? packet.scope : {};
  const prefixes = Array.isArray(scope.path_prefixes) ? scope.path_prefixes.filter(Boolean) : [];
  const domains = Array.isArray(scope.domains) ? scope.domains.filter(Boolean) : [];
  const scopeBits = [...prefixes, ...domains];
  const scopeLabel = scopeBits.length ? ` · ${scopeBits.join('+')}` : '';
  const matched = Number(scope.matched_files);
  const matchBit = Number.isFinite(matched) && scopeBits.length ? ` · ${matched} files` : '';
  return Number.isFinite(n)
    ? `Repo intelligence · overview${scopeLabel}${matchBit} · ${n} commits`
    : `Repo intelligence · overview${scopeLabel}`;
}

function looksLikeFilesystemRoot(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  return (
    s.startsWith('/') ||
    s.startsWith('~') ||
    s.includes('..') ||
    s.includes('\\') ||
    /^[A-Za-z]:[\\/]/.test(s)
  );
}

const DOMAIN_SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,60}$/;

function sanitizeDomainSlug(raw) {
  const s = raw == null ? '' : String(raw).trim().toLowerCase().replace(/_/g, '-');
  if (!s) return { ok: true, domain: null };
  if (s.length > 60 || looksLikeFilesystemRoot(s) || SHELL_META_RE.test(s) || !DOMAIN_SLUG_RE.test(s)) {
    return { ok: false, error: 'domain_invalid' };
  }
  return { ok: true, domain: s };
}

function sanitizeBoundedInt(raw, { min, max, error }) {
  if (raw == null || String(raw).trim() === '') return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    return { ok: false, error };
  }
  return { ok: true, value: n };
}
const WORKSPACE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/;
const SLUG_OR_REPO_RE = /^[A-Za-z0-9._-]+$/;
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * Typed catalog/MCP input. Never command/argv/cwd/filesystem roots.
 * Target a checkout via D1 workspace id, slug, or github_repo (or `repo` alias).
 * @param {Record<string, unknown>|null|undefined} params
 */
export function typedWorkspaceArgvParams(params) {
  const src = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  const repoAlias = src.repo == null ? '' : String(src.repo).trim();
  let github_repo = src.github_repo ?? src.githubRepo ?? null;
  if (!github_repo && repoAlias) {
    if (looksLikeFilesystemRoot(repoAlias)) {
      return {
        mode: src.mode,
        path: src.path,
        ref: src.ref,
        repo_filesystem_rejected: true,
      };
    }
    github_repo = repoAlias;
  }
  return {
    mode: src.mode,
    path: src.path,
    ref: src.ref,
    path_prefix: src.path_prefix ?? src.pathPrefix ?? null,
    domain: src.domain ?? null,
    since_days: src.since_days ?? src.sinceDays ?? null,
    top_k: src.top_k ?? src.topK ?? null,
    workspace_id: src.workspace_id ?? src.workspaceId ?? null,
    workspace_slug: src.workspace_slug ?? src.workspaceSlug ?? null,
    github_repo,
  };
}

/**
 * @param {Record<string, unknown>} typed
 * @returns {{ ok: true, workspace_id: string|null, workspace_slug: string|null, github_repo: string|null } | { ok: false, error: string }}
 */
export function sanitizeWorkspaceTargetSelector(typed) {
  if (typed?.repo_filesystem_rejected) {
    return { ok: false, error: 'repo_filesystem_rejected' };
  }
  const workspace_id = typed?.workspace_id == null ? '' : String(typed.workspace_id).trim();
  const workspace_slug = typed?.workspace_slug == null ? '' : String(typed.workspace_slug).trim();
  const github_repo = typed?.github_repo == null ? '' : String(typed.github_repo).trim();
  for (const [label, val] of [
    ['workspace_id', workspace_id],
    ['workspace_slug', workspace_slug],
    ['github_repo', github_repo],
  ]) {
    if (!val) continue;
    if (looksLikeFilesystemRoot(val) || SHELL_META_RE.test(val)) {
      return { ok: false, error: 'repo_filesystem_rejected' };
    }
    if (label === 'workspace_id' && !WORKSPACE_ID_RE.test(val)) {
      return { ok: false, error: 'workspace_selector_invalid' };
    }
    if (label === 'workspace_slug' && !SLUG_OR_REPO_RE.test(val)) {
      return { ok: false, error: 'workspace_selector_invalid' };
    }
    if (label === 'github_repo' && !GITHUB_REPO_RE.test(val) && !SLUG_OR_REPO_RE.test(val)) {
      return { ok: false, error: 'workspace_selector_invalid' };
    }
  }
  return {
    ok: true,
    workspace_id: workspace_id || null,
    workspace_slug: workspace_slug || null,
    github_repo: github_repo || null,
  };
}

function laneFromTargetType(targetType) {
  const t = String(targetType || '').trim().toLowerCase();
  if (t === 'user_hosted_tunnel' || t === 'local') return 'local';
  if (t === 'platform_vm' || t === 'remote') return 'remote';
  if (t === 'sandbox' || t === 'container' || t === 'ephemeral_container') return 'sandbox';
  return '';
}

/**
 * Dock lane first; else the workspace's unique default terminal_connections row.
 * Never invent a hop between Local/VM/Sandbox.
 */
async function resolveBoundExecLane(env, runContext, workspaceId, userId) {
  const fromCtx = String(runContext?.exec_lane ?? runContext?.execLane ?? '').trim().toLowerCase();
  if (fromCtx === 'local' || fromCtx === 'remote' || fromCtx === 'sandbox') {
    return { ok: true, lane: fromCtx };
  }
  if (fromCtx) {
    return { ok: false, error: 'exec_lane_invalid', body: { exec_lane: fromCtx } };
  }
  if (!env?.DB || !workspaceId || !userId) {
    return { ok: false, error: 'exec_lane_required' };
  }
  const row = await env.DB.prepare(
    `SELECT target_type FROM terminal_connections
      WHERE workspace_id = ? AND user_id = ?
        AND COALESCE(is_active, 1) = 1
        AND COALESCE(is_default, 0) = 1
      LIMIT 1`,
  )
    .bind(workspaceId, userId)
    .first()
    .catch(() => null);
  const lane = laneFromTargetType(row?.target_type);
  if (!lane) {
    return {
      ok: false,
      error: 'exec_lane_required',
      body: {
        user_message:
          'No bound execution lane for this workspace. Bind Local or VM before repo intelligence.',
      },
    };
  }
  return { ok: true, lane };
}

/**
 * Resolve the workspace checkout on the currently bound exec lane. Fail loud.
 * @param {any} env
 * @param {any} runContext
 * @param {string} workspaceId
 * @param {string} userId
 */
export async function resolveWorkspaceArgvRepoRoot(env, runContext, workspaceId, userId) {
  const bound = await resolveBoundExecLane(env, runContext, workspaceId, userId);
  if (!bound.ok) return bound;
  const laneRaw = bound.lane;
  const laneTool = terminalToolKeyForExecLane(laneRaw);
  if (!laneTool) {
    return { ok: false, error: 'exec_lane_invalid', body: { exec_lane: laneRaw } };
  }

  let parsedSettings = null;
  if (workspaceId && env?.DB) {
    const settingsRow = await env.DB.prepare(
      'SELECT settings_json FROM workspace_settings WHERE workspace_id = ? LIMIT 1',
    )
      .bind(workspaceId)
      .first()
      .catch(() => null);
    if (settingsRow?.settings_json) {
      try {
        parsedSettings =
          typeof settingsRow.settings_json === 'string'
            ? JSON.parse(settingsRow.settings_json)
            : settingsRow.settings_json;
      } catch {
        parsedSettings = null;
      }
    }
  }

  let repoRoot = '';
  if (laneRaw === 'remote') {
    repoRoot = String(remoteWorkspaceRootFromSettings(parsedSettings) || '').trim();
    if (!repoRoot) {
      return {
        ok: false,
        error: 'workspace_repo_root_unresolved',
        body: {
          exec_lane: laneRaw,
          user_message:
            'No verified GCP checkout root for this workspace (vm_workspace_root unset). Refusing to analyze another checkout.',
        },
      };
    }
  } else {
    repoRoot = String(parsedSettings?.workspace_root || '').trim();
    if (!repoRoot) {
      return {
        ok: false,
        error: 'workspace_repo_root_unresolved',
        body: {
          exec_lane: laneRaw,
          user_message:
            'workspace_settings.workspace_root is unset. Refusing to analyze an unrelated checkout.',
        },
      };
    }
  }

  return {
    ok: true,
    repoRoot,
    laneTool,
    execLane: laneRaw,
    parsedSettings,
    settingsJson: parsedSettings,
    userId,
  };
}

async function loadWorkspaceSettingsParsed(env, workspaceId) {
  if (!workspaceId || !env?.DB) return null;
  const settingsRow = await env.DB.prepare(
    'SELECT settings_json FROM workspace_settings WHERE workspace_id = ? LIMIT 1',
  )
    .bind(workspaceId)
    .first()
    .catch(() => null);
  if (!settingsRow?.settings_json) return null;
  try {
    return typeof settingsRow.settings_json === 'string'
      ? JSON.parse(settingsRow.settings_json)
      : settingsRow.settings_json;
  } catch {
    return null;
  }
}

/**
 * Checkout path for a workspace on the bound exec lane. Does not require a
 * terminal_connections default on the target workspace (engine owns the hop).
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} execLane
 */
export async function resolveWorkspaceCheckoutRoot(env, workspaceId, execLane) {
  const laneRaw = String(execLane || '').trim().toLowerCase();
  const parsedSettings = await loadWorkspaceSettingsParsed(env, workspaceId);
  let repoRoot = '';
  if (laneRaw === 'remote') {
    repoRoot = String(remoteWorkspaceRootFromSettings(parsedSettings) || '').trim();
    if (!repoRoot) {
      return {
        ok: false,
        error: 'workspace_repo_root_unresolved',
        body: {
          exec_lane: laneRaw,
          workspace_id: workspaceId || null,
          user_message:
            'No verified GCP checkout root for this workspace (vm_workspace_root unset).',
        },
      };
    }
  } else {
    repoRoot = String(parsedSettings?.workspace_root || '').trim();
    if (!repoRoot) {
      return {
        ok: false,
        error: 'workspace_repo_root_unresolved',
        body: {
          exec_lane: laneRaw,
          workspace_id: workspaceId || null,
          user_message:
            'workspace_settings.workspace_root is unset for the target workspace.',
        },
      };
    }
  }
  return { ok: true, repoRoot, parsedSettings };
}

function githubRepoBasename(raw) {
  const s = String(raw || '').trim();
  const slash = s.lastIndexOf('/');
  return slash >= 0 ? s.slice(slash + 1) : s;
}

/**
 * Membership-scoped workspace for --repo. Selector omitted → engine workspace.
 * @param {any} env
 * @param {any} authUser
 * @param {{ workspace_id?: string|null, workspace_slug?: string|null, github_repo?: string|null }} selector
 * @param {string} engineWorkspaceId
 */
export async function resolveHistorianTargetWorkspace(env, authUser, selector, engineWorkspaceId) {
  const engineId = String(engineWorkspaceId || '').trim();
  const hasSel = !!(selector?.workspace_id || selector?.workspace_slug || selector?.github_repo);
  if (!hasSel) {
    if (!engineId) return { ok: false, error: 'workspace_scope_required' };
    return { ok: true, workspaceId: engineId };
  }
  if (!env?.DB) return { ok: false, error: 'db_required' };

  const id = String(selector.workspace_id || '').trim();
  const slug = String(selector.workspace_slug || '').trim();
  const github = String(selector.github_repo || '').trim();
  const basename = githubRepoBasename(github || slug);

  let results = [];
  if (id) {
    const row = await env.DB.prepare(
      `SELECT id, slug, github_repo FROM workspaces WHERE id = ? LIMIT 1`,
    )
      .bind(id)
      .first()
      .catch(() => null);
    if (row?.id) results = [row];
  } else {
    const all = await env.DB.prepare(
      `SELECT id, slug, github_repo FROM workspaces
        WHERE slug = ?
           OR lower(COALESCE(github_repo, '')) = lower(?)
           OR lower(substr(COALESCE(github_repo, ''), instr(COALESCE(github_repo, ''), '/') + 1)) = lower(?)
        LIMIT 8`,
    )
      .bind(slug || basename, github || basename, basename)
      .all()
      .catch(() => ({ results: [] }));
    results = Array.isArray(all?.results) ? all.results : [];
  }

  const uniq = [];
  const seen = new Set();
  for (const row of results) {
    const wid = String(row?.id || '').trim();
    if (!wid || seen.has(wid)) continue;
    seen.add(wid);
    uniq.push(row);
  }
  if (!uniq.length) {
    return { ok: false, error: 'workspace_not_found' };
  }
  if (uniq.length > 1) {
    return {
      ok: false,
      error: 'workspace_ambiguous',
      body: { matches: uniq.map((r) => ({ id: r.id, slug: r.slug, github_repo: r.github_repo })) },
    };
  }
  const chosen = uniq[0];
  const chosenId = String(chosen.id).trim();
  if (id && chosenId !== id) {
    return { ok: false, error: 'workspace_not_found' };
  }
  if (slug && String(chosen.slug || '').trim() && String(chosen.slug).trim() !== slug) {
    return { ok: false, error: 'workspace_selector_mismatch' };
  }

  const allowed = await userCanAccessWorkspace(env, authUser, chosenId);
  if (!allowed) {
    return { ok: false, error: 'workspace_forbidden' };
  }
  return {
    ok: true,
    workspaceId: chosenId,
    slug: String(chosen.slug || '').trim() || null,
    github_repo: String(chosen.github_repo || '').trim() || null,
  };
}

function mapHistorianFailure(stdout, stderr, exitCode) {
  const blob = `${stdout || ''}\n${stderr || ''}`;
  if (/unauthorized/i.test(blob)) return 'terminal_unauthorized';
  if (/terminal_identity_required/i.test(blob)) return 'terminal_identity_required';
  if (/not tracked/i.test(blob)) return 'focus_path_not_tracked';
  if (/No such file|can't open file|repo_intelligence/i.test(blob) && Number(exitCode) !== 0) {
    return 'repo_intelligence_script_missing';
  }
  if (/not a git repository|fatal: /i.test(blob)) return 'workspace_git_missing';
  return 'workspace_argv_exec_failed';
}

/**
 * MCP transport shape — compact packet as `analysis`, artifacts as local paths.
 * @param {{ ok: boolean, error?: string, body?: Record<string, unknown> }} result
 * @param {{ workspaceId?: string }} [opts]
 */
export function toMcpRepoIntelligenceBody(result, opts = {}) {
  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error || 'workspace_argv_exec_failed',
      workspace_id: opts.workspaceId || null,
      ...(result?.body && typeof result.body === 'object' ? result.body : {}),
    };
  }
  const body = result.body && typeof result.body === 'object' ? result.body : {};
  return {
    ok: true,
    workspace_id: opts.workspaceId || null,
    repo: body.repo_root || null,
    ref: body.ref || null,
    head: body.head || null,
    analysis: body.packet || {},
    artifacts: body.artifact_paths || {},
    summary: body.summary || null,
  };
}

/**
 * Canonical historian runner — in-app catalog and MCP both call this.
 * Owns workspace→repo resolution, lane, validation, argv, exec, packet parse.
 * @param {any} ctx
 */
export async function runRepositoryIntelligence(ctx) {
  const {
    env,
    config,
    params,
    runContext,
    workspaceId,
    userId,
    tenantId,
    agentRunId,
  } = ctx;

  const validated = validateWorkspaceArgvInput(typedWorkspaceArgvParams(params), config || {});
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const authUser = runContext?.authUser || (userId ? { id: userId } : null);
  const conversationWorkspaceId = String(workspaceId || '').trim();
  const engineSlug = String(config?.engine_workspace_slug || '').trim();
  const engineWs = engineSlug
    ? await resolveHistorianTargetWorkspace(
        env,
        authUser,
        { workspace_slug: engineSlug },
        conversationWorkspaceId,
      )
    : conversationWorkspaceId
      ? { ok: true, workspaceId: conversationWorkspaceId }
      : { ok: false, error: 'workspace_scope_required' };
  if (!engineWs.ok) {
    return {
      ok: false,
      error: engineWs.error || 'historian_engine_unresolved',
      body: engineWs.body || {},
    };
  }
  const targetWs = await resolveHistorianTargetWorkspace(
    env,
    authUser,
    {
      workspace_id: validated.workspace_id,
      workspace_slug: validated.workspace_slug,
      github_repo: validated.github_repo,
    },
    conversationWorkspaceId || engineWs.workspaceId,
  );
  if (!targetWs.ok) {
    return { ok: false, error: targetWs.error, body: targetWs.body || {} };
  }

  const engineResolved = await resolveWorkspaceArgvRepoRoot(
    env,
    runContext,
    engineWs.workspaceId,
    userId,
  );
  if (!engineResolved.ok) {
    return { ok: false, error: engineResolved.error, body: engineResolved.body || {} };
  }

  const targetCheckout = await resolveWorkspaceCheckoutRoot(
    env,
    targetWs.workspaceId,
    engineResolved.execLane,
  );
  if (!targetCheckout.ok) {
    return { ok: false, error: targetCheckout.error, body: targetCheckout.body || {} };
  }

  const built = buildWorkspaceArgv({
    interpreter: config.interpreter,
    script: config.script,
    repoRoot: targetCheckout.repoRoot,
    ref: validated.ref,
    path: validated.path,
    mode: validated.mode,
    fixed_args: config.fixed_args,
    repo_flag: config.repo_flag,
    ref_flag: config.ref_flag,
    focus_flag: config.focus_flag,
    focus_mode: config.focus_mode,
    path_prefix: validated.path_prefix,
    domain: validated.domain,
    since_days: validated.since_days,
    top_k: validated.top_k,
    path_prefix_flag: config.path_prefix_flag,
    domain_flag: config.domain_flag,
    since_days_flag: config.since_days_flag,
    top_k_flag: config.top_k_flag,
  });
  if (!built.ok) return { ok: false, error: built.error };

  const rawCommand = argvToShell(built.argv);
  const timeoutMs = clampWorkspaceArgvTimeoutMs(config.timeout_ms);
  const execParams = {
    timeout_ms: timeoutMs,
    execution_mode: 'pty',
  };

  const terminalRunContext = {
    ...(runContext && typeof runContext === 'object' ? runContext : {}),
    userId,
    user_id: userId,
    workspaceId: engineWs.workspaceId,
    workspace_id: engineWs.workspaceId,
    tenantId,
    tenant_id: tenantId,
    agentRunId,
    agent_run_id: agentRunId,
    exec_lane: engineResolved.execLane,
    execLane: engineResolved.execLane,
  };
  const terminalOut = await executeAgentSessionTerminalCommand(
    env,
    rawCommand,
    terminalRunContext,
    {
      toolName: engineResolved.laneTool,
      timeoutMs,
      executionMode: 'pty',
      preferExplicitLane: true,
    },
  );
  const execResult = {
    ok: terminalOut?.ok === true,
    error: terminalOut?.error || null,
    body: {
      ...terminalOut,
      output: terminalOut?.output ?? terminalOut?.stdout ?? '',
      stdout: terminalOut?.stdout ?? terminalOut?.output ?? '',
      stderr: terminalOut?.stderr ?? '',
      exit_code: terminalOut?.exit_code ?? terminalOut?.exitCode ?? (terminalOut?.ok ? 0 : 1),
      workspace_root: engineResolved.repoRoot,
      exec_lane: engineResolved.execLane,
    },
  };

  const stdout = String(execResult?.body?.stdout ?? execResult?.body?.output ?? '');
  const stderr = String(execResult?.body?.stderr ?? '');
  const exitCode = execResult?.body?.exit_code ?? execResult?.body?.exitCode ?? (execResult?.ok ? 0 : 1);

  if (execResult?.ok !== true || Number(exitCode) !== 0) {
    const mapped = mapHistorianFailure(stdout, stderr, exitCode);
    return {
      ok: false,
      error: mapped,
      body: {
        repo_root: targetCheckout.repoRoot,
        engine_repo_root: engineResolved.repoRoot,
        exec_lane: engineResolved.execLane,
        argv: built.argv,
        exit_code: exitCode,
        stderr: stderr.slice(0, 4000),
        stdout: stdout.slice(0, 2000),
        user_message: execResult?.body?.user_message || execResult?.error || mapped,
        target_workspace_id: targetWs.workspaceId,
      },
    };
  }

  const parsed = parsePathLinesThenJson(stdout);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      body: {
        repo_root: targetCheckout.repoRoot,
        exec_lane: engineResolved.execLane,
        argv: built.argv,
        stdout: stdout.slice(0, 4000),
        target_workspace_id: targetWs.workspaceId,
      },
    };
  }

  const summary = summarizeRepoIntelligencePacket(parsed.packet, validated);
  return {
    ok: true,
    body: {
      ok: true,
      repo_root: targetCheckout.repoRoot,
      engine_repo_root: engineResolved.repoRoot,
      ref: validated.ref,
      head: String(parsed.packet.head || ''),
      mode: validated.mode,
      packet: parsed.packet,
      artifact_paths: parsed.artifact_paths,
      summary,
      text: summary,
      argv: built.argv,
      exec_lane: engineResolved.execLane,
      workspace_id: engineWs.workspaceId || null,
      target_workspace_id: targetWs.workspaceId,
    },
  };
}

/**
 * Catalog executor entry — thin adapter over {@link runRepositoryIntelligence}.
 * @param {any} ctx
 */
export async function executeCatalogWorkspaceArgv(ctx) {
  return runRepositoryIntelligence(ctx);
}
