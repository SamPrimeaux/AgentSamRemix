/**
 * Small D1 schema-introspection helpers shared by backend runtime and HTTP code.
 * PRAGMA is preferred; sqlite_master parsing is the compatibility fallback for
 * restricted D1 paths where PRAGMA table_info is unavailable.
 */

function safeSqlIdentifier(value) {
  const identifier = String(value || '');
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier) ? identifier : '';
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
export async function readD1TableColumns(db, tableName) {
  const table = safeSqlIdentifier(tableName);
  if (!table || !db) return new Set();

  try {
    const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
    if (results?.length) {
      return new Set(results.map((row) => String(row.name || '').toLowerCase()));
    }
  } catch {
    // Restricted D1 paths can block PRAGMA; fall through to sqlite_master.
  }

  try {
    const row = await db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
      .bind(table)
      .first();
    if (!row?.sql) return new Set();

    const inner = String(row.sql).replace(/^[^(]+\(/, '').replace(/\)[^)]*$/, '');
    const columns = new Set();
    for (const part of inner.split(',')) {
      const column = part.trim().split(/\s+/)[0].replace(/["`[\]]/g, '').toLowerCase();
      if (
        column &&
        column !== 'primary' &&
        column !== 'foreign' &&
        column !== 'unique' &&
        column !== 'check'
      ) {
        columns.add(column);
      }
    }
    return columns;
  } catch {
    return new Set();
  }
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
export async function d1TableExists(db, tableName) {
  return (await readD1TableColumns(db, tableName)).size > 0;
}
