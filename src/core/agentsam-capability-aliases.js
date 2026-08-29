/**
 * Route / policy capability tokens (dotted canonical + legacy snake/underscore)
 * → concrete `agentsam_tools` identifiers (`tool_name`, `tool_key`, `capability_key` from
 * branded catalog SELECT) for deterministic catalog matching.
 *
 * Prefer dotted keys in `agentsam_route_requirements`; catalog rows stay concrete tool names.
 */

/** @param {unknown} v */
function lc(v) {
  return String(v || '')
    .trim()
    .toLowerCase();
}

/**
 * All identifiers for a catalog row that may satisfy a route capability token.
 * @param {Record<string, unknown>} row
 * @returns {string[]}
 */
export function brandedToolRowIdentifiers(row) {
  const ids = [row.capability_key, row.tool_key, row.tool_name]
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => lc(x));
  return [...new Set(ids)];
}

/**
 * @typedef {{ keys: Set<string>, toolIds: Set<string> }} CapabilityAliasGroup
 */

/** @type {CapabilityAliasGroup[]} */
const CAPABILITY_GROUPS = (() => {
  /** @param {string[]} keys @param {string[]} tools */
  const g = (keys, tools) => ({
    keys: new Set(keys.map(lc)),
    toolIds: new Set(tools.map(lc)),
  });
  return [
    g(['code.search', 'code_search'], ['fs_search_files', 'github_search_code', 'workspace_search']),
    g(['grep', 'rg', 'ripgrep'], ['fs_search_files', 'github_search_code']),
    g(['sed'], ['fs_edit_file', 'fs_write_file']),
    g(['bash', 'sh', 'zsh', 'shell'], ['agentsam_terminal_sandbox', 'terminal_execute', 'terminal_run']),
    g(['terminal'], ['agentsam_terminal_local', 'agentsam_terminal_remote', 'agentsam_terminal_sandbox']),
    g(['file.search', 'file_search', 'workspace_search'], ['fs_search_files']),
    g(['file.read', 'file_read', 'workspace_read'], ['fs_read_file', 'fs_list_dir']),
    g(['file.write', 'file_write'], ['fs_write_file', 'fs_edit_file', 'github_update_file', 'github_create_file']),
    g(
      ['github.read', 'github_read'],
      [
        'github_get_file',
        'github_get_tree',
        'github_list_branches',
        'github_compare_refs',
        'github_get_commits',
        'github_get_issue',
        'github_search_code',
        'github_file',
        'agentsam_github_read',
        'agentsam_github_tree',
        'agentsam_github_read_many',
        'agentsam_github_search',
        'agentsam_github_list_commits',
        'agentsam_github_get_file',
        'agentsam_github_get_tree',
        'agentsam_github_read_dir',
        'agentsam_github_batch_read',
        'agentsam_github_list_branches',
        'agentsam_github_compare_commits',
        'agentsam_github_get_commit',
        'agentsam_github_search_code',
        'agentsam_github_search_issues',
        'agentsam_github_search_issues_prs',
        'agentsam_github_repo_list',
        'agentsam_github_list_repos',
      ],
    ),
    g(
      ['github.write', 'github_write'],
      [
        'github_update_file',
        'github_create_file',
        'github_create_pr',
        'github_merge_pr',
        'github_bulk_update_files',
        'github_delete_file',
        'agentsam_github_write',
        'agentsam_github_create_repo',
        'agentsam_github_patch',
        'agentsam_github_pr',
        'agentsam_github_issue',
        'agentsam_github_create_file',
        'agentsam_github_update_file',
        'agentsam_github_delete_file',
        'agentsam_github_create_branch',
        'agentsam_github_create_pr',
        'agentsam_github_merge_pr',
        'github_create_repo',
      ],
    ),
    g(['github.search', 'github_search'], [
      'github_search_code',
      'github_file',
      'agentsam_github_search_code',
      'agentsam_github_search_issues',
      'agentsam_github_search_issues_prs',
    ]),
    g(['terminal.execute', 'terminal_execute', 'terminal_run'], [
      'agentsam_terminal_sandbox',
      'terminal_execute',
      'terminal_run',
    ]),
    g(['container.exec', 'container_exec', 'cloud.sandbox', 'cloud_sandbox'], ['agentsam_container_exec']),
    g(['python.execute', 'python_execute'], [
      'agentsam_code_interpreter',
      'python_execute',
    ]),
    g(['d1.read', 'd1_read', 'd1_query', 'database.read'], ['d1_query']),
    g(['d1.write', 'd1_write'], ['d1_write']),
    g(['d1.batch_write', 'd1_batch_write'], ['d1_batch_write', 'd1_write']),
    g(['d1.explain', 'd1_explain'], ['d1_explain']),
    g(['d1.schema', 'schema.inspect', 'schema_inspect'], ['d1_schema_introspect', 'd1_schema', 'ss_schema_inspect']),
    g(['hyperdrive.read', 'hyperdrive_read', 'postgres.read'], ['hyperdrive_query']),
    g(['hyperdrive.schema', 'hyperdrive_schema', 'postgres.schema'], ['hyperdrive_schema']),
    g(['hyperdrive.explain', 'hyperdrive_explain', 'postgres.explain'], ['hyperdrive_explain']),
    g(['r2.read', 'r2_read'], ['r2_read', 'r2_list', 'r2_search', 'r2_bucket_summary', 'get_r2_url']),
    g(['r2.write', 'r2_write'], ['r2_write']),
    g(['worker.preview', 'worker_preview'], ['preview_in_browser', 'get_worker_services']),
    g(['worker.deploy', 'worker_deploy'], ['worker_deploy']),
    g(['logs.read', 'logs_read'], ['telemetry_log']),
    g(['browser.inspect', 'browser_inspect'], [
      'browser_screenshot',
      'cdt_take_screenshot',
      'playwright_screenshot',
      'browser_navigate',
      'browser_content',
      'browser_scrape',
      'browser_search',
      'browser_render_to_image',
      'browser_pdf',
    ]),
    g(['browser.navigate', 'browser_navigate'], ['browser_navigate', 'browser_content']),
    g(['mybrowser.binding', 'browser.binding'], ['browser_navigate', 'browser_content']),
    g(['knowledge.search', 'rag.search'], ['agentsam_autorag', 'agentsam_memory_search']),
    g(['rag.ingest'], ['agentsam_knowledge_ingest_segment']),
    g(['rag.status'], ['agentsam_autorag']),
    g(['rag.embed'], ['agentsam_autorag']),
    g(['memory.search', 'memory_read'], ['agentsam_memory_search', 'agentsam_memory_manager']),
    g(['memory.write'], ['agentsam_memory_save', 'agentsam_memory_manager']),
    g(['drive.read'], ['gdrive_fetch']),
    g(['drive.list'], ['gdrive_list']),
    g(['wrangler.d1.query'], ['d1_query']),
    g(['wrangler.d1.schema'], ['d1_schema_introspect']),
    g(['wrangler.d1.write'], ['d1_write']),
    g(['wrangler.d1.migrate'], ['d1_migrations_draft']),
    g(['wrangler.cli'], ['terminal_wrangler']),
    g(['context_search'], ['context_search', 'context_chunk', 'context_summarize_code']),
    g(['excalidraw_open', 'excalidraw.open', 'agentsam_excalidraw'], [
      'agentsam_excalidraw',
      'excalidraw_export',
      'excalidraw_load_library',
      'illustration_create',
    ]),
    g(['mcp_catalog_read', 'mcp.catalog.read'], ['list_skills', 'list_workers', 'list_clients']),
    g(['email.broadcast', 'email_broadcast'], ['send_email', 'resend_send_email', 'generate_daily_summary_email']),
    g(['secret.write', 'secret_write'], ['workspace_token_create', 'workspace_token_revoke']),
  ];
})();

/**
 * Expand a single route/policy capability token to all identifiers used for catalog matching
 * (includes the raw token and any grouped keys + tool ids).
 * @param {string} capabilityToken
 * @returns {Set<string>}
 */
export function expandRouteCapabilityToken(capabilityToken) {
  const k = lc(capabilityToken);
  const out = new Set();
  if (!k) return out;
  out.add(k);
  for (const group of CAPABILITY_GROUPS) {
    if (group.keys.has(k) || group.toolIds.has(k)) {
      for (const x of group.keys) out.add(x);
      for (const x of group.toolIds) out.add(x);
    }
  }
  return out;
}

/**
 * @param {Record<string, unknown>} row branded catalog row
 * @param {string} capabilityToken route required/optional/blocked capability string
 */
export function brandedRowMatchesRouteCapability(row, capabilityToken) {
  const exp = expandRouteCapabilityToken(capabilityToken);
  if (!exp.size) return false;
  for (const id of brandedToolRowIdentifiers(row)) {
    if (exp.has(id)) return true;
  }
  return false;
}

/**
 * Workspace-token allowed capability keys may list dotted canonicals; expand before intersecting rows.
 * @param {Set<string>|null|undefined} allowedKeys lowercased capability keys from token JSON
 */
export function expandWorkspaceTokenCapabilityAllowlist(allowedKeys) {
  if (!allowedKeys || !allowedKeys.size) return null;
  const merged = new Set();
  for (const t of allowedKeys) {
    for (const x of expandRouteCapabilityToken(t)) merged.add(x);
  }
  return merged;
}
