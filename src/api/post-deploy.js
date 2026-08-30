/**
 * API Handler: POST /api/internal/post-deploy
 *
 * Called after a successful worker deployment (e.g. promote-to-prod / CI / deploy-frontend.sh).
 * Syncs post_deploy agentsam_hook rows (see fireAgentHooks in hook-dispatcher.js → agentsam_hook_execution).
 * Does NOT write deploy history to KV — D1 deployments + pwa-build-meta.json are SSOT.
 *
 * Auth: AGENTSAM_BRIDGE_KEY (Bearer or legacy header aliases).
 * Response: { ok, environment, version, kv_writes: false, hooks_event, hook_ledger, deployments_ledger }
 *
 * Deployments ledger SSOT: scripts/post-deploy-record.sh only.
 * This handler must NOT INSERT skinny deployments rows (empty changed_files / tenant / run_group).
 */

import { jsonResponse } from '../core/responses.js';
import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { fireAgentHooks } from '../../backend/agentsam/hooks/dispatcher.js';
import { resolveSupabaseWorkspaceId } from '../../backend/rag/index.js';
import { upsertDeployMemoryFacts } from '../core/deploy-memory-fact.js';

function isPostDeployAuthorized(request, env) {
  return verifyBridgeKey(request, env);
}

/**
 * Main handler — registered in src/index.js as:
 *   POST /api/internal/post-deploy → handlePostDeploy(request, env, ctx)
 */
export async function handlePostDeploy(request, env, ctx) {
  // ── Auth gate ────────────────────────────────────────────────────────────────
  if (!isPostDeployAuthorized(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_) {}

  const statusRaw = body.status != null ? String(body.status).trim().toLowerCase() : '';

  // Explicit phone-loop kick (email + push) — used to close E2E without a trail failure.
  if (statusRaw === 'phone_loop' || statusRaw === 'phone_loop_kick') {
    const conversationId =
      (typeof body.conversation_id === 'string' && body.conversation_id.trim()) ||
      crypto.randomUUID();
    const subject =
      (typeof body.subject === 'string' && body.subject.trim()) ||
      '[Agent Sam] Phone loop kickoff — reply with your next instruction';
    const msgBody =
      (typeof body.body === 'string' && body.body.trim()) ||
      [
        'Phone-email IDE loop is live.',
        '',
        'Reply to this email from an allowlisted superadmin address with your next instruction.',
        'Keep the [ref:as_…] token so the thread stays bound.',
        '',
        'Reply with your next instruction.',
      ].join('\n');
    const pushTitle =
      (typeof body.push_title === 'string' && body.push_title.trim()) || 'Agent Sam — phone loop';
    const pushBody =
      (typeof body.push_body === 'string' && body.push_body.trim()) ||
      'Reply to the email (or open Agent) to close this out.';

    if (ctx?.waitUntil) {
      ctx.waitUntil(
        (async () => {
          const { sendPhoneLoopCompletion, mintPhoneLoopConversationId, ensurePhoneLoopChatSession } =
            await import('../core/email-agent-bridge.js');
          const cid = conversationId.includes('-')
            ? conversationId
            : mintPhoneLoopConversationId();
          await ensurePhoneLoopChatSession(env, null, cid, msgBody.slice(0, 400));
          await sendPhoneLoopCompletion(env, null, {
            conversationId: cid,
            deploymentId: body.worker_version_id || body.deployment_id || null,
            subject,
            body: msgBody,
            pushTitle,
            pushBody,
          });
        })().catch((e) => console.warn('[post-deploy] phone_loop kick', e?.message || e)),
      );
    }

    return jsonResponse({
      ok: true,
      status: 'phone_loop',
      notified: true,
      conversation_id: conversationId,
      deployments_ledger: 'post_deploy_record_ssot',
    });
  }

  // Trail / post-deploy-record failure path — push + email via phone loop (no success KV markers).
  if (statusRaw === 'trail_failed' || statusRaw === 'failed') {
    const gitHash = body.git_hash || body.gitHash || 'unknown';
    const errMsg = String(body.error || body.message || 'deploy trail failed').slice(0, 2000);
    const gitShort = gitHash !== 'unknown' ? String(gitHash).slice(0, 12) : 'unknown';
    const conversationId =
      (typeof body.conversation_id === 'string' && body.conversation_id.trim()) ||
      crypto.randomUUID();

    if (ctx?.waitUntil) {
      ctx.waitUntil(
        (async () => {
          const { sendPhoneLoopCompletion, mintPhoneLoopConversationId } =
            await import('../core/email-agent-bridge.js');
          // Email/push only — do NOT seed agentsam_chat_sessions (that turned Chats into a deploy log).
          // A real chat row is created when the operator replies to the email.
          const cid = conversationId.includes('-')
            ? conversationId
            : mintPhoneLoopConversationId();
          await sendPhoneLoopCompletion(env, null, {
            conversationId: cid,
            deploymentId: body.worker_version_id || body.deployment_id || null,
            subject: `[Agent Sam] Deploy trail FAILED — ${gitShort}`,
            body: [
              'Deploy trail failure — worker may be live but D1 ledger/post-deploy-record did not complete.',
              '',
              `git_hash: ${gitHash}`,
              `worker_version_id: ${body.worker_version_id || body.deployment_id || '—'}`,
              `error: ${errMsg}`,
              '',
              'Reply with next instruction to investigate / heal.',
            ].join('\n'),
            pushTitle: 'Deploy trail FAILED',
            pushBody: `${gitShort}: ${errMsg}`.slice(0, 140),
          });
        })().catch((e) => console.warn('[post-deploy] trail_failed notify', e?.message || e)),
      );
    }

    return jsonResponse({
      ok: true,
      status: 'trail_failed',
      notified: true,
      git_hash: gitHash,
      deployments_ledger: 'post_deploy_record_ssot',
    });
  }

  const environment = body.environment || 'production';
  const gitHash = body.git_hash || body.gitHash || 'unknown';
  const version = body.version || body.dashboard_version || 'unknown';
  const workerVersion = body.worker_version_id || 'unknown';
  const deployDurationMs =
    typeof body.deploy_duration_ms === 'number' && Number.isFinite(body.deploy_duration_ms)
      ? body.deploy_duration_ms
      : undefined;
  const branchName =
    typeof body.branch_name === 'string' && body.branch_name.trim()
      ? body.branch_name.trim()
      : typeof body.branch === 'string' && body.branch.trim()
        ? body.branch.trim()
        : null;
  const description =
    typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : typeof body.git_message === 'string' && body.git_message.trim()
        ? body.git_message.trim()
        : null;
  const deployedBy =
    typeof body.deployed_by === 'string' && body.deployed_by.trim()
      ? body.deployed_by.trim()
      : typeof body.user_id === 'string' && body.user_id.trim()
        ? body.user_id.trim()
        : 'deploy:full';

  const now = new Date().toISOString();

  // ── D1 side effects (never skinny deployments INSERT) ────────────────────────
  // Do not write github_repositories / default_branch — that table is stale and
  // must not couple worker deploy to any repo's branch (including this app).
  if (env.DB) {
    ctx.waitUntil(
      upsertDeployMemoryFacts(
        env.DB,
        env,
        {
          tenantId: String(body.tenant_id ?? body.tenantId ?? '').trim(),
          workspaceId: String(body.workspace_id ?? body.d1_workspace_id ?? '').trim(),
          userId: String(body.user_id ?? '').trim(),
          shortSha: version,
          gitHash,
          environment,
          branchName,
          description,
          deployedAt: now,
          workerVersionId: workerVersion,
          deployDurationMs,
          deployedBy,
        },
        body,
      ).catch((e) => console.warn('[post-deploy] deploy memory fact failed', e?.message || e)),
    );

    ctx.waitUntil(
      env.DB.prepare(
        `INSERT OR IGNORE INTO cicd_events
           (source, event_type, git_commit_sha, raw_payload_json)
         VALUES ('post-deploy-handler', 'knowledge_sync', ?, ?)`,
      )
        .bind(gitHash, JSON.stringify({ environment, version, synced_at: now }))
        .run()
        .catch(() => {}),
    );

    const workspaceId =
      typeof body.workspace_id === 'string' && body.workspace_id.trim()
        ? body.workspace_id.trim()
        : '';
    if (!workspaceId) {
      return jsonResponse({ error: 'workspace_id_required' }, 400);
    }
    const operatorUserId =
      typeof body.user_id === 'string' && body.user_id.trim()
        ? body.user_id.trim()
        : '';
    const operatorTenantId =
      typeof body.tenant_id === 'string' && body.tenant_id.trim()
        ? body.tenant_id.trim()
        : '';
    if (!operatorUserId) {
      console.warn('[post-deploy] operator user_id missing from body; skip replyable notify identity lookup');
    }

    // Prefer D1/Hyperdrive bridge for this workspace — do not require IAM_SUPABASE_WORKSPACE_ID on Worker.
    let supabaseWorkspaceId = null;
    try {
      supabaseWorkspaceId = await resolveSupabaseWorkspaceId(env, workspaceId);
    } catch (e) {
      console.warn('[post-deploy] supabase_workspace_resolve_failed', e?.message || e);
    }

    const hookPayload = {
      environment,
      git_hash: gitHash,
      dashboard_version: version,
      worker_version_id: workerVersion,
      workspace_id: workspaceId,
      user_id: operatorUserId,
      supabase_workspace_id: supabaseWorkspaceId,
      ms_wall: deployDurationMs,
      health_status: body.health_status,
      health_ms: body.health_ms,
    };
    ctx.waitUntil(
      fireAgentHooks(env, ctx, 'post_deploy', hookPayload).catch((e) =>
        console.warn('[post-deploy] fireAgentHooks post_deploy', e?.message || e),
      ),
    );

    const gitShort = gitHash !== 'unknown' ? String(gitHash).slice(0, 7) : version;
    ctx.waitUntil(
      (async () => {
        const { sendPhoneLoopCompletion, mintPhoneLoopConversationId } = await import(
          '../core/email-agent-bridge.js'
        );
        // Phone-loop email + push for deploy receipts must NOT insert agentsam_chat_sessions.
        // Seed message "Deploy … live — reply or tap Continue" was flooding /dashboard/chats
        // (often twice per SHA: Mac deploy:fast + CF Builds). Session is created on reply.
        const conversationId = mintPhoneLoopConversationId();
        const subject = `[Agent Sam] Deploy complete — ${gitShort}`;
        const body = [
          `IAM production deploy ${gitShort} is live.`,
          '',
          `environment: ${environment}`,
          `version: ${version}`,
          `git_hash: ${gitHash}`,
          `worker_version_id: ${workerVersion}`,
          '',
          'Reply to this email with the next instruction, or use the push buttons (Continue / Status).',
          'Keep the [ref:as_…] token so the thread stays bound.',
        ].join('\n');
        if (!operatorUserId) {
          console.warn('[post-deploy] skip replyable notify: user_id missing');
          return { ok: false, error: 'user_id_required' };
        }
        return sendPhoneLoopCompletion(env, null, {
          conversationId,
          subject,
          body,
          pushTitle: 'Deploy complete',
          pushBody: `IAM production deploy ${gitShort} is live`,
          continueInstruction: `Production deploy ${gitShort} just went live. Verify /api/health and pwa-build-meta, then summarize what changed and any follow-ups.`,
          statusInstruction: `Give a short status on deploy ${gitShort}: health, known issues, and whether I should ship anything next.`,
          userId: operatorUserId,
          workspaceId,
          tenantId: operatorTenantId,
        });
      })().catch((e) => console.warn('[post-deploy] replyable deploy notify', e?.message || e)),
    );
  }

  return jsonResponse({
    ok: true,
    environment,
    version,
    synced_at: now,
    kv_writes: false,
    hooks_event: 'post_deploy',
    hook_ledger: 'agentsam_hook_execution',
    deployments_ledger: 'post_deploy_record_ssot',
  });
}
