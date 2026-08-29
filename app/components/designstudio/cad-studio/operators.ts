export type CadOperator = {
  id: string;
  title: string;
  type: string;
  engine: string;
  description: string;
  /** `local` = viewport; `api` = direct Meshy/CAD HTTP; `agent` = ChatAssistant tool loop */
  execution?: 'local' | 'api' | 'agent';
};

/** Viewport primitives — never route through illustration_create / Draw. */
export const VIEWPORT_LOCAL_OPERATOR_IDS = new Set([
  'addCube',
  'deleteSelected',
  'resetScene',
  'exportGLB',
]);

export function isViewportLocalOperator(operatorId: string): boolean {
  return VIEWPORT_LOCAL_OPERATOR_IDS.has(String(operatorId || '').trim());
}

/** Catalog tool keys the agent should prefer for this operator (D1-pinned; freehand args). */
export function preferredCatalogToolsForOperator(operatorId: string): string[] {
  switch (String(operatorId || '').trim()) {
    case 'generateObject':
      return ['meshy_text_to_3d', 'meshy_image_to_3d', 'meshy_get_task_status'];
    case 'meshyRig':
      return ['meshy_rig', 'meshy_get_task_status'];
    case 'meshyAnimate':
      return ['meshy_rig', 'meshy_animate', 'meshy_get_task_status'];
    case 'meshyRemesh':
      return ['meshy_remesh', 'meshy_get_task_status'];
    case 'meshyConvert':
      return ['meshy_convert', 'meshy_get_task_status'];
    case 'meshyResize':
      return ['meshy_resize', 'meshy_get_task_status'];
    case 'meshyUvUnwrap':
      return ['meshy_uv_unwrap', 'meshy_get_task_status'];
    case 'meshyRetexture':
      return ['meshy_retexture', 'meshy_get_task_status'];
    case 'generateOpenSCAD':
      return ['cad_generate', 'cad_job_status'];
    case 'generateFreeCAD':
      return ['cad_generate', 'cad_job_status'];
    case 'generateBlender':
      return ['cad_generate', 'cad_job_status'];
    case 'repairGeometry':
      return ['cad_generate', 'cad_job_status'];
    default:
      return [];
  }
}

export const CAD_OPERATORS: CadOperator[] = [
  {
    id: 'generateObject',
    title: 'Generate CAD Object (Meshy)',
    type: 'AI',
    engine: 'Meshy',
    description: 'Text-to-3D via canonical Meshy generation tools. GLB auto-spawns when the job completes.',
    execution: 'api',
  },
  {
    id: 'meshyRig',
    title: 'Rig Character (Meshy)',
    type: 'ANIM',
    engine: 'Meshy',
    description: 'Rig a Meshy model task id or GLB URL. Required before applying a custom animation.',
    execution: 'api',
  },
  {
    id: 'meshyAnimate',
    title: 'Apply Animation Clip (Meshy)',
    type: 'ANIM',
    engine: 'Meshy',
    description:
      'Call meshy_animate with rig_task_id + action_id from the Meshy library.',
    execution: 'api',
  },
  {
    id: 'meshyRemesh',
    title: 'Remesh (Meshy)',
    type: 'MESH',
    engine: 'Meshy',
    description:
      'Remesh via meshy_remesh (topology/polycount). Prefer meshy_convert or meshy_resize for format-only or size-only.',
    execution: 'api',
  },
  {
    id: 'meshyConvert',
    title: 'Convert Formats (Meshy)',
    type: 'EXPORT',
    engine: 'Meshy',
    description:
      'Meshy convert to glb/fbx/obj/usdz/blend/stl/3mf. Not CloudConvert (video/PDF/office → MovieMode).',
    execution: 'api',
  },
  {
    id: 'meshyResize',
    title: 'Resize (Meshy)',
    type: 'MESH',
    engine: 'Meshy',
    description: 'Real-world resize via meshy_resize (height / longest side / auto_size).',
    execution: 'api',
  },
  {
    id: 'meshyUvUnwrap',
    title: 'UV Unwrap (Meshy)',
    type: 'MESH',
    engine: 'Meshy',
    description: 'UV white-model unwrap before retexture (≤40k faces). Remesh first if over limit.',
    execution: 'api',
  },
  {
    id: 'meshyRetexture',
    title: 'Retexture (Meshy)',
    type: 'AI',
    engine: 'Meshy',
    description: 'Retexture a SUCCEEDED Meshy model via text or image style.',
    execution: 'api',
  },
  {
    id: 'generateBlender',
    title: 'Generate Blender Script',
    type: 'SCRIPT',
    engine: 'Blender',
    description: 'Blender Python for materials/renders — not Meshy character animation.',
    execution: 'agent',
  },
  {
    id: 'generateOpenSCAD',
    title: 'Generate OpenSCAD Part',
    type: 'SCRIPT',
    engine: 'OpenSCAD',
    description: 'Parametric OpenSCAD component (not house master).',
    execution: 'agent',
  },
  {
    id: 'generateFreeCAD',
    title: 'Generate FreeCAD Part',
    type: 'SCRIPT',
    engine: 'FreeCAD',
    description: 'FreeCAD architectural / manufacturing geometry.',
    execution: 'agent',
  },
  {
    id: 'executeScript',
    title: 'Execute Current Script',
    type: 'RUN',
    engine: 'Runner',
    description: 'Execute the active script_ready job through ExecOS / GCP runner.',
    execution: 'agent',
  },
  {
    id: 'exportGLB',
    title: 'Export GLB',
    type: 'EXPORT',
    engine: 'Artifact',
    description: 'Download the latest job GLB or selected model URL.',
    execution: 'local',
  },
  {
    id: 'repairGeometry',
    title: 'Repair Geometry',
    type: 'FIX',
    engine: 'Agent',
    description: 'Use the bounded Meshy transform lane for provider meshes or CAD generation for engine masters.',
    execution: 'agent',
  },
  {
    id: 'addCube',
    title: 'Add Cube',
    type: 'SCENE',
    engine: 'Viewport',
    description: 'Add a voxel cube primitive to the scene.',
    execution: 'local',
  },
  {
    id: 'deleteSelected',
    title: 'Delete Selected',
    type: 'SCENE',
    engine: 'Viewport',
    description: 'Remove the selected object from the viewport.',
    execution: 'local',
  },
  {
    id: 'resetScene',
    title: 'Reset Scene',
    type: 'SCENE',
    engine: 'Viewport',
    description: 'Clear all objects from the viewport.',
    execution: 'local',
  },
];

export const DEFAULT_OPERATOR_PROMPT =
  'A chess king piece, ornate gothic crown with four arched buttresses, wide weighted base, ultra high detail.';
