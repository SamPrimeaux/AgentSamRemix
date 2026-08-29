export type MeshyPhase = 'preview' | 'refine';

export type MeshyPoseMode = '' | 'a-pose' | 't-pose';

export type MeshySettings = {
  prompt: string;
  ai_model: string;
  model_type: 'standard' | 'lowpoly';
  topology: 'triangle' | 'quad';
  target_polycount: number;
  polycount_mode: 'fixed' | 'adaptive';
  should_remesh: boolean;
  /** Refine-only — not sent on preview requests. */
  enable_pbr: boolean;
  /** Refine-only (meshy-6 / latest). */
  hd_texture: boolean;
  /** Refine-only (meshy-6 / latest). */
  remove_lighting: boolean;
  moderation: boolean;
  auto_size: boolean;
  origin_at: 'bottom' | 'center';
  alpha_thumbnail: boolean;
  pose_mode: MeshyPoseMode;
  target_formats: string[];
  preview_task_id: string;
  texture_prompt: string;
};

export const MESHY_PROMPT_MAX = 600;

export const DEFAULT_MESHY_SETTINGS: MeshySettings = {
  prompt: '',
  ai_model: 'meshy-6',
  model_type: 'standard',
  topology: 'triangle',
  target_polycount: 5000,
  polycount_mode: 'fixed',
  should_remesh: true,
  enable_pbr: true,
  hd_texture: false,
  remove_lighting: true,
  moderation: false,
  auto_size: true,
  origin_at: 'bottom',
  alpha_thumbnail: false,
  pose_mode: '',
  target_formats: ['glb'],
  preview_task_id: '',
  texture_prompt: '',
};

/** Meshy credit costs — keep aligned with src/core/meshy-credits.js */
export const MESHY_UI_CREDIT_COSTS = {
  TEXT_TO_3D_PREVIEW_MESHY6: 20,
  TEXT_TO_3D_PREVIEW_DEFAULT: 10,
  TEXT_TO_3D_REFINE: 10,
  IMAGE_TO_3D_MESHY6_MESH: 20,
  IMAGE_TO_3D_MESHY6_TEXTURED: 30,
  IMAGE_TO_3D_DEFAULT_MESH: 5,
  IMAGE_TO_3D_DEFAULT_TEXTURED: 15,
  RETEXTURE: 10,
  REMESH: 5,
  RIGGING: 5,
  ANIMATION: 3,
  PRINT_MULTI_COLOR: 10,
} as const;

export function isMeshy6UiModel(settings: Pick<MeshySettings, 'ai_model' | 'model_type'>): boolean {
  const ai = settings.ai_model.toLowerCase();
  return settings.model_type === 'lowpoly' || ai.includes('meshy-6') || ai === 'latest';
}

export function estimatePreviewCost(settings: MeshySettings): number {
  return isMeshy6UiModel(settings)
    ? MESHY_UI_CREDIT_COSTS.TEXT_TO_3D_PREVIEW_MESHY6
    : MESHY_UI_CREDIT_COSTS.TEXT_TO_3D_PREVIEW_DEFAULT;
}

export function estimateRefineCost(): number {
  return MESHY_UI_CREDIT_COSTS.TEXT_TO_3D_REFINE;
}

export function estimateFullTextCost(settings: MeshySettings): number {
  return estimatePreviewCost(settings) + estimateRefineCost();
}

export function estimateImageTo3dUiCost(
  aiModel: string,
  modelType: MeshySettings['model_type'],
  shouldTexture = true,
): number {
  const meshy6 =
    modelType === 'lowpoly' ||
    aiModel.toLowerCase().includes('meshy-6') ||
    aiModel.toLowerCase() === 'latest';
  if (meshy6) {
    return shouldTexture
      ? MESHY_UI_CREDIT_COSTS.IMAGE_TO_3D_MESHY6_TEXTURED
      : MESHY_UI_CREDIT_COSTS.IMAGE_TO_3D_MESHY6_MESH;
  }
  return shouldTexture
    ? MESHY_UI_CREDIT_COSTS.IMAGE_TO_3D_DEFAULT_TEXTURED
    : MESHY_UI_CREDIT_COSTS.IMAGE_TO_3D_DEFAULT_MESH;
}

/** Map UI polycount intent to Meshy adaptive decimation_mode (1=ultra … 4=low). */
export function mapTargetPolycountToDecimationMode(targetPolycount: number): number {
  const n = Math.max(100, Math.min(300000, Number(targetPolycount) || 5000));
  if (n <= 5000) return 4;
  if (n <= 20000) return 3;
  if (n <= 80000) return 2;
  return 1;
}

/** POST /openapi/v2/text-to-3d — preview body (Meshy v2 spec). */
export function buildMeshyPreviewBody(settings: MeshySettings): Record<string, unknown> {
  const prompt = settings.prompt.trim().slice(0, MESHY_PROMPT_MAX);
  const body: Record<string, unknown> = {
    mode: 'preview',
    prompt,
    model_type: settings.model_type,
    moderation: settings.moderation,
    target_formats: settings.target_formats?.length ? settings.target_formats : ['glb'],
    auto_size: settings.auto_size,
    alpha_thumbnail: settings.alpha_thumbnail,
  };

  if (settings.model_type !== 'lowpoly') {
    body.ai_model = settings.ai_model;
    body.should_remesh = settings.should_remesh;
    if (settings.should_remesh) {
      body.topology = settings.topology;
      if (settings.polycount_mode === 'adaptive') {
        body.decimation_mode = mapTargetPolycountToDecimationMode(settings.target_polycount);
      } else {
        body.target_polycount = settings.target_polycount;
      }
    }
  }

  if (settings.pose_mode) {
    body.pose_mode = settings.pose_mode;
  }

  if (settings.auto_size) {
    body.origin_at = settings.origin_at;
  }

  return body;
}

/** POST /openapi/v2/text-to-3d — refine body (Meshy v2 spec). */
export function buildMeshyRefineBody(settings: MeshySettings): Record<string, unknown> {
  const body: Record<string, unknown> = {
    mode: 'refine',
    preview_task_id: settings.preview_task_id.trim(),
    enable_pbr: settings.enable_pbr,
    moderation: settings.moderation,
    target_formats: settings.target_formats?.length ? settings.target_formats : ['glb'],
    auto_size: settings.auto_size,
    alpha_thumbnail: settings.alpha_thumbnail,
  };

  const texturePrompt = settings.texture_prompt.trim();
  if (texturePrompt) {
    body.texture_prompt = texturePrompt.slice(0, MESHY_PROMPT_MAX);
  }

  if (settings.ai_model) body.ai_model = settings.ai_model;
  if (settings.enable_pbr && settings.hd_texture) body.hd_texture = true;
  if (settings.remove_lighting) body.remove_lighting = true;
  if (settings.auto_size) body.origin_at = settings.origin_at;

  return body;
}

export function buildCurl(method: string, path: string, body?: unknown, apiKey = 'YOUR_MESHY_API_KEY') {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://inneranimalmedia.com';
  const lines = [`curl -X ${method} '${origin}${path}' \\`, `  -H 'Content-Type: application/json' \\`];
  if (path.includes('meshy.ai') || apiKey !== 'YOUR_MESHY_API_KEY') {
    lines.push(`  -H 'Authorization: Bearer ${apiKey}' \\`);
  }
  if (body) {
    lines.push(`  -d '${JSON.stringify(body, null, 2).replace(/'/g, "'\\''")}'`);
  } else {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, '');
  }
  return lines.join('\n');
}
