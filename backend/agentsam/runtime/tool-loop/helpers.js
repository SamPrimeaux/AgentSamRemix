/**
 * Pure helpers / constants for runAgentToolLoop — keep control flow in loop.js.
 * New feature logic belongs here or in sibling modules; do not grow the god-file.
 */

import { CODEMODE_TOOL_CONNECTOR, CODEMODE_TOOL_NAME } from '../../../../src/core/codemode-constants.js';

/** Identical tool+args streak before we halt the loop and force a text answer. */
export const REPEATED_SAME_TOOL_ARGS_LIMIT = 3;
/** Same tool name (any args) streak — catches "vary SQL forever" loops. */
export const REPEATED_SAME_TOOL_NAME_LIMIT = 5;
/** Same Codemode inner connector tool (parsed from `code`) — envelope name always `codemode`. */
export const REPEATED_CODEMODE_INNER_LIMIT = 2;
/** Codemode envelope with no parseable inner connector call (search/describe only). */
export const REPEATED_CODEMODE_ENVELOPE_LIMIT = 3;
/** Multi-hop call-graph traces intentionally reuse agentsam_codebase_retrieve with new queries. */
export const CODEBASE_RETRIEVE_TOOL_KEYS = new Set(['agentsam_codebase_retrieve']);

const CODEMODE_INNER_CALL_RE = new RegExp(
  String.raw`${CODEMODE_TOOL_CONNECTOR}\s*(?:\.\s*([A-Za-z_][\w]*)|\s*\[\s*['"]([^'"]+)['"]\s*\])\s*\(`,
  'g',
);

/**
 * Connector methods invoked inside a Codemode `code` payload.
 * @param {unknown} code
 * @returns {string[]} unique keys, first-seen order
 */
export function extractCodemodeInnerToolKeys(code) {
  const s = String(code || '');
  if (!s) return [];
  const seen = new Set();
  const keys = [];
  CODEMODE_INNER_CALL_RE.lastIndex = 0;
  let m = CODEMODE_INNER_CALL_RE.exec(s);
  while (m) {
    const key = String(m[1] || m[2] || '')
      .trim()
      .toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    m = CODEMODE_INNER_CALL_RE.exec(s);
  }
  return keys;
}

/**
 * @param {string} name
 * @param {unknown} input
 */
export function toolRepeatIdentity(name, input) {
  const n = String(name || '')
    .trim()
    .toLowerCase();
  if (n !== CODEMODE_TOOL_NAME) return n;
  const inners = extractCodemodeInnerToolKeys(
    input && typeof input === 'object' ? /** @type {{ code?: unknown }} */ (input).code : null,
  );
  if (!inners.length) return CODEMODE_TOOL_NAME;
  return `${CODEMODE_TOOL_NAME}:${inners.join('+')}`;
}

/**
 * @param {string} identity — from toolRepeatIdentity
 */
export function repeatedNameHaltLimit(identity) {
  const id = String(identity || '')
    .trim()
    .toLowerCase();
  if (id.startsWith(`${CODEMODE_TOOL_NAME}:`)) return REPEATED_CODEMODE_INNER_LIMIT;
  if (id === CODEMODE_TOOL_NAME) return REPEATED_CODEMODE_ENVELOPE_LIMIT;
  return REPEATED_SAME_TOOL_NAME_LIMIT;
}

/**
 * @param {string} identity
 * @returns {string|null}
 */
export function innerToolKeyFromRepeatIdentity(identity) {
  const id = String(identity || '').trim();
  const prefix = `${CODEMODE_TOOL_NAME}:`;
  if (!id.toLowerCase().startsWith(prefix)) return null;
  return id.slice(prefix.length) || null;
}

/**
 * Explicit GitHub repository context only. Project bindings are not repository context.
 * If a project owns or references a repo, resolve that relationship before this boundary.
 * @param {Record<string, unknown>|null|undefined} mcpCtx
 */
export function githubRepoFieldsFromMcpCtx(mcpCtx) {
  const ctx = mcpCtx && typeof mcpCtx === 'object' ? mcpCtx : {};
  const githubRepo = String(
    ctx.selectedGithubRepoContext ||
      ctx.githubRepoContext ||
      ctx.github_repo_context ||
      ctx.active_repo ||
      ctx.activeRepo ||
      ctx.github_repo ||
      ctx.githubRepo ||
      '',
  ).trim();
  /** @type {Record<string, unknown>} */
  const out = {};
  if (githubRepo) {
    out.selectedGithubRepoContext = githubRepo;
    out.github_repo_context = githubRepo;
    out.active_repo = githubRepo;
    out.activeRepo = githubRepo;
    out.github_repo = githubRepo;
    out.githubRepo = githubRepo;
  } else {
    out.selectedGithubRepoContext = ctx.selectedGithubRepoContext ?? ctx.github_repo_context ?? null;
    out.github_repo_context = ctx.github_repo_context ?? ctx.selectedGithubRepoContext ?? null;
  }
  return out;
}

/**
 * Project identity/execution context only. Repository fields from project bindings are intentionally ignored.
 * @param {Record<string, unknown>|null|undefined} mcpCtx
 */
export function projectFieldsFromMcpCtx(mcpCtx) {
  const ctx = mcpCtx && typeof mcpCtx === 'object' ? mcpCtx : {};
  const bindings =
    ctx.projectExecutionBindings && typeof ctx.projectExecutionBindings === 'object'
      ? /** @type {Record<string, unknown>} */ (ctx.projectExecutionBindings)
      : null;
  const projectId = String(
    ctx.session_project_id ||
      ctx.sessionProjectId ||
      ctx.project_id ||
      ctx.projectId ||
      bindings?.projectId ||
      bindings?.project_id ||
      '',
  ).trim();
  const executionWorkspaceId = String(
    ctx.project_execution_workspace_id ||
      ctx.execution_workspace_id ||
      bindings?.workspaceId ||
      bindings?.workspace_id ||
      '',
  ).trim();
  /** @type {Record<string, unknown>} */
  const out = {};
  if (projectId) {
    out.session_project_id = projectId;
    out.project_id = projectId;
    out.projectId = projectId;
  }
  if (executionWorkspaceId) {
    out.project_execution_workspace_id = executionWorkspaceId;
    out.execution_workspace_id = executionWorkspaceId;
  }
  return out;
}

/**
 * @param {string} name
 * @param {unknown} input
 */
export function toolCallArgsFingerprint(name, input) {
  let args = '';
  try {
    args = JSON.stringify(input ?? {});
  } catch {
    args = String(input ?? '');
  }
  return `${String(name || '').trim().toLowerCase()}::${args}`;
}

/** @param {string} toolName @param {string} toolOutput */
export function cadToolSseExtrasFromOutput(toolName, toolOutput) {
  const n = String(toolName || '').toLowerCase();
  if (!/^(meshyai_|designstudio_|cad_)/.test(n) && !/meshy|openscad|blender|freecad/.test(n)) {
    return {};
  }
  try {
    const p = JSON.parse(String(toolOutput || '{}'));
    const jobId = p.job_id ?? p.cad_job_id;
    if (!jobId) return {};
    const st = String(p.status || '').toLowerCase();
    const pendingPolish = p.pending_polish === true;
    const pct = Number(p.progress_pct ?? p.progress);
    const inFlight =
      pendingPolish ||
      ['pending', 'running', 'queued', 'accepted'].includes(st) ||
      (Number.isFinite(pct) && pct > 0 && pct < 100);
    return {
      job_id: String(jobId),
      cad_job_live: inFlight,
    };
  } catch {
    return {};
  }
}

/**
 * @deprecated Force-first permanently disabled — model owns first tool choice.
 * @param {Record<string, unknown>|null|undefined} _mcpCtx
 * @param {unknown[]} _activeTools
 * @returns {null}
 */
export function resolveProfileForceFirstTool(_mcpCtx, _activeTools) {
  return null;
}

/** Last user text in the conversation (for explicit catalog tool pin / force). */
export function lastUserMessageText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c
        .map((b) => {
          if (typeof b === 'string') return b;
          if (b && typeof b === 'object' && typeof b.text === 'string') return b.text;
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
  }
  return '';
}
