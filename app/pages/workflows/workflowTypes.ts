/** UI node categories (mapped to D1 node_type on save). */
export type WorkflowUiNodeType =
  | 'trigger'
  | 'agent'
  | 'mcp_tool'
  | 'terminal'
  | 'db_query'
  | 'script'
  | 'approval_gate'
  | 'branch'
  | 'webhook'
  | 'eval'
  | 'process'
  | 'output';

export type NodeStatus = 'idle' | 'running' | 'completed' | 'failed';

export type WorkflowRunsSummary = {
  run_count: number;
  success_count: number;
  fail_count: number;
  success_rate: number | null;
  fail_rate: number | null;
  avg_cost_usd: number | null;
  total_tokens?: number;
};

export type WorkflowListItem = {
  id: string;
  workflow_key: string;
  display_name: string;
  description?: string | null;
  risk_level?: string | null;
  requires_approval?: number | boolean;
  metadata_json?: string | Record<string, unknown> | null;
  signed_off?: boolean;
  node_count?: number;
  edge_count?: number;
  run_count?: number;
  success_count?: number;
  fail_count?: number;
  avg_cost_usd?: number | null;
};

export type WorkflowGraphNode = {
  id: string;
  node_key: string;
  node_type: string;
  title: string;
  description?: string | null;
  handler_key?: string | null;
  sort_order?: number;
  risk_level?: string | null;
  requires_approval?: boolean;
  pos_x?: number | null;
  pos_y?: number | null;
  x: number;
  y: number;
  input_json?: unknown;
  output_json?: unknown;
  metadata_json?: unknown;
};

export type WorkflowGraphEdge = {
  id: string;
  from: string;
  to: string;
  label?: string | null;
};

export type WorkflowGraph = {
  registryId: string;
  workflowKey: string;
  displayName: string;
  description?: string;
  riskLevel?: string | null;
  signedOff?: boolean;
  requiresApproval?: boolean;
  dagWorkflowId: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  executionOrder: string[];
  runsSummary?: WorkflowRunsSummary | null;
  registryWorkflow?: Record<string, unknown>;
};

export type WorkflowRunDetail = {
  run: Record<string, unknown>;
  steps: Record<string, unknown>[];
  approvals: Record<string, unknown>[];
  plan?: Record<string, unknown> | null;
};

export type DrawerMode = 'blocks' | 'library' | 'connections' | null;
export type InspectorTab = 'config' | 'run' | 'cost';

export const EXECUTOR_NODE_TYPES: { value: string; label: string; ui: WorkflowUiNodeType }[] = [
  { value: 'trigger', label: 'Trigger', ui: 'trigger' },
  { value: 'process', label: 'Process', ui: 'process' },
  { value: 'output', label: 'Output', ui: 'output' },
  { value: 'agent', label: 'Agent (LLM)', ui: 'agent' },
  { value: 'mcp_tool', label: 'MCP tool', ui: 'mcp_tool' },
  { value: 'terminal', label: 'Terminal', ui: 'terminal' },
  { value: 'db_query', label: 'D1 query', ui: 'db_query' },
  { value: 'script', label: 'Script (R2 / audit)', ui: 'script' },
  { value: 'approval_gate', label: 'Approval gate', ui: 'approval_gate' },
  { value: 'branch', label: 'Branch', ui: 'branch' },
  { value: 'webhook', label: 'Webhook', ui: 'webhook' },
  { value: 'eval', label: 'Eval gate', ui: 'eval' },
];

export function apiNodeTypeToUi(nt: string): WorkflowUiNodeType {
  const t = String(nt || '').toLowerCase();
  if (t === 'agent') return 'agent';
  if (t === 'mcp_tool') return 'mcp_tool';
  if (t === 'terminal') return 'terminal';
  if (t === 'db_query') return 'db_query';
  if (t === 'script') return 'script';
  if (t === 'process') return 'process';
  if (t === 'approval_gate') return 'approval_gate';
  if (t === 'branch') return 'branch';
  if (t === 'webhook') return 'webhook';
  if (t === 'eval') return 'eval';
  if (t === 'trigger') return 'trigger';
  if (t === 'output') return 'output';
  if (t === 'join') return 'output';
  return 'agent';
}
