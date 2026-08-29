import type {
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowRunsSummary,
} from '../workflowTypes';
import { autoLayoutNodes, hasExplicitPosition } from './workflowLayout';

function readSignedOff(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (o.signed_off === true) return true;
    const mode = String(o.automation_mode || '').toLowerCase();
    return mode === 'trusted' || mode === 'signed_off';
  }
  try {
    const o = JSON.parse(String(raw));
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    if (o.signed_off === true) return true;
    const mode = String(o.automation_mode || '').toLowerCase();
    return mode === 'trusted' || mode === 'signed_off';
  } catch {
    return false;
  }
}

type GraphPayload = {
  workflow: Record<string, unknown>;
  registry_workflow_id?: string;
  dag_workflow_id?: string;
  nodes?: Record<string, unknown>[];
  edges?: Record<string, unknown>[];
  canvas_layout?: Record<string, { x?: number; y?: number }>;
  runs_summary?: WorkflowRunsSummary | null;
};

export function mapGraphPayload(payload: GraphPayload): WorkflowGraph {
  const w = payload.workflow;
  const rawNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const rawEdges = Array.isArray(payload.edges) ? payload.edges : [];
  const layout =
    payload.canvas_layout && typeof payload.canvas_layout === 'object' ? payload.canvas_layout : {};

  const nodes: WorkflowGraphNode[] = rawNodes.map((n, i) => {
    const nodeKey = String(n.node_key ?? n.id ?? `node_${i + 1}`);
    const saved = layout[nodeKey];
    const posX = n.pos_x != null ? Number(n.pos_x) : saved?.x != null ? Number(saved.x) : null;
    const posY = n.pos_y != null ? Number(n.pos_y) : saved?.y != null ? Number(saved.y) : null;
    return {
      id: nodeKey,
      node_key: nodeKey,
      node_type: String(n.node_type ?? 'agent'),
      title: String(n.title ?? n.display_name ?? nodeKey),
      description: n.description != null ? String(n.description) : null,
      handler_key: n.handler_key != null ? String(n.handler_key) : null,
      sort_order: Number(n.sort_order ?? i * 10),
      risk_level: n.risk_level != null ? String(n.risk_level) : null,
      requires_approval: n.requires_approval != null ? !!n.requires_approval : undefined,
      pos_x: posX,
      pos_y: posY,
      x: posX ?? 60 + (i % 3) * 240,
      y: posY ?? 80 + Math.floor(i / 3) * 130,
      input_json: n.input_json,
      output_json: n.output_json,
      metadata_json: n.metadata_json,
    };
  });

  const edges: WorkflowGraphEdge[] = rawEdges
    .map((e, i) => ({
      id: String(e.id ?? `edge_${i + 1}`),
      from: String(e.from_node_key ?? e.from ?? ''),
      to: String(e.to_node_key ?? e.to ?? ''),
      label: e.label != null ? String(e.label) : null,
    }))
    .filter((e) => e.from && e.to);

  const anyExplicit = nodes.some(hasExplicitPosition);
  if (!anyExplicit && nodes.length) {
    const auto = autoLayoutNodes(nodes, edges);
    nodes.forEach((n) => {
      const p = auto[n.node_key];
      if (p) {
        n.x = p.x;
        n.y = p.y;
      }
    });
  } else {
    nodes.forEach((n) => {
      if (hasExplicitPosition(n)) {
        n.x = Number(n.pos_x ?? n.x);
        n.y = Number(n.pos_y ?? n.y);
      }
    });
  }

  const executionOrder = rawNodes
    .slice()
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    .map((n) => String(n.node_key ?? ''))
    .filter(Boolean);

  const signedOff = readSignedOff(w.metadata_json);
  return {
    registryId: String(payload.registry_workflow_id ?? w.id ?? ''),
    workflowKey: String(w.workflow_key ?? ''),
    displayName: String(w.display_name ?? w.workflow_key ?? w.id ?? 'Workflow'),
    description: w.description != null ? String(w.description) : undefined,
    riskLevel: w.risk_level != null ? String(w.risk_level) : null,
    signedOff,
    requiresApproval: !signedOff && nodes.some((node) => node.requires_approval === true),
    dagWorkflowId: String(payload.dag_workflow_id ?? w.id ?? ''),
    nodes,
    edges,
    executionOrder,
    runsSummary: payload.runs_summary ?? null,
    registryWorkflow: w,
  };
}

export function safeJsonParse(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  try {
    const o = JSON.parse(String(raw));
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function pickModelFields(
  step: Record<string, unknown>,
): {
  model_key?: string;
  provider?: string;
  quality_score?: number | null;
  latency_ms?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  cost_usd?: number | null;
} {
  const input = safeJsonParse(step.input_json);
  const output = safeJsonParse(step.output_json);
  const meta = safeJsonParse(step.metadata_json);
  const model_key =
    (step.model_key as string) ||
    (input?.model_key as string) ||
    (input?.model as string) ||
    (output?.model_key as string) ||
    (meta?.model_key as string) ||
    undefined;
  const provider =
    (step.provider as string) ||
    (input?.provider as string) ||
    (meta?.provider as string) ||
    undefined;
  return {
    model_key,
    provider,
    quality_score: step.quality_score != null ? Number(step.quality_score) : null,
    latency_ms: step.latency_ms != null ? Number(step.latency_ms) : null,
    tokens_in: step.tokens_in != null ? Number(step.tokens_in) : null,
    tokens_out: step.tokens_out != null ? Number(step.tokens_out) : null,
    cost_usd: step.cost_usd != null ? Number(step.cost_usd) : null,
  };
}
