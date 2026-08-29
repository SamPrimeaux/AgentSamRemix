import { jsonResponse } from '../core/responses.js';
import { getAuthUser, fetchAuthUserTenantId } from '../core/auth.js';
import {
    resolveTerminalWorkspaceId,
    WORKSPACE_CONTEXT_MISSING,
} from '../../backend/identity/bootstrap.js';
import {
    resolvePtyTenantIdForUser,
    resolveTerminalCwd,
} from '../../backend/agentsam/terminal/pty-workspace-paths.js';
import { getIntegrationToken } from '../integrations/tokens.js';
import { getWorkspaceTheme, normalizeThemeSlug } from '../core/themes.js';
import { mintSessionToken } from '../../backend/agentsam/terminal/session-auth.js';
import { userCanRunPtyFromPolicy } from '../../backend/http/agentsam/routes/pty-policy.js';
import { buildTerminalConfigStatus } from '../core/terminal-config-status.js';
import {
    buildTerminalCatalogResponse,
    loadTerminalSessionPrefs,
    saveTerminalSessionPrefs,
    parseTerminalPrefs,
    validateTerminalSessionPrefsUpdate,
} from '../core/terminal-assist-prefs.js';
import { purgeStaleTerminalSessions } from '../core/terminal-session-ops.js';
import { buildTerminalSessionDoName } from '../../backend/agentsam/terminal/session-name.js';
import { handleTerminalApi, TERMINAL_CONNECTION_DEPS } from './terminal.js';
import { executeScopedAgentTerminalRun } from '../core/agent-terminal-run.js';
import { runSecurityShieldPulse } from '../core/keys-security.js';

// Canonical catalog/routing dispatcher
import { dispatchStream } from '../../backend/agentsam/runtime/provider-dispatch.js';
import { handleDrawApi } from './draw.js';
import { handleHyperdriveRoutes } from '../integrations/hyperdrive.js';
import {
  handleBrowserRequest,
} from '../../backend/http/browser/routes.js';
import { handleBrowserRunQuickActionsRoute } from '../../backend/http/browser/quick-actions.js';
import { handleGitHubApi } from '../integrations/github.js';
import { resolveGitHubToken } from '../../backend/http/agentsam/routes/git-runtime.js';
import { handleAgentArtifactsApi } from './agent-artifacts.js';

import {
    fetchAgentGitStatus,
    fetchGitStatusFromGitHub,
    fetchWorkspaceGithubRepo,
    setUserWorkspaceActiveBranch,
} from '../../backend/http/agentsam/routes/git-status-runtime.js';

function terminalNotEnabledResponse() {
    return new Response(JSON.stringify({
        error: 'terminal_not_enabled',
        message: 'Terminal access not enabled for your account',
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
}

/** PTY tenant + cwd from workspace_settings (local) or ExecOS home (GCP remote). */
async function resolveTerminalIdentityContext(env, authUser, workspaceId = null) {
    const userId = String(authUser?.id || '').trim();
    const tenantId = await resolvePtyTenantIdForUser(env, authUser, userId);
    let workingDir = null;
    const wid = workspaceId != null ? String(workspaceId).trim() : '';
    if (wid && env?.DB) {
        const cwdResolved = await resolveTerminalCwd(env, {
            tenantId,
            userId,
            workspaceId: wid,
        });
        workingDir = cwdResolved.cwd;
    }
    const personUuid =
        authUser?.person_uuid != null && String(authUser.person_uuid).trim() !== ''
            ? String(authUser.person_uuid).trim()
            : null;
    return { userId, tenantId, workingDir, personUuid };
}

function applyTerminalIdentityToDoUrl(doUrl, ctx) {
    if (ctx.tenantId) doUrl.searchParams.set('tenant_id', ctx.tenantId);
    if (ctx.personUuid) doUrl.searchParams.set('person_uuid', ctx.personUuid);
    if (ctx.userId) doUrl.searchParams.set('user_id', ctx.userId);
    if (ctx.workingDir) doUrl.searchParams.set('cwd', ctx.workingDir);
}

/**
 * Main dispatcher for Dashboard-related API routes (/api/agent/*, /api/terminal/*).
 */
export async function handleDashboardApi(request, url, env, ctx) {
    const pathLower = url.pathname.toLowerCase();
    const method = request.method.toUpperCase();
    const isWebSocketUpgrade = (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket';

    const artifactsRes = await handleAgentArtifactsApi(request, url, env);
    if (artifactsRes) return artifactsRes;

    if (pathLower.startsWith('/api/terminal/') && pathLower !== '/api/terminal/session/resume') {
        const termRes = await handleTerminalApi(request, url, env, ctx);
        if (termRes.status !== 404) return termRes;
    }

    // ── GET /api/security/shield-pulse — open findings + audit scan (banner, no secrets) ──
    if (pathLower === '/api/security/shield-pulse' && method === 'GET') {
        console.log('[shield-pulse] handler reached');
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        let tenantId =
            authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
                ? String(authUser.tenant_id).trim()
                : '';
        if (!tenantId) tenantId = (await fetchAuthUserTenantId(env, authUser.id)) || '';
        const notify = url.searchParams.get('notify') === '1' || url.searchParams.get('notify') === 'true';
        const pulse = await runSecurityShieldPulse(env, {
            tenantId,
            userId: String(authUser.id || '').trim(),
            fireNotifications: notify,
        });

        let workspaceId = authUser.workspace_id != null ? String(authUser.workspace_id).trim() : '';
        if (!workspaceId) {
            const tw = await resolveTerminalWorkspaceId(env, request, authUser, url.searchParams.get('workspace_id'));
            workspaceId = tw.workspaceId || '';
        }

        let mcpTokensCheck = 'ok';
        if (env.DB && tenantId) {
            try {
                const mcpRow = await env.DB.prepare(
                    `SELECT COUNT(*) AS c FROM mcp_workspace_tokens
                     WHERE tenant_id = ? AND revoked_at IS NULL
                       AND (? = '' OR user_id IS NULL OR user_id = ?)`,
                )
                    .bind(tenantId, String(authUser.id || '').trim(), String(authUser.id || '').trim())
                    .first();
                mcpTokensCheck = Number(mcpRow?.c) > 0 ? 'ok' : 'none';
            } catch {
                mcpTokensCheck = 'ok';
            }
        }

        return jsonResponse({
            ok: true,
            timestamp: Math.floor(Date.now() / 1000),
            workspace_id: workspaceId || null,
            tenant_id: tenantId || null,
            checks: {
                auth: 'ok',
                mcp_tokens: mcpTokensCheck,
                rate_limits: 'ok',
            },
            ...pulse,
        });
    }

    // ── /api/agent/git/status ────────────────────────────────────────────────
    // Live GitHub API + user OAuth token; workspace.github_repo (no deployments table).
    if (pathLower === '/api/agent/git/status' && method === 'GET') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

        try {
            return jsonResponse(await fetchAgentGitStatus(env, authUser, request, url));
        } catch (e) {
            return jsonResponse({ error: e.message }, 500);
        }
    }

    // ── POST /api/agent/git/branch — persist per-user active branch (D1) ─────
    if (pathLower === '/api/agent/git/branch' && method === 'POST') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
        try {
            const body = await request.json().catch(() => ({}));
            const result = await setUserWorkspaceActiveBranch(env, authUser, request, body);
            if (result.error) return jsonResponse({ error: result.error, ...result }, result.status || 500);
            return jsonResponse(result);
        } catch (e) {
            return jsonResponse({ error: e?.message || 'Update failed' }, 500);
        }
    }

    // ── GET /api/agent/git/branches ───────────────────────────────────────────
    // Same workspace github_repo as /api/agent/git/status (live GitHub REST API).
    if (pathLower === '/api/agent/git/branches' && method === 'GET') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

        try {
            const repoCtx = await fetchWorkspaceGithubRepo(env, authUser, request, url);
            if (repoCtx.error) {
                return jsonResponse(
                    {
                        branches: [],
                        repo_full_name: null,
                        error: repoCtx.error,
                        workspace_id: repoCtx.workspace_id,
                    },
                    repoCtx.status || 500,
                );
            }
            const repoFull = repoCtx.repo;
            const owner = repoFull.split('/')[0];
            const gh = await resolveGitHubToken(authUser, env, owner);
            if (gh.error || !gh.token) {
                return jsonResponse({
                    branches: [],
                    repo_full_name: repoFull,
                    error: 'github_auth',
                    message: gh.error || 'No GitHub token',
                }, gh.status || 401);
            }
            const token = gh.token;

            const ghHeaders = {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'InnerAnimalMedia-Dashboard',
            };

            const all = [];
            for (let page = 1; page <= 5; page++) {
                const res = await fetch(
                    `https://api.github.com/repos/${repoFull}/branches?per_page=100&page=${page}`,
                    { headers: ghHeaders },
                );
                if (!res.ok) {
                    const errBody = await res.text().catch(() => '');
                    return jsonResponse(
                        {
                            branches: [],
                            repo_full_name: repoFull,
                            error: 'github_branches',
                            status: res.status,
                            detail: errBody.slice(0, 300),
                        },
                        res.status >= 400 && res.status < 500 ? res.status : 502,
                    );
                }
                const chunk = await res.json();
                if (!Array.isArray(chunk) || chunk.length === 0) break;
                all.push(...chunk);
                if (chunk.length < 100) break;
            }

            // Fast path: branch list only (Cursor-style). Per-commit metadata was 36+ GitHub
            // subrequests and routinely hit Worker limits / left the UI stuck on "Loading…".
            const branchesOut = [];
            for (const b of all) {
                const name = typeof b.name === 'string' ? b.name : '';
                const sha = b.commit?.sha || '';
                if (!name || !sha) continue;
                branchesOut.push({
                    ref: name,
                    sha,
                    protected: Boolean(b.protected),
                });
            }

            const statusPayload = await fetchGitStatusFromGitHub(env, authUser, request, url);
            const currentBranch =
                statusPayload?.branch != null && String(statusPayload.branch).trim() !== ''
                    ? String(statusPayload.branch).trim()
                    : 'main';

            return jsonResponse({
                current: currentBranch,
                repo: repoFull,
                branches: branchesOut,
                repo_full_name: repoFull,
                branch_source: statusPayload?.branch_source ?? 'default',
                source: 'github_api',
            });
        } catch (e) {
            return jsonResponse({ branches: [], error: e?.message || String(e) }, 500);
        }
    }

    // DEPRECATED PATH: kept for compatibility. ACTIVE PATH is /api/agent/terminal/ws.
    // ── /api/agent/terminal/socket-url ───────────────────────────────────────
    if (pathLower === '/api/agent/terminal/socket-url' && method === 'GET') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        const tw = await resolveTerminalWorkspaceId(env, request, authUser, url.searchParams.get('workspace_id'));
        if (tw.error || !tw.workspaceId) {
            return jsonResponse({ terminal_enabled: false });
        }
        const canPty = await userCanRunPtyFromPolicy(env, authUser.id, tw.workspaceId);
        if (!canPty) {
            return jsonResponse({ terminal_enabled: false });
        }

        const origin = new URL(request.url).origin;
        const wsOrigin = origin.replace('https://', 'wss://').replace('http://', 'ws://');
        return jsonResponse({ terminal_enabled: true, url: `${wsOrigin}/api/agent/terminal/ws` });
    }

    // ── /api/agent/terminal/config-status ────────────────────────────────────
    if (pathLower === '/api/agent/terminal/config-status' && method === 'GET') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        const twCfg = await resolveTerminalWorkspaceId(env, request, authUser, url.searchParams.get('workspace_id'));
        const payload = await buildTerminalConfigStatus(env, authUser, twCfg, {
            target_type: url.searchParams.get('target_type'),
            connection_id: url.searchParams.get('connection_id'),
        }, TERMINAL_CONNECTION_DEPS);
        return jsonResponse(payload);
    }

    // ── /api/agent/terminal/catalog ───────────────────────────────────────────
    if (pathLower === '/api/agent/terminal/catalog' && method === 'GET') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        const twCat = await resolveTerminalWorkspaceId(env, request, authUser, url.searchParams.get('workspace_id'));
        if (!twCat.workspaceId) {
            return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING }, 400);
        }
        const canPtyCat = await userCanRunPtyFromPolicy(env, authUser.id, twCat.workspaceId);
        if (!canPtyCat) {
            return jsonResponse({ error: 'terminal_not_enabled' }, 403);
        }
        const catalogTargetType = (url.searchParams.get('target_type') || '').trim();
        if (!catalogTargetType || catalogTargetType === 'auto') {
            return jsonResponse({
                error: catalogTargetType === 'auto' ? 'target_type_invalid' : 'target_type_required',
            }, 400);
        }
        const catalog = await buildTerminalCatalogResponse(env, authUser, twCat.workspaceId, catalogTargetType, TERMINAL_CONNECTION_DEPS);
        return jsonResponse(catalog);
    }

    // ── POST /api/agent/terminal/session/prefs ────────────────────────────────
    if (pathLower === '/api/agent/terminal/session/prefs' && method === 'POST') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        const twPrefs = await resolveTerminalWorkspaceId(env, request, authUser, null);
        if (!twPrefs.workspaceId) {
            return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING }, 400);
        }
        const canPtyPrefs = await userCanRunPtyFromPolicy(env, authUser.id, twPrefs.workspaceId);
        if (!canPtyPrefs) {
            return jsonResponse({ error: 'terminal_not_enabled' }, 403);
        }
        const body = await request.json().catch(() => ({}));
        const sessionId = String(body?.terminal_session_id || body?.session_id || '').trim();
        if (!sessionId) return jsonResponse({ error: 'terminal_session_id required' }, 400);
        const existing = await loadTerminalSessionPrefs(env, sessionId);
        const merged = parseTerminalPrefs(JSON.stringify({
            ...existing,
            ...(body.terminal_mode != null ? { terminal_mode: body.terminal_mode } : {}),
            ...(body.terminal_ai_enabled != null ? { terminal_ai_enabled: !!body.terminal_ai_enabled } : {}),
            ...(body.active_agent_slug !== undefined ? { active_agent_slug: body.active_agent_slug } : {}),
            ...(body.active_model_key !== undefined ? { active_model_key: body.active_model_key } : {}),
        }));
        const tenantId = await resolvePtyTenantIdForUser(env, authUser, authUser.id);
        const validated = await validateTerminalSessionPrefsUpdate(env, {
            userId: authUser.id,
            workspaceId: twPrefs.workspaceId,
            tenantId,
            prefs: merged,
        });
        if (!validated.ok) {
            return jsonResponse({ error: validated.error || 'invalid_prefs' }, 400);
        }
        const ok = await saveTerminalSessionPrefs(
            env,
            sessionId,
            validated.prefs,
            authUser.id,
            twPrefs.workspaceId,
        );
        if (!ok) return jsonResponse({ error: 'session_not_found_or_forbidden' }, 403);
        return jsonResponse({ ok: true, prefs: validated.prefs });
    }

    // ACTIVE PATH: browser connects here for terminal websocket.
    // ── /api/agent/terminal/ws (authoritative control plane) ────────────────
    if (pathLower === '/api/agent/terminal/ws' && method === 'GET') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        if (!isWebSocketUpgrade) {
            return new Response('Worker expected Upgrade: websocket', { status: 426 });
        }
        if (!env.AGENT_SESSION) return jsonResponse({ error: 'AGENT_SESSION binding missing' }, 503);

        const executionModeRaw = (url.searchParams.get('execution_mode') || 'pty').trim().toLowerCase();
        const executionMode = ['pty', 'ssh', 'mcp', 'batch_exec'].includes(executionModeRaw) ? executionModeRaw : 'pty';
        const tw = await resolveTerminalWorkspaceId(env, request, authUser, url.searchParams.get('workspace_id'));
        if (tw.error === 'Forbidden') return jsonResponse({ error: 'Forbidden' }, 403);
        if (tw.error || !tw.workspaceId) {
            return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
        }
        const workspaceId = tw.workspaceId;
        const userId = String(authUser.id || '').trim();

        // Policy check — replaces isSuperAdmin() gate
        const canPty = await userCanRunPtyFromPolicy(env, userId, workspaceId);
        if (!canPty) {
            return terminalNotEnabledResponse();
        }
        void purgeStaleTerminalSessions(env).catch(() => {});
        /** Optional second+ PTY (split pane); alphanumeric slug → distinct DO instance / upstream PTY. */
        const ptySlotRaw = (url.searchParams.get('pty_slot') || '').trim();
        const ptySlot =
            ptySlotRaw && /^[a-zA-Z0-9_-]{1,16}$/.test(ptySlotRaw) ? ptySlotRaw : '';
        const targetTypeQ = (url.searchParams.get('target_type') || '').trim();
        if (!targetTypeQ || targetTypeQ === 'auto') {
            return jsonResponse({
                error: targetTypeQ === 'auto' ? 'target_type_invalid' : 'target_type_required',
                code: targetTypeQ === 'auto' ? 'target_type_invalid' : 'target_type_required',
            }, 400);
        }
        const ptyClientRaw = (url.searchParams.get('pty_client') || '').trim();
        let sessionName;
        try {
            sessionName = buildTerminalSessionDoName({
                userId,
                workspaceId,
                executionMode,
                targetType: targetTypeQ,
                ptyClient: ptyClientRaw,
                ptySlot,
                plane: 'interactive',
            });
        } catch (e) {
            const code = e?.code || 'pty_client_required';
            return jsonResponse({ error: code, code }, 400);
        }
        const doId = env.AGENT_SESSION.idFromName(sessionName);
        const stub = env.AGENT_SESSION.get(doId);
        const doUrl = new URL(request.url);
        doUrl.pathname = '/terminal/ws';
        doUrl.searchParams.set('execution_mode', executionMode);
        doUrl.searchParams.set('workspace_id', workspaceId);
        if (ptySlot) doUrl.searchParams.set('pty_slot', ptySlot);
        /** Forward shell preference for ExecOS/localpty. Validated in DO. */
        const shellQ = (url.searchParams.get('shell') || '').trim();
        if (shellQ) doUrl.searchParams.set('shell', shellQ);
        doUrl.searchParams.set('target_type', targetTypeQ);
        if (ptyClientRaw) doUrl.searchParams.set('pty_client', ptyClientRaw);
        const connectionIdQ = (url.searchParams.get('connection_id') || '').trim();
        if (connectionIdQ) doUrl.searchParams.set('connection_id', connectionIdQ);
        const termCtx = await resolveTerminalIdentityContext(env, authUser, workspaceId);
        if (!termCtx.tenantId) {
            return jsonResponse({ error: 'TENANT_CONTEXT_REQUIRED', code: 'TENANT_CONTEXT_REQUIRED' }, 403);
        }
        applyTerminalIdentityToDoUrl(doUrl, termCtx);

        if (executionMode === 'pty' && env.DB) {
            const sessionId = `term_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
            const { rawToken, tokenHash } = await mintSessionToken();
            const now = Math.floor(Date.now() / 1000);
            const connSel = await getSelectedTerminalConnection(env.DB, {
                userId,
                workspaceId,
                tenantId: termCtx.tenantId,
                connectionId: connectionIdQ || null,
                targetType: targetTypeQ,
            });
            const connId =
                connSel.connection?.id != null ? String(connSel.connection.id).trim() : null;
            const shellForSession =
                String(connSel.connection?.shell || shellQ || '/bin/bash').trim() || '/bin/bash';
            const { resolveTerminalCwd } = await import('../../backend/agentsam/terminal/pty-workspace-paths.js');
            const cwdResolved = await resolveTerminalCwd(env, {
                connection: connSel.connection,
                tenantId: termCtx.tenantId,
                userId,
                workspaceId,
            });
            const cwdForSession = cwdResolved.cwd || termCtx.workingDir || '';
            await env.DB.prepare(
                `INSERT INTO terminal_sessions
                   (id, tenant_id, user_id, workspace_id, person_uuid, tunnel_url, cols, rows, shell, cwd, status, auth_token_hash, prefs_json, connection_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, '', 220, 50, ?, ?, 'active', ?, '{}', ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   auth_token_hash = excluded.auth_token_hash,
                   tenant_id = excluded.tenant_id,
                   connection_id = COALESCE(excluded.connection_id, connection_id),
                   shell = COALESCE(excluded.shell, shell),
                   cwd = COALESCE(excluded.cwd, cwd),
                   status = 'active',
                   updated_at = excluded.updated_at`,
            )
                .bind(
                    sessionId,
                    termCtx.tenantId,
                    userId,
                    workspaceId,
                    termCtx.personUuid,
                    shellForSession,
                    cwdForSession,
                    tokenHash,
                    connId,
                    now,
                    now,
                )
                .run()
                .catch(() => {});
            doUrl.searchParams.set('session_id', sessionId);
            doUrl.searchParams.set('session_token', rawToken);
        }

        return stub.fetch(new Request(doUrl.toString(), request));
    }

    // ACTIVE PATH: terminal status through DO control plane.
    // ── /api/agent/terminal/status ───────────────────────────────────────────
    if (pathLower === '/api/agent/terminal/status' && method === 'GET') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        if (!env.AGENT_SESSION) return jsonResponse({ error: 'AGENT_SESSION binding missing' }, 503);
        const executionModeRaw = (url.searchParams.get('execution_mode') || 'pty').trim().toLowerCase();
        const executionMode = ['pty', 'ssh', 'mcp', 'batch_exec'].includes(executionModeRaw) ? executionModeRaw : 'pty';
        const tw = await resolveTerminalWorkspaceId(env, request, authUser, url.searchParams.get('workspace_id'));
        if (tw.error === 'Forbidden') return jsonResponse({ error: 'Forbidden' }, 403);
        if (tw.error || !tw.workspaceId) {
            return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
        }
        const workspaceId = tw.workspaceId;
        if (!(await userCanRunPtyFromPolicy(env, authUser.id, workspaceId))) {
            return jsonResponse({ terminal_enabled: false, error: 'terminal_not_enabled' }, 403);
        }
        const statusTargetType = (url.searchParams.get('target_type') || '').trim();
        const statusClient = (url.searchParams.get('pty_client') || '').trim();
        let statusSessionName;
        try {
            statusSessionName = buildTerminalSessionDoName({
                userId: String(authUser.id || '').trim(),
                workspaceId,
                executionMode,
                targetType: statusTargetType,
                ptyClient: statusClient,
                plane: 'interactive',
            });
        } catch (e) {
            const code = e?.code || 'pty_client_required';
            return jsonResponse({ error: code, code }, 400);
        }
        const doId = env.AGENT_SESSION.idFromName(statusSessionName);
        const stub = env.AGENT_SESSION.get(doId);
        const doUrl = new URL(request.url);
        doUrl.pathname = '/terminal/status';
        doUrl.searchParams.set('execution_mode', executionMode);
        doUrl.searchParams.set('workspace_id', workspaceId);
        const termCtx = await resolveTerminalIdentityContext(env, authUser, workspaceId);
        if (!termCtx.tenantId) {
            return jsonResponse({ error: 'TENANT_CONTEXT_REQUIRED', code: 'TENANT_CONTEXT_REQUIRED' }, 403);
        }
        applyTerminalIdentityToDoUrl(doUrl, termCtx);
        return stub.fetch(new Request(doUrl.toString(), { method: 'GET', headers: request.headers }));
    }

    // ACTIVE PATH: execution_mode-aware execution API behind Worker/DO control plane.
    // ── /api/agent/terminal/exec (authoritative mode execution) ─────────────
    if (pathLower === '/api/agent/terminal/exec' && method === 'POST') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        if (!env.AGENT_SESSION) return jsonResponse({ error: 'AGENT_SESSION binding missing' }, 503);
        const body = await request.json().catch(() => ({}));
        const executionModeRaw = String(body?.execution_mode || url.searchParams.get('execution_mode') || 'pty')
            .trim().toLowerCase();
        const executionMode = ['pty', 'ssh', 'mcp', 'batch_exec'].includes(executionModeRaw) ? executionModeRaw : 'pty';
        const explicitWid = body?.workspace_id ?? url.searchParams.get('workspace_id');
        const tw = await resolveTerminalWorkspaceId(env, request, authUser, explicitWid);
        if (tw.error === 'Forbidden') return jsonResponse({ error: 'Forbidden' }, 403);
        if (tw.error || !tw.workspaceId) {
            return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
        }
        const workspaceId = tw.workspaceId;
        if (!(await userCanRunPtyFromPolicy(env, authUser.id, workspaceId))) {
            return jsonResponse({ terminal_enabled: false, error: 'terminal_not_enabled' }, 403);
        }
        const execTargetType = String(body?.target_type || url.searchParams.get('target_type') || '').trim();
        let execSessionName;
        try {
            execSessionName = buildTerminalSessionDoName({
                userId: String(authUser.id || '').trim(),
                workspaceId,
                executionMode,
                targetType: execTargetType,
                plane: 'agent',
            });
        } catch (e) {
            const code = e?.code || 'target_type_required';
            return jsonResponse({ error: code, code }, 400);
        }
        const doId = env.AGENT_SESSION.idFromName(execSessionName);
        const stub = env.AGENT_SESSION.get(doId);
        const doUrl = new URL(request.url);
        doUrl.pathname = '/terminal/exec';
        doUrl.searchParams.set('execution_mode', executionMode);
        doUrl.searchParams.set('workspace_id', workspaceId);
        const termCtx = await resolveTerminalIdentityContext(env, authUser, workspaceId);
        if (!termCtx.tenantId) {
            return jsonResponse({ error: 'TENANT_CONTEXT_REQUIRED', code: 'TENANT_CONTEXT_REQUIRED' }, 403);
        }
        applyTerminalIdentityToDoUrl(doUrl, termCtx);
        return stub.fetch(new Request(doUrl.toString(), {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(body || {}),
        }));
    }

    // ACTIVE PATH: durable non-interactive terminal jobs (submit/status/events/cancel/artifacts).
    if (pathLower === '/api/agent/terminal/jobs' || pathLower.startsWith('/api/agent/terminal/jobs/')) {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        if (!env.AGENT_SESSION) return jsonResponse({ error: 'AGENT_SESSION binding missing' }, 503);
        const body = method === 'POST' ? await request.json().catch(() => ({})) : {};
        const explicitWid = body?.workspace_id ?? url.searchParams.get('workspace_id');
        const tw = await resolveTerminalWorkspaceId(env, request, authUser, explicitWid);
        if (tw.error === 'Forbidden') return jsonResponse({ error: 'Forbidden' }, 403);
        if (tw.error || !tw.workspaceId) {
            return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
        }
        const workspaceId = tw.workspaceId;
        if (!(await userCanRunPtyFromPolicy(env, authUser.id, workspaceId))) {
            return jsonResponse({ terminal_enabled: false, error: 'terminal_not_enabled' }, 403);
        }
        const termCtx = await resolveTerminalIdentityContext(env, authUser, workspaceId);
        if (!termCtx.tenantId) {
            return jsonResponse({ error: 'TENANT_CONTEXT_REQUIRED', code: 'TENANT_CONTEXT_REQUIRED' }, 403);
        }
        const sessionName = `terminal:${authUser.id}:${workspaceId}:batch_exec`;
        const doId = env.AGENT_SESSION.idFromName(sessionName);
        const stub = env.AGENT_SESSION.get(doId);
        const doUrl = new URL(request.url);
        doUrl.pathname = url.pathname.replace(/^\/api\/agent/, '');
        doUrl.searchParams.set('workspace_id', workspaceId);
        applyTerminalIdentityToDoUrl(doUrl, termCtx);
        if (method === 'POST') {
            const {
                conversation_id: _conversationId,
                conversationId: _conversationIdCamel,
                turn_id: _turnId,
                turnId: _turnIdCamel,
                agent_id: _agentId,
                agentId: _agentIdCamel,
                tool_call_id: _toolCallId,
                toolCallId: _toolCallIdCamel,
                resume_policy: _resumePolicy,
                resumePolicy: _resumePolicyCamel,
                user_id: _userId,
                userId: _userIdCamel,
                tenant_id: _tenantId,
                tenantId: _tenantIdCamel,
                ...publicJobBody
            } = body || {};
            return stub.fetch(new Request(doUrl.toString(), {
                method: 'POST',
                headers: request.headers,
                body: JSON.stringify({
                    ...publicJobBody,
                    user_id: String(authUser.id),
                    workspace_id: workspaceId,
                    tenant_id: termCtx.tenantId,
                    resume_policy: 'none',
                }),
            }));
        }
        return stub.fetch(new Request(doUrl.toString(), { method: 'GET', headers: request.headers }));
    }

    // ACTIVE PATH: compatibility command runner; internally routes to control plane first.
    // ── /api/agent/terminal/run (consistent session-auth model) ──────────────
    if (pathLower === '/api/agent/terminal/run' && method === 'POST') {
        try {
            const body = await request.json().catch(() => ({}));
            const { response, error, status, execution_id } = await executeScopedAgentTerminalRun(
                request,
                env,
                ctx,
                url,
                body,
            );
            if (response) return jsonResponse({ ...response, execution_id: execution_id || response.execution_id });
            return jsonResponse({ terminal_enabled: false, error: error || 'terminal run failed' }, status || 500);
        } catch (e) {
            return jsonResponse({ error: e?.message || 'terminal run failed' }, 500);
        }
    }

    // ── /api/agent/terminal/complete ──────────────────────────────────────────
    if (pathLower === '/api/agent/terminal/complete' && method === 'POST') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        const twComplete = await resolveTerminalWorkspaceId(env, request, authUser, null);
        if (
            twComplete.workspaceId &&
            !(await userCanRunPtyFromPolicy(env, authUser.id, twComplete.workspaceId))
        ) {
            return jsonResponse({ terminal_enabled: false, error: 'terminal_not_enabled' }, 403);
        }
        const body = await request.json().catch(() => ({}));
        const executionId = body?.execution_id;
        const status = body?.status;
        const now = Math.floor(Date.now() / 1000);
        if (executionId && (status === 'completed' || status === 'failed')) {
            try {
                await env.DB?.prepare(
                    "UPDATE agentsam_command_run SET status = ?, completed_at = ?, output_text = COALESCE(?, output_text), exit_code = COALESCE(?, exit_code) WHERE id = ?"
                ).bind(status, now, body?.output_text ?? null, body?.exit_code ?? null, executionId).run();
            } catch (_) {}
        }
        return jsonResponse({ ok: true });
    }

    // ── /api/terminal/session/resume ─────────────────────────────────────────
    if (pathLower === '/api/terminal/session/resume' && method === 'GET') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        const twResume = await resolveTerminalWorkspaceId(env, request, authUser, url.searchParams.get('workspace_id'));
        if (
            !twResume.workspaceId ||
            !(await userCanRunPtyFromPolicy(env, authUser.id, twResume.workspaceId))
        ) {
            return jsonResponse({ terminal_enabled: false, resumable: false });
        }

        if (!env.DB) return jsonResponse({ resumable: false });
        try {
            const session = await env.DB.prepare(
                `SELECT id, tunnel_url, shell, cwd, cols, rows
                 FROM terminal_sessions
                 WHERE user_id = ? AND status = 'active' AND tunnel_url IS NOT NULL AND tunnel_url != ''
                 ORDER BY updated_at DESC LIMIT 1`
            ).bind(authUser.id).first();
            
            if (!session) return jsonResponse({ resumable: false });
            
            return jsonResponse({
                resumable: true,
                session_id: session.id,
                tunnel_url: session.tunnel_url,
                shell: session.shell,
                cwd: session.cwd,
                cols: session.cols,
                rows: session.rows,
            });
        } catch (e) {
            return jsonResponse({ resumable: false });
        }
    }

    // ── /api/chat (Multi-Model AI Engine) ───────────────────────────────────
    if (pathLower === '/api/chat') {
        try {
            const body = await request.json();
            const authUser = await getAuthUser(request, env);
            const chatUserId = authUser?.id != null ? String(authUser.id) : undefined;
            const params = {
                modelKey: body.model || 'auto',
                systemPrompt: body.system || 'You are Agent Sam.',
                messages: body.messages || [],
                tools: body.tools || [],
                agentId: body.agent_id,
                conversationId: body.conversation_id,
                userId: chatUserId,
                mode: body.mode,
                taskType: body.task_type || body.taskType,
                routeKey: body.route_key || body.routeKey,
                lane: body.lane,
            };
            return dispatchStream(env, request, params);
        } catch (e) {
            return jsonResponse({ error: 'Chat failed', detail: e.message }, 500);
        }
    }

    // ── /api/draw/* (Excalidraw + collab wrappers) ───────────────────────────
    if (pathLower.startsWith('/api/draw')) {
        return handleDrawApi(request, url, env, ctx);
    }

    // ── /api/hyperdrive/* (Postgres via Hyperdrive — SQL CRUD + table browser) ─
    if (pathLower.startsWith('/api/hyperdrive')) {
        return handleHyperdriveRoutes(request, url, env);
    }

    // ── /api/browser/run/:action (Browser Run Quick Actions) ─────────────────
    if (/^\/api\/browser\/run\/[^/]+\/?$/i.test(pathLower)) {
        return handleBrowserRunQuickActionsRoute(request, url, env);
    }

    // ── /api/browser (Playwright Rendering) ──────────────────────────────────
    if (pathLower.startsWith('/api/browser')) {
        return handleBrowserRequest(request, url, env);
    }

    // ── /api/agent/github (GitHub Bridge) ────────────────────────────────────
    if (pathLower.startsWith('/api/agent/github')) {
        return handleGitHubApi(request, env);
    }

    return jsonResponse({ error: 'Dashboard route not found or not yet modularized' }, 404);
}
