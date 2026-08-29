/**
 * Client mirror of src/core/database-sql-safety.js
 */

export type SqlStatementKind = 'read' | 'explain' | 'mutation' | 'schema' | 'destructive' | 'unknown';
export type SqlRiskLevel = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

const MUTATING_RE =
  /\b(insert|update|delete|merge|truncate|drop|create|alter|grant|revoke|replace|attach|detach)\b/i;

const SAFE_PRAGMA_RE =
  /^\s*PRAGMA\s+(table_info|database_list|index_list|foreign_key_list|compile_options|integrity_check|index_info|table_xinfo)\b/i;

const KIND_RANK: Record<SqlStatementKind, number> = {
  read: 0,
  explain: 1,
  unknown: 2,
  mutation: 3,
  schema: 4,
  destructive: 5,
};

export function stripSqlComments(input: string): string {
  let s = String(input || '').replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/--[^\n]*/g, ' ');
  return s;
}

function isDeleteWithoutWhere(part: string): boolean {
  if (!/^\s*DELETE\b/i.test(part)) return false;
  return !/\bWHERE\b/i.test(part);
}

function isUpdateWithoutWhere(part: string): boolean {
  if (!/^\s*UPDATE\b/i.test(part)) return false;
  return !/\bWHERE\b/i.test(part);
}

function classifyStatementPart(part: string): SqlStatementKind {
  const head = part.slice(0, 200).trimStart();
  const upper = head.toUpperCase();
  if (!head) return 'unknown';

  if (/^\s*DROP\s+DATABASE\b/i.test(part)) return 'destructive';
  if (isDeleteWithoutWhere(part) || isUpdateWithoutWhere(part)) return 'destructive';
  if (/^(DROP|TRUNCATE)\b/.test(upper)) return 'destructive';
  if (/^(CREATE|ALTER|DROP|REINDEX|VACUUM)\b/.test(upper)) return 'schema';
  if (/^(INSERT|UPDATE|DELETE|MERGE|REPLACE)\b/.test(upper)) return 'mutation';

  if (/^\s*PRAGMA\b/i.test(head)) {
    if (SAFE_PRAGMA_RE.test(head)) return 'read';
    return 'mutation';
  }

  if (/^\s*EXPLAIN\b/i.test(head)) {
    if (MUTATING_RE.test(part)) return 'mutation';
    return 'explain';
  }

  if (/^\s*WITH\b/i.test(head)) {
    if (/\b(insert|update|delete|merge)\b/i.test(part)) return 'mutation';
    if (MUTATING_RE.test(part)) return 'mutation';
    return 'read';
  }

  if (/^\s*SELECT\b/i.test(head)) {
    if (MUTATING_RE.test(part)) return 'mutation';
    return 'read';
  }

  return 'unknown';
}

export function classifyDatabaseSqlStatement(sql: string): SqlStatementKind {
  const parts = stripSqlComments(sql)
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return 'unknown';

  let worst: SqlStatementKind = 'read';
  for (const part of parts) {
    const kind = classifyStatementPart(part);
    if (KIND_RANK[kind] > KIND_RANK[worst]) worst = kind;
  }
  return worst;
}

function sqlRiskLevel(kind: SqlStatementKind): SqlRiskLevel {
  if (kind === 'destructive') return 'critical';
  if (kind === 'schema') return 'high';
  if (kind === 'mutation') return 'medium';
  if (kind === 'unknown') return 'unknown';
  return 'low';
}

export function sqlBatchHasDestructivePart(sql: string): boolean {
  const parts = stripSqlComments(sql)
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.some((part) => classifyStatementPart(part) === 'destructive');
}

export function requiresDestructiveSqlModal(sql: string): boolean {
  const kind = classifyDatabaseSqlStatement(sql);
  if (kind === 'destructive' || kind === 'schema') return true;
  if (sqlBatchHasDestructivePart(sql)) return true;
  const parts = stripSqlComments(sql)
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1 && kind !== 'read' && kind !== 'explain') return true;
  return false;
}

export function requiresConfirmTypingForSql(sql: string): boolean {
  const kind = classifyDatabaseSqlStatement(sql);
  return kind === 'destructive' || sqlBatchHasDestructivePart(sql);
}

export function isReadOnlyDatabaseSql(sql: string): boolean {
  const kind = classifyDatabaseSqlStatement(sql);
  return kind === 'read' || kind === 'explain';
}

export type DatabaseSqlSafetyResult = {
  kind: SqlStatementKind;
  riskLevel: SqlRiskLevel;
  allowed: boolean;
  requiresApproval: boolean;
  requiresDestructiveConfirm: boolean;
  requiresRunModal: boolean;
  requiresConfirmTyping: boolean;
  error?: string | null;
};

export function evaluateDatabaseSqlSafety(
  sql: string,
  opts: { canWrite?: boolean; isSuperadmin?: boolean } = {},
): DatabaseSqlSafetyResult {
  // canWrite covers scoped connected D1 (user_account). isSuperadmin remains a compat alias.
  const canWrite = opts.canWrite === true || opts.isSuperadmin === true;
  const kind = classifyDatabaseSqlStatement(sql);

  if (kind === 'unknown') {
    return {
      kind,
      riskLevel: sqlRiskLevel(kind),
      allowed: false,
      requiresApproval: false,
      requiresDestructiveConfirm: false,
      requiresRunModal: false,
      requiresConfirmTyping: false,
      error: 'Empty or unsupported SQL statement',
    };
  }

  if (kind === 'read' || kind === 'explain') {
    return {
      kind,
      riskLevel: sqlRiskLevel(kind),
      allowed: true,
      requiresApproval: false,
      requiresDestructiveConfirm: false,
      requiresRunModal: false,
      requiresConfirmTyping: false,
    };
  }

  if (!canWrite) {
    const label = kind === 'destructive' ? 'destructive' : kind === 'schema' ? 'DDL' : 'DML';
    return {
      kind,
      riskLevel: sqlRiskLevel(kind),
      allowed: false,
      requiresApproval: false,
      requiresDestructiveConfirm: false,
      requiresRunModal: false,
      requiresConfirmTyping: false,
      error: `Read-only: ${label} statements are not permitted for this account`,
    };
  }

  const requiresConfirmTyping = requiresConfirmTypingForSql(sql);
  const requiresRunModal = requiresDestructiveSqlModal(sql);

  return {
    kind,
    riskLevel: sqlRiskLevel(kind),
    allowed: true,
    requiresApproval: true,
    requiresDestructiveConfirm: requiresConfirmTyping,
    requiresRunModal,
    requiresConfirmTyping,
    error: null,
  };
}

export type DatabaseSqlRunGate = DatabaseSqlSafetyResult & {
  canExecute: boolean;
};

export function getDatabaseSqlRunGate(
  sql: string,
  opts: {
    canWrite?: boolean;
    isSuperadmin?: boolean;
    studioApproved?: boolean;
    destructiveConfirmed?: boolean;
  } = {},
): DatabaseSqlRunGate {
  const safety = evaluateDatabaseSqlSafety(sql, {
    canWrite: opts.canWrite,
    isSuperadmin: opts.isSuperadmin,
  });
  if (!safety.allowed) {
    return { ...safety, canExecute: false };
  }
  if (safety.kind === 'read' || safety.kind === 'explain') {
    return { ...safety, canExecute: true };
  }

  const studioApproved = opts.studioApproved === true;
  const destructiveConfirmed = opts.destructiveConfirmed === true;

  if (safety.requiresConfirmTyping) {
    if (!destructiveConfirmed) {
      return {
        ...safety,
        canExecute: false,
        error: 'Destructive SQL requires explicit confirmation (type CONFIRM in Database Studio)',
      };
    }
    return { ...safety, canExecute: true };
  }

  if (safety.requiresApproval && !studioApproved) {
    return {
      ...safety,
      canExecute: false,
      error: 'Mutation/DDL requires confirmation in Database Studio before execution',
    };
  }

  return { ...safety, canExecute: true };
}

/** Whether ChatAssistant may auto-run db:apply-sql (v1: never by default). */
export function canClientAutorunDatabaseSql(sql: string, runRequested: boolean, isSuperadmin: boolean): boolean {
  if (!runRequested) return false;
  const kind = classifyDatabaseSqlStatement(sql);
  if (kind === 'schema' || kind === 'destructive') return false;
  const gate = getDatabaseSqlRunGate(sql, { isSuperadmin, studioApproved: true, destructiveConfirmed: true });
  return gate.canExecute && gate.kind !== 'unknown';
}
