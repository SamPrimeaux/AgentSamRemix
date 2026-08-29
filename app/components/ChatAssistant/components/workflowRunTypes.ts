/** Shared workflow run types — keep out of WorkflowRunBoard to avoid import cycles. */

export type WorkflowRow = {
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
};

export type WorkflowStepState = {
  node_key: string;
  node_type?: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'approval_pending';
  ok?: boolean;
};

export type WorkflowRunState = {
  runId: string | null;
  workflowKey: string | null;
  status: 'idle' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'error';
  stepsTotal: number;
  stepsCompleted: number;
  currentNodeKey: string | null;
  steps: WorkflowStepState[];
  approvalId: string | null;
  errorMessage: string | null;
  executionEngine?: 'sse' | 'durable' | null;
};
