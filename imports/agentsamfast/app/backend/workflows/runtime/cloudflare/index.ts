import {
  DurableWorkflowRuntime,
  WorkflowStartParams,
  WorkflowInstanceSummary,
  WorkflowInstanceStatus,
  WorkflowStepDetails,
  WorkflowStatus,
  WorkflowVersionInfo,
  WorkflowGraph,
} from "../../types.ts";
import { WorkflowInstanceManager } from "./instances.ts";
import { WorkflowEventManager } from "./events.ts";
import { WorkflowVersionManager } from "./versions.ts";
import { CloudflareWorkflowClient } from "./client.ts";

/**
 * Enterprise Cloudflare Workflows Runtime.
 * Implements durable execution, saga rollbacks, waitForEvent approval gating,
 * step inspection, and version graph drift tracking.
 */
export class CloudflareWorkflowRuntime implements DurableWorkflowRuntime {
  private client: CloudflareWorkflowClient;

  constructor(client?: CloudflareWorkflowClient) {
    this.client = client || new CloudflareWorkflowClient();
  }

  public async start<TParams = any>(
    params: WorkflowStartParams<TParams>
  ): Promise<WorkflowInstanceSummary> {
    return WorkflowInstanceManager.start(params);
  }

  public async startBatch<TParams = any>(
    paramsList: WorkflowStartParams<TParams>[]
  ): Promise<WorkflowInstanceSummary[]> {
    return WorkflowInstanceManager.startBatch(paramsList);
  }

  public async status(instanceId: string): Promise<WorkflowInstanceStatus> {
    return WorkflowInstanceManager.getStatus(instanceId);
  }

  public async getStep(
    instanceId: string,
    stepNameOrIndex: string | number,
    attempt: number = 1
  ): Promise<WorkflowStepDetails> {
    return WorkflowInstanceManager.getStep(instanceId, stepNameOrIndex, attempt);
  }

  public async pause(instanceId: string): Promise<{ success: boolean; status: WorkflowStatus }> {
    return WorkflowInstanceManager.pause(instanceId);
  }

  public async resume(instanceId: string): Promise<{ success: boolean; status: WorkflowStatus }> {
    return WorkflowInstanceManager.resume(instanceId);
  }

  public async restart(
    instanceId: string,
    options?: { fromStep?: string | number }
  ): Promise<WorkflowInstanceSummary> {
    return WorkflowInstanceManager.restart(instanceId, options);
  }

  public async terminate(
    instanceId: string,
    options?: { rollback?: boolean }
  ): Promise<{ success: boolean; rolledBack: boolean }> {
    return WorkflowInstanceManager.terminate(instanceId, options);
  }

  public async sendEvent(
    instanceId: string,
    eventName: string,
    payload: any = {}
  ): Promise<{ acknowledged: boolean; consumedImmediately: boolean }> {
    return WorkflowEventManager.sendEvent(instanceId, eventName, payload);
  }

  public async getVersion(
    workflowName: string,
    versionId?: string
  ): Promise<WorkflowVersionInfo> {
    return WorkflowVersionManager.getVersion(workflowName, versionId);
  }

  public async getGraph(
    workflowName: string,
    versionId?: string
  ): Promise<WorkflowGraph> {
    return WorkflowVersionManager.getGraph(workflowName, versionId);
  }
}

export const defaultWorkflowRuntime = new CloudflareWorkflowRuntime();

export * from "./client.ts";
export * from "./instances.ts";
export * from "./events.ts";
export * from "./versions.ts";
