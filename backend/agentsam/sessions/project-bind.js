/**
 * Conversation ↔ projects.id binding for agentsam_chat_sessions (D1 SSOT).
 *
 * @module backend/agentsam/sessions/project-bind
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Project ref from chat POST body — top-level `project_id` / `projectId` only.
 * Do not read workspaceContext; that is not a project-bind source.
 * @param {Record<string, unknown>|null|undefined} body
 * @returns {string|null}
 */
export function parseSessionProjectIdFromChatBody(body) {
  if (!body || typeof body !== 'object') return null;
  return trim(body.project_id ?? body.projectId) || null;
}

/**
 * Canonical projects.id lookup with explicit failure modes.
 * A DB exception must NEVER be treated as "project does not exist".
 *
 * @param {any} env
 * @param {string|null|undefined} projectRef
 * @param {string|null|undefined} [workspaceId]
 * @returns {Promise<
 *   | { status: 'found', id: string }
 *   | { status: 'not_found' }
 *   | { status: 'lookup_failed', error?: string }
 *   | { status: 'unavailable' }
 * >}
 */
export async function lookupChatProjectId(env, projectRef, workspaceId = null) {
  if (!env?.DB) return { status: 'unavailable' };
  const ref = String(projectRef || '').trim();
  if (!ref) return { status: 'not_found' };

  try {
    let sql = `SELECT id FROM projects WHERE id = ?`;
    const binds = [ref];
    if (workspaceId) {
      sql += ` AND (workspace_id IS NULL OR workspace_id = ?)`;
      binds.push(String(workspaceId));
    }
    sql += ` LIMIT 1`;
    const proj = await env.DB.prepare(sql).bind(...binds).first();
    if (proj?.id) return { status: 'found', id: String(proj.id) };
    return { status: 'not_found' };
  } catch (e) {
    return { status: 'lookup_failed', error: e?.message ? String(e.message) : 'lookup_failed' };
  }
}

/**
 * Resolve the project used to scope one conversation's tools/resources.
 * Sticky when D1 already has a known `projects.id`. Explicit scope selection/clear
 * can replace or remove an existing bind. This function does not authorize prompt context.
 *
 * Only `not_found` may clear a sticky binding. `lookup_failed` preserves it.
 *
 * @param {any} env
 * @param {{
 *   conversationId?: string|null,
 *   userId?: string|null,
 *   tenantId?: string|null,
 *   requestedProjectRef?: string|null,
 *   scopeExplicit?: boolean,
 *   clear?: boolean,
 * }} input
 */
export async function resolveConversationProjectRef(env, input) {
  const conversationId = trim(input?.conversationId);
  const userId = trim(input?.userId);
  const tenantId = trim(input?.tenantId);
  const requestedProjectRef = trim(input?.requestedProjectRef);
  const explicit = input?.explicit === true;
  const clear = input?.clear === true;

  if (!env?.DB || !conversationId || !userId || !tenantId) {
    return {
      projectRef: clear ? null : requestedProjectRef || null,
      source: clear ? 'explicit_clear' : requestedProjectRef ? 'request_no_db' : 'unbound',
      conversationFound: false,
    };
  }

  const row = await env.DB.prepare(
    `SELECT project_id
     FROM agentsam_chat_sessions
     WHERE conversation_id = ? AND user_id = ? AND tenant_id = ?
     LIMIT 1`,
  )
    .bind(conversationId, userId, tenantId)
    .first()
    .catch(() => null);

  if (row) {
    const existing = trim(row.project_id) || null;

    if (explicit) {
      const nextRef = clear ? null : requestedProjectRef || null;
      if (clear || !nextRef) {
        return {
          projectRef: null,
          source: clear ? 'explicit_clear' : 'explicit_request_unknown',
          conversationFound: true,
        };
      }
      const looked = await lookupChatProjectId(env, nextRef);
      if (looked.status === 'found') {
        return { projectRef: looked.id, source: 'explicit_request', conversationFound: true };
      }
      if (looked.status === 'lookup_failed') {
        console.warn(
          '[sessions/project-bind] explicit_lookup_failed',
          JSON.stringify({ conversation_id: conversationId, project_ref: nextRef }),
        );
        return {
          projectRef: existing,
          source: 'explicit_lookup_failed',
          conversationFound: true,
        };
      }
      return {
        projectRef: null,
        source: 'explicit_request_unknown',
        conversationFound: true,
      };
    }

    if (existing) {
      const looked = await lookupChatProjectId(env, existing);
      if (looked.status === 'found') {
        return {
          projectRef: looked.id,
          source: 'conversation',
          conversationFound: true,
        };
      }
      if (looked.status === 'lookup_failed' || looked.status === 'unavailable') {
        console.warn(
          '[sessions/project-bind] sticky_lookup_failed_preserving',
          JSON.stringify({ conversation_id: conversationId, project_id: existing }),
        );
        return {
          projectRef: existing,
          source: 'conversation_lookup_failed',
          conversationFound: true,
        };
      }
      // not_found only — genuine stale bind
      await env.DB.prepare(
        `UPDATE agentsam_chat_sessions
            SET project_id = NULL, updated_at = unixepoch()
          WHERE conversation_id = ? AND user_id = ? AND tenant_id = ?`,
      )
        .bind(conversationId, userId, tenantId)
        .run()
        .catch(() => null);
      console.warn(
        '[sessions/project-bind] cleared_invalid_sticky_project_id',
        JSON.stringify({ conversation_id: conversationId, invalid_project_id: existing }),
      );
      return {
        projectRef: null,
        source: 'conversation_invalid_cleared',
        conversationFound: true,
      };
    }

    return {
      projectRef: null,
      source: 'conversation_unbound',
      conversationFound: true,
    };
  }

  if (clear || !explicit || !requestedProjectRef) {
    return {
      projectRef: null,
      source: clear ? 'explicit_clear' : 'unbound',
      conversationFound: false,
    };
  }
  const lookedNew = await lookupChatProjectId(env, requestedProjectRef);
  if (lookedNew.status === 'found') {
    return {
      projectRef: lookedNew.id,
      source: 'explicit_request',
      conversationFound: false,
    };
  }
  return {
    projectRef: null,
    source: lookedNew.status === 'lookup_failed' ? 'explicit_lookup_failed' : 'explicit_request_unknown',
    conversationFound: false,
  };
}

/**
 * Canonical chat project id = `projects.id`. Unknown refs → null (never echoed).
 * Lookup failures also return null — callers that mutate sticky state must use
 * {@link lookupChatProjectId} instead.
 *
 * @param {any} env
 * @param {string|null|undefined} projectRef
 * @param {string|null|undefined} [workspaceId]
 * @returns {Promise<string|null>}
 */
export async function resolveChatProjectId(env, projectRef, workspaceId = null) {
  const looked = await lookupChatProjectId(env, projectRef, workspaceId);
  return looked.status === 'found' ? looked.id : null;
}

/**
 * @param {any} env
 * @param {string|null|undefined} chatProjectId
 * @returns {Promise<string|null>} projects.id when known
 */
export async function resolveProjectsTableId(env, chatProjectId) {
  return resolveChatProjectId(env, chatProjectId);
}

/**
 * @param {any} env
 * @param {string|null|undefined} projectRef
 * @param {string|null|undefined} [workspaceId]
 * @returns {Promise<{ wpId: string|null, projectsId: string|null }>}
 */
export async function expandChatProjectRefs(env, projectRef, workspaceId = null) {
  const projectsId = await resolveChatProjectId(env, projectRef, workspaceId);
  return {
    wpId: null,
    projectsId,
  };
}

/**
 * Resolve project_id for first-message INSERT when the turn is explicitly project-scoped.
 * Never COALESCE-fill from an ambient client project_id.
 *
 * @param {any} env
 * @param {{
 *   projectExplicit?: boolean,
 *   projectRef?: string|null,
 *   body?: Record<string, unknown>|null,
 *   workspaceId?: string|null,
 * }} input
 * @returns {Promise<string|null>}
 */
export async function resolveExplicitSessionProjectId(env, input) {
  if (input.projectExplicit !== true) return null;
  const projectRef = Object.prototype.hasOwnProperty.call(input, 'projectRef')
    ? String(input.projectRef || '').trim() || null
    : parseSessionProjectIdFromChatBody(input.body ?? null);
  if (!projectRef) return null;
  return resolveChatProjectId(env, projectRef, input.workspaceId ?? null);
}

/**
 * Resolve project_id patch for agentsam_chat_sessions.
 * `lookup_failed` → no project change (do not clear).
 * `not_found` → clear (unknown explicit ref).
 *
 * @param {any} env
 * @param {Record<string, unknown>} patch
 * @returns {Promise<{ action: 'null' } | { action: 'set', value: string } | null>}
 */
export async function resolveSessionPatchProjectId(env, patch) {
  if (patch.project_id === null || patch.project_id === '') {
    return { action: 'null' };
  }
  if (typeof patch.project_id === 'string' && patch.project_id.trim()) {
    const looked = await lookupChatProjectId(
      env,
      patch.project_id.trim(),
      patch.workspace_id || null,
    );
    if (looked.status === 'found') return { action: 'set', value: looked.id };
    if (looked.status === 'lookup_failed' || looked.status === 'unavailable') {
      console.warn(
        '[sessions/project-bind] patch_lookup_failed_no_change',
        JSON.stringify({ project_id: patch.project_id }),
      );
      return null;
    }
    return { action: 'null' };
  }
  return null;
}
