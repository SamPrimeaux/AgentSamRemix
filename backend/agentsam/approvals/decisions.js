/** Approval decision authority; HTTP modules only provide trusted actor context. */

import { getApprovalQueueRow, setApprovalQueueStatus } from './queue.js';
import { linkApprovalDecision } from './linkage.js';

export async function decideApproval(env, approvalId, status, actorId) {
  const row = await getApprovalQueueRow(env, approvalId);
  if (!row) return { ok: false, error: 'not_found' };
  const decided = await setApprovalQueueStatus(env, approvalId, status, actorId);
  await linkApprovalDecision(env, decided || row, status);
  return { ok: true, approval: decided || row };
}

export async function getApprovalForDecision(env, approvalId) {
  return getApprovalQueueRow(env, approvalId);
}
