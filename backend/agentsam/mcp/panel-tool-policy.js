/**
 * MCP panel tool allowlist — glob match / filter only.
 */

/** Wildcard glob match for MCP panel tool allowlists (e.g. `d1_*`, `*`). */
export function mcpPanelToolMatchesGlob(toolName, pattern) {
  const n = String(toolName || '').trim();
  const p = String(pattern || '').trim();
  if (!n || !p) return false;
  if (p === '*' || p === '**') return true;
  const esc = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  try {
    return new RegExp(`^${esc}$`, 'i').test(n);
  } catch {
    return false;
  }
}

export function filterToolsForMcpPanelGlobs(tools, globs) {
  if (!Array.isArray(tools) || !tools.length) return [];
  if (!Array.isArray(globs) || !globs.length) return tools;
  const list = globs.map((g) => String(g || '').trim()).filter(Boolean);
  if (!list.length) return tools;
  return tools.filter((t) => list.some((g) => mcpPanelToolMatchesGlob(t?.name, g)));
}

/** @param {unknown} raw */
export function parseMcpPanelToolGlobs(raw) {
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw || '[]');
      return Array.isArray(j) ? j.map((g) => String(g || '').trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) {
    return raw.map((g) => String(g || '').trim()).filter(Boolean);
  }
  return [];
}
