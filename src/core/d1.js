/**
 * Persistence Layer: D1 Database
 * Handles Cloudflare D1 query and mutation logic.
 * Deconstructed from legacy worker.js.
 */

import { assertD1ReadOnlySelect, stripSqlComments } from './d1-read-validator.js';
import { gateD1WriteContracts } from './d1-write-contract.js';

export { stripSqlComments, assertD1ReadOnlySelect } from './d1-read-validator.js';
export { assertD1WriteContracts, gateD1WriteContracts } from './d1-write-contract.js';

/**
 * Standard D1 read query handler (SELECT / read-only WITH).
 * Ensures consistent error handling and parameter binding.
 */
export async function d1_query({ query, sql, params }, env) {
  if (!env.DB) throw new Error('Database unavailable');
  const sqlString = (query ?? sql ?? '').trim();
  const gate = assertD1ReadOnlySelect(sqlString);
  if (!gate.ok) throw new Error(gate.error || 'd1_query blocked');

  try {
    const bindParams = Array.isArray(params) ? params : [];
    const stmt = env.DB.prepare(sqlString);
    const rows = bindParams.length ? await stmt.bind(...bindParams).all() : await stmt.all();
    return rows.results ?? [];
  } catch (e) {
    throw new Error(`D1 Query error: ${e.message}`);
  }
}

/**
 * Standard D1 Write/Mutation handler.
 * Includes security checks for destructive operations.
 */
export async function d1_write({ query, sql, params, allow_d1_contract_bypass }, env) {
  if (!env.DB) throw new Error('Database unavailable');
  const sqlString = (query ?? sql ?? '').trim();
  if (!sqlString) throw new Error('d1_write: sql required');

  // Security Gate: Block dangerous operations
  const blocked = /\bdrop\s+table\b|\btruncate\b/i;
  if (blocked.test(sqlString)) {
    throw new Error('Blocked: DROP TABLE and TRUNCATE require manual approval');
  }

  const contract = gateD1WriteContracts(sqlString, { allow_d1_contract_bypass });
  if (!contract.ok) throw new Error(contract.error);

  try {
    const bindParams = Array.isArray(params) ? params : [];
    const stmt = env.DB.prepare(sqlString);
    const result = bindParams.length ? await stmt.bind(...bindParams).run() : await stmt.run();
    return {
      changes: result.meta?.changes ?? result.changes ?? 0,
      success: true,
      lastRowId: result.meta?.last_row_id ?? null
    };
  } catch (e) {
    throw new Error(`D1 Write error: ${e.message}`);
  }
}

/**
 * Safely quotes an identifier for SQL queries.
 */
export function iamD1QuoteIdent(ident) {
  return `"${String(ident).replace(/"/g, '""')}"`;
}
