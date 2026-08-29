/**
 * Phase 5 routes extracted from handleAgentApi (mechanical move).
 * Ticket: tkt_agent_js_phase5_workspace_2026_08
 * Family: /api/agent/workspace/:id (GET/PUT/POST)
 *
 * Tables: agentsam_workspace (registry), agentsam_workspace_state (state),
 * legacy workspaces (parallel state_json write on PUT).
 *
 * PUT and POST (ws_* ids) both upsert agentsam_workspace_state on the same
 * UNIQUE(workspace_id) index and rely on the column defaults for id/workspace_type
 * ('wss_'||hex(randomblob(8)), 'ide') — do not reintroduce a JS-generated id prefix
 * or a SELECT-then-INSERT pattern here; that previously raced under concurrent POSTs.
 *
 * @returns {Promise<Response|null>} Response if handled; null to continue dispatcher
 */
import { jsonResponse } from '../shared.js';
import { authUserFromRequest, fetchAuthUserTenantId } from '../../../identity/index.js';
import { userCanAccessWorkspace } from '../../../identity/workspace/access.js';

export async function handleAgentWorkspaceApi(request, url, env, ctx, routeAuth, identity) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const ra =
    routeAuth && typeof routeAuth === 'object' && 'authCtx' in routeAuth
      ? routeAuth
      : { authUser: routeAuth, authCtx: null };

  if (!path.startsWith('/api/agent/workspace/')) {
    return null;
  }

  // ── /api/agent/workspace/:id ──────────────────────────────────────────────
  const workspaceMatch = path.match(/^\/api\/agent\/workspace\/([^/]+)$/);
  if (workspaceMatch) {
    const wsId = decodeURIComponent(workspaceMatch[1] || '').trim();
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    // ── /api/agent/workspace/:id ────────────────────────────────────────────
    // ── /api/agent/workspace/:id ────────────────────────────────────────────
    if (method === 'GET') {
      try {
        const userId = String(authUser?.id || 'anonymous').trim();
        let tid =
          authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== ''
            ? String(authUser.tenant_id).trim()
            : '';
        if (!tid) tid = (await fetchAuthUserTenantId(env, authUser.id)) || '';
        if (!tid && authUser.email) tid = (await fetchAuthUserTenantId(env, authUser.email)) || '';
        if (!tid) return jsonResponse({ error: 'Tenant not configured for this account' }, 403);

        const safeJson = (v) => {
          if (!v) return {};
          if (typeof v === 'object' && v !== null) return v;
          try { return JSON.parse(String(v)); } catch { return {}; }
        };
        const parseFilesOpen = (raw) => {
          if (Array.isArray(raw)) return raw;
          try {
            const parsed = JSON.parse(String(raw || '[]'));
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        };

        const isWorkspaceKey = /^ws_/i.test(wsId);

        // Platform workspace id (ws_*) — resume spine from agentsam_workspace_state.workspace_id.
        if (isWorkspaceKey) {
          const canWs = await userCanAccessWorkspace(env, authUser, wsId).catch(() => false);
          if (!canWs) return jsonResponse({ error: 'Forbidden' }, 403);

          const awsRow = await env.DB.prepare(
            `SELECT workspace_id, conversation_id, active_file, files_open, state_json, updated_at, created_at
             FROM agentsam_workspace_state
             WHERE workspace_id = ?
             LIMIT 1`,
          )
            .bind(wsId)
            .first()
            .catch(() => null);

          const stateObj = safeJson(awsRow?.state_json);
          const stateJsonStr =
            typeof awsRow?.state_json === 'string' && awsRow.state_json.trim()
              ? awsRow.state_json
              : JSON.stringify(stateObj || {});

          if (!awsRow) {
            return jsonResponse({
              workspace_id: wsId,
              exists: false,
              conversation_id: null,
              active_file: null,
              files_open: [],
              updated_at: null,
              created_at: null,
            });
          }

          return jsonResponse({
            id: wsId,
            workspace_id: wsId,
            exists: true,
            conversation_id: awsRow.conversation_id ?? null,
            active_file: awsRow.active_file ?? null,
            files_open: parseFilesOpen(awsRow.files_open),
            updated_at: awsRow.updated_at ?? null,
            created_at: awsRow.created_at ?? null,
            name: 'Workspace',
            environment: 'local',
            status: 'active',
            settings: {},
            state: stateObj,
            state_json: stateJsonStr,
          });
        }

        // Conversation-scoped IDE bundle (UUID) — legacy uws:* row id.
        const uwsId = `uws:${tid}:${userId}:${wsId}`;
        const personalWs = await env.DB.prepare(
          `SELECT state_json, updated_at, conversation_id, active_file, files_open, workspace_id
           FROM agentsam_workspace_state WHERE id = ? LIMIT 1`,
        )
          .bind(uwsId)
          .first()
          .catch(() => null);

        if (personalWs) {
          const stateObj = safeJson(personalWs.state_json);
          const stateJsonStr =
            typeof personalWs.state_json === 'string' && personalWs.state_json.trim()
              ? personalWs.state_json
              : JSON.stringify(stateObj || {});
          return jsonResponse({
            id: wsId,
            workspace_id: personalWs.workspace_id ?? null,
            conversation_id: personalWs.conversation_id ?? wsId,
            active_file: personalWs.active_file ?? null,
            files_open: parseFilesOpen(personalWs.files_open),
            updated_at: personalWs.updated_at ?? null,
            name: 'Personal',
            environment: 'local',
            status: 'active',
            settings: {},
            state: stateObj,
            state_json: stateJsonStr,
          });
        }

        const globalWs = await env.DB.prepare(
          `SELECT * FROM workspaces WHERE id = ? OR handle = ? LIMIT 1`,
        )
          .bind(wsId, wsId)
          .first()
          .catch(() => null);

        if (globalWs) {
          const stateObj = safeJson(globalWs.state_json);
          const stateJsonStr =
            typeof globalWs.state_json === 'string' && globalWs.state_json.trim()
              ? globalWs.state_json
              : JSON.stringify(stateObj || {});
          return jsonResponse({
            id: globalWs.id,
            workspace_id: globalWs.id,
            conversation_id: null,
            active_file: null,
            files_open: [],
            updated_at: null,
            name: globalWs.name || 'Workspace',
            environment: globalWs.environment || 'local',
            status: globalWs.status || 'active',
            settings: safeJson(globalWs.settings_json),
            state: stateObj,
            state_json: stateJsonStr,
          });
        }

        return jsonResponse({ workspace_id: wsId, exists: false }, 200);
      } catch (e) {
        return jsonResponse({ error: `Fetch error: ${e.message}` }, 500);
      }
    }

    if (method === 'PUT') {
      try {
        const body = await request.json().catch(() => ({}));
        const state = body.state || body.state_json;
        const stateStr = typeof state === 'string' ? state : JSON.stringify(state || {});

        const userId = String(authUser?.id || 'anonymous').trim();
        let tid =
          authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== ''
            ? String(authUser.tenant_id).trim()
            : '';
        if (!tid) tid = (await fetchAuthUserTenantId(env, authUser.id)) || '';
        if (!tid && authUser.email) tid = (await fetchAuthUserTenantId(env, authUser.email)) || '';
        if (!tid) return jsonResponse({ error: 'Tenant not configured for this account' }, 403);

        if (/^ws_/i.test(wsId)) {
          const canWs = await userCanAccessWorkspace(env, authUser, wsId).catch(() => false);
          if (!canWs) return jsonResponse({ error: 'Forbidden' }, 403);
          await env.DB.prepare(
            `INSERT INTO agentsam_workspace_state (workspace_id, state_json, updated_at)
             VALUES (?, ?, unixepoch())
             ON CONFLICT(workspace_id) DO UPDATE SET
               state_json = excluded.state_json,
               updated_at = unixepoch()`,
          )
            .bind(wsId, stateStr)
            .run();
          return jsonResponse({ ok: true, id: wsId, workspace_id: wsId });
        }

        const uwsId = `uws:${tid}:${userId}:${wsId}`;
        try {
          if (env.DB) {
            const upsertConversationWorkspaceState = async () => {
              const existing = await env.DB.prepare(
                `SELECT id FROM agentsam_workspace_state WHERE id = ? LIMIT 1`,
              )
                .bind(uwsId)
                .first()
                .catch(() => null);
              if (existing) {
                await env.DB.prepare(
                  `UPDATE agentsam_workspace_state SET state_json = ?, updated_at = unixepoch() WHERE id = ?`,
                )
                  .bind(stateStr, uwsId)
                  .run();
                return;
              }
              const workspaceRow = await env.DB.prepare(
                `SELECT id FROM agentsam_workspace WHERE id = ? LIMIT 1`,
              )
                .bind(wsId)
                .first()
                .catch(() => null);
              if (!workspaceRow) return;
              let conversationId = null;
              const convCandidate = String(wsId || '').trim();
              if (convCandidate) {
                const convRow = await env.DB.prepare(
                  `SELECT conversation_id FROM agentsam_chat_sessions WHERE conversation_id = ? LIMIT 1`,
                )
                  .bind(convCandidate)
                  .first()
                  .catch(() => null);
                if (convRow) conversationId = convCandidate;
              }
              await env.DB.prepare(
                `INSERT INTO agentsam_workspace_state (id, workspace_id, state_json, conversation_id, workspace_type, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'ide', unixepoch(), unixepoch())`,
              )
                .bind(uwsId, wsId, stateStr, conversationId)
                .run();
            };
            const results = await Promise.allSettled([
              env.DB.prepare(`UPDATE workspaces SET state_json = ?, updated_at = datetime('now') WHERE id = ?`)
                .bind(stateStr, wsId).run(),
              upsertConversationWorkspaceState(),
            ]);
            results.forEach((r, i) => {
              if (r.status === 'rejected') {
                console.warn('[agent] workspace update op', i, 'rejected:', r.reason);
              }
            });
          }
        } catch (dbErr) {
          console.warn('[agent] non-critical workspace update failure:', dbErr.message);
        }

        return jsonResponse({ ok: true, id: wsId });
      } catch (e) {
        console.error('[agent] workspace PUT error:', e.stack);
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (method === 'POST') {
      const isAgentsamWs = /^ws_/i.test(wsId);
      if (!isAgentsamWs) {
        return jsonResponse(
          { error: 'Use PUT for conversation workspace snapshots; POST merge is for ws_* workspace ids.' },
          400,
        );
      }
      try {
        const bodyPost = await request.json().catch(() => ({}));
        if (!bodyPost || typeof bodyPost !== 'object') return jsonResponse({ error: 'Invalid JSON' }, 400);
        const patch = {};
        for (const k of ['active_agent_slug', 'active_agent_panel', 'last_agent_action', 'agent_id']) {
          if (Object.prototype.hasOwnProperty.call(bodyPost, k) && bodyPost[k] != null) patch[k] = bodyPost[k];
        }
        const patchJson = JSON.stringify(patch);
        // Atomic upsert on the same unique(workspace_id) index PUT uses — id and workspace_type
        // come from column defaults ('wss_'||hex(randomblob(8)), 'ide'), same scheme as PUT.
        // json_patch merges server-side so concurrent POSTs can't clobber each other's fields or
        // double-insert (previously: SELECT-then-INSERT could race and silently 503 the second writer).
        try {
          await env.DB.prepare(
            `INSERT INTO agentsam_workspace_state (workspace_id, state_json, updated_at)
             VALUES (?, json(?), unixepoch())
             ON CONFLICT(workspace_id) DO UPDATE SET
               state_json = json_patch(COALESCE(state_json, '{}'), excluded.state_json),
               updated_at = unixepoch()`,
          )
            .bind(wsId, patchJson)
            .run();
        } catch (e3) {
          console.warn('[agent/workspace] agentsam POST upsert', e3?.message ?? e3);
          return jsonResponse({ error: 'agentsam_workspace_state write failed' }, 503);
        }
        return jsonResponse({ ok: true, id: wsId });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }
  }

  return null;
}
