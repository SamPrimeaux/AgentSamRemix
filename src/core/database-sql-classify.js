/**
 * @deprecated Import from database-sql-safety.js — re-exports for backward compatibility.
 */
export {
  stripSqlComments,
  classifyDatabaseSqlAccess,
  classifyDatabaseSqlStatement,
  isReadOnlyDatabaseSql,
  evaluateDatabaseSqlSafety,
  getDatabaseSqlRunGate,
  requiresDestructiveSqlModal,
  requiresConfirmTypingForSql,
  sqlBatchHasDestructivePart,
  assertDatabaseReadQuery,
} from './database-sql-safety.js';
