/**
 * GET/PUT /api/agent/scene — user/workspace agent home background config.
 * Theme defaults live in cms_themes.components_json.agent_home (canonical CMS theme domain).
 * @see app/types/agentHomeScene.ts
 */

import { jsonResponse } from '../shared.js';
import {
  authUserFromRequest,
  fallbackSystemTenantId,
  resolveRequestContext,
} from '../../../identity/index.js';
import {
  CMS_AGENT_HOME_DEFAULTS,
  parseAgentHomeFromComponentsJson,
  sanitizeAgentHomeCms,
} from '../../../services/cms/theme/agent-home.js';
import {
  resolveActiveCmsThemeRow,
  resolveTenantIdForCmsThemeOps,
} from '../../../services/cms/theme/resolve.js';

const DEFAULT_SCENE = { ...CMS_AGENT_HOME_DEFAULTS };

const PRESET_IDS = new Set([
  'auto-time',
  'moonlit-sea',
  'dawn',
  'day',
  'dusk',
  'night',
  'aurora',
  'minimal-dark',
]);
const GREETING_STYLES = new Set(['serif', 'sans']);

function clamp01(n, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

function sanitizeLayer(layer) {
  if (!layer || typeof layer !== 'object') return null;
  const type = String(layer.type || '').trim();
  if (type === 'preset') {
    const id = String(layer.id || '').trim();
    if (!PRESET_IDS.has(id)) return null;
    return { type: 'preset', id };
  }
  if (type === 'gradient') {
    const stops = Array.isArray(layer.stops)
      ? layer.stops.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
      : [];
    if (stops.length < 2) return null;
    const angle = Number(layer.angle);
    return { type: 'gradient', stops, angle: Number.isFinite(angle) ? angle : 180 };
  }
  if (type === 'image') {
    const url = String(layer.url || '').trim();
    if (!url || url.length > 2048) return null;
    const blur = layer.blur != null ? Number(layer.blur) : undefined;
    return {
      type: 'image',
      url,
      blur: Number.isFinite(blur) ? Math.min(48, Math.max(0, blur)) : undefined,
    };
  }
  if (type === 'video') {
    const url = String(layer.url || '').trim();
    if (!url || url.length > 2048) return null;
    return { type: 'video', url, muted: Boolean(layer.muted) };
  }
  if (type === 'webgl') {
    const presetId = String(layer.presetId || '').trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
    if (!presetId) return null;
    const params =
      layer.params && typeof layer.params === 'object' && !Array.isArray(layer.params)
        ? Object.fromEntries(
            Object.entries(layer.params)
              .slice(0, 16)
              .map(([k, v]) => [String(k).slice(0, 32), Number(v)])
              .filter(([, v]) => Number.isFinite(v)),
          )
        : {};
    return { type: 'webgl', presetId, params };
  }
  return null;
}

export function sanitizeAgentHomeScene(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (Number(raw.version) !== 1) return null;
  const layers = Array.isArray(raw.layers)
    ? raw.layers.map(sanitizeLayer).filter(Boolean).slice(0, 6)
    : [];
  if (!layers.length) return null;

  const atmosphere =
    raw.atmosphere && typeof raw.atmosphere === 'object' ? raw.atmosphere : {};
  const ui = raw.ui && typeof raw.ui === 'object' ? raw.ui : {};

  const greetingStyle = String(ui.greetingStyle || 'serif').trim();
  const scene = {
    version: 1,
    layers,
    atmosphere: {
      vignette: clamp01(atmosphere.vignette, 0.35),
      grain: clamp01(atmosphere.grain, 0.04),
      glowAccent:
        typeof atmosphere.glowAccent === 'string' && atmosphere.glowAccent.trim()
          ? atmosphere.glowAccent.trim().slice(0, 120)
          : 'var(--accent-cyan)',
    },
    ui: {
      greetingStyle: GREETING_STYLES.has(greetingStyle) ? greetingStyle : 'serif',
      glassOpacity: clamp01(ui.glassOpacity, 0.18),
    },
  };
  return scene;
}

function sceneRowId(userId, workspaceId) {
  const ws = String(workspaceId || '').trim();
  return `ahs_${userId}_${ws || 'global'}`;
}

async function readSceneRow(env, userId, workspaceId) {
  const ws = String(workspaceId || '').trim();
  if (ws) {
    const scoped = await env.DB.prepare(
      `SELECT scene_json, workspace_id FROM agent_home_scene
       WHERE user_id = ? AND workspace_id = ?
       LIMIT 1`,
    )
      .bind(userId, ws)
      .first()
      .catch(() => null);
    if (scoped?.scene_json) return { row: scoped, source: 'workspace' };
  }
  const global = await env.DB.prepare(
    `SELECT scene_json, workspace_id FROM agent_home_scene
     WHERE user_id = ? AND workspace_id = ''
     LIMIT 1`,
  )
    .bind(userId)
    .first()
    .catch(() => null);
  if (global?.scene_json) return { row: global, source: 'user' };
  return { row: null, source: 'default' };
}

export async function handleAgentHomeSceneApi(request, env, routeAuth = null) {
  const path = '/api/agent/scene';
  const method = request.method.toUpperCase();
  if (request.url) {
    const urlPath = new URL(request.url).pathname.toLowerCase().replace(/\/$/, '') || '/';
    if (urlPath !== path) return null;
  }

  const authUser = await authUserFromRequest(
    request,
    env,
    routeAuth?.authCtx ?? null,
    routeAuth?.authUser ?? null,
  );
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const reqCtx = await resolveRequestContext(request, env);
  if (reqCtx.error || !reqCtx.workspaceId) {
    return jsonResponse({ error: 'no_workspace', redirect: '/onboarding' }, 403);
  }

  const userId = String(authUser.id || '').trim();
  const workspaceId = String(reqCtx.workspaceId || '').trim();

  if (method === 'GET') {
    try {
      const tenantId =
        (await resolveTenantIdForCmsThemeOps(env, authUser, workspaceId)) ||
        fallbackSystemTenantId(env);
      const themeResolved = await resolveActiveCmsThemeRow(env, {
        tenantId,
        authUser,
        workspaceId,
        projectId: null,
      });
      const themeCms = parseAgentHomeFromComponentsJson(themeResolved.row?.components_json);

      const { row, source: rowSource } = await readSceneRow(env, userId, workspaceId);
      if (row?.scene_json) {
        try {
          const parsedRaw = JSON.parse(String(row.scene_json));
          const userCms = sanitizeAgentHomeCms(parsedRaw) || sanitizeAgentHomeScene(parsedRaw);
          if (userCms) {
            return jsonResponse({
              ok: true,
              source: rowSource,
              cms: userCms,
              theme_slug: themeResolved.row?.slug || null,
            });
          }
        } catch {
          /* fall through */
        }
      }

      return jsonResponse({
        ok: true,
        source: themeResolved.row ? 'theme' : 'default',
        cms: themeCms,
        theme_slug: themeResolved.row?.slug || null,
        resolved_from: themeResolved.resolved_from || null,
      });
    } catch (e) {
      console.warn('[agent/scene GET]', e?.message ?? e);
      return jsonResponse({
        ok: true,
        source: 'default',
        cms: DEFAULT_SCENE,
        theme_slug: null,
      });
    }
  }

  if (method === 'PUT') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400);
    }
    const scene = sanitizeAgentHomeCms(body.scene) || sanitizeAgentHomeScene(body.scene);
    if (!scene) return jsonResponse({ error: 'invalid_scene' }, 400);

    const scopeWs = body.workspaceScoped === true ? workspaceId : '';
    const id = sceneRowId(userId, scopeWs);
    const json = JSON.stringify(scene);
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      `INSERT INTO agent_home_scene (id, user_id, workspace_id, scene_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, workspace_id) DO UPDATE SET
         scene_json = excluded.scene_json,
         updated_at = excluded.updated_at`,
    )
      .bind(id, userId, scopeWs, json, now, now)
      .run();

    const source = scopeWs ? 'workspace' : 'user';
    return jsonResponse({ ok: true, source, cms: scene });
  }

  return jsonResponse({ error: 'method_not_allowed' }, 405);
}
