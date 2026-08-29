/**
 * Read-only repo audit / multitask report-child tool contract.
 * Pins/exclusions live in D1 mode profiles — no JS tool-name menus.
 */
import { isReadOnlyFileContextIntent, isReadOnlyRepoSearchIntent } from './code-implementation-intent.js';

export const READONLY_REPO_AUDIT_ROUTE_KEY = 'readonly_repo_audit';

/** @deprecated empty — D1 profiles own evidence menus */
export const CORE_EVIDENCE_TOOL_NAMES = Object.freeze([]);

export const OPTIONAL_EVIDENCE_TOOL_NAMES = Object.freeze([]);

export const REPORT_CHILD_EXCLUDED_TOOL_NAMES = Object.freeze([]);

/**
 * Repo audit / read-only multitask report context (parent or child).
 * @param {unknown} message
 */
export function isReadonlyRepoAuditContext(_message) {
  return false;
}

/**
 * @param {unknown} message
 */
export function readonlyRepoAuditPinnedToolNames(_message) {
  // No JS pin list — D1 mode profiles own evidence tools.
  return [];
}

/**
 * @param {unknown} message
 * @returns {string[]}
 */
export function extractRequestedRepoPaths(message) {
  const m = String(message || '');
  const out = new Set();
  const re =
    /\b(?:src|dashboard|migrations|tests)\/[\w./-]+\.(?:js|tsx|ts|jsx|sql|md|mjs|cjs)\b|\b[\w.-]+\.(?:js|tsx|ts|jsx)\b/gi;
  let match;
  while ((match = re.exec(m)) !== null) {
    const p = String(match[0] || '').trim();
    if (p) out.add(p);
  }
  return [...out].slice(0, 32);
}

/**
 * @param {string} message
 * @param {import('./agentsam-route-tool-resolver.js').RouteToolRequirements|null|undefined} base
 */
export function augmentReadonlyRepoAuditRouteRequirements(message, base) {
  const req = base
    ? {
        ...base,
        required_capabilities: [...(base.required_capabilities || [])],
        optional_capabilities: [...(base.optional_capabilities || [])],
        blocked_capabilities: [...(base.blocked_capabilities || [])],
      }
    : {
        route_key: READONLY_REPO_AUDIT_ROUTE_KEY,
        task_type: 'quick',
        allowed_lanes: ['inspect', 'develop', 'research', 'observe'],
        required_capabilities: [],
        optional_capabilities: [],
        blocked_capabilities: [],
        max_tools: 8,
        approval_policy: null,
        source: 'readonly_repo_audit',
      };

  req.allowed_lanes = [...new Set([...(req.allowed_lanes || []), 'inspect', 'develop', 'research', 'observe'])];

  for (const cap of [
    'file.read',
    'repo_file_read',
    'code_read',
    'code.search',
    'code_search',
    'repo_search',
    'github.read',
    'grep',
    'd1.read',
    'd1.schema',
  ]) {
    req.optional_capabilities.push(cap);
  }

  for (const cap of [
    'memory.write',
    'memory.save',
    'knowledge.search',
    'rag.search',
    'context.search',
    'terminal.execute',
    'worker.deploy',
    'd1.write',
    'python.execute',
  ]) {
    req.blocked_capabilities.push(cap);
  }

  req.optional_capabilities = [...new Set(req.optional_capabilities.map(String))];
  req.blocked_capabilities = [...new Set(req.blocked_capabilities.map(String))];
  req.max_tools = Math.max(Number(req.max_tools) || 0, 8);
  return req;
}

/**
 * Pin evidence catalog rows before scored picks (survives max_tools cap).
 * @param {any} env
 * @param {{ message: string, workspaceId?: string|null, maxTools: number, scoredRows?: Array<Record<string, unknown>> }} opts
 */
export async function compileReadonlyRepoAuditToolRows(_env, opts) {
  // No JS pin/exclude lists — scored/profile rows pass through unchanged.
  return { pinnedRows: [], mergedRows: opts.scoredRows || [] };
}

/**
 * @param {Array<Record<string, unknown>>} tools
 */
export function filterReportChildOrchestrationTools(tools) {
  // Exclusion lists live in D1 mode/write policy — no JS name/regex deny bar.
  return Array.isArray(tools) ? tools : [];
}

/**
 * Which core evidence tools are active in agentsam_tools for this workspace.
 * @param {any} env
 * @param {string|null|undefined} workspaceId
 */
export async function resolveActiveCoreEvidenceToolNames(env, workspaceId) {
  if (!env?.DB) return [...CORE_EVIDENCE_TOOL_NAMES];
  const { listAgentsamToolsByKeys } = await import('./agentsam-tools-catalog.js');
  const rows = await listAgentsamToolsByKeys(
    env,
    new Set(CORE_EVIDENCE_TOOL_NAMES.map((n) => n.toLowerCase())),
    { workspaceId, limit: CORE_EVIDENCE_TOOL_NAMES.length },
  );
  const found = new Set(rows.map((r) => String(r.tool_name || r.tool_key || '').trim()).filter(Boolean));
  const active = CORE_EVIDENCE_TOOL_NAMES.filter((n) => found.has(n));
  return active.length ? active : [...CORE_EVIDENCE_TOOL_NAMES];
}

/**
 * @param {string[]} modelFacingToolNames
 * @param {string[]} [requiredNames]
 */
export function assessRequiredEvidenceToolsPresent(modelFacingToolNames, requiredNames = CORE_EVIDENCE_TOOL_NAMES) {
  const compiled = new Set((modelFacingToolNames || []).map((n) => String(n || '').trim()).filter(Boolean));
  const missing = [];
  for (const name of requiredNames) {
    if (!compiled.has(name)) missing.push(name);
  }
  return {
    required_evidence_tools_present: missing.length === 0,
    missing,
    present: requiredNames.filter((n) => compiled.has(n)),
  };
}
