/**
 * MCP zone session state — agentsam_workspace + agentsam_workspace_state authority.
 */
import { createAgentRunId, startAgentRun } from '../../telemetry/agent-run.js';
import { createSpawnJob } from '../runtime/spawn/d1.js';
import {
  mapZoneStateToSession,
  normalizeMcpZoneSlug,
  parseMcpZoneStateJson,
  resolveMcpZoneConversationId,
  resolveMcpZoneWorkspaceId,
  MCP_ZONE_SLUGS,
} from './zone-contract.js';

function defaultZoneState(zoneSlug, tenantId) {
  return {
    panel: 'mcp_zone',
    zone_slug: normalizeMcpZoneSlug(zoneSlug),
    tenant_id: String(tenantId || '').trim(),
    status: 'idle',
    current_task: null,
    progress_pct: 0,
    cost_usd: 0,
    tool_calls_count: 0,
    messages: [],
    logs: [],
    spawn_job_id: null,
    master_run_id: null,
    last_activity: null,
  };
}

/**
 * Ensure per-zone isolated agentsam_workspace + workspace_settings + workspace_state.
 * @param {any} env
 * @param {{ zoneSlug: string, tenantId: string, userId?: string|null, callerWorkspaceId?: string|null }} p
 */
export async function ensureMcpZoneWorkspace(env, p) {
  if (!env?.DB) return { ok: false, error: 'no_db' };
  const zoneSlug = normalizeMcpZoneSlug(p.zoneSlug);
  const tenantId = String(p.tenantId || '').trim();
  if (!tenantId) return { ok: false, error: 'tenant_required' };

  const workspaceId = resolveMcpZoneWorkspaceId(zoneSlug, tenantId);
  const conversationId = resolveMcpZoneConversationId(zoneSlug, tenantId);
  const displayName = `MCP ${zoneSlug.charAt(0).toUpperCase()}${zoneSlug.slice(1)} Zone`;
  const slug = `mcp-${zoneSlug}-${tenantId.replace(/[^a-z0-9]/gi, '-').slice(0, 24)}`;

  const settingsJson = JSON.stringify({
    mcp_zone: true,
    mcp_zone_slug: zoneSlug,
    zone_root_template: `.mcp-zones/${zoneSlug}`,
    caller_workspace_id: p.callerWorkspaceId || null,
    sandbox_workspace_id: workspaceId,
  });

  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO agentsam_workspace (
         id, workspace_slug, tenant_id, name, display_name, status, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'active', unixepoch())`,
    )
      .bind(workspaceId, slug, tenantId, displayName, displayName)
      .run();

    await env.DB.prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, handle, status, owner_tenant_id, default_tenant_id, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(workspaceId, displayName, slug, tenantId, tenantId)
      .run()
      .catch(() => {});

    await env.DB.prepare(
      `INSERT INTO workspace_settings (workspace_id, settings_json, updated_at)
       VALUES (?, ?, unixepoch())
       ON CONFLICT(workspace_id) DO UPDATE SET
         settings_json = excluded.settings_json,
         updated_at = excluded.updated_at`,
    )
      .bind(workspaceId, settingsJson)
      .run()
      .catch(async () => {
        await env.DB.prepare(
          `INSERT OR REPLACE INTO workspace_settings (workspace_id, settings_json, updated_at)
           VALUES (?, ?, unixepoch())`,
        )
          .bind(workspaceId, settingsJson)
          .run();
      });

    const baseState = defaultZoneState(zoneSlug, tenantId);
    baseState.conversation_id = conversationId;

    await env.DB.prepare(
      `INSERT INTO agentsam_workspace_state (
         id, workspace_id, conversation_id, workspace_type, state_json, created_at, updated_at
       ) VALUES ('wss_' || lower(hex(randomblob(8))), ?, ?, 'mcp_zone', ?, unixepoch(), unixepoch())
       ON CONFLICT(workspace_id) DO UPDATE SET
         conversation_id = COALESCE(agentsam_workspace_state.conversation_id, excluded.conversation_id),
         workspace_type = 'mcp_zone',
         updated_at = unixepoch()`,
    )
      .bind(workspaceId, conversationId, JSON.stringify(baseState))
      .run()
      .catch(async () => {
        const existing = await env.DB.prepare(
          `SELECT id, state_json FROM agentsam_workspace_state WHERE workspace_id = ? LIMIT 1`,
        )
          .bind(workspaceId)
          .first();
        if (existing?.id) {
          const merged = { ...baseState, ...parseMcpZoneStateJson(existing.state_json) };
          await env.DB.prepare(
            `UPDATE agentsam_workspace_state SET state_json = ?, workspace_type = 'mcp_zone', updated_at = unixepoch() WHERE id = ?`,
          )
            .bind(JSON.stringify(merged), existing.id)
            .run();
        } else {
          await env.DB.prepare(
            `INSERT INTO agentsam_workspace_state (id, workspace_id, conversation_id, workspace_type, state_json, created_at, updated_at)
             VALUES ('wss_' || lower(hex(randomblob(8))), ?, ?, 'mcp_zone', ?, unixepoch(), unixepoch())`,
          )
            .bind(workspaceId, conversationId, JSON.stringify(baseState))
            .run();
        }
      });
  } catch (e) {
    return { ok: false, error: String(e?.message || e), workspaceId, conversationId };
  }

  return { ok: true, workspaceId, conversationId, zoneSlug };
}

/** @param {any} env @param {{ zoneSlug: string, tenantId: string }} p */
export async function loadMcpZoneSession(env, p) {
  if (!env?.DB) return null;
  const zoneSlug = normalizeMcpZoneSlug(p.zoneSlug);
  const workspaceId = resolveMcpZoneWorkspaceId(zoneSlug, p.tenantId);
  const row = await env.DB.prepare(
    `SELECT id, workspace_id, conversation_id, state_json, updated_at, workspace_type
       FROM agentsam_workspace_state WHERE workspace_id = ? LIMIT 1`,
  )
    .bind(workspaceId)
    .first()
    .catch(() => null);
  if (!row) return null;
  return mapZoneStateToSession(row, zoneSlug);
}

/**
 * @param {any} env
 * @param {{
 *   zoneSlug: string,
 *   tenantId: string,
 *   userId?: string|null,
 *   patch: Record<string, unknown>,
 * }} p
 */
export async function patchMcpZoneWorkspaceState(env, p) {
  if (!env?.DB) return { ok: false };
  const zoneSlug = normalizeMcpZoneSlug(p.zoneSlug);
  const workspaceId = resolveMcpZoneWorkspaceId(zoneSlug, p.tenantId);
  const row = await env.DB.prepare(
    `SELECT id, state_json, conversation_id FROM agentsam_workspace_state WHERE workspace_id = ? LIMIT 1`,
  )
    .bind(workspaceId)
    .first()
    .catch(() => null);
  if (!row?.id) return { ok: false, error: 'zone_state_missing' };

  const prev = { ...defaultZoneState(zoneSlug, p.tenantId), ...parseMcpZoneStateJson(row.state_json) };
  const next = { ...prev, ...p.patch, zone_slug: zoneSlug, tenant_id: String(p.tenantId || '').trim() };
  if (p.patch.status === 'running' && !next.last_activity) {
    next.last_activity = new Date().toISOString();
  }

  await env.DB.prepare(
    `UPDATE agentsam_workspace_state SET state_json = ?, updated_at = unixepoch() WHERE id = ?`,
  )
    .bind(JSON.stringify(next), row.id)
    .run();

  return {
    ok: true,
    conversationId: String(row.conversation_id || prev.conversation_id || '').trim(),
    state: next,
  };
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   zoneSlug: string,
 *   tenantId: string,
 *   userId: string,
 *   callerWorkspaceId?: string|null,
 *   task?: string|null,
 *   createSpawnJob?: boolean,
 * }} p
 */
export async function startMcpZoneSession(env, ctx, p) {
  const ensured = await ensureMcpZoneWorkspace(env, {
    zoneSlug: p.zoneSlug,
    tenantId: p.tenantId,
    userId: p.userId,
    callerWorkspaceId: p.callerWorkspaceId,
  });
  if (!ensured.ok) return ensured;

  const zoneSlug = ensured.zoneSlug;
  const masterRunId = createAgentRunId({ label: `mcp_${zoneSlug}` });
  let spawnJobId = null;

  if (p.createSpawnJob && p.userId) {
    const sj = await createSpawnJob(env, ctx, {
      masterRunId,
      masterAgentSlug: zoneSlug,
      userId: p.userId,
      workspaceId: ensured.workspaceId,
      tenantId: p.tenantId,
      taskDescription: String(p.task || '').slice(0, 4000) || `MCP zone ${zoneSlug}`,
      chunkCount: 1,
      orchestratorSlug: zoneSlug,
      mergeStrategy: 'concat',
      mode: 'agent',
      conversationId: ensured.conversationId,
    });
    if (sj.ok) spawnJobId = sj.spawnJobId;
  }

  if (p.userId && env?.DB) {
    await startAgentRun(env, {
      runId: masterRunId,
      userId: p.userId,
      workspaceId: ensured.workspaceId,
      tenantId: p.tenantId,
      conversationId: ensured.conversationId,
      mode: 'agent',
      modelKey: zoneSlug,
    }).catch((error) => {
      console.warn('[mcp-zone] agent_run_start', error?.message ?? error);
    });
  }

  await patchMcpZoneWorkspaceState(env, {
    zoneSlug,
    tenantId: p.tenantId,
    patch: {
      status: p.task ? 'running' : 'idle',
      current_task: p.task ? String(p.task).slice(0, 500) : null,
      progress_pct: p.task ? 5 : 0,
      master_run_id: masterRunId,
      spawn_job_id: spawnJobId,
      conversation_id: ensured.conversationId,
    },
  });

  return {
    ok: true,
    workspaceId: ensured.workspaceId,
    conversationId: ensured.conversationId,
    zoneSlug,
    masterRunId,
    spawnJobId,
  };
}

/** @param {any} env @param {{ zoneSlug: string, tenantId: string, userId?: string, messages?: unknown[], toolCallsUsed?: number, status?: string }} p */
export async function finalizeMcpZoneChat(env, p) {
  const zoneSlug = normalizeMcpZoneSlug(p.zoneSlug);
  const workspaceId = resolveMcpZoneWorkspaceId(zoneSlug, p.tenantId);
  const row = await env.DB?.prepare(
    `SELECT state_json FROM agentsam_workspace_state WHERE workspace_id = ? LIMIT 1`,
  )
    ?.bind(workspaceId)
    ?.first()
    ?.catch(() => null);
  const prev = parseMcpZoneStateJson(row?.state_json);

  const patch = {
    status: p.status || 'idle',
    tool_calls_count: (Number(prev.tool_calls_count) || 0) + (Number(p.toolCallsUsed) || 0),
    current_task: null,
    progress_pct: 0,
    last_activity: new Date().toISOString(),
  };
  if (Array.isArray(p.messages)) {
    patch.messages = p.messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role, content: String(m.content || '') }))
      .slice(-40);
  }

  return patchMcpZoneWorkspaceState(env, {
    zoneSlug,
    tenantId: p.tenantId,
    patch,
  });
}

/** @param {any} env @param {{ zoneSlug: string, tenantId: string }} p */
export async function resetMcpZoneSession(env, p) {
  const zoneSlug = normalizeMcpZoneSlug(p.zoneSlug);
  return patchMcpZoneWorkspaceState(env, {
    zoneSlug,
    tenantId: p.tenantId,
    patch: {
      status: 'idle',
      current_task: null,
      progress_pct: 0,
      messages: [],
      logs: [],
    },
  });
}

/** @param {any} env @param {string} tenantId */
export async function resetAllMcpZoneSessions(env, tenantId) {
  const tid = String(tenantId || '').trim();
  if (!env?.DB || !tid) return { ok: false };
  for (const zoneSlug of MCP_ZONE_SLUGS) {
    await resetMcpZoneSession(env, { zoneSlug, tenantId: tid });
  }
  return { ok: true };
}
