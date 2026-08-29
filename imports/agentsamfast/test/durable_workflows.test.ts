import { describe, it, expect, beforeAll } from "vitest";
import { getDatabase } from "../server/db/database.ts";
import {
  defaultWorkflowRuntime,
  WorkflowVersionManager,
  QueueDispatcherService,
  embeddingMigrationWorkflow,
  workspaceProvisioningWorkflow,
  approvalGateWorkflow,
  repoIndexWorkflow,
} from "../app/backend/workflows/index.ts";

describe("AgentSam Cloudflare Durable Workflows & Queue Test Suite", () => {
  beforeAll(async () => {
    const db = await getDatabase();
    await db.query(`DELETE FROM agentsam_workflow_step_logs WHERE instance_id LIKE 'test_%'`);
    await db.query(`DELETE FROM agentsam_workflow_events WHERE instance_id LIKE 'test_%'`);
    await db.query(`DELETE FROM agentsam_workflow_runs WHERE external_instance_id LIKE 'test_%'`);
  });

  it("1. Durable Workflow Registration & Version Graph Introspection", async () => {
    const versionInfo = await defaultWorkflowRuntime.getVersion("embedding-route-migration");
    expect(versionInfo.workflowName).toBe("embedding-route-migration");
    expect(versionInfo.stepLimit).toBe(15000);

    const graph = await defaultWorkflowRuntime.getGraph("embedding-route-migration");
    expect(graph.workflowName).toBe("embedding-route-migration");
    expect(graph.nodes.length).toBe(4);
    expect(graph.nodes[0].name).toBe("create_target_projection");
    expect(graph.nodes[1].name).toBe("queue_chunk_backfill");
    expect(graph.nodes[3].edges?.some((e) => e.type === "rollback")).toBe(true);
  });

  it("2. Desired Graph vs Deployed Graph Drift Detection", async () => {
    const db = await getDatabase();
    const wfId = "wf_prod_emb_mig";

    // Insert product workflow definition in D1
    await db.query(
      `INSERT OR REPLACE INTO agentsam_workflows (
        id, workflow_key, title, description, category
      ) VALUES (?, 'embedding-route-migration', 'Embedding Route Migration', 'Production migration', 'migration')`,
      [wfId]
    );

    // Insert nodes in D1
    await db.query(
      `INSERT OR REPLACE INTO agentsam_workflow_nodes (
        id, workflow_id, node_key, node_type, label
      ) VALUES ('node_1', ?, 'create_target_projection', 'step_do', 'Create Projection'),
               ('node_2', ?, 'queue_chunk_backfill', 'step_do', 'Queue Backfill'),
               ('node_3', ?, 'validate_projection_coverage', 'step_do', 'Validate Coverage'),
               ('node_4', ?, 'cutover_active_route', 'saga_step', 'Cutover Route')`,
      [wfId, wfId, wfId, wfId]
    );

    const driftReport = await WorkflowVersionManager.compareGraphDrift("embedding-route-migration");
    expect(driftReport.isConsistent).toBe(true);
    expect(driftReport.missingInDeployed.length).toBe(0);
    expect(driftReport.unexpectedInDeployed.length).toBe(0);
  });

  it("3. Multi-Step Execution & D1 Run Correlation", async () => {
    const instanceId = "test_inst_migration_1";
    const startResult = await defaultWorkflowRuntime.start({
      workflowName: "embedding-route-migration",
      instanceId,
      params: {
        ticker: "AAPL",
        sourceRouteKey: "code:google-text-embed:v1",
        targetRouteKey: "code:workers-ai-bge:v1",
        targetEmbeddingSpaceKey: "workers-ai:bge-base-en-v1.5:768:mean:v1",
        targetDimensions: 768,
        provider: "workers-ai",
        model: "@cf/baai/bge-base-en-v1.5",
      },
      triggerSource: "api",
      workspaceId: "ws_test_1",
    });

    expect(startResult.instanceId).toBe(instanceId);
    expect(startResult.status).toBe("running");

    // Wait briefly for synchronous steps to complete
    await new Promise((r) => setTimeout(r, 100));

    const status = await defaultWorkflowRuntime.status(instanceId);
    expect(status.status).toBe("completed");
    expect(status.steps.length).toBe(4);
    expect(status.steps.every((s) => s.status === "completed")).toBe(true);

    // Verify detailed step inspection
    const step2 = await defaultWorkflowRuntime.getStep(instanceId, "queue_chunk_backfill");
    expect(step2.stepName).toBe("queue_chunk_backfill");
    expect(step2.status).toBe("completed");
    expect(step2.output?.targetSpaceKey).toBe("workers-ai:bge-base-en-v1.5:768:mean:v1");
  });

  it("4. waitForEvent & sendEvent Human Approval Gating", async () => {
    const instanceId = "test_inst_approval_1";

    const startResult = await defaultWorkflowRuntime.start({
      workflowName: "approval-gate-workflow",
      instanceId,
      params: {
        actionType: "production_deploy",
        targetResource: "worker:prod-ingress",
        estimatedCostUsd: 150,
      },
    });

    expect(startResult.status).toBe("running");

    // Allow step 1 to execute and enter waitForEvent
    await new Promise((r) => setTimeout(r, 50));

    const midStatus = await defaultWorkflowRuntime.status(instanceId);
    expect(midStatus.waitingForEvent).toBe("approval");

    // Send human approval event
    const eventRes = await defaultWorkflowRuntime.sendEvent(instanceId, "approval", {
      approved: true,
      approvedBy: "security_admin@example.com",
    });

    expect(eventRes.acknowledged).toBe(true);

    // Allow execution to finalize
    await new Promise((r) => setTimeout(r, 100));

    const finalStatus = await defaultWorkflowRuntime.status(instanceId);
    expect(finalStatus.status).toBe("completed");
    expect(finalStatus.output?.approvalStatus).toBe("approved");
    expect(finalStatus.output?.approvedBy).toBe("security_admin@example.com");
  });

  it("5. Saga Rollback Reverse Compensation Order", async () => {
    const instanceId = "test_inst_saga_fail_1";

    // Start workspace provisioning with forced failure at worker step
    await defaultWorkflowRuntime.start({
      workflowName: "workspace-provisioning",
      instanceId,
      params: {
        workspaceId: "ws_saga_test",
        name: "Saga Rollback Test Workspace",
        failAtStep: "worker",
      },
    });

    // Wait for failure and rollback execution
    await new Promise((r) => setTimeout(r, 150));

    const status = await defaultWorkflowRuntime.status(instanceId);
    expect(status.status).toBe("failed");

    // Check step logs: step 0 (D1), step 1 (R2), step 2 (KV) completed, step 3 errored
    expect(status.steps.some((s) => s.stepName === "configure_worker_script" && s.status === "errored")).toBe(true);

    // Verify compensating rollback steps were logged
    const db = await getDatabase();
    const rollbacks = await db.query(
      `SELECT step_name, status FROM agentsam_workflow_step_logs WHERE instance_id = ? AND status = 'rolled_back'`,
      [instanceId]
    );

    expect(rollbacks.results?.length).toBeGreaterThanOrEqual(1);

    // Verify D1 workspace record was rolled back (deleted)
    const wsCheck = await db.query(`SELECT id FROM agentsam_workspace WHERE id = 'ws_saga_test'`);
    expect(wsCheck.results?.length || 0).toBe(0);
  });

  it("6. Pause, Resume, and Restart From Step", async () => {
    const instanceId = "test_inst_pause_resume";

    await defaultWorkflowRuntime.start({
      workflowName: "workspace-provisioning",
      instanceId,
      params: {
        workspaceId: "ws_pause_test",
        name: "Pause Resume Workspace",
      },
    });

    const pauseRes = await defaultWorkflowRuntime.pause(instanceId);
    expect(pauseRes.status).toBe("paused");

    const resumeRes = await defaultWorkflowRuntime.resume(instanceId);
    expect(resumeRes.status).toBe("running");

    // Restart from step 0
    const restartRes = await defaultWorkflowRuntime.restart(instanceId, { fromStep: 0 });
    expect(restartRes.status).toBe("running");

    await new Promise((r) => setTimeout(r, 100));

    const completedStatus = await defaultWorkflowRuntime.status(instanceId);
    expect(completedStatus.status).toBe("completed");
  });

  it("7. Bulk Start Batch Operations", async () => {
    const batchParams = [
      {
        workflowName: "repo-index-pipeline",
        instanceId: "test_batch_repo_1",
        params: { repoName: "repo-alpha" },
      },
      {
        workflowName: "repo-index-pipeline",
        instanceId: "test_batch_repo_2",
        params: { repoName: "repo-beta" },
      },
    ];

    const summaries = await defaultWorkflowRuntime.startBatch(batchParams);
    expect(summaries.length).toBe(2);
    expect(summaries[0].instanceId).toBe("test_batch_repo_1");
    expect(summaries[1].instanceId).toBe("test_batch_repo_2");
  });

  it("8. High-Volume Fan-Out via Cloudflare Queue Dispatcher", async () => {
    const testQueue = "MY_QUEUE";
    let messageReceived: any = null;

    QueueDispatcherService.registerConsumer(testQueue, "telemetry_event", async (envelope) => {
      messageReceived = envelope;
    });

    const msg = await QueueDispatcherService.dispatch(testQueue, "telemetry_event", {
      event: "model_call",
      latencyMs: 340,
    });

    expect(msg.queueName).toBe(testQueue);
    expect(msg.messageType).toBe("telemetry_event");
    expect(messageReceived).not.toBeNull();
    expect(messageReceived.payload.latencyMs).toBe(340);
  });
});
