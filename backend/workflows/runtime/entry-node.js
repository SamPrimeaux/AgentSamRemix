function safeJson(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try { return JSON.parse(String(raw || '{}')) || {}; } catch { return {}; }
}

export function resolveEntryNode(workflow, nodes, edges) {
  const meta = safeJson(workflow?.metadata_json);
  if (meta.entry_node_key) {
    const found = nodes.find((n) => n.node_key === meta.entry_node_key);
    if (found) return found;
  }
  const triggers = nodes.filter((n) => n.node_type === 'trigger');
  if (triggers.length === 1) return triggers[0];
  const toKeys = new Set((edges || []).map((e) => e.to_node_key));
  const roots = nodes.filter((n) => !toKeys.has(n.node_key));
  if (roots.length === 1) return roots[0];
  return nodes[0] ?? null;
}
