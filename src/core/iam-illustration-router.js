/**
 * iam.illustration.v1 router — Excalidraw vs CAD vs Meshy dispatch.
 */

import { writeWorkspaceArtifact } from './artifact-r2-store.js';
import {
  broadcastExcalidrawAction,
  persistCollabCanvasElements,
} from './collab-broadcast.js';
import { resolveCadJobScope } from './cad-job-scope.js';
import { cadEngineSystemPrompt, generateCadScriptJob } from '../api/cad.js';
import { dispatchCadJob } from './cad-dispatch.js';
import { meshyGenerateInProcess } from '../api/cad-meshy.js';
import { createPlanExcalidrawArtifact } from './agentsam-plan-excalidraw-artifact.js';
import { buildIllustrationExcalidrawScene } from './iam-illustration-excalidraw-scene.js';
import {
  ILLUSTRATION_SCHEMA,
  illustrationSurfaceFromRoute,
  resolveIllustrationRoute,
} from './iam-illustration-v1.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} envelope normalized iam.illustration.v1
 * @param {Record<string, unknown>} runContext
 */
export async function routeIllustration(env, ctx, envelope, runContext = {}) {
  const route = resolveIllustrationRoute(envelope);
  const surface = illustrationSurfaceFromRoute(route);
  const base = {
    schema: ILLUSTRATION_SCHEMA,
    lane: route.lane,
    engine: route.engine,
    intent: trim(envelope.intent),
    fidelity: trim(envelope.fidelity),
    surface: surface.surface,
    dashboard_path: surface.dashboard_path,
  };

  if (route.lane === 'excalidraw') {
    const out = await routeIllustrationExcalidraw(env, ctx, envelope, runContext);
    return { ...base, ...out };
  }
  if (route.lane === 'meshy') {
    const out = await routeIllustrationMeshy(env, envelope, runContext);
    return { ...base, ...out };
  }
  const out = await routeIllustrationCad(env, ctx, envelope, route.engine, runContext);
  return { ...base, ...out };
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} envelope
 * @param {Record<string, unknown>} runContext
 */
async function routeIllustrationExcalidraw(env, ctx, envelope, runContext) {
  const tenantId = trim(envelope.tenant_id);
  const workspaceId = trim(envelope.workspace_id);
  const userId = trim(envelope.user_id);
  const openAfter = envelope.open_after_create !== false && envelope.open_after_create !== 0;
  const payload =
    envelope.payload && typeof envelope.payload === 'object'
      ? /** @type {Record<string, unknown>} */ (envelope.payload)
      : {};
  const planId = trim(payload.plan_id);

  if (planId) {
    const out = await createPlanExcalidrawArtifact(env, {
      tenantId,
      workspaceId,
      userId,
      planId,
      sourceRunId: runContext.agent_run_id ?? runContext.run_id ?? null,
      sourceSessionId: runContext.conversation_id ?? runContext.session_id ?? null,
    });
    const planElements = Array.isArray(out.elements) ? out.elements : [];
    if (planElements.length > 0) {
      await broadcastExcalidrawAction(env, workspaceId, 'add_elements', { elements: planElements });
      await persistCollabCanvasElements(env, workspaceId, planElements);
    }
    return {
      ok: true,
      artifact_type: 'excalidraw',
      artifact_id: out.artifact_id,
      r2_key: out.r2_key,
      public_url: out.public_url,
      open_url: out.open_url,
      plan_id: out.plan_id,
      open_draw: openAfter,
    };
  }

  const scene = buildIllustrationExcalidrawScene({
    title: trim(envelope.title),
    brief: trim(envelope.brief),
    intent: trim(envelope.intent),
    payload,
  });
  const json = JSON.stringify(scene);
  const title = trim(envelope.title) || 'Illustration';

  const out = await writeWorkspaceArtifact(env, ctx, {
    userId,
    tenantId,
    workspaceId,
    content: json,
    artifactType: 'excalidraw',
    name: title,
    description: trim(envelope.brief).slice(0, 500) || `iam.illustration.v1 ${trim(envelope.intent)}`,
    source: 'illustration_create',
    kind: 'canvas',
    scope: 'user',
    sourceRunId: runContext.agent_run_id ?? runContext.run_id ?? null,
    sourceSessionId: runContext.conversation_id ?? runContext.session_id ?? null,
    tags: ['illustration', 'excalidraw', trim(envelope.intent)].filter(Boolean),
    metadata: {
      kind: 'canvas',
      schema: ILLUSTRATION_SCHEMA,
      intent: trim(envelope.intent),
      fidelity: trim(envelope.fidelity),
    },
    origin: env?.IAM_ORIGIN ?? null,
    authUser: runContext.authUser ?? null,
  });

  if (out.skipped_r2) {
    return {
      ok: true,
      skipped_r2: true,
      content_base64: out.content_base64,
      open_draw: openAfter,
    };
  }
  if (!out.ok) {
    return { ok: false, error: out.user_message || 'artifact_write_failed' };
  }

  const elements = Array.isArray(scene.elements) ? scene.elements : [];
  if (elements.length > 0) {
    await broadcastExcalidrawAction(env, workspaceId, 'add_elements', { elements });
    await persistCollabCanvasElements(env, workspaceId, elements);
  }

  return {
    ok: true,
    artifact_type: 'excalidraw',
    artifact_id: out.artifact_id,
    r2_key: out.r2_key,
    public_url: out.public_url,
    open_url: out.open_url,
    open_draw: openAfter,
  };
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} envelope
 * @param {string} engine
 * @param {Record<string, unknown>} runContext
 */
async function routeIllustrationCad(env, ctx, envelope, engine, runContext) {
  const authUser = {
    id: trim(envelope.user_id),
    tenant_id: trim(envelope.tenant_id) || null,
  };
  const brief = trim(envelope.brief);
  const constraints =
    envelope.constraints && typeof envelope.constraints === 'object'
      ? /** @type {Record<string, unknown>} */ (envelope.constraints)
      : {};
  const constraintText =
    Object.keys(constraints).length > 0
      ? `\nConstraints: ${JSON.stringify(constraints).slice(0, 2000)}`
      : '';
  const scope = await resolveCadJobScope(env, null, authUser, {
    workspace_id: envelope.workspace_id,
    tenant_id: envelope.tenant_id,
    session_id: runContext.conversation_id ?? runContext.session_id ?? null,
    project_id: constraints.project_id ?? null,
    scene_snapshot_id: constraints.scene_snapshot_id ?? null,
  });

  const cadEngine = ['openscad', 'freecad', 'blender'].includes(engine) ? engine : 'openscad';
  const systemPrompt = cadEngineSystemPrompt(cadEngine);
  const userContent = `Create a ${cadEngine} model for this illustration brief:\n${brief}${constraintText}`;

  const generated = await generateCadScriptJob(env, {
    authUser,
    scope,
    engine: cadEngine,
    prompt: brief,
    systemPrompt,
    userContent,
    requestedModelKey: constraints.model_key ?? null,
  });

  if (generated.error) {
    return { ok: false, error: String(generated.error) };
  }

  // Auto-execute: fire dispatch non-blocking so agent response returns immediately.
  // cad_glb_ready SSE will surface the GLB in the viewer when done.
  const execAuth = {
    userId: authUser.id,
    tenantId: authUser.tenant_id ?? null,
    workspaceId: scope.workspaceId,
  };
  const execFn = async () => {
    try {
      await dispatchCadJob(env, ctx, generated.jobId, execAuth);
    } catch (e) {
      console.warn('[illustration-router] cad auto-execute failed:', generated.jobId, e?.message ?? e);
    }
  };
  if (ctx?.waitUntil) {
    ctx.waitUntil(execFn());
  } else {
    execFn().catch((e) => console.warn('[illustration-router] cad execFn error:', e?.message ?? e));
  }

  return {
    ok: true,
    job_id: generated.jobId,
    cad_job_id: generated.jobId,
    status: 'running',
    engine: cadEngine,
    model_key: generated.model_key ?? null,
    routing_arm_id: generated.routing_arm_id ?? null,
    open_designstudio: envelope.open_after_create !== false && envelope.open_after_create !== 0,
  };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} envelope
 * @param {Record<string, unknown>} runContext
 */
async function routeIllustrationMeshy(env, envelope, runContext) {
  const userId = trim(envelope.user_id);
  const tenantId = trim(envelope.tenant_id) || undefined;
  const brief = trim(envelope.brief);
  const auth = { userId, tenantId };
  const scope = {
    session_id: trim(runContext.conversation_id ?? runContext.session_id ?? '') || undefined,
    scene_snapshot_id:
      envelope.constraints &&
      typeof envelope.constraints === 'object' &&
      /** @type {Record<string, unknown>} */ (envelope.constraints).scene_snapshot_id
        ? trim(/** @type {Record<string, unknown>} */ (envelope.constraints).scene_snapshot_id)
        : undefined,
  };

  const out = await meshyGenerateInProcess(env, null, auth, {
    prompt: brief,
    mode: 'text',
    session_id: scope.session_id,
    scene_snapshot_id: scope.scene_snapshot_id,
    auto_refine: true,
  });

  if (out?.error) {
    return { ok: false, error: String(out.error) };
  }

  return {
    ok: true,
    job_id: out.job_id ?? out.cad_job_id ?? null,
    cad_job_id: out.cad_job_id ?? out.job_id ?? null,
    status: out.status ?? 'pending',
    engine: 'meshy',
    open_designstudio: envelope.open_after_create !== false && envelope.open_after_create !== 0,
    ...out,
  };
}
