async function d1First(db, sql, binds = []) {
  if (!db) return null;
  try {
    return await db.prepare(sql).bind(...binds).first();
  } catch {
    return null;
  }
}

async function d1All(db, sql, binds = []) {
  if (!db) return [];
  try {
    const { results } = await db.prepare(sql).bind(...binds).all();
    return results || [];
  } catch {
    return [];
  }
}

export async function d1TableInfo(db, tableName) {
  const rows = await d1All(db, `PRAGMA table_info(${String(tableName).replace(/[^a-zA-Z0-9_]/g, '')});`);
  return Array.isArray(rows) ? rows : [];
}

export async function d1CountLatest(db, tableName, { tenantId = null, range = null } = {}) {
  const info = await d1TableInfo(db, tableName);
  const cols = new Set(info.map((c) => String(c?.name || '').toLowerCase()).filter(Boolean));

  const hasTenant = cols.has('tenant_id');
  const timeCols = [
    'created_at',
    'started_at',
    'updated_at',
    'timestamp',
    'captured_at',
    'metric_date',
    'snapshot_at',
  ].filter((c) => cols.has(c));
  const timeCol = timeCols[0] || null;

  const where = [];
  const binds = [];
  if (hasTenant && tenantId) {
    where.push('tenant_id = ?');
    binds.push(String(tenantId));
  }
  if (range && timeCol) {
    if (range === '24h') where.push(`${timeCol} >= unixepoch('now','-24 hours')`);
    if (range === '7d') where.push(`${timeCol} >= unixepoch('now','-7 days')`);
    if (range === '30d') where.push(`${timeCol} >= unixepoch('now','-30 days')`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const safeTable = String(tableName).replace(/[^a-zA-Z0-9_]/g, '');
  const countRow = await d1First(db, `SELECT COUNT(*) AS c FROM ${safeTable} ${whereSql};`, binds);
  const latestRow =
    timeCol != null
      ? await d1First(db, `SELECT MAX(${timeCol}) AS latest FROM ${safeTable} ${whereSql};`, binds)
      : null;

  return {
    count: Number(countRow?.c ?? 0) || 0,
    latest: latestRow?.latest ?? null,
    time_col: timeCol,
    has_tenant: hasTenant,
  };
}

