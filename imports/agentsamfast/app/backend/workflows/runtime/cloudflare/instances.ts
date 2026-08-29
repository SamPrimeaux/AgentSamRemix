import crypto from "crypto";
import { getDatabase } from "../../../../../server/db/database.ts";
import {
  WorkflowStartParams,
  WorkflowInstanceSummary,
  WorkflowInstanceStatus,
  WorkflowStepDetails,
  WorkflowStatus,
  DurableWorkflowDefinition,
  StepExecutionContext,
  StepStatus,
} from "../../types.ts";
import { WorkflowEventManager } from "./events.ts";
import { WorkflowVersionManager } from "./versions.ts";
import { QueueDispatcherService } from "../../queue/queueDispatcher.ts";

interface ActiveExecutionState {
  instanceId: string;
  workflowName: string;
  status: WorkflowStatus;
  currentStepIndex: number;
  params: any;
  stepOutputs: Map<string, any>;
  executedSteps: { name: string; output: any; rollbackHandler?: any }[];
  isPaused: boolean;
  isTerminated: boolean;
}

/**
 * Cloudflare Workflows Instance Execution Engine.
 * Implements:
 * - Durable multi-step progression
 * - Saga rollback compensation in reverse order
 * - Restart from step
 * - Pause / resume / terminate
 * - Detailed step output tracking for UI
 * - D1 correlation receipts
 */
export class WorkflowInstanceManager {
  private static activeExecutions = new Map<string, ActiveExecutionState>();

  /**
   * Starts a new durable workflow instance.
   */
  public static async start<TParams = any>(
    params: WorkflowStartParams<TParams>
  ): Promise<WorkflowInstanceSummary> {
    const db = await getDatabase();
    const instanceId = params.instanceId || "wf_inst_" + crypto.randomBytes(8).toString("hex");
    const runId = "wfrun_" + instanceId.replace("wf_inst_", "");
    const def = WorkflowVersionManager.getDefinition(params.workflowName);
    const versionId = params.versionId || "cf_ver_1.0.0";
    const triggerSource = params.triggerSource || "api";

    const totalSteps = def?.steps.length || 0;
    const successRetention = params.retention?.successRetentionDays || def?.defaultRetention?.successRetentionDays || 7;
    const errorRetention = params.retention?.errorRetentionDays || def?.defaultRetention?.errorRetentionDays || 30;

    // 1. Insert D1 control-plane run receipt
    await db.query(
      `INSERT INTO agentsam_workflow_runs (
        id, workflow_id, runtime, external_workflow_name, external_instance_id,
        external_version_id, trigger_source, status, workspace_id, tenant_id,
        agent_run_id, policy_decision_id, repo_snapshot_id, current_step_index,
        total_steps, params_json, success_retention_days, error_retention_days
      ) VALUES (
        ?, ?, 'cloudflare_workflows', ?, ?,
        ?, ?, 'running', ?, ?,
        ?, ?, ?, 0,
        ?, ?, ?, ?
      )`,
      [
        runId,
        params.workflowName,
        params.workflowName,
        instanceId,
        versionId,
        triggerSource,
        params.workspaceId || null,
        params.tenantId || null,
        params.agentRunId || null,
        params.policyDecisionId || null,
        params.repoSnapshotId || null,
        totalSteps,
        JSON.stringify(params.params || {}),
        successRetention,
        errorRetention,
      ]
    );

    const execState: ActiveExecutionState = {
      instanceId,
      workflowName: params.workflowName,
      status: "running",
      currentStepIndex: 0,
      params: params.params,
      stepOutputs: new Map(),
      executedSteps: [],
      isPaused: false,
      isTerminated: false,
    };
    this.activeExecutions.set(instanceId, execState);

    // 2. Launch execution asynchronously (or background in Cloudflare Workers)
    this.executeWorkflow(execState, def).catch((err) => {
      console.warn(`[WorkflowInstanceManager] Execution error on ${instanceId}:`, (err as Error).message);
    });

    return {
      instanceId,
      workflowName: params.workflowName,
      versionId,
      status: "running",
      triggerSource,
      createdTime: new Date().toISOString(),
      stepCount: totalSteps,
      currentStep: def?.steps[0]?.name,
    };
  }

  /**
   * Bulk creates workflow instances.
   */
  public static async startBatch<TParams = any>(
    paramsList: WorkflowStartParams<TParams>[]
  ): Promise<WorkflowInstanceSummary[]> {
    const results: WorkflowInstanceSummary[] = [];
    for (const p of paramsList) {
      const summary = await this.start(p);
      results.push(summary);
    }
    return results;
  }

  /**
   * Executes the sequence of steps with Saga rollback and error handling.
   */
  private static async executeWorkflow(
    state: ActiveExecutionState,
    def?: DurableWorkflowDefinition,
    startStepIndex: number = 0
  ): Promise<void> {
    const db = await getDatabase();
    if (!def || def.steps.length === 0) {
      state.status = "completed";
      await this.updateRunStatus(state.instanceId, "completed", {});
      return;
    }

    state.currentStepIndex = startStepIndex;

    for (let i = startStepIndex; i < def.steps.length; i++) {
      const step = def.steps[i];
      state.currentStepIndex = i;

      // Check Pause / Terminate signals
      if (state.isTerminated) {
        state.status = "terminated";
        await this.updateRunStatus(state.instanceId, "terminated", undefined, "Workflow terminated by user.");
        return;
      }

      while (state.isPaused) {
        state.status = "paused";
        await this.updateRunStatus(state.instanceId, "paused");
        await new Promise((r) => setTimeout(r, 1000));
        if (state.isTerminated) return;
      }

      state.status = "running";
      const stepStartTime = Date.now();
      const logId = "step_" + crypto.randomBytes(6).toString("hex");

      // Record step running in D1
      await db.query(
        `INSERT INTO agentsam_workflow_step_logs (
          id, instance_id, step_name, step_index, attempt, status, input_json
        ) VALUES (?, ?, ?, ?, 1, 'running', ?)`,
        [logId, state.instanceId, step.name, i, JSON.stringify(state.params)]
      );

      const ctx: StepExecutionContext = {
        instanceId: state.instanceId,
        workflowName: state.workflowName,
        stepName: step.name,
        stepIndex: i,
        attempt: 1,
        params: state.params,
        waitForEvent: (eventName, timeout) =>
          WorkflowEventManager.waitForEvent(state.instanceId, eventName, timeout),
        sendQueueMessage: (qName, mType, payload) =>
          QueueDispatcherService.dispatch(qName, mType, payload, { correlationId: state.instanceId }).then(() => {}),
        logStepOutput: async (output) => {
          state.stepOutputs.set(step.name, output);
        },
      };

      try {
        const inputData = i === 0 ? state.params : state.executedSteps[i - 1]?.output || state.params;
        const stepOutput = await step.handler(ctx, inputData);
        const durationMs = Date.now() - stepStartTime;

        state.stepOutputs.set(step.name, stepOutput);
        state.executedSteps.push({
          name: step.name,
          output: stepOutput,
          rollbackHandler: step.rollback,
        });

        // Update step log completed
        await db.query(
          `UPDATE agentsam_workflow_step_logs 
           SET status = 'completed', duration_ms = ?, output_json = ?, completed_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           WHERE id = ?`,
          [durationMs, JSON.stringify(stepOutput ?? {}), logId]
        );

        // Update run progress in D1
        await db.query(
          `UPDATE agentsam_workflow_runs 
           SET current_step_index = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           WHERE external_instance_id = ?`,
          [i + 1, state.instanceId]
        );
      } catch (stepErr) {
        const durationMs = Date.now() - stepStartTime;
        const errMsg = (stepErr as Error).message;

        // Log step error
        await db.query(
          `UPDATE agentsam_workflow_step_logs 
           SET status = 'errored', duration_ms = ?, error_text = ?, completed_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           WHERE id = ?`,
          [durationMs, errMsg, logId]
        );

        // SAGA ROLLBACK: Execute compensating actions in reverse order of completed steps
        await this.executeSagaRollback(state);

        state.status = "failed";
        await this.updateRunStatus(state.instanceId, "failed", undefined, errMsg);
        return;
      }
    }

    // All steps completed successfully
    state.status = "completed";
    const finalOutput = state.executedSteps[state.executedSteps.length - 1]?.output || {};
    await this.updateRunStatus(state.instanceId, "completed", finalOutput);
  }

  /**
   * Executes Saga compensating rollback handlers in reverse step order.
   */
  public static async executeSagaRollback(state: ActiveExecutionState): Promise<void> {
    const db = await getDatabase();
    const reverseExecuted = [...state.executedSteps].reverse();

    for (const step of reverseExecuted) {
      if (step.rollbackHandler) {
        const rollbackLogId = "roll_" + crypto.randomBytes(6).toString("hex");
        const ctx: StepExecutionContext = {
          instanceId: state.instanceId,
          workflowName: state.workflowName,
          stepName: `rollback_${step.name}`,
          stepIndex: -1,
          attempt: 1,
          waitForEvent: () => Promise.reject(new Error("waitForEvent not supported in rollback")),
          sendQueueMessage: (qName, mType, payload) =>
            QueueDispatcherService.dispatch(qName, mType, payload).then(() => {}),
          logStepOutput: async () => {},
        };

        try {
          await step.rollbackHandler(ctx, step.output);
          await db.query(
            `INSERT INTO agentsam_workflow_step_logs (
              id, instance_id, step_name, step_index, attempt, status, output_json, completed_at
            ) VALUES (?, ?, ?, -1, 1, 'rolled_back', ?, (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
            [rollbackLogId, state.instanceId, `rollback:${step.name}`, JSON.stringify({ rolledBack: true })]
          );
        } catch (rbErr) {
          console.warn(`[WorkflowInstanceManager] Rollback error on ${step.name}:`, (rbErr as Error).message);
        }
      }
    }

    await db.query(
      `UPDATE agentsam_workflow_runs 
       SET status = 'rolled_back', updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       WHERE external_instance_id = ?`,
      [state.instanceId]
    );
  }

  /**
   * Fetches full status of an instance, including all step logs and buffered events.
   */
  public static async getStatus(instanceId: string): Promise<WorkflowInstanceStatus> {
    const db = await getDatabase();
    const runRes = await db.query(
      `SELECT * FROM agentsam_workflow_runs WHERE external_instance_id = ?`,
      [instanceId]
    );

    if (!runRes.results || runRes.results.length === 0) {
      throw new Error(`[WorkflowInstanceManager] Instance ${instanceId} not found.`);
    }

    const run = runRes.results[0];

    // Fetch step logs
    const stepsRes = await db.query(
      `SELECT * FROM agentsam_workflow_step_logs WHERE instance_id = ? ORDER BY step_index ASC, attempt ASC`,
      [instanceId]
    );

    const steps: WorkflowStepDetails[] = (stepsRes.results || []).map((s) => ({
      stepName: s.step_name,
      stepIndex: Number(s.step_index),
      attempt: Number(s.attempt),
      status: s.status as StepStatus,
      startedAt: s.created_at,
      completedAt: s.completed_at || undefined,
      durationMs: Number(s.duration_ms) || 0,
      input: s.input_json ? JSON.parse(s.input_json) : undefined,
      output: s.output_json ? JSON.parse(s.output_json) : undefined,
      error: s.error_text || undefined,
      compensatingRollbackExecuted: s.status === "rolled_back",
    }));

    const events = await WorkflowEventManager.listEvents(instanceId);

    return {
      instanceId: run.external_instance_id,
      workflowName: run.external_workflow_name,
      versionId: run.external_version_id || "cf_ver_1.0.0",
      status: run.status as WorkflowStatus,
      triggerSource: run.trigger_source,
      createdTime: run.created_at,
      completedTime: run.completed_at || undefined,
      stepCount: Number(run.total_steps) || steps.length,
      currentStep: steps.find((s) => s.status === "running")?.stepName || undefined,
      waitingForEvent: run.waiting_event_name || undefined,
      error: run.error_json || undefined,
      params: JSON.parse(run.params_json || "{}"),
      output: run.output_json ? JSON.parse(run.output_json) : undefined,
      steps,
      events,
    };
  }

  /**
   * Retrieves full details and outputs for a specific step.
   */
  public static async getStep(
    instanceId: string,
    stepNameOrIndex: string | number,
    attempt: number = 1
  ): Promise<WorkflowStepDetails> {
    const db = await getDatabase();
    let querySql = `SELECT * FROM agentsam_workflow_step_logs WHERE instance_id = ? AND attempt = ?`;
    const params: any[] = [instanceId, attempt];

    if (typeof stepNameOrIndex === "number") {
      querySql += ` AND step_index = ?`;
      params.push(stepNameOrIndex);
    } else {
      querySql += ` AND step_name = ?`;
      params.push(stepNameOrIndex);
    }

    const res = await db.query(querySql, params);
    if (!res.results || res.results.length === 0) {
      throw new Error(`[WorkflowInstanceManager] Step ${stepNameOrIndex} for instance ${instanceId} not found.`);
    }

    const s = res.results[0];
    return {
      stepName: s.step_name,
      stepIndex: Number(s.step_index),
      attempt: Number(s.attempt),
      status: s.status,
      startedAt: s.created_at,
      completedAt: s.completed_at || undefined,
      durationMs: Number(s.duration_ms) || 0,
      input: s.input_json ? JSON.parse(s.input_json) : undefined,
      output: s.output_json ? JSON.parse(s.output_json) : undefined,
      error: s.error_text || undefined,
    };
  }

  public static async pause(instanceId: string): Promise<{ success: boolean; status: WorkflowStatus }> {
    const state = this.activeExecutions.get(instanceId);
    if (state) {
      state.isPaused = true;
      state.status = "paused";
    }

    const db = await getDatabase();
    await db.query(
      `UPDATE agentsam_workflow_runs 
       SET status = 'paused', updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       WHERE external_instance_id = ?`,
      [instanceId]
    );

    return { success: true, status: "paused" };
  }

  public static async resume(instanceId: string): Promise<{ success: boolean; status: WorkflowStatus }> {
    const state = this.activeExecutions.get(instanceId);
    if (state) {
      state.isPaused = false;
      state.status = "running";
    }

    const db = await getDatabase();
    await db.query(
      `UPDATE agentsam_workflow_runs 
       SET status = 'running', updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       WHERE external_instance_id = ?`,
      [instanceId]
    );

    return { success: true, status: "running" };
  }

  public static async restart(
    instanceId: string,
    options?: { fromStep?: string | number }
  ): Promise<WorkflowInstanceSummary> {
    const db = await getDatabase();
    const runRes = await db.query(
      `SELECT * FROM agentsam_workflow_runs WHERE external_instance_id = ?`,
      [instanceId]
    );

    if (!runRes.results || runRes.results.length === 0) {
      throw new Error(`[WorkflowInstanceManager] Instance ${instanceId} not found to restart.`);
    }

    const run = runRes.results[0];
    const def = WorkflowVersionManager.getDefinition(run.external_workflow_name);

    let startStepIndex = 0;
    if (options?.fromStep !== undefined && def) {
      if (typeof options.fromStep === "number") {
        startStepIndex = options.fromStep;
      } else {
        const foundIdx = def.steps.findIndex((s) => s.name === options.fromStep);
        if (foundIdx !== -1) startStepIndex = foundIdx;
      }
    }

    await db.query(
      `UPDATE agentsam_workflow_runs 
       SET status = 'running', error_json = NULL, current_step_index = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       WHERE external_instance_id = ?`,
      [startStepIndex, instanceId]
    );

    const execState: ActiveExecutionState = {
      instanceId,
      workflowName: run.external_workflow_name,
      status: "running",
      currentStepIndex: startStepIndex,
      params: JSON.parse(run.params_json || "{}"),
      stepOutputs: new Map(),
      executedSteps: [],
      isPaused: false,
      isTerminated: false,
    };
    this.activeExecutions.set(instanceId, execState);

    this.executeWorkflow(execState, def, startStepIndex).catch(() => {});

    return {
      instanceId,
      workflowName: run.external_workflow_name,
      versionId: run.external_version_id,
      status: "running",
      triggerSource: run.trigger_source,
      createdTime: run.created_at,
      stepCount: def?.steps.length || 0,
      currentStep: def?.steps[startStepIndex]?.name,
    };
  }

  public static async terminate(
    instanceId: string,
    options?: { rollback?: boolean }
  ): Promise<{ success: boolean; rolledBack: boolean }> {
    const state = this.activeExecutions.get(instanceId);
    if (state) {
      state.isTerminated = true;
      state.status = "terminated";
    }

    const db = await getDatabase();
    let rolledBack = false;

    if (options?.rollback && state) {
      await this.executeSagaRollback(state);
      rolledBack = true;
    } else {
      await db.query(
        `UPDATE agentsam_workflow_runs 
         SET status = 'terminated', updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')), completed_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         WHERE external_instance_id = ?`,
        [instanceId]
      );
    }

    return { success: true, rolledBack };
  }

  private static async updateRunStatus(
    instanceId: string,
    status: WorkflowStatus,
    output?: any,
    error?: string
  ): Promise<void> {
    const db = await getDatabase();
    const isTerminal = ["completed", "failed", "terminated", "rolled_back"].includes(status);

    await db.query(
      `UPDATE agentsam_workflow_runs 
       SET status = ?, 
           output_json = ?,
           error_json = ?,
           updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           completed_at = ?
       WHERE external_instance_id = ?`,
      [
        status,
        output ? JSON.stringify(output) : null,
        error || null,
        isTerminal ? new Date().toISOString() : null,
        instanceId,
      ]
    );
  }
}
