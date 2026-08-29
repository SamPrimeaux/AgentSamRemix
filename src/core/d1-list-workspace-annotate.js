/**
 * Annotate the caller's Cloudflare D1 catalog with the session workspace pin.
 * Listing the whole account is not "the workspace database" — a slug-named stub
 * can look canonical and still be empty.
 */
import { DB } from './worker-bindings.js';
import { getAgentsamWorkspace } from '../../backend/identity/workspace/agentsam-workspace.js';
import { resolveWorkspaceD1Catalog } from './workspace-d1-access.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {Array<Record<string, unknown>>} databases
 * @param {{
 *   pinnedDatabaseId?: string,
 *   pinnedDatabaseName?: string,
 *   workspaceSlug?: string,
 *   workerBoundDatabaseId?: string,
 * }} [opts]
 */
/**
 * True when the caller picked a D1 whose Cloudflare name equals the workspace
 * slug, but the workspace pin is a different UUID (the empty-stub trap).
 *
 * @param {{
 *   requestedDatabaseId?: string|null,
 *   requestedDatabaseName?: string|null,
 *   pinnedDatabaseId?: string|null,
 *   workspaceSlug?: string|null,
 * }} input
 */
export function slugNamedDatabaseIsNotPin(input = {}) {
  const requestedId = trim(input.requestedDatabaseId).toLowerCase();
  const pinnedId = trim(input.pinnedDatabaseId).toLowerCase();
  const name = trim(input.requestedDatabaseName).toLowerCase();
  const slug = trim(input.workspaceSlug).toLowerCase();
  if (!requestedId || !pinnedId || !name || !slug) return false;
  if (requestedId === pinnedId) return false;
  return name === slug;
}

export function annotateD1ListWithWorkspacePin(databases, opts = {}) {
  const pinId = trim(opts.pinnedDatabaseId).toLowerCase();
  const pinName = trim(opts.pinnedDatabaseName);
  const slug = trim(opts.workspaceSlug).toLowerCase();
  const workerId = trim(opts.workerBoundDatabaseId).toLowerCase();

  const annotated = (Array.isArray(databases) ? databases : []).map((d) => {
    const id = trim(d?.database_id);
    const name = trim(d?.database_name);
    const idLc = id.toLowerCase();
    const nameLc = name.toLowerCase();
    const workspace_pinned = Boolean(pinId && idLc === pinId);
    const worker_bound = Boolean(workerId && idLc === workerId);
    const name_matches_workspace_slug = Boolean(slug && nameLc === slug);
    const slug_name_is_not_pin = Boolean(
      name_matches_workspace_slug && pinId && idLc !== pinId,
    );
    return {
      ...d,
      database_id: id,
      database_name: name,
      workspace_pinned,
      worker_bound,
      name_matches_workspace_slug,
      ...(slug_name_is_not_pin
        ? {
            do_not_select: true,
            reason: 'name_matches_workspace_slug_but_is_not_workspace_pin',
          }
        : {}),
    };
  });

  annotated.sort((a, b) => {
    if (a.workspace_pinned !== b.workspace_pinned) return a.workspace_pinned ? -1 : 1;
    if (a.worker_bound !== b.worker_bound) return a.worker_bound ? -1 : 1;
    const sizeA = Number(a.file_size) || 0;
    const sizeB = Number(b.file_size) || 0;
    if (sizeA !== sizeB) return sizeB - sizeA;
    return String(a.database_name || '').localeCompare(String(b.database_name || ''));
  });

  const defaultRow =
    annotated.find((row) => row.workspace_pinned) ||
    annotated.find((row) => row.worker_bound) ||
    null;

  return {
    default_database_id: defaultRow?.database_id || (pinId || null),
    default_database_name: defaultRow?.database_name || pinName || null,
    hint: 'Use default_database_id (workspace pin). Do not pick a database because its name matches the workspace slug — that name can belong to an empty stub.',
    databases: annotated,
    count: annotated.length,
  };
}

/**
 * @param {any} env
 * @param {string|null|undefined} workspaceId
 * @param {{
 *   databases?: Array<Record<string, unknown>>,
 *   credential_source?: string|null,
 * }} listed
 */
export async function formatD1ListToolBody(env, workspaceId, listed) {
  const ws = trim(workspaceId);
  let pinnedDatabaseId = '';
  let pinnedDatabaseName = '';
  let workspaceSlug = '';
  if (ws && env?.DB) {
    try {
      const row = await getAgentsamWorkspace(env, ws);
      workspaceSlug = trim(row?.workspace_slug);
      const catalog = resolveWorkspaceD1Catalog(row);
      pinnedDatabaseId = trim(catalog[0]?.database_id) || trim(row?.d1_database_id);
      pinnedDatabaseName = trim(catalog[0]?.database_name);
    } catch {
      pinnedDatabaseId = '';
      pinnedDatabaseName = '';
      workspaceSlug = '';
    }
  }
  const scoped = annotateD1ListWithWorkspacePin(listed?.databases || [], {
    pinnedDatabaseId,
    pinnedDatabaseName,
    workspaceSlug,
    workerBoundDatabaseId: DB.database_id,
  });
  return {
    ...scoped,
    source: 'cloudflare_rest_catalog',
    token_source: listed?.credential_source || null,
  };
}
