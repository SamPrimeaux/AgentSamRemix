/**
 * Shared SQL safety classification for Database Studio, HTTP APIs, and agent tools.
 * @typedef {'read' | 'explain' | 'mutation' | 'schema' | 'destructive' | 'unknown'} SqlStatementKind
 */

const MUTATING_RE =
  /\b(insert|update|delete|merge|truncate|drop|create|alter|grant|revoke|replace|attach|detach)\b/i;

const SAFE_PRAGMA_RE =
  /^\s*PRAGMA\s+(table_info|database_list|index_list|foreign_key_list|compile_options|integrity_check|index_info|table_xinfo)\b/i;

/** @type {Record<SqlStatementKind, number>} */
const KIND_RANK = {
  read: 0,
  explain: 1,
  unknown: 2,
  mutation: 3,
  schema: 4,
  destructive: 5,
};

/** @param {string} input */
export function stripSqlComments(input) {
  let s = String(input || '').replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/--[^\n]*/g, ' ');
  return s;
}

/** @param {string} part */
function isDeleteWithoutWhere(part) {
  if (!/^\s*DELETE\b/i.test(part)) return false;
  return !/\bWHERE\b/i.test(part);
}

/** @param {string} part */
function isUpdateWithoutWhere(part) {
  if (!/^\s*UPDATE\b/i.test(part)) return false;
  return !/\bWHERE\b/i.test(part);
}

/**
 * @param {string} part
 * @returns {SqlStatementKind}
 */
function classifyStatementPart(part) {
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

/**
 * @param {string} sql
 * @returns {SqlStatementKind}
 */
export function classifyDatabaseSqlStatement(sql) {
  const stripped = stripSqlComments(sql);
  const parts = stripped
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return 'unknown';

  let worst = /** @type {SqlStatementKind} */ ('read');
  for (const part of parts) {
    const kind = classifyStatementPart(part);
    if (KIND_RANK[kind] > KIND_RANK[worst]) worst = kind;
  }
  return worst;
}

/**
 * Legacy access bucket for HTTP routes that used read/write/ddl/invalid.
 * @param {string} sql
 * @returns {'read' | 'write' | 'ddl' | 'invalid'}
 */
export function classifyDatabaseSqlAccess(sql) {
  const kind = classifyDatabaseSqlStatement(sql);
  if (kind === 'read' || kind === 'explain') return 'read';
  if (kind === 'unknown') return 'invalid';
  if (kind === 'schema' || kind === 'destructive') return 'ddl';
  return 'write';
}

/** @param {string} sql */
export function isReadOnlyDatabaseSql(sql) {
  const kind = classifyDatabaseSqlStatement(sql);
  return kind === 'read' || kind === 'explain';
}

/** @param {SqlStatementKind} kind */
function sqlRiskLevel(kind) {
  if (kind === 'destructive') return 'critical';
  if (kind === 'schema') return 'high';
  if (kind === 'mutation') return 'medium';
  if (kind === 'unknown') return 'unknown';
  return 'low';
}

/**
 * @param {string} sql
 * @returns {boolean}
 */
export function sqlBatchHasDestructivePart(sql) {
  const parts = stripSqlComments(sql)
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.some((part) => classifyStatementPart(part) === 'destructive');
}

/**
 * @param {string} sql
 * @returns {boolean}
 */
export function requiresDestructiveSqlModal(sql) {
  const kind = classifyDatabaseSqlStatement(sql);
  if (kind === 'destructive' || kind === 'schema') return true;
  if (sqlBatchHasDestructivePart(sql)) return true;
  const stripped = stripSqlComments(sql);
  const parts = stripped
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1 && kind !== 'read' && kind !== 'explain') return true;
  return false;
}

/**
 * @param {string} sql
 * @returns {boolean}
 */
export function requiresConfirmTypingForSql(sql) {
  const kind = classifyDatabaseSqlStatement(sql);
  return kind === 'destructive' || sqlBatchHasDestructivePart(sql);
}

/**
 * @param {string} sql
 * @param {{ canWrite?: boolean, isSuperadmin?: boolean, channel?: string }} [opts]
 */
export function evaluateDatabaseSqlSafety(sql, opts = {}) {
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
    const label =
      kind === 'destructive' ? 'destructive' : kind === 'schema' ? 'DDL' : 'DML';
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
    requiresApproval: false,
    requiresDestructiveConfirm: requiresConfirmTyping,
    requiresRunModal,
    requiresConfirmTyping,
    error: null,
  };
}

/**
 * Execution gate for dashboard HTTP routes (studio approval + destructive typing).
 * @param {string} sql
 * @param {{ canWrite?: boolean, isSuperadmin?: boolean, studioApproved?: boolean, destructiveConfirmed?: boolean }} [opts]
 */
export function getDatabaseSqlRunGate(sql, opts = {}) {
  const safety = evaluateDatabaseSqlSafety(sql, {
    canWrite: opts.canWrite,
    isPlatformOperator: opts.isSuperadmin,
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

/**
 * d1_query / hyperdrive_query read paths (single-statement friendly).
 * @param {string} sql
 * @returns {{ ok: boolean, error?: string, kind?: SqlStatementKind }}
 */
export function assertDatabaseReadQuery(sql) {
  const raw = String(sql || '').trim();
  if (!raw) return { ok: false, error: 'SQL query required', kind: 'unknown' };

  const stripped = stripSqlComments(raw);
  const statements = stripped
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (statements.length > 1) {
    return {
      ok: false,
      error: 'Only a single read-only statement is allowed (no semicolon batching).',
      kind: 'unknown',
    };
  }
  if (!statements.length) {
    return { ok: false, error: 'Empty or unsupported SQL statement', kind: 'unknown' };
  }

  const single = statements[0];
  const kind = classifyDatabaseSqlStatement(single);
  if (kind === 'read' || kind === 'explain') {
    return { ok: true, kind };
  }
  if (kind === 'unknown') {
    return { ok: false, error: 'Unsupported SQL statement', kind };
  }
  return {
    ok: false,
    error: `Only read-only SELECT / EXPLAIN / safe WITH (and safe PRAGMA) are allowed. Statement kind: ${kind}.`,
    kind,
  };
}
