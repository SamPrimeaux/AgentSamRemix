/**
 * Job-level structural_quality from per-file receipts (not a queue placeholder).
 * Degraded only when parse failures are material; empty/unavailable alone is not degraded.
 *
 * @param {Record<string, number>} byQuality
 * @param {{ parse_failed_paths?: string[], rolled_up_at?: string }} [opts]
 */
export function rollupJobStructuralQuality(byQuality, opts = {}) {
  const known = ['treesitter', 'structure_empty', 'unavailable', 'parse_failed'];
  /** @type {Record<string, number>} */
  const counts = {
    treesitter: 0,
    structure_empty: 0,
    unavailable: 0,
    parse_failed: 0,
    other: 0,
  };
  for (const [rawKey, rawN] of Object.entries(byQuality || {})) {
    const key = rawKey == null || rawKey === '' ? '(null)' : String(rawKey);
    const n = Math.max(0, Number(rawN) || 0);
    if (known.includes(key)) counts[key] += n;
    else counts.other += n;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const structuralAttempted = counts.treesitter + counts.structure_empty + counts.parse_failed;
  const samplePaths = Array.isArray(opts.parse_failed_paths)
    ? opts.parse_failed_paths.map((p) => String(p)).filter(Boolean).slice(0, 10)
    : [];
  const rolledUpAt =
    typeof opts.rolled_up_at === 'string' && opts.rolled_up_at
      ? opts.rolled_up_at
      : new Date().toISOString();

  /** @type {string} */
  let structural_quality = 'pending';
  /** @type {string|null} */
  let reason = null;

  if (total === 0) {
    structural_quality = 'pending';
    reason = 'no_job_file_quality_rows';
  } else if (counts.parse_failed > 0) {
    const failRatio = counts.parse_failed / Math.max(1, structuralAttempted);
    if (counts.parse_failed >= 10 || failRatio >= 0.05) {
      structural_quality = 'degraded';
      reason = `parse_failed=${counts.parse_failed} of ${structuralAttempted} structural attempts (ratio=${failRatio.toFixed(3)})`;
    } else if (counts.treesitter > 0) {
      structural_quality = 'treesitter';
      reason = `mostly_ok_with_parse_failed=${counts.parse_failed}`;
    } else {
      structural_quality = 'degraded';
      reason = `parse_failed=${counts.parse_failed}_without_treesitter`;
    }
  } else if (counts.treesitter > 0) {
    structural_quality = 'treesitter';
    reason =
      counts.structure_empty || counts.unavailable
        ? `ok_with_empty=${counts.structure_empty}_unavailable=${counts.unavailable}`
        : null;
  } else if (counts.structure_empty > 0) {
    structural_quality = 'structure_empty';
    reason = 'no_treesitter_symbols_all_structure_empty';
  } else {
    structural_quality = 'unavailable';
    reason = 'no_treesitter_or_structure_empty_files';
  }

  return {
    structural_quality,
    structural_quality_breakdown: {
      ...counts,
      total_files_with_quality: total,
      reason,
      parse_failed_sample_paths: samplePaths,
      rolled_up_at: rolledUpAt,
    },
  };
}
