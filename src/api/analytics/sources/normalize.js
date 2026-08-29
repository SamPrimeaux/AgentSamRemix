import { jsonResponse } from '../../../core/auth.js';

export function parseRange(url) {
  const raw = String(url?.searchParams?.get('range') || '7d').toLowerCase();
  if (raw === '24h') return '24h';
  if (raw === '30d') return '30d';
  if (raw === 'all') return 'all';
  return '7d';
}

export function analyticsResponse({
  ok = true,
  backend = 'mixed',
  range = '7d',
  summary = {},
  series = [],
  breakdowns = [],
  rows = [],
  warnings = [],
  kpis = undefined,
  workflowRunsOverTime = undefined,
  latestExecutionWaterfall = undefined,
  verifiedTrace = undefined,
  errorInbox = undefined,
  modelLeaderboard = undefined,
  costLatencyScatter = undefined,
  tokensOverTime = undefined,
  codebaseOverview = undefined,
  ragHealth = undefined,
  deployments = undefined,
  sourceStatus = undefined,
  meta = undefined,
  surface = undefined,
  wired = undefined,
  database = undefined,
  charts = undefined,
  queries = undefined,
  storage = undefined,
  capacity = undefined,
  hotTables = undefined,
  health = undefined,
  schemaHealth = undefined,
  ds = undefined,
  events = undefined,
  status = 200,
}) {
  const body = {
    ok,
    backend,
    range,
    generated_at: Date.now(),
    summary,
    series,
    breakdowns,
    rows,
    warnings,
  };
  if (kpis !== undefined) body.kpis = kpis;
  if (surface !== undefined) body.surface = surface;
  if (wired !== undefined) body.wired = wired;
  if (database !== undefined) body.database = database;
  if (charts !== undefined) body.charts = charts;
  if (queries !== undefined) body.queries = queries;
  if (storage !== undefined) body.storage = storage;
  if (capacity !== undefined) body.capacity = capacity;
  if (hotTables !== undefined) body.hotTables = hotTables;
  if (health !== undefined) body.health = health;
  if (schemaHealth !== undefined) body.schemaHealth = schemaHealth;
  if (ds !== undefined) body.ds = ds;
  if (events !== undefined) body.events = events;
  if (workflowRunsOverTime !== undefined) body.workflowRunsOverTime = workflowRunsOverTime;
  if (latestExecutionWaterfall !== undefined) body.latestExecutionWaterfall = latestExecutionWaterfall;
  if (verifiedTrace !== undefined) body.verifiedTrace = verifiedTrace;
  if (errorInbox !== undefined) body.errorInbox = errorInbox;
  if (modelLeaderboard !== undefined) body.modelLeaderboard = modelLeaderboard;
  if (costLatencyScatter !== undefined) body.costLatencyScatter = costLatencyScatter;
  if (tokensOverTime !== undefined) body.tokensOverTime = tokensOverTime;
  if (codebaseOverview !== undefined) body.codebaseOverview = codebaseOverview;
  if (ragHealth !== undefined) body.ragHealth = ragHealth;
  if (deployments !== undefined) body.deployments = deployments;
  if (sourceStatus !== undefined) body.sourceStatus = sourceStatus;
  if (meta !== undefined) body.meta = meta;
  return jsonResponse(body, status);
}

