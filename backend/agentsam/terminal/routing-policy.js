/**
 * Terminal exec routing — three lanes (see docs/platform/terminal-three-lane-model.md):
 *   local  → user_hosted_tunnel (caller's device)
 *   remote → platform_vm GCP iam-tunnel (authorized cloud desk)
 *   sandbox → sandbox (MY_CONTAINER shared pool; zone_slug is cwd/R2 only)
 *
 * Routing SSOT: agentsam_tools.handler_config (target_type, default_target_id,
 * requires_privileged_terminal, lane). No JS tool-name Sets.
 *
 * Operator status must be passed as ctx.mayUsePrivilegedTerminal (from workspace-grants).
 */

function ctxMayUsePrivilegedTerminal(ctx = {}) {
  return (
    ctx.mayUsePrivilegedTerminal === true ||
    ctx.may_use_privileged_terminal === true
  );
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function parseTerminalHandlerConfig(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return /** @type {Record<string, unknown>} */ (raw);
  }
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, unknown>} cfg
 * @returns {boolean}
 */
function configRequiresPrivilegedTerminal(cfg) {
  if (cfg.requires_privileged_terminal === true || cfg.requires_privileged_terminal === 1) return true;
  if (cfg.requires_privileged_terminal === false || cfg.requires_privileged_terminal === 0) return false;
  // Fail closed for platform_vm without an explicit flag.
  return String(cfg.target_type || '').trim() === 'platform_vm';
}

/**
 * @param {{
 *   tool_name?: string|null,
 *   toolName?: string|null,
 *   tool_key?: string|null,
 *   toolKey?: string|null,
 *   target_id?: string|null,
 *   target_type?: string|null,
 *   client_surface?: string|null,
 *   exec_lane?: string|null,
 *   user_id?: string|null,
 *   userId?: string|null,
 *   mayUsePrivilegedTerminal?: boolean|null,
 *   may_use_privileged_terminal?: boolean|null,
 *   handler_config?: unknown,
 *   handlerConfig?: unknown,
 * }} [ctx]
 */
export function resolveTerminalExecRouting(ctx = {}) {
  const cfg = parseTerminalHandlerConfig(ctx.handler_config ?? ctx.handlerConfig);
  const explicitTarget = ctx.target_id != null ? String(ctx.target_id).trim() : '';
  const explicitType = ctx.target_type != null ? String(ctx.target_type).trim() : '';
  const hasGrant = ctxMayUsePrivilegedTerminal(ctx);

  const targetType = explicitType || (cfg.target_type != null ? String(cfg.target_type).trim() : '');
  const defaultTargetId =
    cfg.default_target_id != null && String(cfg.default_target_id).trim() !== ''
      ? String(cfg.default_target_id).trim()
      : null;
  const configuredLane = cfg.lane != null && String(cfg.lane).trim() !== '' ? String(cfg.lane).trim() : null;

  if (!targetType && !explicitTarget) {
    // Fail closed: no D1 handler_config.target_type and no explicit override.
    return { target_type: null, target_id: null, lane: null };
  }

  if (targetType === 'user_hosted_tunnel') {
    return {
      target_type: explicitType || 'user_hosted_tunnel',
      target_id: explicitTarget || null,
      lane: configuredLane || (hasGrant ? 'mac_local' : 'user_local'),
    };
  }

  if (targetType === 'container') {
    return {
      target_type: explicitType || 'container',
      target_id: explicitTarget || null,
      lane: configuredLane || 'sandbox_container',
    };
  }

  if (targetType === 'platform_vm') {
    if (configRequiresPrivilegedTerminal(cfg) && !hasGrant) {
      return {
        target_type: explicitType || targetType,
        target_id: explicitTarget || null,
        lane: 'forbidden_without_grant',
        forbidden: true,
      };
    }
    const resolvedTargetId = explicitTarget || defaultTargetId || null;
    if (!resolvedTargetId) {
      // Fail loud: platform_vm lane selected but no explicit target and no D1
      // default_target_id (agentsam_tools.handler_config). Do not silently
      // fall through with target_id: null -- callers must not treat an
      // unresolved connection as a healthy gcp_primary route.
      return {
        target_type: explicitType || targetType,
        target_id: null,
        lane: configuredLane || 'gcp_primary',
        error: 'target_id_required',
      };
    }
    return {
      target_type: explicitType || targetType,
      target_id: resolvedTargetId,
      lane: configuredLane || 'gcp_primary',
    };
  }

  // Explicit override without a recognized D1 target_type -- honor caller, no invent.
  if (explicitType || explicitTarget) {
    return {
      target_type: explicitType || null,
      target_id: explicitTarget || null,
      lane: configuredLane || null,
    };
  }

  return { target_type: null, target_id: null, lane: null };
}

/**
 * Load agentsam_tools.handler_config then resolve routing (D1 SSOT).
 * @param {import('@cloudflare/workers-types').D1Database|null|undefined|{ DB?: import('@cloudflare/workers-types').D1Database }} envOrDb
 * @param {Parameters<typeof resolveTerminalExecRouting>[0]} ctx
 */
export async function resolveTerminalExecRoutingFromDb(envOrDb, ctx = {}) {
  const db = envOrDb?.prepare
    ? envOrDb
    : envOrDb?.DB?.prepare
      ? envOrDb.DB
      : null;
  let handlerConfig = ctx.handler_config ?? ctx.handlerConfig ?? null;
  const toolName = String(
    ctx.tool_name || ctx.toolName || ctx.tool_key || ctx.toolKey || '',
  ).trim();
  if (!handlerConfig && db && toolName) {
    try {
      const row = await db
        .prepare(
          `SELECT handler_config FROM agentsam_tools
           WHERE (tool_key = ? OR tool_name = ?) AND COALESCE(is_active, 1) = 1
           LIMIT 1`,
        )
        .bind(toolName, toolName)
        .first();
      handlerConfig = row?.handler_config ?? null;
    } catch {
      handlerConfig = null;
    }
  }
  return resolveTerminalExecRouting({ ...ctx, handler_config: handlerConfig });
}

/**
 * @param {string|null|undefined} toolName
 * @param {unknown} [handlerConfig]
 */
export function terminalToolPrefersGcpLane(toolName, handlerConfig) {
  const cfg = parseTerminalHandlerConfig(handlerConfig);
  if (cfg.target_type != null && String(cfg.target_type).trim() !== '') {
    return String(cfg.target_type).trim() === 'platform_vm';
  }
  // Without D1 config, do not invent from tool name.
  void toolName;
  return false;
}

/**
 * Remote VM requires an explicit privileged grant when configured.
 * @param {boolean} mayUsePrivilegedTerminal
 * @param {string|null|undefined} toolName
 * @param {unknown} [handlerConfig]
 */
export function validateSamOperatorTerminalAccess(mayUsePrivilegedTerminal, toolName, handlerConfig) {
  const cfg = parseTerminalHandlerConfig(handlerConfig);
  if (!configRequiresPrivilegedTerminal(cfg)) {
    return { ok: true };
  }
  if (mayUsePrivilegedTerminal === true) {
    return { ok: true };
  }
  const tk = String(toolName || '').trim() || 'terminal';
  return {
    ok: false,
    error: 'privileged_terminal_required',
    user_message:
      `${tk} (GCP cloud desk) requires an explicit privileged terminal grant. Use a user tunnel or isolated dev container zone.`,
  };
}
