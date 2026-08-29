/**
 * DesignStudio API — modular entry (worker + src/index).
 * SSE live stream is owned by AGENT_SESSION DO; this module only proxies GET .../events.
 */
import {
  getAuthUser,
  jsonResponse,
  fetchAuthUserTenantId,
  fallbackSystemTenantId,
  resolveRequestContext,
} from '../../core/auth.js';
import { verifyBridgeKey } from '../../../backend/auth/bridge-key-auth.js';
import { syncRunToSupabase, buildCadCreationsPrefix } from './sync.js';
import { handleDesignStudioScenesApi } from './scenes.js';
import { normalizeGlbPublicUrl } from '../../core/glb-public-url.js';

const CMS_ASSETS = 'cms_assets';

const WORKFLOW_RUNS = 'agentsam_workflow_runs';
const BLUEPRINTS = 'designstudio_design_blueprints';
const WORKFLOWS = 'agentsam_workflows';
const WORKSPACE_TABLE = 'agentsam_workspace';

function internalSecretOk(request, env) {
  return verifyBridgeKey(request, env);
}

function parseCmsAssetMetadata(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_) {
    return {};
  }
}

function mapDesignStudioAssetRow(row) {
  const meta = parseCmsAssetMetadata(row?.metadata);
  const scaleRaw = meta.scale;
  const scale =
    typeof scaleRaw === 'number' && Number.isFinite(scaleRaw)
      ? scaleRaw
      : Number(scaleRaw);
  const thumbnailUrl =
    row.thumbnail_url != null && String(row.thumbnail_url).trim() !== ''
      ? String(row.thumbnail_url).trim()
      : meta.thumbnail_url != null && String(meta.thumbnail_url).trim() !== ''
        ? String(meta.thumbnail_url).trim()
        : meta.preview_url != null && String(meta.preview_url).trim() !== ''
          ? String(meta.preview_url).trim()
          : null;
  return {
    id: String(row.id),
    label:
      meta.label != null && String(meta.label).trim() !== ''
        ? String(meta.label).trim()
        : String(row.filename || row.id),
    public_url: normalizeGlbPublicUrl(row.public_url),
    thumbnail_url: thumbnailUrl,
    icon: meta.icon != null ? String(meta.icon) : null,
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    tags: row.tags ?? null,
    created_at: row.created_at ?? null,
  };
}

function filenameFromPublicUrl(publicUrl, fallbackLabel) {
  try {
    const u = new URL(publicUrl, 'https://inneranimalmedia.com');
    const base = u.pathname.split('/').pop();
    if (base && base.includes('.')) return base;
  } catch (_) {
    /* ignore */
  }
  const safe = String(fallbackLabel || 'asset')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80);
  return safe.endsWith('.glb') ? safe : `${safe || 'asset'}.glb`;
}

async function resolveTenantId(env, authUser) {
  if (authUser.tenant_id != null && String(authUser.tenant_id).trim() !== '') {
    return String(authUser.tenant_id).trim();
  }
  let tid = await fetchAuthUserTenantId(env, authUser.id);
  if (tid) return tid;
  if (authUser.email) {
    tid = await fetchAuthUserTenantId(env, authUser.email);
    if (tid) return tid;
  }
  return fallbackSystemTenantId(env);
}

function supabaseRestBase(env) {
  const raw = env?.SUPABASE_URL;
  if (!raw || !String(raw).trim()) throw new Error('SUPABASE_URL is not configured');
  return String(raw).replace(/\/$/, '');
}

function supabasePublicHeaders(env, extra = {}) {
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !String(key).trim()) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  const k = String(key).trim();
  return {
    apikey: k,
    Authorization: `Bearer ${k}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extra,
  };
}

async function sha256hex(message) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacBytes(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function hmacHex(key, message) {
  const bytes = await hmacBytes(key, message);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getSigningKey(secret, date, region, service) {
  const kDate = await hmacBytes('AWS4' + secret, date);
  const kRegion = await hmacBytes(kDate, region);
  const kService = await hmacBytes(kRegion, service);
  return hmacBytes(kService, 'aws4_request');
}

function getR2S3Host(env) {
  if (!env.CLOUDFLARE_ACCOUNT_ID) return null;
  return `${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

async function presignR2GetObjectUrl(env, bucket, key, expiresSeconds = 3600) {
  const accessKey = env.R2_ACCESS_KEY_ID;
  const secretKey = env.R2_SECRET_ACCESS_KEY;
  const host = getR2S3Host(env);
  if (!accessKey || !secretKey || !host) return null;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const encodedKey = String(key)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');

  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  });

  const sortedPairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const canonicalQueryString = sortedPairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const canonicalRequest = [
    'GET',
    `/${bucket}/${encodedKey}`,
    canonicalQueryString,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256hex(canonicalRequest)].join('\n');
  const signingKey = await getSigningKey(secretKey, dateStamp, 'auto', 's3');
  const signature = await hmacHex(signingKey, stringToSign);

  return `https://${host}/${bucket}/${encodedKey}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 * @param {any} _ctx
 */
export async function handleDesignStudioApi(request, url, env, _ctx) {
  const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = (request.method || 'GET').toUpperCase();

  try {
    const scenesRes = await handleDesignStudioScenesApi(request, url, env);
    if (scenesRes) return scenesRes;

    const assetOneMatch = pathLower.match(/^\/api\/designstudio\/assets\/([^/]+)$/);

    if (pathLower === '/api/designstudio/assets' && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);

      const category = (url.searchParams.get('category') || '').trim();
      if (!category) return jsonResponse({ error: 'category required' }, 400);

      const isLiveParam = url.searchParams.get('is_live');
      let sql = `SELECT id, filename, tags, public_url, thumbnail_url, metadata, category, created_by, created_at
        FROM ${CMS_ASSETS}
        WHERE category = ?`;
      const binds = [category];
      if (isLiveParam === '1') {
        sql += ' AND is_live = 1';
      }
      if (category === '3d_studio_user') {
        sql += ' AND created_by = ?';
        binds.push(String(authUser.id));
      }
      sql += ' ORDER BY created_at ASC';

      const { results } = await env.DB.prepare(sql).bind(...binds).all();
      const seen = new Set();
      const mapped = [];
      for (const row of results || []) {
        const item = mapDesignStudioAssetRow(row);
        const dedupeKey = String(item.public_url || '').trim().toLowerCase();
        if (!dedupeKey || seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        mapped.push(item);
      }
      return jsonResponse({ results: mapped }, 200);
    }

    if (pathLower === '/api/designstudio/assets' && method === 'POST') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);

      let body = {};
      try {
        body = await request.json();
      } catch (_) {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
      }

      const label = String(body.label || body.name || '').trim();
      const publicUrl = String(body.public_url || body.url || '').trim();
      if (!label) return jsonResponse({ error: 'label required' }, 400);
      if (!publicUrl) return jsonResponse({ error: 'public_url required' }, 400);

      const tenantId = await resolveTenantId(env, authUser);
      const assetId = `ds_user_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const filename = filenameFromPublicUrl(publicUrl, label);
      const scaleRaw = body.scale;
      const scale =
        typeof scaleRaw === 'number' && Number.isFinite(scaleRaw) && scaleRaw > 0
          ? scaleRaw
          : 1;
      const metadata = JSON.stringify({
        label,
        icon: body.icon != null ? String(body.icon) : 'link',
        scale,
      });
      let pathValue = publicUrl;
      try {
        pathValue = new URL(publicUrl, 'https://inneranimalmedia.com').pathname || publicUrl;
      } catch (_) {
        /* keep raw */
      }

      await env.DB.prepare(
        `INSERT INTO ${CMS_ASSETS} (
          id, tenant_id, filename, original_filename, path, size, mime_type, category,
          tags, r2_key, public_url, metadata, created_by, is_live, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
      )
        .bind(
          assetId,
          tenantId,
          filename,
          filename,
          pathValue,
          0,
          'model/gltf-binary',
          '3d_studio_user',
          'designstudio,user',
          pathValue,
          publicUrl,
          metadata,
          String(authUser.id),
        )
        .run();

      return jsonResponse(
        {
          ok: true,
          asset: mapDesignStudioAssetRow({
            id: assetId,
            filename,
            public_url: publicUrl,
            metadata,
            tags: 'designstudio,user',
          }),
        },
        201,
      );
    }

    if (assetOneMatch && method === 'DELETE') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);

      const assetId = assetOneMatch[1];
      const row = await env.DB.prepare(
        `SELECT id, category, created_by FROM ${CMS_ASSETS} WHERE id = ? LIMIT 1`,
      )
        .bind(assetId)
        .first();
      if (!row) return jsonResponse({ error: 'Not found' }, 404);
      if (String(row.category) !== '3d_studio_user') {
        return jsonResponse({ error: 'Only user assets may be deleted' }, 403);
      }
      if (String(row.created_by) !== String(authUser.id)) {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }

      await env.DB.prepare(`DELETE FROM ${CMS_ASSETS} WHERE id = ?`).bind(assetId).run();
      return jsonResponse({ ok: true, id: assetId }, 200);
    }

    const eventsMatch = pathLower.match(/^\/api\/designstudio\/runs\/([^/]+)\/events$/);
    if (eventsMatch && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
      const runId = eventsMatch[1];
      const tenantId = await resolveTenantId(env, authUser);
      let run = await env.DB.prepare(
        `SELECT r.id, r.session_id
         FROM ${WORKFLOW_RUNS} r
         INNER JOIN ${WORKSPACE_TABLE} w ON w.id = r.workspace_id
         WHERE r.id = ? AND w.tenant_id = ?
         LIMIT 1`,
      )
        .bind(runId, tenantId)
        .first();
      if (!run) {
        const userId = authUser.id != null ? String(authUser.id).trim() : '';
        if (userId) {
          run = await env.DB.prepare(
            `SELECT id, conversation_id AS session_id
             FROM agentsam_agent_run
             WHERE id = ? AND user_id = ? AND tenant_id = ?
             LIMIT 1`,
          )
            .bind(runId, userId, tenantId)
            .first();
        }
      }
      if (!run) {
        return jsonResponse({ error: 'Not found' }, 404);
      }
      let sessionId = (url.searchParams.get('session_id') || '').trim();
      if (!sessionId && run.session_id) sessionId = String(run.session_id).trim();
      if (!sessionId) {
        return jsonResponse({ error: 'session_id required' }, 400);
      }
      if (!env.AGENT_SESSION) return jsonResponse({ error: 'AGENT_SESSION not configured' }, 503);
      const stub = env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(sessionId));
      const doUrl = new URL(request.url);
      doUrl.pathname = '/designstudio/events';
      doUrl.search = '';
      doUrl.searchParams.set('run_id', runId);
      const lastId = url.searchParams.get('last_id');
      if (lastId) doUrl.searchParams.set('last_id', lastId);
      return stub.fetch(new Request(doUrl.toString(), { headers: request.headers }));
    }

    if (pathLower === '/api/designstudio/blueprints' && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
      const tenantId = await resolveTenantId(env, authUser);
      const statusFilter = (url.searchParams.get('status') || '').trim();
      const limitRaw = parseInt(url.searchParams.get('limit') || '50', 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
      let sql = `SELECT * FROM ${BLUEPRINTS} WHERE tenant_id = ?`;
      const binds = [tenantId];
      if (statusFilter) {
        sql += ` AND status = ?`;
        binds.push(statusFilter);
      }
      sql += ` ORDER BY created_at DESC LIMIT ?`;
      binds.push(limit);
      const { results } = await env.DB.prepare(sql).bind(...binds).all();
      return jsonResponse({ blueprints: results || [] }, 200);
    }

    if (pathLower === '/api/designstudio/blueprints' && method === 'POST') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
      const tenantId = await resolveTenantId(env, authUser);
      let body = {};
      try {
        body = await request.json();
      } catch (_) {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
      }
      const title = String(body.title || '').trim();
      if (!title) return jsonResponse({ error: 'title required' }, 400);
      const reqCtx = await resolveRequestContext(request, env);
      if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
      const workspaceId = reqCtx.workspaceId || '';
      if (!workspaceId) return jsonResponse({ error: 'workspace required' }, 400);
      const sketchJson =
        typeof body.sketch_json === 'object' && body.sketch_json !== null
          ? JSON.stringify(body.sketch_json)
          : typeof body.sketch_json === 'string'
            ? body.sketch_json
            : '{}';
      const tagsJson = Array.isArray(body.tags)
        ? JSON.stringify(body.tags)
        : typeof body.tags === 'string'
          ? body.tags
          : '[]';
      const row = await env.DB.prepare(
        `INSERT INTO ${BLUEPRINTS}
           (tenant_id, workspace_id, title, description, original_prompt, sketch_json, tags, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
         RETURNING *`,
      )
        .bind(
          tenantId,
          workspaceId,
          title,
          body.description != null ? String(body.description) : null,
          body.original_prompt != null ? String(body.original_prompt) : null,
          sketchJson,
          tagsJson,
        )
        .first();
      return jsonResponse({ blueprint: row }, 201);
    }

    const bpOneMatch = pathLower.match(/^\/api\/designstudio\/blueprints\/([^/]+)$/);
    if (bpOneMatch && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
      const tenantId = await resolveTenantId(env, authUser);
      const row = await env.DB.prepare(`SELECT * FROM ${BLUEPRINTS} WHERE id = ? AND tenant_id = ?`)
        .bind(bpOneMatch[1], tenantId)
        .first();
      if (!row) return jsonResponse({ error: 'Not found' }, 404);
      return jsonResponse({ blueprint: row }, 200);
    }

    if (bpOneMatch && method === 'PATCH') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
      const tenantId = await resolveTenantId(env, authUser);
      let body = {};
      try {
        body = await request.json();
      } catch (_) {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
      }
      const existing = await env.DB.prepare(`SELECT id FROM ${BLUEPRINTS} WHERE id = ? AND tenant_id = ?`)
        .bind(bpOneMatch[1], tenantId)
        .first();
      if (!existing) return jsonResponse({ error: 'Not found' }, 404);
      const sets = [];
      const vals = [];
      const push = (col, v) => {
        sets.push(`${col} = ?`);
        vals.push(v);
      };
      if (body.title != null) push('title', String(body.title));
      if (body.description !== undefined) push('description', body.description != null ? String(body.description) : null);
      if (body.original_prompt !== undefined) push('original_prompt', body.original_prompt != null ? String(body.original_prompt) : null);
      if (body.intent_json !== undefined) {
        push(
          'intent_json',
          typeof body.intent_json === 'object' ? JSON.stringify(body.intent_json) : String(body.intent_json || '{}'),
        );
      }
      if (body.sketch_json !== undefined) {
        push(
          'sketch_json',
          typeof body.sketch_json === 'object' ? JSON.stringify(body.sketch_json) : String(body.sketch_json || '{}'),
        );
      }
      if (body.tags !== undefined) {
        push(
          'tags',
          Array.isArray(body.tags) ? JSON.stringify(body.tags) : String(body.tags ?? '[]'),
        );
      }
      if (body.notes !== undefined) push('notes', body.notes != null ? String(body.notes) : null);
      if (body.cad_script !== undefined) push('cad_script', body.cad_script != null ? String(body.cad_script) : null);
      if (body.cad_engine !== undefined) push('cad_engine', body.cad_engine != null ? String(body.cad_engine) : null);
      if (body.preview_image_url !== undefined) {
        push(
          'preview_image_url',
          body.preview_image_url != null && String(body.preview_image_url).trim() !== ''
            ? String(body.preview_image_url).trim()
            : null,
        );
      }
      if (body.preview_svg_url !== undefined) {
        push(
          'preview_svg_url',
          body.preview_svg_url != null && String(body.preview_svg_url).trim() !== ''
            ? String(body.preview_svg_url).trim()
            : null,
        );
      }
      if (body.latest_asset_id !== undefined) {
        push(
          'latest_asset_id',
          body.latest_asset_id != null && String(body.latest_asset_id).trim() !== ''
            ? String(body.latest_asset_id).trim()
            : null,
        );
      }
      if (body.status != null) push('status', String(body.status));
      if (!sets.length) return jsonResponse({ error: 'No fields to update' }, 400);
      sets.push(`updated_at = datetime('now')`);
      vals.push(bpOneMatch[1], tenantId);
      await env.DB.prepare(`UPDATE ${BLUEPRINTS} SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals).run();
      const row = await env.DB.prepare(`SELECT * FROM ${BLUEPRINTS} WHERE id = ?`).bind(bpOneMatch[1]).first();
      return jsonResponse({ blueprint: row }, 200);
    }

    if (pathLower === '/api/designstudio/runs' && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
      const tenantId = await resolveTenantId(env, authUser);
      const blueprintId = (url.searchParams.get('blueprint_id') || '').trim();
      const limitRaw = parseInt(url.searchParams.get('limit') || '20', 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
      let sql = `SELECT r.* FROM ${WORKFLOW_RUNS} r
        INNER JOIN ${WORKSPACE_TABLE} w ON w.id = r.workspace_id
        WHERE w.tenant_id = ? AND r.workflow_key LIKE 'designstudio%'`;
      const binds = [tenantId];
      if (blueprintId) {
        sql += ` AND json_extract(r.input_json, '$.blueprint_id') = ?`;
        binds.push(blueprintId);
      }
      sql += ` ORDER BY r.started_at DESC LIMIT ?`;
      binds.push(limit);
      const { results } = await env.DB.prepare(sql).bind(...binds).all();
      return jsonResponse({ runs: results || [] }, 200);
    }

    if (pathLower === '/api/designstudio/runs' && method === 'POST') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
      const tenantId = await resolveTenantId(env, authUser);
      const userId = authUser.id != null ? String(authUser.id).trim() : null;
      let body = {};
      try {
        body = await request.json();
      } catch (_) {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
      }
      const blueprintId = String(body.blueprint_id || '').trim();
      if (!blueprintId) return jsonResponse({ error: 'blueprint_id required' }, 400);
      const blueprint = await env.DB.prepare(
        `SELECT * FROM ${BLUEPRINTS} WHERE id = ? AND tenant_id = ? LIMIT 1`,
      )
        .bind(blueprintId, tenantId)
        .first();
      if (!blueprint) return jsonResponse({ error: 'Not found' }, 404);
      const wf = await env.DB.prepare(
        `SELECT id, workflow_key FROM ${WORKFLOWS}
         WHERE workflow_key LIKE 'designstudio%' AND COALESCE(is_active, 0) = 1
         LIMIT 1`,
      ).first();
      if (!wf?.id || !wf.workflow_key) {
        return jsonResponse({ error: 'No active DesignStudio workflow configured' }, 503);
      }
      const reqCtx = await resolveRequestContext(request, env);
      if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
      const workspaceId = reqCtx.workspaceId || '';
      if (!workspaceId) return jsonResponse({ error: 'workspace required' }, 400);
      const inputPayload = {
        blueprint_id: blueprintId,
        prompt: blueprint.original_prompt != null ? String(blueprint.original_prompt) : null,
      };
      const inputJson = JSON.stringify(inputPayload);
      const inserted = await env.DB.prepare(
        `INSERT INTO ${WORKFLOW_RUNS}
           (workflow_id, workflow_key, tenant_id, user_id, workspace_id,
            trigger_type, status, input_json, started_at, environment)
         VALUES (?, ?, ?, ?, ?, 'user', 'running', ?, unixepoch(), 'production')
         RETURNING id`,
      )
        .bind(
          String(wf.id),
          String(wf.workflow_key),
          tenantId,
          userId,
          workspaceId,
          inputJson,
        )
        .first();
      const newRunId = inserted?.id != null ? String(inserted.id) : null;
      if (!newRunId) return jsonResponse({ error: 'run_insert_failed' }, 500);
      await env.DB.prepare(
        `UPDATE ${BLUEPRINTS} SET latest_run_id = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
      )
        .bind(newRunId, blueprintId, tenantId)
        .run();
      return jsonResponse({ run_id: newRunId, status: 'running' }, 202);
    }

    const runOneMatch = pathLower.match(/^\/api\/designstudio\/runs\/([^/]+)$/);
    if (runOneMatch && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
      const tenantId = await resolveTenantId(env, authUser);
      const rid = runOneMatch[1];
      const row = await env.DB.prepare(
        `SELECT r.* FROM ${WORKFLOW_RUNS} r
         INNER JOIN ${WORKSPACE_TABLE} w ON w.id = r.workspace_id
         WHERE r.id = ? AND w.tenant_id = ?
         LIMIT 1`,
      )
        .bind(rid, tenantId)
        .first();
      if (!row) return jsonResponse({ error: 'Not found' }, 404);
      return jsonResponse({ run: row }, 200);
    }

    const presignMatch = pathLower.match(/^\/api\/designstudio\/assets\/([^/]+)\/presign\/([^/]+)$/);
    if (presignMatch && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
      const tenantId = await resolveTenantId(env, authUser);
      const runId = presignMatch[1];
      const assetType = presignMatch[2];
      const run = await env.DB.prepare(
        `SELECT r.id FROM ${WORKFLOW_RUNS} r
         INNER JOIN ${WORKSPACE_TABLE} w ON w.id = r.workspace_id
         WHERE r.id = ? AND w.tenant_id = ?
         LIMIT 1`,
      )
        .bind(runId, tenantId)
        .first();
      if (!run) return jsonResponse({ error: 'Not found' }, 404);
      const base = supabaseRestBase(env);
      const res = await fetch(
        `${base}/rest/v1/designstudio_asset_metrics?workflow_run_id=eq.${encodeURIComponent(runId)}&asset_type=eq.${encodeURIComponent(
          assetType,
        )}&select=*`,
        { headers: supabasePublicHeaders(env) },
      );
      const text = await res.text();
      let rows = [];
      try {
        rows = text ? JSON.parse(text) : [];
      } catch (_) {
        rows = [];
      }
      const asset = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (!asset || !asset.r2_key) {
        return jsonResponse({ error: 'Not found' }, 404);
      }
      const key = String(asset.r2_key);
      const bucket = (url.searchParams.get('bucket') || '').trim() || 'autorag';
      const signed = await presignR2GetObjectUrl(env, bucket, key, 3600);
      if (!signed) {
        return jsonResponse({ error: 'presign_unavailable', r2_key: key, bucket }, 503);
      }
      return jsonResponse({ url: signed, r2_key: key, expires_in: 3600 }, 200);
    }

    const assetsMatch = pathLower.match(/^\/api\/designstudio\/assets\/([^/]+)$/);
    if (assetsMatch && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
      const tenantId = await resolveTenantId(env, authUser);
      const runId = assetsMatch[1];
      const run = await env.DB.prepare(
        `SELECT r.id FROM ${WORKFLOW_RUNS} r
         INNER JOIN ${WORKSPACE_TABLE} w ON w.id = r.workspace_id
         WHERE r.id = ? AND w.tenant_id = ?
         LIMIT 1`,
      )
        .bind(runId, tenantId)
        .first();
      if (!run) return jsonResponse({ error: 'Not found' }, 404);
      const reqCtx = await resolveRequestContext(request, env);
      const ws =
        (url.searchParams.get('workspace_id') || '').trim() ||
        (reqCtx.error ? '' : reqCtx.workspaceId || '');
      try {
        const base = supabaseRestBase(env);
        const res = await fetch(
          `${base}/rest/v1/designstudio_asset_metrics?workflow_run_id=eq.${encodeURIComponent(runId)}&select=*`,
          { headers: supabasePublicHeaders(env) },
        );
        const text = await res.text();
        const rows = text ? JSON.parse(text) : [];
        const prefix = buildCadCreationsPrefix(tenantId, ws, runId);
        return jsonResponse({ workflow_run_id: runId, r2_prefix: prefix, assets: Array.isArray(rows) ? rows : [] }, 200);
      } catch (e) {
        const prefix = buildCadCreationsPrefix(tenantId, ws, runId);
        return jsonResponse(
          { workflow_run_id: runId, r2_prefix: prefix, assets: [], supabase_error: String(e?.message || e) },
          200,
        );
      }
    }

    if (pathLower === '/api/internal/designstudio/sync-run' && method === 'POST') {
      if (!internalSecretOk(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);

      let body = {};
      try {
        const raw = await request.text();
        if (raw) body = JSON.parse(raw);
      } catch (_) {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }

      const runId = String(body.run_id || body.workflow_run_id || '').trim();
      if (!runId) return jsonResponse({ error: 'run_id required' }, 400);

      const assets = Array.isArray(body.assets) ? body.assets : [];
      const r2Prefix = body.r2_prefix != null ? String(body.r2_prefix).trim() : null;
      const sessionId = body.session_id != null ? String(body.session_id).trim() : null;
      const workspaceId = body.workspace_id != null ? String(body.workspace_id).trim() : undefined;
      const skipKeyCheck = body.skip_designstudio_key_check === true;

      const result = await syncRunToSupabase(env, runId, {
        sessionId: sessionId || null,
        r2Prefix: r2Prefix || null,
        assets,
        workspaceId,
        skipDesignStudioKeyCheck: skipKeyCheck,
      });

      return jsonResponse({ ok: true, ...result }, 200);
    }

    return jsonResponse({ error: 'DesignStudio route not found' }, 404);
  } catch (e) {
    const msg = String(e?.message || e);
    console.warn('[handleDesignStudioApi]', msg);
    return jsonResponse({ error: msg }, 500);
  }
}
