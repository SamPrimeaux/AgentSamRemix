/**
 * Design Studio ↔ ChatAssistant bridge (window CustomEvents).
 */

export type DesignStudioSurfaceContext = {
  surface: 'design_studio';
  route?: string;
  phase?: 'entry' | 'studio';
  scene_id?: string | null;
  scene_name?: string | null;
  cad_job_id?: string | null;
  blueprint_id?: string | null;
  entity_count?: number;
  selected_entity_id?: string | null;
  selected_entity?: {
    id: string;
    name: string;
    type?: string;
    modelUrl?: string | null;
    scale?: number | null;
  } | null;
  entities?: Array<{
    id: string;
    name: string;
    type?: string;
    modelUrl?: string | null;
  }>;
  compute_status?: string | null;
  cad_job_status?: string | null;
  cad_job_progress_pct?: number | null;
  cad_public_url?: string | null;
  engine?: string | null;
  spatial?: {
    units?: string;
    source_units?: string | null;
    spawn_profile?: string;
    up_axis?: string | null;
    ground_y?: number;
    rotation_euler_deg?: { x: number; y: number; z: number };
    world_bbox?: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
      size: { x: number; y: number; z: number };
    };
  } | null;
};

/** Publish live Design Studio viewport context for Agent Sam chat payload. */
export function publishDesignStudioSurfaceContext(payload: DesignStudioSurfaceContext) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('iam-designstudio-surface-context', { detail: payload }));
}
