/**
 * fs_search_files — session transport search (FSA / PTY). Not GitHub clone-into-container.
 *
 * Surfaces (do not mix):
 *   client_fs     — Files rail Local (browser FSA fulfill `search`)
 *   workspace_pty — terminal_exec / ExecOS on workspace_settings.workspace_root
 *   github_api    — committed tip via agentsam_github_search (fallback / prefer_github)
 *
 * Forbidden as an fs_search side-effect: MY_CONTAINER checkout + ripgrep.
 * That path cloned workspace GitHub on every search assumption. The my_container
 * lane itself stays valid for agentsam_terminal_sandbox (explicit sandbox).
 */
import {
  buildRgSearchCommand,
  isSafeRgSearchCommand,
  parseRgJsonMatches,
  FS_SEARCH_MAX_OUTPUT_BYTES,
} from './rg.js';

export { buildRgSearchCommand, isSafeRgSearchCommand, parseRgJsonMatches } from './rg.js';

/**
 * Detect an explicit GitHub-bound search so fs_search_files can reject the wrong tool.
 * @param {Record<string, unknown>} [params]
 * @param {Record<string, unknown>} [runContext]
 */
export function isExplicitGithubFsSearchTarget(params = {}, runContext = {}) {
  const filesSource = String(
    runContext.files_source ||
      runContext.filesSource ||
      runContext.runtimeProfile?._files_source ||
      '',
  )
    .trim()
    .toLowerCase();
  const localFilesRail =
    runContext.fsa_root === true ||
    runContext._fsa_root === true ||
    runContext.runtimeProfile?._fsa_root === true ||
    filesSource === 'local';
  return (
    !localFilesRail &&
    (filesSource === 'github' ||
      params.prefer_github === true ||
      String(params.fs_source || '').trim() === 'github_api_committed' ||
      String(runContext.prefer_github || '').trim() === '1')
  );
}

/**
 * Filesystem-local default directory from an active-file envelope.
 * GitHub-bound envelopes never become local paths.
 * @param {Record<string, unknown>|null|undefined} envelope
 */
export function defaultFilesystemSearchPath(envelope) {
  if (!envelope || typeof envelope !== 'object') return '.';
  if (String(envelope.source || '').trim().toLowerCase() === 'github' || envelope.github_repo) return '.';
  const raw = String(envelope.workspace_path || envelope.path || envelope.raw_path || '').trim();
  if (!raw || raw.startsWith('/') || raw.startsWith('~') || raw.includes('..')) return '.';
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  const slash = normalized.lastIndexOf('/');
  return slash > 0 ? normalized.slice(0, slash) : '.';
}

/**
 * Derive ripgrep query from natural-language user text when the model omits `query`.
 * @param {unknown} message
 * @returns {string}
 */
export function extractSearchQueryFromUserText(message) {
  const m = String(message || '');
  if (!m.trim()) return '';

  const quotedContaining = m.match(/containing\s+["']([^"']+)["']/i);
  if (quotedContaining?.[1]) return String(quotedContaining[1]).trim();

  const quotedFind = m.match(/\bfind(?:\s+all)?\s+(?:files?\s+)?(?:with|for|matching)?\s*["']([^"']+)["']/i);
  if (quotedFind?.[1]) return String(quotedFind[1]).trim();

  // Catalog/table keys (underscore) OR Vectorize/index names (hyphen): agentsam-codebase-oai3large-1536
  const agentsamId = m.match(/\bagentsam[-_][\w.-]{2,}\b/i);
  if (agentsamId?.[0]) return String(agentsamId[0]).trim();

  // "what is X" / "what is X for" — prefer long tech identifiers over stopwords
  const whatIs = m.match(
    /\bwhat\s+(?:is|are)\s+(?:the\s+)?[`'"]?([A-Za-z][\w./-]{4,})[`'"]?(?:\s+for)?\b/i,
  );
  if (
    whatIs?.[1] &&
    !/^(this|that|these|those|our|your|files?|code|repo|page|tool|agent|sam)$/i.test(whatIs[1])
  ) {
    return String(whatIs[1]).trim().slice(0, 120);
  }

  // Route / page questions: "files that make up /dashboard/home"
  const dashRoute = m.match(/\/dashboard\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)/i);
  if (dashRoute?.[1]) {
    const seg = dashRoute[1].split('/').filter(Boolean).pop() || dashRoute[1];
    return String(seg).trim();
  }
  const filesMakeUp = m.match(
    /\b(?:files?|components?|modules?)\b[^.!?\n]{0,80}?\b(?:make up|for|of|in)\b[^.!?\n]{0,40}?([A-Za-z][A-Za-z0-9_/-]{2,})/i,
  );
  if (filesMakeUp?.[1] && !/^(our|the|this|that|page|app|repo)$/i.test(filesMakeUp[1])) {
    return String(filesMakeUp[1]).replace(/^\/+/, '').trim().slice(0, 80);
  }

  if (/\bfind\b/i.test(m)) {
    const heading = m.match(/#\s*([^\r\n#]+)/);
    if (heading?.[1]) return String(heading[1]).trim().slice(0, 160);
  }

  const symbol = m.match(
    /\b(?:find|search|grep|locate|containing)\b[^.!?\n]{0,160}?\b([A-Za-z_][A-Za-z0-9_]{2,})\b/i,
  );
  if (symbol?.[1] && !/^(files?|repo|codebase|workspace|all|the|this|that|and|for|with|agent|sam|audit|checklist)$/i.test(symbol[1])) {
    return String(symbol[1]).trim();
  }

  return '';
}

/**
 * SPA route paths like `/dashboard/artifacts` are not repo paths. Convert to
 * search under `app/` with the last segment as the ripgrep query.
 * @param {string} rawPath
 * @returns {{ path: string, routeSegment: string|null }}
 */
export function rewriteSpaRouteSearchPath(rawPath) {
  const p = String(rawPath || '').trim();
  if (!p || p === '.' || p === './') return { path: p || '.', routeSegment: null };
  const normalized = p.replace(/\\/g, '/');
  const m = normalized.match(/^(?:\.\/)?\/?dashboard(?:\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]*)*))?\/?$/i);
  if (!m) return { path: p, routeSegment: null };
  const rest = String(m[1] || '')
    .split('/')
    .filter(Boolean);
  const routeSegment = rest.length ? rest[rest.length - 1] : null;
  return { path: 'app', routeSegment };
}

/**
 * Normalize fs_search_files tool input (query + optional path).
 * @param {Record<string, unknown>|null|undefined} params
 * @param {{ userMessage?: string, activeFileEnvelope?: Record<string, unknown>|null }} [hints]
 */
/** True when path looks like a GitHub Owner/repo slug (not a workspace-relative dir). */
export function isGithubRepoStylePath(rawPath) {
  const p = String(rawPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
  if (!p || p === '.' || p.startsWith('/') || p.startsWith('../')) return false;
  // Owner/repo or Owner/repo/file… — never a valid cwd for local ripgrep.
  return !/^app(?:\/|$)/i.test(p) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/.*)?$/.test(p);
}

export function normalizeFsSearchFilesParams(params, hints = {}) {
  const out = params && typeof params === 'object' ? { ...params } : {};
  let query = String(out.query ?? out.q ?? out.pattern ?? '').trim();
  if (query === '.' || query === '*' || query === '**') query = '';

  let rawPath = String(out.path ?? out.glob_path ?? '').trim();
  if (isGithubRepoStylePath(rawPath)) {
    rawPath = '';
    delete out.path;
    delete out.glob_path;
  }

  // SPA route in the user message wins even when path was omitted / wrong.
  const msg = String(hints.userMessage || '');
  const msgSpa = msg.match(/\/dashboard\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)/i);
  if (msgSpa) {
    const seg = msgSpa[1].split('/').filter(Boolean).pop() || msgSpa[1];
    out.path = 'app';
    delete out.glob_path;
    if (!query) query = String(seg).trim();
  }

  const spa = rewriteSpaRouteSearchPath(rawPath);
  if (spa.routeSegment != null || (rawPath && /^\/?dashboard\b/i.test(rawPath))) {
    out.path = spa.path || 'app';
    delete out.glob_path;
    if (!query && spa.routeSegment) query = spa.routeSegment;
  }

  if (!query && hints.userMessage) {
    query = extractSearchQueryFromUserText(hints.userMessage);
  }

  if (!query) {
    const fromPath = String(out.path ?? out.glob_path ?? rawPath ?? '.').trim();
    const base = fromPath.split('/').filter(Boolean).pop() || '';
    if (base && base !== '.' && base !== '..' && base.toLowerCase() !== 'dashboard') {
      query = base.replace(/\.[^.]+$/, '') || base;
    }
  }

  if (query) {
    out.query = query;
    delete out.q;
    delete out.pattern;
  }

  if (hints.activeFileEnvelope && typeof hints.activeFileEnvelope === 'object') {
    if (!out.path && !out.glob_path) {
      out.path = defaultFilesystemSearchPath(hints.activeFileEnvelope);
    }
    if (isGithubRepoStylePath(out.path)) {
      out.path = '.';
    }
    // Do not let GitHub envelope rewrite fs_search path to Owner/repo.
    return out;
  }

  return out;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} runContext
 */
export async function executeFsSearchFiles(env, params, runContext = {}) {
  const started = Date.now();
  const normalized = normalizeFsSearchFilesParams(params, {
    userMessage: runContext.userMessage ?? runContext.message ?? runContext.mcpRuntimeContext?.userMessage ?? null,
    activeFileEnvelope: runContext.activeFileEnvelope ?? runContext.active_file_envelope ?? null,
  });
  const query = String(normalized.query ?? '').trim();
  let pathArg = String(normalized.path ?? normalized.glob_path ?? '.').trim() || '.';
  if (pathArg !== '.' && (pathArg.startsWith('/') || pathArg.startsWith('~') || /^[A-Za-z]:[\\/]/.test(pathArg) || pathArg.includes('..'))) {
    pathArg = '.';
  }
  if (!query) {
    return {
      error: 'query required',
      lane: 'fs_search',
      tool: 'fs_search_files',
      hint: 'Pass a non-empty query. For D1 schema/table questions use agentsam_d1_query — not fs_search_files.',
    };
  }

  const { resolveFsTransport, runClientFsOp, clientFsCallId } = await import('./transport.js');
  if (resolveFsTransport(runContext) === 'client_fs') {
    const callId = clientFsCallId(runContext, params._client_fs_call_suffix || 'search');
    const out = await runClientFsOp(env, runContext, {
      callId,
      operation: 'search',
      path: pathArg === '.' ? '' : pathArg,
      query,
      toolName: 'fs_search_files',
      timeoutMs: Number(runContext.toolBudgetMs) || 90000,
    });
    const durationMs = Math.max(0, Date.now() - started);
    if (out.ok === false || out.error) {
      return {
        error: String(out.error || 'client_fs_search_failed'),
        lane: 'client_fs',
        tool: 'fs_search_files',
        query,
        path: pathArg,
        root_name: out.root_name,
        hint: out.hint,
        duration_ms: durationMs,
      };
    }
    const matches = Array.isArray(out.matches) ? out.matches : Array.isArray(out.hits) ? out.hits : [];
    return {
      success: true,
      lane: 'client_fs',
      tool: 'fs_search_files',
      query,
      path: pathArg,
      root_name: out.root_name,
      match_count: matches.length,
      matches,
      duration_ms: durationMs,
    };
  }

  if (isExplicitGithubFsSearchTarget(params, runContext)) {
    const repo = String(params.repo || params.github_repo || params.githubRepo || '').trim();
    return {
      success: false,
      error: 'wrong_tool_for_github_search',
      lane: 'github_tools',
      tool: 'fs_search_files',
      query,
      path: pathArg,
      repo: repo || null,
      hint: 'Use agentsam_github_search with an explicit repo for committed GitHub content. fs_search_files searches only the selected working tree.',
    };
  }

  const userId = String(runContext.userId ?? runContext.user_id ?? params.user_id ?? '').trim();
  const workspaceId = String(runContext.workspaceId ?? runContext.workspace_id ?? params.workspace_id ?? '').trim();
  const tenantId = String(runContext.tenantId ?? runContext.tenant_id ?? params.tenant_id ?? '').trim();
  if (!userId || !workspaceId || !tenantId) {
    return { error: 'user_id, tenant_id and workspace_id required', lane: 'fs_search', tool: 'fs_search_files' };
  }

  const command = buildRgSearchCommand(query, pathArg, { maxCount: params.max_results ?? params.max_count });
  if (!command || !isSafeRgSearchCommand(command)) return { error: 'unsafe_or_invalid_search_command', lane: 'fs_search' };

  const { executeAgentSessionTerminalCommand } = await import('../terminal/exec.js');
  const res = await executeAgentSessionTerminalCommand(env, command, {
    ...runContext,
    userId,
    workspaceId,
    tenantId,
  }, {
    toolName: 'fs_search_files',
    timeoutMs: Number(runContext.toolBudgetMs) || 90000,
  });
  const output = String(res?.output || '');
  const exitCode = Number(res?.exitCode ?? res?.exit_code ?? 1);
  // rg exit=1 means a valid search with no matches.
  if (!res?.ok && exitCode !== 1) {
    return {
      error: String(res?.error || 'pty_search_failed'),
      lane: 'workspace_pty',
      tool: 'fs_search_files',
      query,
      path: pathArg,
      exit_code: exitCode,
      duration_ms: Math.max(0, Date.now() - started),
      connection_id: res?.targetId || null,
      hint: 'Connect Local Files / a terminal working tree, or use agentsam_github_search explicitly for committed GitHub content.',
    };
  }
  const matches = parseRgJsonMatches(output);
  return {
    success: true,
    lane: 'workspace_pty',
    tool: 'fs_search_files',
    query,
    path: pathArg,
    match_count: matches.length,
    matches,
    exit_code: exitCode,
    truncated: output.length > FS_SEARCH_MAX_OUTPUT_BYTES,
    duration_ms: Math.max(0, Date.now() - started),
    connection_id: res?.targetId || null,
    fs_source: 'local_working_tree',
  };
}
