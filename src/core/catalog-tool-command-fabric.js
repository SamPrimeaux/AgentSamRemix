/**
 * Catalog deploy/git → agentsam_commands command fabric (SSOT).
 * No workspace_settings.deploy_command or command_template terminal re-dispatch.
 */

function trim(v) {
  return v != null && String(v).trim() !== '' ? String(v).trim() : '';
}

function normalizeSlug(slugRaw) {
  const s = trim(slugRaw);
  if (!s) return '';
  return s.startsWith('/') ? s : `/${s}`;
}

/**
 * Resolve agentsam_commands row from catalog tool config/params.
 * @param {any} env
 * @param {{ config?: Record<string, unknown>, params?: Record<string, unknown>, row?: Record<string, unknown> }} opts
 */
export async function resolveCatalogCommandRow(env, { config = {}, params = {}, row = {} } = {}) {
  if (!env?.DB) return null;

  const commandId =
    trim(params.command_id) ||
    trim(params.commandId) ||
    trim(config.command_id) ||
    trim(config.commandId);

  if (commandId) {
    const cmd = await env.DB.prepare(
      `SELECT * FROM agentsam_commands WHERE id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    )
      .bind(commandId)
      .first()
      .catch(() => null);
    if (cmd) return cmd;
  }

  const slugCandidates = [
    trim(params.command_slug),
    trim(params.slug),
    trim(config.command_slug),
    trim(config.slug),
  ].filter(Boolean);

  for (const raw of slugCandidates) {
    const slug = normalizeSlug(raw);
    const bare = slug.replace(/^\//, '');
    for (const candidate of [slug, bare, `/${bare}`]) {
      const cmd = await env.DB.prepare(
        `SELECT * FROM agentsam_commands WHERE slug = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
      )
        .bind(candidate)
        .first()
        .catch(() => null);
      if (cmd) return cmd;
    }
  }

  const handlerKey = trim(row.handler_key);
  if (handlerKey.startsWith('cmd_')) {
    const cmd = await env.DB.prepare(
      `SELECT * FROM agentsam_commands WHERE id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    )
      .bind(handlerKey)
      .first()
      .catch(() => null);
    if (cmd) return cmd;
  }

  return null;
}

function catalogCommandArgs(params, config) {
  const raw = params && typeof params === 'object' && !Array.isArray(params) ? { ...params } : {};
  const skip = new Set(['command_id', 'commandId', 'command_slug', 'slug', 'skip_approval']);
  const args = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!skip.has(k)) args[k] = v;
  }
  if (config?.args && typeof config.args === 'object' && !Array.isArray(config.args)) {
    Object.assign(args, config.args);
  }
  return args;
}

/**
 * Execute catalog deploy/git tool via agentsam_commands + executeCommand pipeline.
 */
export async function executeCatalogCommandFabric(env, ctx, opts) {
  const {
    config = {},
    params = {},
    row = {},
    runContext = {},
    workspaceId = null,
    tenantId = null,
    userId = null,
    agentRunId = null,
    conversationId = null,
    toolKey = '',
  } = opts;

  const cmdRow = await resolveCatalogCommandRow(env, { config, params, row });
  if (!cmdRow) {
    return {
      ok: false,
      error: 'command_not_configured',
      body: {
        tool_key: toolKey,
        hint: 'Set handler_config.command_id or command_slug to an agentsam_commands row.',
      },
    };
  }

  const { executeCommand } = await import('../../backend/agentsam/commands/execute.js');
  const sessionId =
    runContext?.sessionId ?? runContext?.session_id ?? conversationId ?? null;

  const out = await executeCommand(env, ctx, {
    commandId: String(cmdRow.id),
    userId,
    tenantId,
    workspaceId,
    sessionId,
    agentRunId,
    conversationId,
    args: catalogCommandArgs(params, config),
    skipApprovalGate: params?.skip_approval === true || config?.skip_approval === true,
  });

  if (!out?.ok) {
    return {
      ok: false,
      error: out?.error || 'command_failed',
      body: {
        tool_key: toolKey,
        command_id: cmdRow.id,
        slug: cmdRow.slug,
        ...out,
      },
    };
  }

  return {
    ok: true,
    body: {
      method: 'agentsam_commands',
      command_id: cmdRow.id,
      slug: cmdRow.slug,
      ...out,
    },
  };
}
