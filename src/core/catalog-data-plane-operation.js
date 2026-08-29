/**
 * Map agentsam_tools.handler_config.operation → customer-data-plane dispatch operation.
 * Catalog contract uses dotted ops (supabase.query); dispatch uses stable snake_case handlers.
 */

/** @type {Record<string, string>} */
const CATALOG_OPERATION_TO_DISPATCH = {
  'supabase.query': 'run_readonly_sql',
  'supabase.write': 'run_write_sql',
  readonly_sql: 'run_readonly_sql',
  execute_sql: 'run_write_sql',
  'vector.search': 'vector_search',
  'autorag.search': 'autorag_search',
};

/** @type {Record<string, string>} */
const TOOL_KEY_DEFAULT_OPERATION = {
  agentsam_supabase_query: 'run_readonly_sql',
  agentsam_supabase_write: 'run_write_sql',
  agentsam_supabase_project_query: 'run_readonly_sql',
  agentsam_supabase_project_write: 'run_write_sql',
  supabase_query: 'run_readonly_sql',
  supabase_write: 'run_write_sql',
  agentsam_supabase_vector: 'vector_search',
  supabase_vector: 'vector_search',
  agentsam_autorag: 'autorag_search',
};

/** User-account Management OAuth lane (never IAM Hyperdrive). */
const CUSTOMER_SUPABASE_PROJECT_TOOLS = new Set([
  'agentsam_supabase_project_query',
  'agentsam_supabase_project_write',
  'customer_supabase_list_projects',
  'customer_supabase_select_project',
  'customer_supabase_readonly_query',
  'customer_supabase_schema_inspect',
  'customer_supabase_propose_migration',
]);

const SUPABASE_MANAGEMENT_OPERATIONS = new Set([
  'list_projects',
  'get_project',
  'list_branches',
  'list_migrations',
  'get_database_context',
  'query_logs',
]);

export function isSupabaseManagementOperation(operation) {
  return SUPABASE_MANAGEMENT_OPERATIONS.has(String(operation || '').trim().toLowerCase());
}

export function resolveSupabaseOperationTransport(operation, dataPlane) {
  if (isSupabaseManagementOperation(operation)) return 'management_api';
  return String(dataPlane || '').trim() === 'platform_supabase'
    ? 'hyperdrive'
    : 'management_api';
}

/**
 * @param {string} [toolKey]
 * @param {Record<string, unknown>|null|undefined} [config]
 */
export function resolveCustomerSupabaseDataPlane(toolKey = '', config = null) {
  const key = String(toolKey || '')
    .trim()
    .toLowerCase();
  if (CUSTOMER_SUPABASE_PROJECT_TOOLS.has(key)) return 'customer_supabase';
  const plane = String(config?.data_plane || '')
    .trim()
    .toLowerCase();
  if (plane === 'customer_supabase' || plane === 'user') return 'customer_supabase';
  return null;
}

/**
 * Resolve the concrete Supabase plane without treating Hyperdrive as a data plane.
 * A selected project is customer Supabase; `platform` means the IAM Postgres
 * database reached through the Hyperdrive binding.
 *
 * @param {string} [toolKey]
 * @param {Record<string, unknown>|null|undefined} [config]
 * @param {string|null|undefined} [projectRef]
 */
export function resolveCatalogSupabaseDataPlane(toolKey = '', config = null, projectRef = null) {
  if (String(projectRef || '').trim()) return 'customer_supabase';
  const customerPlane = resolveCustomerSupabaseDataPlane(toolKey, config);
  if (customerPlane) return customerPlane;
  const configured = String(config?.data_plane || '')
    .trim()
    .toLowerCase();
  if (configured === 'platform' || configured === 'platform_supabase') {
    return 'platform_supabase';
  }
  if (configured === 'platform_supabase_agentsam') return 'platform_supabase';
  return null;
}

/**
 * Preserve native PostgreSQL context and bound values from a catalog tool call.
 * @param {Record<string, unknown>|null|undefined} params
 */
export function resolveCatalogSqlDispatchFields(params = null) {
  const input = params && typeof params === 'object' ? params : {};
  const resourceRef =
    input.resource_ref != null
      ? String(input.resource_ref).trim() || undefined
      : input.resourceRef != null
        ? String(input.resourceRef).trim() || undefined
        : undefined;
  return {
    schema: input.schema != null ? String(input.schema).trim() || undefined : undefined,
    table: input.table != null ? String(input.table).trim() || undefined : undefined,
    ...(resourceRef ? { resource_ref: resourceRef } : {}),
    params: Array.isArray(input.params) ? input.params : [],
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} config
 * @param {string} [toolKey]
 */
export function resolveCatalogDataPlaneOperation(config, toolKey = '') {
  const op = String(config?.operation || '')
    .trim()
    .toLowerCase();
  if (op && CATALOG_OPERATION_TO_DISPATCH[op]) {
    return CATALOG_OPERATION_TO_DISPATCH[op];
  }
  const key = String(toolKey || '')
    .trim()
    .toLowerCase();
  if (key && TOOL_KEY_DEFAULT_OPERATION[key]) {
    return TOOL_KEY_DEFAULT_OPERATION[key];
  }
  if (op === 'query' || op === 'readonly_sql') return 'run_readonly_sql';
  if (op === 'write' || op === 'execute' || op === 'execute_sql') return 'run_write_sql';
  if (op) return op.replace(/\./g, '_');
  return 'run_readonly_sql';
}

/**
 * @param {Record<string, unknown>|null|undefined} config
 */
export function resolveCatalogDataPlaneProvider(config) {
  const provider = String(config?.provider || '')
    .trim()
    .toLowerCase();
  if (provider && provider !== 'user') return provider;
  const plane = String(config?.data_plane || '')
    .trim()
    .toLowerCase();
  if (plane === 'user') return 'supabase';
  return provider || null;
}

/**
 * @param {string} dispatchOperation
 */
export function catalogOperationRequiresSql(dispatchOperation) {
  const op = String(dispatchOperation || '').toLowerCase();
  return op === 'run_readonly_sql' || op === 'run_write_sql' || op === 'execute_sql';
}

/**
 * @param {string} dispatchOperation
 */
export function catalogOperationIsSemanticSearch(dispatchOperation) {
  const op = String(dispatchOperation || '').toLowerCase();
  return op === 'vector_search' || op === 'autorag_search';
}
