/**
 * CF Stack Wizard — enumerate D1 / Workers / Tunnels via user's Cloudflare OAuth token.
 */
import { jsonResponse } from '../../core/auth.js';
import { getIntegrationOAuthRow } from '../../../backend/identity/oauth/user-token.js';
import { resolveIntegrationUserId } from '../../../backend/identity/oauth/integration-user-id.js';
import { userCanAccessWorkspace } from '../../core/workspace-access.js';
import {
  buildAccountCloudflareSnapshot,
  persistUserCfStackSettings,
} from '../../core/account-cloudflare-context.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function looksLikeCfAccountId(v) {
  const s = trim(v);
  return /^[a-f0-9]{32}$/i.test(s);
}

function parseJsonObject(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function cfFetch(token, url) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function getCfOAuthRow(env, authUser) {
  const userId = await resolveIntegrationUserId(env, authUser);
  if (!userId) return { userId: null, row: null, token: null };
  const row = await getIntegrationOAuthRow(env, userId, 'cloudflare', '');
  const token = row?.access_token ? String(row.access_token).trim() : null;
  return { userId, row, token };
}

async function cfListAccounts(token) {
  const data = await cfFetch(token, 'https://api.cloudflare.com/client/v4/accounts?per_page=50');
  const accounts = Array.isArray(data?.result) ? data.result : [];
  return accounts
    .map((a) => ({ id: trim(a?.id), name: trim(a?.name) || trim(a?.id) }))
    .filter((a) => a.id);
}

function storedAccountOverride(row) {
  const fromIdentifier = trim(row?.account_identifier);
  if (looksLikeCfAccountId(fromIdentifier)) return fromIdentifier;

  const meta = parseJsonObject(row?.metadata_json);
  const fromMeta =
    trim(meta.cloudflare_account_id) ||
    trim(meta.account_id) ||
    trim(meta.cf_account_id);
  if (looksLikeCfAccountId(fromMeta)) return fromMeta;

  return null;
}

/**
 * Resolve which Cloudflare account to operate against — no silent guessing.
 *
 * - A previously saved/stored override always wins (the user already chose it).
 * - Zero or one account on the token resolves automatically.
 * - Multiple accounts: default to the platform's own CLOUDFLARE_ACCOUNT_ID when it's
 *   one of the accounts the token can see; otherwise the caller must pick explicitly.
 *
 * @returns {Promise<{ accounts: Array<{id:string,name:string}>, account_id: string|null, needs_selection: boolean }>}
 */
async function resolveCfAccountSelection(env, token, row, explicitAccountId) {
  const accounts = await cfListAccounts(token);

  const explicit = trim(explicitAccountId);
  if (explicit && (accounts.length === 0 || accounts.some((a) => a.id === explicit))) {
    return { accounts, account_id: explicit, needs_selection: false };
  }

  const stored = storedAccountOverride(row);
  if (stored && (accounts.length === 0 || accounts.some((a) => a.id === stored))) {
    return { accounts, account_id: stored, needs_selection: false };
  }

  if (accounts.length === 0) {
    return { accounts, account_id: null, needs_selection: false };
  }
  if (accounts.length === 1) {
    return { accounts, account_id: accounts[0].id, needs_selection: false };
  }

  const platformAccountId = trim(env?.CLOUDFLARE_ACCOUNT_ID);
  if (platformAccountId && accounts.some((a) => a.id === platformAccountId)) {
    return { accounts, account_id: platformAccountId, needs_selection: false };
  }

  return { accounts, account_id: null, needs_selection: true };
}

/** Thin resolver for callers (e.g. save) that already trust a saved/explicit account. */
async function resolveCfAccountId(env, token, row, explicitAccountId) {
  const { account_id } = await resolveCfAccountSelection(env, token, row, explicitAccountId);
  return account_id;
}

async function readWorkspaceSettingsJson(env, workspaceId) {
  const wid = trim(workspaceId);
  if (!wid || !env?.DB) return {};
  const row = await env.DB.prepare(
    `SELECT settings_json FROM workspace_settings WHERE workspace_id = ? LIMIT 1`,
  )
    .bind(wid)
    .first()
    .catch(() => null);
  return parseJsonObject(row?.settings_json);
}

async function mergeWorkspaceSettingsJson(env, workspaceId, patch) {
  const wid = trim(workspaceId);
  if (!wid || !env?.DB) return {};
  const current = await readWorkspaceSettingsJson(env, wid);
  const next = { ...current, ...patch };
  const json = JSON.stringify(next);
  await env.DB.prepare(
    `INSERT INTO workspace_settings (workspace_id, settings_json, updated_at)
     VALUES (?, ?, unixepoch())
     ON CONFLICT(workspace_id) DO UPDATE SET
       settings_json = excluded.settings_json,
       updated_at = excluded.updated_at`,
  )
    .bind(wid, json)
    .run();
  return next;
}

/**
 * POST /api/integrations/cloudflare_oauth/stack/enumerate
 * Body: { account_id?: string } — explicit pick from a prior accounts response.
 */
export async function handleCfStackEnumerate(env, authUser, body) {
  const { userId, row, token } = await getCfOAuthRow(env, authUser);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!token) return jsonResponse({ error: 'cloudflare_not_connected' }, 401);

  const { accounts, account_id: accountId, needs_selection } = await resolveCfAccountSelection(
    env,
    token,
    row,
    body?.account_id,
  );

  if (needs_selection) {
    return jsonResponse({
      accounts,
      needs_account_selection: true,
      error: 'cloudflare_account_selection_required',
    });
  }
  if (!accountId) return jsonResponse({ error: 'cloudflare_account_id_missing' }, 400);

  const [d1, workers, tunnels] = await Promise.all([
    cfFetch(
      token,
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database?per_page=50`,
    ),
    cfFetch(
      token,
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
    ),
    cfFetch(
      token,
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel?per_page=20`,
    ),
  ]);

  return jsonResponse({
    accounts,
    account_id: accountId,
    d1_databases: (d1?.result || []).map((db) => ({
      id: db.uuid || db.id,
      name: db.name,
    })),
    workers: (workers?.result || []).map((w) => ({ id: w.id, name: w.id })),
    tunnels: (tunnels?.result || []).map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
    })),
  });
}

/**
 * POST /api/integrations/cloudflare_oauth/stack/save
 * User-scoped SSOT (user_settings.cf_stack). workspace_id is optional soft mirror for deploy SSOT.
 */
export async function handleCfStackSave(env, authUser, body) {
  const { userId, row, token } = await getCfOAuthRow(env, authUser);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!token) return jsonResponse({ error: 'cloudflare_not_connected' }, 401);

  const workspace_id = trim(body?.workspace_id);
  if (workspace_id) {
    const okWs = await userCanAccessWorkspace(env, authUser, workspace_id);
    if (!okWs) return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const d1_database_id = trim(body?.d1_database_id);
  const worker_name = trim(body?.worker_name);
  const tunnel_id = trim(body?.tunnel_id);
  const account_id = trim(body?.account_id);

  if (d1_database_id) {
    const accountId = account_id || (await resolveCfAccountId(env, token, row));
    if (!accountId) return jsonResponse({ error: 'cloudflare_account_id_missing' }, 400);
    const check = await cfFetch(
      token,
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${d1_database_id}`,
    );
    if (!check?.success) return jsonResponse({ error: 'd1_not_found' }, 400);
  }

  const stackPatch = {
    ...(account_id && { cf_account_id: account_id }),
    ...(d1_database_id && { cf_d1_database_id: d1_database_id }),
    ...(body?.d1_database_name && { cf_d1_database_name: String(body.d1_database_name).trim() }),
    ...(worker_name && { cf_worker_name: worker_name }),
    ...(tunnel_id && { cf_tunnel_id: tunnel_id }),
    ...(body?.tunnel_name && { cf_tunnel_name: String(body.tunnel_name).trim() }),
    cf_stack_configured_at: Date.now(),
    cf_stack_configured_by: userId,
  };

  // Account-wide SSOT — always write user_settings first.
  await persistUserCfStackSettings(env, userId, stackPatch);

  // Soft mirror into the active workspace when provided (deploy / worker_name column).
  if (workspace_id) {
    if (worker_name) {
      const { setAgentsamWorkspaceWorkerName } = await import('../../../backend/identity/workspace/worker-name.js');
      const wnResult = await setAgentsamWorkspaceWorkerName(env, workspace_id, worker_name);
      if (!wnResult?.ok) {
        return jsonResponse(
          { error: 'worker_name_persist_failed', reason: wnResult?.reason || 'unknown' },
          wnResult?.reason === 'worker_name_in_use' ? 409 : 500,
        );
      }
    }
    const current = await readWorkspaceSettingsJson(env, workspace_id);
    await mergeWorkspaceSettingsJson(env, workspace_id, { ...current, ...stackPatch });
  }

  return jsonResponse({
    ok: true,
    workspace_id: workspace_id || null,
    saved: Object.keys(stackPatch),
    account_wide: true,
  });
}

/**
 * GET /api/integrations/cloudflare/context — account-wide CF credential snapshot.
 */
export async function handleCfAccountContext(env, authUser) {
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  const snapshot = await buildAccountCloudflareSnapshot(env, authUser);
  return jsonResponse(snapshot);
}
