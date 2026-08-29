/**
 * AgentSam Durable Workflows & Queue Architecture Types.
 * Defines provider-neutral contracts for Cloudflare Workflows, Cloudflare Queues,
 * Saga rollback compensations, waitForEvent approvals, and graph drift analysis.
 */

export type WorkflowRuntimeType = "cloudflare_workflows" | "local_emulator";

export type WorkflowStatus =
  | "queued"
  | "running"
  | "paused"
  | "waiting_for_event"
  | "completed"
  | "failed"
  | "terminated"
  | "rolled_back";

export type StepStatus =
  | "pending"
  | "running"
  | "waiting_for_event"
  | "completed"
  | "errored"
  | "skipped"
  | "rolled_back";

export type TriggerSource =
  | "api"
  | "cron"
  | "event"
  | "queue"
  | "cli"
  | "subworkflow";

export interface WorkflowRetentionPolicy {
  successRetentionDays: number;
  errorRetentionDays: number;
}

export interface WorkflowStartParams<TParams = any> {
  workflowName: string;
  instanceId?: string;
  params: TParams;
  versionId?: string;
  triggerSource?: TriggerSource;
  retention?: WorkflowRetentionPolicy;
  
  // D1 Control Plane Correlation Metadata
  workspaceId?: string;
  tenantId?: string;
  agentRunId?: string;
  policyDecisionId?: string;
  repoSnapshotId?: string;
}

export interface WorkflowInstanceSummary {
  instanceId: string;
  workflowName: string;
  versionId: string;
  status: WorkflowStatus;
  triggerSource: TriggerSource;
  createdTime: string;
  completedTime?: string;
  stepCount: number;
  currentStep?: string;
  waitingForEvent?: string;
  error?: string;
}

export interface WorkflowStepDetails {
  stepName: string;
  stepIndex: number;
  attempt: number;
  status: StepStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  input?: any;
  output?: any;
  error?: string;
  compensatingRollbackExecuted?: boolean;
}

export interface WorkflowInstanceStatus extends WorkflowInstanceSummary {
  params: any;
  output?: any;
  steps: WorkflowStepDetails[];
  events: WorkflowEventRecord[];
  rollbackHistory?: {
    stepName: string;
    action: string;
    status: "success" | "failed";
    timestamp: string;
    error?: string;
  }[];
}

export interface WorkflowEventRecord {
  id: string;
  instanceId: string;
  eventName: string;
  status: "pending" | "consumed" | "expired";
  payload: any;
  emittedBy: string;
  createdAt: string;
  consumedAt?: string;
}

export type GraphNodeType =
  | "step_do"
  | "step_sleep"
  | "step_sleep_until"
  | "step_wait_for_event"
  | "loop"
  | "parallel_all"
  | "parallel_any"
  | "parallel_race"
  | "try_catch_finally"
  | "saga_step"
  | "condition"
  | "function";

export interface DeployedGraphNode {
  id: string;
  type: GraphNodeType;
  name: string;
  label: string;
  children?: DeployedGraphNode[];
  edges?: { targetId: string; type: "success" | "failure" | "event" | "rollback" }[];
  config?: Record<string, any>;
}

export interface WorkflowGraph {
  workflowName: string;
  versionId: string;
  entryNodeId: string;
  nodes: DeployedGraphNode[];
  rawAst?: any;
}

export interface WorkflowVersionInfo {
  versionId: string;
  workflowName: string;
  deployedAt: string;
  stepLimit: number;
  schedules?: { cron: string; name?: string }[];
  isLatest: boolean;
}

export interface WorkflowGraphDriftReport {
  workflowName: string;
  isConsistent: boolean;
  desiredNodesCount: number;
  deployedNodesCount: number;
  missingInDeployed: string[];
  unexpectedInDeployed: string[];
  edgeMismatches: string[];
  lastCheckedAt: string;
}

export interface StepExecutionContext {
  instanceId: string;
  workflowName: string;
  stepName: string;
  stepIndex: number;
  attempt: number;
  params?: any;
  waitForEvent: (eventName: string, timeoutSeconds?: number) => Promise<any>;
  sendQueueMessage: (queueName: string, messageType: string, payload: any) => Promise<void>;
  logStepOutput: (output: any) => Promise<void>;
}

export type StepHandler<TInput = any, TOutput = any> = (
  ctx: StepExecutionContext,
  input: TInput
) => Promise<TOutput>;

export type RollbackHandler<TState = any> = (
  ctx: StepExecutionContext,
  state: TState
) => Promise<void>;

export interface WorkflowStepDefinition<TInput = any, TOutput = any, TRollback = any> {
  name: string;
  label: string;
  type?: GraphNodeType;
  handler: StepHandler<TInput, TOutput>;
  rollback?: RollbackHandler<TRollback>;
  timeoutSeconds?: number;
  maxRetries?: number;
  backoff?: "exponential" | "linear" | "constant";
}

export interface DurableWorkflowDefinition<TParams = any, TOutput = any> {
  workflowName: string;
  title: string;
  description?: string;
  category?: string;
  schedules?: { cron: string; name?: string }[];
  stepLimit?: number;
  defaultRetention?: WorkflowRetentionPolicy;
  steps: WorkflowStepDefinition[];
}

/**
 * Universal Durable Workflow Runtime Interface.
 * Pure abstraction over Cloudflare Workflows / Local execution.
 */
export interface DurableWorkflowRuntime {
  start<TParams = any>(params: WorkflowStartParams<TParams>): Promise<WorkflowInstanceSummary>;
  startBatch<TParams = any>(paramsList: WorkflowStartParams<TParams>[]): Promise<WorkflowInstanceSummary[]>;

  status(instanceId: string): Promise<WorkflowInstanceStatus>;
  getStep(instanceId: string, stepNameOrIndex: string | number, attempt?: number): Promise<WorkflowStepDetails>;

  pause(instanceId: string): Promise<{ success: boolean; status: WorkflowStatus }>;
  resume(instanceId: string): Promise<{ success: boolean; status: WorkflowStatus }>;
  restart(instanceId: string, options?: { fromStep?: string | number }): Promise<WorkflowInstanceSummary>;
  terminate(instanceId: string, options?: { rollback?: boolean }): Promise<{ success: boolean; rolledBack: boolean }>;

  sendEvent(instanceId: string, eventName: string, payload?: any): Promise<{ acknowledged: boolean; consumedImmediately: boolean }>;

  getVersion(workflowName: string, versionId?: string): Promise<WorkflowVersionInfo>;
  getGraph(workflowName: string, versionId?: string): Promise<WorkflowGraph>;
}
