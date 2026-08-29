/**
 * Shared read windows for fs_read_file (and GitHub fallback).
 * Default posture matches agentsam_github_read: small pages, explicit opt-in to go big.
 */

/** Default page size — same order as agentsam_github_read. */
export const FS_READ_DEFAULT_MAX_BYTES = 32_768;
/** Soft ceiling: above this requires force / force_full / allow_large. */
export const FS_READ_SOFT_CEILING_BYTES = 65_536;
/** Absolute hard max even when forced. */
export const FS_READ_HARD_MAX_BYTES = 512_000;
/** Default margin around line_start/line_end (retrieve → narrow read). */
export const FS_READ_DEFAULT_LINE_MARGIN = 15;
/** Soft max lines per read unless forced. */
export const FS_READ_SOFT_MAX_LINES = 400;

/**
 * @param {Record<string, unknown>} [params]
 * @returns {{
 *   ok: true,
 *   maxBytes: number,
 *   byteOffset: number,
 *   force: boolean,
 *   lineStart: number|null,
 *   lineEnd: number|null,
 *   lineMargin: number,
 * } | { ok: false, error: string, hint?: string, max_bytes?: number, soft_ceiling?: number }}
 */
export function resolveFsReadWindow(params = {}) {
  const force =
    params.force === true ||
    params.force_full === true ||
    params.allow_large === true ||
    params.force === 'true' ||
    params.force_full === 'true' ||
    params.allow_large === 'true';

  let maxBytes =
    Number(params.max_bytes ?? params.maxBytes) > 0
      ? Math.floor(Number(params.max_bytes ?? params.maxBytes))
      : FS_READ_DEFAULT_MAX_BYTES;
  if (!Number.isFinite(maxBytes) || maxBytes < 1) maxBytes = FS_READ_DEFAULT_MAX_BYTES;
  if (maxBytes > FS_READ_HARD_MAX_BYTES) maxBytes = FS_READ_HARD_MAX_BYTES;

  if (maxBytes > FS_READ_SOFT_CEILING_BYTES && !force) {
    return {
      ok: false,
      error: 'fs_read_max_bytes_requires_force',
      max_bytes: maxBytes,
      soft_ceiling: FS_READ_SOFT_CEILING_BYTES,
      hint:
        `max_bytes>${FS_READ_SOFT_CEILING_BYTES} requires force:true (or force_full/allow_large). ` +
        `Prefer line_start/line_end from agentsam_codebase_retrieve, or paginate with max_bytes=${FS_READ_DEFAULT_MAX_BYTES} + byte_offset.`,
    };
  }

  const byteOffset = Math.max(
    0,
    Math.floor(Number(params.byte_offset ?? params.byteOffset ?? params.offset) || 0),
  );

  const rawStart = params.line_start ?? params.lineStart ?? params.start_line ?? params.startLine;
  const rawEnd = params.line_end ?? params.lineEnd ?? params.end_line ?? params.endLine;
  let lineStart =
    rawStart != null && Number(rawStart) > 0 ? Math.floor(Number(rawStart)) : null;
  let lineEnd = rawEnd != null && Number(rawEnd) > 0 ? Math.floor(Number(rawEnd)) : null;
  if (lineStart != null && lineEnd != null && lineEnd < lineStart) {
    const t = lineStart;
    lineStart = lineEnd;
    lineEnd = t;
  }

  let lineMargin = Number(params.line_margin ?? params.lineMargin);
  if (!Number.isFinite(lineMargin) || lineMargin < 0) {
    lineMargin = lineStart != null ? FS_READ_DEFAULT_LINE_MARGIN : 0;
  }
  lineMargin = Math.min(200, Math.floor(lineMargin));

  if (lineStart != null) {
    const spanned =
      lineEnd != null ? lineEnd - lineStart + 1 + lineMargin * 2 : FS_READ_SOFT_MAX_LINES;
    if (spanned > FS_READ_SOFT_MAX_LINES && !force) {
      return {
        ok: false,
        error: 'fs_read_line_range_requires_force',
        soft_max_lines: FS_READ_SOFT_MAX_LINES,
        hint:
          `Line window spans >${FS_READ_SOFT_MAX_LINES} lines. Narrow line_start/line_end, ` +
          `reduce line_margin, or pass force:true for a deliberate large read.`,
      };
    }
  }

  return {
    ok: true,
    maxBytes,
    byteOffset,
    force,
    lineStart,
    lineEnd,
    lineMargin,
  };
}

/**
 * Apply line + byte window to in-memory text (UTF-8 bytes for pagination).
 * @param {string} text
 * @param {ReturnType<typeof resolveFsReadWindow> & { ok: true }} window
 */
export function applyFsReadWindow(text, window) {
  const raw = text == null ? '' : String(text);
  let working = raw;
  let lineStartApplied = null;
  let lineEndApplied = null;
  let totalLines = null;

  if (window.lineStart != null) {
    const lines = raw.split('\n');
    totalLines = lines.length;
    const margin = window.lineMargin || 0;
    const startIdx = Math.max(0, window.lineStart - 1 - margin);
    const endExclusive =
      window.lineEnd != null
        ? Math.min(lines.length, window.lineEnd + margin)
        : Math.min(lines.length, startIdx + FS_READ_SOFT_MAX_LINES);
    working = lines.slice(startIdx, endExclusive).join('\n');
    lineStartApplied = startIdx + 1;
    lineEndApplied = endExclusive;
  }

  const enc = new TextEncoder();
  const bytes = enc.encode(working);
  const offset = Math.min(window.byteOffset || 0, bytes.length);
  const slice = bytes.subarray(offset, offset + window.maxBytes);
  const truncated = offset + slice.length < bytes.length;
  const content = new TextDecoder().decode(slice);

  return {
    content,
    truncated,
    next_byte_offset: truncated ? offset + slice.length : null,
    byte_offset: offset,
    max_bytes: window.maxBytes,
    total_bytes: bytes.length,
    total_lines: totalLines,
    line_start: lineStartApplied,
    line_end: lineEndApplied,
    source_chars: raw.length,
  };
}
