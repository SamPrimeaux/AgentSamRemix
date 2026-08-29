/**
 * API Service: Data-Backed Settings Sections
 *
 * Provides normalized read-only `GET /api/settings/{section}` endpoints for the
 * Settings panel. Each endpoint returns the shape:
 *
 *   {
 *     ok: boolean,
 *     generated_at: number,
 *     section: string,
 *     summary: Record<string, unknown>,
 *     rows: T[],
 *     warnings: Array<{ code, message, severity, table?, provider?, suggestedAction? }>,
 *     actions?: Array<{ key, label, enabled, reasonDisabled? }>,
 *     providers?: Array<ProviderConnectionState>,
 *   }
 *
 * Rules:
 * - Use existing D1 tables only. No schema creation.
 * - If a source table is missing, append a SOURCE_TABLE_NOT_FOUND warning and return empty rows.
 * - Never expose secret values. Token / key columns are stripped or masked.
 * - Disabled actions must include reasonDisabled.
 */

import { jsonResponse } from '../../agentsam/shared.js';
import { getNetwork, addWorkspaceDomain, removeWorkspaceDomain } from './network.js';
import { getNotifications, patchNotificationPreferences, postNotificationTest } from './notifications.js';
import { getGithub, postGithubReindex } from './github.js';
import { getStorageStatus } from './storage.js';
import { getIndexRules, putIndexRules, postIndexRulesPreview } from './index-rules.js';
import {
  getCicd,
  getDocs,
  getThemesStatus,
  getHooksStatus,
  getBillingStatus,
  getToolsStatus,
  getIntegrationsStatus,
} from './status.js';


export async function handleSettingsSectionStatusRoutes(request, env, authUser, url, pathLower, method, ctx = null) {
  if (!env?.DB) return null;
  if (!authUser) return null;

  if (pathLower === '/api/settings/network/domains') {
    try {
      if (method === 'POST') return await addWorkspaceDomain(request, env, authUser, url);
      if (method === 'DELETE') return await removeWorkspaceDomain(request, env, authUser, url);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    } catch (e) {
      return jsonResponse({ error: e?.message || String(e) }, 500);
    }
  }

  if (pathLower === '/api/settings/github/reindex' && method === 'POST') {
    try {
      return await postGithubReindex(request, env, authUser, url, ctx);
    } catch (e) {
      return jsonResponse({ error: e?.message || String(e) }, 500);
    }
  }

  if (pathLower === '/api/settings/indexrules' && method === 'GET') {
    try {
      return await getIndexRules(env, authUser, url.searchParams.get('repo'));
    } catch (e) {
      return jsonResponse({ error: e?.message || String(e) }, 500);
    }
  }

  if (pathLower === '/api/settings/indexrules' && method === 'PUT') {
    try {
      return await putIndexRules(request, env, authUser);
    } catch (e) {
      return jsonResponse({ error: e?.message || String(e) }, 500);
    }
  }

  if (pathLower === '/api/settings/indexrules/preview' && method === 'POST') {
    try {
      return await postIndexRulesPreview(request, env, authUser);
    } catch (e) {
      return jsonResponse({ error: e?.message || String(e) }, 500);
    }
  }

  if (pathLower === '/api/settings/notifications' && method === 'PATCH') {
    try {
      return await patchNotificationPreferences(request, env, authUser);
    } catch (e) {
      return jsonResponse({ error: e?.message || String(e) }, 500);
    }
  }

  if (pathLower === '/api/settings/notifications/test' && method === 'POST') {
    try {
      return await postNotificationTest(request, env, authUser, ctx);
    } catch (e) {
      return jsonResponse({ error: e?.message || String(e) }, 500);
    }
  }

  if (method !== 'GET') return null;

  const wsParam = url.searchParams.get('workspace_id');
  const workspaceId = wsParam != null && String(wsParam).trim() !== '' ? String(wsParam).trim() : null;

  try {
    if (pathLower === '/api/settings/cicd') return jsonResponse(await getCicd(env, authUser, workspaceId));
    if (pathLower === '/api/settings/network')
      return jsonResponse(await getNetwork(env, authUser, workspaceId));
    if (pathLower === '/api/settings/notifications')
      return jsonResponse(await getNotifications(env, authUser));
    if (pathLower === '/api/settings/docs')
      return jsonResponse(await getDocs(env, authUser, workspaceId));
    if (pathLower === '/api/settings/github') return jsonResponse(await getGithub(env, authUser, workspaceId));
    if (pathLower === '/api/settings/themes/status')
      return jsonResponse(await getThemesStatus(env, authUser, workspaceId));
    if (pathLower === '/api/settings/hooks/status') return jsonResponse(await getHooksStatus(env));
    if (pathLower === '/api/settings/billing/status')
      return jsonResponse(await getBillingStatus(env, authUser, workspaceId));
    if (pathLower === '/api/settings/tools/status')
      return jsonResponse(await getToolsStatus(env, authUser, workspaceId));
    if (pathLower === '/api/settings/storage/status')
      return jsonResponse(await getStorageStatus(env, authUser, workspaceId));
    if (pathLower === '/api/settings/integrations/status')
      return jsonResponse(await getIntegrationsStatus(env, authUser));
  } catch (e) {
    return jsonResponse(
      {
        ok: false,
        section: pathLower,
        error: e?.message || String(e),
        warnings: [
          {
            code: 'SECTION_HANDLER_FAILED',
            message: `Section handler crashed: ${e?.message || String(e)}`,
            severity: 'critical',
          },
        ],
      },
      500,
    );
  }

  return null;
}

// Suppress unused export warnings for helpers that are exported for tests.
