/**
 * Workspace patch, code-index status/reindex, hooks, security, usage, default-model settings.
 * - PATCH  /api/settings/workspace
 * - GET    /api/settings/workspace/code-index-status
 * - POST   /api/settings/workspace/reindex
 * - POST   /api/settings/workspace/reindex/cancel
 * - GET/POST/DELETE /api/settings/hooks(/:id)
 * - GET    /api/settings/security/sessions
 * - GET/PATCH /api/settings/security/findings(/:id)
 * - DELETE /api/settings/security/sessions/:id
 * - GET    /api/settings/usage
 * - GET/POST /api/settings/default-model
 * Deconstructed from src/api/settings.js (Lane D peel D9, no behavior change).
 * Last named family in the SWARM-MEGAFILE-MODULARIZE-2026-08 plan.
 */
import { jsonResponse } from '../agentsam/shared.js';
import { fetchAuthUserTenantId } from '../../identity/users/tenant.js';
import { userCanAccessWorkspace } from '../../identity/workspace/access.js';
import {
  resolveEffectiveWorkspaceId,
  resolveActiveBootstrap,
  WORKSPACE_CONTEXT_MISSING,
} from '../../identity/bootstrap.js';

function mergeCmsPipelineIntoWorkspaceSettings(existingJson, patchPipeline) {
  let root = {};
  try {
    if (existingJson != null && existingJson !== '') {
      root = typeof existingJson === 'string' ? JSON.parse(existingJson) : existingJson;
    }
  } catch {
    root = {};
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) root = {};
  const prev =
    root.cms_pipeline && typeof root.cms_pipeline === 'object' && !Array.isArray(root.cms_pipeline)
      ? root.cms_pipeline
      : {};
  const merged = {
    ...prev,
    ...(patchPipeline && typeof patchPipeline === 'object' && !Array.isArray(patchPipeline)
      ? patchPipeline
      : {}),
  };
  return JSON.stringify({ ...root, cms_pipeline: merged });
}

function parseJsonSafe(str, fallback = {}) {
  if (str == null || str === '') return { ...fallback };
  try {
    const o = typeof str === 'string' ? JSON.parse(str) : str;
    return typeof o === 'object' && o !== null ? o : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

async function resolveAuthTenantId(env, authUser) {
  if (authUser.tenant_id != null && String(authUser.tenant_id).trim() !== '') {
    return String(authUser.tenant_id).trim();
  }
  let tid = await fetchAuthUserTenantId(env, authUser.id);
  if (tid) return tid;
  if (authUser.email) {
    tid = await fetchAuthUserTenantId(env, authUser.email);
    if (tid) return tid;
  }
  return null;
}

async function resolveRequestWorkspaceId(env, authUser, url) {
  const fromQuery = url.searchParams.get('workspace_id');
  if (fromQuery != null && String(fromQuery).trim() !== '') return String(fromQuery).trim();
  if (!env?.DB) return '';
  const uid = String(authUser?.id || '').trim();
  try {
    const row = await env.DB.prepare(
      `SELECT default_workspace_id FROM user_settings WHERE user_id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
    if (row?.default_workspace_id != null && String(row.default_workspace_id).trim() !== '') {
      return String(row.default_workspace_id).trim();
    }
  } catch (_) {
    /* legacy schema */
  }
  try {
    const row = await env.DB.prepare(
      `SELECT active_workspace_id FROM auth_users WHERE id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
    if (row?.active_workspace_id != null && String(row.active_workspace_id).trim() !== '') {
      return String(row.active_workspace_id).trim();
    }
  } catch (_) {
    /* ignore */
  }
  return '';
}

async function resolveCanonicalUserId(env, sessionUserId, email) {
  if (!env?.DB) return { authId: sessionUserId || null, userId: null };
  const sid = sessionUserId != null ? String(sessionUserId).trim() : '';
  const em = email != null ? String(email).trim() : '';
  try {
    const row = await env.DB.prepare(
      `SELECT au.id as auth_id, u.id as user_id
       FROM auth_users au
       LEFT JOIN users u ON u.auth_id = au.id OR LOWER(COALESCE(u.email,'')) = LOWER(au.email)
       WHERE au.id = ? OR LOWER(au.email) = LOWER(?)
       LIMIT 1`,
    )
      .bind(sid, em || sid)
      .first();
    return { authId: row?.auth_id || (sid || null), userId: row?.user_id || null };
  } catch {
    return { authId: sid || null, userId: null };
  }
}

export async function handleSettingsWorkspaceHooksSecurityUsageRoutes(request, env, ctx, authContext) {
  void ctx;
  const { authUser, url, pathLower, method, sessionUserId } = authContext || {};
  if (!authUser) return null;

  const isThisFamilyPath =
    (pathLower === '/api/settings/workspace' && method === 'PATCH') ||
    pathLower === '/api/settings/workspace/code-index-status' ||
    pathLower === '/api/settings/workspace/reindex' ||
    pathLower === '/api/settings/workspace/reindex/cancel' ||
    pathLower === '/api/settings/hooks' ||
    pathLower.startsWith('/api/settings/hooks/') ||
    pathLower === '/api/settings/security/sessions' ||
    pathLower.startsWith('/api/settings/security/') ||
    pathLower === '/api/settings/usage' ||
    pathLower === '/api/settings/default-model';
  if (!isThisFamilyPath) return null;

  const { authId: canonicalAuthId } = await resolveCanonicalUserId(env, sessionUserId, authUser.email);

  // ── WORKSPACE / HOOKS / SECURITY / USAGE (read surfaces) ──────────────────
  if (pathLower === '/api/settings/workspace' && method === 'PATCH') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const tenantId = await resolveAuthTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'Tenant required' }, 403);

    const body = await request.json().catch(() => ({}));
    const wid =
      body.workspace_id != null && String(body.workspace_id).trim() !== ''
        ? String(body.workspace_id).trim()
        : (await resolveRequestWorkspaceId(env, authUser, url));
    if (!wid) return jsonResponse({ error: 'workspace_id required' }, 400);

    const ok = await userCanAccessWorkspace(env, authUser, wid);
    if (!ok) return jsonResponse({ error: 'Forbidden' }, 403);

    const row = await env.DB.prepare(`SELECT settings_json FROM workspaces WHERE id = ? LIMIT 1`).bind(wid).first();
    if (!row) return jsonResponse({ error: 'Workspace not found' }, 404);

    const hasCmsPipeline = body.cms_pipeline != null && typeof body.cms_pipeline === 'object';
    const hasWorkspaceSettings = body.workspace_settings != null && typeof body.workspace_settings === 'object';
    const hasWorkspaceLimits = body.workspace_limits != null && typeof body.workspace_limits === 'object';
    if (!hasCmsPipeline && !hasWorkspaceSettings && !hasWorkspaceLimits) {
      return jsonResponse(
        { error: 'Provide cms_pipeline, workspace_settings, and/or workspace_limits' },
        400,
      );
    }

    let nextJson = row.settings_json;
    if (hasCmsPipeline) {
      nextJson = mergeCmsPipelineIntoWorkspaceSettings(row.settings_json, body.cms_pipeline);
      await env.DB.prepare(`UPDATE workspaces SET settings_json = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(nextJson, wid)
        .run();
    }

    let parsed = {};
    try {
      parsed =
        nextJson != null && String(nextJson).trim() !== ''
          ? typeof nextJson === 'string'
            ? JSON.parse(nextJson)
            : nextJson
          : {};
    } catch {
      parsed = {};
    }

    if (hasWorkspaceSettings) {
      const wsAllowed = ['theme_id', 'accent_color', 'timezone'];
      const wsCols = [];
      const wsVals = [];
      for (const k of wsAllowed) {
        if (body.workspace_settings[k] !== undefined) {
          wsCols.push(k);
          wsVals.push(body.workspace_settings[k]);
        }
      }
      if (wsCols.length) {
        const colList = wsCols.join(', ');
        const placeholders = wsCols.map(() => '?').join(', ');
        const setExcluded = wsCols.map((c) => `${c} = excluded.${c}`).join(', ');
        await env.DB.prepare(
          `INSERT INTO workspace_settings (workspace_id, ${colList})
           VALUES (?, ${placeholders})
           ON CONFLICT(workspace_id) DO UPDATE SET
           ${setExcluded}, updated_at = datetime('now')`,
        )
          .bind(wid, ...wsVals)
          .run()
          .catch(() => null);
      }
    }

    if (hasWorkspaceLimits) {
      const limAllowed = ['max_daily_cost_usd', 'max_members'];
      const limCols = [];
      const limVals = [];
      for (const k of limAllowed) {
        if (body.workspace_limits[k] !== undefined) {
          limCols.push(k);
          limVals.push(body.workspace_limits[k]);
        }
      }
      if (limCols.length) {
        const colList = limCols.join(', ');
        const placeholders = limCols.map(() => '?').join(', ');
        const setExcluded = limCols.map((c) => `${c} = excluded.${c}`).join(', ');
        await env.DB.prepare(
          `INSERT INTO workspace_limits (workspace_id, ${colList})
           VALUES (?, ${placeholders})
           ON CONFLICT(workspace_id) DO UPDATE SET
           ${setExcluded}, updated_at = datetime('now')`,
        )
          .bind(wid, ...limVals)
          .run()
          .catch(() => null);
      }
    }

    return jsonResponse({ ok: true, settings_json: parsed });
  }

  if (pathLower === '/api/settings/workspace/code-index-status' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const workspaceId = await resolveRequestWorkspaceId(env, authUser, url);
    if (!workspaceId) return jsonResponse({ error: 'workspace_id required' }, 400);
    try {
      const { getWorkspaceCodeIndexStatus } = await import('./workspace-code-index-status.js');
      const status = await getWorkspaceCodeIndexStatus(env, workspaceId);
      return jsonResponse(status);
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  if (pathLower === '/api/settings/workspace/reindex' && method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const workspaceId = await resolveRequestWorkspaceId(env, authUser, url);
    if (!workspaceId) return jsonResponse({ error: 'workspace_id required' }, 400);
    try {
      const body = await request.json().catch(() => ({}));
      const modeRaw = typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : 'ast';
      const mode = ['ast', 'chunks', 'both'].includes(modeRaw) ? modeRaw : 'ast';
      const out = { ok: true, workspace_id: workspaceId, mode, chunks: null, ast: null };

      if (mode === 'chunks' || mode === 'both') {
        const { queueCodeIndexJobAfterDeploy } = await import(
          '../../agentsam/codebase/deploy-code-index-queue.js',
        );
        const queued = await queueCodeIndexJobAfterDeploy(env, {
          workspaceId,
          triggeredBy: 'dashboard_reindex',
          userId: authUser?.id != null ? String(authUser.id) : null,
        });
        let run = null;
        if (queued.ok || queued.skipped) {
          try {
            const { runPendingCodeIndexJob } = await import(
              '../../agentsam/codebase/code-indexer.js'
            );
            run = await runPendingCodeIndexJob(env, {
              cpuBudgetMs: 15_000,
              jobId: queued.job_id || null,
              workspaceId,
            });
          } catch (e) {
            run = { ok: false, error: String(e?.message || e) };
          }
        }
        out.chunks = { queued, run };
        if (!queued.ok && !queued.skipped) {
          return jsonResponse({ error: queued.error || 'queue_failed', ...out }, 500);
        }
      }

      if (mode === 'ast' || mode === 'both') {
        const { queueAstSymbolReembed, runAstSymbolReembedJob } = await import(
          '../core/ast-symbol-reembed.js'
        );
        const queued = await queueAstSymbolReembed(env, {
          workspaceId,
          triggeredBy: 'dashboard_ast_reindex',
          userId: authUser?.id != null ? String(authUser.id) : null,
        });
        // One Worker round per HTTP request so Settings UI can refresh % each loop.
        let run = null;
        const rounds = [];
        if (queued.ok) {
          run = await runAstSymbolReembedJob(env, workspaceId, {
            userId: authUser?.id != null ? String(authUser.id) : null,
            cpuBudgetMs: 18_000,
            maxNodes: 48,
          });
          rounds.push({
            embedded: run?.embedded ?? 0,
            offset: run?.offset ?? null,
            total: run?.total ?? null,
            complete: !!run?.complete,
            resume: !!run?.resume,
            cancelled: !!run?.cancelled,
            error: run?.error ?? null,
          });
        }
        out.ast = { queued, run, rounds };
        if (!queued.ok && !queued.skipped) {
          return jsonResponse({ error: queued.error || 'ast_queue_failed', ...out }, 500);
        }
        if (run && run.ok === false) {
          return jsonResponse({ error: run.error || 'ast_reembed_failed', ...out }, 500);
        }
      }

      return jsonResponse(out);
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  if (pathLower === '/api/settings/workspace/reindex/cancel' && method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const workspaceId = await resolveRequestWorkspaceId(env, authUser, url);
    if (!workspaceId) return jsonResponse({ error: 'workspace_id required' }, 400);
    try {
      const body = await request.json().catch(() => ({}));
      const reason =
        typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim().slice(0, 500)
          : 'cancelled_from_settings';
      const { cancelAstSymbolReembed } = await import(
        '../../../src/core/ast-symbol-reembed.js',
      );
      const result = await cancelAstSymbolReembed(env, workspaceId, { reason });
      if (!result.ok) {
        return jsonResponse({ error: result.error || 'cancel_failed', ...result }, 500);
      }
      return jsonResponse({ ok: true, workspace_id: workspaceId, ...result });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  if (pathLower === '/api/settings/hooks' && method === 'GET') {
    if (!env.DB) return jsonResponse({ hooks: [], executions: [] });
    const workspaceId = await resolveRequestWorkspaceId(env, authUser, url);
    const storedUserId = canonicalAuthId || sessionUserId;
    const [hooks, executions] = await Promise.all([
      env.DB.prepare(
        `SELECT h.*,
          (SELECT COUNT(*) FROM agentsam_hook_execution e WHERE e.hook_id = h.id) AS run_count,
          (SELECT MAX(ran_at) FROM agentsam_hook_execution e WHERE e.hook_id = h.id) AS last_ran
         FROM agentsam_hook h
         WHERE h.user_id = ? AND COALESCE(h.workspace_id, '') = COALESCE(?, '')`,
      )
        .bind(String(storedUserId), workspaceId || null)
        .all()
        .catch(() => ({ results: [] })),
      env.DB.prepare(
        `SELECT * FROM agentsam_hook_execution WHERE user_id = ? ORDER BY datetime(ran_at) DESC LIMIT 50`,
      )
        .bind(String(storedUserId))
        .all()
        .catch(() => ({ results: [] })),
    ]);
    return jsonResponse({ hooks: hooks.results || [], executions: executions.results || [] });
  }

  if (pathLower === '/api/settings/hooks' && method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const workspaceId = await resolveRequestWorkspaceId(env, authUser, url);
    const storedUserId = canonicalAuthId || sessionUserId;
    const body = await request.json().catch(() => ({}));
    const trigger = typeof body.trigger === 'string' ? body.trigger.trim() : '';
    const command = typeof body.command === 'string' ? body.command.trim() : '';
    const provider = typeof body.provider === 'string' ? body.provider.trim() : 'system';
    if (!trigger) return jsonResponse({ error: 'trigger required' }, 400);
    if (!command) return jsonResponse({ error: 'command required' }, 400);
    const id = `hook_${crypto.randomUUID()}`;
    const is_active = body.is_active === false || body.is_active === 0 || body.is_active === '0' ? 0 : 1;
    await env.DB.prepare(
      `INSERT INTO agentsam_hook (id, user_id, workspace_id, trigger, command, provider, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        id,
        String(storedUserId),
        workspaceId != null && String(workspaceId).trim() !== '' ? String(workspaceId).trim() : null,
        trigger,
        command,
        provider,
        is_active,
      )
      .run();
    return jsonResponse({ ok: true, id });
  }

  {
    const m = pathLower.match(/^\/api\/settings\/hooks\/([^/]+)$/);
    if (m && method === 'PATCH') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const id = decodeURIComponent(m[1] || '').trim();
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const storedUserId = canonicalAuthId || sessionUserId;
      const body = await request.json().catch(() => ({}));
      const allowed = ['is_active', 'trigger', 'command', 'provider'];
      const keys = allowed.filter((k) => body && Object.prototype.hasOwnProperty.call(body, k));
      if (!keys.length) return jsonResponse({ error: 'No fields to update' }, 400);
      const sets = keys.map((k) => `${k} = ?`).join(', ');
      const vals = keys.map((k) => body[k]);
      await env.DB.prepare(
        `UPDATE agentsam_hook SET ${sets}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      )
        .bind(...vals, id, String(storedUserId))
        .run();
      return jsonResponse({ ok: true });
    }
    if (m && method === 'DELETE') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const id = decodeURIComponent(m[1] || '').trim();
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const storedUserId = canonicalAuthId || sessionUserId;
      await env.DB.prepare(`DELETE FROM agentsam_hook WHERE id = ? AND user_id = ?`)
        .bind(id, String(storedUserId))
        .run();
      return jsonResponse({ ok: true });
    }
  }

  if (pathLower === '/api/settings/security/sessions' && method === 'GET') {
    if (!env.DB) return jsonResponse({ sessions: [] });
    const storedUserId = canonicalAuthId || sessionUserId;
    const uid = String(storedUserId);
    try {
      await env.DB.prepare(
        `UPDATE auth_sessions
            SET revoked_at = datetime('now'), revoke_reason = 'expired'
          WHERE user_id = ?
            AND (revoked_at IS NULL OR TRIM(COALESCE(revoked_at, '')) = '')
            AND expires_at IS NOT NULL AND TRIM(expires_at) != ''
            AND datetime(replace(replace(expires_at, 'T', ' '), 'Z', '')) < datetime('now')`,
      )
        .bind(uid)
        .run();
    } catch (e) {
      console.warn('[settings/sessions] expire prune', e?.message ?? e);
    }
    const { results } = await env.DB.prepare(
      `SELECT id, provider, ip_address, user_agent, last_active_at, expires_at, created_at
       FROM auth_sessions
       WHERE user_id = ? AND (revoked_at IS NULL OR TRIM(COALESCE(revoked_at, '')) = '')
         AND (
           CASE
             WHEN last_active_at IS NOT NULL AND CAST(last_active_at AS INTEGER) > 1000000000000
               THEN CAST(last_active_at AS INTEGER) >= (unixepoch() * 1000 - 86400000)
             WHEN last_active_at IS NOT NULL
               THEN CAST(last_active_at AS INTEGER) >= (unixepoch() - 86400)
             ELSE created_at >= datetime('now', '-1 day')
           END
         )
       ORDER BY COALESCE(last_active_at, created_at) DESC
       LIMIT 50`,
    )
      .bind(uid)
      .all()
      .catch(() => ({ results: [] }));
    return jsonResponse({ sessions: results || [], window: '24h' });
  }

  if (pathLower === '/api/settings/security/findings' && method === 'GET') {
    if (!env.DB) return jsonResponse({ findings: [] });
    const tenantId = await resolveAuthTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ findings: [] });
    const storedUserId = canonicalAuthId || sessionUserId;
    const userScope = storedUserId != null ? String(storedUserId).trim() : '';
    try {
      const { results } = await env.DB.prepare(
        `SELECT id, finding_type, severity, snippet_redacted, status, source_type, source_ref, created_at
         FROM security_findings
         WHERE tenant_id = ?
           AND (? = '' OR user_id IS NULL OR user_id = '' OR user_id = ?)
         ORDER BY created_at DESC
         LIMIT 100`,
      )
        .bind(tenantId, userScope, userScope)
        .all()
        .catch(() => ({ results: [] }));
      return jsonResponse({ findings: results || [] });
    } catch {
      return jsonResponse({ findings: [] });
    }
  }

  {
    const m = pathLower.match(/^\/api\/settings\/security\/findings\/([^/]+)$/);
    if (m && method === 'PATCH') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const findingId = decodeURIComponent(m[1] || '').trim();
      if (!findingId) return jsonResponse({ error: 'id required' }, 400);
      const tenantId = await resolveAuthTenantId(env, authUser);
      if (!tenantId) return jsonResponse({ error: 'Tenant required' }, 403);
      const body = await request.json().catch(() => ({}));
      const newStatus = typeof body.status === 'string' ? body.status.trim() : '';
      const allowed = ['triaged', 'false_positive', 'fixed'];
      if (!allowed.includes(newStatus)) {
        return jsonResponse({ error: 'invalid_status' }, 400);
      }
      const resolvedClause =
        newStatus === 'false_positive' || newStatus === 'fixed'
          ? ', resolved_at = unixepoch(), suppressed_until = unixepoch() + 315360000'
          : '';
      let out;
      try {
        out = await env.DB.prepare(
          `UPDATE security_findings
           SET status = ?, updated_at = unixepoch()${resolvedClause}
           WHERE id = ? AND tenant_id = ?`,
        )
          .bind(newStatus, findingId, tenantId)
          .run();
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 500);
      }
      const changes = out?.meta?.changes ?? 0;
      if (!out?.success || changes === 0) {
        return jsonResponse({ error: 'not_found', id: findingId }, 404);
      }
      return jsonResponse({ ok: true, id: findingId, status: newStatus, changes });
    }
  }

  {
    const m = pathLower.match(/^\/api\/settings\/security\/sessions\/([^/]+)$/);
    if (m && method === 'DELETE') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const id = decodeURIComponent(m[1] || '').trim();
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const storedUserId = canonicalAuthId || sessionUserId;
      await env.DB.prepare(
        `UPDATE auth_sessions SET revoked_at = datetime('now'), revoke_reason = 'user_revoked'
         WHERE id = ? AND user_id = ?`,
      )
        .bind(id, String(storedUserId))
        .run();
      if (env.SESSION_CACHE) {
        try {
          const { deleteSessionKvPayload } = await import(
            '../../../src/core/session-context-kv-bridge.js',
          );
          await deleteSessionKvPayload(env, id);
        } catch (_) {}
      }
      return jsonResponse({ ok: true });
    }
  }

  if (pathLower === '/api/settings/usage' && method === 'GET') {
    if (!env.DB) return jsonResponse({ summary: [], ledger: [], total: 0, page: 1 });
    const tenantId = await resolveAuthTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'Tenant required' }, 403);
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const provider = String(url.searchParams.get('provider') || '').trim();
    const model = String(url.searchParams.get('model') || '').trim();
    const offset = (page - 1) * 50;
    let where = `WHERE tenant_id = ?`;
    const params = [tenantId];
    if (provider) {
      where += ` AND provider = ?`;
      params.push(provider);
    }
    if (model) {
      where += ` AND COALESCE(model_key, model) = ?`;
      params.push(model);
    }
    const [summary, ledger, total] = await Promise.all([
      env.DB.prepare(
        `SELECT provider, COALESCE(model_key, model) AS model_used,
                SUM(tokens_in) AS input_tokens,
                SUM(tokens_out) AS output_tokens,
                COUNT(*) AS call_count,
                ROUND(SUM(cost_usd), 4) AS cost_usd
         FROM agentsam_usage_events
         WHERE tenant_id = ? AND created_at >= unixepoch(date('now','start of month'))
         GROUP BY provider, COALESCE(model_key, model)
         ORDER BY cost_usd DESC`,
      )
        .bind(tenantId)
        .all()
        .catch(() => ({ results: [] })),
      env.DB.prepare(
        `SELECT provider, COALESCE(model_key, model) AS model_used, tokens_in AS input_tokens, tokens_out AS output_tokens, cost_usd, created_at
         FROM agentsam_usage_events
         ${where}
         ORDER BY created_at DESC
         LIMIT 50 OFFSET ?`,
      )
        .bind(...params, offset)
        .all()
        .catch(() => ({ results: [] })),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM agentsam_usage_events ${where}`,
      )
        .bind(...params)
        .first()
        .catch(() => ({ n: 0 })),
    ]);
    return jsonResponse({
      summary: summary.results || [],
      ledger: ledger.results || [],
      total: Number(total?.n || 0),
      page,
    });
  }

  // ── GET /api/settings/default-model ──────────────────────────────────────
  if (pathLower === '/api/settings/default-model' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    try {
      const wsRes = await resolveEffectiveWorkspaceId(env, request, authUser, {});
      if (wsRes.error === WORKSPACE_CONTEXT_MISSING || !wsRes.workspaceId) {
        return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
      }
      const workspaceId = wsRes.workspaceId;
      const { loadUserUiPreferences } = await import(
        '../../../src/core/bootstrap-service-bridge.js',
      );
      const prefs = await loadUserUiPreferences(env, {
        workspaceId,
        userId: sessionUserId,
      });
      const default_model =
        typeof prefs.default_model === 'string' && prefs.default_model.trim()
          ? prefs.default_model.trim()
          : null;
      return jsonResponse({ default_model });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  // ── POST /api/settings/default-model ─────────────────────────────────────
  if (pathLower === '/api/settings/default-model' && method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const tenantId = await resolveAuthTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'Tenant required' }, 403);
    const body = await request.json().catch(() => ({}));
    const modelKey = String(body.model_key || '').trim();
    if (!modelKey) return jsonResponse({ error: 'model_key required' }, 400);
    try {
      const wsRes = await resolveEffectiveWorkspaceId(env, request, authUser, {});
      if (wsRes.error === WORKSPACE_CONTEXT_MISSING || !wsRes.workspaceId) {
        return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
      }
      const workspaceId = wsRes.workspaceId;
      const { loadUserUiPreferences, upsertUserUiPreferences, resolveAgentSamBootstrap } =
        await import('../../../src/core/bootstrap-service-bridge.js');
      const prefs = await loadUserUiPreferences(env, {
        workspaceId,
        userId: sessionUserId,
      });
      prefs.default_model = modelKey;
      await upsertUserUiPreferences(env, {
        workspaceId,
        userId: sessionUserId,
        preferences: prefs,
      });
      await resolveAgentSamBootstrap(env, {
        userId: sessionUserId,
        requestedWorkspaceId: workspaceId,
        authUser,
        refresh: true,
      });
      return jsonResponse({ ok: true, default_model: modelKey });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  return null;
}
