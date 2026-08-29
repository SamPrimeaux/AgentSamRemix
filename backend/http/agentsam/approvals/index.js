/** Approval-family dispatcher. */

import { handleProposalRoutes } from './proposals.js';
import { handlePendingApprovalRoute } from './pending.js';
import { handleApprovalDecisionRoutes } from './decisions.js';

export async function handleAgentApprovalRoutes(request, url, env, ctx, identity) {
  const proposals = await handleProposalRoutes(request, url, env, ctx, identity);
  if (proposals) return proposals;
  const pending = await handlePendingApprovalRoute(request, url, env, ctx, identity);
  if (pending) return pending;
  return handleApprovalDecisionRoutes(request, url, env, ctx, identity);
}
