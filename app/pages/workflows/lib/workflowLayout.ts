import type { WorkflowGraphEdge, WorkflowGraphNode } from '../workflowTypes';

const COL_W = 260;
const ROW_H = 130;
const ORIGIN_X = 60;
const ORIGIN_Y = 80;

export function hasExplicitPosition(node: WorkflowGraphNode): boolean {
  if (node.pos_x != null && node.pos_y != null) return true;
  if (node.x != null && node.y != null && (node.x !== 60 || node.y !== 80)) {
    const fromLayoutOnly = node.pos_x == null && node.pos_y == null;
    if (!fromLayoutOnly) return true;
  }
  return node.pos_x != null || node.pos_y != null;
}

/** Layered auto-layout when pos_x/pos_y are absent. */
export function autoLayoutNodes(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
): Record<string, { x: number; y: number }> {
  const keys = nodes.map((n) => n.node_key);
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  keys.forEach((k) => {
    inDeg.set(k, 0);
    adj.set(k, []);
  });
  edges.forEach((e) => {
    if (!adj.has(e.from) || !inDeg.has(e.to)) return;
    adj.get(e.from)!.push(e.to);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  });

  const layers: string[][] = [];
  let queue = keys.filter((k) => (inDeg.get(k) ?? 0) === 0);
  if (!queue.length) {
    queue = [...keys].sort(
      (a, b) =>
        (nodes.find((n) => n.node_key === a)?.sort_order ?? 0) -
        (nodes.find((n) => n.node_key === b)?.sort_order ?? 0),
    );
  }
  const visited = new Set<string>();
  while (queue.length) {
    layers.push(queue);
    const next: string[] = [];
    for (const k of queue) {
      visited.add(k);
      for (const t of adj.get(k) ?? []) {
        inDeg.set(t, (inDeg.get(t) ?? 1) - 1);
        if ((inDeg.get(t) ?? 0) <= 0 && !visited.has(t)) next.push(t);
      }
    }
    queue = [...new Set(next)];
  }
  const remaining = keys.filter((k) => !visited.has(k));
  if (remaining.length) layers.push(remaining);

  const pos: Record<string, { x: number; y: number }> = {};
  layers.forEach((layer, li) => {
    layer.forEach((key, ni) => {
      const row = Math.floor(ni / 2);
      const col = ni % 2;
      pos[key] = {
        x: ORIGIN_X + li * COL_W + col * 24,
        y: ORIGIN_Y + row * ROW_H,
      };
    });
  });
  return pos;
}

export function resolveInitialPositions(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  const needsAuto: WorkflowGraphNode[] = [];

  for (const n of nodes) {
    if (hasExplicitPosition(n)) {
      pos[n.node_key] = {
        x: Number(n.pos_x ?? n.x ?? ORIGIN_X),
        y: Number(n.pos_y ?? n.y ?? ORIGIN_Y),
      };
    } else {
      needsAuto.push(n);
    }
  }

  if (needsAuto.length) {
    const auto = autoLayoutNodes(needsAuto.length === nodes.length ? nodes : needsAuto, edges);
    Object.assign(pos, auto);
  }

  return pos;
}
