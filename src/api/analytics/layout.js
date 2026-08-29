import { jsonResponse } from '../../core/auth.js';

function safeJsonParse(maybeJson, fallback) {
  if (maybeJson == null) return fallback;
  if (typeof maybeJson === 'object') return maybeJson;
  try {
    return JSON.parse(String(maybeJson));
  } catch {
    return fallback;
  }
}

function normalizeTab(sectionRow) {
  const sectionData = safeJsonParse(sectionRow?.section_data, {});
  const tabId =
    String(sectionData?.tab_id || sectionRow?.section_name || '')
      .trim()
      .toLowerCase() || 'overview';

  const statusRaw = String(sectionData?.status || 'live').toLowerCase();
  const status =
    statusRaw === 'beta' ? 'beta' : statusRaw === 'coming_soon' ? 'coming_soon' : 'live';

  const label = String(sectionData?.label || tabId).trim() || tabId;
  const description = typeof sectionData?.description === 'string' ? sectionData.description : undefined;
  const dataSources = Array.isArray(sectionData?.data_sources)
    ? sectionData.data_sources.map((s) => String(s))
    : [];

  return {
    id: String(sectionRow.id),
    tabId,
    label,
    status,
    description,
    dataSources,
    sortOrder: Number(sectionRow.sort_order ?? 0) || 0,
  };
}

function normalizeWidget(componentRow) {
  const cd = safeJsonParse(componentRow?.component_data, {});
  const cfg = cd && typeof cd === 'object' ? cd : {};

  const dataSourceKey = typeof cfg.data_source_key === 'string' ? cfg.data_source_key : undefined;
  const chartType = typeof cfg.chart_type === 'string' ? cfg.chart_type : undefined;
  const title = typeof cfg.title === 'string' ? cfg.title : undefined;
  const gridColSpan =
    cfg.grid_col_span != null && Number.isFinite(Number(cfg.grid_col_span))
      ? Number(cfg.grid_col_span)
      : undefined;

  return {
    id: String(componentRow.id),
    type: String(componentRow.component_type || ''),
    dataSourceKey,
    chartType,
    title,
    gridColSpan,
    config: cfg,
    sortOrder: Number(componentRow.sort_order ?? 0) || 0,
  };
}

function registryFallbackLayout(routePath) {
  return {
    ok: true,
    page: {
      id: 'registry_fallback',
      title: 'Analytics',
      routePath,
      defaultTab: 'overview',
      config: {
        default_tab: 'overview',
        layout_version: 'analytics-cockpit-v1',
        range_default: '7d',
        supported_ranges: ['24h', '7d', '30d', 'all'],
      },
    },
    tabs: [
      {
        id: 'overview',
        label: 'Overview',
        status: 'live',
        description: 'System pulse, workflows, tools, errors, deploys, and data health.',
        dataSources: ['systemPulse', 'workflowRuns', 'toolCalls', 'errorInbox', 'deployHealth', 'dataHealth'],
        sortOrder: 10,
      },
      {
        id: 'agent',
        label: 'Agent',
        status: 'live',
        description: 'Workflow runs, execution performance, guardrails, and approvals.',
        dataSources: ['workflowRuns', 'workflowGraph', 'dependencyGraph', 'executionPerf', 'errorInbox', 'guardrails', 'approvals', 'skills'],
        sortOrder: 20,
      },
      {
        id: 'workers',
        label: 'Workers',
        status: 'beta',
        description: 'Deploys, dashboard assets, and R2 inventory.',
        dataSources: ['dataHealth', 'r2Inventory', 'dashboardVersions', 'webhooks'],
        sortOrder: 30,
      },
      {
        id: 'mcp',
        label: 'MCP',
        status: 'live',
        description: 'Tool calls, tool success, and tool cache.',
        dataSources: ['toolCalls', 'toolCache'],
        sortOrder: 40,
      },
      {
        id: 'models',
        label: 'Models',
        status: 'live',
        description: 'Latency, cost, drift, routing arms, and evals.',
        dataSources: ['modelLeaderboard', 'modelDrift', 'routingArms', 'evalRuns'],
        sortOrder: 50,
      },
      {
        id: 'databases',
        label: 'Databases',
        status: 'beta',
        description: 'D1 + Supabase observability: query performance, storage, and health.',
        dataSources: ['executionPerf', 'dataHealth'],
        sortOrder: 60,
      },
      {
        id: 'advisors',
        label: 'Advisors',
        status: 'beta',
        description: 'Advisor findings driven by data health, errors, and guardrails.',
        dataSources: ['dataHealth', 'errorInbox', 'guardrails'],
        sortOrder: 70,
      },
      {
        id: 'deploys',
        label: 'Deploys',
        status: 'live',
        description: 'Deploy health and dashboard versions.',
        dataSources: ['deployHealth', 'dashboardVersions'],
        sortOrder: 80,
      },
      {
        id: 'costs',
        label: 'Costs',
        status: 'live',
        description: 'Cost trend, tokens, and prompt cache.',
        dataSources: ['costTrend', 'modelLeaderboard', 'systemPulse', 'promptCache'],
        sortOrder: 90,
      },
      {
        id: 'rag',
        label: 'RAG',
        status: 'live',
        description: 'RAG health: indexing, query volume, and coverage.',
        dataSources: ['ragHealth'],
        sortOrder: 100,
      },
      {
        id: 'codebase',
        label: 'Codebase',
        status: 'live',
        description: 'Codebase health and indexing freshness.',
        dataSources: ['codebaseHealth'],
        sortOrder: 110,
      },
    ],
    widgetsByTab: {},
    warnings: [
      {
        code: 'CMS_ANALYTICS_LAYOUT_NOT_SEEDED',
        message: 'Analytics CMS layout rows are not seeded yet. Rendering registry fallback.',
        severity: 'info',
      },
    ],
  };
}

export async function handleAnalyticsLayout(request, url, env, { tenantId }) {
  void request;
  const routePath = url.searchParams.get('route') || '/dashboard/analytics';
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;

  if (!env?.DB) {
    return jsonResponse(registryFallbackLayout(routePath), 200);
  }
  if (!tid) {
    return jsonResponse(
      {
        ...registryFallbackLayout(routePath),
        warnings: [
          {
            code: 'ANALYTICS_TENANT_ID_MISSING',
            message: 'No tenant_id resolved for layout query. Rendering registry fallback.',
            severity: 'warn',
          },
          ...registryFallbackLayout(routePath).warnings,
        ],
      },
      200,
    );
  }

  try {
    const pageRow = await env.DB.prepare(
      `SELECT
        id,
        project_id,
        project_slug,
        tenant_id,
        workspace_id,
        slug,
        path,
        route_path,
        page_type,
        title,
        status,
        config_json,
        analytics_json,
        metadata_json,
        is_active
      FROM cms_pages
      WHERE route_path = ?
        AND tenant_id = ?
        AND is_active = 1
      LIMIT 1;`,
    )
      .bind(routePath, tid)
      .first();

    if (!pageRow?.id) {
      return jsonResponse(registryFallbackLayout(routePath), 200);
    }

    const pageConfig = safeJsonParse(pageRow.config_json, {});
    const defaultTab =
      String(pageConfig?.default_tab || pageConfig?.defaultTab || 'overview')
        .trim()
        .toLowerCase() || 'overview';

    const tabsRows = await env.DB.prepare(
      `SELECT
        id,
        page_id,
        section_type,
        section_name,
        section_data,
        sort_order,
        is_visible
      FROM cms_page_sections
      WHERE page_id = ?
        AND section_type = 'analytics_tab'
        AND is_visible = 1
      ORDER BY sort_order ASC;`,
    )
      .bind(String(pageRow.id))
      .all();

    const tabRows = Array.isArray(tabsRows?.results) ? tabsRows.results : [];
    const tabs = tabRows.map(normalizeTab);

    const widgetsByTab = {};
    for (const t of tabRows) {
      const widgetRows = await env.DB.prepare(
        `SELECT
          id,
          section_id,
          component_type,
          component_data,
          sort_order,
          is_visible,
          tenant_id,
          project_id
        FROM cms_section_components
        WHERE section_id = ?
          AND is_visible = 1
        ORDER BY sort_order ASC;`,
      )
        .bind(String(t.id))
        .all();
      const wr = Array.isArray(widgetRows?.results) ? widgetRows.results : [];
      const tabId =
        String(safeJsonParse(t.section_data, {})?.tab_id || t.section_name || '')
          .trim()
          .toLowerCase() || 'overview';
      widgetsByTab[tabId] = wr.map(normalizeWidget);
    }

    return jsonResponse(
      {
        ok: true,
        page: {
          id: String(pageRow.id),
          title: String(pageRow.title || 'Analytics'),
          routePath: String(pageRow.route_path || routePath),
          defaultTab,
          config: pageConfig,
        },
        tabs: tabs.map((t) => ({
          id: t.tabId,
          label: t.label,
          status: t.status,
          description: t.description,
          dataSources: t.dataSources,
          sortOrder: t.sortOrder,
        })),
        widgetsByTab,
        warnings: [],
      },
      200,
    );
  } catch (e) {
    return jsonResponse(
      {
        ...registryFallbackLayout(routePath),
        warnings: [
          {
            code: 'CMS_ANALYTICS_LAYOUT_QUERY_FAILED',
            message: e?.message ? String(e.message) : 'CMS layout query failed. Rendering registry fallback.',
            severity: 'warn',
          },
          ...registryFallbackLayout(routePath).warnings,
        ],
      },
      200,
    );
  }
}

