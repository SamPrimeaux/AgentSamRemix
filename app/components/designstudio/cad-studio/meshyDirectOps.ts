import type { GameEntity } from '../../../types';
import type { CadJobRow } from '../api';
import {
  resolveMeshyIdsFromEntity,
  resolveRigTaskIdFromJobs,
} from './characterAnimationPacks';

export const MESHY_DIRECT_OPERATOR_IDS = new Set([
  'meshyRemesh',
  'meshyUvUnwrap',
  'meshyRig',
  'meshyConvert',
  'meshyResize',
  'meshyRetexture',
  'meshyAnimate',
  'generateObject',
]);

export function isMeshyDirectOperator(operatorId: string): boolean {
  return MESHY_DIRECT_OPERATOR_IDS.has(String(operatorId || '').trim());
}

export function resolveMeshyModelInput(
  entity: GameEntity | null | undefined,
  jobs: CadJobRow[] = [],
): {
  model_task_id?: string;
  rig_task_id?: string;
  model_url?: string;
} {
  const ids = resolveMeshyIdsFromEntity(entity);
  const modelUrl = String(entity?.modelUrl || '').trim() || undefined;
  const rigFromJobs = resolveRigTaskIdFromJobs(jobs);
  return {
    model_task_id: ids.model_task_id,
    rig_task_id: ids.rig_task_id || rigFromJobs,
    model_url: modelUrl,
  };
}

export function hasMeshyModelInput(input: {
  model_task_id?: string;
  model_url?: string;
}): boolean {
  return Boolean(String(input.model_task_id || '').trim() || String(input.model_url || '').trim());
}
