import crypto from "crypto";
import { getDatabase } from "../../../../../server/db/database.ts";
import { WorkflowEventRecord } from "../../types.ts";

/**
 * Cloudflare Workflows Event Manager.
 * Implements waitForEvent / sendEvent with persistent D1 event buffering:
 * - Buffers events sent before the workflow reaches waitForEvent
 * - Immediately unlocks workflows waiting on matching events
 * - Powers human approval flows & external CI callbacks
 */
export class WorkflowEventManager {
  private static activeWaiters = new Map<
    string,
    {
      eventName: string;
      resolve: (payload: any) => void;
      reject: (err: any) => void;
      timer?: NodeJS.Timeout;
    }
  >();

  /**
   * Durably waits for an external event.
   * Checks D1 buffer first in case event was sent prior to step arrival.
   */
  public static async waitForEvent(
    instanceId: string,
    eventName: string,
    timeoutSeconds: number = 3600
  ): Promise<any> {
    const db = await getDatabase();

    // 1. Check if event was pre-buffered in D1
    const existing = await db.query(
      `SELECT id, payload_json FROM agentsam_workflow_events 
       WHERE instance_id = ? AND event_name = ? AND status = 'pending'
       ORDER BY created_at ASC LIMIT 1`,
      [instanceId, eventName]
    );

    if (existing.results && existing.results.length > 0) {
      const eventRow = existing.results[0];
      // Mark consumed
      await db.query(
        `UPDATE agentsam_workflow_events 
         SET status = 'consumed', consumed_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         WHERE id = ?`,
        [eventRow.id]
      );

      return JSON.parse(eventRow.payload_json || "{}");
    }

    // 2. Set status in D1 run to waiting_for_event
    await db.query(
      `UPDATE agentsam_workflow_runs 
       SET status = 'waiting_for_event', waiting_event_name = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       WHERE external_instance_id = ?`,
      [eventName, instanceId]
    );

    // 3. Register in-memory event listener with timeout
    return new Promise((resolve, reject) => {
      const waiterKey = `${instanceId}:${eventName}`;
      
      let timer: NodeJS.Timeout | undefined;
      if (timeoutSeconds > 0) {
        timer = setTimeout(() => {
          WorkflowEventManager.activeWaiters.delete(waiterKey);
          reject(new Error(`[WorkflowEvents] waitForEvent timed out after ${timeoutSeconds}s waiting for '${eventName}'`));
        }, timeoutSeconds * 1000);
      }

      WorkflowEventManager.activeWaiters.set(waiterKey, {
        eventName,
        resolve: (payload) => {
          if (timer) clearTimeout(timer);
          resolve(payload);
        },
        reject: (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
        timer,
      });
    });
  }

  /**
   * Sends an external event to a running or pending workflow instance.
   */
  public static async sendEvent(
    instanceId: string,
    eventName: string,
    payload: any = {},
    emittedBy: string = "user"
  ): Promise<{ acknowledged: boolean; consumedImmediately: boolean }> {
    const db = await getDatabase();
    const eventId = "wfevt_" + crypto.randomBytes(8).toString("hex");
    const waiterKey = `${instanceId}:${eventName}`;

    const activeWaiter = this.activeWaiters.get(waiterKey);
    let consumedImmediately = false;

    if (activeWaiter) {
      consumedImmediately = true;
      this.activeWaiters.delete(waiterKey);
      activeWaiter.resolve(payload);

      // Record consumed event in D1
      await db.query(
        `INSERT INTO agentsam_workflow_events (
          id, instance_id, event_name, status, payload_json, emitted_by, consumed_at
        ) VALUES (?, ?, ?, 'consumed', ?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
        [eventId, instanceId, eventName, JSON.stringify(payload), emittedBy]
      );

      // Update instance status to running
      await db.query(
        `UPDATE agentsam_workflow_runs 
         SET status = 'running', waiting_event_name = NULL, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         WHERE external_instance_id = ?`,
        [instanceId]
      );
    } else {
      // Buffer event in D1 for future waitForEvent step
      await db.query(
        `INSERT INTO agentsam_workflow_events (
          id, instance_id, event_name, status, payload_json, emitted_by
        ) VALUES (?, ?, ?, 'pending', ?, ?)`,
        [eventId, instanceId, eventName, JSON.stringify(payload), emittedBy]
      );
    }

    return {
      acknowledged: true,
      consumedImmediately,
    };
  }

  /**
   * Lists all pending or historic events for an instance.
   */
  public static async listEvents(instanceId: string): Promise<WorkflowEventRecord[]> {
    const db = await getDatabase();
    const res = await db.query(
      `SELECT id, instance_id, event_name, status, payload_json, emitted_by, created_at, consumed_at
       FROM agentsam_workflow_events 
       WHERE instance_id = ?
       ORDER BY created_at ASC`,
      [instanceId]
    );

    return (res.results || []).map((r) => ({
      id: r.id,
      instanceId: r.instance_id,
      eventName: r.event_name,
      status: r.status,
      payload: JSON.parse(r.payload_json || "{}"),
      emittedBy: r.emitted_by,
      createdAt: r.created_at,
      consumedAt: r.consumed_at,
    }));
  }
}
