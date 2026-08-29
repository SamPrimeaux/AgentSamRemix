/**
 * hook-dispatcher.js
 * Fires registered agentsam_hook rows for a given event_type (or legacy trigger).
 * Writes to agentsam_hook_execution with tenant/workspace scope.
 */
import { sha256Hex } from '../../../packages/shared/crypto/sha256.js';
import { pragmaTableInfo } from '../../services/retention.js';
import { fetchActiveProjectContextBlocks } from '../context/prompt-context.js';

const HOOK_SELECT = `
  SELECT
    id,
    COALESCE(NULLIF(trim(hook_key), ''), id) AS hook_key,
    COALESCE(NULLIF(trim(handler_type), ''),
      CASE
        WHEN command LIKE 'notify:webhook:%' THEN 'webhook'
        WHEN command IN ('trigger:agent_sam_deploy_hook', 'trigger:workers_deploy_hook') THEN 'workers_deploy'
        WHEN command LIKE 'log:%' OR command IN ('notify:email') THEN 'log_only'
        WHEN COALESCE(trim(command), '') = ''
          AND COALESCE(event_type, trigger) IN ('agent_run_complete', 'stop') THEN 'usage_event'
        ELSE 'log_only'
      END
    ) AS handler_type,
    COALESCE(NULLIF(trim(handler_config), ''),
      CASE
        WHEN command LIKE 'notify:webhook:%' THEN json_object('url', substr(command, length('notify:webhook:') + 1))
        ELSE json_object('command', COALESCE(command, ''))
      END
    ) AS handler_config,
    COALESCE(event_type, trigger) AS event_type,
    workspace_id,
    tenant_id,
    user_id,
    target_id,
    command
  FROM agentsam_hook
  WHERE is_active = 1
    AND (
      COALESCE(event_type, trigger) = ?
      OR event_type = '*'
    )
  ORDER BY COALESCE(priority, 100) ASC, created_at ASC
`;

/**
 * @param {any} env
 * @param {Record<string, unknown>} payload
 * @param {Record<string, unknown>} hook
 * @param {string} exId
 * @param {number} durationMs
 * @param {string} outcome
 * @param {string | null} errorMsg
 */
async function insertHookExecution(env, payload, hook, exId, durationMs, outcome, errorMsg) {
  const cols = await pragmaTableInfo(env.DB, 'agentsam_hook_execution');
  const agentRunId = payload.agent_run_id ?? payload.agentRunId ?? null;
  if (cols.has('agent_run_id') && cols.has('metadata_json')) {
    await env.DB.prepare(
      `INSERT INTO agentsam_hook_execution
         (id, hook_id, event_type, tenant_id, workspace_id, user_id, status, error,
          payload_json, duration_ms, agent_run_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(
        exId,
        hook.id,
        hook.event_type,
        payload.tenant_id ?? hook.tenant_id ?? null,
        payload.workspace_id ?? hook.workspace_id ?? null,
        payload.user_id ?? hook.user_id ?? 'system',
        outcome,
        errorMsg,
        JSON.stringify(payload).slice(0, 4096),
        durationMs,
        agentRunId,
        JSON.stringify({ hook_key: hook.hook_key, handler_type: hook.handler_type }).slice(
          0,
          4096,
        ),
      )
      .run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO agentsam_hook_execution
       (id, hook_id, event_type, tenant_id, workspace_id, user_id, status, error,
        payload_json, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(
      exId,
      hook.id,
      hook.event_type,
      payload.tenant_id ?? hook.tenant_id ?? null,
      payload.workspace_id ?? hook.workspace_id ?? null,
      payload.user_id ?? hook.user_id ?? 'system',
      outcome,
      errorMsg,
      JSON.stringify(payload).slice(0, 4096),
      durationMs,
    )
    .run();
}

export async function fireAgentHooks(env, ctx, eventType, payload = {}) {
  if (!env?.DB) return;

  try {
    const { results: hooks } = await env.DB.prepare(HOOK_SELECT).bind(eventType).all();

    if (!hooks?.length) return;

    for (const hook of hooks) {
      const payloadWs = payload.workspace_id != null ? String(payload.workspace_id).trim() : '';
      const hookWs = hook.workspace_id != null ? String(hook.workspace_id).trim() : '';
      if (hookWs && payloadWs && hookWs !== payloadWs) {
        continue;
      }

      if (hook.handler_type === 'web_push') {
        const recipient = payload.recipient_id ?? payload.user_id ?? null;
        if (!recipient || String(hook.target_id || '') !== String(recipient)) {
          continue;
        }
      }

      const exId = 'hex_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      const t0 = Date.now();
      let outcome = 'success';
      let errorMsg = null;

      try {
        await dispatchHook(env, hook, payload, ctx);
      } catch (e) {
        outcome = 'fail';
        errorMsg = e?.message ?? String(e);
        console.warn('[hook-dispatcher]', hook.hook_key, errorMsg);
      }

      const durationMs = Date.now() - t0;
      if (ctx?.waitUntil) {
        ctx.waitUntil(
          insertHookExecution(env, payload, hook, exId, durationMs, outcome, errorMsg).catch((e) =>
            console.warn('[hook-dispatcher] execution write', e?.message),
          ),
        );
        ctx.waitUntil(
          env.DB.prepare(
            `UPDATE agentsam_hook
             SET run_count = COALESCE(run_count, 0) + 1,
                 last_run_at = datetime('now')
             WHERE id = ?`,
          )
            .bind(hook.id)
            .run()
            .catch(() => {}),
        );
      } else {
        await insertHookExecution(env, payload, hook, exId, durationMs, outcome, errorMsg).catch(
          () => {},
        );
      }
    }
  } catch (e) {
    console.warn('[hook-dispatcher] fireAgentHooks failed', e?.message ?? e);
  }
}

async function dispatchHook(env, hook, payload, ctx) {
  let cfg = {};
  try {
    cfg =
      typeof hook.handler_config === 'string'
        ? JSON.parse(hook.handler_config || '{}')
        : hook.handler_config || {};
  } catch {
    cfg = {};
  }
  if (!cfg.command && hook.command) cfg.command = hook.command;

  switch (hook.handler_type) {
    case 'webhook': {
      const url = cfg.url || (hook.command?.startsWith('notify:webhook:')
        ? hook.command.slice('notify:webhook:'.length)
        : null);
      if (!url) return;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.headers ?? {}) },
        body: JSON.stringify({ event: hook.event_type, ...payload }),
      });
      break;
    }
    case 'workers_deploy': {
      // Never re-trigger a Workers Builds deploy for the same worker that just
      // finished post_deploy — that cascades into deploy storms (seen 2026-07-28).
      const payloadWorker =
        payload.worker_name != null
          ? String(payload.worker_name).trim().toLowerCase()
          : payload.workerName != null
            ? String(payload.workerName).trim().toLowerCase()
            : '';
      const event = String(hook.event_type || '').toLowerCase();
      if (event === 'post_deploy' && (!payloadWorker || payloadWorker === 'inneranimalmedia')) {
        console.warn(
          '[hook-dispatcher] skip workers_deploy on post_deploy (anti-cascade)',
          hook.hook_key,
        );
        break;
      }
      const { postWorkersDeployHook } = await import('../../http/agentsam/routes/deploy-hook-runtime.js');
      let hookCfg = {};
      try {
        hookCfg =
          typeof hook.handler_config === 'string'
            ? JSON.parse(hook.handler_config || '{}')
            : hook.handler_config || {};
      } catch {
        hookCfg = {};
      }
      const workerName =
        hookCfg.worker_name != null
          ? String(hookCfg.worker_name).trim()
          : payload.worker_name != null
            ? String(payload.worker_name).trim()
            : null;
      const pr = await postWorkersDeployHook(env, {
        deployHookUrl: hookCfg.url || null,
        workspaceId: payload.workspace_id ?? hook.workspace_id ?? null,
        workerName,
        hookConfig: hookCfg,
      });
      if (pr.error) throw new Error(pr.error);
      if (!pr.ok) throw new Error(`deploy hook HTTP ${pr.status}`);
      break;
    }
    case 'agent_call': {
      const routeKey = cfg.route_key != null ? String(cfg.route_key).trim() : 'debug';
      const ws =
        payload.workspace_id != null ? String(payload.workspace_id).trim() : '';
      if (!ws) break;
      const { executeCommand } = await import('../commands/execute.js');
      const cmd = await env.DB.prepare(
        `SELECT id FROM agentsam_commands
         WHERE route_key = ? AND COALESCE(is_active, 1) = 1
         ORDER BY COALESCE(sort_order, 50) ASC LIMIT 1`,
      )
        .bind(routeKey)
        .first()
        .catch(() => null);
      if (!cmd?.id) {
        console.warn('[hook] agent_call no command for route', routeKey);
        break;
      }
      await executeCommand(env, ctx, {
        commandId: String(cmd.id),
        userId: payload.user_id,
        tenantId: payload.tenant_id,
        workspaceId: ws,
        sessionId: payload.session_id ?? payload.conversation_id ?? null,
        agentRunId: payload.agent_run_id ?? payload.agentRunId ?? null,
        skipApprovalGate: cfg.validate_only === true,
        args: { hook_payload: payload.error ?? payload.message ?? payload },
      });
      break;
    }
    case 'context_load': {
      const ws =
        payload.workspace_id != null ? String(payload.workspace_id).trim() : '';
      if (!ws || !env.DB) break;

      const loadKeys = Array.isArray(cfg.load)
        ? cfg.load.map((k) => String(k || '').trim().toLowerCase()).filter(Boolean)
        : ['project_context'];
      const blockLimit = Math.min(Math.max(1, Number(cfg.limit) || 3), 5);
      const parts = [];

      if (loadKeys.includes('context_digest') || loadKeys.includes('session_digest')) {
        try {
          const digestCols = await pragmaTableInfo(env.DB, 'agentsam_context_digest');
          if (digestCols.has('digest_text')) {
            const existingDigest = await env.DB.prepare(
              `SELECT digest_text FROM agentsam_context_digest
               WHERE workspace_id = ? AND digest_type = 'session'
                 AND (expires_at_unix IS NULL OR expires_at_unix > unixepoch())
               ORDER BY COALESCE(source_updated_at_unix, updated_at_unix, 0) DESC LIMIT 1`,
            )
              .bind(ws)
              .first()
              .catch(() => null);
            const text =
              existingDigest?.digest_text != null ? String(existingDigest.digest_text).trim() : '';
            if (text) parts.push(text);
          }
        } catch (e) {
          console.warn('[hook-dispatcher] context_digest load', e?.message ?? e);
        }
      }

      if (loadKeys.includes('project_context') || loadKeys.includes('project_context_blocks')) {
        const projectRef =
          payload.project_id != null
            ? String(payload.project_id).trim()
            : payload.project_ref != null
              ? String(payload.project_ref).trim()
              : payload.projectId != null
                ? String(payload.projectId).trim()
                : '';
        const blocks = await fetchActiveProjectContextBlocks(env, {
          workspaceId: ws,
          tenantId: payload.tenant_id,
          limit: blockLimit,
          projectRef: projectRef || null,
        });
        if (blocks.length) {
          parts.push(
            [
              projectRef
                ? '## Active project (session-scoped)'
                : '## Workspace project context (not a client-site assignment)',
              blocks.map((b) => b.text).join('\n\n'),
            ].join('\n'),
          );
        }
      }

      const digestText = parts.filter(Boolean).join('\n\n').trim().slice(0, 6000);
      if (!digestText) break;

      const refreshContext =
        payload.refresh_context === true ||
        payload.refreshContext === true ||
        cfg.refresh_context === true;

      try {
        const {
          upsertContextDigest,
          computeContextDigestIdentity,
          contextDigestExistsByHash,
          shouldWriteContextLoadDigest,
        } = await import('../../services/bootstrap/context-digest.js');
        const sessionId =
          payload.session_id != null
            ? String(payload.session_id).trim()
            : payload.conversation_id != null
              ? String(payload.conversation_id).trim()
              : null;
        const projectRef =
          payload.project_id != null
            ? String(payload.project_id).trim()
            : payload.project_ref != null
              ? String(payload.project_ref).trim()
              : payload.projectId != null
                ? String(payload.projectId).trim()
                : '';
        const digestType = projectRef ? 'project' : 'session';
        const sourceMaterial = [
          `workspace_id: ${ws}`,
          sessionId ? `session_id: ${sessionId}` : '',
          projectRef ? `project_id: ${projectRef}` : '',
          digestText,
        ]
          .filter(Boolean)
          .join('\n');
        const { digestHash } = await computeContextDigestIdentity(ws, digestType, sourceMaterial);
        const digestExists = await contextDigestExistsByHash(env, digestHash);
        if (
          !shouldWriteContextLoadDigest({
            refreshContext,
            digestExists,
          })
        ) {
          break;
        }
        await upsertContextDigest(env, {
          workspaceId: ws,
          digestType,
          digestText,
          sourceMaterial,
          sessionId: sessionId || null,
          projectId: projectRef || null,
          namespace: 'hook_context_load',
        });
      } catch (e) {
        console.warn('[hook-dispatcher] context_load digest upsert', e?.message ?? e);
      }
      break;
    }
    case 'web_push': {
      const { sendWebPushFromSubscription, insertPushNotification } =
        await import('../../identity/web-push-runtime.js');
      const recipientId = String(
        payload.recipient_id ?? payload.user_id ?? hook.target_id ?? '',
      ).trim();
      const result = await sendWebPushFromSubscription(env, cfg, {
        title: payload.title ?? payload.subject ?? 'Inner Animal Media',
        body: payload.body ?? payload.message ?? '',
        url: payload.url ?? '/dashboard/agent',
        tag: payload.tag ?? hook.event_type ?? 'iam',
      });
      if (!result.ok) {
        // Dead browser endpoints (gone / expired) must not re-fire on every agent start.
        const stale =
          result.status === 404 ||
          result.status === 410 ||
          result.status === 403 ||
          result.reason === 'send_failed' ||
          result.reason === 'push_service_error' ||
          result.reason === 'invalid_subscription';
        if (stale && hook.hook_key && env.DB) {
          await env.DB.prepare(
            `UPDATE agentsam_hook SET is_active = 0, updated_at = unixepoch()
             WHERE hook_key = ? AND handler_type = 'web_push'`,
          )
            .bind(String(hook.hook_key))
            .run()
            .catch(() => {});
        }
        throw new Error(result.reason || result.error || 'web_push_failed');
      }

      if (recipientId) {
        await insertPushNotification(env, {
          recipientId,
          channel: 'push',
          subject: payload.title ?? payload.subject ?? 'Notification',
          message: payload.body ?? payload.message ?? '',
          entityType: payload.entity_type ?? null,
          entityId: payload.entity_id ?? null,
          status: 'sent',
          data: {
            url: payload.url ?? null,
            tag: payload.tag ?? null,
            hook_id: hook.id,
          },
        });
      }
      break;
    }
    case 'log_only':
      console.log('[hook]', hook.hook_key, JSON.stringify({ ...payload, command: cfg.command }).slice(0, 400));
      break;
    case 'usage_event':
      break;
    default:
      console.warn('[hook-dispatcher] unknown handler_type', hook.handler_type, hook.hook_key);
  }
}
