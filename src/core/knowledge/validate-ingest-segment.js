/**
 * Lightweight validation against docs/platform/schemas/agentsam-knowledge/ingest-segment.schema.json
 * (no AJV in the Worker bundle — keep required fields + grounding shape aligned with the schema).
 */

const LANES = new Set(['docs', 'media', 'code', 'schema', 'memory', 'archive']);

const GROUNDING_KINDS = new Set([
  'pdf_page',
  'pdf_bbox',
  'sheet_cell',
  'email_message',
  'audio_ms',
  'video_ms',
  'r2_object',
  'url',
  'other',
]);

const EXTRACTION_METHODS = new Set(['native', 'ocr', 'hybrid', 'api', 'ast', 'other']);

/**
 * @param {unknown} input
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, errors: string[] }}
 */
export function validateIngestSegmentInput(input) {
  const errors = [];
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['input must be an object'] };
  }
  const v = /** @type {Record<string, unknown>} */ (input);

  const lane = String(v.lane ?? '').trim();
  if (!LANES.has(lane)) errors.push(`lane must be one of ${[...LANES].join('|')}`);

  for (const key of [
    'workspace_id_d1',
    'source_snapshot_id',
    'knowledge_object_id',
    'segment_id',
    'projection_key',
  ]) {
    const s = v[key] != null ? String(v[key]).trim() : '';
    if (!s) errors.push(`${key} required`);
  }

  if (v.ordinal != null) {
    const n = Number(v.ordinal);
    if (!Number.isInteger(n) || n < 0) errors.push('ordinal must be a non-negative integer');
  }

  if (v.grounding != null) {
    if (!Array.isArray(v.grounding)) {
      errors.push('grounding must be an array');
    } else {
      v.grounding.forEach((g, i) => {
        if (g == null || typeof g !== 'object' || Array.isArray(g)) {
          errors.push(`grounding[${i}] must be an object`);
          return;
        }
        const kind = String(/** @type {Record<string, unknown>} */ (g).kind ?? '').trim();
        if (!GROUNDING_KINDS.has(kind)) {
          errors.push(`grounding[${i}].kind invalid`);
        }
        const method = /** @type {Record<string, unknown>} */ (g).extractionMethod;
        if (method != null && !EXTRACTION_METHODS.has(String(method))) {
          errors.push(`grounding[${i}].extractionMethod invalid`);
        }
        const conf = /** @type {Record<string, unknown>} */ (g).confidence;
        if (conf != null) {
          const c = Number(conf);
          if (!Number.isFinite(c) || c < 0 || c > 1) {
            errors.push(`grounding[${i}].confidence must be 0..1`);
          }
        }
      });
    }
  }

  if (v.tags != null && !Array.isArray(v.tags)) {
    errors.push('tags must be an array of strings');
  }

  if (v.metadata != null && (typeof v.metadata !== 'object' || Array.isArray(v.metadata))) {
    errors.push('metadata must be an object');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: v };
}
