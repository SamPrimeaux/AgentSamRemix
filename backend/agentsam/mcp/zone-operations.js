/**
 * MCP zone operational helpers — patch ledger, handoff, sandbox slug resolve.
 */
import { createAgentRunId, startAgentRun } from '../../telemetry/agent-run.js';
import { createSpawnSessionForChild } from '../runtime/spawn/d1.js';
import { recordAgentsamPatchSession } from '../../../src/core/agentsam-patch-sessions.js';
import {
  normalizeMcpZoneSlug,
  normalizeSandboxContainerSlug,
  resolveMcpZoneWorkspaceId,
  MCP_ZONE_SLUGS,
} from './zone-contract.js';
import { ensureMcpZoneWorkspace } from './zone-session.js';

const MCP_ZONE_SLUG_SET = new Set(MCP_ZONE_SLUGS);

/**
 * Sandbox cwd zone tag (MCP panel facet or username) — NOT the CF Container DO id.
 * @param {any} env
 * @param {{
 *   zoneSlug?: string | null,
 *   userId?: string | null,
 *   username?: string | null,
 *   workspaceId?: string | null,
 *   tenantId?: string | null,
 * }} p
 */
export async function resolveSandboxContainerSlug(env, p) {
  const explicit = String(p.zoneSlug || '').trim();
  if (explicit) {
    const role = normalizeMcpZoneSlug(explicit);
    if (MCP_ZONE_SLUG_SET.has(role)) return role;
    const userSlug = normalizeSandboxContainerSlug(explicit);
    if (userSlug) return userSlug;
  }

  for (const raw of [p.username]) {
    const slug = normalizeSandboxContainerSlug(raw);
    if (slug) return slug;
  }

  if (env?.DB && p.userId) {
    const uid = String(p.userId).trim();
    const row = await env.DB.prepare(
      `SELECT au.name, au.email, uip.github_username, uip.preferred_name
         FROM auth_users au
         LEFT JOIN user_identity_profiles uip ON uip.auth_user_id = au.id
        WHERE au.id = ? LIMIT 1`,
    )
      .bind(uid)
      .first()
      .catch(() => null);
    for (const raw of [row?.github_username, row?.preferred_name, row?.name]) {
      const slug = normalizeSandboxContainerSlug(raw);
      if (slug) return slug;
    }
    const emailLocal = String(row?.email || '')
      .split('@')[0]
      .trim();
    const fromEmail = normalizeSandboxContainerSlug(emailLocal);
    if (fromEmail) return fromEmail;
  }

  if (env?.DB && p.workspaceId) {
    const wsId = String(p.workspaceId).trim();
    const row = await env.DB.prepare(
      `SELECT handle, name FROM workspaces WHERE id = ? LIMIT 1`,
    )
      .bind(wsId)
      .first()
      .catch(() => null);
    const fromHandle = normalizeSandboxContainerSlug(row?.handle);
    if (fromHandle) return fromHandle;
  }

  return 'specialist';
}

/**
 * Record sandbox/patch activity in agentsam_patch_sessions.
 * @param {any} env
 * @param {any} [ctx]
 * @param {{
 *   zoneSlug: string,
 *   tenantId: string,
 *   workspaceId?: string | null,
 *   conversationId: string,
 *   agentRunId?: string | null,
 *   modelKey?: string|null,
 *   taskFile?: string|null,
 *   passed?: number,
 *   applied?: number,
 *   costUsd?: number,
 *   failReason?: string|null,
 * }} p
 */
export function recordMcpZonePatchSession(env, ctx, p) {
  recordAgentsamPatchSession(env, ctx, {
    agentRunId: p.agentRunId ?? null,
    tenantId: p.tenantId,
    workspaceId: p.workspaceId ?? null,
    conversationId: p.conversationId,
    planId: p.agentRunId || `mcp_zone_${normalizeMcpZoneSlug(p.zoneSlug)}`,
    taskFile: String(p.taskFile || p.zoneSlug || 'sandbox'),
    modelKey: p.modelKey ?? 'mcp_zone',
    provider: 'mcp_zone',
    passed: !!p.passed,
    applied: !!p.applied,
    costUsd: Number(p.costUsd) || 0,
    failReason: p.failReason ?? null,
  });
}

/**
 * Cross-zone handoff via agentsam_spawn_session.
 * @param {any} env
 * @param {{
 *   fromZone: string,
 *   toZone: string,
 *   tenantId: string,
 *   userId: string,
 *   parentRunId: string,
 *   parentSessionId: string,
 *   rootSessionId: string,
 *   fallbackModelKey: string,
 * }} p
 */
export async function createMcpZoneHandoff(env, p) {
  if (!env?.DB) return { ok: false };
  const childSessionId = crypto.randomUUID();
  const childRunId = createAgentRunId({ label: 'mcp_handoff' });
  const toWs = resolveMcpZoneWorkspaceId(p.toZone, p.tenantId);
  const userId = String(p.userId || '').trim();
  const tenantId = String(p.tenantId || '').trim();
  let spawnSessionId = null;
  if (!userId || !tenantId) return { ok: false, error: 'user_or_tenant_required' };

  await ensureMcpZoneWorkspace(env, {
    zoneSlug: p.toZone,
    tenantId: p.tenantId,
    userId: p.userId,
  });

  try {
    const { ensureChatSessionRow } = await import('../sessions/index.js');
    await ensureChatSessionRow(env, {
      conversationId: childSessionId,
      tenantId,
      userId,
      workspaceId: toWs,
      title: `MCP handoff → ${p.toZone}`,
      parentConversationId: p.parentSessionId,
    });
    const started = await startAgentRun(env, {
      runId: childRunId, userId, tenantId, workspaceId: toWs,
      conversationId: childSessionId, mode: 'agent',
      modelKey: p.fallbackModelKey, selectedBy: 'fallback',
    });
    if (!started.ok) throw new Error(started.reason || 'child_run_start_failed');
    const handoff = await createSpawnSessionForChild(env, {
      workspaceId: toWs, tenantId, parentRunId: p.parentRunId,
      childRunId, parentSessionId: p.parentSessionId, childSessionId,
      rootSessionId: p.rootSessionId, fallbackModelKey: p.fallbackModelKey,
      reason: 'context', urgency: 'medium', depth: 1,
    });
    if (!handoff.ok) throw new Error(handoff.reason || 'spawn_session_create_failed');
    spawnSessionId = handoff.spawnSessionId;
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }

  return { ok: true, spawnSessionId, childSessionId, childRunId, targetWorkspaceId: toWs };
}
