import crypto from "crypto";
import { getDatabase } from "../../legacy/agentsamfast/database.ts";

/**
 * Cloudflare Queue Fan-Out Interface.
 * Handles high-throughput, asynchronous, independent tasks:
 * - Embedding chunk projections
 * - Vector synchronize events
 * - Repo file events & Git tree ingestion
 * - Telemetry & reward feedback
 */

export interface QueueMessageEnvelope<TPayload = any> {
  id: string;
  queueName: string;
  messageType: string;
  payload: TPayload;
  timestamp: number;
  correlationId?: string;
  retryCount?: number;
}

export type QueueConsumerHandler<TPayload = any> = (
  message: QueueMessageEnvelope<TPayload>
) => Promise<void>;

export class QueueDispatcherService {
  private static consumers = new Map<string, QueueConsumerHandler[]>();

  /**
   * Dispatches a single message to Cloudflare Queue.
   * If running inside Cloudflare Worker, leverages env.MY_QUEUE binding.
   * Also journals to D1 for observability without blocking queue throughput.
   */
  public static async dispatch<T = any>(
    queueName: string,
    messageType: string,
    payload: T,
    options: { correlationId?: string } = {}
  ): Promise<QueueMessageEnvelope<T>> {
    const msgId = "qmsg_" + crypto.randomBytes(8).toString("hex");
    const envelope: QueueMessageEnvelope<T> = {
      id: msgId,
      queueName,
      messageType,
      payload,
      timestamp: Date.now(),
      correlationId: options.correlationId,
      retryCount: 0,
    };

    // 1. If Cloudflare Worker Queue binding is present in global env:
    const cfQueue = (globalThis as any)[queueName] || (globalThis as any).MY_QUEUE;
    if (cfQueue && typeof cfQueue.send === "function") {
      try {
        await cfQueue.send(envelope);
      } catch (e) {
        console.warn(`[QueueDispatcher] Native CF Queue send error for ${queueName}:`, (e as Error).message);
      }
    }

    // 2. Persist in D1 agentsam_queue_messages
    try {
      const db = await getDatabase();
      await db.query(
        `INSERT INTO agentsam_queue_messages (
          id, queue_name, message_type, payload_json, status, attempts
        ) VALUES (?, ?, ?, ?, 'queued', 0)`,
        [msgId, queueName, messageType, JSON.stringify(payload)]
      );
    } catch (e) {
      // Non-blocking log
    }

    // 3. Trigger registered local handlers if in local/test environment
    const handlers = this.consumers.get(`${queueName}:${messageType}`) || this.consumers.get(queueName) || [];
    for (const handler of handlers) {
      try {
        await handler(envelope);
        this.markCompleted(msgId).catch(() => {});
      } catch (err) {
        this.markFailed(msgId, (err as Error).message).catch(() => {});
      }
    }

    return envelope;
  }

  /**
   * Batch dispatch for high-volume jobs (e.g. 5,000 chunk vectorizations).
   */
  public static async dispatchBatch<T = any>(
    queueName: string,
    messageType: string,
    payloads: T[],
    options: { correlationId?: string } = {}
  ): Promise<QueueMessageEnvelope<T>[]> {
    const envelopes: QueueMessageEnvelope<T>[] = [];

    // Chunk database writes to keep D1 queries lightweight
    for (const p of payloads) {
      const env = await this.dispatch(queueName, messageType, p, options);
      envelopes.push(env);
    }

    return envelopes;
  }

  /**
   * Registers a consumer handler for queue messages.
   */
  public static registerConsumer(
    queueName: string,
    messageType: string | "*",
    handler: QueueConsumerHandler
  ): void {
    const key = messageType === "*" ? queueName : `${queueName}:${messageType}`;
    const existing = this.consumers.get(key) || [];
    existing.push(handler);
    this.consumers.set(key, existing);
  }

  public static async markCompleted(messageId: string): Promise<void> {
    try {
      const db = await getDatabase();
      await db.query(
        `UPDATE agentsam_queue_messages 
         SET status = 'completed', completed_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         WHERE id = ?`,
        [messageId]
      );
    } catch (e) {}
  }

  public static async markFailed(messageId: string, errorText: string): Promise<void> {
    try {
      const db = await getDatabase();
      await db.query(
        `UPDATE agentsam_queue_messages 
         SET status = 'failed', attempts = attempts + 1
         WHERE id = ?`,
        [messageId]
      );
    } catch (e) {}
  }
}
