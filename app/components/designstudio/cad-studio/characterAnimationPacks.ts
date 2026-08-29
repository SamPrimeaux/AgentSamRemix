/**
 * Character-scoped Meshy animation packs for Animation Library.
 * Derives ready/available clips from entity metadata, CAD jobs, and Meshy rig results.
 */
import type { CadJobRow } from '../api';
import { parseModelFormats } from '../cadExportFormats';
import type { GameEntity } from '../../../types';

export type CharacterAnimPack = {
  action_id: number;
  name: string;
  category?: string;
  /** Ready GLB to spawn without a new Meshy job. */
  glb_url?: string | null;
  pack_source: 'character' | 'catalog';
  ready: boolean;
  job_id?: string;
};

const BASIC_ACTION_IDS: Record<string, number> = {
  walking: 92,
  running: 93,
};

function isDone(status: unknown): boolean {
  return /^(done|complete|succeed)/i.test(String(status || ''));
}

function glbFromFormats(formats: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const url = formats[key];
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
  }
  return null;
}

function actionIdFromJob(job: CadJobRow): number | null {
  const td = job.texture_data;
  if (td && typeof td === 'object' && !Array.isArray(td)) {
    const raw = (td as Record<string, unknown>).action_id;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  const m = String(job.prompt || '').match(/animate:(\d+)/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function nameForAction(actionId: number, catalog: { action_id: number; name: string }[]): string {
  const hit = catalog.find((c) => c.action_id === actionId);
  if (hit?.name) return hit.name;
  if (actionId === 92) return 'Walking';
  if (actionId === 93) return 'Running';
  return `Clip ${actionId}`;
}

export function resolveMeshyIdsFromEntity(entity: GameEntity | null | undefined): {
  model_task_id?: string;
  rig_task_id?: string;
} {
  const meta = (entity?.behavior?.metadata ?? {}) as Record<string, unknown>;
  const model =
    meta.meshy_task_id ?? meta.model_task_id ?? meta.input_task_id ?? meta.external_task_id ?? null;
  const rig = meta.meshy_rig_task_id ?? meta.rig_task_id ?? null;
  return {
    model_task_id: model != null ? String(model) : undefined,
    rig_task_id: rig != null ? String(rig) : undefined,
  };
}

export function resolveRigTaskIdFromJobs(jobs: CadJobRow[]): string | undefined {
  const rigJob = jobs.find(
    (j) =>
      String(j.task_type || '').toLowerCase() === 'rigging' &&
      isDone(j.status) &&
      j.external_task_id,
  );
  if (rigJob?.external_task_id) return String(rigJob.external_task_id);
  const anyRig = jobs.find((j) => j.rig_task_id);
  return anyRig?.rig_task_id ? String(anyRig.rig_task_id) : undefined;
}

/** Stamp Meshy provenance onto spawned entities so Animation Library can re-resolve packs. */
export function meshyMetadataFromJob(job: CadJobRow): Record<string, unknown> {
  const formats = parseModelFormats(job.model_formats);
  const taskType = String(job.task_type || '').toLowerCase();
  const meta: Record<string, unknown> = {
    cad_job_id: job.id,
    meshy_task_type: taskType,
  };

  if (taskType === 'rigging') {
    const rigId = job.external_task_id ? String(job.external_task_id) : null;
    if (rigId) {
      meta.meshy_rig_task_id = rigId;
      meta.rig_task_id = rigId;
    }
    if (job.parent_task_id) meta.meshy_task_id = String(job.parent_task_id);
    meta.basic_animations = {
      walking_glb_url: formats.walking_glb_url || null,
      running_glb_url: formats.running_glb_url || null,
    };
  } else if (taskType === 'animation') {
    if (job.rig_task_id) {
      meta.meshy_rig_task_id = String(job.rig_task_id);
      meta.rig_task_id = String(job.rig_task_id);
    }
    const actionId = actionIdFromJob(job);
    if (actionId != null) meta.meshy_action_id = actionId;
    if (job.external_task_id) meta.meshy_animation_task_id = String(job.external_task_id);
  } else if (job.external_task_id) {
    meta.meshy_task_id = String(job.external_task_id);
  }

  return meta;
}

function pushPack(
  byId: Map<number, CharacterAnimPack>,
  pack: CharacterAnimPack,
): void {
  const prev = byId.get(pack.action_id);
  if (!prev) {
    byId.set(pack.action_id, pack);
    return;
  }
  // Prefer ready GLB + keep richer name
  const merged: CharacterAnimPack = {
    ...prev,
    ...pack,
    name: pack.name || prev.name,
    glb_url: pack.glb_url || prev.glb_url,
    ready: Boolean(pack.glb_url || prev.glb_url || pack.ready || prev.ready),
    job_id: pack.job_id || prev.job_id,
    pack_source: 'character',
  };
  byId.set(pack.action_id, merged);
}

export function packsFromBasicAnimations(
  basic: Record<string, unknown> | null | undefined,
  catalog: { action_id: number; name: string }[] = [],
): CharacterAnimPack[] {
  if (!basic || typeof basic !== 'object') return [];
  const out: CharacterAnimPack[] = [];
  for (const [key, actionId] of Object.entries(BASIC_ACTION_IDS)) {
    const glb =
      (typeof basic[`${key}_glb_url`] === 'string' && String(basic[`${key}_glb_url`])) ||
      (typeof basic[`${key}_armature_glb_url`] === 'string' &&
        String(basic[`${key}_armature_glb_url`])) ||
      null;
    if (!glb && !basic[`${key}_glb_url`]) continue;
    out.push({
      action_id: actionId,
      name: nameForAction(actionId, catalog),
      category: 'basic',
      glb_url: glb,
      pack_source: 'character',
      ready: Boolean(glb),
    });
  }
  return out;
}

export function buildCharacterAnimationPacks(opts: {
  entity?: GameEntity | null;
  jobs?: CadJobRow[];
  rigTaskId?: string | null;
  catalog?: { action_id: number; name: string }[];
  /** Raw Meshy rigging task.result.basic_animations or flattened model_formats-style map. */
  basicAnimations?: Record<string, unknown> | null;
  /** Packs from GET /api/cad/meshy/animations/packs */
  remotePacks?: CharacterAnimPack[] | null;
}): CharacterAnimPack[] {
  const catalog = opts.catalog || [];
  const byId = new Map<number, CharacterAnimPack>();
  const rigTaskId =
    opts.rigTaskId ||
    resolveMeshyIdsFromEntity(opts.entity).rig_task_id ||
    resolveRigTaskIdFromJobs(opts.jobs || []) ||
    null;

  if (Array.isArray(opts.remotePacks)) {
    for (const p of opts.remotePacks) {
      if (!Number.isFinite(p.action_id)) continue;
      pushPack(byId, { ...p, pack_source: 'character', ready: Boolean(p.glb_url || p.ready) });
    }
  }

  const meta = (opts.entity?.behavior?.metadata ?? {}) as Record<string, unknown>;
  const metaBasic =
    meta.basic_animations && typeof meta.basic_animations === 'object'
      ? (meta.basic_animations as Record<string, unknown>)
      : null;
  for (const p of packsFromBasicAnimations(metaBasic, catalog)) pushPack(byId, p);
  for (const p of packsFromBasicAnimations(opts.basicAnimations || null, catalog)) pushPack(byId, p);

  const jobs = opts.jobs || [];
  for (const job of jobs) {
    const taskType = String(job.task_type || '').toLowerCase();
    const formats = parseModelFormats(job.model_formats);
    const jobRig =
      (job.rig_task_id && String(job.rig_task_id)) ||
      (taskType === 'rigging' && job.external_task_id ? String(job.external_task_id) : null);

    if (rigTaskId && jobRig && jobRig !== rigTaskId) continue;

    if (taskType === 'rigging' && isDone(job.status)) {
      for (const p of packsFromBasicAnimations(
        {
          walking_glb_url: formats.walking_glb_url,
          running_glb_url: formats.running_glb_url,
          walking_armature_glb_url: formats.walking_armature_glb_url,
          running_armature_glb_url: formats.running_armature_glb_url,
        },
        catalog,
      )) {
        pushPack(byId, { ...p, job_id: job.id });
      }
    }

    if (taskType === 'animation' && isDone(job.status)) {
      const actionId = actionIdFromJob(job);
      if (actionId == null) continue;
      const glb =
        glbFromFormats(formats, ['animation_glb_url', 'glb']) ||
        (job.public_url && String(job.public_url)) ||
        (job.result_url && String(job.result_url)) ||
        null;
      pushPack(byId, {
        action_id: actionId,
        name: nameForAction(actionId, catalog),
        category: 'applied',
        glb_url: glb,
        pack_source: 'character',
        ready: Boolean(glb),
        job_id: job.id,
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Normalize API pack rows from the worker. */
export function normalizeRemotePacks(raw: unknown): CharacterAnimPack[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const r = row as Record<string, unknown>;
      const actionId = Number(r.action_id);
      if (!Number.isFinite(actionId)) return null;
      const glb = typeof r.glb_url === 'string' ? r.glb_url : null;
      return {
        action_id: actionId,
        name: String(r.name || `Clip ${actionId}`),
        category: r.category != null ? String(r.category) : undefined,
        glb_url: glb,
        pack_source: 'character' as const,
        ready: Boolean(glb || r.ready),
        job_id: r.job_id != null ? String(r.job_id) : undefined,
      };
    })
    .filter((p): p is CharacterAnimPack => p != null);
}
