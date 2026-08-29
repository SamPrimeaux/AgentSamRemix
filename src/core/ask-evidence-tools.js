/**
 * Ask mode — intent-specific read-only evidence tool selection.
 * Ask is read-only, not tool-less: pin repo/file/D1 tools when the question needs grounding.
 */
import { isReadOnlyRepoSearchIntent } from './code-implementation-intent.js';

/** Tools that score well on generic optional caps but fail or mis-route in Ask today. */
export const ASK_GENERIC_SEARCH_FALLBACKS = Object.freeze([]);

/**
 * User is working across GitHub repos (list/read/write), not only local VM files.
 * @param {string} message
 */
export function githubWorkspaceIntent(_message) {
  return false;
}

/**
 * User wants to mutate repo/editor content (Agent / Multitask — not Ask).
 * @param {string} message
 */
export function agentWriteOrProposeIntent(_message) {
  return false;
}

/**
 * Explicit tool-name pins — Ask mode only. Agent/Multitask/Debug/Plan use route capabilities + catalog scoring.
 * @param {string} message
 * @param {string} [modeSlug]
 */
export function askPinnedEvidenceToolNames(_message, modeSlug = 'ask') {
  // Mode menu owns Ask tools — no message pin list.
  if (String(modeSlug || 'ask').toLowerCase() !== 'ask') return [];
  return [];
}

/**
 * @param {string} message
 */
export function askDataPlaneIntent(_message) {
  return false;
}

/**
 * @param {string} message
 */
export function codeContextIntent(_message) {
  return false;
}

/**
 * Boost route requirements for Ask evidence intents; drop generic semantic search caps.
 * @param {string} message
 * @param {import('./agentsam-route-tool-resolver.js').RouteToolRequirements|null|undefined} base
 */
export function augmentAskRouteRequirements(_message, base, _modeSlug = 'ask') {
  return base && typeof base === 'object' ? base : {};
}

/**
 * Pin concrete read-evidence tools by name (catalog SSOT), then merge with scored picks.
 * @param {any} env
 * @param {{ message: string, workspaceId?: string|null, userId?: string|null, tenantId?: string|null, maxTools: number, scoredRows?: Array<Record<string, unknown>> }} opts
 */
export async function compileAskEvidenceToolRows(env, opts) {
  const pinnedNames = askPinnedEvidenceToolNames(opts.message, opts.modeSlug ?? 'ask');
  if (!env?.DB || !pinnedNames.length) {
    return { pinnedRows: [], mergedRows: opts.scoredRows || [] };
  }

  const { listAgentsamToolsByKeys, mapCatalogRowsToAgentTools } = await import('./agentsam-tools-catalog.js');
  const rawPinned = await listAgentsamToolsByKeys(env, new Set(pinnedNames.map((n) => n.toLowerCase())), {
    workspaceId: opts.workspaceId,
    limit: opts.maxTools,
  });
  const pinnedRows = mapCatalogRowsToAgentTools(rawPinned);

  const seen = new Set(pinnedRows.map((r) => String(r.name || '').trim()).filter(Boolean));
  const merged = [...pinnedRows];
  for (const row of opts.scoredRows || []) {
    const name = String(row.name || row.tool_name || '').trim();
    if (!name || seen.has(name)) continue;
    if (ASK_GENERIC_SEARCH_FALLBACKS.includes(name) && pinnedNames.length > 0) continue;
    merged.push(row);
    seen.add(name);
    if (merged.length >= opts.maxTools) break;
  }

  return { pinnedRows, mergedRows: merged.slice(0, opts.maxTools) };
}
