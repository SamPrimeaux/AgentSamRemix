/**
 * Settings section: Network (fetch allowlist, trusted origins, workspace
 * custom domains, integration endpoints).
 * - GET          /api/settings/network
 * - POST/DELETE  /api/settings/network/domains
 * Deconstructed from src/api/settings-sections.js (Sections peel SEC2, no
 * behavior change).
 */
import { jsonResponse } from '../core/auth.js';
import { getWorkspaceOwnerUserId } from '../../backend/identity/workspace/agentsam-workspace.js';
import { userCanAccessWorkspace } from '../core/workspace-access.js';
import { safeQueryAll, envelope } from './settings-sections-shared.js';

// ─── Section: Network ────────────────────────────────────────────────────────
const WORKSPACE_DOMAIN_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function normalizeWorkspaceDomain(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
  return s;
}

function isValidWorkspaceDomain(domain) {
  if (!domain || domain.includes(' ') || domain.includes(':') || domain.includes('/')) return false;
  return WORKSPACE_DOMAIN_RE.test(domain);
}

async function resolveNetworkWorkspaceId(request, authUser, url, body) {
  const headerWid = String(request?.headers?.get('x-iam-workspace-id') || '').trim();
  if (headerWid) return headerWid;
  const queryWid = String(url?.searchParams?.get('workspace_id') || '').trim();
  if (queryWid) return queryWid;
  const bodyWid = body?.workspace_id != null ? String(body.workspace_id).trim() : '';
  if (bodyWid) return bodyWid;
  const activeWid = String(authUser?.active_workspace_id || '').trim();
  if (activeWid) return activeWid;
  return '';
}

async function callerCanManageWorkspaceDomains(env, workspaceId, userId) {
  if (!env?.DB || !workspaceId || !userId) return false;
  try {
    const ownerUserId = await getWorkspaceOwnerUserId(env, workspaceId);
    if (ownerUserId && ownerUserId === String(userId)) return true;
  } catch (_) {}
  try {
    const row = await env.DB.prepare(
      `SELECT role FROM workspace_members
       WHERE workspace_id = ? AND user_id = ?
         AND COALESCE(is_active, 1) = 1
       LIMIT 1`,
    )
      .bind(workspaceId, userId)
      .first();
    const role = String(row?.role || '').toLowerCase();
    return role === 'owner' || role === 'admin';
  } catch (_) {
    return false;
  }
}

async function addWorkspaceDomain(request, env, authUser, url) {
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const workspaceId = await resolveNetworkWorkspaceId(request, authUser, url, body);
  if (!workspaceId) return jsonResponse({ error: 'workspace_id required' }, 400);

  const userId = String(authUser?.id || '').trim();
  if (!(await userCanAccessWorkspace(env, authUser, workspaceId))) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }
  if (!(await callerCanManageWorkspaceDomains(env, workspaceId, userId))) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const domain = normalizeWorkspaceDomain(body?.domain);
  if (!domain) return jsonResponse({ error: 'domain required' }, 400);
  if (!isValidWorkspaceDomain(domain)) {
    return jsonResponse({ error: 'Invalid domain — use a bare hostname (no protocol or path)' }, 400);
  }

  const existing = await env.DB.prepare(
    `SELECT id FROM workspace_domains WHERE workspace_id = ? AND domain = ? LIMIT 1`,
  )
    .bind(workspaceId, domain)
    .first()
    .catch(() => null);
  if (existing?.id) return jsonResponse({ error: 'Domain already exists for this workspace' }, 409);

  const id = `wsd_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO workspace_domains (
      id, workspace_id, domain, is_primary, status, verification_method, verified_at, created_at, updated_at
    ) VALUES (?, ?, ?, 0, 'active', NULL, NULL, ?, ?)`,
  )
    .bind(id, workspaceId, domain, now, now)
    .run();

  return jsonResponse(
    {
      ok: true,
      domain: { id, workspace_id: workspaceId, domain, status: 'active', created_at: now },
    },
    201,
  );
}

async function removeWorkspaceDomain(request, env, authUser, url) {
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const workspaceId = await resolveNetworkWorkspaceId(request, authUser, url, body);
  if (!workspaceId) return jsonResponse({ error: 'workspace_id required' }, 400);

  const userId = String(authUser?.id || '').trim();
  if (!(await userCanAccessWorkspace(env, authUser, workspaceId))) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }
  if (!(await callerCanManageWorkspaceDomains(env, workspaceId, userId))) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const domain = normalizeWorkspaceDomain(body?.domain || url.searchParams.get('domain'));
  if (!domain) return jsonResponse({ error: 'domain required' }, 400);

  const result = await env.DB.prepare(
    `DELETE FROM workspace_domains WHERE workspace_id = ? AND domain = ?`,
  )
    .bind(workspaceId, domain)
    .run();

  if (!result?.meta?.changes) {
    return jsonResponse({ error: 'Domain not found' }, 404);
  }

  return jsonResponse({ ok: true, deleted: true, domain, workspace_id: workspaceId });
}

async function getNetwork(env, authUser, workspaceId) {
  const warnings = [];
  const cache = new Map();
  const db = env.DB;
  const wsId = workspaceId || '';

  const fetchAllowlist = await safeQueryAll(
    db,
    'agentsam_fetch_domain_allowlist',
    wsId
      ? `SELECT host, workspace_id, risk_level, created_at FROM agentsam_fetch_domain_allowlist WHERE workspace_id = ? OR workspace_id IS NULL OR workspace_id = '' ORDER BY host`
      : `SELECT host, workspace_id, risk_level, created_at FROM agentsam_fetch_domain_allowlist ORDER BY host LIMIT 200`,
    wsId ? [wsId] : [],
    warnings,
    cache,
  );

  const trustedOrigins = await safeQueryAll(
    db,
    'agentsam_browser_trusted_origin',
    wsId
      ? `SELECT origin, trust_scope AS scope, workspace_id, created_at FROM agentsam_browser_trusted_origin WHERE workspace_id = ? OR workspace_id IS NULL OR workspace_id = '' ORDER BY origin LIMIT 200`
      : `SELECT origin, trust_scope AS scope, workspace_id, created_at FROM agentsam_browser_trusted_origin ORDER BY origin LIMIT 200`,
    wsId ? [wsId] : [],
    warnings,
    cache,
  );

  const workspaceDomains = await safeQueryAll(
    db,
    'workspace_domains',
    wsId
      ? `SELECT workspace_id, domain, status, verified_at, created_at FROM workspace_domains WHERE workspace_id = ? ORDER BY domain`
      : `SELECT workspace_id, domain, status, verified_at, created_at FROM workspace_domains ORDER BY workspace_id, domain LIMIT 200`,
    wsId ? [wsId] : [],
    warnings,
    cache,
  );

  const integrationEndpoints = await safeQueryAll(
    db,
    'integration_registry',
    `SELECT provider_key AS slug, display_name, account_display AS base_url, auth_type, is_enabled AS is_active, status
     FROM integration_registry
     ORDER BY display_name LIMIT 200`,
    [],
    warnings,
    cache,
  );

  return envelope('network', {
    summary: {
      fetch_allowlist_count: fetchAllowlist.length,
      trusted_origins_count: trustedOrigins.length,
      workspace_domains_count: workspaceDomains.length,
      integration_endpoints_count: integrationEndpoints.length,
      worker_base_url: env.WORKER_BASE_URL || null,
    },
    rows: workspaceDomains,
    warnings,
    actions: [
      {
        key: 'add_domain',
        label: 'Add workspace domain',
        enabled: true,
      },
      {
        key: 'add_trusted_origin',
        label: 'Add trusted origin',
        enabled: false,
        reasonDisabled:
          'Add trusted origin is disabled until a validation endpoint is wired.',
      },
    ],
    extra: {
      fetch_allowlist: fetchAllowlist,
      trusted_origins: trustedOrigins,
      integration_endpoints: integrationEndpoints,
    },
  });
}


export { getNetwork, addWorkspaceDomain, removeWorkspaceDomain };
