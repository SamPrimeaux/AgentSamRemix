/**
 * CAD pipelines: Meshy, OpenSCAD, Blender, job execute + runner completion.
 */
import { jsonResponse, resolveRequestContext } from '../core/auth.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import {
  decodeCadScriptPayload,
  resolveCadJobScope,
  buildCadExportR2Key,
  buildCadAssetPublicUrl,
  resolveCadR2Binding,
  cadJobR2Bucket,
} from '../core/cad-job-scope.js';
import { finalizeCadJobComplete } from '../core/cad-job-complete.js';
import {
  dispatchCadJob,
  probeCadComputeHealth,
  cadDispatchLabel,
  resolveCadDispatchTarget,
} from '../core/cad-dispatch.js';
import { handleCadMeshyApi } from './cad-meshy.js';
import { resolveLibraryFragment } from '../core/openscad-library-resolver.js';
import { resolveModelForTask } from '../core/resolveModel.js';
import { dispatchComplete } from '../../backend/agentsam/runtime/provider-dispatch.js';
import { deleteMeshyTask } from '../core/meshy-api.js';
import {
  isMeshyAuthMissing,
  meshyKeySourceFromJob,
  resolveMeshyAuth,
} from '../core/meshy-api-key.js';

const OPENSCAD_BIN = '/opt/homebrew/bin/openscad';
const CAD_SCRIPT_TASK_TYPE = 'designstudio_cad_script';

function parseJsonColumn(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(String(val));
  } catch {
    return null;
  }
}

function cadJobRowResponse(row) {
  if (!row) return row;
  return {
    ...row,
    model_formats: parseJsonColumn(row.model_formats),
    texture_data: parseJsonColumn(row.texture_data),
    public_url:
      row.r2_key && !String(row.r2_key).startsWith('b64:')
        ? buildCadAssetPublicUrl(row.r2_key)
        : row.result_url,
  };
}

const OPENSCAD_SYSTEM_PROMPT = `You are a parametric 3D modeling expert using OpenPySCAD (Python library: openpyscad).
Output ONLY valid Python 3 code — no markdown fences, no explanation.
Requirements:
- import openpyscad as ops (alias ops)
- Use ops.Cube, ops.Cylinder, ops.Sphere, ops.translate, etc.; combine with + (union) and - (difference)
- Define parametric variables at the top for all dimensions
- MUST end with: (your_final_shape).write("model.scad") — filename exactly model.scad in the current working directory
- Model must be watertight and suitable for 3D printing
Do NOT output raw .scad unless OpenPySCAD cannot express the shape.`;

const FREECAD_SYSTEM_PROMPT = `You are a FreeCAD Python API expert. Output ONLY a valid FreeCAD Python script for headless FreeCADCmd.
The script must:
- Use import FreeCAD, Part, Mesh, Import as needed
- Create or modify the requested geometry
- Export mesh to STL as "output.stl" in the current working directory using shape.exportStl("output.stl")
  (preferred for headless FreeCADCmd) or Mesh.export / document objects
  OR write /tmp/output.stl — required for viewport GLB ingest
- Use print() for progress messages
No markdown fences, no explanation. Pure Python only.`;

const BLENDER_SYSTEM_PROMPT = `You are a Blender Python API expert. Output ONLY a valid Blender Python script using bpy.
The script must:
- Clear the default scene (delete default cube)
- Create the requested geometry using bpy.ops or bpy.data
- Set up basic lighting
- Export to GLB: bpy.ops.export_scene.gltf(filepath=OUTPUT_GLB, export_format='GLB')
Use OUTPUT_GLB as the filepath variable defined at the top of the script.
No markdown, no explanation. Pure Python only.`;

function extractDispatchText(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  return (
    result?.content?.[0]?.text ||
    result?.choices?.[0]?.message?.content ||
    result?.text ||
    result?.output_text ||
    ''
  );
}

function stripMarkdownFences(text) {
  return String(text || '')
    .replace(/^```[\w]*\n?/gm, '')
    .replace(/```$/gm, '')
    .trim();
}

function encodeCadScriptPayload(script) {
  const raw = String(script || '');
  if (!raw) return '';
  return raw.length > 4000 ? 'b64:' + btoa(unescape(encodeURIComponent(raw))) : raw;
}

const NON_CANCELLABLE_CAD_JOB_STATUSES = new Set(['done', 'complete', 'completed', 'cancelled']);

/**
 * Cancel an in-flight CAD job (Meshy task delete when applicable).
 * @param {any} env
 * @param {{ id: string, tenant_id?: string | null }} authUser
 * @param {string} jobId
 */
export async function cancelCadJobForUser(env, authUser, jobId) {
  if (!env?.DB) throw new Error('Database not configured');
  const id = String(jobId || '').trim();
  if (!id) throw new Error('job_id required');

  const job = await env.DB.prepare(
    `SELECT * FROM agentsam_cad_jobs WHERE id = ? AND user_id = ? LIMIT 1`,
  )
    .bind(id, authUser.id)
    .first();
  if (!job) return { error: 'Job not found', status: 404 };

  const st = String(job.status || '').toLowerCase();
  if (NON_CANCELLABLE_CAD_JOB_STATUSES.has(st)) {
    return { ok: true, job_id: id, status: st, already_terminal: true };
  }

  if (String(job.engine || '') === 'meshy' && job.external_task_id) {
    try {
      const meshyAuth = await resolveMeshyAuth(
        env,
        { userId: authUser.id, tenant_id: authUser.tenant_id ?? null },
        { keySource: meshyKeySourceFromJob(job) },
      );
      if (!isMeshyAuthMissing(meshyAuth)) {
        const taskType = String(job.task_type || job.mode || 'text-to-3d').trim() || 'text-to-3d';
        await deleteMeshyTask(env, taskType, String(job.external_task_id), meshyAuth);
      }
    } catch (e) {
      console.warn('[cancelCadJob] meshy delete failed:', e?.message ?? e);
    }
  }

  await env.DB.prepare(
    `UPDATE agentsam_cad_jobs SET
       status = 'cancelled',
       error = COALESCE(NULLIF(trim(error), ''), 'cancelled_by_user'),
       progress_pct = COALESCE(progress_pct, 0),
       finished_at = unixepoch(),
       updated_at = unixepoch()
     WHERE id = ? AND user_id = ?`,
  )
    .bind(id, authUser.id)
    .run();

  return { ok: true, job_id: id, status: 'cancelled' };
}

/**
 * @param {any} env
 * @param {{
 *   authUser: { id: string, tenant_id?: string | null },
 *   scope: Awaited<ReturnType<typeof resolveCadJobScope>>,
 *   engine: string,
 *   prompt: string,
 *   systemPrompt: string,
 *   userContent: string,
 *   mode?: string,
 *   extraTextureData?: Record<string, unknown>,
 *   requestedModelKey?: string | null,
 *   maxScriptLen?: number,
 * }} opts
 */
/** @param {string} engine */
export function cadEngineSystemPrompt(engine) {
  const e = String(engine || '').toLowerCase();
  if (e === 'freecad') return FREECAD_SYSTEM_PROMPT;
  if (e === 'blender') return BLENDER_SYSTEM_PROMPT;
  return OPENSCAD_SYSTEM_PROMPT;
}

export async function generateCadScriptJob(env, opts) {
  const {
    authUser,
    scope,
    engine,
    prompt,
    systemPrompt,
    userContent,
    mode = 'text',
    extraTextureData = {},
    requestedModelKey = null,
    maxScriptLen = 8000,
  } = opts;

  const resolved = await resolveModelForTask(env, {
    task_type: CAD_SCRIPT_TASK_TYPE,
    mode: 'agent',
    workspace_id: scope.workspaceId,
    tenant_id: scope.tenantId,
    require_tools: false,
    ...(requestedModelKey ? { requested_model_key: String(requestedModelKey).trim() } : {}),
  });
  if (!resolved?.model_key) {
    return { error: 'model_resolve_empty', status: 503 };
  }

  // Resolve relevant library imports from D1 based on prompt keywords.
  // Returns a compact fragment (3-6 import lines) — not a full doc dump.
  let enrichedSystemPrompt = systemPrompt;
  if (String(engine || '').toLowerCase() === 'openscad') {
    try {
      const libFragment = await resolveLibraryFragment(env, prompt);
      if (libFragment) enrichedSystemPrompt = systemPrompt + libFragment;
    } catch (e) {
      console.warn('[generateCadScriptJob] library resolver failed (non-fatal):', e?.message ?? e);
    }
  }

  let result;
  try {
    result = await dispatchComplete(env, {
      modelKey: resolved.model_key,
      taskType: CAD_SCRIPT_TASK_TYPE,
      systemPrompt: enrichedSystemPrompt,
      messages: [{ role: 'user', content: userContent }],
      userId: authUser.id,
      options: { maxOutputTokens: 4096, reasoningEffort: 'medium', verbosity: 'low' },
    });
  } catch (e) {
    return { error: String(e?.message || e), status: 502 };
  }

  const script = stripMarkdownFences(extractDispatchText(result)).slice(0, maxScriptLen);
  if (!script.trim()) {
    return { error: 'empty_script_generation', status: 502 };
  }

  const jobId = 'cadj_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const scriptStored = encodeCadScriptPayload(script);
  const textureMeta = {
    ...extraTextureData,
    script_model_key: resolved.model_key,
    ...(resolved.routing_arm_id ? { script_routing_arm_id: resolved.routing_arm_id } : {}),
  };

  await insertCadJob(env, {
    id: jobId,
    user_id: authUser.id,
    session_id: scope.sessionId,
    engine,
    prompt,
    mode,
    status: 'script_ready',
    r2_key: scriptStored,
    workspace_id: scope.workspaceId,
    tenant_id: scope.tenantId,
    project_id: scope.projectId,
    scene_snapshot_id: scope.sceneSnapshotId,
  });

  if (Object.keys(textureMeta).length) {
    await env.DB.prepare(`UPDATE agentsam_cad_jobs SET texture_data = ? WHERE id = ?`)
      .bind(JSON.stringify(textureMeta), jobId)
      .run();
  }

  return {
    jobId,
    script,
    model_key: resolved.model_key,
    routing_arm_id: resolved.routing_arm_id ?? null,
    resolution_source: resolved.resolution_source ?? null,
  };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} fields
 */
async function insertCadJob(env, fields) {
  await env.DB.prepare(
    `INSERT INTO agentsam_cad_jobs (
       id, user_id, session_id, engine, prompt, mode, status,
       external_task_id, r2_key, r2_bucket, workspace_id, tenant_id,
       project_id, scene_snapshot_id, progress_pct, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
  )
    .bind(
      fields.id,
      fields.user_id,
      fields.session_id ?? null,
      fields.engine,
      fields.prompt ?? '',
      fields.mode ?? 'text',
      fields.status,
      fields.external_task_id ?? null,
      fields.r2_key ?? null,
      fields.r2_bucket ?? 'inneranimalmedia',
      fields.workspace_id ?? null,
      fields.tenant_id ?? null,
      fields.project_id ?? null,
      fields.scene_snapshot_id ?? null,
      Number(fields.progress_pct) || 0,
    )
    .run();
}

export async function handleCadApi(request, url, env, ctx) {
  const method = request.method.toUpperCase();
  const path = url.pathname.toLowerCase();

  try {
    if (path === '/api/internal/cad/glb-upload' && method === 'POST') {
      if (!verifyBridgeKey(request, env)) {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }
      const cadBinding = resolveCadR2Binding(env);
      if (!cadBinding?.put) return jsonResponse({ error: 'CAD/ASSETS binding not configured' }, 503);

      const form = await request.formData().catch(() => null);
      if (!form) return jsonResponse({ error: 'multipart_required' }, 400);

      const file = form.get('file');
      const r2Key = String(form.get('r2_key') || '').trim().replace(/^\/+/, '');
      if (!file || typeof file === 'string' || !r2Key) {
        return jsonResponse({ error: 'file_and_r2_key_required' }, 400);
      }
      if (r2Key.includes('..')) {
        return jsonResponse({ error: 'invalid_r2_key' }, 400);
      }

      await cadBinding.put(r2Key, file.stream(), {
        httpMetadata: { contentType: 'model/gltf-binary' },
      });
      return jsonResponse({
        ok: true,
        r2_key: r2Key,
        bucket: cadJobR2Bucket(env),
        public_url: buildCadAssetPublicUrl(r2Key, env.CAD_R2_PUBLIC_ORIGIN),
      });
    }

    if (path === '/api/internal/cad/job-complete' && method === 'POST') {
      if (!verifyBridgeKey(request, env)) {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }
      const body = await request.json().catch(() => ({}));
      const result = await finalizeCadJobComplete(env, ctx, body);
      return jsonResponse(result);
    }

    const executeMatch = url.pathname.match(/^\/api\/cad\/jobs\/([^/]+)\/execute$/i);
    if (executeMatch && method === 'POST') {
      const reqCtx = await resolveRequestContext(request, env);
      if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
      const authUser = { id: reqCtx.userId, tenant_id: reqCtx.tenantId };
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);

      const jobId = executeMatch[1];
      const body = await request.json().catch(() => ({}));
      const job = await env.DB.prepare(`SELECT * FROM agentsam_cad_jobs WHERE id = ? LIMIT 1`)
        .bind(jobId)
        .first();
      if (!job) return jsonResponse({ error: 'Job not found' }, 404);
      if (String(job.user_id) !== String(authUser.id)) {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }

      const runnable = ['script_ready', 'pending', 'failed'];
      if (!runnable.includes(String(job.status || ''))) {
        return jsonResponse(
          { error: 'job_not_executable', status: job.status },
          409,
        );
      }

      const scope = await resolveCadJobScope(env, request, authUser, body);
      if (!scope.workspaceId) {
        return jsonResponse({ error: 'WORKSPACE_CONTEXT_MISSING' }, 400);
      }

      await env.DB.prepare(
        `UPDATE agentsam_cad_jobs SET
           status = 'pending',
           workspace_id = ?,
           tenant_id = ?,
           project_id = COALESCE(?, project_id),
           scene_snapshot_id = COALESCE(?, scene_snapshot_id),
           progress_pct = 0,
           error = NULL,
           error_code = NULL,
           updated_at = unixepoch()
         WHERE id = ?`,
      )
        .bind(
          scope.workspaceId,
          scope.tenantId,
          scope.projectId,
          scope.sceneSnapshotId,
          jobId,
        )
        .run();

      const engine = String(job.engine || '').toLowerCase();
      const containerEngines = new Set(['openscad', 'blender', 'freecad']);
      if (containerEngines.has(engine)) {
        const dispatch = async () => {
          try {
            await dispatchCadJob(env, ctx, jobId, {
              userId: authUser.id,
              tenantId: scope.tenantId,
              workspaceId: scope.workspaceId,
            });
          } catch (e) {
            console.warn('[cad execute] dispatch failed:', e?.message ?? e);
            await finalizeCadJobComplete(env, ctx, {
              job_id: jobId,
              status: 'failed',
              error: String(e?.message || e).slice(0, 2000),
              error_code: 'cad_dispatch_failed',
              runner_host: 'cad-container',
            }).catch(() => null);
          }
        };
        if (ctx?.waitUntil) {
          ctx.waitUntil(dispatch());
        } else {
          await dispatch();
        }
        const dispatchTarget = resolveCadDispatchTarget(env);
        return jsonResponse({
          ok: true,
          job_id: jobId,
          status: 'running',
          workspace_id: scope.workspaceId,
          dispatch: 'container',
          dispatch_target: dispatchTarget,
          message: 'CAD job dispatched to IAM CAD worker container',
        });
      }

      return jsonResponse({
        ok: true,
        job_id: jobId,
        status: 'pending',
        workspace_id: scope.workspaceId,
        message: 'Job queued',
      });
    }

    if (path === '/api/cad/compute/health' && method === 'GET') {
      const reqCtx = await resolveRequestContext(request, env);
      if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
      const health = await probeCadComputeHealth(env, {
        userId: reqCtx.userId,
        tenantId: reqCtx.tenantId,
        workspaceId: reqCtx.workspaceId,
      });
      return jsonResponse({ ok: true, ...health });
    }

    if (path.startsWith('/api/cad/meshy')) {
      const meshyRes = await handleCadMeshyApi(request, url, env, ctx);
      if (meshyRes) return meshyRes;
    }

    if (path === '/api/cad/openscad/generate' && method === 'POST') {
      const reqCtx = await resolveRequestContext(request, env);
      if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
      const authUser = { id: reqCtx.userId, tenant_id: reqCtx.tenantId };
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);

      const body = await request.json().catch(() => ({}));
      const { prompt, model_key: requestedModelKey } = body;
      if (!prompt) return jsonResponse({ error: 'prompt required' }, 400);

      const scope = await resolveCadJobScope(env, request, authUser, body);
      const generated = await generateCadScriptJob(env, {
        authUser,
        scope,
        engine: 'openscad',
        prompt,
        systemPrompt: OPENSCAD_SYSTEM_PROMPT,
        userContent: `Create an OpenSCAD model: ${prompt}`,
        requestedModelKey: requestedModelKey ?? null,
      });
      if (generated.error) {
        return jsonResponse({ error: generated.error }, generated.status || 500);
      }

      return jsonResponse({
        job_id: generated.jobId,
        script: generated.script,
        status: 'script_ready',
        engine: 'openscad',
        model_key: generated.model_key,
        routing_arm_id: generated.routing_arm_id,
        openscad_bin: OPENSCAD_BIN,
        next_step: 'POST /api/cad/jobs/{job_id}/execute',
      });
    }

    if (path === '/api/cad/freecad/script' && method === 'POST') {
      const reqCtx = await resolveRequestContext(request, env);
      if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
      const authUser = { id: reqCtx.userId, tenant_id: reqCtx.tenantId };
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);

      const body = await request.json().catch(() => ({}));
      const { prompt, input_url, model_key: requestedModelKey } = body;
      if (!prompt) return jsonResponse({ error: 'prompt required' }, 400);

      const scope = await resolveCadJobScope(env, request, authUser, body);
      const inputUrl = input_url != null ? String(input_url).trim() : '';
      const generated = await generateCadScriptJob(env, {
        authUser,
        scope,
        engine: 'freecad',
        prompt,
        systemPrompt: FREECAD_SYSTEM_PROMPT,
        userContent: `Create a FreeCAD Python script for: ${prompt}${
          inputUrl ? `\nInput file URL (optional load): ${inputUrl.slice(0, 500)}` : ''
        }`,
        extraTextureData: inputUrl ? { input_url: inputUrl } : {},
        requestedModelKey: requestedModelKey ?? null,
      });
      if (generated.error) {
        return jsonResponse({ error: generated.error }, generated.status || 500);
      }

      return jsonResponse({
        job_id: generated.jobId,
        script: generated.script,
        status: 'script_ready',
        engine: 'freecad',
        model_key: generated.model_key,
        routing_arm_id: generated.routing_arm_id,
        next_step: 'POST /api/cad/jobs/{job_id}/execute',
      });
    }

    if (path === '/api/cad/freecad/execute' && method === 'POST') {
      const reqCtx = await resolveRequestContext(request, env);
      if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
      const authUser = { id: reqCtx.userId, tenant_id: reqCtx.tenantId };
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);

      const body = await request.json().catch(() => ({}));
      const script = String(body.script || '').trim();
      if (!script) return jsonResponse({ error: 'script required' }, 400);

      const scope = await resolveCadJobScope(env, request, authUser, body);
      if (!scope.workspaceId) {
        return jsonResponse({ error: 'WORKSPACE_CONTEXT_MISSING' }, 400);
      }

      const jobId = 'cadj_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      const scriptStored =
        script.length > 4000 ? 'b64:' + btoa(unescape(encodeURIComponent(script))) : script;
      const inputUrl = body.input_url != null ? String(body.input_url).trim() : null;

      await insertCadJob(env, {
        id: jobId,
        user_id: authUser.id,
        session_id: scope.sessionId,
        engine: 'freecad',
        prompt: script.slice(0, 200),
        mode: 'script',
        status: 'pending',
        r2_key: scriptStored,
        workspace_id: scope.workspaceId,
        tenant_id: scope.tenantId,
        project_id: scope.projectId,
        scene_snapshot_id: scope.sceneSnapshotId,
      });

      if (inputUrl) {
        await env.DB.prepare(
          `UPDATE agentsam_cad_jobs SET texture_data = ? WHERE id = ?`,
        )
          .bind(JSON.stringify({ input_url: inputUrl }), jobId)
          .run();
      }

      const dispatch = async () => {
        try {
          const result = await dispatchCadJob(env, ctx, jobId, {
            userId: authUser.id,
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
          });
          if (!result?.ok) {
            throw new Error(result?.error || 'freecad_dispatch_failed');
          }
        } catch (e) {
          console.warn('[cad freecad] dispatch failed:', e?.message ?? e);
          await finalizeCadJobComplete(env, ctx, {
            job_id: jobId,
            status: 'failed',
            error: String(e?.message || e).slice(0, 2000),
            error_code: 'freecad_dispatch_failed',
            runner_host: 'cad-container',
          }).catch(() => null);
        }
      };
      if (ctx?.waitUntil) {
        ctx.waitUntil(dispatch());
      } else {
        await dispatch();
      }

      const dispatchTarget = resolveCadDispatchTarget(env);
      return jsonResponse({
        ok: true,
        job_id: jobId,
        status: 'running',
        engine: 'freecad',
        dispatch: 'container',
        dispatch_target: dispatchTarget,
        message: cadDispatchLabel({ dispatch: 'container' }),
      });
    }

    if (path === '/api/cad/blender/script' && method === 'POST') {
      const reqCtx = await resolveRequestContext(request, env);
      if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
      const authUser = { id: reqCtx.userId, tenant_id: reqCtx.tenantId };
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);

      const body = await request.json().catch(() => ({}));
      const { prompt, scene_json, model_key: requestedModelKey } = body;
      if (!prompt) return jsonResponse({ error: 'prompt required' }, 400);

      const scope = await resolveCadJobScope(env, request, authUser, body);
      const generated = await generateCadScriptJob(env, {
        authUser,
        scope,
        engine: 'blender',
        prompt,
        systemPrompt: BLENDER_SYSTEM_PROMPT,
        userContent: `Create a Blender script for: ${prompt}${
          scene_json ? '\nExisting scene: ' + JSON.stringify(scene_json).slice(0, 500) : ''
        }`,
        requestedModelKey: requestedModelKey ?? null,
      });
      if (generated.error) {
        return jsonResponse({ error: generated.error }, generated.status || 500);
      }

      return jsonResponse({
        job_id: generated.jobId,
        script: generated.script,
        status: 'script_ready',
        engine: 'blender',
        model_key: generated.model_key,
        routing_arm_id: generated.routing_arm_id,
        next_step: 'POST /api/cad/jobs/{job_id}/execute',
      });
    }

    const jobOneMatch = url.pathname.match(/^\/api\/cad\/jobs\/([^/]+)$/i);
    const jobCancelMatch = url.pathname.match(/^\/api\/cad\/jobs\/([^/]+)\/cancel$/i);

    if (jobCancelMatch && (method === 'POST' || method === 'DELETE')) {
      const reqCtx = await resolveRequestContext(request, env);
      if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
      const authUser = { id: reqCtx.userId, tenant_id: reqCtx.tenantId };
      try {
        const out = await cancelCadJobForUser(env, authUser, jobCancelMatch[1]);
        if (out.error) return jsonResponse({ error: out.error }, out.status || 404);
        return jsonResponse(out);
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 500);
      }
    }

    if (jobOneMatch && method === 'DELETE') {
      const reqCtx = await resolveRequestContext(request, env);
      if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
      const authUser = { id: reqCtx.userId, tenant_id: reqCtx.tenantId };
      try {
        const out = await cancelCadJobForUser(env, authUser, jobOneMatch[1]);
        if (out.error) return jsonResponse({ error: out.error }, out.status || 404);
        return jsonResponse(out);
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 500);
      }
    }

    if (jobOneMatch && method === 'GET') {
      const reqCtx = await resolveRequestContext(request, env);
      if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
      const authUser = { id: reqCtx.userId, tenant_id: reqCtx.tenantId };
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);

      const jobId = jobOneMatch[1];
      const job = await env.DB.prepare(
        `SELECT * FROM agentsam_cad_jobs WHERE id = ? AND user_id = ? LIMIT 1`,
      )
        .bind(jobId, authUser.id)
        .first();
      if (!job) return jsonResponse({ error: 'Job not found' }, 404);
      return jsonResponse({ job: cadJobRowResponse(job) });
    }

    if (path === '/api/cad/jobs' && method === 'GET') {
      const reqCtx = await resolveRequestContext(request, env);
      if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
      const authUser = { id: reqCtx.userId, tenant_id: reqCtx.tenantId };
      if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);

      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
      const { results } = await env.DB.prepare(
        `SELECT id, engine, prompt, mode, status, result_url, r2_key, r2_bucket, error,
                workspace_id, tenant_id, project_id, scene_snapshot_id, progress_pct,
                task_type, model_formats, texture_data,
                external_task_id, parent_task_id, rig_task_id,
                created_at, updated_at
         FROM agentsam_cad_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
        .bind(authUser.id, limit)
        .all();

      const jobs = (results || []).map((row) => cadJobRowResponse(row));

      return jsonResponse({ jobs });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (e) {
    console.warn('[handleCadApi]', e?.message ?? e);
    return jsonResponse({ error: String(e?.message || e) }, 500);
  }
}
