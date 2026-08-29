/**
 * API Service: Workspace Operations
 * Handles ephemeral workspace states, file explorer root resolution, and workspace creation.
 * Deconstructed from legacy worker.js.
 */
import { jsonResponse } from '../core/auth.js';
import { listAccessibleWorkspaces } from '../../backend/identity/workspace/access.js';
import { handleAgentsamWorkspacesApi } from './workspaces.js';
import { resolveIdentity } from '../../backend/identity/index.js';
import { selectWorkspace } from '../../backend/identity/workspace/index.js';


/**
 * Main dispatcher for Workspace-related API routes (/api/workspaces/*, /api/workspace/*).
 */
export async function handleWorkspaceApi(request, url, env, ctx, authUser) {
    const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
    const method = request.method.toUpperCase();

    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    let identity;
    try {
        identity = await resolveIdentity(request, env);
    } catch (error) {
        const status = Number(error?.status);
        return jsonResponse(
            { error: error?.code || error?.message || 'Identity resolution failed' },
            status >= 400 && status < 600 ? status : 500,
        );
    }
    const resolvedWorkspaceId = identity.workspace?.id || null;

    // ── GET /api/workspace/settings ─────────────────────────────────────────
    if (pathLower === '/api/workspace/settings' && method === 'GET') {
        const workspaceId = resolvedWorkspaceId;
        const userId = String(authUser.id || '').trim();
        const tenantId = authUser.tenant_id != null && String(authUser.tenant_id).trim() !== '' ? String(authUser.tenant_id).trim() : null;
        const defaults = { workspace_id: workspaceId || null, theme: null, timezone: 'UTC', locale: 'en', settings_json: {} };
        if (!workspaceId) return jsonResponse(defaults);
        try {
            const row = await env.DB.prepare(
                `SELECT workspace_id, theme, timezone, locale, settings_json
                 FROM workspace_settings WHERE workspace_id = ? LIMIT 1`,
            ).bind(workspaceId).first();
            if (row) {
                let settingsObj = {};
                try { settingsObj = row.settings_json ? JSON.parse(row.settings_json) : {}; } catch { settingsObj = {}; }
                return jsonResponse({
                    workspace_id: row.workspace_id,
                    theme: row.theme ?? null,
                    timezone: row.timezone ?? 'UTC',
                    locale: row.locale ?? 'en',
                    settings_json: settingsObj,
                });
            }
        } catch (_) {
            // table may not exist; fall through to defaults
        }
        // Upsert defaults if possible
        try {
            await env.DB.prepare(
                `INSERT INTO workspace_settings (workspace_id, theme, timezone, locale, settings_json, updated_at)
                 VALUES (?, NULL, 'UTC', 'en', '{}', unixepoch())
                 ON CONFLICT(workspace_id) DO UPDATE SET updated_at = excluded.updated_at`,
            ).bind(workspaceId).run();
        } catch (_) {}
        return jsonResponse(defaults);
    }

    // ── GET /api/workspace/list ─────────────────────────────────────────────
    if (pathLower === '/api/workspace/list' && method === 'GET') {
        try {
            const results = await listAccessibleWorkspaces(env.DB, env, authUser, { limit: 200 });
            const rows = (results || []).map((w) => ({
                id: w.id,
                name: w.name ?? w.display_name ?? w.id,
                type: w.workspace_type ?? w.type ?? null,
                status: w.status ?? null,
                created_at: w.created_at ?? null,
                updated_at: w.updated_at ?? null,
            }));
            return jsonResponse({ workspaces: rows });
        } catch (_) {
            return jsonResponse({ workspaces: [] });
        }
    }

    const agentsamRes = await handleAgentsamWorkspacesApi(request, url, env, ctx, authUser);
    if (agentsamRes) return agentsamRes;

    // Local Explorer folder browsing is browser-only for scratch folders.
    // Curated product workspaces bind via POST /api/workspace/local-bind (real ws_* only).
    if (pathLower === '/api/workspace/create' && method === 'POST') {
        return jsonResponse(
            {
                error: 'local_explorer_client_only',
                detail:
                    'Scratch folder open is browser-local only. Curated repos use POST /api/workspace/local-bind → real ws_*.',
            },
            410,
        );
    }

    // ── POST /api/workspace/local-bind ─────────────────────────────────────
    // Match Local Explorer folder (and optional git remote) to a curated workspace.
    // Match → activate + upsert agentsam_workspace_state under that real workspace_id.
    // No match → { bound:false }, zero D1 writes.
    if (pathLower === '/api/workspace/local-bind' && method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const folderName = typeof body.folderName === 'string' ? body.folderName.trim() : '';
        const githubRemote =
            typeof body.github_repo === 'string'
                ? body.github_repo.trim()
                : typeof body.githubRemote === 'string'
                  ? body.githubRemote.trim()
                  : '';
        if (!folderName && !githubRemote) {
            return jsonResponse({ error: 'folderName_or_github_repo_required' }, 400);
        }

        const { listAccessibleWorkspaces } = await import('../../backend/identity/workspace/access.js');
        const { matchLocalFolderToWorkspace, githubRepoName } = await import(
            '../core/match-local-folder-to-workspace.js'
        );

        const rows = await listAccessibleWorkspaces(env.DB, env, authUser, { limit: 200 });
        const candidates = (rows || []).map((w) => ({
            id: w.id,
            name: w.name ?? w.display_name ?? null,
            slug: w.slug ?? w.handle ?? null,
            github_repo: w.github_repo ?? null,
            root_path: w.root_path ?? null,
            pty_path: w.pty_path ?? null,
        }));

        let hit = folderName ? matchLocalFolderToWorkspace(folderName, candidates) : null;
        if (!hit && githubRemote) {
            const want = githubRepoName(githubRemote).toLowerCase();
            const full = githubRemote.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').toLowerCase();
            const ghHits = candidates.filter((c) => {
                const g = String(c.github_repo || '')
                    .replace(/^https?:\/\/github\.com\//i, '')
                    .replace(/\.git$/i, '')
                    .toLowerCase();
                if (!g) return false;
                return g === full || githubRepoName(g).toLowerCase() === want;
            });
            if (ghHits.length === 1) {
                hit = { id: ghHits[0].id, reason: 'github_remote' };
            }
        }

        if (!hit) {
            return jsonResponse({
                ok: true,
                bound: false,
                detail: 'No curated workspace match — scratch stays browser-local; no D1 write.',
            });
        }

        const workspaceId = hit.id;
        const nowMs = Date.now();
        const existing = await env.DB.prepare(
            `SELECT id, state_json FROM agentsam_workspace_state WHERE workspace_id = ? LIMIT 1`,
        )
            .bind(workspaceId)
            .first()
            .catch(() => null);

        let stateObj = {};
        try {
            stateObj = existing?.state_json ? JSON.parse(existing.state_json) : {};
        } catch {
            stateObj = {};
        }
        if (!stateObj || typeof stateObj !== 'object') stateObj = {};
        stateObj.local_explorer = {
            schema: 'local_explorer_bind_v1',
            folderName: folderName || null,
            github_repo: githubRemote || null,
            bind_reason: hit.reason,
            lastOpenedAt: nowMs,
            last_device_hint: typeof body.device_hint === 'string' ? body.device_hint.slice(0, 64) : null,
        };
        const stateJson = JSON.stringify(stateObj);

        if (existing?.id) {
            await env.DB.prepare(
                `UPDATE agentsam_workspace_state
                 SET state_json = ?, workspace_type = COALESCE(workspace_type, 'ide'), updated_at = unixepoch()
                 WHERE id = ?`,
            )
                .bind(stateJson, existing.id)
                .run();
        } else {
            await env.DB.prepare(
                `INSERT INTO agentsam_workspace_state (
                   id, workspace_id, workspace_type, files_open, state_json, created_at, updated_at
                 ) VALUES ('wss_' || lower(hex(randomblob(8))), ?, 'ide', '[]', ?, unixepoch(), unixepoch())`,
            )
                .bind(workspaceId, stateJson)
                .run();
        }

        const userId = String(authUser.id || '').trim();
        if (userId) {
            await selectWorkspace(env, {
                userId,
                workspaceId,
            });
        }

        const proof = await env.DB.prepare(
            `SELECT id, workspace_id, workspace_type, state_json, updated_at
             FROM agentsam_workspace_state WHERE workspace_id = ? LIMIT 1`,
        )
            .bind(workspaceId)
            .first();

        return jsonResponse({
            ok: true,
            bound: true,
            workspace_id: workspaceId,
            reason: hit.reason,
            state_row: proof
                ? {
                      id: proof.id,
                      workspace_id: proof.workspace_id,
                      workspace_type: proof.workspace_type,
                      updated_at: proof.updated_at,
                      local_explorer: stateObj.local_explorer,
                  }
                : null,
        });
    }

    const userWsMatch = pathLower.match(/^\/api\/workspace\/([^/]+)$/);
    if (userWsMatch && userWsMatch[1] !== 'create' && userWsMatch[1] !== 'local-bind' && (method === 'GET' || method === 'PATCH')) {
        return jsonResponse(
            {
                error: 'local_explorer_client_only',
                detail: 'Ephemeral Local Explorer D1 UUID state was removed. Use /api/workspace/local-bind for curated ws_*.',
            },
            410,
        );
    }

    // ── /api/workspaces/current/shell ───────────────────────────────────────
    if (pathLower === '/api/workspaces/current/shell' && method === 'GET') {
        return jsonResponse({
            workspace_id: resolvedWorkspaceId,
            product_name: 'IAM Explorer',
            version: 'v6'
        });
    }

    return jsonResponse({ error: 'Workspace route not found or not yet modularized' }, 404);
}
