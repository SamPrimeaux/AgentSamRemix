/**
 * @deprecated Use databaseSqlSafety.ts — re-exports for backward compatibility.
 */
export {
  type SqlStatementKind,
  type SqlRiskLevel,
  stripSqlComments,
  classifyDatabaseSqlStatement,
  isReadOnlyDatabaseSql,
  evaluateDatabaseSqlSafety,
  getDatabaseSqlRunGate,
  requiresDestructiveSqlModal,
  requiresConfirmTypingForSql,
  sqlBatchHasDestructivePart,
  canClientAutorunDatabaseSql,
} from './databaseSqlSafety';
