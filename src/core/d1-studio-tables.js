/**
 * Database Studio D1 table catalog helpers.
 * Cloudflare D1 always exposes `_cf_KV`; querying `.key` is SQLITE_AUTH.
 * Analytics already excludes `_cf_%`; Studio list did not.
 */

export const D1_LIST_TABLES_SQL =
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name ASC`;

export const D1_PRAGMA_TABLE_LIST_SQL = `PRAGMA table_list`;

/**
 * @param {unknown} name
 */
export function isCfInternalD1Table(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  const lower = n.toLowerCase();
  return lower.startsWith('sqlite_') || lower.startsWith('_cf_');
}

/**
 * @param {unknown} row
 * @returns {string}
 */
export function tableNameFromD1Row(row) {
  if (row == null) return '';
  if (typeof row === 'string') return row.trim();
  if (Array.isArray(row)) return String(row[1] ?? row[0] ?? '').trim();
  if (typeof row !== 'object') return '';
  const o = /** @type {Record<string, unknown>} */ (row);
  return String(o.name ?? o.Name ?? o.table_name ?? o.tablename ?? '').trim();
}

/**
 * @param {unknown[]} rows
 * @returns {Array<{ name: string }>}
 */
export function d1StudioTablesFromRows(rows) {
  const seen = new Set();
  const tables = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const type =
      Array.isArray(row)
        ? String(row[2] || '')
        : row && typeof row === 'object'
          ? String(/** @type {Record<string, unknown>} */ (row).type || 'table')
          : 'table';
    if (type && type.toLowerCase() !== 'table') continue;
    const name = tableNameFromD1Row(row);
    if (isCfInternalD1Table(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tables.push({ name });
  }
  return tables;
}

/**
 * @param {unknown} err
 */
export function isCfInternalD1AuthError(err) {
  const msg = err == null ? '' : String(err.message || err);
  return /SQLITE_AUTH/i.test(msg) && /_cf_/i.test(msg);
}

export function cfInternalD1AuthMessage() {
  return 'Cloudflare blocks the internal _cf_KV table (SQLITE_AUTH). It is not a user table — pick a real table from the list.';
}
