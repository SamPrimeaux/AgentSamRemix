/**
 * OpenSCAD library resolver — retrieves relevant library import lines from D1
 * based on capability tags extracted from the user's CAD intent/prompt.
 *
 * Called by generateCadScriptJob() before building the system prompt.
 * Returns only what the script needs — not a full library dump.
 *
 * D1 table: agentsam_openscad_libraries (migration 775)
 */

// ─── Capability tag extraction ────────────────────────────────────────────────
// Maps keywords found in the user prompt/intent to library capability_tags.
// Keep this flat and fast — no regex, just lowercase substring checks.

const KEYWORD_TO_TAGS = [
  // Rounding / smoothing
  [['round', 'fillet', 'chamfer', 'smooth', 'bevel', 'curved edge'], ['rounding', 'chamfer', 'fillet']],
  // Threading / fasteners
  [['thread', 'bolt', 'nut', 'screw', 'm3', 'm4', 'm5', 'm6', 'metric thread', 'tap', 'fastener'], ['thread', 'threading', 'bolt', 'nut', 'screw', 'fastener', 'nutcatch', 'nut_trap', 'screw_hole', 'clearance_hole', 'countersink']],
  // Enclosures / boxes
  [['enclosure', 'box', 'case', 'lid', 'two part', 'two-part', 'hinged', 'snap fit', 'project box'], ['enclosure', 'project_box', 'two_part_box', 'snap_fit', 'lid', 'hinged_box']],
  // PCB / electronics
  [['pcb', 'raspberry pi', 'arduino', 'usb', 'hdmi', 'fan', 'cutout', 'panel', 'standoff', 'iec', 'socket', 'electronics'], ['pcb', 'standoff', 'usb', 'hdmi', 'cutout', 'panel', 'fan', 'electronics', 'real_hardware']],
  // Tray / organizer
  [['tray', 'organizer', 'drawer', 'insert', 'storage', 'compartment', 'divider', 'bin'], ['tray', 'organizer', 'drawer', 'insert', 'storage', 'compartment', 'bin', 'grid_bin', 'subdivision']],
  // Spiral / curves / organic
  [['spiral', 'helix', 'coil', 'curve', 'sweep', 'loft', 'voronoi', 'organic', 'wave', 'twist'], ['spiral', 'helix', 'bezier', 'curve', 'path_sweep', 'voronoi', 'organic', 'loft', 'sweep']],
  // Math surfaces / terrain
  [['math', 'function', 'surface', 'terrain', 'parametric surface', 'wave surface', 'plot'], ['math_surface', 'function_plot', 'parametric_surface', 'terrain', 'wave', 'mathematical']],
  // SVG / path profiles
  [['svg', 'path', 'profile', '2d shape', 'arc', 'complex profile'], ['svg_path', '2d_path', 'fillet', 'complex_profile', 'bezier_path', 'arc']],
  // Standard parts / ISO
  [['iso', 'standard part', 'bearing', 'extrusion', '2020', '608', 'i-beam', 'profile', 'spec'], ['iso_bolt', 'bearing', 'profile', 'i_beam', 't_slot', 'standard_part', '2020_extrusion', '608_bearing']],
  // Mating parts / snap fit
  [['mate', 'mating', 'fit together', 'snap', 'press fit', 'sliding', 'joint', 'complement'], ['mating_parts', 'snap_fit', 'press_fit', 'sliding_joint', 'constraint', 'complementary']],
  // Dimension annotations
  [['dimension', 'annotation', 'callout', 'measurement', 'technical drawing', 'fabrication drawing'], ['dimension', 'annotation', 'technical_drawing', 'linear_dimension']],
  // Board game
  [['board game', 'boardgame', 'insert', 'token', 'meeple', 'dice tray'], ['board_game', 'insert', 'tray', 'tessellation', 'token', 'meeple', 'dice_tray']],
  // Architecture / panel
  [['wall', 'panel', 'floor', 'roof', 'room', 'architecture', 'massing', 'house'], ['panel', 'wall', 'floor', 'roof', 'architecture', 'massing']],
  // Polyhedron / organic shell
  [['shell', 'vase', 'cross section', 'layered', 'hollow', 'organic shape'], ['polyhedron', 'point_layer', 'organic_shell', 'vase', 'cross_section']],
];

/**
 * Extract capability tags from a prompt string.
 * @param {string} prompt
 * @returns {string[]} deduplicated tag list
 */
export function extractCapabilityTags(prompt) {
  const lower = String(prompt || '').toLowerCase();
  const tags = new Set();

  for (const [keywords, matched_tags] of KEYWORD_TO_TAGS) {
    if (keywords.some(kw => lower.includes(kw))) {
      matched_tags.forEach(t => tags.add(t));
    }
  }

  return [...tags];
}

// ─── D1 retrieval ─────────────────────────────────────────────────────────────

/**
 * Fetch relevant library rows from D1 based on extracted tags.
 * Returns only active, commercially-safe rows by default.
 *
 * @param {any} env - Cloudflare Worker env with env.DB
 * @param {string[]} tags - from extractCapabilityTags()
 * @param {{ allowGpl?: boolean, maxLibs?: number }} [opts]
 * @returns {Promise<Array<{slug:string, display_name:string, import_line:string, notes:string}>>}
 */
export async function resolveOpenScadLibraries(env, tags, opts = {}) {
  const { allowGpl = false, maxLibs = 6 } = opts;

  if (!env?.DB) return [];
  if (!tags?.length) return [];

  try {
    const commercialFilter = allowGpl ? '' : 'AND commercial_safe = 1';
    const { results } = await env.DB.prepare(
      `SELECT slug, display_name, import_line, capability_tags, notes, priority
       FROM agentsam_openscad_libraries
       WHERE active = 1 ${commercialFilter}
       ORDER BY priority ASC`,
    ).all();

    if (!results?.length) return [];

    // Filter to rows whose capability_tags overlap with requested tags
    const tagSet = new Set(tags);
    const matched = results.filter(row => {
      try {
        const rowTags = JSON.parse(row.capability_tags || '[]');
        return rowTags.some(t => tagSet.has(t));
      } catch {
        return false;
      }
    });

    // Always prepend BOSL2 if any mechanical/geometry work is detected
    // (it's the stdlib — safe to include when relevant)
    const bosl2 = results.find(r => r.slug === 'bosl2');
    const hasMechanical = tags.some(t =>
      ['rounding', 'chamfer', 'fillet', 'thread', 'bolt', 'mechanical', 'anchor'].includes(t),
    );
    const hasBosl2 = matched.some(r => r.slug === 'bosl2');
    if (bosl2 && hasMechanical && !hasBosl2) {
      matched.unshift(bosl2);
    }

    // Deduplicate + limit
    const seen = new Set();
    const deduped = matched.filter(r => {
      if (seen.has(r.slug)) return false;
      seen.add(r.slug);
      return true;
    });

    return deduped.slice(0, maxLibs);
  } catch (e) {
    console.warn('[resolveOpenScadLibraries] D1 error:', e?.message ?? e);
    return [];
  }
}

// ─── System prompt fragment builder ───────────────────────────────────────────

/**
 * Build a compact system prompt fragment listing available libraries.
 * This replaces the old full-doc injection.
 *
 * @param {Array<{slug:string, display_name:string, import_line:string, notes:string}>} libs
 * @returns {string}
 */
export function buildLibraryPromptFragment(libs) {
  if (!libs?.length) return '';

  const lines = libs.map(lib => {
    // Trim notes to first sentence only — keep it tight
    const shortNote = String(lib.notes || '').split('.')[0].trim();
    return `// ${lib.display_name}${shortNote ? ` — ${shortNote}` : ''}\n${lib.import_line}`;
  });

  return (
    `\n\n// ─── Available libraries (pre-installed on runner) ───\n` +
    `// Use these instead of re-implementing primitives from scratch.\n` +
    lines.join('\n') +
    `\n// ─────────────────────────────────────────────────────`
  );
}

// ─── Convenience: resolve + build in one call ─────────────────────────────────

/**
 * Full pipeline: prompt → tags → D1 → formatted fragment.
 * Drop-in for use in generateCadScriptJob().
 *
 * @param {any} env
 * @param {string} prompt
 * @param {{ allowGpl?: boolean }} [opts]
 * @returns {Promise<string>} fragment to append to system prompt
 */
export async function resolveLibraryFragment(env, prompt, opts = {}) {
  const tags = extractCapabilityTags(prompt);
  if (!tags.length) return '';
  const libs = await resolveOpenScadLibraries(env, tags, opts);
  return buildLibraryPromptFragment(libs);
}
