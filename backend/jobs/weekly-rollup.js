import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function pragmaTableInfo(db, tableName) {
  const safe = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(tableName || '')) ? String(tableName) : '';
  if (!safe || !db) return new Set();
  try {
    const { results } = await db.prepare(`PRAGMA table_info(${safe})`).all();
    return new Set((results || []).map((r) => String(r.name || '').toLowerCase()));
  } catch {
    return new Set();
  }
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function tableExists(db, name) {
  const safe = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(name || '')) ? String(name) : '';
  if (!safe) return false;
  try {
    const row = await db
      .prepare(`SELECT 1 AS o FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .bind(safe)
      .first();
    return !!row;
  } catch {
    return false;
  }
}

function safeJson(obj, fallback = '{}') {
  try {
    return JSON.stringify(obj ?? JSON.parse(fallback));
  } catch {
    return fallback;
  }
}

/** Merge daily top_tools_json rows into a single top-5 list for the week. */
function mergeTopToolsFromDailyRows(rows) {
  const counts = new Map();
  for (const row of rows || []) {
    let parsed = [];
    try {
      parsed = JSON.parse(String(row.top_tools_json || '[]'));
    } catch {
      parsed = [];
    }
    if (!Array.isArray(parsed)) continue;
    for (const item of parsed) {
      const tool = String(item?.tool || item?.tool_name || '').trim();
      if (!tool) continue;
      counts.set(tool, (counts.get(tool) || 0) + (Number(item?.count) || 0));
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tool, count]) => ({ tool, count }));
}

/**
 * Tool call totals from agentsam_usage_rollups_daily (survives 24h tool_call_log purge).
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
async function loadWeeklyToolStatsFromRollups(db, tenantId, workspaceId, dataFrom, dataTo) {
  const cols = await pragmaTableInfo(db, 'agentsam_usage_rollups_daily');
  if (!cols.size || !cols.has('day')) return null;

  const dayFrom = new Date(dataFrom * 1000).toISOString().slice(0, 10);
  const dayTo = new Date(dataTo * 1000).toISOString().slice(0, 10);

  let where = `day >= ? AND day < ?`;
  const binds = [dayFrom, dayTo];
  if (cols.has('tenant_id')) {
    where += ` AND tenant_id = ?`;
    binds.push(tenantId);
  }
  if (cols.has('workspace_id')) {
    where += ` AND workspace_id = ?`;
    binds.push(workspaceId);
  }

  const sums = await db
    .prepare(
      `SELECT
         COALESCE(SUM(tool_calls), 0) AS total,
         COALESCE(SUM(tool_successes), 0) AS successes,
         COALESCE(SUM(tool_failures), 0) AS failures
       FROM agentsam_usage_rollups_daily WHERE ${where}`,
    )
    .bind(...binds)
    .first()
    .catch(() => null);

  const topRows = cols.has('top_tools_json')
    ? (
        await db
          .prepare(`SELECT top_tools_json FROM agentsam_usage_rollups_daily WHERE ${where}`)
          .bind(...binds)
          .all()
          .catch(() => ({ results: [] }))
      ).results || []
    : [];

  return {
    totalToolCalls: Number(sums?.total) || 0,
    totalSuccesses: Number(sums?.successes) || 0,
    totalFailures: Number(sums?.failures) || 0,
    topToolsJson: safeJson(mergeTopToolsFromDailyRows(topRows), '[]'),
  };
}

/**
 * Time filter: compare numeric unix-ish columns to [dataFrom, dataTo).
 * @param {string} col
 */
function unixWindowClause(col) {
  return `(${col} IS NOT NULL AND CAST(${col} AS INTEGER) >= ? AND CAST(${col} AS INTEGER) < ?)`;
}

/**
 * Weekly analytics rollup: one ledger row; one INSERT per active workspace (conflict key tenant+period+period_date).
 */
export async function runWeeklyRollup(env) {
  if (!env?.DB) return;

  const begun = await startCronRun(env, {
    jobName: 'weekly_unified_rollup',
    cronExpression: '0 1 * * sun',
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();

  const now = new Date();
  const day = now.getUTCDay();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((day + 6) % 7));
  const periodDate = monday.toISOString().slice(0, 10);
  const dataTo = Math.floor(monday.getTime() / 1000);
  const dataFrom = dataTo - 7 * 86400;

  let rowsRead = 0;
  let rowsWritten = 0;

  try {
    const anaCols = await pragmaTableInfo(env.DB, 'agentsam_analytics');
    if (!anaCols.size) {
      if (runId) {
        await completeCronRun(env, runId, startedAt, {
          rowsRead: 0,
          rowsWritten: 0,
          metadata: { skipped: true, reason: 'no_agentsam_analytics' },
        });
      }
      return;
    }

    const required = ['tenant_id', 'workspace_id', 'period', 'period_date'];
    if (!required.every((c) => anaCols.has(c))) {
      if (runId) {
        await completeCronRun(env, runId, startedAt, {
          rowsRead: 0,
          rowsWritten: 0,
          metadata: { skipped: true, reason: 'analytics_columns' },
        });
      }
      return;
    }

    const { results: workspaces = [] } = await env.DB
      .prepare(`SELECT id, tenant_id FROM agentsam_workspace WHERE status = 'active'`)
      .all()
      .catch(() => ({ results: [] }));
    rowsRead += workspaces.length;

    const deployTable = (await tableExists(env.DB, 'agentsam_deployments'))
      ? 'agentsam_deployments'
      : (await tableExists(env.DB, 'build_deploy_events'))
        ? 'build_deploy_events'
        : (await tableExists(env.DB, 'deployments'))
          ? 'deployments'
          : null;
    const deployCols = deployTable ? await pragmaTableInfo(env.DB, deployTable) : new Set();

    const costsCols = await pragmaTableInfo(env.DB, 'agent_costs');
    const toolLogCols = await pragmaTableInfo(env.DB, 'agentsam_tool_call_log');
    const mcpCols = await pragmaTableInfo(env.DB, 'agentsam_mcp_tool_execution');
    const wfCols = await pragmaTableInfo(env.DB, 'agentsam_workflow_runs');

    for (const ws of workspaces) {
      const workspaceId = ws?.id != null ? String(ws.id) : '';
      const tenantId = ws?.tenant_id != null ? String(ws.tenant_id) : '';
      if (!workspaceId || !tenantId) continue;

      let totalToolCalls = 0;
      let totalSuccesses = 0;
      let totalFailures = 0;
      let topToolsJson = '[]';

      const rollupToolStats = await loadWeeklyToolStatsFromRollups(
        env.DB,
        tenantId,
        workspaceId,
        dataFrom,
        dataTo,
      );
      if (rollupToolStats) {
        rowsRead += 2;
        totalToolCalls = rollupToolStats.totalToolCalls;
        totalSuccesses = rollupToolStats.totalSuccesses;
        totalFailures = rollupToolStats.totalFailures;
        topToolsJson = rollupToolStats.topToolsJson;
      } else if (toolLogCols.size && toolLogCols.has('created_at')) {
        const timeExpr = unixWindowClause('created_at');
        let where = timeExpr;
        const binds = [dataFrom, dataTo];
        if (toolLogCols.has('tenant_id')) {
          where += ` AND tenant_id = ?`;
          binds.push(tenantId);
        }
        if (toolLogCols.has('workspace_id')) {
          where += ` AND workspace_id = ?`;
          binds.push(workspaceId);
        }
        const totalRow = await env.DB.prepare(
          `SELECT COUNT(*) AS c FROM agentsam_tool_call_log WHERE ${where}`,
        )
          .bind(...binds)
          .first()
          .catch(() => null);
        rowsRead += 1;
        totalToolCalls = Number(totalRow?.c) || 0;

        const sucRow = await env.DB.prepare(
          `SELECT COUNT(*) AS c FROM agentsam_tool_call_log WHERE ${where} AND status = 'success'`,
        )
          .bind(...binds)
          .first()
          .catch(() => null);
        rowsRead += 1;
        totalSuccesses = Number(sucRow?.c) || 0;

        const failRow = await env.DB.prepare(
          `SELECT COUNT(*) AS c FROM agentsam_tool_call_log WHERE ${where} AND LOWER(status) IN ('error','failed')`,
        )
          .bind(...binds)
          .first()
          .catch(() => null);
        rowsRead += 1;
        totalFailures = Number(failRow?.c) || 0;

        const topTools = await env.DB.prepare(
          `SELECT tool_name, COUNT(*) AS c FROM agentsam_tool_call_log WHERE ${where}
           GROUP BY tool_name ORDER BY c DESC LIMIT 5`,
        )
          .bind(...binds)
          .all()
          .catch(() => ({ results: [] }));
        rowsRead += 1;
        topToolsJson = safeJson(
          (topTools.results || []).map((r) => ({ tool: r.tool_name, count: Number(r.c) || 0 })),
          '[]',
        );
      }

      let mcpCalls = 0;
      let brokenToolsJson = '[]';
      let toolReliabilityJson = '{}';
      if (mcpCols.size && mcpCols.has('created_at')) {
        const timeExpr = `(typeof(created_at) = 'integer' AND created_at >= ? AND created_at < ?)
             OR (typeof(created_at) != 'integer' AND unixepoch(created_at) >= ? AND unixepoch(created_at) < ?)`;
        let binds = [dataFrom, dataTo, dataFrom, dataTo];
        let where = `(${timeExpr})`;
        if (mcpCols.has('tenant_id')) {
          where += ` AND tenant_id = ?`;
          binds.push(tenantId);
        }
        if (mcpCols.has('workspace_id')) {
          where += ` AND workspace_id = ?`;
          binds.push(workspaceId);
        }

        const mcpTotal = await env.DB.prepare(`SELECT COUNT(*) AS c FROM agentsam_mcp_tool_execution WHERE ${where}`)
          .bind(...binds)
          .first()
          .catch(() => null);
        rowsRead += 1;
        mcpCalls = Number(mcpTotal?.c) || 0;

        const broken = await env.DB.prepare(
          `SELECT DISTINCT tool_name FROM agentsam_mcp_tool_execution WHERE ${where} AND COALESCE(success, 0) = 0 AND tool_name IS NOT NULL`,
        )
          .bind(...binds)
          .all()
          .catch(() => ({ results: [] }));
        rowsRead += 1;
        brokenToolsJson = safeJson(
          (broken.results || []).map((r) => String(r.tool_name || '')).filter(Boolean),
          '[]',
        );

        const rel = await env.DB.prepare(
          `SELECT tool_name,
             SUM(CASE WHEN COALESCE(success, 0) != 0 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS rate
           FROM agentsam_mcp_tool_execution WHERE ${where} AND tool_name IS NOT NULL
           GROUP BY tool_name`,
        )
          .bind(...binds)
          .all()
          .catch(() => ({ results: [] }));
        rowsRead += 1;
        const relObj = Object.fromEntries(
          (rel.results || []).map((r) => [String(r.tool_name || 'unknown'), Number(r.rate) || 0]),
        );
        toolReliabilityJson = safeJson(relObj);
      }

      let totalCostUsd = 0;
      let totalInTok = 0;
      let totalOutTok = 0;
      let modelBreakdownJson = '{}';
      let topModel = null;
      let topProvider = null;
      const costsScoped = costsCols.has('tenant_id') || costsCols.has('workspace_id');
      if (costsCols.size && costsCols.has('cost_usd') && costsScoped) {
        let where = '1=1';
        const binds = [];
        if (costsCols.has('tenant_id')) {
          where += ` AND tenant_id = ?`;
          binds.push(tenantId);
        }
        if (costsCols.has('workspace_id')) {
          where += ` AND workspace_id = ?`;
          binds.push(workspaceId);
        }
        if (costsCols.has('created_at')) {
          where += ` AND (typeof(created_at) = 'integer' AND CAST(created_at AS INTEGER) >= ? AND CAST(created_at AS INTEGER) < ?
              OR typeof(created_at) != 'integer' AND unixepoch(created_at) >= ? AND unixepoch(created_at) < ?)`;
          binds.push(dataFrom, dataTo, dataFrom, dataTo);
        }

        const sums = await env.DB.prepare(
          `SELECT
             COALESCE(SUM(cost_usd), 0) AS sc,
             COALESCE(SUM(COALESCE(tokens_in, 0)), 0) AS si,
             COALESCE(SUM(COALESCE(tokens_out, 0)), 0) AS so
           FROM agent_costs WHERE ${where}`,
        )
          .bind(...binds)
          .first()
          .catch(() => null);
        rowsRead += 1;
        totalCostUsd = Number(sums?.sc) || 0;
        totalInTok = Number(sums?.si) || 0;
        totalOutTok = Number(sums?.so) || 0;

        if (costsCols.has('model_used')) {
          const byModel = await env.DB.prepare(
            `SELECT COALESCE(model_used, 'unknown') AS m,
                    COALESCE(SUM(cost_usd), 0) AS cost
             FROM agent_costs WHERE ${where}
             GROUP BY COALESCE(model_used, 'unknown')
             ORDER BY cost DESC`,
          )
            .bind(...binds)
            .all()
            .catch(() => ({ results: [] }));
          rowsRead += 1;
          modelBreakdownJson = safeJson(
            Object.fromEntries((byModel.results || []).map((r) => [String(r.m), Number(r.cost) || 0])),
          );
          topModel = byModel.results?.[0]?.m != null ? String(byModel.results[0].m) : null;
        }

        if (costsCols.has('provider')) {
          const topP = await env.DB.prepare(
            `SELECT COALESCE(provider, 'unknown') AS p,
                    COALESCE(SUM(cost_usd), 0) AS cost
             FROM agent_costs WHERE ${where}
             GROUP BY COALESCE(provider, 'unknown')
             ORDER BY cost DESC LIMIT 1`,
          )
            .bind(...binds)
            .first()
            .catch(() => null);
          rowsRead += 1;
          topProvider = topP?.p != null ? String(topP.p) : null;
        }
      }

      let workflowCount = 0;
      if (wfCols.size && wfCols.has('started_at')) {
        let where = `${unixWindowClause('started_at')}`;
        const binds = [dataFrom, dataTo];
        if (wfCols.has('tenant_id')) {
          where += ` AND tenant_id = ?`;
          binds.push(tenantId);
        }
        if (wfCols.has('workspace_id')) {
          where += ` AND workspace_id = ?`;
          binds.push(workspaceId);
        }
        const wr = await env.DB.prepare(`SELECT COUNT(*) AS c FROM agentsam_workflow_runs WHERE ${where}`)
          .bind(...binds)
          .first()
          .catch(() => null);
        rowsRead += 1;
        workflowCount = Number(wr?.c) || 0;
      }

      let deployCount = 0;
      if (deployTable && deployCols.size) {
        let where = '1=1';
        const binds = [];
        if (deployCols.has('timestamp')) {
          where = `datetime(timestamp) >= datetime(?, 'unixepoch') AND datetime(timestamp) < datetime(?, 'unixepoch')`;
          binds.push(dataFrom, dataTo);
        } else if (deployCols.has('created_at')) {
          where = unixWindowClause('created_at');
          binds.push(dataFrom, dataTo);
        }
        if (deployCols.has('tenant_id')) {
          where += ` AND tenant_id = ?`;
          binds.push(tenantId);
        }
        if (deployCols.has('workspace_id')) {
          where += ` AND workspace_id = ?`;
          binds.push(workspaceId);
        }
        const dr = await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${deployTable} WHERE ${where}`)
          .bind(...binds)
          .first()
          .catch(() => null);
        rowsRead += 1;
        deployCount = Number(dr?.c) || 0;
      }

      const notesObj = {
        workflow_runs: workflowCount,
        deployments: deployTable ? { table: deployTable, count: deployCount } : { table: null, count: 0 },
      };
      const notesJson = safeJson(notesObj);
      const rowCountSource = totalToolCalls + mcpCalls + workflowCount + deployCount;

      const rowValues = {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        period_date: periodDate,
        total_tool_calls: totalToolCalls,
        total_tool_successes: totalSuccesses,
        total_tool_failures: totalFailures,
        total_cost_usd: totalCostUsd,
        total_input_tokens: totalInTok,
        total_output_tokens: totalOutTok,
        model_breakdown_json: modelBreakdownJson,
        top_tools_json: topToolsJson,
        broken_tools_json: brokenToolsJson,
        tool_reliability_json: toolReliabilityJson,
        top_model: topModel,
        top_provider: topProvider,
        data_from: dataFrom,
        data_to: dataTo,
        row_count_source: rowCountSource,
        notes: notesJson,
      };

      const desiredCols = [
        'tenant_id',
        'workspace_id',
        'period',
        'period_date',
        'total_tool_calls',
        'total_tool_successes',
        'total_tool_failures',
        'total_cost_usd',
        'total_input_tokens',
        'total_output_tokens',
        'model_breakdown_json',
        'top_tools_json',
        'broken_tools_json',
        'tool_reliability_json',
        'top_model',
        'top_provider',
        'computed_at',
        'data_from',
        'data_to',
        'row_count_source',
        'notes',
      ].filter((c) => anaCols.has(c));

      if (!desiredCols.includes('tenant_id') || !desiredCols.includes('workspace_id')) continue;

      const valueFragments = [];
      const bindRow = [];
      for (const col of desiredCols) {
        if (col === 'period') {
          valueFragments.push(`'weekly'`);
        } else if (col === 'computed_at') {
          valueFragments.push('unixepoch()');
        } else {
          valueFragments.push('?');
          bindRow.push(rowValues[col] ?? null);
        }
      }

      const updateParts = desiredCols
        .filter((c) => !['tenant_id', 'workspace_id', 'period', 'period_date'].includes(c))
        .map((c) => (c === 'computed_at' ? `computed_at = unixepoch()` : `${c} = excluded.${c}`));

      const sql = `
        INSERT INTO agentsam_analytics (${desiredCols.join(', ')})
        VALUES (${valueFragments.join(', ')})
        ON CONFLICT(tenant_id, workspace_id, period, period_date) DO UPDATE SET ${updateParts.join(', ')}
      `;

      await env.DB.prepare(sql)
        .bind(...bindRow)
        .run()
        .catch((e) => {
          console.warn('[weekly-rollup] upsert', workspaceId, e?.message ?? e);
        });
      rowsWritten += 1;
    }

    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead,
        rowsWritten,
        metadata: { periodDate, dataFrom, dataTo, workspaces: workspaces.length },
      });
    }
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    throw e;
  }
}
