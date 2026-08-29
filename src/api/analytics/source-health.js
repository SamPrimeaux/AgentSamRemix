import { parseRange, analyticsResponse } from './sources/normalize.js';
import { d1CountLatest } from './sources/d1.js';
import { supabaseCountLatest } from './sources/supabase.js';
import { isHyperdriveBindingPresent, isHyperdriveUsable } from '../../../backend/services/database/hyperdrive.js';
import {
  resolveCodeIndexLaneConfig,
  CODE_INDEX_LANE_FIXTURE_TABLES,
} from '../../../backend/agentsam/codebase/code-index-lane-resolve.js';

const D1_TABLES = [
  { key: 'usage', table: 'agentsam_usage_events', backend: 'd1' },
  { key: 'mcp_tool_execution', table: 'agentsam_mcp_tool_execution', backend: 'd1' },
  { key: 'tool_call_log', table: 'agentsam_tool_call_log', backend: 'd1' },
  { key: 'workflow_runs', table: 'agentsam_workflow_runs', backend: 'd1' },
  { key: 'execution_perf', table: 'agentsam_execution_performance_metrics', backend: 'd1' },
  { key: 'error_log', table: 'agentsam_error_log', backend: 'd1' },
  { key: 'deployment_health', table: 'agentsam_deployment_health', backend: 'd1' },
  { key: 'cms_pages', table: 'cms_pages', backend: 'd1' },
  { key: 'cms_page_sections', table: 'cms_page_sections', backend: 'd1' },
  { key: 'cms_section_components', table: 'cms_section_components', backend: 'd1' },
];

// Counts via supabaseCountLatest → agentsam.<table> only (public.* retired on 2026-08 cutover).
function buildSupabaseTables(codeTables) {
  return [
    { key: 'documents', table: 'agentsam_documents_oai3large_1536', backend: 'supabase' },
    { key: 'semantic_search_log', table: 'agentsam_search_log', backend: 'supabase' },
    { key: 'codebase_files', table: codeTables.files, backend: 'supabase' },
    { key: 'codebase_chunks', table: codeTables.chunks, backend: 'supabase' },
    { key: 'codebase_symbols', table: codeTables.symbols, backend: 'supabase' },
    { key: 'agentsam_workflow_runs', table: 'agentsam_workflow_runs', backend: 'supabase' },
    { key: 'agentsam_tool_call_events', table: 'agentsam_tool_call_events', backend: 'supabase' },
    { key: 'agentsam_error_events', table: 'agentsam_error_events', backend: 'supabase' },
  ];
}

export async function handleAnalyticsSourceHealth(_request, url, env, { tenantId, workspaceId }) {
  const range = parseRange(url);
  const rows = [];
  const warnings = [];

  const d1 = env?.DB || null;
  const hasD1 = !!d1;
  const hasBindingShell = isHyperdriveBindingPresent(env);
  const hasHyperdrive = isHyperdriveUsable(env);

  let codeTables = CODE_INDEX_LANE_FIXTURE_TABLES;
  if (hasD1) {
    try {
      codeTables = (await resolveCodeIndexLaneConfig(env)).tables;
    } catch (e) {
      warnings.push({
        code: 'CODE_INDEX_LANE_RESOLVE_FAILED',
        message: String(e?.message || e),
        backend: 'd1',
        severity: 'warning',
      });
    }
  }
  const SUPABASE_TABLES = buildSupabaseTables(codeTables);

  if (!hasD1) {
    warnings.push({
      code: 'D1_BINDING_MISSING',
      message: 'D1 binding env.DB is not configured; D1 source health is partial.',
      backend: 'd1',
      severity: 'warn',
    });
  }
  if (!hasBindingShell) {
    warnings.push({
      code: 'HYPERDRIVE_BINDING_MISSING',
      message: 'Hyperdrive binding env.HYPERDRIVE is not present; Supabase source health is partial.',
      backend: 'supabase',
      severity: 'warn',
    });
  } else if (!hasHyperdrive) {
    warnings.push({
      code: 'HYPERDRIVE_BINDING_MISSING',
      message:
        'Hyperdrive binding is present but not usable (no .query / no connectionString); Supabase source health is partial.',
      backend: 'supabase',
      severity: 'warn',
    });
  }
  if (!tenantId) {
    warnings.push({
      code: 'TENANT_ID_MISSING',
      message: 'No tenant_id resolved; tenant-scoped source checks may be unscoped.',
      backend: 'mixed',
      severity: 'warn',
    });
  }

  // D1
  if (hasD1) {
    for (const t of D1_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      const out = await d1CountLatest(d1, t.table, { tenantId, range });
      rows.push({
        source: t.key,
        backend: 'd1',
        table: t.table,
        row_count: out.count,
        latest_row: out.latest,
        time_column: out.time_col,
        tenant_scoped: out.has_tenant,
        status: 'active',
      });
    }
  }

  // Supabase via Hyperdrive (Postgres)
  if (hasHyperdrive) {
    for (const t of SUPABASE_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      const out = await supabaseCountLatest(env, t.table, { tenantId, workspaceId, range });
      const status =
        out.ok && out.count === 0
          ? 'empty_capability'
          : out.ok
            ? 'active'
            : 'unknown';
      rows.push({
        source: t.key,
        backend: 'supabase',
        table: t.table,
        row_count: out.count,
        latest_row: out.latest,
        time_column: out.time_col,
        tenant_scoped: out.has_tenant,
        status,
        warning: out.ok ? null : out.warning,
      });
    }
  }

  // Domain warnings (requested ones)
  const semantic = rows.find((r) => r.backend === 'supabase' && r.source === 'semantic_search_log');
  const docs = rows.find((r) => r.backend === 'supabase' && r.source === 'documents');
  if (docs?.row_count > 0 && semantic?.row_count != null && semantic.row_count < 5) {
    warnings.push({
      code: 'RAG_QUERY_LOG_LOW',
      message:
        'Documents exist, but semantic search logging volume is low. Confirm the RAG query path writes to agentsam_search_log.',
      backend: 'supabase',
      data_source_key: 'supabaseSemanticSearch',
      severity: 'warn',
    });
  }

  return analyticsResponse({
    ok: true,
    backend: 'mixed',
    range,
    summary: {
      tenant_id: tenantId || null,
      d1_configured: hasD1,
      hyperdrive_configured: hasHyperdrive,
      rows: rows.length,
    },
    rows,
    warnings,
  });
}

