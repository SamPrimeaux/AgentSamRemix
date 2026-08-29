/** Design Studio CAD API client — blueprints, jobs, OpenSCAD, Meshy. */

export type BlueprintRow = {
  id: number | string;
  title: string;
  description?: string | null;
  original_prompt?: string | null;
  status?: string;
  cad_script?: string | null;
  cad_engine?: string | null;
  sketch_json?: string | null;
  intent_json?: string | null;
  preview_image_url?: string | null;
  preview_svg_url?: string | null;
  latest_asset_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CadJobRow = {
  id: string;
  engine: string;
  prompt?: string;
  mode?: string;
  status: string;
  progress_pct?: number;
  error?: string | null;
  public_url?: string | null;
  r2_key?: string | null;
  result_url?: string | null;
  workspace_id?: string | null;
  scene_snapshot_id?: string | null;
  project_id?: string | null;
  task_type?: string | null;
  external_task_id?: string | null;
  parent_task_id?: string | null;
  rig_task_id?: string | null;
  model_formats?: Record<string, string> | null;
  texture_data?: unknown;
  created_at?: number;
  updated_at?: number;
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err =
      typeof (data as { error?: string }).error === 'string'
        ? (data as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(err);
  }
  return data as T;
}

export async function fetchBlueprints(limit = 50): Promise<BlueprintRow[]> {
  const data = await jsonFetch<{ blueprints?: BlueprintRow[] }>(
    `/api/designstudio/blueprints?limit=${limit}`,
  );
  return Array.isArray(data.blueprints) ? data.blueprints : [];
}

export async function createBlueprint(body: {
  title: string;
  description?: string;
  original_prompt?: string;
  sketch_json?: unknown;
  tags?: string[];
}): Promise<BlueprintRow> {
  const data = await jsonFetch<{ blueprint: BlueprintRow }>('/api/designstudio/blueprints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return data.blueprint;
}

export async function patchBlueprint(
  id: string | number,
  body: Record<string, unknown>,
): Promise<BlueprintRow> {
  const data = await jsonFetch<{ blueprint: BlueprintRow }>(
    `/api/designstudio/blueprints/${encodeURIComponent(String(id))}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return data.blueprint;
}

export async function fetchCadJobs(limit = 20): Promise<CadJobRow[]> {
  const data = await jsonFetch<{ jobs?: CadJobRow[] }>(`/api/cad/jobs?limit=${limit}`);
  return Array.isArray(data.jobs) ? data.jobs : [];
}

export async function fetchCadJob(jobId: string): Promise<CadJobRow> {
  const data = await jsonFetch<{ job: CadJobRow }>(`/api/cad/jobs/${encodeURIComponent(jobId)}`);
  return data.job;
}

export async function cancelCadJob(jobId: string): Promise<{ ok: boolean; job_id: string; status: string }> {
  return jsonFetch(`/api/cad/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
}

export async function deleteMeshyCadTask(
  taskId: string,
  taskType = 'text-to-3d',
): Promise<{ ok: boolean; task_id: string }> {
  const q = taskType ? `?type=${encodeURIComponent(taskType)}` : '';
  return jsonFetch(`/api/cad/meshy/task/${encodeURIComponent(taskId)}${q}`, { method: 'DELETE' });
}

export async function generateOpenScad(body: {
  prompt: string;
  session_id?: string;
  scene_snapshot_id?: string;
  blueprint_id?: string;
}): Promise<{ job_id: string; status: string; script?: string }> {
  return jsonFetch('/api/cad/openscad/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function executeCadJob(
  jobId: string,
  body?: { session_id?: string; scene_snapshot_id?: string; blueprint_id?: string },
): Promise<{ ok: boolean; job_id: string; status: string }> {
  return jsonFetch(`/api/cad/jobs/${encodeURIComponent(jobId)}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

export async function generateMeshy(body: {
  prompt?: string;
  mode?: 'text' | 'image';
  image_url?: string;
  session_id?: string;
  scene_snapshot_id?: string;
  blueprint_id?: string;
  ai_model?: string;
  model_type?: string;
  topology?: string;
  target_polycount?: number;
  should_remesh?: boolean;
  should_texture?: boolean;
  target_formats?: string[];
  auto_refine?: boolean;
  enable_pbr?: boolean;
  moderation?: boolean;
  auto_size?: boolean;
}): Promise<{ job_id: string; status: string; task_id?: string }> {
  return jsonFetch('/api/cad/meshy/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function pollMeshyStatus(jobId: string): Promise<{
  job_id: string;
  status: string;
  public_url?: string;
  progress_pct?: number;
  progress?: number;
  task_type?: string;
  model_formats?: Record<string, string> | null;
  texture_data?: unknown;
}> {
  return jsonFetch(`/api/cad/meshy/status/${encodeURIComponent(jobId)}`);
}

export async function fetchMeshyBalance(): Promise<{
  balance: number;
  stub?: boolean;
  key_source?: 'byok' | 'platform' | 'none';
}> {
  return jsonFetch('/api/cad/meshy/balance');
}

export async function meshyRigging(body: {
  input_task_id?: string;
  model_task_id?: string;
  model_url?: string;
  height_meters?: number;
  texture_image_url?: string;
  session_id?: string;
  scene_snapshot_id?: string;
  blueprint_id?: string;
}): Promise<{
  job_id: string;
  task_id: string;
  external_task_id?: string;
  result?: string;
  status: string;
  humanoid_warning?: string;
  face_count_warning?: string;
}> {
  return jsonFetch('/api/cad/meshy/rigging', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function meshyGetRigging(taskId: string): Promise<{
  task: Record<string, unknown>;
  cad?: Record<string, unknown>;
}> {
  return jsonFetch(`/api/cad/meshy/rigging/${encodeURIComponent(taskId)}`);
}

export async function meshyDeleteRigging(taskId: string): Promise<{ ok: boolean; task_id: string }> {
  return jsonFetch(`/api/cad/meshy/rigging/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

export function meshyRiggingStreamUrl(taskId: string): string {
  return `/api/cad/meshy/rigging/${encodeURIComponent(taskId)}/stream`;
}

export type MeshyRetextureBody = {
  input_task_id?: string;
  model_task_id?: string;
  model_url?: string;
  text_style_prompt?: string;
  texture_prompt?: string;
  prompt?: string;
  image_style_url?: string;
  ai_model?: string;
  enable_original_uv?: boolean;
  enable_pbr?: boolean;
  hd_texture?: boolean;
  remove_lighting?: boolean;
  target_formats?: string[];
  alpha_thumbnail?: boolean;
  session_id?: string;
  scene_snapshot_id?: string;
  blueprint_id?: string;
};

export async function meshyRetexture(body: MeshyRetextureBody): Promise<{
  job_id: string;
  task_id: string;
  external_task_id?: string;
  result?: string;
  status: string;
  input_task_warning?: string;
}> {
  return jsonFetch('/api/cad/meshy/retexture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function meshyListRetexture(params?: {
  page_num?: number;
  page_size?: number;
  sort_by?: string;
}): Promise<{
  tasks: Record<string, unknown>[];
  page_num: number;
  page_size: number;
  type: string;
}> {
  const q = new URLSearchParams();
  if (params?.page_num != null) q.set('page_num', String(params.page_num));
  if (params?.page_size != null) q.set('page_size', String(params.page_size));
  if (params?.sort_by) q.set('sort_by', params.sort_by);
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return jsonFetch(`/api/cad/meshy/retexture${suffix}`);
}

export async function meshyGetRetexture(taskId: string): Promise<{
  task: Record<string, unknown>;
  cad?: Record<string, unknown>;
}> {
  return jsonFetch(`/api/cad/meshy/retexture/${encodeURIComponent(taskId)}`);
}

export async function meshyDeleteRetexture(taskId: string): Promise<{ ok: boolean; task_id: string }> {
  return jsonFetch(`/api/cad/meshy/retexture/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

export function meshyRetextureStreamUrl(taskId: string): string {
  return `/api/cad/meshy/retexture/${encodeURIComponent(taskId)}/stream`;
}

export type MeshyPrintMultiColorBody = {
  input_task_id?: string;
  model_task_id?: string;
  model_url?: string;
  max_colors?: number;
  max_depth?: number;
  session_id?: string;
  scene_snapshot_id?: string;
  blueprint_id?: string;
};

export async function meshyPrintMultiColor(body: MeshyPrintMultiColorBody): Promise<{
  job_id: string;
  task_id: string;
  external_task_id?: string;
  result?: string;
  status: string;
  input_task_warning?: string;
}> {
  return jsonFetch('/api/cad/meshy/print-multi-color', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function meshyListPrintMultiColor(params?: {
  page_num?: number;
  page_size?: number;
  sort_by?: string;
}): Promise<{
  tasks: Record<string, unknown>[];
  page_num: number;
  page_size: number;
  type: string;
}> {
  const q = new URLSearchParams();
  if (params?.page_num != null) q.set('page_num', String(params.page_num));
  if (params?.page_size != null) q.set('page_size', String(params.page_size));
  if (params?.sort_by) q.set('sort_by', params.sort_by);
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return jsonFetch(`/api/cad/meshy/print-multi-color${suffix}`);
}

export async function meshyGetPrintMultiColor(taskId: string): Promise<{
  task: Record<string, unknown>;
  cad?: Record<string, unknown>;
}> {
  return jsonFetch(`/api/cad/meshy/print-multi-color/${encodeURIComponent(taskId)}`);
}

export async function meshyDeletePrintMultiColor(taskId: string): Promise<{ ok: boolean; task_id: string }> {
  return jsonFetch(`/api/cad/meshy/print-multi-color/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

export function meshyPrintMultiColorStreamUrl(taskId: string): string {
  return `/api/cad/meshy/print-multi-color/${encodeURIComponent(taskId)}/stream`;
}

export type MeshyImageTo3dBody = {
  image_url?: string;
  input_task_id?: string;
  model_type?: 'standard' | 'lowpoly';
  ai_model?: string;
  should_texture?: boolean;
  enable_pbr?: boolean;
  hd_texture?: boolean;
  texture_prompt?: string;
  texture_image_url?: string;
  should_remesh?: boolean;
  topology?: 'quad' | 'triangle';
  target_polycount?: number;
  decimation_mode?: number;
  save_pre_remeshed_model?: boolean;
  pose_mode?: '' | 'a-pose' | 't-pose';
  image_enhancement?: boolean;
  remove_lighting?: boolean;
  moderation?: boolean;
  target_formats?: string[];
  auto_size?: boolean;
  alpha_thumbnail?: boolean;
  multi_view_thumbnails?: boolean;
  origin_at?: 'bottom' | 'center';
  session_id?: string;
  scene_snapshot_id?: string;
  blueprint_id?: string;
};

export async function meshyCreateImageTo3d(body: MeshyImageTo3dBody): Promise<{
  job_id: string;
  task_id: string;
  external_task_id?: string;
  result?: string;
  status: string;
}> {
  return jsonFetch('/api/cad/meshy/image-to-3d', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function meshyUvUnwrap(body: {
  input_task_id?: string;
  model_task_id?: string;
  model_url?: string;
  session_id?: string;
  scene_snapshot_id?: string;
}): Promise<{
  job_id: string;
  task_id: string;
  status: string;
  face_count_warning?: string;
}> {
  return jsonFetch('/api/cad/meshy/uv-unwrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** @see https://docs.meshy.ai/en/api/remesh */
export async function meshyCreateRemesh(body: {
  input_task_id?: string;
  model_task_id?: string;
  model_url?: string;
  target_formats?: string[];
  topology?: 'triangle' | 'quad';
  target_polycount?: number;
  decimation_mode?: 1 | 2 | 3 | 4;
  alpha_thumbnail?: boolean;
  session_id?: string;
  scene_snapshot_id?: string;
}): Promise<{ job_id: string; task_id: string; status: string; external_task_id?: string }> {
  return jsonFetch('/api/cad/meshy/remesh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** @see https://docs.meshy.ai/en/api/convert */
export async function meshyCreateConvert(body: {
  input_task_id?: string;
  model_task_id?: string;
  model_url?: string;
  target_formats: string[];
  session_id?: string;
  scene_snapshot_id?: string;
}): Promise<{ job_id: string; task_id: string; status: string; external_task_id?: string }> {
  return jsonFetch('/api/cad/meshy/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** @see https://docs.meshy.ai/en/api/resize */
export async function meshyCreateResize(body: {
  input_task_id?: string;
  model_task_id?: string;
  model_url?: string;
  resize_height?: number;
  resize_longest_side?: number;
  auto_size?: boolean;
  origin_at?: 'bottom' | 'center';
  session_id?: string;
  scene_snapshot_id?: string;
}): Promise<{ job_id: string; task_id: string; status: string; external_task_id?: string }> {
  return jsonFetch('/api/cad/meshy/resize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function meshyListImageTo3d(query?: {
  page_num?: number;
  page_size?: number;
  sort_by?: string;
}): Promise<{ tasks: unknown; page_num: number; page_size: number; type: string }> {
  const qs = new URLSearchParams();
  if (query?.page_num != null) qs.set('page_num', String(query.page_num));
  if (query?.page_size != null) qs.set('page_size', String(query.page_size));
  if (query?.sort_by) qs.set('sort_by', query.sort_by);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return jsonFetch(`/api/cad/meshy/image-to-3d${suffix}`);
}

export async function meshyGetImageTo3d(taskId: string): Promise<{
  task: Record<string, unknown>;
  cad?: Record<string, unknown>;
}> {
  return jsonFetch(`/api/cad/meshy/image-to-3d/${encodeURIComponent(taskId)}`);
}

export async function meshyDeleteImageTo3d(taskId: string): Promise<{ ok: boolean; task_id: string }> {
  return jsonFetch(`/api/cad/meshy/image-to-3d/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

export function meshyImageTo3dStreamUrl(taskId: string): string {
  return `/api/cad/meshy/image-to-3d/${encodeURIComponent(taskId)}/stream`;
}

export type MeshyAnimationPostProcess = {
  operation_type: 'change_fps' | 'fbx2usdz' | 'extract_armature';
  fps?: 24 | 25 | 30 | 60;
};

export async function meshyCreateAnimation(body: {
  rig_task_id: string;
  action_id: number;
  post_process?: MeshyAnimationPostProcess;
  session_id?: string;
  scene_snapshot_id?: string;
  blueprint_id?: string;
}): Promise<{
  job_id: string;
  task_id: string;
  external_task_id?: string;
  result?: string;
  status: string;
  action_id?: number;
  rig_task_id?: string;
}> {
  return jsonFetch('/api/cad/meshy/animations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function meshyGetAnimation(taskId: string): Promise<{
  task: Record<string, unknown>;
  cad?: Record<string, unknown>;
}> {
  return jsonFetch(`/api/cad/meshy/animations/${encodeURIComponent(taskId)}`);
}

export async function meshyDeleteAnimation(taskId: string): Promise<{ ok: boolean; task_id: string }> {
  return jsonFetch(`/api/cad/meshy/animations/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

/** Opens Meshy SSE stream for an animation task (GET /openapi/v1/animations/:id/stream). */
export function meshyAnimationStreamUrl(taskId: string): string {
  return `/api/cad/meshy/animations/${encodeURIComponent(taskId)}/stream`;
}

export async function meshyCreateTask(body: {
  task_type: string;
  session_id?: string;
  scene_snapshot_id?: string;
  [key: string]: unknown;
}): Promise<{ job_id: string; task_id: string; status: string; external_task_id?: string }> {
  return jsonFetch('/api/cad/meshy/task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function fetchMeshyAnimationLibrary(): Promise<{
  animations?: { action_id?: number; name?: string; category?: string }[];
}> {
  return jsonFetch('/api/cad/meshy/animations/library');
}

export async function fetchMeshyCharacterAnimationPacks(rigTaskId: string): Promise<{
  rig_task_id: string;
  packs: {
    action_id: number;
    name: string;
    category?: string;
    glb_url?: string | null;
    ready?: boolean;
    job_id?: string;
    source?: string;
  }[];
  jobs?: number;
  meshy_synced?: boolean;
}> {
  return jsonFetch(
    `/api/cad/meshy/animations/packs?rig_task_id=${encodeURIComponent(rigTaskId)}`,
  );
}

export async function meshyTextTo3dPreview(body: Record<string, unknown>): Promise<{
  job_id?: string;
  task_id?: string;
  status?: string;
  stub?: boolean;
  message?: string;
  key_source?: string;
}> {
  return jsonFetch('/api/cad/meshy/text-to-3d/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function meshyTextTo3dRefine(body: {
  preview_task_id: string;
  enable_pbr?: boolean;
  texture_prompt?: string;
}): Promise<{ job_id: string; task_id: string; status: string }> {
  return jsonFetch('/api/cad/meshy/text-to-3d/refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function generateBlenderScript(body: {
  prompt: string;
  session_id?: string;
  scene_snapshot_id?: string;
  blueprint_id?: string;
  scene_json?: unknown;
  model_key?: string;
}): Promise<{ job_id: string; status: string; script?: string }> {
  return jsonFetch('/api/cad/blender/script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function generateFreecadScript(body: {
  prompt: string;
  session_id?: string;
  scene_snapshot_id?: string;
  blueprint_id?: string;
  input_url?: string;
  model_key?: string;
}): Promise<{ job_id: string; status: string; script?: string }> {
  return jsonFetch('/api/cad/freecad/script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
