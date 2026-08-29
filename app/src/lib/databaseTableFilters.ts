/**
 * Client mirror of src/core/database-table-filters.js (canonical UI operator vocabulary).
 */

export type DatabaseFilterUiOp =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'greater_or_equal'
  | 'less_than'
  | 'less_or_equal'
  | 'is_null'
  | 'is_not_null';

export const DATABASE_FILTER_UI_OPS: DatabaseFilterUiOp[] = [
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

export const DATABASE_FILTER_UI_LABELS: Record<DatabaseFilterUiOp, string> = {
  equals: 'Equals',
  not_equals: 'Not equals',
  contains: 'Contains',
  starts_with: 'Starts with',
  ends_with: 'Ends with',
  greater_than: 'Greater than',
  greater_or_equal: 'Greater or equal',
  less_than: 'Less than',
  less_or_equal: 'Less or equal',
  is_null: 'Is null',
  is_not_null: 'Is not null',
};

export type DatabaseFilterRule = {
  id: string;
  col: string;
  op: DatabaseFilterUiOp;
  val: string;
};

const LEGACY_OP_MAP: Record<string, DatabaseFilterUiOp> = {
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

export function normalizeDatabaseFilterUiOp(op: string): DatabaseFilterUiOp | null {
  const s = String(op || '').trim();
  if ((DATABASE_FILTER_UI_OPS as string[]).includes(s)) return s as DatabaseFilterUiOp;
  return LEGACY_OP_MAP[s] || null;
}

/** Wire format sent to /api/d1|hyperdrive/table/.../data */
export function serializeDatabaseFilters(filters: DatabaseFilterRule[]): string {
  return JSON.stringify(
    filters
      .filter((f) => f.col && f.op)
      .map(({ col, op, val }) => ({ col, op, val })),
  );
}
