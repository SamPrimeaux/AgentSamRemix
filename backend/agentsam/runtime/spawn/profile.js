// guard-dup-allow: backend spawn peel; shared profile callers migrate separately.
/**
 * Workspace-scoped subagent profile resolution for multitask lanes.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function parseAllowedToolGlobs(raw) {
  if (Array.isArray(raw)) return raw.map(trim).filter(Boolean);
  if (!trim(raw)) return null;
  try {
    const parsed = JSON.parse(String(raw));
    if (Array.isArray(parsed)) return parsed.map(trim).filter(Boolean);
  } catch {
    /* comma/space-delimited legacy value */
  }
  return String(raw).split(/[\s,]+/).map(trim).filter(Boolean);
}

function matchesGlob(toolName, token) {
  const name = trim(toolName).toLowerCase();
  const glob = trim(token).toLowerCase().replace(/\*+$/, '');
  if (!name || !glob) return false;
  const matchers = {
    read: /(?:^|_)(?:read|file)|github_file|fs_read|repo_read|workspace_read/,
    write: /(?:^|_)(?:write|edit|patch)|fs_write|github_write/,
    glob: /search|glob|fs_list_dir|fs_search|repo_search/,
    grep: /grep|search|rg_|repo_search|fs_search/,
    terminal: /terminal|pty|shell|run_command/,
    browser: /browser|cdt_|playwright/,
    web: /web|fetch|http|browse/,
    d1: /^d1_|^d1_query|^d1_schema|^d1_explain/,
    sql: /sql|d1_query|d1_schema|d1_explain/,
  };
  return matchers[glob] ? matchers[glob].test(name) : name.includes(glob);
}

export async function resolveSubagentProfileForChat(db, opts = {}) {
  const userId = trim(opts.userId);
  const workspaceId = trim(opts.workspaceId);
  const tenantId = trim(opts.tenantId);
  const profileId = trim(opts.profileId);
  const slug = trim(opts.slug);
  if (!db || !userId || (!profileId && !slug)) return null;
  const query = async (sql, ...binds) => db.prepare(sql).bind(...binds).first().catch(() => null);

  if (profileId) {
    const row = await query(
      `SELECT * FROM agentsam_subagent_profile
        WHERE id = ? AND user_id = ? AND COALESCE(workspace_id, '') = ?
          AND COALESCE(is_active, 1) = 1 LIMIT 1`,
      profileId,
      userId,
      workspaceId,
    );
    if (row) return row;
  }
  if (!slug) return null;

  const owned = await query(
    `SELECT * FROM agentsam_subagent_profile
      WHERE slug = ? AND user_id = ? AND COALESCE(workspace_id, '') = ?
        AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    slug,
    userId,
    workspaceId,
  );
  if (owned) return owned;
  if (workspaceId) {
    const shared = await query(
      `SELECT * FROM agentsam_subagent_profile
        WHERE slug = ? AND workspace_id = ? AND COALESCE(is_active, 1) = 1
          AND COALESCE(is_platform_global, 0) = 0
          AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
        LIMIT 1`,
      slug,
      workspaceId,
      tenantId,
    );
    if (shared) return shared;
  }
  return query(
    `SELECT * FROM agentsam_subagent_profile
      WHERE slug = ? AND COALESCE(is_platform_global, 0) = 1
        AND COALESCE(is_active, 1) = 1
        AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
      LIMIT 1`,
    slug,
    tenantId,
  );
}

export function appendSubagentProfileToSystemPrompt(systemPrompt, profile) {
  const base = trim(systemPrompt);
  const name = trim(profile?.display_name || profile?.slug) || 'Subagent';
  const slug = trim(profile?.slug);
  const description = trim(profile?.description);
  const instructions = trim(profile?.instructions_markdown);
  const block = [
    `## Subagent: ${name}${slug ? ` (\`${slug}\`)` : ''}`,
    description,
    instructions ? `### Instructions\n${instructions}` : '',
    'Operate strictly within this subagent profile for this turn.',
  ].filter(Boolean).join('\n\n');
  return base ? `${block}\n\n---\n\n${base}` : block;
}

export function applySubagentToolPolicy(_env, tools, profile) {
  if (!Array.isArray(tools) || !profile) return Array.isArray(tools) ? tools : [];
  const globs = parseAllowedToolGlobs(profile.allowed_tool_globs);
  if (!globs?.length) return tools;
  return tools.filter((tool) =>
    globs.some((glob) => matchesGlob(tool?.name || tool?.tool_name || tool?.tool_key, glob)),
  );
}
