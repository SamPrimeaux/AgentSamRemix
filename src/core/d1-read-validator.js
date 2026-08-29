/**
 * Shared D1 read-query gate — delegates to database-sql-safety.js
 */
import { assertDatabaseReadQuery, stripSqlComments } from './database-sql-safety.js';

export { stripSqlComments };

/**
 * SQLite default SQLITE_MAX_COMPOUND_SELECT is 500; agent models often UNION ALL every table
 * and blow the limit with a useless overview query. Fail early with a recovery hint.
 * Keep well under the SQLite ceiling so remote D1 never returns cryptic SQLITE_ERROR.
 */
export const D1_MAX_COMPOUND_SELECT_TERMS = 24;

/**
 * @param {string} sqlString
 * @returns {{ ok: boolean, error?: string, user_message?: string, term_count?: number }}
 */
export function assertD1SqlCompoundSelectBudget(sqlString) {
  const stripped = stripSqlComments(String(sqlString || ''));
  if (!stripped.trim()) return { ok: true };
  const parts = stripped.split(/\b(?:UNION(?:\s+ALL)?|EXCEPT|INTERSECT)\b/i);
  const termCount = parts.length;
  if (termCount <= D1_MAX_COMPOUND_SELECT_TERMS) {
    return { ok: true, term_count: termCount };
  }
  return {
    ok: false,
    term_count: termCount,
    error: `compound_select_too_large: ${termCount} terms (max ${D1_MAX_COMPOUND_SELECT_TERMS})`,
    user_message:
      `That SQL has ${termCount} UNION/EXCEPT/INTERSECT terms; SQLite/D1 reject oversized compound SELECTs. ` +
      `List tables with SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 50, ` +
      `then query one table at a time (or a small UNION of ≤${D1_MAX_COMPOUND_SELECT_TERMS} terms).`,
  };
}

/**
 * @param {string} sqlString
 * @returns {{ ok: boolean, error?: string }}
 */
export function assertD1ReadOnlySelect(sqlString) {
  const gate = assertDatabaseReadQuery(sqlString);
  if (gate.ok) return { ok: true };
  return { ok: false, error: gate.error || 'policy_block' };
}
