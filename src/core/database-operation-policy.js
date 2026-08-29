import { classifyDatabaseSqlStatement, isReadOnlyDatabaseSql } from './database-sql-safety.js';

/** @typedef {'read_only'|'owner_approval_required'|'blocked'} DbOperationClass */

/** @typedef {{
 *   user_id: string|null,
 *   tenant_id: string|null,
 *   workspace_id: string|null,
 *   roles: string[],
 *   is_owner: boolean,
 *   can_run_d1: boolean,
 *   can_run_hyperdrive: boolean,
 *   can_apply_ddl: boolean,
 *   approval_required: boolean,
 * }} DatabaseRuntimeContext */

const PROTECTED_WRITE_SCHEMAS = new Set([
  'auth',
  'storage',
  'realtime',
  'supabase_migrations',
]);

const BLOCKED_PATTERNS = [
  /\bpg_authid\b/i,
  /\buser_secrets\b/i,
  /\bvault\./i,
  /\bSET\s+ROLE\s+superuser\b/i,
  /\bBYPASSRLS\b/i,
  /\bSECURITY\s+DEFINER\b/i,
];

const GLOBAL_DDL_RE =
  /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|SCHEMA|POLICY|FUNCTION|TRIGGER|VIEW)\b/i;

/**
 * @param {unknown} authUser
 * @param {{
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   role?: string|null,
 *   isOwner?: boolean,
 *   canRunD1?: boolean,
 *   canRunHyperdrive?: boolean,
 * }} [opts]
 * @returns {DatabaseRuntimeContext}
 */
export function resolveDatabaseRuntimeContext(authUser, opts = {}) {
  const userId = authUser?.id != null ? String(authUser.id) : null;
  const tenantId =
    opts.tenantId != null && String(opts.tenantId).trim()
      ? String(opts.tenantId).trim()
      : authUser?.tenant_id != null
        ? String(authUser.tenant_id)
        : null;
  const workspaceId =
    opts.workspaceId != null && String(opts.workspaceId).trim() ? String(opts.workspaceId).trim() : null;
  const role = String(opts.role ?? authUser?.role ?? '').trim().toLowerCase();
  const isOwner =
    opts.isOwner === true ||
    role === 'owner' ||
    role === 'admin' ||
    authUser?.is_workspace_owner === true;
  const canRunD1 = opts.canRunD1 !== false;
  const canRunHyperdrive = opts.canRunHyperdrive !== false;

  return {
    user_id: userId,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    roles: role ? [role] : [],
    is_owner: isOwner,
    can_run_d1: canRunD1,
    can_run_hyperdrive: canRunHyperdrive,
    can_apply_ddl: isOwner,
    approval_required: !isOwner,
  };
}

/**
 * @param {string} sql
 * @returns {DbOperationClass}
 */
export function classifyDatabaseOperation(sql) {
  const trimmed = String(sql || '').trim();
  if (!trimmed) return 'blocked';

  for (const re of BLOCKED_PATTERNS) {
    if (re.test(trimmed)) return 'blocked';
  }

  const stmtKind = classifyDatabaseSqlStatement(trimmed);
  if (stmtKind === 'read' || stmtKind === 'explain') return 'read_only';
  if (stmtKind === 'unknown') return 'blocked';

  if (stmtKind === 'destructive' || stmtKind === 'schema' || stmtKind === 'mutation') {
    return 'owner_approval_required';
  }

  return 'owner_approval_required';
}

/**
 * @param {string} sql
 * @param {DatabaseRuntimeContext} ctx
 * @param {{ surface?: string, explicitApprovalId?: string|null, schema?: string|null }} [opts]
 */
export function evaluateDatabaseOperation(sql, ctx, opts = {}) {
  const operationClass = classifyDatabaseOperation(sql);
  const readOnly = operationClass === 'read_only' || isReadOnlyDatabaseSql(sql);
  const explicitApproval = opts.explicitApprovalId != null && String(opts.explicitApprovalId).trim();

  if (operationClass === 'blocked') {
    return {
      allowed: false,
      operation_class: operationClass,
      read_only: false,
      requires_approval: false,
      reason: 'blocked_sql_pattern',
    };
  }

  if (readOnly) {
    if (!ctx.can_run_d1 && !ctx.can_run_hyperdrive) {
      return {
        allowed: false,
        operation_class: 'read_only',
        read_only: true,
        requires_approval: false,
        reason: 'database_lane_unavailable',
      };
    }
    return {
      allowed: true,
      operation_class: 'read_only',
      read_only: true,
      requires_approval: false,
      reason: 'read_only_ok',
    };
  }

  if (!ctx.can_apply_ddl && GLOBAL_DDL_RE.test(sql)) {
    return {
      allowed: false,
      operation_class: operationClass,
      read_only: false,
      requires_approval: true,
      reason: 'ddl_not_permitted',
    };
  }

  const protectedSchema = detectProtectedDatabaseSchema(sql, opts.schema);
  if (protectedSchema && !explicitApproval) {
    return {
      allowed: false,
      operation_class: operationClass,
      read_only: false,
      requires_approval: true,
      protected_schema: protectedSchema,
      reason: 'protected_schema_approval_required',
    };
  }

  if (operationClass === 'owner_approval_required' && !explicitApproval) {
    return {
      allowed: false,
      operation_class: operationClass,
      read_only: false,
      requires_approval: true,
      reason: 'owner_approval_required',
    };
  }

  return {
    allowed: true,
    operation_class: operationClass,
    read_only: false,
    requires_approval: operationClass === 'owner_approval_required',
    protected_schema: protectedSchema,
    reason: explicitApproval ? 'approved_mutation' : 'owner_direct',
  };
}

/**
 * @param {string|null|undefined} schemaName
 */
export function isProtectedDatabaseSchema(schemaName) {
  return PROTECTED_WRITE_SCHEMAS.has(String(schemaName || '').trim().toLowerCase());
}

/**
 * @param {string} sql
 * @param {string|null|undefined} [schemaHint]
 */
export function detectProtectedDatabaseSchema(sql, schemaHint = null) {
  if (isProtectedDatabaseSchema(schemaHint)) return String(schemaHint).trim().toLowerCase();
  const match = String(sql || '').match(
    /\b(auth|storage|realtime|supabase_migrations)\s*\./i,
  );
  return match ? match[1].toLowerCase() : null;
}

/** @typedef {'customer'|'public_learning'} DataPlaneOwnerType */

/**
 * @typedef {{
 *   owner_type: DataPlaneOwnerType,
 *   user_role?: string|null,
 *   is_owner?: boolean,
 *   tenant_id?: string|null,
 *   workspace_id?: string|null,
 *   operation_type?: string|null,
 *   sql?: string|null,
 *   sql_class?: string|null,
 *   provider?: string|null,
 *   schema?: string|null,
 *   table?: string|null,
 *   explicit_approval_id?: string|null,
 * }} DataPlanePolicyContext
 */

const PUBLIC_LEARNING_TABLE_RE = /^iam_[a-z0-9_]+$/i;

/**
 * Data-plane aware policy (customer BYO / public.iam_* learning).
 *
 * @param {DataPlanePolicyContext} input
 */
export function evaluateDataPlaneOperation(input) {
  const ownerType = input.owner_type || 'customer';
  const sql = input.sql != null ? String(input.sql).trim() : '';
  const operationType = String(input.operation_type || '').toLowerCase();
  const explicitApproval =
    input.explicit_approval_id != null && String(input.explicit_approval_id).trim();

  if (ownerType === 'public_learning') {
    if (sql) {
      for (const re of BLOCKED_PATTERNS) {
        if (re.test(sql)) {
          return { allowed: false, read_only: true, requires_approval: false, reason: 'blocked_sql_pattern' };
        }
      }
      const opClass = classifyDatabaseOperation(sql);
      if (opClass !== 'read_only') {
        return {
          allowed: false,
          read_only: false,
          requires_approval: false,
          reason: 'public_learning_read_only',
        };
      }
      if (!/\biam_/i.test(sql) && !/\bpublic\./i.test(sql)) {
        return {
          allowed: false,
          read_only: true,
          requires_approval: false,
          reason: 'public_learning_scope',
        };
      }
    }
    if (input.table && !PUBLIC_LEARNING_TABLE_RE.test(String(input.table))) {
      return {
        allowed: false,
        read_only: true,
        requires_approval: false,
        reason: 'public_learning_table_allowlist',
      };
    }
    return { allowed: true, read_only: true, requires_approval: false, reason: 'public_learning_ok' };
  }

  if (ownerType === 'platform') {
    return {
      allowed: false,
      read_only: false,
      requires_approval: false,
      reason: 'platform_plane_not_user_scoped',
    };
  }

  if (ownerType === 'customer') {
    if (sql) {
      for (const re of BLOCKED_PATTERNS) {
        if (re.test(sql)) {
          return { allowed: false, read_only: false, requires_approval: false, reason: 'blocked_sql_pattern' };
        }
      }
      const opClass = classifyDatabaseOperation(sql);
      if (opClass === 'read_only') {
        return { allowed: true, read_only: true, requires_approval: false, reason: 'customer_read_only_ok' };
      }
      if (!explicitApproval) {
        return {
          allowed: false,
          read_only: false,
          requires_approval: true,
          reason: 'owner_approval_required',
        };
      }
      return {
        allowed: true,
        read_only: false,
        requires_approval: false,
        reason: 'customer_approved_mutation_ok',
      };
    }
    if (/^(apply|ddl|dml|delete|update|insert|drop|alter|create)/i.test(operationType)) {
      if (!explicitApproval) {
        return {
          allowed: false,
          read_only: false,
          requires_approval: true,
          reason: 'owner_approval_required',
        };
      }
      return {
        allowed: true,
        read_only: false,
        requires_approval: false,
        reason: 'customer_approved_mutation_ok',
      };
    }
    return { allowed: true, read_only: true, requires_approval: false, reason: 'customer_ok' };
  }

  return { allowed: false, read_only: false, requires_approval: false, reason: 'unknown_owner_type' };
}
