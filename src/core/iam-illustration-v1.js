/**
 * iam.illustration.v1 — SSOT envelope for sketch (Excalidraw) vs CAD (Design Studio) lanes.
 */

export const ILLUSTRATION_SCHEMA = 'iam.illustration.v1';

export const ILLUSTRATION_INTENTS = Object.freeze([
  'sketch',
  'diagram',
  'wireframe',
  'house_floor_plan',
  'blueprint',
  'floor_plan',
  'model_3d',
  'sculpt',
  'plan_map',
  'other',
]);

export const ILLUSTRATION_FIDELITIES = Object.freeze([
  'sketch',
  'diagram',
  'technical_2d',
  'architectural_3d',
  'structural',
]);

export const ILLUSTRATION_ENGINES = Object.freeze([
  'auto',
  'excalidraw',
  'openscad',
  'freecad',
  'blender',
  'meshy',
]);

export const ILLUSTRATION_LANES = Object.freeze(['excalidraw', 'cad', 'meshy']);

const EXCALIDRAW_INTENTS = new Set(['sketch', 'diagram', 'wireframe', 'plan_map']);
const CAD_INTENTS = new Set(['house_floor_plan', 'blueprint', 'floor_plan']);
const MESHY_INTENTS = new Set(['model_3d', 'sculpt']);

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function lower(v) {
  return trim(v).toLowerCase();
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>|null}
 */
export function parseIllustrationEnvelope(raw) {
  if (raw == null) return null;
  let body = raw;
  if (typeof raw === 'string') {
    try {
      body = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = /** @type {Record<string, unknown>} */ (body);
  const nested =
    b.illustration ??
    b.illustration_envelope ??
    b.envelope ??
    (lower(b.schema).startsWith('iam.illustration') ? b : null);
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return /** @type {Record<string, unknown>} */ (nested);
  }
  if (lower(b.schema) === ILLUSTRATION_SCHEMA || b.intent != null || b.fidelity != null) {
    return b;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} envelope
 * @param {{ workspaceId?: string|null, tenantId?: string|null, userId?: string|null, title?: string|null }} ctx
 */
export function normalizeIllustrationEnvelope(envelope, ctx = {}) {
  const out = { ...envelope };
  out.schema = ILLUSTRATION_SCHEMA;
  out.intent = lower(out.intent || 'sketch') || 'sketch';
  out.fidelity = lower(out.fidelity || 'sketch') || 'sketch';
  out.engine = lower(out.engine || 'auto') || 'auto';
  out.workspace_id = trim(out.workspace_id || ctx.workspaceId || '');
  out.tenant_id = trim(out.tenant_id || ctx.tenantId || '');
  out.user_id = trim(out.user_id || ctx.userId || '');
  out.title = trim(out.title || ctx.title || 'Illustration');
  out.brief = trim(out.brief || out.prompt || out.description || '');
  if (out.constraints == null) out.constraints = {};
  if (!out.constraints || typeof out.constraints !== 'object' || Array.isArray(out.constraints)) {
    out.constraints = {};
  }
  if (out.payload == null) out.payload = {};
  if (!out.payload || typeof out.payload !== 'object' || Array.isArray(out.payload)) {
    out.payload = {};
  }
  if (out.references == null) out.references = [];
  if (!Array.isArray(out.references)) out.references = [];
  out.open_after_create = out.open_after_create !== false && out.open_after_create !== 0;
  return out;
}

/**
 * @param {Record<string, unknown>} envelope
 */
export function validateIllustrationEnvelope(envelope) {
  const errors = [];
  if (lower(envelope.schema) !== ILLUSTRATION_SCHEMA) {
    errors.push(`schema must be ${ILLUSTRATION_SCHEMA}`);
  }
  const intent = lower(envelope.intent);
  if (intent && !ILLUSTRATION_INTENTS.includes(intent)) {
    errors.push(`intent must be one of: ${ILLUSTRATION_INTENTS.join(', ')}`);
  }
  const fidelity = lower(envelope.fidelity);
  if (fidelity && !ILLUSTRATION_FIDELITIES.includes(fidelity)) {
    errors.push(`fidelity must be one of: ${ILLUSTRATION_FIDELITIES.join(', ')}`);
  }
  const engine = lower(envelope.engine);
  if (engine && !ILLUSTRATION_ENGINES.includes(engine)) {
    errors.push(`engine must be one of: ${ILLUSTRATION_ENGINES.join(', ')}`);
  }
  if (!trim(envelope.workspace_id)) errors.push('workspace_id required');
  if (!trim(envelope.tenant_id)) errors.push('tenant_id required');
  if (!trim(envelope.user_id)) errors.push('user_id required');
  if (!trim(envelope.brief) && !hasIllustrationPayload(envelope)) {
    errors.push('brief or payload required');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * @param {Record<string, unknown>} envelope
 */
function hasIllustrationPayload(envelope) {
  const payload = envelope.payload;
  if (!payload || typeof payload !== 'object') return false;
  const p = /** @type {Record<string, unknown>} */ (payload);
  if (Array.isArray(p.elements) && p.elements.length > 0) return true;
  if (trim(p.plan_id)) return true;
  if (trim(p.prompt)) return true;
  return false;
}

/**
 * @param {Record<string, unknown>} envelope
 * @returns {{ engine: string, lane: string }}
 */
export function resolveIllustrationRoute(envelope) {
  const engine = lower(envelope.engine);
  if (engine && engine !== 'auto') {
    if (engine === 'excalidraw') return { engine: 'excalidraw', lane: 'excalidraw' };
    if (engine === 'meshy') return { engine: 'meshy', lane: 'meshy' };
    return { engine, lane: 'cad' };
  }

  const intent = lower(envelope.intent);
  const fidelity = lower(envelope.fidelity);

  if (MESHY_INTENTS.has(intent) || fidelity === 'architectural_3d' && intent === 'model_3d') {
    return { engine: 'meshy', lane: 'meshy' };
  }

  if (
    EXCALIDRAW_INTENTS.has(intent) ||
    fidelity === 'sketch' ||
    fidelity === 'diagram' ||
    (intent === 'other' && (fidelity === 'sketch' || fidelity === 'diagram'))
  ) {
    return { engine: 'excalidraw', lane: 'excalidraw' };
  }

  if (CAD_INTENTS.has(intent)) {
    if (fidelity === 'architectural_3d') {
      return { engine: 'freecad', lane: 'cad' };
    }
    if (fidelity === 'structural') {
      return { engine: 'openscad', lane: 'cad' };
    }
    // 2D floor plans / blueprints: agent uses imgx or inline SVG (not OpenSCAD).
    return { engine: 'excalidraw', lane: 'excalidraw' };
  }

  if (fidelity === 'architectural_3d') {
    return { engine: 'freecad', lane: 'cad' };
  }

  return { engine: 'excalidraw', lane: 'excalidraw' };
}

/**
 * Dashboard / agent surface hints from route result.
 * @param {{ lane: string, engine: string }} route
 */
export function illustrationSurfaceFromRoute(route) {
  if (route.lane === 'excalidraw') {
    return { surface: 'excalidraw', dashboard_path: '/dashboard/draw' };
  }
  if (route.lane === 'meshy' || route.lane === 'cad') {
    return { surface: 'designstudio', dashboard_path: '/dashboard/designstudio' };
  }
  return { surface: 'excalidraw', dashboard_path: '/dashboard/draw' };
}
