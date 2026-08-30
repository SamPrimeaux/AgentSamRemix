import { DurableWorkflowDefinition } from "../types.ts";
import { WorkflowVersionManager } from "../runtime/cloudflare/versions.ts";

export interface ApprovalWorkflowParams {
  actionType: "model_promotion" | "database_cutover" | "production_deploy" | "bulk_reindex";
  targetResource: string;
  estimatedCostUsd?: number;
  requesterEmail?: string;
}

export const approvalGateWorkflow: DurableWorkflowDefinition<ApprovalWorkflowParams, any> = {
  workflowName: "approval-gate-workflow",
  title: "Consequential Action Approval Gate",
  description: "Durable workflow with waitForEvent('approval') human-in-the-loop gating",
  category: "governance",
  defaultRetention: {
    successRetentionDays: 30,
    errorRetentionDays: 30,
  },
  steps: [
    {
      name: "prepare_operation",
      label: "Prepare Consequential Operation & Risk Assessment",
      type: "step_do",
      handler: async (ctx, params: ApprovalWorkflowParams) => {
        const riskLevel = (params.estimatedCostUsd || 0) > 100 ? "high" : "standard";
        return {
          ...params,
          riskLevel,
          preparedAt: new Date().toISOString(),
          instanceId: ctx.instanceId,
        };
      },
    },
    {
      name: "await_human_approval",
      label: "Wait For Human Approval Event",
      type: "step_wait_for_event",
      handler: async (ctx, state: any) => {
        // Durably pauses until external approval event arrives
        const eventPayload = await ctx.waitForEvent("approval", 86400); // 24hr timeout
        if (eventPayload && eventPayload.approved === false) {
          throw new Error(`[ApprovalGate] Operation rejected by user: ${eventPayload.reason || "No reason given"}`);
        }

        return {
          ...state,
          approvalStatus: "approved",
          approvedBy: eventPayload.approvedBy || "reviewer",
          approvalTimestamp: new Date().toISOString(),
        };
      },
    },
    {
      name: "execute_operation",
      label: "Execute Approved Action",
      type: "step_do",
      handler: async (ctx, state: any) => {
        return {
          ...state,
          executionStatus: "completed",
          completedAt: new Date().toISOString(),
        };
      },
    },
  ],
};

WorkflowVersionManager.registerDefinition(approvalGateWorkflow);
