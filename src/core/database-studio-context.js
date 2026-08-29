/**
 * Compact Database Studio context for Agent Sam chat (no giant result dumps).
 */

/**
 * @param {Record<string, unknown>|null|undefined} raw
 * @returns {string|null}
 */
export function formatDatabaseContextForAgent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const route = String(raw.route || raw.dashboard_route || '');
  if (!route.includes('/dashboard/database') && raw.surface !== 'database') {
    if (!raw.datasource && !raw.selectedTable) return null;
  }

  const lines = [
    '[Database Studio — live surface context. Use this to answer questions about the open table, schema, SQL editor, filters, and last query error. Do not invent table names or query results.]',
    `route: ${route || '/dashboard/database'}`,
    `view: ${String(raw.view || 'studio')}`,
    `provider: ${String(raw.provider || raw.datasource || 'unknown')}`,
    `resource_scope: ${String(raw.resourceScope || raw.resource_scope || 'unknown')}`,
    `resource_ref: ${raw.resourceRef || raw.resource_ref || '(unresolved)'}`,
    `datasource_binding: ${raw.datasource_binding || raw.resourceRef || raw.resource_ref || '(unresolved)'}`,
    `datasource: ${String(raw.datasource || 'd1')}`,
    `dialect: ${String(raw.dialect || (raw.datasource === 'supabase' ? 'postgresql' : 'sqlite'))}`,
    `active_schema: ${raw.activeSchema || raw.active_schema || '(none)'}`,
    `active_tab: ${String(raw.activeMainTab || raw.active_tab || 'schema')}`,
    `selected_table: ${raw.selectedTable != null ? String(raw.selectedTable) : '(none)'}`,
    'tool_envelope: Use agentsam_d1_query/agentsam_d1_write for D1 (database_id = UUID, sql, optional params — Cloudflare d1_database_query contract). Use agentsam_supabase_query/agentsam_supabase_write for Supabase (resource_ref = platform_supabase or connected project ref). Never invent Hyperdrive as a provider face.',
  ];
  const resolvedRef = String(raw.resourceRef || raw.resource_ref || '').trim();
  if (!resolvedRef) {
    lines.push('execution_blocked: Select an authorized database resource before querying or loading table data.');
  } else {
    lines.push(
      `execution_ready: D1 tools need database_id=${resolvedRef} + sql (Cloudflare d1_database_query). Supabase tools need resource_ref=${resolvedRef}. Session workspace is not a D1 argument. Never call list_projects when provider is platform Supabase.`,
    );
  }

  if (raw.capabilities && typeof raw.capabilities === 'object') {
    const cap = /** @type {Record<string, unknown>} */ (raw.capabilities);
    lines.push(
      `can_read: ${cap.canRead !== false}`,
      `can_write: ${cap.canWrite === true}`,
      `}`,
    );
  }

  if (raw.schemaSummary && typeof raw.schemaSummary === 'object') {
    const ss = /** @type {Record<string, unknown>} */ (raw.schemaSummary);
    lines.push(`schema_columns: ${Number(ss.columnCount ?? 0)}`);
    if (Array.isArray(ss.primaryKeys) && ss.primaryKeys.length) {
      lines.push(`primary_keys: ${ss.primaryKeys.join(', ')}`);
    }
    if (Array.isArray(ss.columns) && ss.columns.length) {
      const preview = ss.columns
        .slice(0, 24)
        .map((c) => {
          const row = /** @type {Record<string, unknown>} */ (c);
          const pk = row.pk ? ' pk' : '';
          return `${row.name}:${row.type || 'TEXT'}${pk}`;
        })
        .join('; ');
      lines.push(`columns: ${preview}`);
    }
  }

  if (raw.selectedCellSummary && typeof raw.selectedCellSummary === 'object') {
    const sc = /** @type {Record<string, unknown>} */ (raw.selectedCellSummary);
    lines.push(
      `selected_cell: table=${sc.table || raw.selectedTable} column=${sc.column} row=${sc.rowKey ?? '—'}`,
      `selected_cell_value_preview: ${String(sc.valuePreview ?? '').slice(0, 200)}`,
    );
  }

  if (raw.selectedRowSummary && typeof raw.selectedRowSummary === 'object') {
    lines.push(`selected_row_json: ${JSON.stringify(raw.selectedRowSummary).slice(0, 1200)}`);
  }

  if (raw.currentSqlBuffer) {
    lines.push(`sql_buffer_preview:\n${String(raw.currentSqlBuffer).slice(0, 2000)}`);
  }
  if (raw.selectedSql) {
    lines.push(`selected_sql_preview:\n${String(raw.selectedSql).slice(0, 1500)}`);
  }
  if (raw.lastAttemptedSql) {
    lines.push(`last_attempted_sql:\n${String(raw.lastAttemptedSql).slice(0, 2000)}`);
  }
  if (raw.lastError) {
    lines.push(`last_sql_error: ${String(raw.lastError).slice(0, 800)}`);
  }
  if (raw.lastResultMeta && typeof raw.lastResultMeta === 'object') {
    lines.push(`last_result_meta: ${JSON.stringify(raw.lastResultMeta).slice(0, 400)}`);
  }
  if (raw.dataSummary && typeof raw.dataSummary === 'object') {
    const ds = /** @type {Record<string, unknown>} */ (raw.dataSummary);
    lines.push(
      `data_page: ${ds.page ?? 1}/${ds.totalPages ?? 1} rows_on_page=${ds.rowsOnPage ?? 0} total=${ds.totalCount ?? 0}`,
    );
  }
  if (Array.isArray(raw.activeFilters) && raw.activeFilters.length) {
    lines.push(`active_filters: ${JSON.stringify(raw.activeFilters).slice(0, 600)}`);
  }

  lines.push(
    'studio_actions: To control the UI emit a fenced JSON block: {"iam_db_action":"apply-sql"|"open-table"|"open-query-analysis",...}. Fields: datasource (d1|supabase), sql, mode (replace|new_tab|append), run (default false), table, tab (schema|data|sql|indexes|relations), error.',
  );

  return lines.join('\n');
}
