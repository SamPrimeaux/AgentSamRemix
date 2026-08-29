/** POST /api/agent/allowlist — session-scoped command grant. */

import {
  COMMAND_ALLOWLIST_SOURCES,
  upsertCommandAllowlistExact,
} from '../../agentsam/terminal/command-trust.js';
import { jsonResponse, trustedScope } from './shared.js';

export async function handleCommandAllowlistRoute(request, url, env, ctx, identity) {
  if (request.method.toUpperCase() !== 'POST' ||
      url.pathname.toLowerCase().replace(/\/$/, '') !== '/api/agent/allowlist') {
    return null;
  }
  const scope = trustedScope(identity);
  if (!scope.authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const command = body.command != null ? String(body.command).trim() : '';
  if (!command) return jsonResponse({ error: 'command required' }, 400);
  const bodyWorkspace = String(body.workspace_id || '').trim();
  if (bodyWorkspace && bodyWorkspace !== scope.workspaceId) {
    return jsonResponse({ error: 'workspace_mismatch' }, 403);
  }
  if (!scope.workspaceId) return jsonResponse({ error: 'workspace required' }, 400);
  const { id } = await upsertCommandAllowlistExact(env, {
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    command,
    source: COMMAND_ALLOWLIST_SOURCES.MODAL_ALWAYS_RUN,
  });
  try {
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO agentsam_command_pattern
         (id, workspace_id, pattern, pattern_type, mapped_command,
          description, category, risk_level, requires_confirmation, is_active)
         VALUES (?, ?, ?, 'exact', ?, 'iam_tool_approval_allowlist', 'misc', 'low', 0, 1)`,
      )
      .bind(`acp_${id}`, scope.workspaceId, command, command)
      .run();
  } catch {
    /* FK / duplicate — non-fatal */
  }
  return jsonResponse({ ok: true });
}
