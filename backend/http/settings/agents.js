/**
 * Agents settings (Cursor parity): policy, commands, domains, MCP tool preferences/allowlist.
 * - GET    /api/settings/agents
 * - PATCH/PUT /api/settings/agents/policy
 * - POST   /api/settings/agents/commands
 * - POST   /api/settings/agents/domains
 * - PUT/PATCH /api/settings/agents/mcp/preferences
 * - POST   /api/settings/agents/mcp
 * - DELETE /api/settings/agents/mcp/:tool_key
 * Deconstructed from src/api/settings.js (Lane D peel D7, no behavior change).
 */
import { jsonResponse } from '../agentsam/shared.js';
import { fetchAuthUserTenantId } from '../../identity/users/tenant.js';
import {
  COMMAND_ALLOWLIST_SOURCES,
  upsertCommandAllowlistExact,
  hashCommandPreview,
} from '../../agentsam/terminal/command-trust.js';

const AGENTSAM_POLICY_COLS = [
  'auto_run_mode',
  'browser_protection',
  'mcp_tools_protection',
  'file_deletion_protection',
  'external_file_protection',
  'default_agent_location',
  'text_size',
  'auto_clear_chat',
  'submit_with_mod_enter',
  'max_tab_count',
  'queue_messages_mode',
  'usage_summary_mode',
  'agent_autocomplete',
  'web_search_enabled',
  'auto_accept_web_search',
  'web_fetch_enabled',
  'hierarchical_ignore',
  'ignore_symlinks',
  'inline_diffs',
  'jump_next_diff_on_accept',
  'auto_format_on_agent_finish',
  'legacy_terminal_tool',
  'toolbar_on_selection',
  'auto_parse_links',
  'themed_diff_backgrounds',
  'terminal_hint',
  'terminal_preview_box',
  'collapse_auto_run_commands',
  'voice_submit_keyword',
  'commit_attribution',
  'pr_attribution',
  'settings_json',
  'trusted_shell_prefixes_json',
  'can_run_pty',
  'terminal_ai_enabled',
  'sync_layouts',
  'show_status_bar',
  'autohide_editor',
  'autoinject_code',
  'require_allowlist_for_mcp',
  'tool_risk_level_max',
  'allow_subagent_spawn',
  'allow_fanout_execution',
  'max_tool_chain_depth',
  'max_spawn_depth',
  'max_cost_per_call_usd',
  'max_cost_per_session_usd',
];

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

export async function handleSettingsAgentsRoutes(request, env, ctx, authContext) {
  void ctx;
  const { authUser, url, pathLower, method, sessionUserId } = authContext || {};
  if (!authUser) return null;

  const isAgentsPath = pathLower === '/api/settings/agents' || pathLower.startsWith('/api/settings/agents/');
  if (!isAgentsPath) return null;

  const { authId: canonicalAuthId, userId: canonicalUserId } =
    await resolveCanonicalUserId(env, sessionUserId, authUser.email);
  const agentsamUserCandidates = Array.from(
    new Set([canonicalAuthId, canonicalUserId, sessionUserId].filter(Boolean).map((x) => String(x))),
  );

  // ── AGENTS (Cursor parity) ────────────────────────────────────────────────
  if (pathLower === '/api/settings/agents' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const workspaceId = await resolveRequestWorkspaceId(env, authUser, url);

    const stored = await env.DB.prepare(
      `SELECT user_id FROM agentsam_user_policy
       WHERE workspace_id = ?
         AND user_id IN (${agentsamUserCandidates.map(() => '?').join(', ')})
       LIMIT 1`,
    )
      .bind(workspaceId || null, ...agentsamUserCandidates)
      .first()
      .catch(() => null);
    const agentsamUserId = stored?.user_id ? String(stored.user_id) : String(canonicalAuthId || sessionUserId);

    const [policyRow, cmdRows, domainRows, mcpRows, subagentList] = await Promise.all([
      env.DB.prepare(
        `SELECT * FROM agentsam_user_policy WHERE user_id = ? AND workspace_id = ? LIMIT 1`,
      )
        .bind(agentsamUserId, workspaceId || null)
        .first()
        .catch(() => null),
      env.DB.prepare(
        `SELECT command FROM agentsam_command_allowlist
         WHERE user_id = ? AND workspace_id = ?
         ORDER BY command ASC`,
      )
        .bind(agentsamUserId, workspaceId || null)
        .all()
        .then((r) => r.results || [])
        .catch(() => []),
      env.DB.prepare(
        `SELECT host FROM agentsam_fetch_domain_allowlist
         WHERE user_id = ? AND workspace_id = ?
         ORDER BY host ASC`,
      )
        .bind(agentsamUserId, workspaceId || null)
        .all()
        .then((r) => r.results || [])
        .catch(() => []),
      env.DB.prepare(
        `SELECT tool_key, COALESCE(preference, 'allow') AS preference, notes
           FROM agentsam_mcp_allowlist
          WHERE user_id = ? AND workspace_id = ?
          ORDER BY tool_key ASC`,
      )
        .bind(agentsamUserId, workspaceId || null)
        .all()
        .then((r) => r.results || [])
        .catch(() =>
          env.DB.prepare(
            `SELECT tool_key, NULL AS notes FROM agentsam_mcp_allowlist
               WHERE user_id = ? AND workspace_id = ?
               ORDER BY tool_key ASC`,
          )
            .bind(agentsamUserId, workspaceId || null)
            .all()
            .then((r2) => r2.results || [])
            .catch(() => []),
        ),
      env.DB.prepare(
        `SELECT * FROM agentsam_subagent_profile
         WHERE user_id = ? AND workspace_id = ?
         ORDER BY COALESCE(sort_order, 9999), display_name ASC`,
      )
        .bind(agentsamUserId, workspaceId || null)
        .all()
        .then((r) => r.results || [])
        .catch(() => []),
    ]);

    let mcp_tool_groups = [];
    let mcp_group_preferences = {};
    try {
      const { loadMcpOAuthConsentToolManifest } = await import('./mcp-oauth-shared.js');
      const {
        groupMcpToolsForPreferences,
        inferGroupPreferenceFromAllowlist,
      } = await import('../../agentsam/tools/mcp-preferences.js');
      const manifest = await loadMcpOAuthConsentToolManifest(env, {
        userId: agentsamUserId,
        workspaceId: workspaceId || '',
        tenantId: String(policyRow?.tenant_id || authUser?.tenant_id || '').trim(),
        clientId: MCP_CANONICAL_CLIENT_ID,
        grantedScopes: ['mcp:tools', 'iam:agent', 'iam:profile'],
      });
      mcp_tool_groups = manifest.tool_groups?.length
        ? manifest.tool_groups
        : groupMcpToolsForPreferences(manifest.tools || []);
      const allowed = new Set(
        mcpRows.map((r) => String(r.tool_key || '').trim()).filter(Boolean),
      );
      for (const g of mcp_tool_groups) {
        mcp_group_preferences[g.group_key] = inferGroupPreferenceFromAllowlist(g.tools, allowed);
      }
    } catch (_) {}

    return jsonResponse({
      workspace_id: workspaceId || null,
      agentsam_user_id: agentsamUserId,
      canonical: {
        auth_id: canonicalAuthId || null,
        user_id: canonicalUserId || null,
        session_user_id: sessionUserId || null,
      },
      policy: policyRow || null,
      subagents: Array.isArray(subagentList) ? subagentList : [],
      allowlists: {
        commands: cmdRows.map((r) => String(r.command || '').trim()).filter(Boolean),
        domains: domainRows.map((r) => String(r.host || '').trim()).filter(Boolean),
        mcp: mcpRows
          .map((r) => ({
            tool_key: String(r.tool_key || '').trim(),
            notes: r.notes ?? null,
            preference: r.preference != null ? String(r.preference) : null,
          }))
          .filter((x) => x.tool_key),
      },
      mcp_tool_groups,
      mcp_group_preferences,
    });
  }

  {
    const agentRowM = pathLower.match(/^\/api\/settings\/agents\/([^/]+)$/);
    const agentSeg = agentRowM ? decodeURIComponent(agentRowM[1] || '').trim() : '';
    const reserved = new Set(['policy', 'commands', 'domains', 'mcp']);
    if (agentSeg && !reserved.has(agentSeg) && method === 'PATCH') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const body = await request.json().catch(() => ({}));
      const workspaceId =
        body.workspace_id != null && String(body.workspace_id).trim() !== ''
          ? String(body.workspace_id).trim()
          : await resolveRequestWorkspaceId(env, authUser, url);
      const stored = await env.DB.prepare(
        `SELECT user_id FROM agentsam_user_policy
         WHERE workspace_id = ?
           AND user_id IN (${agentsamUserCandidates.map(() => '?').join(', ')})
         LIMIT 1`,
      )
        .bind(workspaceId || null, ...agentsamUserCandidates)
        .first()
        .catch(() => null);
      const agentsamUserId = stored?.user_id ? String(stored.user_id) : String(canonicalAuthId || sessionUserId);
      const sets = [];
      const vals = [];
      if (Object.prototype.hasOwnProperty.call(body, 'is_active')) {
        sets.push('is_active = ?');
        const v = body.is_active;
        vals.push(v === true || v === 1 || v === '1' ? 1 : 0);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'default_model_id') && body.default_model_id != null) {
        sets.push('default_model_id = ?');
        vals.push(String(body.default_model_id));
      }
      if (!sets.length) return jsonResponse({ error: 'Only is_active and default_model_id may be updated' }, 400);
      sets.push("updated_at = datetime('now')");
      vals.push(agentSeg, agentsamUserId, workspaceId || null);
      const n = await env.DB.prepare(
        `UPDATE agentsam_subagent_profile SET ${sets.join(', ')}
         WHERE id = ? AND user_id = ? AND workspace_id = ?`,
      )
        .bind(...vals)
        .run();
      if (!n.meta?.changes) return jsonResponse({ error: 'Subagent not found' }, 404);
      const row = await env.DB.prepare(
        `SELECT * FROM agentsam_subagent_profile WHERE id = ? AND user_id = ? LIMIT 1`,
      )
        .bind(agentSeg, agentsamUserId)
        .first()
        .catch(() => null);
      return jsonResponse({ ok: true, subagent: row });
    }
  }

  if (pathLower === '/api/settings/agents/policy' && (method === 'PATCH' || method === 'PUT')) {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const body = await request.json().catch(() => ({}));
    const workspaceId =
      body.workspace_id != null && String(body.workspace_id).trim() !== ''
        ? String(body.workspace_id).trim()
        : await resolveRequestWorkspaceId(env, authUser, url);

    const stored = await env.DB.prepare(
      `SELECT user_id FROM agentsam_user_policy
       WHERE workspace_id = ?
         AND user_id IN (${agentsamUserCandidates.map(() => '?').join(', ')})
       LIMIT 1`,
    )
      .bind(workspaceId || null, ...agentsamUserCandidates)
      .first()
      .catch(() => null);
    const agentsamUserId = stored?.user_id ? String(stored.user_id) : String(canonicalAuthId || sessionUserId);

    const incoming =
      body && typeof body === 'object'
        ? body.policy && typeof body.policy === 'object'
          ? body.policy
          : body
        : {};
    const cols = AGENTSAM_POLICY_COLS.filter((k) => Object.prototype.hasOwnProperty.call(incoming, k));
    if (!cols.length) return jsonResponse({ error: 'No valid policy fields' }, 400);

    const insertCols = ['user_id', 'workspace_id', ...cols].join(', ');
    const placeholders = ['?', '?', ...cols.map(() => '?')].join(', ');
    const updateSet = cols.map((k) => `${k} = excluded.${k}`).join(', ');
    const values = [agentsamUserId, workspaceId || null, ...cols.map((k) => incoming[k])];

    await env.DB.prepare(
      `INSERT INTO agentsam_user_policy (${insertCols})
       VALUES (${placeholders})
       ON CONFLICT(user_id, workspace_id) DO UPDATE SET
         ${updateSet},
         updated_at = datetime('now')`,
    )
      .bind(...values)
      .run();

    const row = await env.DB.prepare(
      `SELECT * FROM agentsam_user_policy WHERE user_id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(agentsamUserId, workspaceId || null)
      .first()
      .catch(() => null);

    return jsonResponse({
      ok: true,
      policy: row,
      workspace_id: workspaceId || null,
      agentsam_user_id: agentsamUserId,
    });
  }

  // ── AGENTS Allowlist CRUD ────────────────────────────────────────────────
  if (pathLower === '/api/settings/agents/commands' && method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const body = await request.json().catch(() => ({}));
    const workspaceId =
      body.workspace_id != null && String(body.workspace_id).trim() !== ''
        ? String(body.workspace_id).trim()
        : await resolveRequestWorkspaceId(env, authUser, url);
    const command = body?.command != null ? String(body.command).trim() : '';
    if (!command) return jsonResponse({ error: 'command required' }, 400);

    const stored = await env.DB.prepare(
      `SELECT user_id FROM agentsam_user_policy
       WHERE workspace_id = ?
         AND user_id IN (${agentsamUserCandidates.map(() => '?').join(', ')})
       LIMIT 1`,
    )
      .bind(workspaceId || null, ...agentsamUserCandidates)
      .first()
      .catch(() => null);
    const agentsamUserId = stored?.user_id ? String(stored.user_id) : String(canonicalAuthId || sessionUserId);

    await upsertCommandAllowlistExact(env, {
      userId: agentsamUserId,
      workspaceId: workspaceId || '',
      command,
      source: COMMAND_ALLOWLIST_SOURCES.SETTINGS_MANUAL,
    });
    return jsonResponse({ ok: true });
  }

  {
    const m = pathLower.match(/^\/api\/settings\/agents\/commands\/([^/]+)$/);
    if (m && method === 'DELETE') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const workspaceId = await resolveRequestWorkspaceId(env, authUser, url);
      const command = decodeURIComponent(m[1] || '').trim();
      if (!command) return jsonResponse({ error: 'command required' }, 400);

      const stored = await env.DB.prepare(
        `SELECT user_id FROM agentsam_user_policy
         WHERE workspace_id = ?
           AND user_id IN (${agentsamUserCandidates.map(() => '?').join(', ')})
         LIMIT 1`,
      )
        .bind(workspaceId || null, ...agentsamUserCandidates)
        .first()
        .catch(() => null);
      const agentsamUserId = stored?.user_id ? String(stored.user_id) : String(canonicalAuthId || sessionUserId);

      const commandHash = await hashCommandPreview(command).catch(() => null);

      await env.DB.prepare(
        `DELETE FROM agentsam_command_allowlist
         WHERE user_id = ? AND workspace_id = ?
           AND (command = ? OR command_hash = ?)`,
      )
        .bind(agentsamUserId, workspaceId || null, command, commandHash || command)
        .run();
      return jsonResponse({ ok: true });
    }
  }

  if (pathLower === '/api/settings/agents/domains' && method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const body = await request.json().catch(() => ({}));
    const workspaceId =
      body.workspace_id != null && String(body.workspace_id).trim() !== ''
        ? String(body.workspace_id).trim()
        : await resolveRequestWorkspaceId(env, authUser, url);
    const host = body?.host != null ? String(body.host).trim() : '';
    if (!host) return jsonResponse({ error: 'host required' }, 400);

    const stored = await env.DB.prepare(
      `SELECT user_id FROM agentsam_user_policy
       WHERE workspace_id = ?
         AND user_id IN (${agentsamUserCandidates.map(() => '?').join(', ')})
       LIMIT 1`,
    )
      .bind(workspaceId || null, ...agentsamUserCandidates)
      .first()
      .catch(() => null);
    const agentsamUserId = stored?.user_id ? String(stored.user_id) : String(canonicalAuthId || sessionUserId);

    await env.DB.prepare(
      `INSERT INTO agentsam_fetch_domain_allowlist (id, user_id, workspace_id, host, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, workspace_id, host) DO NOTHING`,
    )
      .bind(crypto.randomUUID(), agentsamUserId, workspaceId || null, host)
      .run();
    return jsonResponse({ ok: true });
  }

  {
    const m = pathLower.match(/^\/api\/settings\/agents\/domains\/([^/]+)$/);
    if (m && method === 'DELETE') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const workspaceId = await resolveRequestWorkspaceId(env, authUser, url);
      const host = decodeURIComponent(m[1] || '').trim();
      if (!host) return jsonResponse({ error: 'host required' }, 400);

      const stored = await env.DB.prepare(
        `SELECT user_id FROM agentsam_user_policy
         WHERE workspace_id = ?
           AND user_id IN (${agentsamUserCandidates.map(() => '?').join(', ')})
         LIMIT 1`,
      )
        .bind(workspaceId || null, ...agentsamUserCandidates)
        .first()
        .catch(() => null);
      const agentsamUserId = stored?.user_id ? String(stored.user_id) : String(canonicalAuthId || sessionUserId);

      await env.DB.prepare(
        `DELETE FROM agentsam_fetch_domain_allowlist
         WHERE user_id = ? AND workspace_id = ? AND host = ?`,
      )
        .bind(agentsamUserId, workspaceId || null, host)
        .run();
      return jsonResponse({ ok: true });
    }
  }

  if (pathLower === '/api/settings/agents/mcp/preferences' && (method === 'PUT' || method === 'PATCH')) {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const body = await request.json().catch(() => ({}));
    const workspaceId =
      body.workspace_id != null && String(body.workspace_id).trim() !== ''
        ? String(body.workspace_id).trim()
        : await resolveRequestWorkspaceId(env, authUser, url);
    const prefs =
      body.group_preferences && typeof body.group_preferences === 'object'
        ? body.group_preferences
        : body.tool_preferences && typeof body.tool_preferences === 'object'
          ? body.tool_preferences
          : null;
    if (!prefs) return jsonResponse({ error: 'group_preferences object required' }, 400);

    const stored = await env.DB.prepare(
      `SELECT user_id FROM agentsam_user_policy
       WHERE workspace_id = ?
         AND user_id IN (${agentsamUserCandidates.map(() => '?').join(', ')})
       LIMIT 1`,
    )
      .bind(workspaceId || null, ...agentsamUserCandidates)
      .first()
      .catch(() => null);
    const agentsamUserId = stored?.user_id ? String(stored.user_id) : String(canonicalAuthId || sessionUserId);

    try {
      const { loadMcpOAuthConsentToolManifest } = await import('./mcp-oauth-shared.js');
      const { persistMcpAllowlistFromGroupPreferences } = await import(
        '../../agentsam/tools/mcp-preferences.js',
      );
      const manifest = await loadMcpOAuthConsentToolManifest(env, {
        userId: agentsamUserId,
        workspaceId: workspaceId || '',
        tenantId: String(authUser?.tenant_id || '').trim(),
        clientId: String(body.client_id || MCP_CANONICAL_CLIENT_ID),
        grantedScopes: ['mcp:tools', 'iam:agent', 'iam:profile'],
      });
      const result = await persistMcpAllowlistFromGroupPreferences(env, {
        userId: agentsamUserId,
        workspaceId: workspaceId || '',
        tenantId: String(authUser?.tenant_id || '').trim(),
        clientId: String(body.client_id || MCP_CANONICAL_CLIENT_ID),
        catalogTools: manifest.tools || [],
        groupPreferences: prefs,
      });
      return jsonResponse({ ok: true, ...result });
    } catch (e) {
      return jsonResponse({ error: String(e?.message || e) }, 500);
    }
  }

  if (pathLower === '/api/settings/agents/mcp' && method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const body = await request.json().catch(() => ({}));
    const workspaceId =
      body.workspace_id != null && String(body.workspace_id).trim() !== ''
        ? String(body.workspace_id).trim()
        : await resolveRequestWorkspaceId(env, authUser, url);
    const tool_key = body?.tool_key != null ? String(body.tool_key).trim() : '';
    const notes = body?.notes != null ? String(body.notes).trim() : null;
    if (!tool_key) return jsonResponse({ error: 'tool_key required' }, 400);
    if (!tool_key.includes(':')) return jsonResponse({ error: 'tool_key must include ":" (server:tool)' }, 400);

    const stored = await env.DB.prepare(
      `SELECT user_id FROM agentsam_user_policy
       WHERE workspace_id = ?
         AND user_id IN (${agentsamUserCandidates.map(() => '?').join(', ')})
       LIMIT 1`,
    )
      .bind(workspaceId || null, ...agentsamUserCandidates)
      .first()
      .catch(() => null);
    const agentsamUserId = stored?.user_id ? String(stored.user_id) : String(canonicalAuthId || sessionUserId);

    // Note: current schema may not include notes; try best-effort insert.
    try {
      await env.DB.prepare(
        `INSERT INTO agentsam_mcp_allowlist (id, user_id, workspace_id, tool_key, notes, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, workspace_id, tool_key) DO NOTHING`,
      )
        .bind(crypto.randomUUID(), agentsamUserId, workspaceId || null, tool_key, notes)
        .run();
    } catch (e) {
      if (String(e?.message || '').includes('no such column: notes')) {
        await env.DB.prepare(
          `INSERT INTO agentsam_mcp_allowlist (id, user_id, workspace_id, tool_key, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(user_id, workspace_id, tool_key) DO NOTHING`,
        )
          .bind(crypto.randomUUID(), agentsamUserId, workspaceId || null, tool_key)
          .run();
      } else {
        throw e;
      }
    }
    return jsonResponse({ ok: true });
  }

  {
    const m = pathLower.match(/^\/api\/settings\/agents\/mcp\/([^/]+)$/);
    if (m && method === 'DELETE') {
      if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
      const workspaceId = await resolveRequestWorkspaceId(env, authUser, url);
      const tool_key = decodeURIComponent(m[1] || '').trim();
      if (!tool_key) return jsonResponse({ error: 'tool_key required' }, 400);

      const stored = await env.DB.prepare(
        `SELECT user_id FROM agentsam_user_policy
         WHERE workspace_id = ?
           AND user_id IN (${agentsamUserCandidates.map(() => '?').join(', ')})
         LIMIT 1`,
      )
        .bind(workspaceId || null, ...agentsamUserCandidates)
        .first()
        .catch(() => null);
      const agentsamUserId = stored?.user_id ? String(stored.user_id) : String(canonicalAuthId || sessionUserId);

      await env.DB.prepare(
        `DELETE FROM agentsam_mcp_allowlist
         WHERE user_id = ? AND workspace_id = ? AND tool_key = ?`,
      )
        .bind(agentsamUserId, workspaceId || null, tool_key)
        .run();
      return jsonResponse({ ok: true });
    }
  }

  return null;
}
