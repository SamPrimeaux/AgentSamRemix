/**
 * Compact Design Studio viewport context for Agent Sam chat.
 */

/**
 * @param {Record<string, unknown>|null|undefined} raw
 * @returns {boolean}
 */
export function isDesignStudioSurfaceContext(raw) {
  return !!(raw && typeof raw === 'object' && String(raw.surface || '') === 'design_studio');
}

/**
 * @param {unknown} message
 * @returns {boolean}
 */
export function isDesignStudioCadCreateIntent(_message) {
  return false;
}

/**
 * Design Studio viewport context — pin CAD create intents onto cad_generation tools.
 *
 * @param {unknown} browserContext
 * @param {unknown} body
 * @param {unknown} message
 * @returns {{ route_key: string }|null}
 */
export function resolveDesignStudioChatOverrides(browserContext, body, message) {
  const raw = extractDesignStudioContext(browserContext, body);
  if (!isDesignStudioSurfaceContext(raw)) return null;
  return {
    route_key: 'design_studio',
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} raw
 * @returns {string|null}
 */
export function formatDesignStudioContextForAgent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const surface = String(raw.surface || '');
  const route = String(raw.route || raw.dashboard_route || '');
  const isDesignStudio =
    surface === 'design_studio' ||
    route.includes('/dashboard/designstudio');
  if (!isDesignStudio && !raw.scene_id && !raw.entity_count) return null;

  const lines = [
    '[Design Studio — live viewport context. You CAN see what is loaded in the 3D viewer from this block. Answer questions about the open scene using these facts; do not claim you lack a viewer feed when this block is present.]',
    `surface: design_studio`,
    `phase: ${String(raw.phase || 'unknown')}`,
    `scene_id: ${raw.scene_id != null ? String(raw.scene_id) : '(none)'}`,
    `scene_name: ${raw.scene_name != null ? String(raw.scene_name) : '(none)'}`,
    `cad_job_id: ${raw.cad_job_id != null ? String(raw.cad_job_id) : '(none)'}`,
    `entity_count: ${Number(raw.entity_count ?? 0)}`,
    `selected_entity_id: ${raw.selected_entity_id != null ? String(raw.selected_entity_id) : '(none)'}`,
    `compute_status: ${raw.compute_status != null ? String(raw.compute_status) : '(unknown)'}`,
  ];

  if (raw.cad_job_status) {
    lines.push(
      `cad_job_status: ${String(raw.cad_job_status)}`,
      `cad_job_progress_pct: ${raw.cad_job_progress_pct != null ? String(raw.cad_job_progress_pct) : '—'}`,
      `cad_public_url: ${raw.cad_public_url != null ? String(raw.cad_public_url) : '(none)'}`,
      `cad_engine: ${raw.engine != null ? String(raw.engine) : '(unknown)'}`,
    );
  }

  const selected =
    raw.selected_entity && typeof raw.selected_entity === 'object'
      ? /** @type {Record<string, unknown>} */ (raw.selected_entity)
      : null;
  if (selected) {
    lines.push(
      `selected_entity: name=${String(selected.name || selected.id || '?')} type=${String(selected.type || 'prop')} model=${selected.modelUrl != null ? String(selected.modelUrl) : '(none)'}`,
    );
  }

  const spatial =
    raw.spatial && typeof raw.spatial === 'object'
      ? /** @type {Record<string, unknown>} */ (raw.spatial)
      : null;
  if (spatial) {
    const bbox =
      spatial.world_bbox && typeof spatial.world_bbox === 'object'
        ? /** @type {Record<string, unknown>} */ (spatial.world_bbox)
        : null;
    const size =
      bbox?.size && typeof bbox.size === 'object'
        ? /** @type {Record<string, unknown>} */ (bbox.size)
        : null;
    const rot =
      spatial.rotation_euler_deg && typeof spatial.rotation_euler_deg === 'object'
        ? /** @type {Record<string, unknown>} */ (spatial.rotation_euler_deg)
        : null;
    lines.push(
      `spatial_units: ${spatial.units != null ? String(spatial.units) : 'scene'}`,
      `spatial_profile: ${spatial.spawn_profile != null ? String(spatial.spawn_profile) : 'preview'}`,
      `spatial_up_axis: ${spatial.up_axis != null ? String(spatial.up_axis) : '(unknown)'}`,
      `spatial_ground_y: ${spatial.ground_y != null ? String(spatial.ground_y) : '—'}`,
    );
    if (size) {
      lines.push(
        `spatial_world_bbox: W=${Number(size.x ?? 0).toFixed(3)} H=${Number(size.y ?? 0).toFixed(3)} D=${Number(size.z ?? 0).toFixed(3)} (${spatial.units ?? 'scene'})`,
      );
    }
    if (rot) {
      lines.push(
        `spatial_rotation_deg: x=${Number(rot.x ?? 0).toFixed(1)} y=${Number(rot.y ?? 0).toFixed(1)} z=${Number(rot.z ?? 0).toFixed(1)}`,
      );
    }
    lines.push(
      'spatial_actions: User can Snap to grid origin or Set ground Y=0 in inspector; axis triads show model pivot vs world origin.',
    );
  }

  const entities = Array.isArray(raw.entities) ? raw.entities : [];
  if (entities.length) {
    const preview = entities
      .slice(0, 12)
      .map((e) => {
        const row = /** @type {Record<string, unknown>} */ (e);
        const nm = String(row.name || row.id || '?');
        const ty = String(row.type || 'prop');
        const url = row.modelUrl != null ? String(row.modelUrl).slice(0, 80) : '';
        return url ? `${nm} (${ty}, glb)` : `${nm} (${ty})`;
      })
      .join('; ');
    lines.push(`entities_in_viewport: ${preview}`);
  } else if (Number(raw.entity_count ?? 0) === 0) {
    lines.push('entities_in_viewport: (empty — no models loaded yet)');
  }

  lines.push(
    'viewport_contract: When the user asks to build/generate/make a 3D model or CAD part, call cad_generate (engine openscad|freecad|blender) with a short natural-language prompt — do NOT paste OpenSCAD/FreeCAD/Blender source into chat unless they explicitly ask for source code. Poll cad_job_status until done; the Studio viewport auto-spawns the completed GLB. NEVER offer a Download link, .scad/.blend/.fcstd attachment, or "save this file" instead of viewport delivery. NEVER use OpenAI hosted shell for CAD.',
    'creative_actions: Viewport SCENE operators (addCube, deleteSelected, resetScene) are handled locally in AgentSamEngine — do NOT call illustration_create or open Draw/Excalidraw for them. Character animation → meshy_rig then meshy_animate (+ meshy_get_task_status). Create/list Design Studio blueprints with designstudio_blueprint_create / designstudio_blueprint_list (set_active defaults true). 2D floor plans → /dashboard/draw plan mode + excalidraw_export (SVG+PNG); not imgx_generate_image as plan authority. Do not route 2D house plans to OpenSCAD unless the user asks for 3D CAD.',
  );

  return lines.join('\n');
}

/**
 * @param {unknown} browserContext
 * @param {unknown} body
 * @returns {Record<string, unknown>|null}
 */
export function extractDesignStudioContext(browserContext, body) {
  const fromBrowser =
    browserContext && typeof browserContext === 'object'
      ? /** @type {Record<string, unknown>} */ (browserContext).designStudioContext
      : null;
  const ws =
    browserContext &&
    typeof browserContext === 'object' &&
    /** @type {Record<string, unknown>} */ (browserContext).workspaceContext &&
    typeof /** @type {Record<string, unknown>} */ (browserContext).workspaceContext === 'object'
      ? /** @type {Record<string, unknown>} */ (
          /** @type {Record<string, unknown>} */ (browserContext).workspaceContext
        ).designStudioContext
      : null;
  const fromBody =
    body && typeof body === 'object'
      ? /** @type {Record<string, unknown>} */ (body).designStudioContext
      : null;
  const raw =
    fromBrowser && typeof fromBrowser === 'object'
      ? fromBrowser
      : ws && typeof ws === 'object'
        ? ws
        : fromBody && typeof fromBody === 'object'
          ? fromBody
          : null;
  return raw && typeof raw === 'object' ? raw : null;
}
