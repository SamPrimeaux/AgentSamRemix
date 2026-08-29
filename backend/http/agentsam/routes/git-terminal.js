/**
 * Phase 2 routes extracted from handleAgentApi (mechanical move).
 * Ticket: tkt_agent_js_phase2_git_terminal_2026_08
 * Families: git/*, merkle/*, terminal/config-status (legacy fallback)
 *
 * @returns {Promise<Response|null>} Response if handled; null to continue dispatcher
 */
import {
  routeFetchAgentGitStatus as fetchAgentGitStatus,
  routeFetchGitStatusFromGitHub as fetchGitStatusFromGitHub,
  routeFetchWorkspaceGithubRepo as fetchWorkspaceGithubRepo,
  routeSetUserWorkspaceActiveBranch as setUserWorkspaceActiveBranch,
  routeResolveGitHubToken as resolveGitHubToken,
  routeCloneGithubRepository as cloneGithubRepository,
  routeMerkleBuildGithub as merkleBuildGithub,
  routeMerkleBuildFromEntries as merkleBuildFromEntries,
  routeMerkleGet as merkleGet,
  routeMerkleCompare as merkleCompare,
  routeMerkleExplain as merkleExplain,
  routeMerkleList as merkleList,
  routeMerkleDelete as merkleDelete,
  routeMerkleBuildExecOsGit as merkleBuildExecOsGit,
  routeResolveTerminalWorkspaceId as resolveTerminalWorkspaceId,
  routePostWorkersDeployHook as postWorkersDeployHook,
  routeRedactDeployHookUrl as redactDeployHookUrl,
  routeNotifySam as notifySam,
  routeRunTerminalCommand as runTerminalCommand,
  routeGetSelectedTerminalConnection as getSelectedTerminalConnection,
} from './route-git-runtime.js';
import { routeUserCanRunPtyFromPolicy as userCanRunPtyFromPolicy } from './route-pty-policy.js';
import { jsonResponse } from '../shared.js';
import { authUserFromRequest, fetchAuthUserTenantId } from '../../../identity/index.js';
import { insertApprovalQueueRow } from '../../../agentsam/approvals/queue.js';

export async function handleAgentGitTerminalApi(request, url, env, ctx, routeAuth, identity) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const ra =
    routeAuth && typeof routeAuth === 'object' && 'authCtx' in routeAuth
      ? routeAuth
      : { authUser: routeAuth, authCtx: null };

  const isGit = path.startsWith('/api/agent/git/') || path === '/api/agent/git';
  const isMerkle = path.startsWith('/api/agent/merkle/') || path === '/api/agent/merkle';
  const isTerminalStub = path === '/api/agent/terminal/config-status';
  if (!isGit && !isMerkle && !isTerminalStub) return null;

  // ── /api/agent/git/status ─────────────────────────────────────────────────
  // Legacy fallback — production handler is the dashboard GitHub API.
  if (path === '/api/agent/git/status' && method === 'GET') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB)   return jsonResponse({ error: 'DB not configured' }, 503);
    try {
      return jsonResponse(await fetchAgentGitStatus(env, authUser, request, url));
    } catch (e) { return jsonResponse({ error: e?.message }, 500); }
  }

  // ── POST /api/agent/git/branch — persist per-user active branch (D1) ─────
  if (path === '/api/agent/git/branch' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
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
  if (path === '/api/agent/git/branches' && method === 'GET') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

    const { token, error, status } = await resolveGitHubToken(authUser, env);
    if (error) return jsonResponse({ error }, status);

    const repoCtx = await fetchWorkspaceGithubRepo(env, authUser, request, url);
    if (repoCtx.error) {
      return jsonResponse({ error: repoCtx.error, workspace_id: repoCtx.workspace_id }, repoCtx.status || 500);
    }

    const ghRes = await fetch(
      `https://api.github.com/repos/${repoCtx.repo}/branches?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'inneranimalmedia-agent/1.0',
        },
      },
    );

    if (!ghRes.ok) {
      return jsonResponse({ error: 'GitHub API error', status: ghRes.status, detail: await ghRes.text() }, 502);
    }

    const ghBranches = await ghRes.json();
    const statusPayload = await fetchGitStatusFromGitHub(env, authUser, request, url);
    const currentBranch = statusPayload.branch || 'main';

    // Shape matches existing GitBranchRow type in StatusBar:
    // { ref: string, sha: string, protected: boolean }
    return jsonResponse({
      current: currentBranch,
      repo: repoCtx.repo,
      branches: ghBranches.map((b) => ({
        ref: b.name,
        sha: b.commit.sha.slice(0, 7),
        protected: b.protected ?? false,
      })),
    });
  }

  // ── GET /api/agent/git/repos — retired (do not list OAuth repos from agent.js)
  // Connected-user repo catalog SSOT: GET /api/integrations/github/repos
  // (live GitHub API + user_oauth_tokens). Never github_repositories D1.
  if (path === '/api/agent/git/repos' && method === 'GET') {
    return jsonResponse(
      {
        error: 'gone',
        message:
          'Use GET /api/integrations/github/repos for the signed-in user repo list. This agent path mixed git status with OAuth catalog and is removed.',
        use: '/api/integrations/github/repos',
      },
      410,
    );
  }

  // ── POST /api/agent/git/clone — clone on healthy PTY lane + bind workspace_root ─
  if (path === '/api/agent/git/clone' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const out = await cloneGithubRepository(env, request, body, { getSelectedTerminalConnection, runTerminalCommand });
    const status = out.status ?? (out.ok ? 200 : 500);
    return jsonResponse(out, status);
  }

  // ── Merkle Snapshot APIs (Slice 2) — build/get/compare/explain/list/delete ─
  if (path.startsWith('/api/agent/merkle/') || path === '/api/agent/merkle') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const body = method === 'GET' ? {} : await request.json().catch(() => ({}));
    const tw = await resolveTerminalWorkspaceId(
      env,
      request,
      authUser,
      body.workspace_id || url.searchParams.get('workspace_id'),
    );
    const workspaceId = tw.workspaceId ? String(tw.workspaceId).trim() : '';
    if (!workspaceId) return jsonResponse({ error: tw.error || 'workspace_required' }, 400);

    if (path === '/api/agent/merkle/list' && method === 'GET') {
      const out = await merkleList(env, {
        workspaceId,
        limit: Number(url.searchParams.get('limit') || 40),
      });
      return jsonResponse(out, out.status || (out.ok ? 200 : 500));
    }

    if (path === '/api/agent/merkle/build' && method === 'POST') {
      const source = String(body.source || 'github').trim().toLowerCase();
      if (source === 'github') {
        const tokenResult = await resolveGitHubToken(authUser, env);
        const token = tokenResult?.token ? String(tokenResult.token).trim() : '';
        if (!token) return jsonResponse({ error: 'github_not_connected' }, 401);
        const out = await merkleBuildGithub(env, {
          workspaceId,
          token,
          repository: body.repository || body.repo,
          reference: body.reference || body.ref || 'HEAD',
          persist: body.persist !== false,
        });
        return jsonResponse(out, out.status || (out.ok ? 200 : 500));
      }
      if (Array.isArray(body.entries)) {
        const out = await merkleBuildFromEntries(env, {
          workspaceId,
          source,
          reference: body.reference,
          entries: body.entries,
          leafHashDomain: body.leaf_hash_domain || body.leafHashDomain,
          resolvedCommitSha: body.resolved_commit_sha,
          resolvedTreeSha: body.resolved_tree_sha,
          repository: body.repository,
          ignoreProfileHash: body.ignore_profile_hash,
        });
        return jsonResponse(out, out.status || (out.ok ? 200 : 500));
      }
      if (source === 'execos') {
        const out = await merkleBuildExecOsGit(env, { ...body, workspaceId });
        return jsonResponse(out, out.ok ? 200 : 502);
      }
      return jsonResponse({ error: 'merkle_build_source_unsupported' }, 400);
    }

    if (path === '/api/agent/merkle/get' && method === 'GET') {
      const out = await merkleGet(env, {
        workspaceId,
        snapshotId: url.searchParams.get('snapshot_id'),
        path: url.searchParams.get('path') || '',
      });
      return jsonResponse(out, out.status || (out.ok ? 200 : 500));
    }

    if (path === '/api/agent/merkle/compare' && method === 'POST') {
      const out = await merkleCompare(env, {
        workspaceId,
        currentSnapshotId: body.current_snapshot_id || body.head_snapshot_id,
        baselineSnapshotId: body.baseline_snapshot_id || body.base_snapshot_id,
      });
      return jsonResponse(out, out.status || (out.ok ? 200 : 500));
    }

    if (path === '/api/agent/merkle/explain' && method === 'POST') {
      const out = await merkleExplain(env, {
        workspaceId,
        currentSnapshotId: body.current_snapshot_id || body.head_snapshot_id,
        baselineSnapshotId: body.baseline_snapshot_id || body.base_snapshot_id,
        path: body.path || '',
      });
      return jsonResponse(out, out.status || (out.ok ? 200 : 500));
    }

    if (path === '/api/agent/merkle/delete' && method === 'POST') {
      const out = await merkleDelete(env, {
        workspaceId,
        snapshotId: body.snapshot_id,
      });
      return jsonResponse(out, out.status || (out.ok ? 200 : 500));
    }

    return jsonResponse({ error: 'merkle_route_not_found' }, 404);
  }

  // ── /api/agent/git/sync ───────────────────────────────────────────────────
  if (path === '/api/agent/git/sync' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const body = await request.json().catch(() => ({}));
    let tenantId =
      authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
        ? String(authUser.tenant_id).trim()
        : null;
    if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
    if (!tenantId && authUser.email) tenantId = await fetchAuthUserTenantId(env, authUser.email);
    if (!tenantId) return jsonResponse({ error: 'Tenant not configured for this account' }, 403);
    const proposalId = 'prop_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const now = Math.floor(Date.now() / 1000);
    const proposedBy = String(authUser.email || authUser.id || 'user').slice(0, 200);
    const iamOrigin = (env.IAM_ORIGIN || '').replace(/\/$/, '');
    const expGit = now + 86400;
    await insertApprovalQueueRow(env, {
      id: proposalId,
      tenant_id: tenantId,
      workspace_id: null,
      user_id: proposedBy,
      session_id: body.session_id || null,
      tool_name: 'git_sync_workflow',
      action_summary: 'User requested Git sync from dashboard.',
      risk_level: 'medium',
      input_json: JSON.stringify({
        command_text: 'GitHub sync workflow',
        filled_template: 'GitHub sync workflow',
        command_source: 'dashboard',
      }),
      expires_at: expGit,
      status: 'pending',
      approval_type: 'tool',
      created_at: now,
    });
    notifySam(
      env,
      {
        subject: 'Git sync proposal pending',
        body: `Proposal: ${proposalId}\nApprove: ${iamOrigin}/dashboard/overview?proposal=${proposalId}`,
        category: 'proposal',
      },
      ctx,
    );
    return jsonResponse({ ok: true, proposal_id: proposalId, risk_level: 'medium' });
  }

  // ── POST /api/agent/git/publish — Workers Builds deploy hook (status-bar sync) ─
  if (path === '/api/agent/git/publish' && method === 'POST') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const tw = await resolveTerminalWorkspaceId(
      env,
      request,
      authUser,
      body.workspace_id != null ? String(body.workspace_id).trim() : null,
    );
    if (!tw.workspaceId) {
      return jsonResponse({ error: tw.error || 'workspace_missing' }, tw.error === 'Forbidden' ? 403 : 400);
    }
    const workerName =
      body.worker_name != null ? String(body.worker_name).trim() : body.workerName != null
        ? String(body.workerName).trim()
        : null;
    const result = await postWorkersDeployHook(env, {
      workspaceId: tw.workspaceId,
      workerName: workerName || undefined,
    });
    if (result.error === 'deploy_hook_url not configured') {
      return jsonResponse({ error: result.error, workspace_id: tw.workspaceId }, 503);
    }
    if (result.error && result.status === 0) {
      return jsonResponse({ error: result.error, workspace_id: tw.workspaceId }, 400);
    }
    const buildUuid = result.json?.result?.build_uuid ?? result.json?.build_uuid ?? null;
    const httpOk = result.ok ? 200 : 502;
    return jsonResponse(
      {
        ok: result.ok,
        workspace_id: tw.workspaceId,
        worker_name: workerName,
        build_uuid: buildUuid,
        deploy_hook_url_redacted: redactDeployHookUrl(result.deploy_hook_url),
        deploy_hook_source: result.source ?? null,
        http_status: result.status,
        cloudflare: result.json ?? null,
        detail: result.raw ?? null,
        error: result.error ?? null,
      },
      httpOk,
    );
  }

  // Legacy fallback; production dispatch handles this compatibility endpoint first.
  // ── /api/agent/terminal/config-status ────────────────────────────────────
  if (path === '/api/agent/terminal/config-status' && method === 'GET') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const uid = String(authUser.id || '').trim();
    const wsRes = await resolveTerminalWorkspaceId(env, request, authUser, {});
    const wsId = wsRes?.workspaceId ? String(wsRes.workspaceId).trim() : '';
    const policyCanPty = uid && wsId ? await userCanRunPtyFromPolicy(env, uid, wsId) : false;
    if (!policyCanPty) {
      return jsonResponse({
        terminal_enabled: false,
        terminal_configured: false,
      });
    }
    if (!env.DB)   return jsonResponse({ terminal_enabled: true, terminal_configured: false });
    try {
      const row = await env.DB.prepare(
        `SELECT id, tunnel_url, shell, cwd, cols, rows
         FROM terminal_sessions
         WHERE user_id = ? AND status = 'active'
           AND tunnel_url IS NOT NULL AND tunnel_url != ''
         ORDER BY updated_at DESC LIMIT 1`
      ).bind(String(authUser.id)).first().catch(() => null);
      if (!row) return jsonResponse({ terminal_enabled: true, terminal_configured: false });
      return jsonResponse({
        terminal_enabled: true,
        terminal_configured: true,
        tunnel_url: row.tunnel_url,
        shell:      row.shell || 'bash',
        cwd:        row.cwd   || '~',
        cols:       row.cols  || 220,
        rows:       row.rows  || 50,
      });
    } catch (e) {
      return jsonResponse({ terminal_enabled: true, terminal_configured: false, error: e.message });
    }
  }


  return null;
}
