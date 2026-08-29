/**
 * /api/data-plane/* — BYO infrastructure + public learning (non-owner safe).
 */
import { jsonResponse } from '../core/responses.js';
import { getAuthUser } from '../core/auth.js';
import { resolveAgentDataScope } from '../../backend/http/agentsam/routes/scope.js';
import { resolveCustomerDataPlane } from '../core/customer-data-plane-router.js';
import { dispatchCustomerDataPlaneOperation } from '../core/customer-data-plane-dispatch.js';
import { customerSupabaseListProjects, customerSupabaseSelectProjectForWorkspace } from '../core/customer-supabase-dispatch.js';
import { buildCustomerCloudflareCatalog } from '../core/customer-cloudflare-catalog.js';
import {
  customerCloudflareListAccounts,
  customerCloudflareListD1,
  customerCloudflareListHyperdrive,
  customerCloudflareListR2,
  customerCloudflareListVectorize,
} from '../core/customer-cloudflare-dispatch.js';
import { listWorkspaceDataBindings } from '../core/workspace-data-bindings.js';
import { getOAuthToken, getUserSupabaseToken } from '../../backend/identity/oauth/user-token.js';
import { platformSupabaseResourceFromEnv } from '../core/platform-supabase-resource.js';

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 */
export async function handleCustomerDataPlaneApi(request, url, env) {
  const pathLower = url.pathname.toLowerCase();
  const method = request.method.toUpperCase();

  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  const scope = await resolveAgentDataScope(env, authUser, request);
  const userId = scope.userId || '';
  const workspaceId = scope.workspaceId || '';
  const tenantId = scope.tenantId || '';

  if (pathLower === '/api/data-plane/context' && method === 'GET') {
    const plane = await resolveCustomerDataPlane(env, {
      user_id: userId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      message: '',
      authUser,
    });
    const supabaseTok = userId ? await getUserSupabaseToken(env, userId, workspaceId) : null;
    const cfTok = userId ? await getOAuthToken(env, userId, 'cloudflare') : null;
    const bindings = workspaceId ? await listWorkspaceDataBindings(env, workspaceId) : [];
    let supabaseProjects = [];
    if (supabaseTok?.access_token) {
      const listed = await customerSupabaseListProjects(env, userId, workspaceId);
      if (listed.ok) supabaseProjects = listed.projects || [];
    }

    return jsonResponse({
      active_data_plane: plane.data_plane,
      owner_type: plane.owner_type,
      degraded_reason: plane.degraded_reason,
      is_owner: false,
      platform_available: false,
      connections: {
        supabase: Boolean(supabaseTok?.access_token),
        cloudflare: Boolean(cfTok),
      },
      supabase_projects: supabaseProjects,
      platform_supabase: platformSupabaseResourceFromEnv(env),
      pinned_supabase_project_ref: plane.project_ref || null,
      bindings,
      provider_faces: [
        {
          id: 'd1',
          label: 'D1',
          resource_scopes: ['workspace', 'connected'],
        },
        {
          id: 'supabase',
          label: 'Supabase DB',
          resource_scopes: ['connected'],
        },
      ],
      banner:
        plane.data_plane === 'platform_supabase'
          ? 'Agent Sam is operating on the explicitly selected platform Supabase resource'
          : plane.data_plane === 'customer_supabase' && plane.project_ref
            ? `Agent Sam is operating on connected Supabase project ${plane.project_ref}`
            : 'Select a D1 or Supabase resource before running a query',
      supabase_connect_url:
        '/api/oauth/supabase/start?return_to=' +
        encodeURIComponent('/dashboard/database?studio=1'),
    });
  }

  if (pathLower === '/api/data-plane/public-learning/tables' && method === 'GET') {
    const out = await dispatchCustomerDataPlaneOperation(env, {
      operation: 'list_tables',
      data_plane: 'public_learning',
      user_id: userId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      authUser,
    });
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  if (pathLower === '/api/data-plane/public-learning/query' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const out = await dispatchCustomerDataPlaneOperation(env, {
      operation: 'run_readonly_sql',
      data_plane: 'public_learning',
      sql: body?.sql,
      user_id: userId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      authUser,
    });
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  if (pathLower === '/api/data-plane/customer-supabase/projects' && method === 'GET') {
    const out = await customerSupabaseListProjects(env, userId, workspaceId);
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  if (pathLower === '/api/data-plane/customer-supabase/select' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const out = await customerSupabaseSelectProjectForWorkspace(env, {
      user_id: userId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      project_id: String(body?.project_id || body?.project_ref || ''),
      project_ref: body?.project_ref,
      display_name: body?.display_name,
      authUser,
    });
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  if (pathLower === '/api/data-plane/customer-supabase/query' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const sql = String(body?.sql || '').trim();
    const projectRef = String(body?.project_ref || body?.project_id || '').trim() || null;
    if (!projectRef) {
      return jsonResponse({ ok: false, error: 'explicit_supabase_resource_required' }, 400);
    }
    const { classifyDatabaseSqlStatement } = await import('../core/database-sql-safety.js');
    const kind = classifyDatabaseSqlStatement(sql);
    const operation =
      kind === 'read' || kind === 'explain' ? 'run_readonly_sql' : 'execute_sql';
    const out = await dispatchCustomerDataPlaneOperation(env, {
      operation,
      data_plane: 'customer_supabase',
      sql,
      params: Array.isArray(body?.params) ? body.params : [],
      schema: body?.schema != null ? String(body.schema).trim() || null : null,
      resource_ref: projectRef,
      project_ref: projectRef,
      project_id: projectRef,
      user_id: userId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      authUser,
      approval_id: body?.approval_id || null,
    });
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  if (pathLower === '/api/data-plane/customer-supabase/tables' && method === 'GET') {
    const projectRef = String(url.searchParams.get('project_ref') || '').trim() || null;
    if (!projectRef) {
      return jsonResponse({ ok: false, error: 'explicit_supabase_resource_required', tables: [] }, 400);
    }
    const out = await dispatchCustomerDataPlaneOperation(env, {
      operation: 'list_tables',
      data_plane: 'customer_supabase',
      project_ref: projectRef,
      resource_ref: projectRef,
      user_id: userId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      authUser,
    });
    if (out.ok && Array.isArray(out.tables)) {
      return jsonResponse({
        ...out,
        tables: out.tables.map((t) =>
          typeof t === 'string'
            ? { name: t }
            : {
                name: String(t?.name || t?.table_name || ''),
                table_schema: t?.schema || t?.table_schema || 'public',
              },
        ).filter((t) => t.name),
      });
    }
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  const supabaseTableRoute = url.pathname.match(
    /^\/api\/data-plane\/customer-supabase\/table\/([^/]+)\/(schema|data)$/i,
  );
  if (supabaseTableRoute && method === 'GET') {
    const projectRef = String(url.searchParams.get('project_ref') || '').trim();
    const schema = String(url.searchParams.get('schema') || '').trim();
    const table = decodeURIComponent(supabaseTableRoute[1]).trim();
    const action = supabaseTableRoute[2].toLowerCase();
    if (!projectRef) {
      return jsonResponse({ ok: false, error: 'explicit_supabase_resource_required' }, 400);
    }
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema) || !/^[a-z_][a-z0-9_]*$/i.test(table)) {
      return jsonResponse({ ok: false, error: 'invalid_schema_or_table' }, 400);
    }
    if (action === 'schema') {
      const out = await dispatchCustomerDataPlaneOperation(env, {
        operation: 'describe_table',
        data_plane: 'customer_supabase',
        project_ref: projectRef,
        resource_ref: projectRef,
        schema,
        table,
        user_id: userId,
        tenant_id: tenantId,
        workspace_id: workspaceId,
        authUser,
      });
      return jsonResponse(
        {
          ...out,
          columns: out.columns || out.rows || [],
          indexes: out.indexes || [],
          foreign_keys: out.foreign_keys || [],
        },
        out.ok ? 200 : 400,
      );
    }
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || '50')));
    const offset = (page - 1) * limit;
    const quoted = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
    const out = await dispatchCustomerDataPlaneOperation(env, {
      operation: 'run_readonly_sql',
      data_plane: 'customer_supabase',
      project_ref: projectRef,
      resource_ref: projectRef,
      schema,
      table,
      sql: `SELECT * FROM ${quoted} LIMIT ${limit} OFFSET ${offset}`,
      user_id: userId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      authUser,
    });
    const rows = Array.isArray(out.rows) ? out.rows : [];
    return jsonResponse(
      {
        ...out,
        rows,
        columns: rows.length ? Object.keys(rows[0]) : [],
        page,
        total_count: null,
        total_pages: rows.length < limit ? page : page + 1,
      },
      out.ok ? 200 : 400,
    );
  }

  if (pathLower === '/api/data-plane/customer-cloudflare/accounts' && method === 'GET') {
    const out = await customerCloudflareListAccounts(env, userId, tenantId, workspaceId);
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  if (pathLower === '/api/data-plane/customer-cloudflare/d1-databases' && method === 'GET') {
    const accts = await customerCloudflareListAccounts(env, userId, tenantId, workspaceId);
    if (!accts.ok) return jsonResponse(accts, 400);
    const accountId = String(url.searchParams.get('account_id') || accts.accounts?.[0]?.id || '').trim();
    if (!accountId) {
      return jsonResponse({ ok: false, error: 'account_id_required', databases: [] }, 400);
    }
    const out = await customerCloudflareListD1(env, userId, accountId, tenantId, workspaceId);
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  if (pathLower === '/api/data-plane/customer-cloudflare/r2-buckets' && method === 'GET') {
    const accts = await customerCloudflareListAccounts(env, userId, tenantId, workspaceId);
    if (!accts.ok) return jsonResponse(accts, 400);
    const accountId = String(url.searchParams.get('account_id') || accts.accounts?.[0]?.id || '').trim();
    if (!accountId) {
      return jsonResponse({ ok: false, error: 'account_id_required', buckets: [] }, 400);
    }
    const out = await customerCloudflareListR2(env, userId, accountId, tenantId, workspaceId);
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  if (pathLower === '/api/data-plane/customer-cloudflare/hyperdrive-configs' && method === 'GET') {
    const accts = await customerCloudflareListAccounts(env, userId, tenantId, workspaceId);
    if (!accts.ok) return jsonResponse(accts, 400);
    const accountId = String(url.searchParams.get('account_id') || accts.accounts?.[0]?.id || '').trim();
    if (!accountId) {
      return jsonResponse({ ok: false, error: 'account_id_required', configs: [] }, 400);
    }
    const out = await customerCloudflareListHyperdrive(env, userId, accountId, tenantId, workspaceId);
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  if (pathLower === '/api/data-plane/customer-cloudflare/vectorize-indexes' && method === 'GET') {
    const accts = await customerCloudflareListAccounts(env, userId, tenantId, workspaceId);
    if (!accts.ok) return jsonResponse(accts, 400);
    const accountId = String(url.searchParams.get('account_id') || accts.accounts?.[0]?.id || '').trim();
    if (!accountId) {
      return jsonResponse({ ok: false, error: 'account_id_required', indexes: [] }, 400);
    }
    const out = await customerCloudflareListVectorize(env, userId, accountId, tenantId, workspaceId);
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  if (pathLower === '/api/data-plane/customer-cloudflare/catalog' && method === 'GET') {
    const out = await buildCustomerCloudflareCatalog(env, {
      user_id: userId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      authUser,
    });
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  if (pathLower === '/api/data-plane/dispatch' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const out = await dispatchCustomerDataPlaneOperation(env, {
      operation: String(body?.operation || ''),
      message: body?.message,
      requested_provider: body?.provider,
      user_id: userId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      sql: body?.sql,
      params: Array.isArray(body?.params) ? body.params : [],
      migration_sql: body?.migration_sql,
      table: body?.table,
      schema: body?.schema,
      resource_ref: body?.resource_ref,
      project_ref: body?.project_ref,
      approval_id: body?.approval_id,
      authUser,
    });
    return jsonResponse(out, out.ok ? 200 : 400);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
