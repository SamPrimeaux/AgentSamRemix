/**
 * Canonical Database Studio table filters — UI operator vocabulary mapped to D1/SQLite and Postgres.
 */

/** @typedef {'equals'|'not_equals'|'contains'|'starts_with'|'ends_with'|'greater_than'|'greater_or_equal'|'less_than'|'less_or_equal'|'is_null'|'is_not_null'} DatabaseFilterUiOp */

/** @type {DatabaseFilterUiOp[]} */
export const DATABASE_FILTER_UI_OPS = [
  'equals',
  'not_equals',
  'contains',
  'starts_with',
  'ends_with',
  'greater_than',
  'greater_or_equal',
  'less_than',
  'less_or_equal',
  'is_null',
  'is_not_null',
];

const UI_OP_SET = new Set(DATABASE_FILTER_UI_OPS);

/** Legacy wire ops still accepted from older clients. @type {Record<string, DatabaseFilterUiOp>} */
const LEGACY_OP_MAP = {
  eq: 'equals',
  neq: 'not_equals',
  gt: 'greater_than',
  gte: 'greater_or_equal',
  lt: 'less_than',
  lte: 'less_or_equal',
  like: 'contains',
  is_null: 'is_null',
  not_null: 'is_not_null',
};

/**
 * @param {unknown} raw
 * @returns {unknown[]}
 */
export function parseDatabaseFiltersJson(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {unknown} op
 * @returns {DatabaseFilterUiOp|null}
 */
export function normalizeDatabaseFilterUiOp(op) {
  const s = String(op || '').trim();
  if (UI_OP_SET.has(/** @type {DatabaseFilterUiOp} */ (s))) return /** @type {DatabaseFilterUiOp} */ (s);
  return LEGACY_OP_MAP[s] || null;
}

/**
 * @param {string} col
 * @param {Set<string>|string[]|null} allowColumns
 */
export function assertAllowlistedColumn(col, allowColumns) {
  const name = String(col || '').trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error('Invalid column name');
  }
  if (allowColumns) {
    const set = allowColumns instanceof Set ? allowColumns : new Set(allowColumns);
    if (set.size && !set.has(name)) {
      throw new Error(`Column not allowed: ${name}`);
    }
  }
  return name;
}

/**
 * @param {unknown[]} filters
 * @param {{ quoteIdent: (name: string) => string, paramPlaceholder?: () => string, allowColumns?: Set<string>|string[]|null }} opts
 * @returns {{ where: string, values: unknown[], uiOps: DatabaseFilterUiOp[] }}
 */
export function buildD1FilterWhere(filters, opts) {
  const quoteIdent = opts.quoteIdent;
  const clauses = [];
  const values = [];
  const uiOps = [];

  for (const f of filters || []) {
    const uiOp = normalizeDatabaseFilterUiOp(f?.op);
    if (!uiOp) continue;
    const col = assertAllowlistedColumn(f?.col, opts.allowColumns ?? null);
    const qcol = quoteIdent(col);
    uiOps.push(uiOp);

    switch (uiOp) {
      case 'is_null':
        clauses.push(`${qcol} IS NULL`);
        break;
      case 'is_not_null':
        clauses.push(`${qcol} IS NOT NULL`);
        break;
      case 'equals':
        clauses.push(`${qcol} = ?`);
        values.push(f.val);
        break;
      case 'not_equals':
        clauses.push(`${qcol} != ?`);
        values.push(f.val);
        break;
      case 'greater_than':
        clauses.push(`${qcol} > ?`);
        values.push(f.val);
        break;
      case 'greater_or_equal':
        clauses.push(`${qcol} >= ?`);
        values.push(f.val);
        break;
      case 'less_than':
        clauses.push(`${qcol} < ?`);
        values.push(f.val);
        break;
      case 'less_or_equal':
        clauses.push(`${qcol} <= ?`);
        values.push(f.val);
        break;
      case 'contains':
        clauses.push(`${qcol} LIKE ?`);
        values.push(`%${String(f.val ?? '')}%`);
        break;
      case 'starts_with':
        clauses.push(`${qcol} LIKE ?`);
        values.push(`${String(f.val ?? '')}%`);
        break;
      case 'ends_with':
        clauses.push(`${qcol} LIKE ?`);
        values.push(`%${String(f.val ?? '')}`);
        break;
      default:
        break;
    }
  }

  return {
    where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
    values,
    uiOps,
  };
}

/**
 * @param {unknown[]} filters
 * @param {{ quoteIdent: (name: string) => string, allowColumns?: Set<string>|string[]|null }} opts
 * @returns {{ where: string, values: unknown[], uiOps: DatabaseFilterUiOp[] }}
 */
export function buildPostgresFilterWhere(filters, opts) {
  const quoteIdent = opts.quoteIdent;
  const clauses = [];
  const values = [];
  const uiOps = [];
  let paramIndex = 0;

  const nextParam = () => {
    paramIndex += 1;
    return `$${paramIndex}`;
  };

  for (const f of filters || []) {
    const uiOp = normalizeDatabaseFilterUiOp(f?.op);
    if (!uiOp) continue;
    const col = assertAllowlistedColumn(f?.col, opts.allowColumns ?? null);
    const qcol = quoteIdent(col);
    uiOps.push(uiOp);

    switch (uiOp) {
      case 'is_null':
        clauses.push(`${qcol} IS NULL`);
        break;
      case 'is_not_null':
        clauses.push(`${qcol} IS NOT NULL`);
        break;
      case 'equals':
        clauses.push(`${qcol} = ${nextParam()}`);
        values.push(f.val);
        break;
      case 'not_equals':
        clauses.push(`${qcol} <> ${nextParam()}`);
        values.push(f.val);
        break;
      case 'greater_than':
        clauses.push(`${qcol} > ${nextParam()}`);
        values.push(f.val);
        break;
      case 'greater_or_equal':
        clauses.push(`${qcol} >= ${nextParam()}`);
        values.push(f.val);
        break;
      case 'less_than':
        clauses.push(`${qcol} < ${nextParam()}`);
        values.push(f.val);
        break;
      case 'less_or_equal':
        clauses.push(`${qcol} <= ${nextParam()}`);
        values.push(f.val);
        break;
      case 'contains':
        clauses.push(`${qcol} LIKE ${nextParam()}`);
        values.push(`%${String(f.val ?? '')}%`);
        break;
      case 'starts_with':
        clauses.push(`${qcol} LIKE ${nextParam()}`);
        values.push(`${String(f.val ?? '')}%`);
        break;
      case 'ends_with':
        clauses.push(`${qcol} LIKE ${nextParam()}`);
        values.push(`%${String(f.val ?? '')}`);
        break;
      default:
        break;
    }
  }

  return {
    where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
    values,
    uiOps,
  };
}

/**
 * @param {string} sort
 * @param {'ASC'|'DESC'} dir
 * @param {Set<string>|string[]|null} allowColumns
 * @param {(name: string) => string} quoteIdent
 */
export function buildAllowlistedOrderBy(sort, dir, allowColumns, quoteIdent) {
  const col = String(sort || '').trim();
  if (!col) return '';
  const safe = assertAllowlistedColumn(col, allowColumns);
  return ` ORDER BY ${quoteIdent(safe)} ${dir}`;
}
