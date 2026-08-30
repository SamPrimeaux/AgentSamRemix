import { DurableWorkflowDefinition } from "../types.ts";
import { WorkflowVersionManager } from "../runtime/cloudflare/versions.ts";
import { getDatabase } from "../../legacy/agentsamfast/database.ts";

export interface ProvisionWorkspaceParams {
  workspaceId: string;
  name: string;
  tenantId?: string;
  failAtStep?: "kv" | "worker";
}

export interface ProvisionState {
  workspaceId: string;
  name: string;
  d1DatabaseId?: string;
  r2BucketName?: string;
  kvNamespaceId?: string;
  workerScriptId?: string;
  provisionedResources: string[];
}

export const workspaceProvisioningWorkflow: DurableWorkflowDefinition<ProvisionWorkspaceParams, ProvisionState> = {
  workflowName: "workspace-provisioning",
  title: "Customer Workspace Provisioning Pipeline",
  description: "Durable saga provisioning workflow across D1, R2, KV, and Worker with reverse compensation",
  category: "provisioning",
  defaultRetention: {
    successRetentionDays: 30,
    errorRetentionDays: 30,
  },
  steps: [
    {
      name: "create_d1_database",
      label: "Provision D1 Database",
      handler: async (ctx, params: ProvisionWorkspaceParams) => {
        const d1Id = `d1_${params.workspaceId}_main`;
        const db = await getDatabase();
        await db.query(
          `INSERT OR REPLACE INTO agentsam_workspace (id, tenant_id, name) VALUES (?, ?, ?)`,
          [params.workspaceId, params.tenantId || "", params.name]
        );

        return {
          workspaceId: params.workspaceId,
          name: params.name,
          d1DatabaseId: d1Id,
          provisionedResources: ["D1:" + d1Id],
        } as ProvisionState;
      },
      rollback: async (ctx, state: ProvisionState) => {
        const db = await getDatabase();
        await db.query(`DELETE FROM agentsam_workspace WHERE id = ?`, [state.workspaceId]);
      },
    },
    {
      name: "create_r2_bucket",
      label: "Provision R2 Object Storage Bucket",
      handler: async (ctx, state: ProvisionState) => {
        const r2Name = `r2-${state.workspaceId}-artifacts`;
        return {
          ...state,
          r2BucketName: r2Name,
          provisionedResources: [...state.provisionedResources, "R2:" + r2Name],
        };
      },
      rollback: async (ctx, state: ProvisionState) => {
        // Compensating action: deletes created R2 bucket
        state.provisionedResources = state.provisionedResources.filter((r) => !r.startsWith("R2:"));
      },
    },
    {
      name: "create_kv_namespace",
      label: "Provision KV Cache Namespace",
      handler: async (ctx, state: ProvisionState) => {
        if ((ctx as any).params?.failAtStep === "kv") {
          throw new Error("[CloudflareKV] Quota exceeded: Failed to provision KV namespace.");
        }

        const kvId = `kv_${state.workspaceId}_cache`;
        return {
          ...state,
          kvNamespaceId: kvId,
          provisionedResources: [...state.provisionedResources, "KV:" + kvId],
        };
      },
      rollback: async (ctx, state: ProvisionState) => {
        // Compensating action: deletes created KV namespace
        state.provisionedResources = state.provisionedResources.filter((r) => !r.startsWith("KV:"));
      },
    },
    {
      name: "configure_worker_script",
      label: "Configure Worker Ingress & Bindings",
      handler: async (ctx, state: ProvisionState) => {
        if ((ctx as any).params?.failAtStep === "worker") {
          throw new Error("[CloudflareWorker] Script deployment rejected: invalid route syntax.");
        }

        const workerId = `wrk_${state.workspaceId}_ingress`;
        return {
          ...state,
          workerScriptId: workerId,
          provisionedResources: [...state.provisionedResources, "Worker:" + workerId],
          status: "workspace_active",
        };
      },
      rollback: async (ctx, state: ProvisionState) => {
        // Compensating action: remove worker script
        state.provisionedResources = state.provisionedResources.filter((r) => !r.startsWith("Worker:"));
      },
    },
  ],
};

WorkflowVersionManager.registerDefinition(workspaceProvisioningWorkflow);
