/**
 * Resolve `agentsam_subagent_profile` for Agent Sam chat / spawn dispatch.
 */

function parseAllowedToolGlobs(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.map((x) => String(x || '').trim()).filter(Boolean);
  const s = String(raw).trim();
  if (!s) return null;
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x || '').trim()).filter(Boolean);
  } catch {
    /* plain comma list */
  }
  return s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
}

function toolNameOf(t) {
  return String(t?.name || t?.tool_name || '').trim();
}

/** Map profile allowed_tool_globs tokens to catalog tool name patterns (not literal substring only). */
function toolMatchesSubagentGlob(toolName, globToken) {
  const n = toolNameOf({ name: toolName }).toLowerCase();
  const g = String(globToken || '')
    .trim()
    .toLowerCase()
    .replace(/\*+$/, '');
  if (!n || !g) return false;

  const matchers = {
    read: () => /(?:^|_)(?:read|file)|github_file|fs_read|repo_read|workspace_read/.test(n),
    write: () => /(?:^|_)(?:write|edit|patch)|fs_write|github_write/.test(n),
    glob: () => /search|glob|fs_list_dir|fs_search|repo_search/.test(n),
    grep: () => /grep|search|rg_|repo_search|fs_search/.test(n),
    terminal: () => /terminal|pty|shell|run_command/.test(n),
    browser: () => /browser|cdt_|playwright/.test(n),
    web: () => /web|fetch|http|browse/.test(n),
    d1: () => /^d1_|^d1_query|^d1_schema|^d1_explain/.test(n),
    sql: () => /sql|d1_query|d1_schema|d1_explain/.test(n),
  };

  if (matchers[g]) return matchers[g]();
  return n.includes(g);
}

/**
 * @param {import('@cloudflare/workers-types').D1Database | null | undefined} db
 * @param {{
 *   userId: string,
 *   workspaceId?: string | null,
 *   tenantId?: string | null,
 *   profileId?: string | null,
 *   slug?: string | null,
 * }} opts
 */
export async function resolveSubagentProfileForChat(db, opts) {
  if (!db) return null;
  const userId = String(opts.userId || '').trim();
  if (!userId) return null;
  const wsKey = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  const profileId = opts.profileId != null ? String(opts.profileId).trim() : '';
  const slug = opts.slug != null ? String(opts.slug).trim() : '';
  if (!profileId && !slug) return null;

  const bindUserScoped = async (sql, ...binds) => {
    try {
      return await db.prepare(sql).bind(...binds).first();
    } catch {
      return null;
    }
  };

  if (profileId) {
    const row = await bindUserScoped(
      `SELECT * FROM agentsam_subagent_profile
       WHERE id = ? AND user_id = ? AND COALESCE(workspace_id, '') = ?
         AND is_active = 1
       LIMIT 1`,
      profileId,
      userId,
      wsKey,
    );
    if (row) return row;
  }

  if (slug) {
    const tenantId = opts.tenantId != null ? String(opts.tenantId).trim() : '';

    // 1) Exact user + workspace (owner pin)
    const owned = await bindUserScoped(
      `SELECT * FROM agentsam_subagent_profile
       WHERE slug = ? AND user_id = ? AND COALESCE(workspace_id, '') = ?
         AND is_active = 1
       LIMIT 1`,
      slug,
      userId,
      wsKey,
    );
    if (owned) return owned;

    // 2) Workspace-shared role (same workspace + tenant) — do not require user_id.
    //    Cursor/MCP sessions often resolve a different user_id string than the
    //    profile creator; workspace-scoped roles must still resolve for that ws.
    if (wsKey) {
      const shared = await bindUserScoped(
        `SELECT * FROM agentsam_subagent_profile
         WHERE slug = ? AND COALESCE(workspace_id, '') = ? AND is_active = 1
           AND COALESCE(is_platform_global, 0) = 0
           AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
         LIMIT 1`,
        slug,
        wsKey,
        tenantId,
      );
      if (shared) return shared;
    }

    // 3) Platform-global catalog
    const global = await bindUserScoped(
      `SELECT * FROM agentsam_subagent_profile
       WHERE slug = ? AND COALESCE(is_platform_global, 0) = 1 AND is_active = 1
         AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
       LIMIT 1`,
      slug,
      tenantId,
    );
    if (global) return global;
  }

  return null;
}

/** @param {string} systemPrompt @param {Record<string, unknown>} profile */
export function appendSubagentProfileToSystemPrompt(systemPrompt, profile) {
  const base = String(systemPrompt || '').trim();
  const name = String(profile.display_name || profile.slug || 'Subagent').trim();
  const slug = String(profile.slug || '').trim();
  const instructions = String(profile.instructions_markdown || '').trim();
  const description = String(profile.description || '').trim();
  const tone = profile.personality_tone != null ? String(profile.personality_tone) : '';
  const traits = profile.personality_traits != null ? String(profile.personality_traits) : '';
  const rules = profile.personality_rules != null ? String(profile.personality_rules) : '';

  let block = `## Subagent: ${name}`;
  if (slug) block += ` (\`${slug}\`)`;
  if (description) block += `\n\n${description}`;
  if (tone) block += `\n\n**Tone:** ${tone}`;
  if (traits) block += `\n\n**Traits:** ${traits}`;
  if (rules) block += `\n\n**Personality rules:**\n${rules}`;
  if (instructions) block += `\n\n### Instructions\n${instructions}`;
  block += '\n\nOperate strictly within this subagent profile for this turn.';

  return base ? `${block}\n\n---\n\n${base}` : block;
}

/**
 * Apply subagent tool allowlist from allowed_tool_globs only.
 * access_mode/read_only must not strip the menu — that contradicts an explicit glob
 * allowlist and invents a second permission axis. Write gates stay on validateToolCall.
 * @param {Array<Record<string, unknown>>} tools
 * @param {Record<string, unknown> | null} profile
 */
export function filterToolsForSubagentProfile(tools, profile) {
  if (!profile || !Array.isArray(tools)) return tools;

  const globs = parseAllowedToolGlobs(profile.allowed_tool_globs);
  if (!globs?.length) return tools;

  return tools.filter((t) => {
    const n = toolNameOf(t);
    for (const g of globs) {
      if (toolMatchesSubagentGlob(n, g)) return true;
    }
    return false;
  });
}

/**
 * Honor the chosen subagent's tool_profile_key as menu SSOT (compile from that
 * profile — do not intersect a mode/task preset menu). Then apply allowed_tool_globs.
 * Missing/inactive tool_profile_key → fail closed (empty menu).
 * @param {any} env
 * @param {Array<Record<string, unknown>>} tools
 * @param {Record<string, unknown> | null} profile
 */
export async function applySubagentToolPolicy(env, tools, profile) {
  if (!profile || !Array.isArray(tools)) return tools || [];

  const pk =
    profile.tool_profile_key != null && String(profile.tool_profile_key).trim() !== ''
      ? String(profile.tool_profile_key).trim()
      : '';

  if (pk) {
    const { compileD1ToolProfileRows } = await import('./d1-tool-profile.js');
    const compiled = await compileD1ToolProfileRows(
      env,
      {
        tenantId: profile.tenant_id ?? null,
        workspaceId: profile.workspace_id ?? null,
        userId: profile.user_id ?? null,
      },
      { profileKey: pk },
    );
    const out = Array.isArray(compiled?.rows) ? compiled.rows : [];
    if (!out.length) {
      console.warn('[subagent] tool_profile_key_compile_empty', pk);
      return [];
    }
    return filterToolsForSubagentProfile(out, profile);
  }

  return filterToolsForSubagentProfile(tools, profile);
}

/**
 * Apply a profile's explicit model preference without coupling the profile to
 * shared routing arms. The profile remains an identity/configuration object;
 * the selected model is a normal requested-model override.
 */
export function applySubagentDefaultModelToBody(body, profile) {
  if (!profile?.default_model_id || !body || typeof body !== 'object') return;
  const subModel = String(profile.default_model_id).trim();
  if (!subModel) return;
  const raw = body.model != null ? String(body.model).trim().toLowerCase() : '';
  const isAuto = !raw || raw === 'auto';
  if (!isAuto) return;
  body.model = subModel;
  body._subagent_default_model = subModel;
}
