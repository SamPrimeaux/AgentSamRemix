const RISK_ORDER = ['low', 'medium', 'high', 'critical'];

export function evaluateEdge(edge, nodeOutput) {
  let cond = {};
  try { cond = JSON.parse(edge.condition_json || '{}'); } catch { cond = {}; }
  const ctype = String(edge.condition_type || 'always').toLowerCase();
  switch (ctype) {
    case 'always': return true;
    case 'status': {
      const expected = cond.from_status;
      const actual = nodeOutput?.ok ? 'success' : 'failed';
      return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
    }
    case 'risk': {
      if (cond.requires_approval) return nodeOutput?.output?.risk_level === 'high';
      if (cond.max_risk_level) {
        const lvl = RISK_ORDER.indexOf(String(nodeOutput?.output?.risk_level || 'low').toLowerCase());
        const max = RISK_ORDER.indexOf(String(cond.max_risk_level).toLowerCase());
        return lvl >= 0 && max >= 0 && lvl <= max;
      }
      return true;
    }
    case 'field':
    case 'output': {
      const val = nodeOutput?.output?.[cond.field] ?? nodeOutput?.output?.pass ?? nodeOutput?.[cond.field];
      if (cond.op === 'eq') return val === cond.value;
      if (cond.op === 'neq') return val !== cond.value;
      if (cond.equals != null) return val === cond.equals;
      return val != null;
    }
    case 'branch': {
      const branch = nodeOutput?.output?.branch ?? nodeOutput?.output?.[cond.field];
      if (cond.op === 'eq' || !cond.op) return branch === cond.value;
      if (cond.op === 'neq') return branch !== cond.value;
      return branch != null;
    }
    default: return false;
  }
}

export function buildEdgeMap(edges) {
  const map = {};
  for (const edge of edges || []) {
    if (!map[edge.from_node_key]) map[edge.from_node_key] = [];
    map[edge.from_node_key].push(edge);
  }
  return map;
}

export function selectNextEdge(edgeMap, nodeKey, nodeOutput) {
  const outEdges = [...(edgeMap[nodeKey] || [])].sort((a, b) => {
    if (a.is_fallback !== b.is_fallback) return a.is_fallback ? 1 : -1;
    return (a.priority || 0) - (b.priority || 0);
  });
  for (const edge of outEdges) {
    if (evaluateEdge(edge, nodeOutput)) return edge;
  }
  return null;
}
