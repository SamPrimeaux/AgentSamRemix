/**
 * Tool ceiling from agentsam_tools.modes_json — mode decides what may run.
 * No task_type involvement.
 */

/**
 * @param {unknown} modesJson
 * @returns {string[]}
 */
export function parseToolModesJson(modesJson) {
  if (modesJson == null) return [];
  let cur = modesJson;
  for (let i = 0; i < 4; i += 1) {
    if (Array.isArray(cur)) {
      return cur.map((m) => String(m || '').trim().toLowerCase()).filter(Boolean);
    }
    if (typeof cur !== 'string') return [];
    const s = cur.trim();
    if (!s) return [];
    try {
      cur = JSON.parse(s);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * @param {unknown} modesJson
 * @param {string} mode
 * @returns {boolean}
 */
export function toolAllowsExecutionMode(modesJson, mode) {
  const m = String(mode || 'agent').trim().toLowerCase();
  if (!m) return false;
  const modes = parseToolModesJson(modesJson);
  if (!modes.length) return m === 'agent'; // fail closed-ish: empty → agent-only
  // Strip legacy auto from allow checks
  const cleaned = modes.filter((x) => x !== 'auto' && x !== 'chat');
  if (!cleaned.length) return m === 'agent';
  return cleaned.includes(m);
}

/**
 * Filter tool rows or tool defs that carry modes_json / _modes_json.
 * @template T
 * @param {T[]} tools
 * @param {string} mode
 * @param {(row: T) => unknown} [getModesJson]
 * @returns {T[]}
 */
export function filterToolsByExecutionMode(tools, mode, getModesJson = null) {
  const list = Array.isArray(tools) ? tools : [];
  const getter =
    typeof getModesJson === 'function'
      ? getModesJson
      : (row) =>
          row?.modes_json ??
          row?._modes_json ??
          row?.modesJson ??
          row?.raw?.modes_json ??
          null;
  return list.filter((row) => toolAllowsExecutionMode(getter(row), mode));
}
